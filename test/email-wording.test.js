'use strict';

/* Every email the site sends, rendered with what the routes really pass it,
   and read the way a person reads it.

   Owner, 21 Oct 2026, of a donation receipt headed "Your gift is in.": "for
   donation. why does it show gift.. update the template. and check all the
   templates and ensure that they are perfect." Each template below is
   rendered and its subject, HTML and text checked for what would make it
   imperfect: a value that did not arrive printed as "undefined", "null" or
   "NaN"; a long dash; a donation called a gift, or a gift not called one; a
   full name where the greeting uses the first; a sign-off on a copy that goes
   to PFA's own inbox; or an empty subject or text part. */

const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../lib/caregiver-mail');

const site = 'https://peopleforanimalsindia.org';
const base = { siteUrl: site, threadId: 'abc123def456' };
const SHOP_ITEM = { id: '23', name: 'Sabyasachi x PFA', size: 'L', qty: 1, price: 2500, lineTotal: 2500 };
const DELIVERY = { name: 'Asha Rao', address: 'Flat 4, FC Road', city: 'Pune', district: 'Pune', state: 'Maharashtra', zip: '411004' };

/* to the person (signed off) or to PFA (not) */
const CASES = {
  'a donation': ['payment_received', 'person', { ...base, name: 'Karthik Dhanya', amount: '111', currency: 'INR', orderId: 'PFA-DON-MPTSVLDF', reference: 'PFA-DON-MPTSVLDF', paidAt: '2026-10-21T09:10:00Z', cause: 'Where it is needed most', bankReference: 'BNK900' }],
  'a donation with a PAN': ['payment_received', 'person', { ...base, name: 'Karthik Dhanya', amount: '5000', currency: 'INR', orderId: 'PFA-DON-AAAA1111', paidAt: '2026-10-21T09:10:00Z', cause: 'Hospitals', pan: 'ABCDE1234F', bankReference: 'BNK1' }],
  'a dollar donation': ['payment_received', 'person', { ...base, name: 'Karthik Dhanya', amount: '25', currency: 'USD', orderId: 'PFA-DON-USD11111', paidAt: '2026-10-21T09:10:00Z', cause: 'Rescue' }],
  'a gift': ['payment_received', 'person', { ...base, name: 'Karthik Dhanya', amount: '2500', currency: 'INR', orderId: 'PFA-DON-GIFT2222', paidAt: '2026-10-21T09:10:00Z', cause: 'Rescue', giftTo: 'Ravi Kumar', giftAddress: '12 MG Road, Bengaluru, 560038', bankReference: 'BNK2' }],
  'a membership with no kit': ['membership_welcome', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00004', reference: 'PFA-MEM-2026-00004', tierLabel: 'Student membership', amount: '500', kit: [], paidAt: '2026-10-21T09:10:00Z', orderId: 'PFA-MEM-XYZ11111' }],
  'a membership with a kit': ['membership_welcome', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', reference: 'PFA-MEM-2026-00005', tierLabel: 'Platinum membership', amount: '5000', kit: ['A PFA T-shirt', 'A PFA wristband'], paidAt: '2026-10-21T09:10:00Z', orderId: 'PFA-MEM-XYZ22222' }],
  'a caregiver application': ['caregiver_application_received', 'person', { ...base, name: 'Asha Rao', applicationRef: 'PFA-CG-2026-00011', reference: 'PFA-CG-2026-00011', amount: '50', orderId: 'PFA-CGA-ABCD1234', paidAt: '2026-10-21T09:10:00Z', colony: 'Car Street, Udupi' }],
  'a volunteer application': ['submission_received', 'person', { ...base, kind: 'PFA-V', kindLabel: 'Volunteer application', name: 'Asha Rao', reference: 'PFA-V-2026-00003', receivedAt: '2026-10-21T09:10:00Z', followUrl: `${site}/track.html#ref=PFA-V-2026-00003` }],
  'a cruelty report': ['submission_received', 'person', { ...base, kind: 'PFA-CR', kindLabel: 'Cruelty report', name: 'Asha Rao', reference: 'PFA-CR-2026-00042', receivedAt: '2026-10-21T09:10:00Z', attachments: 2, followUrl: `${site}/track.html#ref=PFA-CR-2026-00042` }],
  'a reply from the panel': ['submission_reply', 'person', { ...base, name: 'Asha Rao', reference: 'PFA-V-2026-00003', threadSubject: 'Your volunteer application is in - PFA-V-2026-00003', n: 1, kindLabel: 'Volunteer application', text: 'Thank you for writing in.\n\nCould you come in on Saturday at 10?', signoff: 'Priya, People for Animals', followUrl: `${site}/track.html#ref=PFA-V-2026-00003`, replyHint: 'You can reply to this email and it will reach PFA.' }],
  'a reply carried on from an inbox': ['submission_answer', 'person', { ...base, name: 'Asha Rao', reference: 'PFA-CR-2026-00042', kindLabel: 'Cruelty report', text: 'A volunteer is on the way.', receivedAt: '2026-10-21T09:10:00Z', n: 1 }],
  'a shop order': ['shop_order_confirmed', 'person', { ...base, name: 'Asha Rao', orderId: 'PFA-SHP-ZX81QW22', reference: 'PFA-SHP-ZX81QW22', total: 2500, subtotal: 2500, shipping: 0, paidAt: '2026-10-21T09:10:00Z', bankReference: 'BRN1', items: [SHOP_ITEM], delivery: DELIVERY }],
  'a caregiver card approved': ['card_issued', 'person', { ...base, name: 'Asha Rao', applicationRef: 'PFA-CG-2026-00011', issuedAt: '2026-10-21T09:10:00Z', validUntil: '2029-10-21T09:10:00Z', postTo: ['Car Street colony, near the temple, Udupi', 'Karnataka 576101'], followUrl: `${site}/track.html#ref=PFA-CG-2026-00011` }],
  'a caregiver card posted': ['card_posted', 'person', { ...base, name: 'Asha Rao', applicationRef: 'PFA-CG-2026-00011', postedAt: '2026-10-24T09:10:00Z', postTo: ['Car Street colony, near the temple, Udupi', 'Karnataka 576101'] }],
  'a printed card paid for': ['shipping_paid', 'person', { ...base, cardId: 'PFA-CCT-ABCD2345', trackingId: 'PFA-CAR-ABCD1234', amount: '100', paymentReference: 'BNK3', cardUrl: `${site}/caregiver-card.html?id=PFA-CCT-ABCD2345` }],
  'a printed card dispatched': ['shipment_update', 'person', { ...base, cardId: 'PFA-CCT-ABCD2345', trackingId: 'PFA-CAR-ABCD1234', status: 'dispatched', statusLabel: 'Dispatched', carrier: 'India Post', carrierTrackingNumber: 'EE123456789IN', cardUrl: `${site}/caregiver-card.html?id=PFA-CCT-ABCD2345` }],
  'panel access': ['staff_invite', 'person', { ...base, name: 'Ozair Husain', link: 'https://pfa-new-website.firebaseapp.com/__/auth/action?x=1', reason: 'invite', role: 'editor', modules: ['Submissions', 'Payments'], adminUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'a membership photo asked for': ['member_photo_request', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', uploadUrl: `${site}/member-photo.html#t=abc`, expiresAt: '2026-11-09T09:10:00Z', reasons: [] }],
  'a membership photo asked for again': ['member_photo_request', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', uploadUrl: `${site}/member-photo.html#t=abd`, expiresAt: '2026-11-09T09:10:00Z', reasons: ['Your face is not clearly visible.'] }],
  'a membership photo received': ['member_photo_received', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', receivedAt: '2026-10-26T09:10:00Z' }],
  'a membership card approved': ['member_card_approved', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', tierLabel: 'Golden membership', validUntil: '2027-10-26T09:10:00Z', lifetime: false }],
  'a lifetime membership card approved': ['member_card_approved', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00006', tierLabel: 'Lifetime membership', validUntil: '', lifetime: true }],
  'a membership photo to approve, to PFA': ['member_photo_staff', 'pfa', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', tierLabel: 'Golden membership', receivedAt: '2026-10-26T09:10:00Z', panelUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'the copy to PFA': ['submission_forward', 'pfa', { ...base, reference: 'PFA-DON-MPTSVLDF', kind: 'PFA-DON', kindLabel: 'Donation', name: 'Karthik Dhanya', email: 'k@example.com', page: 'donate.html', rows: [{ label: 'Amount paid', value: 'INR 111' }] }],
  'a reply relayed to PFA': ['submission_followup', 'pfa', { ...base, reference: 'PFA-CR-2026-00042', kindLabel: 'Cruelty report', name: 'Asha Rao', email: 'asha@example.com', text: 'The dog is safe now.', n: 2 }],
  'a printed card fee, to the payments inboxes': ['shipping_paid_staff', 'pfa', { ...base, orderId: 'PFA-CGS-ABCD1234', cardId: 'PFA-CCT-ABCD2345', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', amount: '100', replacement: true, reason: 'Lost', deliverTo: 'Asha Rao, Car Street, Udupi, Karnataka 576101', trackingId: '3100002', bankReference: 'BNK4', shipmentId: 'PFA-CAR-ABCD1234' }],
  'a packing note': ['shop_order_staff', 'pfa', { ...base, name: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210', orderId: 'PFA-SHP-ZX81QW22', total: 2500, trackingId: '3100001', items: [SHOP_ITEM], delivery: DELIVERY }],
  'a test from the panel': ['inbox_test', 'pfa', { ...base, at: '2026-10-21T09:10:00Z', from: 'People for Animals <info@peopleforanimalsindia.org>', by: 'karthik.dhanya11@gmail.com', covers: 'payments' }]
};

const visible = (html) => String(html).replace(/<(style|head|title)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '\'').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

test('every template is exercised here', () => {
  const covered = new Set(Object.values(CASES).map(([t]) => t));
  assert.deepEqual(Object.keys(m.TEMPLATES).filter((t) => !covered.has(t)), [], 'a template nobody reads');
});

for (const [label, [template, to, payload]] of Object.entries(CASES)) {
  test(`${label} (${template}) reads as it should`, () => {
    const r = m.render(template, payload);
    const seen = visible(r.html);
    for (const [part, body] of [['subject', r.subject], ['html', seen], ['text', r.text]]) {
      assert.ok(String(body || '').trim(), `${part} is empty`);
      assert.doesNotMatch(body, /\bundefined\b|\bnull\b|\bNaN\b|\[object/, `${part} printed a missing value: ${String(body).slice(0, 200)}`);
      assert.doesNotMatch(body, /[\u2013\u2014]/, `${part} has a long dash`);
    }
    if (to === 'person') {
      assert.match(r.html, /<tr><td style="padding:36px 0 0;font-family:[^;"]*;font-size:17px;line-height:1\.6/, 'signed off');
      if (payload.name) assert.doesNotMatch(seen, new RegExp(`(Dear |^|\\s)${payload.name}[,.]`), 'the greeting uses the first name, not the full name');
    } else {
      const close = /<tr><td style="padding:36px 0 0;font-family:[^;"]*;font-size:17px;line-height:1\.6[^>]*>([\s\S]*?)<\/td><\/tr>/.exec(r.html);
      assert.doesNotMatch(close ? visible(close[1]) : '', /With thanks/, 'a copy to PFA\'s own inbox is not signed off to itself');
    }
  });
}

test('a donation is never called a gift, and a gift always is', () => {
  for (const label of ['a donation', 'a donation with a PAN', 'a dollar donation']) {
    const [template, , payload] = CASES[label];
    const r = m.render(template, payload);
    for (const body of [r.subject, visible(r.html), r.text]) assert.doesNotMatch(body, /\bgifts?\b/i, `${label}: ${String(body).slice(0, 160)}`);
    assert.match(visible(r.html), /Your donation is in\./);
  }
  const g = m.render(...[CASES['a gift'][0], CASES['a gift'][2]]);
  assert.match(visible(g.html), /Your gift is in\./);
  assert.match(visible(g.html), /PFA posts Ravi Kumar a Certificate of Appreciation/);
  assert.match(g.text, /A gift for: Ravi Kumar/);
});

test('the receipt says only what is true of the payment', () => {
  const usd = visible(m.render(CASES['a dollar donation'][0], CASES['a dollar donation'][2]).html);
  assert.match(usd, /\$25\.00/);
  assert.doesNotMatch(usd, /80G/, 'a dollar gift has no 80G');
  const pan = visible(m.render(CASES['a donation with a PAN'][0], CASES['a donation with a PAN'][2]).html);
  assert.match(pan, /including for your 80G certificate/);
  const plain = visible(m.render(CASES['a donation'][0], CASES['a donation'][2]).html);
  assert.doesNotMatch(plain, /80G certificate/, 'no certificate promised without a PAN');
  const noKit = visible(m.render(CASES['a membership with no kit'][0], CASES['a membership with no kit'][2]).html);
  assert.doesNotMatch(noKit, /and kit/, 'no kit promised to a tier that has none');
  const shop = visible(m.render(CASES['a shop order'][0], CASES['a shop order'][2]).html);
  assert.match(shop, /Delivery Free/, 'no delivery charge reads as Free, not ₹0');
  assert.match(shop, /no 80G receipt/);
});

test('a value that did not arrive leaves its sentence out rather than printing nothing', () => {
  const relay = m.render('submission_followup', { ...CASES['a reply relayed to PFA'][2], email: '' });
  assert.doesNotMatch(visible(relay.html), /answer them at\s*\./);
  const invite = m.render('staff_invite', { ...CASES['panel access'][2], modules: [] });
  assert.doesNotMatch(visible(invite.html), /with:\s*\./);
});
