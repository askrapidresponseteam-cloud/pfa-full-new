'use strict';

/* The Patron register, the Circle and everything that fed them - member
   logins, member status, circle posts and profiles, the legacy import - are
   gone, and this file keeps them from creeping back half-wired: a payment
   type with no parser, or an admin tab with no route behind it.

   Membership itself came back in September 2026, on request, as the far
   simpler thing the old site's Join Now page offered: five paid tiers, one
   record in the register under PFA-MEM, and a welcome letter. No login, no
   Circle, no patron card. So the word is no longer banned; instead the last
   test insists that, if membership is here, all of it is here. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const WORDS = /\b(patron|circlePosts|circleProfiles|getMember|memberAuth|bulkImportLegacyMembers|USD_MEMBERSHIP_PRICE)\b/i;

function jsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) jsFiles(full, out); }
    else if (e.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no server code still refers to the Circle or the patron register', () => {
  const hits = [];
  for (const file of jsFiles(path.join(ROOT, 'lib')).concat(jsFiles(path.join(ROOT, 'api')))) {
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    src.split('\n').forEach((line, i) => {
      if (WORDS.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 70)}`);
    });
  }
  assert.deepEqual(hits, [], `the Circle survives in:\n  ${hits.join('\n  ')}`);
});

test('the files are gone, not merely unreferenced', () => {
  const gone = [
    'lib/member-auth.js', 'lib/routes/member-status.js', 'lib/routes/admin/circle.js',
    'lib/routes/admin/import-members.js', 'assets/circle.js', 'assets/membership.js',
    'assets/member.js', 'assets/patron-card-pdf.js', 'circle-firestore.rules'
  ];
  const left = gone.filter((f) => fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(left, [], `still present: ${left.join(', ')}`);
});

test('no route is registered for something that no longer exists', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8');
  for (const key of ['admin/circle', 'admin/import-members', 'member-status', 'member/auth/start']) {
    assert.ok(!src.includes(`'${key}'`), `${key} is still registered`);
  }
  /* Every remaining loader must resolve, or the router 500s on that path. */
  for (const m of src.matchAll(/'([\w/-]+)':\s*\(\)\s*=>\s*require\('([^']+)'\)/g)) {
    const target = path.resolve(path.join(ROOT, 'api'), m[2]);
    assert.ok(fs.existsSync(target) || fs.existsSync(`${target}.js`), `${m[1]} points at a missing file`);
  }
});

test('membership is a payment type, and every part of it is wired', () => {
  const payment = require('../lib/payment.js');
  const mail = require('../lib/caregiver-mail.js');
  const flow = fs.readFileSync(path.join(ROOT, 'lib', 'pfa-ccavenue-flow.js'), 'utf8');
  const S = require('../lib/submissions.js');
  /* the five tiers of the old Join Now page, to the rupee */
  assert.deepEqual(Object.keys(payment.MEMBERSHIP_TIERS), ['student', 'silver', 'golden', 'platinum', 'lifetime']);
  assert.deepEqual(Object.values(payment.MEMBERSHIP_TIERS).map((t) => t.amount), [500, 1000, 2500, 5000, 10000]);
  /* the amount comes from the tier, never from the form */
  const body = { type: 'membership', tier: 'golden', amount: '1', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com',
    address: '12 Lake Road', city: 'Pune', state: 'Maharashtra', district: 'Pune', pincode: '411004', terms: 'yes' };
  const tx = payment.parsePaymentRequest(body);
  assert.equal(tx.type, 'membership'); assert.equal(tx.amount, 2500); assert.equal(tx.metadata.tierLabel, 'Golden membership');
  assert.throws(() => payment.parsePaymentRequest({ ...body, tier: 'diamond' }), /Choose a membership/);
  assert.throws(() => payment.parsePaymentRequest({ ...body, terms: '' }), /terms/i);
  /* no dollar tier: a member abroad pays in rupees and gets no kit, as the old terms said */
  assert.equal(payment.USD_MEMBERSHIP_PRICE, undefined);
  /* the order prefix, the register's kind, and the letter */
  assert.match(flow, /membership: 'PFA-MEM-'/);
  assert.equal(S.KIND_LABELS['PFA-MEM'], 'Membership');
  const letter = mail.render('membership_welcome', { name: 'Asha Rao', memberId: 'PFA-MEM-0001', orderId: 'PFA-MEM-X1', amount: 2500,
    paidAt: '2026-09-14T12:00:00.000Z', tierLabel: 'Golden membership', kit: ['A PFA T-shirt'], siteUrl: 'https://peopleforanimalsindia.org' });
  assert.match(letter.subject, /PFA-MEM-0001/);
  assert.match(letter.html, /one of/i); assert.match(letter.html, /PFA-MEM-0001/); assert.match(letter.html, /T-shirt/);
  assert.match(letter.html, /units\.html/); assert.match(letter.text, /PFA-MEM-0001/);
});

test('the admin panel has no section without a feature behind it', () => {
  const M = require('../lib/admin-modules.js');
  for (const dead of ['circle', 'members', 'import']) {
    assert.ok(!M.MODULE_KEYS.includes(dead), `Admin still lists ${dead}`);
  }
  /* What the site actually collects is still there. */
  for (const live of ['submissions', 'volunteers', 'donations', 'caregivers', 'payments']) {
    assert.ok(M.MODULE_KEYS.includes(live), `Admin lost ${live}`);
  }
});

test('the colony caregiver card survives, and is the only card there is', () => {
  const verify = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'verify-card.js'), 'utf8');
  assert.match(verify, /CAREGIVER_ID/);
  assert.ok(!/MEMBER_ID/.test(verify));
  assert.match(verify, /PFA-CCT-XXXXXXXX/, 'the message must not still offer PFA-MBR');
  const cards = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'admin', 'cards.js'), 'utf8');
  assert.match(cards, /new Set\(\['caregiver'\]\)/);
});
