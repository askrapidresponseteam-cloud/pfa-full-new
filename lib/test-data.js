'use strict';

/* Test data out of the panel (owner, 23 Oct 2026: "dont need any record of
   20 oct and earlier cause all of them are test data").

   Everything this site recorded up to the end of 20 Oct 2026, India time,
   was made while the site was being built and tried out. It stays out of
   every list, count, search and download from now on.

   The panel's oldest rule is that nothing in it destroys a record
   (test/admin-master-record.test.js). So nothing is destroyed here either:
   each record is MOVED, whole, into an archive beside the live data, at its
   own path under testDataArchive/until-2026-10-20 (a case's messages and
   photographs with it). Being no longer where any list reads, it leaves
   every list, count, search, download and public page at once. restore()
   moves every one of them back. This file is the only one allowed to
   remove a document, and only like that (test/test-data.test.js).

   How a document moves (reviewed 23 Oct 2026): in a transaction that reads
   it afresh, so a reply filed on it a moment before is in the copy and a
   write after the read makes Firestore run it again; the copy is written
   with create(), so it never lands on anything already there; and the
   original is removed in that same transaction. A record's messages and
   photographs move before the record, listed afresh as they go, and the
   record itself moves only once none is left under it. Each transaction
   carries at most 6 MB, well under Firestore's 10 MB, because photographs
   from before Storage was switched on sit inside their documents. A run
   that stops part way (the time is up, the server is stopped) leaves every
   document in exactly one of the two places, and the next run, or a
   restore, carries on from there.

   What one is: a case (and its messages and photographs), a payment and
   CCAvenue's answers about it, a colony card with everything kept beside it
   (the holder, the addresses, the print order and parcel, the public card,
   the one-card-per-mobile index, the card's own log), an email the site
   queued, a caregiver's photograph waiting to be paid for, a shop order
   kept here, and the search index's entry for any of these. Dated by when
   it was made. Anything tied to one of these (the payment of a test case,
   the case of a test payment, a card issued for a test application, an
   email about any of them) goes with it, whatever its own date.

   Left alone: the audit log (who did what, this included), the reference
   counters (a number is never issued twice), members (this site never
   writes them), the old store's orders, settings, and the files in Storage
   (the moved records still point at them). */

const { PAID_KINDS } = require('./submissions');

const CUTOFF_ISO = '2026-10-20T18:30:00.000Z';   // 21 Oct 2026, 00:00 in India
const CUTOFF_MS = Date.parse(CUTOFF_ISO);
const ROOT = 'testDataArchive';
const SET = 'until-2026-10-20';
const MAX_BYTES = 6 * 1024 * 1024;
const CHUNK = 100;           // documents read in one transaction
const CHUNK_HEAVY = 8;       // photographs may be up to 1 MB each

/* What each kind of record keeps under it. Firestore can list them too
   (listCollections), and does where it can; these are for where it cannot. */
const KNOWN_SUBS = { submissions: ['messages', 'attachments'], caregiverDocuments: ['attachments'] };

const CARD_SIDE = ['caretakerAddresses', 'caretakerOrders', 'caretakerShipments', 'caregiverMobileIndex', 'caregiverIdentityIndex'];
const COLLECTIONS = [
  'submissions', 'transactions', 'paymentEvents',
  'caretakerCards', 'caretakerPublic', 'caretakerApplicants', ...CARD_SIDE, 'caretakerAudit',
  'caregiverEmails', 'caregiverDocuments', 'shopOrders', 'adminSearch'
];
/* Read as just what decides whether they go: the search index's entries
   carry long word lists, and the emails their whole letters. Whatever
   moves is read again whole, in its transaction. */
const LEAN = {
  adminSearch: ['type', 'id'],
  caregiverEmails: ['createdAt', 'createdAtIso', 'payload.reference', 'payload.applicationRef', 'payload.orderId', 'payload.cardId']
};

function millis(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
}

