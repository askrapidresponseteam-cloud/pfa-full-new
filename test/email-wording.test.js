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
  'a membership with its state member number': ['membership_welcome', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00007', memberNo: 'MP 1503', reference: 'PFA-MEM-2026-00007', tierLabel: 'Golden membership', amount: '2500', kit: [], paidAt: '2026-11-03T09:10:00Z', orderId: 'PFA-MEM-XYZ33333' }],
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
  'a membership card dispatched': ['member_card_dispatched', 'person', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', courier: 'Blue Dart', trackingNumber: '90812345678', dispatchedAt: '2026-10-28T09:10:00Z' }],
  'a membership photo to approve, to PFA': ['member_photo_staff', 'pfa', { ...base, name: 'Asha Rao', memberId: 'PFA-MEM-2026-00005', tierLabel: 'Golden membership', receivedAt: '2026-10-26T09:10:00Z', panelUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'replies not being read, to the administrators': ['replies_stuck', 'pfa', { ...base, kind: 'failing', error: 'Invalid credentials (Failure)', since: '2026-10-27T08:00:00Z', failStreak: 3, lastRunAt: '2026-10-27T08:04:00Z', mailbox: 'info@peopleforanimalsindia.org', panelUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'replies not checked for 30 minutes, to the administrators': ['replies_stuck', 'pfa', { ...base, kind: 'stale', since: '2026-10-27T08:00:00Z', lastRunAt: '2026-10-27T08:00:00Z', mailbox: 'info@peopleforanimalsindia.org', panelUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'replies working again, to the administrators': ['replies_working', 'pfa', { ...base, at: '2026-10-27T09:00:00Z', since: '2026-10-27T08:00:00Z', mailbox: 'info@peopleforanimalsindia.org', panelUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'a message to an old site member': ['old_member_message', 'person', { ...base, reference: 'PFA-OLD-1A2B3C4D5E', name: 'Asha Varma', n: 1, subject: 'Your PFA membership', text: 'Dear Asha,\n\nWe are bringing old members across to the new site.', signoff: 'Karthik Dhanya, People for Animals' }],
  'an old site member\'s reply, to the staff who wrote': ['old_member_relay', 'pfa', { ...base, reference: 'PFA-OLD-1A2B3C4D5E', n: 1, answers: 'msg.1', from: 'asha@example.com', subject: 'Your PFA membership', text: 'Yes please.', receivedAt: '2026-10-28T06:00:00Z', panelUrl: 'https://pfa-new-website.web.app/admin.html' }],
  'a shop order shipped, with a tracking link': ['shop_order_shipped', 'person', { ...base, name: 'Asha Rao', orderId: 'PFA-SHP-ZX81QW22', reference: 'PFA-SHP-ZX81QW22', courier: 'Blue Dart', trackingNumber: 'BD12345678', trackingUrl: 'https://www.bluedart.com/', shippedAt: '2026-10-28T10:00:00Z', paidAt: '2026-10-26T10:00:00Z', items: [SHOP_ITEM], delivery: DELIVERY }],
  'a shop order shipped, no tracking link': ['shop_order_shipped', 'person', { ...base, name: 'Asha Rao', orderId: 'PFA-SHP-ZX81QW22', reference: 'PFA-SHP-ZX81QW22', courier: 'India Post', trackingNumber: 'EE123456789IN', shippedAt: '2026-10-28T10:00:00Z', paidAt: '2026-10-26T10:00:00Z', items: [SHOP_ITEM], delivery: DELIVERY }],
  'the copy to PFA': ['submission_forward', 'pfa', { ...base, reference: 'PFA-DON-MPTSVLDF', kind: 'PFA-DON', kindLabel: 'Donation', name: 'Karthik Dhanya', email: 'k@example.com', page: 'donate.html', rows: [{ label: 'Amount paid', value: 'INR 111' }] }],
  'a reply relayed to PFA': ['submission_followup', 'pfa', { ...base, reference: 'PFA-CR-2026-00042', kindLabel: 'Cruelty report', name: 'Asha Rao', email: 'asha@example.com', text: 'The dog is safe now.', n: 2 }],
  'the monthly payments report, to gandhim and the payments inboxes': ['finance_monthly', 'pfa', { ...base, reportMonth: '2026-10', label: 'October 2026', count: 2, total: 'INR 1,500.00', csvName: 'PFA-payments-2026-10.csv', heads: [
    { key: 'donations', label: 'Donations', count: 1, subtotal: 'INR 500.00', more: 0, rows: [{ name: 'Asha Rao', date: '3 Oct 2026', time: '', purpose: 'Donation (old site)', amount: 'INR 500.00', status: 'Success', orderId: 'PFADONMVHV6AZI71BD15', reference: '' }] },
    { key: 'membership', label: 'Patrons and membership', count: 1, subtotal: 'INR 1,000.00', more: 0, rows: [{ name: 'Ravi Kumar', date: '25 Oct 2026', time: '10:30', purpose: 'Member', amount: 'INR 1,000.00', status: 'Success', orderId: 'PFA-MEM-AAAA1111', reference: 'PFA-MEM-2026-00004' }] },
    { key: 'shop', label: 'Shop orders', count: 0, subtotal: 'INR 0.00', more: 0, rows: [] }],
    reconciliation: { note: 'The old site took payments until 21 October 2026; the new site from its launch on 21 October.', summary: { oldSite: 1, newSite: 1, matched: 0, counted: 2, confirmed: 2, unconfirmed: 0, corrected: 0, excluded: 0 }, matched: [], excluded: [], corrected: [], unconfirmed: [], lookalikes: [] } }],
  'a payments report for a period, sent from the panel': ['finance_period', 'pfa', { ...base, sendId: 'R-0A1B2C3D4E', label: 'November 2026, to 3 Nov 2026', purpose: 'Donation', count: 1, total: 'INR 500.00', csvName: 'PFA-payments-2026-11-01-to-2026-11-03.csv', heads: [
    { key: 'donations', label: 'Donations', count: 1, subtotal: 'INR 500.00', more: 0, rows: [{ name: 'Asha Rao', date: '2 Nov 2026', time: '09:20', purpose: 'Donation; Where it is needed most', amount: 'INR 500.00', status: 'Success', orderId: 'PFA-DON-Z8BN74BZ', reference: '' }] }] }],
  'an intern welcomed': ['intern_welcome', 'person', { ...base, name: 'Arjun Nair', batchName: 'November 2026', startDate: '2026-11-09', link: `${site}/intern.html#onboard=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG`, expiresAt: '2026-11-08T09:00:00Z' }],
  'an intern given a new key': ['intern_welcome', 'person', { ...base, name: 'Arjun Nair', link: `${site}/intern.html#onboard=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG`, expiresAt: '2026-11-08T09:00:00Z', again: true }],
  'an intern reminded at the end of a week': ['intern_reminder', 'person', { ...base, name: 'Arjun Nair', week: 3, weeks: 8, weekTitle: 'Bring people onto the RRT', due: 'Sun 29 Nov, 11:59 pm', items: [{ line: 'Bring your town onto the RRT: 12 of 50 have registered', state: 'Due tonight' }, { line: 'Learn the law (4 laws)', state: 'Sent back for a revision' }], next: 'Week 4: A lawyer for animals', link: `${site}/intern.html` }],
  'an intern told their proof is accepted': ['intern_feedback', 'person', { ...base, name: 'Arjun Nair', task: 'Learn the law', state: 'accepted', score: 8.5, feedback: 'Clear and in your own words.', link: `${site}/intern.html` }],
  'an intern who passed the quiz': ['intern_quiz_result', 'person', { ...base, name: 'Arjun Nair', n: 1, of: 3, percent: 88, points: 110, max: 125, pass: true, passMark: 60, easy: '10 of 10', medium: '20 of 20', hard: '20 of 25', minutes: 52, answered: 55, count: 55, timedOut: false, best: 88, left: 0, next: '', lastAttempt: false, link: `${site}/intern.html` }],
  'an intern below the quiz pass mark': ['intern_quiz_result', 'person', { ...base, name: 'Arjun Nair', n: 1, of: 3, percent: 40, points: 50, max: 125, pass: false, passMark: 60, easy: '10 of 10', medium: '20 of 20', hard: '0 of 25', minutes: 75, answered: 41, count: 55, timedOut: true, best: 40, left: 2, next: 'Wed 11 Nov, 10:30 am', lastAttempt: false, link: `${site}/intern.html` }],
  'an intern after the last quiz attempt': ['intern_quiz_result', 'person', { ...base, name: 'Arjun Nair', n: 3, of: 3, percent: 32, points: 40, max: 125, pass: false, passMark: 60, easy: '10 of 10', medium: '15 of 20', hard: '0 of 25', minutes: 60, answered: 55, count: 55, timedOut: false, best: 40, left: 0, next: '', lastAttempt: true, link: `${site}/intern.html` }],
  'an intern asked to choose another shelter': ['intern_shelter_change', 'person', { ...base, name: 'Arjun Nair', reason: 'That address is a pet shop, not a shelter.', link: `${site}/intern.html` }],
  'an intern asked to revise': ['intern_feedback', 'person', { ...base, name: 'Arjun Nair', task: 'Map your town or district', state: 'revise', score: null, feedback: 'Add the government vet centre in Kaup, with its photograph.', link: `${site}/intern.html` }],
  'the Monday digest, to gandhim': ['weekly_digest', 'pfa', { ...base, week: '2026-11-02', label: '26 Oct to 1 Nov 2026', count: 2, waiting: 1, panelUrl: 'https://pfa-new-website.web.app/admin.html', groups: [
    { key: 'shop', label: 'Shop orders', count: 1, waiting: 1, more: 0, rows: [{ reference: 'PFA-SHP-ZX81QW22', kindLabel: 'Shop order', name: 'Asha Rao', place: '', date: '27 Oct, 11:30', status: 'New', link: 'https://pfa-new-website.web.app/admin.html#case=PFA-SHP-ZX81QW22' }] },
    { key: 'volunteer', label: 'Volunteer applications', count: 1, waiting: 0, more: 0, rows: [{ reference: 'PFA-V-2026-00031', kindLabel: 'Volunteer application', name: 'Kiran Shah', place: 'Udupi', date: '30 Oct, 11:30', status: 'Shortlisted', link: 'https://pfa-new-website.web.app/admin.html#case=PFA-V-2026-00031' }] },
    { key: 'members', label: 'New members', count: 0, waiting: 0, more: 0, rows: [] }] }],
  'an internship certificate, emailed': ['internship_certificate', 'person', { ...base, name: 'Asha Rao', number: 'PFA-INT-4K2M8QRT', startDate: '2026-11-02', endDate: '2026-12-27', issuedOn: '2026-12-28', verifyUrl: 'https://peopleforanimalsindia.org/verify-certificate?n=PFA-INT-4K2M8QRT', pdfName: 'PFA-internship-certificate-PFA-INT-4K2M8QRT.pdf' }],
  'a card on its way, from the registers': ['card_shipping', 'person', { ...base, kind: 'membership', name: 'Sohan Ashok Banasode', reference: 'PFA-MEM-2026-00032', cardId: 'PFA-MC-AB12CD34', status: 'shipped', statusLabel: 'Shipped', courier: 'DTDC', trackingNumber: 'D12345678', addressLines: ['House No 10, Shantinagar', 'Athani, Belagavi', 'Karnataka - 591304'] }],
  'a card returned, from the registers': ['card_shipping', 'person', { ...base, kind: 'caregiver', name: 'Trisha Dey', reference: 'PFA-CG-2026-00012', status: 'returned', statusLabel: 'Returned to sender', courier: 'India Post', trackingNumber: 'EE123456789IN', addressLines: ['Vill. Dhanicha', 'Nadia', 'West Bengal - 741222'] }],
  'the monthly cruelty report, to gandhim': ['cruelty_monthly', 'pfa', { ...base, reportMonth: '2026-11', label: 'November 2026', count: 3, pdfName: 'PFA-cruelty-reports-2026-11.pdf', leftOut: { spam: 1, removed: 0 }, states: [
    { state: 'Karnataka', count: 2, now: 1, districts: 'Bengaluru Urban, Udupi' },
    { state: 'State not given', count: 1, now: 0, districts: '' }] }],
  'the weekly internship quiz, to gandhim': ['quiz_weekly', 'pfa', { ...base, week: '2026-11-16', label: '9 Nov to 15 Nov 2026', count: 2, interns: 2, passed: 1, average: 54.4, passMark: 60, more: 0, csvName: 'PFA-internship-quiz-week-of-2026-11-16.csv', rows: [
    { name: 'Asha Rao', internId: 'PFA-IN-ABC234', batch: 'November 2026', attempt: 1, finished: '10 Nov, 10:30 am', percent: 100, points: 125, max: 125, pass: true, easy: '10/10', medium: '20/20', hard: '25/25', answered: 55, time: '52 min 10 s', timedOut: false },
    { name: 'Ravi Kumar', internId: 'PFA-IN-XYZ789', batch: 'November 2026', attempt: 2, finished: '11 Nov, 4:05 pm', percent: 8.8, points: 11, max: 125, pass: false, easy: '9/10', medium: '1/20', hard: '0/25', answered: 31, time: '75 min 00 s', timedOut: true }],
    hardest: [{ qid: 'h22', level: 'Hard', text: 'Did the number of dog-bite cases at the district hospital rise from 2025 to 2026?', rate: 0, seen: 2 }] }],
  'a week with no quiz attempts, to gandhim': ['quiz_weekly', 'pfa', { ...base, week: '2026-11-23', label: '16 Nov to 22 Nov 2026', count: 0, interns: 0, passed: 0, average: 0, passMark: 60, more: 0, csvName: 'PFA-internship-quiz-week-of-2026-11-23.csv', rows: [], hardest: [] }],
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

test('a member\u2019s letter shows the state member number, and keeps the reference for the track page', () => {
  const [t, , p] = CASES['a membership with its state member number'];
  const r = m.render(t, p);
  assert.match(r.subject, /PFA member PFA-MEM-2026-00007$/, 'the subject keeps the conversation\u2019s name, as later emails in it do');
  assert.match(r.text, /Member number: MP 1503\nMembership reference: PFA-MEM-2026-00007/);
  assert.match(r.html, /track\.html#ref=PFA-MEM-2026-00007/, 'the track link still finds the membership');
});

