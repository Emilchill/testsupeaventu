/**
 * bookings-store.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  Almacena las RESERVAS (asientos/cupos) y sus PAGOS.
 *  Mismo patrón que trips-store.js: localStorage + fallback en memoria,
 *  con hooks para sincronizar con Oracle Object Storage.
 *
 *  Un booking = { id, tripId, tripTitle, customerName, customerPhone,
 *                 customerEmail, seats, unitPrice, totalAmount,
 *                 status, paymentMethod, authCode, cardBrand, cardLast4,
 *                 createdAt }
 *
 *  status: 'paid' | 'cancelled'
 *  (Solo se crea el registro cuando el pago fue aprobado; no hay
 *   estado "pending" persistido porque el flujo de pago es síncrono.)
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {
  var STORAGE_KEY = 'sa_bookings_v1';
  var _memStore = {};

  function lsSet(key, value) {
    try { localStorage.setItem(key, encodeURIComponent(value)); return true; }
    catch (e) { _memStore[key] = value; return false; }
  }
  function lsGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null) return _memStore[key] || null;
      try { return decodeURIComponent(raw); } catch (e2) { return raw; }
    } catch (e) { return _memStore[key] || null; }
  }

  var onBookingsPersistedLocal = null;
  var _remoteWrite = false;

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function normalizeBooking(b) {
    if (!b || typeof b !== 'object') return null;
    var seats = parseInt(b.seats, 10);
    if (!isFinite(seats) || seats < 1) seats = 1;
    var unitPrice = Number(b.unitPrice);
    if (!isFinite(unitPrice) || unitPrice < 0) unitPrice = 0;
    var totalAmount = Number(b.totalAmount);
    if (!isFinite(totalAmount)) totalAmount = Math.round(unitPrice * seats * 100) / 100;
    var status = (b.status === 'cancelled') ? 'cancelled' : 'paid';
    return {
      id:             String(b.id || uuid()),
      tripId:         String(b.tripId || ''),
      tripTitle:      String(b.tripTitle || '').trim(),
      customerName:   String(b.customerName || '').trim(),
      customerPhone:  String(b.customerPhone || '').trim(),
      customerEmail:  String(b.customerEmail || '').trim(),
      seats:          seats,
      unitPrice:      Math.round(unitPrice * 100) / 100,
      totalAmount:    Math.round(totalAmount * 100) / 100,
      status:         status,
      paymentMethod:  String(b.paymentMethod || 'azul_demo'),
      authCode:       String(b.authCode || ''),
      cardBrand:      String(b.cardBrand || ''),
      cardLast4:      String(b.cardLast4 || ''),
      createdAt:      b.createdAt ? String(b.createdAt) : new Date().toISOString()
    };
  }

  function getBookings() {
    try {
      var s = lsGet(STORAGE_KEY);
      if (!s) return [];
      var j = JSON.parse(s);
      var arr = Array.isArray(j) ? j : (j && Array.isArray(j.bookings) ? j.bookings : []);
      return arr.map(normalizeBooking).filter(Boolean);
    } catch (e) {
      console.error('[getBookings] parse error:', e.message);
      return [];
    }
  }

  function persistList(list) {
    list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    try { lsSet(STORAGE_KEY, JSON.stringify(list)); } catch (e) {
      console.error('[persistBookingsList] error:', e.message);
    }
    return list;
  }

  function setBookings(bookings) {
    var list = persistList((bookings || []).map(normalizeBooking).filter(Boolean));
    if (!_remoteWrite && typeof onBookingsPersistedLocal === 'function') onBookingsPersistedLocal(list);
    notifyChanged();
    return list;
  }

  function setBookingsFromRemote(bookings) {
    _remoteWrite = true;
    try {
      var list = persistList((bookings || []).map(normalizeBooking).filter(Boolean));
      notifyChanged();
      return list;
    } finally { _remoteWrite = false; }
  }

  function notifyChanged() {
    try { if (global.dispatchEvent) global.dispatchEvent(new CustomEvent('sa-bookings-updated')); } catch (e) {}
  }

  /**
   * Guarda una nueva reserva pagada. Devuelve el objeto normalizado o
   * null si no hay cupo suficiente (chequeo atómico best-effort en cliente).
   */
  function createBooking(data, trip) {
    var all = getBookings();
    if (trip && Number(trip.capacity) > 0) {
      var already = seatsBooked(trip.id, all);
      var wanted = parseInt(data.seats, 10) || 1;
      if (already + wanted > Number(trip.capacity)) {
        return { error: 'SOLD_OUT', available: Math.max(0, Number(trip.capacity) - already) };
      }
    }
    var b = normalizeBooking(data);
    if (!b) return { error: 'INVALID' };
    all.push(b);
    setBookings(all);
    return { booking: b };
  }

  function cancelBooking(id) {
    var all = getBookings();
    var idx = all.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return null;
    all[idx].status = 'cancelled';
    setBookings(all);
    return all[idx];
  }

  function deleteBooking(id) {
    setBookings(getBookings().filter(function (x) { return x.id !== id; }));
  }

  /** Asientos ya confirmados (status=paid) para una salida dada */
  function seatsBooked(tripId, list) {
    var all = list || getBookings();
    return all.reduce(function (sum, b) {
      if (b.tripId === tripId && b.status === 'paid') return sum + b.seats;
      return sum;
    }, 0);
  }

  /** Cupos disponibles: null si la salida no tiene límite de cupos configurado */
  function seatsAvailable(trip) {
    var cap = Number(trip && trip.capacity) || 0;
    if (cap <= 0) return null;
    var used = seatsBooked(trip.id);
    return Math.max(0, cap - used);
  }

  function getBookingsByTrip(tripId) {
    return getBookings().filter(function (b) { return b.tripId === tripId; });
  }

  function totalRevenue(list) {
    var all = list || getBookings();
    return all.reduce(function (sum, b) { return b.status === 'paid' ? sum + b.totalAmount : sum; }, 0);
  }

  function formatMoney(n) {
    var x = Number(n); if (!isFinite(x)) x = 0;
    return x.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function setOnBookingsPersistedLocal(fn) { onBookingsPersistedLocal = typeof fn === 'function' ? fn : null; }

  function exportToJSON() {
    return JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), bookings: getBookings() }, null, 2);
  }

  global.BookingsStore = {
    STORAGE_KEY,
    uuid, normalizeBooking,
    getBookings, setBookings, setBookingsFromRemote, setOnBookingsPersistedLocal,
    createBooking, cancelBooking, deleteBooking,
    getBookingsByTrip, seatsBooked, seatsAvailable, totalRevenue,
    formatMoney, exportToJSON
  };
})(typeof window !== 'undefined' ? window : this);
