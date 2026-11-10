'use strict';

const {
  cleanText,
  getBaseUrl,
  readRequestBody,
  setSecurityHeaders
} = require('../../../lib/ccavenue');
const {
  createPfaOrderId,
  getCredentials,
  isConfigurationError,
  renderError,
  renderTransfer
} = require('../../../lib/pfa-ccavenue-flow');
const { createTransaction } = require('../../../lib/firebase');
const { parsePaymentRequest } = require('../../../lib/payment');

function idempotencyKey(request, body) {
  const headers = request.headers || {};
  return cleanText(
    headers['idempotency-key'] || headers['x-idempotency-key'] || body.client_ref || '',
    200
  );
}

function errorPage(response, error) {
  const message = cleanText(error && error.message ? error.message : 'Payment could not be started.', 300);
  const configurationError = isConfigurationError(message)
    || message.startsWith('Missing Firebase environment variables')
    || message.includes('firebase-admin');
  if (configurationError) console.error('PFA payment configuration error:', message);
  return renderError(
    response,
    configurationError ? 500 : 400,
    configurationError ? 'Payments are not configured yet' : 'Please check your payment details',
    configurationError
      ? 'The secure payment service needs to be configured in Vercel before payments can be accepted.'
      : message,
    '/donate.html',
    'Return to PFA'
  );
}

module.exports = async function handler(request, response) {
  setSecurityHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return renderError(response, 405, 'Payment request not accepted', 'Start from the PFA Donate or Give/Send page.', '/donate.html', 'Return to PFA');
  }

  try {
    const body = await readRequestBody(request);
    const parsed = parsePaymentRequest(body);
    const { merchantId } = getCredentials(parsed.currency);
    const orderId = createPfaOrderId(parsed.type);
    const baseUrl = getBaseUrl(request);
    const callbackUrl = parsed.currency === 'usd'
      ? `${baseUrl}/api/payment/response?cur=usd`
      : `${baseUrl}/api/payment/response`;
    const key = idempotencyKey(request, body);

    const transaction = await createTransaction({
      orderId,
      type: parsed.type,
      amount: parsed.amount,
      currency: parsed.currency,
      idempotencyKey: key,
      data: {
        customer: parsed.customer,
        metadata: parsed.metadata
      }
    });

    const actualOrderId = cleanText(transaction.orderId || orderId, 80);
    const transactionCurrency = String(transaction.currency || 'inr').toLowerCase();
    if (
      transaction.type !== parsed.type
      || transactionCurrency !== parsed.currency
      || Math.round(Number(transaction.amount) * 100) !== Math.round(Number(parsed.amount) * 100)
    ) {
      return renderError(response, 409, 'Payment request conflict', 'This payment request key is already tied to a different PFA transaction.', '/donate.html', 'Return to PFA');
    }
    if (transaction.status === 'success') {
      return renderError(response, 409, 'Payment already completed', 'This request has already been completed. Check your PFA records before trying again.', '/index.html', 'Return to PFA');
    }

    const merchantValues = {
      ...parsed.merchantValues,
      merchant_id: merchantId,
      order_id: actualOrderId,
      amount: parsed.amount,
      redirect_url: callbackUrl,
      cancel_url: callbackUrl,
      merchant_param5: actualOrderId
    };


    const titles = {
      donate: 'Opening secure donation payment',
      'caregiver-application': 'Opening secure application payment',
      membership: 'Opening secure membership payment'
    };
    const returns = {
      donate: '/donate.html',
      'caregiver-application': '/get-involved.html'
    };
    return renderTransfer(response, merchantValues, {
      title: titles[parsed.type],
      message: 'You are being transferred to CCAvenue. PFA does not receive or store your card, bank or UPI credentials.',
      currency: parsed.currency,
      returnUrl: returns[parsed.type] || '/'
    });
  } catch (error) {
    return errorPage(response, error);
  }
};

module.exports._private = { idempotencyKey };