/* When a record was made: the first of these it has. */
const DATE_FIELDS = ['createdAt', 'createdAtIso', 'receivedAtMs', 'receivedAt', 'issuedAt', 'atMs', 'at'];
function whenOf(data) {
  for (const f of DATE_FIELDS) {
    const t = millis(data && data[f]);
    if (t != null) return t;
  }
  return null;
}
/* Made before the cutoff. A record with no date at all is left alone. */
function isTest(data) {
  const t = whenOf(data);
  return t != null && t < CUTOFF_MS;
}

/* About how many bytes a document carries. */
function sizeOf(v) {
  if (v == null) return 1;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (typeof v === 'number' || typeof v === 'boolean') return 8;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v.length;
  if (typeof v.toMillis === 'function' || v instanceof Date) return 8;
  if (Array.isArray(v)) return v.reduce((n, x) => n + sizeOf(x), 0);
  /* a plain map is walked; anything else (a reference, a place) is small */
  const proto = typeof v === 'object' ? Object.getPrototypeOf(v) : null;
  if (typeof v === 'object' && (proto === Object.prototype || proto === null)) return Object.keys(v).reduce((n, k) => n + k.length + 1 + sizeOf(v[k]), 32);
  return 64;
}

function archiveRoot(db) {
  return db.collection(ROOT).doc(SET);
}

async function docsOf(query, fields) {
  const snap = await (fields ? query.select(...fields) : query).get();
  return snap.docs || [];
}

async function subsOf(collection, ref) {
  const names = new Set(KNOWN_SUBS[collection] || []);
  if (typeof ref.listCollections === 'function') {
    try { (await ref.listCollections()).forEach((c) => names.add(c.id)); } catch (_) { /* the known ones are enough */ }
  }
  return [...names];
}

/* A case's payment: kept beside a caregiver application, and among the
   fields of the other paid kinds. Only a payment opens a paid kind, so a
   public form cannot claim one by naming an order. */
function orderOf(d) {
  const x = d || {};
  if (x.payment && x.payment.orderId) return String(x.payment.orderId);
  return PAID_KINDS.has(String(x.kind || '')) && x.fields && x.fields.orderId ? String(x.fields.orderId) : '';
}
/* the case numbers a payment was filed under */
function referencesOf(d) {
  return ['applicationReference', 'membershipReference', 'donationReference']
    .map((k) => String((d && d[k]) || '')).filter((v) => /^PFA-/.test(v));
}

/* What would move: each record, in the order it moves (whatever depends on
   a record before the record itself). */
