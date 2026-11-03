'use strict';

/* Member numbers, state by state, never the same twice (owner, 3 Nov 2026:
   "MP and Chhattisgarh go on rotational basis. Is that possible to detect
   and allot the membership on rotational basis depending upon the address
   ... how to ensure we do enterprise grade numbering- statewise and ensure
   that no 2 members ever get same number, old , new and future"; answered:
   MP and CG share one count, and the members who joined on the website get
   state numbers too).

   SERIES. A member number is a state code and a number: TN 4790, MP 1503.
   Each state counts on its own, except the states whose old lists were kept
   as one, which share one running count, each number carrying its own
   state's code: Andhra Pradesh and Telangana (AP TG), Uttar Pradesh and
   Uttarakhand (UP UK), and Madhya Pradesh and Chhattisgarh (MP CG), so an
   MP member may be MP 1501, the next CG member CG 1502, the next MP member
   MP 1503. A number is unique within its series: there is never a CG 1502
   and an MP 1502. Never change which series a state is in once numbers are
   given: the register below would still refuse a clash, but the counts
   would no longer read as one.

   THE STATE. The state the member gave on the form, which the form only
   takes from the list of states, and only with a PIN code that is in it
   (lib/payment.js placeAgrees). A record whose state is missing or whose
   PIN is not in it is not numbered: it is held for a person to put right.

   NEVER THE SAME NUMBER TWICE. Every number, old or new, has one document
   in member_numbers, named by its series and number (MP-CG-1503). A new
   number is taken in one transaction that reads the series' count, steps
   past any number already in the register, and creates that document (a
   create fails if it exists), the count, and the holder's own document
   (member_number_holders/{reference}, so one membership never gets two
   numbers) together, or not at all. Two payments in the same second each
   get their own number: the second transaction sees the first's writes
   and retries.

   OLD NUMBERS FIRST. Before any number is given, every number on the old
   site's lists (lib/old-members.js, as edited by hand) is entered in the
   register as taken, and each series' count is moved past the highest old
   number in it. This runs again whenever the old list is imported anew or
   edited (its version is kept with the count). An old number is read from
   its own prefix (TG 1132 is Telangana) or, without one, from the list it
   is on (4788 on the TN list is Tamil Nadu). Old numbers that cannot be
   placed in a state, the same old number held by two different people,
   and an old number that a new member already holds are listed for PFA,
   never given again. The register keeps no names from the old list.

   COSTS NOTHING. Firestore only. */

const COLLECTION = 'member_numbers';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOLDERS = 'member_number_holders';
const COUNTER = ['counters', 'memberNumbers'];

/* Each state: the code its numbers carry, and the series it counts in.
   Codes are those the old lists used where they used one (HRY, DLH, PUD),
   and the usual two letters otherwise. `aka` are the other ways the old
   lists wrote a state. */
