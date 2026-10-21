'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemberId, createPfaOrderId } = require('../lib/pfa-ccavenue-flow');
const { parsePaymentRequest, parseType } = require('../lib/payment');
const { amountMatches } = require('../lib/routes/payment/response')._private;

const customer = { name: 'Asha Kumar', mobile: '9876543210', email: 'asha@example.com' };


test('donation is parsed with server-validated amount and donor metadata', () => {
  const parsed = parsePaymentRequest({
    type: 'donate', amount: '365', ...customer, address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', cause: 'Hospitals', terms: 'yes'
  });
  assert.equal(parsed.type, 'donate');
  assert.equal(parsed.amount, '365.00');
  assert.equal(parsed.metadata.cause, 'Hospitals');
  assert.equal(parsed.merchantValues.merchant_param3, 'donate');
});

test('the PAN a donor gives for their 80G certificate reaches the receipt', () => {
  /* It was typed, checked in the page, posted, and dropped: parseDonation
     never read it, so payment/response.js put an empty PAN on every receipt
     and the "including for your 80G certificate" line never appeared. */
  const parsed = parsePaymentRequest({
    type: 'donate', amount: '365', ...customer, address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes', pan: 'abcde1234f'
  });
  assert.equal(parsed.customer.pan, 'ABCDE1234F', 'the PAN is kept, upper case, as it is printed');
  assert.equal(Object.keys(parsed.merchantValues).some((k) => /pan/i.test(k)), false,
    'a donor tax number has no business going to CCAvenue');

  assert.throws(
    () => parsePaymentRequest({ type: 'donate', amount: '365', ...customer, address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes', pan: 'NOTAPAN' }),
    /five letters, four digits/
  );

  /* Optional: leaving it blank is not an error. */
  const without = parsePaymentRequest({ type: 'donate', amount: '365', ...customer, address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes' });
  assert.equal(without.customer.pan, '');
});



test('Store is rejected by the CCAvenue payment endpoint', () => {
  assert.throws(() => parseType({ type: 'store' }), /Store purchases remain separate/);
});

test('callback amount comparison uses paise precision', () => {
  assert.equal(amountMatches({ amount: 365 }, '365.00'), true);
  assert.equal(amountMatches({ amount: 365 }, '364.99'), false);
});

test('USD donation is parsed with USD-scale amount bounds', () => {
  const parsed = parsePaymentRequest({
    type: 'donate', currency: 'usd', amount: '25', ...customer, address: '221 Baker St', cause: 'Hospitals', terms: 'yes'
  });
  assert.equal(parsed.currency, 'usd');
  assert.equal(parsed.amount, '25.00');
  assert.equal(parsed.merchantValues.currency, 'USD');
  assert.throws(
    () => parsePaymentRequest({ type: 'donate', currency: 'usd', amount: '10000000', ...customer, address: '221 Baker St', terms: 'yes' }),
    /between \$1 and \$100,000/
  );
});



test('omitting currency still defaults every flow to INR, unchanged from before', () => {
  const donate = parsePaymentRequest({ type: 'donate', amount: '365', ...customer, address: '16 MG Road, Udupi', city: 'Udupi', state: 'Karnataka', pincode: '576101', terms: 'yes' });
  assert.equal(donate.currency, 'inr');
  assert.equal(donate.merchantValues.currency, 'INR');
});