async function plan(db) {
  const live = {};
  for (const name of COLLECTIONS) live[name] = await docsOf(db.collection(name), LEAN[name]);
  const base = archiveRoot(db);
  const gone = {};
  for (const name of ['submissions', 'transactions', 'caretakerCards', 'caregiverEmails']) {
    gone[name] = new Map((await docsOf(base.collection(name), name === 'caregiverEmails' ? LEAN.caregiverEmails : null)).map((d) => [d.id, d.data() || {}]));
  }
  const subs = new Map(live.submissions.map((d) => [d.id, d.data() || {}]));
  const txs = new Map(live.transactions.map((d) => [d.id, d.data() || {}]));

  /* cases and payments, and the ties between them, to a standstill */
  const S = new Set([...subs].filter(([, d]) => isTest(d)).map(([id]) => id));
  const T = new Set([...txs].filter(([, d]) => isTest(d)).map(([id]) => id));
  const allS = () => new Set([...S, ...gone.submissions.keys()]);
  const allT = () => new Set([...T, ...gone.transactions.keys()]);
  for (let changed = true, round = 0; changed && round < 10; round += 1) {
    changed = false;
    const s = allS();
    const t = allT();
    for (const [id, d] of subs) {
      if (!S.has(id) && (t.has(orderOf(d)) || t.has(id))) { S.add(id); changed = true; }
    }
    /* the orders of test cases, and a donation's or shop order's own number */
    const ordersOfTestCases = new Set();
    for (const [id, d] of [...subs, ...gone.submissions]) {
      if (!s.has(id)) continue;
      ordersOfTestCases.add(id);
      if (orderOf(d)) ordersOfTestCases.add(orderOf(d));
    }
    for (const [id, d] of txs) {
      if (!T.has(id) && (ordersOfTestCases.has(id) || referencesOf(d).some((r) => s.has(r)))) { T.add(id); changed = true; }
    }
  }
  const sAll = allS();
  const tAll = allT();

  const cardOf = (d) => String((d.data() || {}).cardId || '');
  const C = new Set(live.caretakerCards.filter((d) => isTest(d.data()) || sAll.has(String((d.data() || {}).applicationRef || ''))).map((d) => d.id));
  const cAll = new Set([...C, ...gone.caretakerCards.keys()]);
  const A = new Set(live.caretakerCards.filter((d) => C.has(d.id)).map((d) => String((d.data() || {}).applicantId || '')).filter(Boolean));
  const byCard = (d) => isTest(d.data()) || cAll.has(cardOf(d));

  const ref = (v) => String(v || '');
  const aboutTest = (p) => sAll.has(ref(p.reference)) || sAll.has(ref(p.applicationRef)) || tAll.has(ref(p.orderId)) || cAll.has(ref(p.cardId));
  const E = new Set(live.caregiverEmails.filter((d) => isTest(d.data()) || aboutTest((d.data() || {}).payload || {})).map((d) => d.id));
  const eAll = new Set([...E, ...gone.caregiverEmails.keys()]);

  const indexed = (d) => {
    const e = d.data() || {};
    const id = String(e.id || '');
    return Boolean(id) && ((e.type === 'case' && sAll.has(id)) || (e.type === 'payment' && tAll.has(id)) || (e.type === 'card' && cAll.has(id)) || (e.type === 'email' && eAll.has(id)));
  };

  const groups = [
    ['adminSearch', live.adminSearch.filter(indexed)],
    ['caregiverEmails', live.caregiverEmails.filter((d) => E.has(d.id))],
    ['caretakerAudit', live.caretakerAudit.filter((d) => isTest(d.data()) || cAll.has(String((d.data() || {}).entity || '').replace(/^card:/, '')))],
    ...CARD_SIDE.map((name) => [name, live[name].filter(byCard)]),
    ['caretakerApplicants', live.caretakerApplicants.filter((d) => A.has(d.id) || byCard(d))],
    ['caretakerPublic', live.caretakerPublic.filter((d) => cAll.has(d.id) || isTest(d.data()))],
    ['caretakerCards', live.caretakerCards.filter((d) => C.has(d.id))],
    ['caregiverDocuments', live.caregiverDocuments.filter((d) => isTest(d.data()) || sAll.has(String((d.data() || {}).movedTo || '')))],
    ['shopOrders', live.shopOrders.filter((d) => isTest(d.data()) || tAll.has(d.id) || tAll.has(String((d.data() || {}).orderId || '')))],
    ['paymentEvents', live.paymentEvents.filter((d) => isTest(d.data()) || tAll.has(String((d.data() || {}).orderId || '')))],
    ['submissions', live.submissions.filter((d) => S.has(d.id))],
    ['transactions', live.transactions.filter((d) => T.has(d.id))]
  ];
  const units = [];
  for (const [name, docs] of groups) for (const doc of docs) units.push({ collection: name, id: doc.id });
  const counts = { cases: S.size, payments: T.size, cards: C.size, emails: E.size, records: units.length };
  return { units, counts };
}

/* What the panel shows before anything moves, and after. */
async function preview(db) {
  const { counts } = await plan(db);
  const snap = await archiveRoot(db).get();
  const done = snap.exists ? snap.data() || {} : null;
  const moved = done && !done.restoredAt && done.movedAt ? { at: done.movedAt, by: done.movedBy || '', counts: done.counts || {} } : null;
  return { cutoff: CUTOFF_ISO, until: '20 Oct 2026', counts, moved };
}