const STATES = {
  'Andaman and Nicobar Islands': { code: 'AN' },
  'Andhra Pradesh': { code: 'AP', series: 'AP-TG' },
  'Arunachal Pradesh': { code: 'AR' },
  Assam: { code: 'AS', aka: ['ASM'] },
  Bihar: { code: 'BR', aka: ['BIH'] },
  Chandigarh: { code: 'CH', aka: ['CHD'] },
  Chhattisgarh: { code: 'CG', series: 'MP-CG', aka: ['CT', 'CHG', 'CGH'] },
  'Dadra and Nagar Haveli and Daman and Diu': { code: 'DD', aka: ['DNH', 'DN'] },
  Delhi: { code: 'DLH', aka: ['DL', 'DEL', 'NCR'] },
  Goa: { code: 'GA', aka: ['GOA'] },
  Gujarat: { code: 'GJ', aka: ['GUJ'] },
  Haryana: { code: 'HRY', aka: ['HR', 'HAR'] },
  'Himachal Pradesh': { code: 'HP' },
  'Jammu and Kashmir': { code: 'JK', aka: ['J&K', 'JNK'] },
  Jharkhand: { code: 'JH', aka: ['JHK', 'JKD'] },
  Karnataka: { code: 'KA', aka: ['KAR', 'KTK'] },
  Kerala: { code: 'KL', aka: ['KER', 'KRL'] },
  Ladakh: { code: 'LA', aka: ['LDK'] },
  Lakshadweep: { code: 'LD' },
  'Madhya Pradesh': { code: 'MP', series: 'MP-CG' },
  Maharashtra: { code: 'MH', aka: ['MAH', 'MHR'] },
  Manipur: { code: 'MN' },
  Meghalaya: { code: 'ML' },
  Mizoram: { code: 'MZ' },
  Nagaland: { code: 'NL' },
  Odisha: { code: 'OD', aka: ['OR', 'ORI', 'ODI'] },
  Puducherry: { code: 'PUD', aka: ['PY', 'PDY', 'PON'] },
  Punjab: { code: 'PB', aka: ['PUN', 'PJB'] },
  Rajasthan: { code: 'RJ', aka: ['RAJ'] },
  Sikkim: { code: 'SK' },
  'Tamil Nadu': { code: 'TN' },
  Telangana: { code: 'TG', series: 'AP-TG', aka: ['TS', 'TEL'] },
  Tripura: { code: 'TR' },
  'Uttar Pradesh': { code: 'UP', series: 'UP-UK' },
  Uttarakhand: { code: 'UK', series: 'UP-UK', aka: ['UA', 'UT', 'UTK'] },
  'West Bengal': { code: 'WB' }
};

const seriesOfState = (name) => (STATES[name] ? STATES[name].series || STATES[name].code : '');

/* every code and other spelling, to the state it means */
const ALIAS = (() => {
  const out = {};
  for (const [name, s] of Object.entries(STATES)) {
    out[s.code] = name;
    for (const a of s.aka || []) out[a] = name;
  }
  return out;
})();

/* The series a state counts in, and the code its numbers carry. */
function placeOf(state) {
  const name = Object.keys(STATES).find((n) => n.toLowerCase() === String(state || '').trim().toLowerCase()) || '';
  return name ? { state: name, code: STATES[name].code, series: seriesOfState(name) } : null;
}

/* Every series, with the states in it (for the panel). */
function seriesList() {
  const by = {};
  for (const name of Object.keys(STATES)) {
    const id = seriesOfState(name);
    (by[id] = by[id] || []).push({ state: name, code: STATES[name].code });
  }
  return Object.keys(by).sort().map((id) => ({ series: id, states: by[id] }));
}

const docId = (series, n) => `${series}-${n}`;
const labelOf = (code, n) => `${code} ${n}`;

/* ---- the old lists ------------------------------------------------------ */

/* The state a list is for, from its name ("TN", "AP TG", "Haryana",
   "UP UK"): the series all its words agree on, or '' (the master list). */
function seriesOfList(list) {
  const text = String(list || '').toUpperCase();
  const found = new Set();
  for (const name of Object.keys(STATES)) if (text.includes(name.toUpperCase())) found.add(seriesOfState(name));
  for (const word of text.split(/[^A-Z&]+/).filter(Boolean)) if (ALIAS[word]) found.add(seriesOfState(ALIAS[word]));
  return found.size === 1 ? [...found][0] : '';
}

/* An old number, placed: { series, n, code, label } or { problem }. */
function readOld(number, list) {
  const raw = String(number || '').toUpperCase().replace(/[\s\-/.]+/g, ' ').trim();
  const m = /^([A-Z&]{1,4})?\s*0*(\d{1,7})$/.exec(raw);
  if (!m || !Number(m[2])) return { problem: `"${number}" is not a number this register can read` };
  const n = Number(m[2]);
  if (m[1]) {
    const state = ALIAS[m[1]];
    if (!state) return { problem: `"${number}" starts with ${m[1]}, which is not a state code this register knows` };
    return { series: seriesOfState(state), n, code: STATES[state].code, label: labelOf(STATES[state].code, n) };
  }
  const series = seriesOfList(list);
  if (!series) return { problem: `"${number}" (${list || 'a list with no name'}) has no state code, and that list is not for one state` };
  const states = Object.keys(STATES).filter((s) => seriesOfState(s) === series);
  const code = states.length === 1 ? STATES[states[0]].code : series.replace('-', ' ');
  return { series, n, code, label: labelOf(code, n) };
}

