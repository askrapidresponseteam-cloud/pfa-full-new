'use strict';
/* The same person applying twice for the same thing (owner, 27 Nov 2026,
   two New PFA unit applications from one person: "Why are there two
   applications for the same person? Can the system use matching details or
   identifiers to detect an existing application for the same purpose? Apply
   this check to other relevant use cases too.").

   A form of one of the kinds below is matched, when it arrives, against the
   forms of the same kind already on file from the same person: the same
   email or the same mobile (the record's contactKeys, lib/submissions.js),
   and for a job the same post. The newer one is kept, since it may carry
   something the first did not, and the two are tied together: the newer
   carries repeatOf (the first one's number), the first carries repeats
   (every later number). The panel shows both ties on the tiles and in the
   case, so nobody works the same application twice.

   Kinds where one person rightly sends many (a cruelty report, a help desk
   question, a follow-up, a donation, an order) are never matched. A remote
   internship application is already added to the one on file by email
   (lib/intern-applications.js), so it is not matched here either.

   Forms already on file are tied once by markOnce(), the first time the
   panel reads the register.

   Only the ties (repeatOf, repeats) and a missing contactKeys are ever
   written, with update(): never what the sender wrote. */

const S = require('./submissions');

/* kind -> the fields that must also agree for two forms to be for the same
   purpose (beyond being from the same person) */
const KINDS = {
  'PFA-U': [],          // a new PFA unit
  'PFA-V': [],          // volunteering
  'PFA-J': ['roleId'],  // a job: the same post
  'PFA-CG': [],         // a colony caregiver card
  'PFA-CAM': [],        // a campus society
  'PFA-CSR': [],        // a corporate partnership
  'PFA-SG': [],         // an Animal Care Centre offer
  'PFA-POD': []         // the podcast
};
const GONE = new Set(['removed', 'spam']);

function keysOf(d) {
  const k = Array.isArray(d.contactKeys) && d.contactKeys.length ? d.contactKeys : S.contactKeysFor(d.fields || {});
  return k.filter(Boolean).slice(0, 10);
}
function samePurpose(kind, a, b) {
  return (KINDS[kind] || []).every((f) => {
    const x = String(((a.fields || {})[f]) || '').trim().toLowerCase();
    const y = String(((b.fields || {})[f]) || '').trim().toLowerCase();
    return x === y;
  });
}

/* The first form of the same kind from the same person, for the same
   purpose, that came before this one; or null. */
async function earlierOf(db, reference, data) {
  const d = data || {};
  if (!KINDS[d.kind]) return null;
  const keys = keysOf(d);
  if (!keys.length) return null;
  const snap = await db.collection('submissions').where('contactKeys', 'array-contains-any', keys).limit(200).get();
  const at = Number(d.receivedAtMs) || Infinity;
  let first = null;
  for (const doc of snap.docs) {
    if (doc.id === reference) continue;
    const o = doc.data() || {};
    if (o.kind !== d.kind || GONE.has(o.status) || o.repeatOf) continue;
    const when = Number(o.receivedAtMs) || 0;
    if (when >= at || !samePurpose(d.kind, d, o)) continue;
    if (!first || when < first.when) first = { reference: o.reference || doc.id, when };
  }
  return first ? first.reference : null;
}

/* Ties a form just filed to the one before it, if there is one. Never
   throws: a form is never refused or lost over this. */
async function tie(db, reference, data) {
  try {
    const first = await earlierOf(db, reference, data);
    if (!first) return null;
    const subs = db.collection('submissions');
    await subs.doc(reference).update({ repeatOf: first });
    const snap = await subs.doc(first).get();
    const had = snap.exists && Array.isArray((snap.data() || {}).repeats) ? snap.data().repeats : [];
    if (!had.includes(reference)) await subs.doc(first).update({ repeats: had.concat(reference) });
    return first;
  } catch (error) {
    console.warn('repeat check skipped', { reference, message: error && error.message });
    return null;
  }
}

/* Forms filed before this check: tied once, oldest first, so a third form
   is tied to the first and not to the second. */
const MARK_VERSION = 1;
let marking = null;
function markOnce(db) {
  if (marking) return marking;
  marking = (async () => {
    const flag = db.collection('siteMeta').doc('repeatForms');
    const seen = await flag.get();
    if (seen.exists && Number((seen.data() || {}).version) >= MARK_VERSION) return 0;
    const snap = await db.collection('submissions').where('kind', 'in', Object.keys(KINDS)).limit(2000).get();
    const rows = snap.docs.map((doc) => ({ id: doc.id, d: doc.data() || {} }))
      .filter((r) => !GONE.has(r.d.status))
      .sort((a, b) => (Number(a.d.receivedAtMs) || 0) - (Number(b.d.receivedAtMs) || 0));
    /* a form kept before its contact keys were (8 Oct 2026) is given them,
       so it can be found */
    for (const r of rows) {
      if (Array.isArray(r.d.contactKeys) && r.d.contactKeys.length) continue;
      const keys = S.contactKeysFor(r.d.fields || {});
      if (!keys.length) continue;
      r.d.contactKeys = keys;
      await db.collection('submissions').doc(r.id).update({ contactKeys: keys });
    }
    let tied = 0;
    for (const r of rows) {
      if (r.d.repeatOf) continue;
      if (await tie(db, r.id, r.d)) tied += 1;
    }
    await flag.set({ version: MARK_VERSION, at: new Date().toISOString(), tied });
    return tied;
  })().catch((error) => {
    console.warn('repeat forms not marked', error && error.message);
    marking = null;
    return 0;
  });
  return marking;
}

module.exports = { KINDS, earlierOf, tie, markOnce, _reset() { marking = null; } };
