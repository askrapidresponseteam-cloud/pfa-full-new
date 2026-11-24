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
const { parsePaymentRequest, standingInstruction } = require('../../../lib/payment');
const VISIBILITY = require('../../../lib/site-visibility');

/* Monthly giving is taken only while the panel has it on (donate#monthly).
   A page open from before it was switched off, or a hand-made request,
   is refused here rather than charged once as if it were monthly. */
async function monthlyOpen(deps) {
  const read = (deps && deps.publicState) || VISIBILITY.publicState;
  const state = await read();
  return Boolean(state && state.choices && state.choices['donate#monthly'] === 'on');
}

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
      ? 'Payments cannot be taken on this page just now. Please try again later, or write to info@peopleforanimalsindia.org and we will help you give.'
      : message,
    '/donate.html',
    'Return to PFA'
  );
}

async function handler(request, response) {
  setSecurityHeaders(response);
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return renderError(response, 405, 'Payment request not accepted', 'Start from the PFA Donate or Give/Send page.', '/donate.html', 'Return to PFA');
  }

  try {
    const body = await readRequestBody(request);
    const parsed = parsePaymentRequest(body);
    if (parsed.recurring && !(await monthlyOpen(handler.deps))) {
      throw new Error('Monthly donations are not open just now. You can give once instead, from the same page.');
    }
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
      merchant_param5: actualOrderId,
      ...(parsed.recurring ? standingInstruction({ amount: parsed.amount, orderId: actualOrderId }) : {})
    };


    const titles = {
      donate: parsed.recurring ? 'Opening secure monthly donation' : 'Opening secure donation payment',
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

module.exports = handler;
module.exports._private = { idempotencyKey, monthlyOpen };
