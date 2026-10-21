'use strict';

/* Ordering the printed card.

   This endpoint owns the whole money path: it proves the caller holds the card,
   resolves the delivery address server-side, fixes the price server-side,
   writes the order, and hands off to CCAvenue. The browser never carries an
   amount or an address into the payment form, so neither can be tampered with. */

const { cleanText, getBaseUrl, readRequestBody, setSecurityHeaders } = require('../../../lib/ccavenue');
const { createTransaction } = require('../../../lib/firebase');
const { getCredentials, isConfigurationError, renderError, renderTransfer } = require('../../../lib/pfa-ccavenue-flow');
const CAREGIVER = require('../../../lib/caregiver');
const store = require('../../../lib/caregiver-store');

module.exports = async function handler(request, response) {
  setSecurityHeaders(response);

  let baseUrl = '';
  try { baseUrl = getBaseUrl(request); } catch (_) { baseUrl = ''; }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return renderError(response, 405, 'Order not accepted', 'Start from your Colony Caregiver Card page.', '/caregiver-card.html', 'Return to PFA');
  }

  try {
    const body = await readRequestBody(request);
    const cardId = CAREGIVER.clean(body.cardId, 60).toUpperCase();
    const cardToken = CAREGIVER.clean(body.cardToken, 200);

    if (!CAREGIVER.CARD_ID_PATTERN.test(cardId)) throw new Error('That card number is not valid.');

    const card = await store.authoriseCard(cardId, cardToken);
    if (!card) {
      return renderError(response, 403, 'This card could not be confirmed',
        'Open your card from the link you were given and order the printed copy from there.',
        '/caregiver-card.html', 'Return to PFA');
    }

    if (card.printed) {
      return renderError(response, 409, 'A printed card is already on its way',
        'This card already has a printed copy ordered. Check its delivery status on your card page.',
        `/caregiver-card.html?id=${encodeURIComponent(cardId)}`, 'Open your card');
    }

    const delivery = CAREGIVER.parseDeliveryChoice(body);
    const minted = CAREGIVER.createOrderId();

    // The amount is a server constant. Nothing from the browser reaches it.
    const amount = CAREGIVER.SHIPPING_PRICE;

    /* The shared transactions collection is what the CCAvenue callback verifies
       against, so the order is mirrored there in the shape that flow expects.
       A second attempt under the same clientRef gets the first attempt's
       transaction back, and CCAvenue must be sent THAT order id: the one
       minted here was never recorded, and a payment for it was refused on
       the way back (8 Oct 2026, review D8; create.js always did this). The
       delivery choice is part of the request, so changing it is a new
       transaction rather than the old one with stale details. */
    const transaction = await createTransaction({
      orderId: minted,
      type: 'caregiver',
      amount,
      currency: 'inr',
      idempotencyKey: CAREGIVER.clean(body.clientRef, 200) || minted,
      data: {
        customer: { name: card.name, mobile: card.mobile, email: card.email },
        metadata: { cardId, kind: 'caregiver-shipping', delivery }
      }
    });
    const orderId = cleanText(transaction.orderId || minted, 80);
    if (transaction.status === 'success') {
      return renderError(response, 409, 'This order is already paid',
        'This printed card has already been paid for. Check its delivery status on your card page.',
        `/caregiver-card.html?id=${encodeURIComponent(cardId)}`, 'Open your card');
    }
    /* The parcel record under the same id; written by the first attempt, or
       now if that attempt stopped before writing it. */
    if (orderId === minted || !(await store.getOrder(orderId))) {
      await store.createShippingOrder({ card, delivery, orderId, amount });
    }

    const { merchantId } = getCredentials('inr');
    const deliveryAddress = delivery.sameAsCardAddress ? card.address : delivery.address;
    const deliveryPin = delivery.sameAsCardAddress ? card.pin : delivery.pin;

    return renderTransfer(response, {
      merchant_id: merchantId,
      order_id: orderId,
      amount,
      currency: 'INR',
      language: 'EN',
      redirect_url: `${baseUrl}/api/payment/response`,
      cancel_url: `${baseUrl}/api/payment/response`,
      billing_name: delivery.sameAsCardAddress ? card.name : (delivery.recipient || card.name),
      billing_tel: card.mobile,
      billing_email: card.email,
      billing_address: cleanText(deliveryAddress, 150),
      /* the holder's own address carries its district and state, so
         CCAvenue's page arrives filled in; a parcel sent elsewhere has only
         the address and PIN given for it (21 Oct 2026) */
      ...require('../../payment').billingPlace(delivery.sameAsCardAddress
        ? { city: card.district, state: card.state, pin: deliveryPin }
        : { pin: deliveryPin }),
      merchant_param1: 'PFA Colony Caregiver Card',
      merchant_param2: 'Printed card shipping',
      merchant_param3: 'caregiver',
      merchant_param4: cardId
    }, {
      currency: 'inr',
      returnUrl: '/caregiver-card.html',
      title: 'Opening secure payment',
      message: `You are being transferred to CCAvenue for the ₹${amount} shipping charge.`
    });
  } catch (error) {
    const message = CAREGIVER.clean(error && error.message, 300);
    if (isConfigurationError(message)) {
      console.error('PFA caregiver order configuration error:', message);
      return renderError(response, 500, 'Payments are not configured yet',
        'The secure payment service needs to be configured before printed cards can be ordered.',
        '/caregiver-card.html', 'Return to PFA');
    }
    return renderError(response, 400, 'Please check the delivery details', message, '/caregiver-card.html', 'Return to PFA');
  }
};
