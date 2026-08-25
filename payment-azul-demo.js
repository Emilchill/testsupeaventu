/**
 * payment-azul-demo.js  v1.0
 * ─────────────────────────────────────────────────────────────────
 *  ⚠️  MODO DEMO — SIMULADOR DE PAGO AZUL / CARDNET  ⚠️
 *
 *  Este sitio es 100% estático (GitHub Pages). El procesador real de
 *  Azul (Banco Popular) / CardNet requiere que el comercio llame a su
 *  Webservice desde un SERVIDOR, autenticado con un certificado
 *  digital (.pem) que Azul entrega al aprobar la cuenta de comercio.
 *  Eso NO puede hacerse desde JavaScript en el navegador (el
 *  certificado quedaría expuesto a cualquier visitante).
 *
 *  Este módulo por lo tanto:
 *   1. Valida los datos de la tarjeta en el navegador (Luhn, fecha,
 *      CVV) exactamente como lo haría un formulario real.
 *   2. Simula la llamada al Webservice de Azul con una demora de red
 *      y genera un número de autorización con el mismo formato que
 *      Azul retorna (6 dígitos).
 *   3. Deja claramente marcado con __DEMO__ que esta transacción NO
 *      es un cobro real.
 *
 *  ── Para activar pagos REALES cuando tengas tu cuenta de Azul ──
 *  1. Crea un pequeño backend (Node/PHP/etc.) que reciba los datos de
 *     la tarjeta por HTTPS y llame al Webservice de Azul usando el
 *     certificado .pem que te entregó tu banco.
 *  2. Reemplaza la función `processPayment()` de este archivo por una
 *     llamada `fetch('https://TU-BACKEND/api/pagar', {...})` a ese
 *     servidor.
 *   3. Nunca envíes el número completo de tarjeta a un servidor que
 *      no sea PCI-DSS compliant; usa una pasarela certificada.
 * ─────────────────────────────────────────────────────────────────
 */
(function (global) {

  var IS_DEMO = true; // Cambia a false solo si conectaste un backend real

  /* ── Validaciones de tarjeta ─────────────────────────────────── */

  function luhnCheck(num) {
    var digits = String(num).replace(/\D/g, '');
    if (digits.length < 12) return false;
    var sum = 0, alt = false;
    for (var i = digits.length - 1; i >= 0; i--) {
      var n = parseInt(digits.charAt(i), 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function detectBrand(num) {
    var d = String(num).replace(/\D/g, '');
    if (/^4/.test(d)) return 'Visa';
    if (/^5[1-5]/.test(d) || /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(d)) return 'Mastercard';
    if (/^3[47]/.test(d)) return 'American Express';
    if (/^6(011|5)/.test(d)) return 'Discover';
    return 'Tarjeta';
  }

  function validateExpiry(mm, yy) {
    var m = parseInt(mm, 10), y = parseInt(yy, 10);
    if (!m || m < 1 || m > 12) return false;
    if (!y) return false;
    if (y < 100) y += 2000;
    var now = new Date();
    var expDate = new Date(y, m, 0, 23, 59, 59);
    return expDate >= now;
  }

  function validateCard(card) {
    var errors = {};
    var number = String(card.number || '').replace(/\s+/g, '');
    if (!luhnCheck(number)) errors.number = 'Número de tarjeta inválido';
    if (!validateExpiry(card.expMonth, card.expYear)) errors.expiry = 'Fecha de vencimiento inválida o vencida';
    var cvv = String(card.cvv || '').replace(/\D/g, '');
    if (cvv.length < 3 || cvv.length > 4) errors.cvv = 'CVV inválido';
    if (!card.holder || String(card.holder).trim().length < 3) errors.holder = 'Nombre del titular requerido';
    return { valid: Object.keys(errors).length === 0, errors: errors, brand: detectBrand(number) };
  }

  /* ── Simulación de autorización Azul ─────────────────────────── */

  function genAuthCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  /**
   * Procesa el pago (DEMO). Retorna una Promise que resuelve con:
   *   { approved, authCode, brand, last4, demo, message }
   * o rechaza con { approved:false, message }
   */
  function processPayment(card, amount, meta) {
    return new Promise(function (resolve, reject) {
      var validation = validateCard(card);
      if (!validation.valid) {
        reject({ approved: false, message: 'Datos de tarjeta inválidos', errors: validation.errors });
        return;
      }
      var number = String(card.number).replace(/\s+/g, '');
      var last4 = number.slice(-4);

      // Simula latencia de red hacia el Webservice de Azul (1-2s)
      setTimeout(function () {
        // En modo demo, rechazamos explícitamente tarjetas que terminen en 0000
        // para poder probar el flujo de error; el resto se aprueba.
        var declined = /0000$/.test(number);
        if (declined) {
          reject({ approved: false, demo: IS_DEMO, message: 'Transacción declinada por el emisor (DEMO)' });
          return;
        }
        resolve({
          approved: true,
          demo: IS_DEMO,
          authCode: genAuthCode(),
          brand: validation.brand,
          last4: last4,
          amount: amount,
          message: IS_DEMO
            ? 'Pago simulado aprobado (modo demo — no es un cobro real)'
            : 'Pago aprobado'
        });
      }, 1200 + Math.random() * 800);
    });
  }

  global.AzulPaymentDemo = {
    IS_DEMO: IS_DEMO,
    luhnCheck: luhnCheck,
    detectBrand: detectBrand,
    validateCard: validateCard,
    processPayment: processPayment
  };

})(typeof window !== 'undefined' ? window : this);
