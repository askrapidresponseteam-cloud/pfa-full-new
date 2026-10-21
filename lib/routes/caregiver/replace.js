'use strict';

/* Lost printed card.

   Orders a replacement PARCEL against an existing card. It cannot issue a card,
   cannot change a card number and cannot extend validity - a caregiver whose
   number is written into a colony register or quoted to a police officer keeps
   the number they have. */

const { cleanText, getBaseUrl, readRequestBody, setSecurityHeaders } = require('../../../lib/ccavenue');
const { createTransaction } = require('../../../lib/firebase');
const { getCredentials, isConfigurationError, renderError, renderTransfer } = require('../../../lib/pfa-ccavenue-flow');
const CAREGIVER = require('../../../lib/caregiver');
const RULES = require('../../../assets/field-rules.js');
const store = require('../../../lib/caregiver-store');

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
  setSecurityHeaders(response);

  let baseUrl = '';
  try { baseUrl = getBaseUrl(request); } catch (_) { baseUrl = ''; }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Replacements are ordered with POST.' });
  }

  let body;
  try {
    body = await readRequestBody(request);
  } catch (_) {
    return sendJson(response, 400, { code: 'BAD_BODY', message: 'That request could not be read.' });
  }

  const cardId = RULES.normaliseField('cardId', body.cardId);
  const mobile = RULES.normaliseMobile(body.mobile);
  const stage = CAREGIVER.clean(body.stage, 20) || 'verify';

  if (!CAREGIVER.CARD_ID_PATTERN.test(cardId)) {
    return sendJson(response, 400, { code: 'INVALID_ID', message: 'Enter the card number in the form PFA-CCT-XXXXXXXX.' });
  }
  if (RULES.checkField('mobile', mobile, { required: true })) {
    return sendJson(response, 400, { code: 'INVALID_MOBILE', message: 'Enter the 10-digit mobile number the card was issued against.' });
  }

  let claim;
  try {
    claim = await store.verifyCardClaim({ cardId, mobile });
  } catch (error) {
    console.error('PFA replacement lookup error:', CAREGIVER.clean(error && error.message, 240));
    return sendJson(response, 503, { code: 'LOOKUP_UNAVAILABLE', message: 'That card could not be checked right now.' });
  }

  if (!claim.ok) {
    /* One message for "no such card" and for "wrong number", so this endpoint
       cannot be used to discover which card numbers exist. */
    const message = claim.reason === 'revoked'
      ? 'This card has been withdrawn. Contact your local PFA unit.'
      : 'That card number and mobile number do not match our records.';
    return sendJson(response, claim.reason === 'revoked' ? 409 : 404, { code: 'CLAIM_FAILED', message });
  }

  const card = claim.card;

  // Stage one: confirm the card exists and show the applicant what they hold.
  if (stage === 'verify') {
    return sendJson(response, 200, {
      cardId: card.cardId,
      name: card.name,
      address: card.address,
      issuedAt: card.issuedAt,
      validUntil: card.validUntil,
      shippingPrice: CAREGIVER.SHIPPING_PRICE
    });
  }

  // Stage two: take payment for a replacement parcel.
  try {
    const delivery = CAREGIVER.parseDeliveryChoice(body);
    const minted = CAREGIVER.createOrderId();
    const reason = CAREGIVER.clean(body.reason, 120) || 'lost';

    /* The transaction first, and CCAvenue is sent the order id it returns: a
       second attempt under the same clientRef gets the first attempt's
       transaction, and the id minted here was never recorded, so a payment
       for it was refused on the way back (8 Oct 2026, review D8). */
    const transaction = await createTransaction({
      orderId: minted,
      type: 'caregiver',
      amount: CAREGIVER.SHIPPING_PRICE,
      currency: 'inr',
      idempotencyKey: CAREGIVER.clean(body.clientRef, 200) || minted,
      data: {
        customer: { name: card.name, mobile: card.mobile, email: card.email },
        metadata: { cardId, kind: 'caregiver-replacement', delivery, reason }
      }
    });
    const orderId = cleanText(transaction.orderId || minted, 80);
    if (transaction.status === 'success') {
      return renderError(response, 409, 'This replacement is already paid',
        'This replacement card has already been paid for. Check its delivery status on your card page.',
        '/caregiver-card.html', 'Return to PFA');
    }
    if (orderId === minted || !(await store.getOrder(orderId))) {
      await store.createReplacementOrder({ card, delivery, orderId, amount: CAREGIVER.SHIPPING_PRICE, reason });
    }

    const { merchantId } = getCredentials('inr');
    const address = delivery.sameAsCardAddress ? card.address : delivery.address;
    const pin = delivery.sameAsCardAddress ? card.pin : delivery.pin;

    return renderTransfer(response, {
      merchant_id: merchantId,
      order_id: orderId,
      amount: CAREGIVER.SHIPPING_PRICE,
      currency: 'INR',
      language: 'EN',
      redirect_url: `${baseUrl}/api/payment/response`,
      cancel_url: `${baseUrl}/api/payment/response`,
      billing_name: delivery.sameAsCardAddress ? card.name : (delivery.recipient || card.name),
      billing_tel: card.mobile,
      billing_email: card.email,
      billing_address: cleanText(address, 150),
      /* as for a first printed card (order.js): the holder's own address
         fills city and state on CCAvenue's page */
      ...require('../../payment').billingPlace(delivery.sameAsCardAddress
        ? { city: card.district, state: card.state, pin }
        : { pin }),
      merchant_param1: 'PFA Colony Caregiver Card',
      merchant_param2: 'Replacement card shipping',
      merchant_param3: 'caregiver',
      merchant_param4: cardId
    }, {
      currency: 'inr',
      returnUrl: '/caregiver-card.html',
      title: 'Opening secure payment',
      message: `You are being transferred to CCAvenue for the ₹${CAREGIVER.SHIPPING_PRICE} replacement charge.`
    });
  } catch (error) {
    const message = CAREGIVER.clean(error && error.message, 300);
    if (isConfigurationError(message)) {
      console.error('PFA replacement configuration error:', message);
      return renderError(response, 500, 'Payments are not configured yet',
        'The secure payment service needs to be configured first.', '/get-involved.html#caregiver', 'Return to PFA');
    }
    return renderError(response, 400, 'Please check the delivery details', message, '/get-involved.html#caregiver', 'Return to PFA');
  }
};