/* The old list as it stands, its version, and every number on it. */
async function oldNumbers(db) {
  const OLD = require('./routes/admin/old-members')._private;
  const st = await OLD.standing(db);
  if (!st) return { version: 'none', entries: [] };
  const entries = [];
  for (const m of st.state.members.values()) {
    for (const x of m.numbers || []) entries.push({ person: m.id, list: x.list, number: x.number, fromNote: Boolean(x.fromNote) });
  }
  return { version: `${st.current.importId}:${st.changes.length}`, entries };
}

/* Enter every old number in the register, and move each count past the
   highest old number in its series. Runs when the old list has changed
   since it last ran (or when forced); safe to run any number of times. */
/* one run at a time in this server; the database guards across servers */
const running = new WeakMap();
function reserveOld(db, opts = {}) {
  const busy = running.get(db);
  if (busy) return busy.then(() => reserveOldNow(db, opts));
  const p = reserveOldNow(db, opts).finally(() => { if (running.get(db) === p) running.delete(db); });
  running.set(db, p);
  return p;
}

async function retrying(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await fn(); } catch (error) {
      const busy = /ABORTED|contention/i.test(String(error && error.message)) || (error && error.code === 10);
      if (!busy || attempt >= 8) throw error;
      await sleep(20 * attempt + Math.floor(Math.random() * 40));
    }
  }
}

async function reserveOldNow(db, { nowMs = Date.now(), force = false, read = oldNumbers } = {}) {
  const counterRef = db.collection(COUNTER[0]).doc(COUNTER[1]);
  const old = await read(db);
  const counter = (await counterRef.get()).data() || {};
  if (!force && counter.oldVersion === old.version) return { state: 'already', version: old.version };

  const unplaced = [];
  const byKey = new Map();
  for (const e of old.entries) {
    const r = readOld(e.number, e.list);
    if (r.problem) { unplaced.push({ number: e.number, list: e.list, why: r.problem }); continue; }
    const key = docId(r.series, r.n);
    if (!byKey.has(key)) byKey.set(key, Object.assign({ people: new Set() }, r));
    byKey.get(key).people.add(e.person);
  }
  const sharedByTwo = [...byKey.values()].filter((x) => x.people.size > 1).map((x) => ({ label: x.label, people: x.people.size }));

  /* what is already in the register */
  const keys = [...byKey.keys()];
  const existing = new Map();
  for (let i = 0; i < keys.length; i += 200) {
    const refs = keys.slice(i, i + 200).map((k) => db.collection(COLLECTION).doc(k));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s, j) => { if (s.exists) existing.set(keys[i + j], s.data() || {}); });
  }
  const takenByNew = [];
  const at = new Date(nowMs).toISOString();
  const toWrite = [];
  for (const [key, x] of byKey) {
    const had = existing.get(key);
    if (had && had.kind === 'new') { takenByNew.push({ label: x.label, reference: had.holder || '' }); continue; }
    if (had) continue;
    toWrite.push([key, { series: x.series, n: x.n, code: x.code, label: x.label, kind: 'old', at }]);
  }
  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = db.batch();
    for (const [key, doc] of toWrite.slice(i, i + 400)) batch.set(db.collection(COLLECTION).doc(key), doc);
    await batch.commit();
  }

  /* each count past its highest old number, never backwards */
  const highest = {};
  for (const x of byKey.values()) highest[x.series] = Math.max(highest[x.series] || 0, x.n);
  await retrying(() => db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const last = Object.assign({}, (snap.data() || {}).last || {});
    for (const [s, n] of Object.entries(highest)) last[s] = Math.max(Number(last[s]) || 0, n);
    tx.set(counterRef, {
      last, oldVersion: old.version, oldSyncedAt: at,
      oldReport: {
        numbers: byKey.size, added: toWrite.length,
        unplaced: unplaced.slice(0, 200), unplacedCount: unplaced.length,
        sharedByTwo: sharedByTwo.slice(0, 200), sharedByTwoCount: sharedByTwo.length,
        takenByNew: takenByNew.slice(0, 200), takenByNewCount: takenByNew.length
      }
    }, { merge: true });
  }));
  return { state: 'reserved', version: old.version, numbers: byKey.size, added: toWrite.length, unplaced: unplaced.length, sharedByTwo: sharedByTwo.length, takenByNew: takenByNew.length };
}

