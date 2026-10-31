'use strict';

/* GET /api/payment/receipt?order=PFA-DON-XXXXXXXX&k=<key>

   The donor's receipt, as a PDF (lib/donation-receipt.js). Linked from the
   thank-you page the bank's confirmation opens, and from the receipt email.

   Only for a donation the bank confirmed (status success, settled by
   lib/routes/payment/response.js), and only with the random key kept on
   that transaction: a receipt carries a PAN and an address, so the order
   number alone, which is printed in emails and quoted to PFA, opens
   nothing. Every refusal reads the same, so the answer says nothing about
   which orders exist. */

const { getTransaction } = require('../../firebase');
const { setSecurityHeaders } = require('../../ccavenue');
const RECEIPT = require('../../donation-receipt');

const ORDER = /^PFA-DON-[A-Z0-9]{8}$/;

function refuse(response, status, message) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

function createHandler(deps) {
  const d = deps || {};
  const load = d.getTransaction || getTransaction;
  return async function handler(request, response) {
    setSecurityHeaders(response);
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return refuse(response, 405, 'Method not allowed.');
    }
    const url = new URL(request.url || '/', 'https://pfa.invalid');
    const query = request.query || {};
    const order = String(query.order || url.searchParams.get('order') || '').trim().toUpperCase();
    const key = String(query.k || url.searchParams.get('k') || '').trim();
    const nope = 'This receipt link is not valid. Use the link on your thank-you page or in the receipt email, or write to PFA quoting your PFA transaction ID.';
    if (!ORDER.test(order) || !RECEIPT.KEY.test(key)) return refuse(response, 404, nope);
    try {
      const transaction = await load(order);
      if (!transaction || transaction.type !== 'donate' || transaction.status !== 'success' || !RECEIPT.keyMatches(transaction.receiptKey, key)) {
        return refuse(response, 404, nope);
      }
      const body = RECEIPT.pdf({ orderId: order, ...transaction });
      response.statusCode = 200;
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Disposition', `attachment; filename="${RECEIPT.fileName({ orderId: order, ...transaction })}"`);
      response.setHeader('Content-Length', String(body.length));
      return response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error('PFA donation receipt failed', { order, message: String((error && error.message) || error).slice(0, 200) });
      return refuse(response, 500, 'The receipt could not be made just now. Try the link again in a minute.');
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
