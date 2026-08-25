/**
 * oracle-bookings-sync.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  Sincroniza las RESERVAS (bookings.json) con Oracle Object Storage,
 *  igual que oracle-sync.js hace con catalog.json, pero en un archivo
 *  separado para que reservas de clientes y ediciones del admin no se
 *  pisen entre sí.
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {

  var _inited    = false;
  var _pollTimer = null;
  var _lastEtag  = null;

  function cfg() { return global.__ORACLE_CONFIG__ || null; }

  function configOk() {
    var c = cfg();
    return c && c.PAR_URL && c.PAR_URL.indexOf('objectstorage') !== -1 && c.BUCKET_PUBLIC_URL;
  }

  var BOOKINGS_FILE = 'bookings.json';

  function writeUrl() { return cfg().PAR_URL + BOOKINGS_FILE; }
  function readUrl()  { return cfg().BUCKET_PUBLIC_URL + BOOKINGS_FILE + '?t=' + Date.now(); }

  function refreshAdmin() {
    try { if (global.AdminApp && global.AdminApp.renderBookings) global.AdminApp.renderBookings(); } catch (e) {}
  }
  function refreshCatalog() {
    try { if (global.Catalog && global.Catalog.refreshSeats) global.Catalog.refreshSeats(); } catch (e) {}
  }

  function fetchBookings(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', readUrl(), true);
    xhr.setRequestHeader('Cache-Control', 'no-cache');
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var newEtag = xhr.getResponseHeader('ETag') || xhr.responseText.length.toString();
          if (newEtag === _lastEtag) { callback(null, null); return; }
          _lastEtag = newEtag;
          callback(null, data);
        } catch (e) { callback(e, null); }
      } else if (xhr.status === 404) {
        callback(null, { version: 1, bookings: [] });
      } else {
        callback(new Error('HTTP ' + xhr.status), null);
      }
    };
    xhr.onerror = function () { callback(new Error('Network error'), null); };
    xhr.send();
  }

  function pushBookings(payload) {
    if (!configOk()) return;
    var body = JSON.stringify(payload, null, 2);
    var xhr = new XMLHttpRequest();
    xhr.open('PUT', writeUrl(), true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        _lastEtag = xhr.getResponseHeader('ETag') || body.length.toString();
        console.log('[OS] bookings.json guardado en Oracle ✓');
      } else {
        console.error('[OS] Error al guardar bookings.json:', xhr.status, xhr.statusText);
      }
    };
    xhr.onerror = function () { console.error('[OS] Error de red al guardar bookings.json'); };
    xhr.send(body);
  }

  function buildPayload() {
    var BS = global.BookingsStore;
    return {
      version:   1,
      updatedAt: new Date().toISOString(),
      bookings:  BS.getBookings ? BS.getBookings() : []
    };
  }

  function applyRemoteData(data) {
    if (!data || typeof data !== 'object') return;
    var BS = global.BookingsStore;
    if (Array.isArray(data.bookings)) {
      BS.setBookingsFromRemote(data.bookings);
      refreshAdmin();
      refreshCatalog();
    }
  }

  function startPolling() {
    if (_pollTimer) return;
    var interval = (cfg() && cfg().POLL_INTERVAL_MS) || 15000;
    _pollTimer = setInterval(function () {
      fetchBookings(function (err, data) {
        if (err) { console.warn('[OS] Polling reservas error:', err.message); return; }
        if (data !== null) applyRemoteData(data);
      });
    }, interval);
  }

  function stopPolling() { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }

  global.OracleBookingsSync = {
    pushBookings: function () {
      if (!configOk()) return;
      pushBookings(buildPayload());
    },
    init: function () {
      return new Promise(function (resolve) {
        if (_inited) { resolve(true); return; }
        if (!configOk() || !global.BookingsStore) { resolve(false); return; }
        fetchBookings(function (err, data) {
          if (!err && data !== null) applyRemoteData(data);
          _inited = true;
          global.BookingsStore.setOnBookingsPersistedLocal(function () {
            pushBookings(buildPayload());
          });
          startPolling();
          resolve(true);
        });
      });
    },
    stop: stopPolling
  };

})(typeof window !== 'undefined' ? window : this);