/* ---- a new number ------------------------------------------------------ */

/* The next free number in the state's series, for one holder, once.
     state       the member's state, as on the form
     holderKey   one number per key, ever (the membership's reference)
     prepare(tx) optional: the caller's own reads, inside the transaction
     attach(tx, number, prepared) optional: the caller's own writes, in it
   Resolves to { number, already }: the number this holder has, whether
   given now or before. */
async function allocate(db, { state, holderKey, holder = {}, nowMs = Date.now(), prepare, attach, readOld: readOldList }) {
  const place = placeOf(state);
  if (!place) { const e = new Error(`"${state || 'No state'}" is not a state in the list, so no member number can be given.`); e.code = 'NO_STATE'; throw e; }
  const key = String(holderKey || '');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(key)) throw new Error('A member number needs the membership it is for.');
  await reserveOld(db, { nowMs, read: readOldList });
  const counterRef = db.collection(COUNTER[0]).doc(COUNTER[1]);
  const holderRef = db.collection(HOLDERS).doc(key);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.runTransaction(async (tx) => {
        const held = await tx.get(holderRef);
        const prepared = prepare ? await prepare(tx) : undefined;
        if (held.exists) {
          const number = held.data().number;
          if (attach) attach(tx, number, prepared, true);
          return { number, already: true };
        }
        const counter = await tx.get(counterRef);
        let n = (Number(((counter.data() || {}).last || {})[place.series]) || 0) + 1;
        /* step past any number already taken, old or new */
        for (let tries = 0; ; tries += 1) {
          const slot = await tx.get(db.collection(COLLECTION).doc(docId(place.series, n)));
          if (!slot.exists) break;
          if (tries > 500) throw new Error(`The ${place.series} series has 500 taken numbers in a row after its count; ask for help.`);
          n += 1;
        }
        const at = new Date(nowMs).toISOString();
        const number = { label: labelOf(place.code, n), code: place.code, n, series: place.series, state: place.state, at };
        tx.create(db.collection(COLLECTION).doc(docId(place.series, n)), Object.assign({ kind: 'new', holder: key }, number, { by: holder.by || 'website' }));
        tx.set(counterRef, { last: { [place.series]: n } }, { merge: true });
        tx.create(holderRef, { number, holder: key, at });
        if (attach) attach(tx, number, prepared, false);
        return { number, already: false };
      });
    } catch (error) {
      const busy = /ABORTED|contention|ALREADY_EXISTS|already exists/i.test(String(error && error.message)) || error.code === 10 || error.code === 6;
      if (!busy || attempt >= 8) throw error;
      await sleep(20 * attempt + Math.floor(Math.random() * 40));
    }
  }
}

/* Where the register stands, for the panel. */
async function status(db) {
  const counter = (await db.collection(COUNTER[0]).doc(COUNTER[1]).get()).data() || {};
  const last = counter.last || {};
  return {
    series: seriesList().map((s) => {
      const n = Number(last[s.series]) || 0;
      return Object.assign({}, s, { last: n, next: n + 1 });
    }),
    oldVersion: counter.oldVersion || '',
    oldSyncedAt: counter.oldSyncedAt || '',
    oldReport: counter.oldReport || null
  };
}

module.exports = { COLLECTION, HOLDERS, STATES, ALIAS, placeOf, seriesList, seriesOfList, readOld, oldNumbers, reserveOld, allocate, status, labelOf, docId };