/* ---- moving ------------------------------------------------------------ */

/* One transaction: reads each document and the place it is going afresh,
   copies each whole to its new place with create() (never over anything
   already there), and removes the original, until about 6 MB. Resolves to
   how many of the pairs it settled (moved, skipped because the new place
   is taken, or already gone), and which moved. */
async function moveSome(db, pairs) {
  return db.runTransaction(async (tx) => {
    const sources = await tx.getAll(...pairs.map((p) => p.from));
    const targets = await tx.getAll(...pairs.map((p) => p.to));
    let bytes = 0;
    let settled = 0;
    const moved = [];
    const taken = [];
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i];
      if (!sources[i].exists) { settled += 1; continue; }
      if (targets[i].exists) { taken.push(pair.path); settled += 1; continue; }
      const data = sources[i].data() || {};
      const size = sizeOf(data) + 512;
      if (moved.length && bytes + size > MAX_BYTES) break;
      bytes += size;
      tx.create(pair.to, data);
      tx.delete(pair.from);
      moved.push(pair.path);
      settled += 1;
    }
    return { settled, moved, taken };
  });
}

/* The same path in the other place. */
function placeOf(root, path) {
  const parts = path.split('/');
  let ref = root;
  for (let i = 0; i < parts.length; i += 2) ref = ref.collection(parts[i]).doc(parts[i + 1]);
  return ref;
}

/* Moves one record from `fromRoot` to `toRoot` (the database and the
   archive, either way round): what sits under it first, listed afresh each
   round, then the record once nothing is left under it. What moved is
   written into `out` as it goes, so a failure part way still says what
   went. Resolves to `out`, with done set once the record itself moved. */
async function moveRecord(db, fromRoot, toRoot, collection, id, deadline, out) {
  const path = `${collection}/${id}`;
  const from = placeOf(fromRoot, path);
  out.done = false;
  let left = false;
  for (const sub of await subsOf(collection, from)) {
    const chunk = sub === 'attachments' ? CHUNK_HEAVY : CHUNK;
    const seen = new Set();
    for (let round = 0; round < 5; round += 1) {
      const ids = (await docsOf(from.collection(sub), [])).map((d) => d.id).filter((x) => !seen.has(x));
      if (!ids.length) break;
      for (let i = 0; i < ids.length;) {
        const pairs = ids.slice(i, i + chunk).map((x) => ({ from: from.collection(sub).doc(x), to: placeOf(toRoot, `${path}/${sub}/${x}`), path: `${path}/${sub}/${x}` }));
        const r = await moveSome(db, pairs);
        out.moved.push(...r.moved);
        out.taken.push(...r.taken);
        if (r.taken.length) left = true;
        ids.slice(i, i + Math.max(r.settled, 1)).forEach((x) => seen.add(x));
        i += Math.max(r.settled, 1);
        if (Date.now() > deadline) return out;
      }
    }
  }
  /* the record itself, once nothing of it is left behind */
  if (left) return out;
  for (const sub of await subsOf(collection, from)) {
    if ((await docsOf(from.collection(sub).limit(1), [])).length) return out;
  }
  const r = await moveSome(db, [{ from, to: placeOf(toRoot, path), path }]);
  out.moved.push(...r.moved);
  out.taken.push(...r.taken);
  out.done = r.taken.length === 0;
  return out;
}

/* How many records of each kind a list of moved paths holds. */
const KIND_OF = { submissions: 'cases', transactions: 'payments', caretakerCards: 'cards', caregiverEmails: 'emails' };
function tally(paths) {
  const out = { cases: 0, payments: 0, cards: 0, emails: 0, records: 0, documents: paths.length };
  for (const p of paths) {
    const parts = p.split('/');
    if (parts.length !== 2) continue;
    out.records += 1;
    if (KIND_OF[parts[0]]) out[KIND_OF[parts[0]]] += 1;
  }
  return out;
}

