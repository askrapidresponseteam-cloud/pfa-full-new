'use strict';

/* Owner, 27 Nov 2026, two New PFA unit applications from one person: "Why
   are there two applications for the same person? Can the system use
   matching details or identifiers to detect an existing application for the
   same purpose? Apply this check to other relevant use cases too."

   A form of a kind one person sends once for one purpose is tied to the same
   person's earlier one: the same email or mobile, and for a job the same
   post. Kinds where one person rightly sends many are never tied. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { memoryFirestore } = require('./_memory-firestore');
const S = require('../lib/submissions');
const R = require('../lib/repeat-forms');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DAY = 864e5;
const T0 = Date.UTC(2026, 10, 11, 6, 0);

async function put(db, reference, kind, fields, ago, extra) {
  const data = Object.assign({ reference, kind, status: 'new', fields, contactKeys: S.contactKeysFor(fields), receivedAtMs: T0 + ago * DAY }, extra || {});
  await db.collection('submissions').doc(reference).set(data);
  return data;
}
const doc = async (db, ref) => (await db.collection('submissions').doc(ref).get()).data();

test('a second unit application from the same person is tied to the first, by email whatever its case, or by mobile', async () => {
  const db = memoryFirestore();
  await put(db, 'PFA-U-2026-00001', 'PFA-U', { name: 'Anwari Begum Ansari', email: 'ansarianwaribegum3@gmail.com', mobile: '9876543210' }, 0);
  const second = await put(db, 'PFA-U-2026-00002', 'PFA-U', { name: 'Anwari Begum Ansari', email: 'AnsariAnwariBegum3@gmail.com' }, 4);
  assert.equal(await R.tie(db, 'PFA-U-2026-00002', second), 'PFA-U-2026-00001');
  const third = await put(db, 'PFA-U-2026-00004', 'PFA-U', { name: 'A. B. Ansari', email: 'other@example.com', mobile: '+91 98765 43210' }, 8);
  assert.equal(await R.tie(db, 'PFA-U-2026-00004', third), 'PFA-U-2026-00001', 'the same mobile, written another way; tied to the first, not the second');
  assert.equal((await doc(db, 'PFA-U-2026-00002')).repeatOf, 'PFA-U-2026-00001');
  assert.deepEqual((await doc(db, 'PFA-U-2026-00001')).repeats, ['PFA-U-2026-00002', 'PFA-U-2026-00004']);
  /* someone else is never tied */
  const other = await put(db, 'PFA-U-2026-00003', 'PFA-U', { name: 'Abhilash', email: 'abhilash@example.com', mobile: '9123456780' }, 6);
  assert.equal(await R.tie(db, 'PFA-U-2026-00003', other), null);
});

test('for the same purpose only: a job for another post, a cruelty report or a help desk question is never tied', async () => {
  const db = memoryFirestore();
  const who = { name: 'Vishakha', email: 'v@example.com', mobile: '9811111111' };
  await put(db, 'PFA-J-2026-00040', 'PFA-J', Object.assign({ roleId: 'vet-delhi' }, who), 0);
  const other = await put(db, 'PFA-J-2026-00043', 'PFA-J', Object.assign({ roleId: 'campaigns' }, who), 2);
  assert.equal(await R.tie(db, 'PFA-J-2026-00043', other), null, 'another post');
  const same = await put(db, 'PFA-J-2026-00044', 'PFA-J', Object.assign({ roleId: 'vet-delhi' }, who), 3);
  assert.equal(await R.tie(db, 'PFA-J-2026-00044', same), 'PFA-J-2026-00040', 'the same post');
  for (const kind of ['PFA-CR', 'PFA-Q', 'PFA-C', 'PFA-DON', 'PFA-VI']) {
    assert.equal(R.KINDS[kind], undefined, kind + ' is sent many times by one person, rightly');
    await put(db, kind + '-2026-00001', kind, who, 0);
    const again = await put(db, kind + '-2026-00002', kind, who, 1);
    assert.equal(await R.tie(db, kind + '-2026-00002', again), null);
  }
  /* a removed or spam form is not one to tie to */
  await put(db, 'PFA-V-2026-00001', 'PFA-V', who, 0, { status: 'spam' });
  const v = await put(db, 'PFA-V-2026-00002', 'PFA-V', who, 1);
  assert.equal(await R.tie(db, 'PFA-V-2026-00002', v), null);
});

test('the forms already on file are tied once, oldest first, even those kept before contact keys were', async () => {
  const db = memoryFirestore();
  await put(db, 'PFA-CG-2026-00001', 'PFA-CG', { name: 'Ravi', email: 'ravi@example.com' }, 0);
  await db.collection('submissions').doc('PFA-CG-2026-00002').set({ reference: 'PFA-CG-2026-00002', kind: 'PFA-CG', status: 'new', fields: { name: 'Ravi', email: 'RAVI@example.com' }, receivedAtMs: T0 + DAY });
  await put(db, 'PFA-CG-2026-00003', 'PFA-CG', { name: 'Ravi', email: 'ravi@example.com' }, 2);
  R._reset();
  assert.equal(await R.markOnce(db), 2);
  assert.equal((await doc(db, 'PFA-CG-2026-00002')).repeatOf, 'PFA-CG-2026-00001');
  assert.equal((await doc(db, 'PFA-CG-2026-00003')).repeatOf, 'PFA-CG-2026-00001');
  R._reset();
  assert.equal(await R.markOnce(db), 0, 'once only');
});

test('wired in: every new form is checked, the register carries the ties, and each tile says which is which', () => {
  assert.match(read('lib/routes/pfa-submissions.js'), /if \(!merged\) await REPEAT\.tie\(db, filing\.reference, filing\.record\);/);
  const rec = read('lib/routes/admin/records.js');
  assert.match(rec, /repeatOf: data\.repeatOf \|\| null,/);
  assert.match(rec, /markOnce\(db\)/);
  const subs = read('assets/admin-subs.js');
  assert.match(subs, /Same person, same application, sent before as/);
  assert.match(subs, /Sent again by the same person as/);
  assert.match(subs, /grid-auto-rows:1fr/, 'the kind tiles are one size');
  /* only the ties and the contact keys are written, never what the sender wrote */
  const writes = [...read('lib/repeat-forms.js').matchAll(/\.(?:set|update|create)\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g)].map((m) => m[1]);
  assert.ok(writes.length >= 3);
  writes.filter((w) => !/version/.test(w)).forEach((w) => assert.match(w, /^\s*(repeatOf|repeats|contactKeys):/, w));
  assert.doesNotMatch(read('lib/repeat-forms.js'), /merge: true \}\);\s*\n\s*const snap/);
  for (const f of ['lib/repeat-forms.js', 'test/repeat-forms.test.js', 'assets/admin-subs.js']) assert.ok(!/[\u2013\u2014]/.test(read(f)), f);
});
