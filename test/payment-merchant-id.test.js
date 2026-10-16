'use strict';

/* The merchant check, and the day it refused money the bank had taken.

   13 Oct 2026. A Colony caregiver application was paid: CCAvenue took Rs 50,
   answered "Success", and gave a tracking id and a bank reference. The site
   refused it. The page said "Payment was not completed" while printing
   CCAvenue's own word, "Success", in its status row four lines below, because
   that row prints the raw answer whenever the site has decided otherwise. The
   application was never filed, no number was issued, no receipt went out, and
   the applicant was left having paid for nothing.

   The cause was one line:

     const merchantMatches = Boolean(data.merchant_id) && cleanText(...) === merchantId;

   It demanded that CCAvenue return merchant_id. CCAvenue's own API guide lists
   the field in no response table and identifies the merchant by access_code:
   it is sent with the request, not reliably returned. So verification failed
   on every real payment.

   The whole suite passed throughout. Every payment fixture in it hand-builds a
   response containing merchant_id: '123456', a field the gateway does not
   send, so the fixtures were more generous than the gateway and the tests
   agreed with each other instead of with reality. These tests use the shape
   CCAvenue actually returns, and keep the one check that was worth having. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { merchantAccepted } = require('../lib/ccavenue');
const payment = require('../lib/routes/payment/response');
const shop = require('../lib/routes/shop/response');

const MERCHANT = '123456';

test('an answer that names no merchant is accepted', () => {
  /* The working key already proved who sent it: the response is encrypted
     with a key only CCAvenue and this server hold, and the order id has to
     name a transaction this site started. Demanding a field the gateway does
     not send adds nothing to that and costs the payment. */
  for (const absent of [undefined, null, '', '   ']) {
    assert.equal(merchantAccepted(absent, MERCHANT), true, `${JSON.stringify(absent)} must not refuse a paid transaction`);
  }
});

test('an answer that names a different merchant is still refused', () => {
  assert.equal(merchantAccepted('999999', MERCHANT), false);
  assert.equal(merchantAccepted('12345', MERCHANT), false, 'a prefix is not a match');
  assert.equal(merchantAccepted('1234567', MERCHANT), false, 'nor is a longer id that starts the same');
});

test('an answer that names this merchant is accepted', () => {
  assert.equal(merchantAccepted(MERCHANT, MERCHANT), true);
  assert.equal(merchantAccepted(` ${MERCHANT} `, MERCHANT), true, 'whitespace from the gateway is not a mismatch');
});

test('a long merchant id can match itself', () => {
  /* The two sides were cleaned to different lengths, 40 for the answer and 30
     for the configured id, so an id of 31 characters or more could never have
     equalled itself even when CCAvenue did return it. */
  const long = '1234567890123456789012345678901234';
  assert.equal(long.length > 30, true, 'the id has to be longer than the old limit for this to prove anything');
  assert.equal(merchantAccepted(long, long), true);
});

test('the payment route and the shop route use the same rule', () => {
  assert.equal(payment._private.merchantAccepted, merchantAccepted,
    'the payment callback shares the rule');
  const shopSrc = require('node:fs').readFileSync(require.resolve('../lib/routes/shop/response.js'), 'utf8');
  assert.match(shopSrc, /merchantAccepted\(data\.merchant_id, merchantId\)/,
    'the shop callback had the identical bug and must share the fix');
  assert.ok(!/Boolean\(data\.merchant_id\)/.test(shopSrc),
    'nothing may still demand that CCAvenue return the field');
});

test('nothing in the payment callback demands the field any more', () => {
  const src = require('node:fs').readFileSync(require.resolve('../lib/routes/payment/response.js'), 'utf8');
  assert.ok(!/Boolean\(data\.merchant_id\)/.test(src),
    'the line that refused a paid caregiver application on 13 Oct 2026');
});

test('a successful answer still has to match on amount and currency', () => {
  /* The merchant check is the one that was wrong. The two that actually
     protect the money are untouched, and this says so out loud, because
     "accept an absent merchant id" would be a bad change if it had quietly
     taken the others with it. */
  const { amountMatches } = payment._private;
  assert.equal(amountMatches({ amount: 50 }, '50.00'), true);
  assert.equal(amountMatches({ amount: 50 }, '5.00'), false, 'a tenth of the amount is not the amount');
  assert.equal(amountMatches({ amount: 50 }, '500.00'), false);
  assert.equal(amountMatches({ amount: 50 }, ''), false, 'and no amount at all is not a match');

  const src = require('node:fs').readFileSync(require.resolve('../lib/routes/payment/response.js'), 'utf8');
  assert.match(src, /const verified = merchantMatches && amountMatchesResult && currencyMatches && successResult;/,
    'all four still have to hold before a payment is filed');
});

test('a successful answer that is refused says which check refused it', () => {
  /* The page could not say, and neither could the log: merchant_id was the
     field that decided it and the only field logAnswer did not print. */
  const src = require('node:fs').readFileSync(require.resolve('../lib/routes/payment/response.js'), 'utf8');
  assert.match(src, /PFA payment refused a successful CCAvenue answer/);
  assert.match(src, /not returned by CCAvenue/, 'an absent merchant id must be named as such, not left blank');
  assert.match(src, /different merchant/);
});

test('the shop keeps an order paid when CCAvenue returns no merchant id', () => {
  const { outcome } = shop._private;
  const order = { total: 499 };
  const cb = { status: 'success', amount: '499.00' };
  assert.equal(outcome(order, {}, MERCHANT, cb), 'paid',
    'the customer paid, the stock was held, and the order must not be left unverified');
  assert.equal(outcome(order, { merchant_id: MERCHANT }, MERCHANT, cb), 'paid');
  assert.equal(outcome(order, { merchant_id: '999999' }, MERCHANT, cb), 'verification_failed',
    'another merchant is still refused');
  assert.equal(outcome(order, {}, MERCHANT, { status: 'success', amount: '1.00' }), 'verification_failed',
    'and the amount still has to match');
});

test('a payment refused this way is visible in the panel', () => {
  /* It was not. listPending showed 'initiated' and 'pending' only, so a
     transaction left at 'verification_failed' had no row, and therefore no
     Check button, and therefore no way to be settled from the panel at all:
     the one state that always needs a person was the one state nobody could
     see. The repair itself always worked, because the status check fills
     merchant_id in from config before calling settle(). */
  const src = require('node:fs').readFileSync(require.resolve('../lib/routes/admin/payments-pending.js'), 'utf8');
  assert.match(src, /\['initiated', 'pending', 'verification_failed'\]\.includes/,
    'a refused payment belongs in the pending list');
  assert.match(src, /row\.status === 'verification_failed' \|\| !row\.startedMs/,
    'and shows at once, not after the half hour a live checkout is given');
});
