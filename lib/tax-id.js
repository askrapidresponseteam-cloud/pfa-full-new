'use strict';

/* The PAN or Aadhaar card behind an 80G receipt (owner, 7 Nov 2026: "when
   someone is contributing 5k or more . make providing aadhar or pan upload
   mandatory for 80G receipt. give proper reason to people as well").

   Why PFA asks: the trust reports every 80G donation to the Income Tax
   Department in its yearly statement of donations, donor by donor, with the
   donor's PAN or Aadhaar number, and the donor's tax-deduction certificate
   is issued from that statement. A number with one wrong character is a
   certificate the donor cannot use. So on 5,000 rupees or more, in rupees,
   the donor gives the number and a photo of the card it is on, and PFA's
   accounts team checks one against the other before filing.

   Since 10 Nov 2026 it is given after paying, never before (owner: "make
   donating any amount easier. dont ask for uploading whatever before the
   payment. after payment send a link over email which asks to upload those
   in the page if one needs tax exempt receipt"). The receipt email links to
   tax-receipt.html; read() below checks what that page sends
   (lib/routes/payment/tax-receipt.js), and lib/routes/payment/tax-id.js
   keeps the photo until it is filed. THRESHOLD_INR and needed() stay for
   the panel's own notes; nothing refuses a payment by them.

   What travels where: the number and the photo stay with PFA. Neither is
   ever sent to CCAvenue. A PAN is printed on the receipt as before; an
   Aadhaar number is never shown in full anywhere but the panel (UIDAI's rule
   for anyone holding one): the receipt, the letters and the copy to PFA's
   inbox show only its last four digits. */

const RULES = require('../assets/field-rules.js');

const THRESHOLD_INR = 5000;
const TYPES = { pan: 'PAN card', aadhaar: 'Aadhaar card' };

function needed(amount, currency) {
  return String(currency || 'inr').toLowerCase() === 'inr' && Number(amount) >= THRESHOLD_INR;
}

function isToken(value) { return /^[a-f0-9]{48}$/.test(String(value || '')); }

function masked(type, number) {
  const n = String(number || '');
  if (!n) return '';
  return type === 'aadhaar' ? `XXXX XXXX ${n.slice(-4)}` : n;
}

/* The words a donor reads when it is missing, in the API's own error page
   (the page asks first, so this is for a form sent without its script). */
const WHY = 'For a contribution of ₹5,000 or more, PFA needs your PAN or Aadhaar card for the 80G receipt: the Income Tax Department issues your tax-deduction certificate only against one of them.';

function fail(message, field) {
  const error = new Error(message);
  error.field = field;
  return error;
}

/* The card given with a payment that needs one: { type, number, token }.
   Throws in plain words when anything is missing or wrong. */
function read(body) {
  const b = body || {};
  const type = String(b.idType || '').trim().toLowerCase();
  if (!TYPES[type]) throw fail(`${WHY} Choose PAN or Aadhaar.`, 'idType');
  const raw = type === 'pan' ? b.pan : b.aadhaar;
  if (!RULES.normaliseField(type, raw)) throw fail(`${WHY} Enter your ${type === 'pan' ? 'PAN' : 'Aadhaar number'}.`, type);
  const error = RULES.checkField(type, raw, { required: true });
  if (error) throw fail(error, type);
  const token = String(b.taxIdDoc || '').trim();
  if (!isToken(token)) throw fail(`${WHY} Attach a photo of your ${TYPES[type]}.`, 'taxIdDoc');
  return { type, number: RULES.normaliseField(type, raw), token };
}

module.exports = { THRESHOLD_INR, TYPES, WHY, needed, isToken, masked, read };