/* Moves the test data into the archive. `deadline` (a time in ms) is when
   to stop starting new records; the reading counts against it. Never
   throws once something may have moved: a failure part way is returned,
   with what went, for the log and the next press. */
async function archive(db, { by, deadline } = {}) {
  const until = Number(deadline) || Date.now() + 25000;
  const moved = [];
  let taken = 0;
  let more = false;
  let error = '';
  const sink = { moved, taken: [] };
  try {
    const { units } = await plan(db);
    /* the first record moves whatever the clock says, so a press always
       gets somewhere, however long the reading took */
    for (const [n, unit] of units.entries()) {
      if (n > 0 && Date.now() > until) { more = true; break; }
      const before = sink.taken.length;
      await moveRecord(db, db, archiveRoot(db), unit.collection, unit.id, until, sink);
      if (!sink.done && sink.taken.length === before) { more = true; break; }
    }
  } catch (e) {
    if (!moved.length) throw e;
    more = true;
    error = String((e && e.message) || e).slice(0, 200);
  }
  taken = sink.taken.length;
  const now = tally(moved);
  try {
    const base = archiveRoot(db);
    const snap = await base.get();
    const was = snap.exists ? snap.data() || {} : {};
    const before = was.restoredAt ? {} : (was.counts || {});
    const counts = {};
    for (const k of Object.keys(now)) counts[k] = (Number(before[k]) || 0) + now[k];
    const at = new Date().toISOString();
    if (moved.length || snap.exists) {
      await base.set({ cutoff: CUTOFF_ISO, movedAt: (!was.restoredAt && was.movedAt) || at, lastRunAt: at, movedBy: by || was.movedBy || '', counts });
    }
  } catch (e) {
    console.warn('test data: the archive note was not written', String(e && e.message).slice(0, 160));
  }
  return { moved: now, taken, more, error };
}

/* Every record in the archive, including one whose own document never got
   there (a run stopped between its messages and it): listDocuments finds
   those too. */
async function archivedUnits(db) {
  const base = archiveRoot(db);
  const units = [];
  for (const name of COLLECTIONS) {
    const col = base.collection(name);
    const refs = typeof col.listDocuments === 'function' ? await col.listDocuments() : (await docsOf(col, [])).map((d) => d.ref);
    for (const r of refs) units.push({ collection: name, id: r.id });
  }
  return units;
}

/* Puts every moved record back where it was, the same way. A place taken
   again since (it never should be) is left as it is, and so is the copy. */
async function restore(db, { by, deadline } = {}) {
  const until = Number(deadline) || Date.now() + 25000;
  const moved = [];
  let taken = 0;
  let more = false;
  let error = '';
  const sink = { moved, taken: [] };
  try {
    for (const [n, unit] of (await archivedUnits(db)).entries()) {
      if (n > 0 && Date.now() > until) { more = true; break; }
      const before = sink.taken.length;
      await moveRecord(db, archiveRoot(db), db, unit.collection, unit.id, until, sink);
      if (!sink.done && sink.taken.length === before) { more = true; break; }
    }
  } catch (e) {
    if (!moved.length) throw e;
    more = true;
    error = String((e && e.message) || e).slice(0, 200);
  }
  taken = sink.taken.length;
  try {
    const base = archiveRoot(db);
    if (!more && !taken && (await base.get()).exists) {
      await base.set({ restoredAt: new Date().toISOString(), restoredBy: by || '', counts: {} }, { merge: true });
    }
  } catch (e) {
    console.warn('test data: the archive note was not written', String(e && e.message).slice(0, 160));
  }
  return { restored: tally(moved), kept: taken, more, error };
}

module.exports = { CUTOFF_ISO, CUTOFF_MS, ROOT, SET, COLLECTIONS, whenOf, isTest, sizeOf, plan, preview, archive, restore };
