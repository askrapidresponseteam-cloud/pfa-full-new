'use strict';

/* Where interns do their shelter work, and the directory it builds (owner,
   3 Nov 2026, after Mrs Gandhi's note "Just remove one sentence : shelter
   work only at shelters PFA knows .... We do not know half of them as of
   now. They keep starting and all of them need help": "before one starts,
   the applicant needs to enter where they plan to work. the address in full
   with phone number, 2-3 photos of the place. this needs to come to admin
   and it has to start building a directory. and there needs to be a proper
   panel for the admin to see who worked where. their contact details etc.
   enterprise grade implementation").

   THE PLACE. Before an intern sends proof for shelter work, they name the
   shelter they will work at, in their portal: its name; the person there and
   a phone number (a second number and an email if they have them); the full
   address (building, street and area, a landmark, the town, the district,
   the state and a PIN code that is in that state); a map link if they have
   one; what animals it keeps; that the shelter has agreed; and two or three
   photographs of the place, sent first as files. It is any shelter: PFA
   does not have to know it.

   THE DIRECTORY. Each place an intern names becomes an entry in shelters,
   once. Two names for one place are one entry: the same phone number, or
   the same name at the same PIN code, finds the entry already there (both
   kept as keys in shelter_keys, taken in the same transaction as the
   entry, so two interns naming one new shelter at the same moment still
   make one). A later intern's details do not overwrite the entry: each
   intern's report is kept under it (shelters/{id}/reports/{internId}) for
   PFA to compare, their photographs are added (up to 15), and they are
   listed on it with their batch. PFA marks an entry Verified or Not a
   shelter, edits it, or merges two entries that are one place; every step
   is kept in its history and in the audit log.

   WHO WORKED WHERE. Each intern's placement is intern_places/{internId}:
   the entry, when, and every change. PFA can ask an intern to choose
   another place (a reason, emailed to them); until they do, their shelter
   proof waits. The hours an intern logs come with their proof. */

const crypto = require('crypto');
const I = require('./internship');
const INDIA = require('../assets/india-districts.js');
const RULES = require('../assets/field-rules.js');

const SHELTERS = 'shelters';
const KEYS = 'shelter_keys';
const PLACES = 'intern_places';
const TASK = 'shelter';
const PHOTOS = { min: 2, max: 3, keep: 15 };
const STATUS = { new: 'New, to check', verified: 'Verified', 'not-shelter': 'Not a shelter', merged: 'Merged' };

function fail(code, message, status, field) {
  const e = new Error(message);
  e.code = code;
  e.status = status || 400;
  if (field) e.field = field;
  return e;
}

const nowIso = (ms) => new Date(ms).toISOString();
const clean = (v, n) => I.clean(v, n);
const sha = (v) => crypto.createHash('sha256').update(String(v), 'utf8').digest('hex').slice(0, 32);

function isShelterTask(t) { return Boolean(t) && t.key === TASK; }

/* A phone: an Indian mobile, or a landline with its STD code (0 and ten
   digits, or ten digits starting 1 to 5). Digits only, as kept. */
function phoneOf(v) {
  let d = String(v || '').replace(/\D+/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  /* 0 then a mobile, unless written as an STD code and a number ("0820 2571234") */
  const std = /^\s*0\d{2,4}[\s-]+\d/.test(String(v || ''));
  if (d.length === 11 && !std && /^0[6-9]/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) return d;
  if (/^0\d{10}$/.test(d) || /^[1-5]\d{9}$/.test(d)) return d;
  return '';
}

/* A name as the directory compares it: letters and digits, no "the", no
   words for what it is (shelter, trust, foundation...). */
const NOISE = /\b(the|a|an|and|of|for|animal|animals|shelter|shelters|trust|foundation|society|charitable|welfare|home|care|centre|center|rescue|ngo|regd|registered|pvt|ltd)\b/g;
function nameKey(v) {
  return String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, '').slice(0, 60);
}

function keysOf(entry) {
  const out = [];
  if (entry.phone) out.push(`p:${entry.phone}`);
  if (entry.altPhone) out.push(`p:${entry.altPhone}`);
  const n = nameKey(entry.name);
  if (n && entry.address && entry.address.pin) out.push(`n:${n}:${entry.address.pin}`);
  return [...new Set(out)];
}

/* The place as an intern sent it, checked; or a reason, with the field. */
function readPlace(input) {
  const p = input && typeof input === 'object' ? input : {};
  const need = (v, field, say) => { if (!v) throw fail('MISSING', say, 400, field); return v; };
  const name = need(clean(p.name, 120), 'name', 'Type the shelter\'s name.');
  if (name.length < 3) throw fail('BAD', 'Type the shelter\'s full name.', 400, 'name');
  const contact = need(clean(p.contact, 80), 'contact', 'Type the name of the person you will work with there.');
  const phone = phoneOf(p.phone);
  if (!phone) throw fail('BAD', clean(p.phone, 20) ? 'That phone number is not one we can read: a 10 digit mobile, or a landline with its STD code.' : 'Type the shelter\'s phone number.', 400, 'phone');
  const altPhone = p.altPhone ? phoneOf(p.altPhone) : '';
  if (p.altPhone && clean(p.altPhone, 20) && !altPhone) throw fail('BAD', 'The second phone number is not one we can read.', 400, 'altPhone');
  const email = clean(p.email, 254).toLowerCase();
  if (email && RULES.checkField('email', email)) throw fail('BAD', RULES.checkField('email', email), 400, 'email');
  const house = need(clean(p.house, 120), 'house', 'Type the building, plot or gate the shelter is at.');
  const street = need(clean(p.street, 160), 'street', 'Type the street and area.');
  const landmark = clean(p.landmark, 120);
  const city = need(clean(p.city, 80), 'city', 'Type the town or village.');
  const state = INDIA.STATES.find((s) => s.toLowerCase() === clean(p.state, 60).toLowerCase());
  if (!state) throw fail('BAD', 'Choose the state.', 400, 'state');
  const district = clean(p.district, 60);
  if (!district) throw fail('MISSING', 'Choose the district.', 400, 'district');
  if (!INDIA.pairOk(state, district)) throw fail('BAD', `Choose a district in ${state}.`, 400, 'district');
  const pin = String(p.pin || '').replace(/\D+/g, '');
  if (!/^[1-9]\d{5}$/.test(pin)) throw fail('BAD', 'Type the 6 digit PIN code.', 400, 'pin');
  if (!INDIA.pinOk(state, pin)) {
    const where = INDIA.pinStates(pin);
    throw fail('BAD', where.length ? `PIN code ${pin} is in ${where.slice(0, 2).join(' or ')}, not ${state}.` : 'That is not a PIN code in India.', 400, 'pin');
  }
  let mapLink = clean(p.mapLink, 500);
  if (mapLink) {
    try { const u = new URL(mapLink); if (u.protocol !== 'https:') throw new Error('x'); mapLink = u.href; } catch (_) { throw fail('BAD', 'The map link should start with https://', 400, 'mapLink'); }
  }
  const animals = clean(p.animals, 160);
  if (p.agreed !== true && p.agreed !== 'yes') throw fail('MISSING', 'Tick that the shelter has agreed to your coming.', 400, 'agreed');
  return { name, contact, phone, altPhone, email, address: { house, street, landmark, city, district, state, pin }, mapLink, animals };
}

function addressLines(a) {
  const x = a || {};
  /* "Udupi, Udupi" says the town twice: the district only when it differs */
  const district = x.district && String(x.district).toLowerCase() !== String(x.city || '').toLowerCase() ? x.district : '';
  return [x.house, x.street, x.landmark, [x.city, district].filter(Boolean).join(', '), [x.state, x.pin].filter(Boolean).join(' ')].filter(Boolean);
}

/* ---- an intern names their place --------------------------------------- */

async function register(db, intern, batch, input, nowMs = Date.now()) {
  const task = ((batch && batch.tasks) || []).find(isShelterTask);
  if (!task) throw fail('NO_TASK', 'Your plan has no shelter work.', 404);
  const place = readPlace(input);
  const ids = Array.from(new Set((Array.isArray(input && input.photos) ? input.photos : []).map(String))).slice(0, PHOTOS.max + 1);
  if (ids.length < PHOTOS.min) throw fail('PHOTOS', `Add ${PHOTOS.min} or ${PHOTOS.max} photographs of the place.`, 400, 'photos');
  if (ids.length > PHOTOS.max) throw fail('PHOTOS', `Up to ${PHOTOS.max} photographs.`, 400, 'photos');
  const photos = [];
  for (const id of ids) {
    const snap = await db.collection('intern_files').doc(id).get();
    const f = snap.exists ? snap.data() || {} : null;
    if (!f || f.internId !== intern.internId) throw fail('BAD_FILE', 'A photograph here is not one you sent.', 400, 'photos');
    if (!/^image\//.test(f.type)) throw fail('BAD_FILE', 'The photographs must be pictures (JPG, PNG or WebP), not a PDF.', 400, 'photos');
    photos.push({ fileId: id, internId: intern.internId, at: nowIso(nowMs) });
  }
  const placeRef = db.collection(PLACES).doc(intern.internId);
  const keys = keysOf(place);
  const at = nowIso(nowMs);
  const out = await db.runTransaction(async (tx) => {
    const prior = await tx.get(placeRef);
    const p0 = prior.exists ? prior.data() || {} : null;
    const work = await tx.get(db.collection('intern_work').doc(`${intern.internId}__${task.key}`));
    if (work.exists && (work.data() || {}).state === 'accepted') throw fail('DONE', 'Your shelter work is accepted; the place cannot change now.', 409);
    const keySnaps = [];
    for (const k of keys) keySnaps.push(await tx.get(db.collection(KEYS).doc(sha(k))));
    /* a phone match first, then the name at the PIN */
    const hit = keySnaps.find((s) => s.exists && String(s.data().key || '').startsWith('p:')) || keySnaps.find((s) => s.exists);
    let shelterId = hit ? hit.data().shelterId : '';
    let entry = null;
    if (shelterId) {
      const s = await tx.get(db.collection(SHELTERS).doc(shelterId));
      entry = s.exists ? s.data() || {} : null;
      /* an entry merged into another: follow it */
      if (entry && entry.status === 'merged' && entry.mergedInto) {
        shelterId = entry.mergedInto;
        const t = await tx.get(db.collection(SHELTERS).doc(shelterId));
        entry = t.exists ? t.data() || {} : null;
      }
      if (!entry) shelterId = '';
    }
    let oldEntry = null;
    if (p0 && p0.shelterId && p0.shelterId !== shelterId) {
      const o = await tx.get(db.collection(SHELTERS).doc(p0.shelterId));
      oldEntry = o.exists ? o.data() || {} : null;
    }
    const internLine = { internId: intern.internId, name: clean(intern.name, 80), batchId: intern.batchId || '', at, current: true };
    if (!entry) {
      shelterId = `SH-${I.ALPHABET[crypto.randomInt(I.ALPHABET.length)]}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      entry = Object.assign({ shelterId }, place, {
        status: 'new', createdAt: at, updatedAt: at, firstBy: intern.internId,
        photos, interns: [internLine], keys,
        history: [{ at, by: intern.internId, event: 'named', note: `Named by intern ${intern.internId}` }]
      });
      tx.create(db.collection(SHELTERS).doc(shelterId), entry);
    } else {
      const interns = (entry.interns || []).filter((x) => x.internId !== intern.internId).concat([internLine]);
      const have = new Set((entry.photos || []).map((x) => x.fileId));
      const allPhotos = (entry.photos || []).concat(photos.filter((x) => !have.has(x.fileId))).slice(-PHOTOS.keep);
      tx.set(db.collection(SHELTERS).doc(shelterId), {
        interns, photos: allPhotos, updatedAt: at, keys: [...new Set((entry.keys || []).concat(keys))],
        history: (entry.history || []).slice(-80).concat([{ at, by: intern.internId, event: 'named-again', note: `Named by intern ${intern.internId}` }])
      }, { merge: true });
    }
    for (const [i, k] of keys.entries()) if (!keySnaps[i].exists) tx.set(db.collection(KEYS).doc(sha(k)), { key: k, shelterId, at });
    tx.set(db.collection(SHELTERS).doc(shelterId).collection('reports').doc(intern.internId), Object.assign({ internId: intern.internId, name: clean(intern.name, 80), at, photos: photos.map((x) => x.fileId) }, place));
    if (oldEntry) {
      tx.set(db.collection(SHELTERS).doc(p0.shelterId), { interns: (oldEntry.interns || []).map((x) => (x.internId === intern.internId ? Object.assign({}, x, { current: false, leftAt: at }) : x)), updatedAt: at }, { merge: true });
    }
    const record = {
      internId: intern.internId, batchId: intern.batchId || '', shelterId, state: 'registered', registeredAt: at, changeReason: '',
      history: ((p0 && p0.history) || []).slice(-30).concat([{ at, by: intern.internId, event: p0 ? 'changed' : 'registered', shelterId }])
    };
    tx.set(placeRef, record);
    return { shelterId, joined: Boolean(hit), entry };
  });
  for (const ph of photos) await db.collection('intern_files').doc(ph.fileId).set({ unused: false, taskKey: TASK, shelterId: out.shelterId }, { merge: true });
  return { shelterId: out.shelterId, joined: out.joined };
}

/* The intern's own view of their place. */
async function placeOf(db, internId) {
  const snap = await db.collection(PLACES).doc(internId).get();
  if (!snap.exists) return null;
  const p = snap.data() || {};
  const s = p.shelterId ? await db.collection(SHELTERS).doc(p.shelterId).get() : null;
  const e = s && s.exists ? s.data() || {} : {};
  const mine = s && s.exists ? await db.collection(SHELTERS).doc(p.shelterId).collection('reports').doc(internId).get() : null;
  const r = mine && mine.exists ? mine.data() || {} : e;
  return {
    state: p.state, registeredAt: p.registeredAt, changeReason: p.changeReason || '',
    shelter: { name: r.name || e.name || '', contact: r.contact || '', phone: r.phone || '', lines: addressLines(r.address || e.address), photos: (r.photos || []).length, status: e.status === 'verified' ? 'verified' : 'checking' }
  };
}

/* May this intern send shelter proof? A reason if not. */
async function proofBlocked(db, internId) {
  const snap = await db.collection(PLACES).doc(internId).get();
  if (!snap.exists) return 'First tell PFA where you will do your shelter work: the shelter\'s address, a phone number and two or three photographs.';
  const p = snap.data() || {};
  if (p.state === 'change') return `PFA has asked you to choose another place: ${p.changeReason || 'see your email'}. Name the new place first.`;
  return '';
}

/* ---- the panel ---------------------------------------------------------- */

/* The hours each intern logged, and the state of their shelter proof. */
async function shelterWorkOf(db, internIds) {
  const out = new Map();
  for (const id of internIds) {
    const snap = await db.collection('intern_work').doc(`${id}__${TASK}`).get();
    if (snap.exists) { const w = snap.data() || {}; out.set(id, { state: w.state || '', hours: Number(w.hours) || 0, score: w.score != null ? w.score : null }); }
  }
  return out;
}

async function list(db) {
  const snap = await db.collection(SHELTERS).get();
  const all = (snap.docs || []).map((d) => d.data() || {}).filter((e) => e.status !== 'merged');
  const ids = new Set();
  all.forEach((e) => (e.interns || []).forEach((x) => ids.add(x.internId)));
  const work = await shelterWorkOf(db, [...ids]);
  const rows = all.map((e) => {
    const interns = (e.interns || []);
    const hours = interns.reduce((n, x) => n + ((work.get(x.internId) || {}).hours || 0), 0);
    return {
      shelterId: e.shelterId, name: e.name, contact: e.contact, phone: e.phone, altPhone: e.altPhone || '', email: e.email || '',
      city: (e.address || {}).city || '', district: (e.address || {}).district || '', state: (e.address || {}).state || '', pin: (e.address || {}).pin || '',
      lines: addressLines(e.address), mapLink: e.mapLink || '', animals: e.animals || '',
      status: e.status, statusLabel: STATUS[e.status] || e.status, statusNote: e.statusNote || '',
      interns: interns.map((x) => ({ internId: x.internId, name: x.name, current: x.current !== false, hours: (work.get(x.internId) || {}).hours || 0, work: (work.get(x.internId) || {}).state || '' })),
      hours, photos: (e.photos || []).length, createdAt: e.createdAt, updatedAt: e.updatedAt
    };
  }).sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { rows, counts: { all: rows.length, new: rows.filter((r) => r.status === 'new').length, verified: rows.filter((r) => r.status === 'verified').length, notShelter: rows.filter((r) => r.status === 'not-shelter').length } };
}

async function detail(db, shelterId) {
  const snap = await db.collection(SHELTERS).doc(String(shelterId || '')).get();
  if (!snap.exists) throw fail('NOT_FOUND', 'No such shelter in the directory.', 404);
  const e = snap.data() || {};
  const reports = await db.collection(SHELTERS).doc(e.shelterId).collection('reports').get();
  const ids = (e.interns || []).map((x) => x.internId);
  const work = await shelterWorkOf(db, ids);
  const interns = [];
  for (const x of e.interns || []) {
    const i = (await db.collection('interns').doc(x.internId).get()).data() || {};
    const w = work.get(x.internId) || {};
    interns.push({ internId: x.internId, name: i.name || x.name, email: i.email || '', mobile: i.mobile || '', batchId: i.batchId || x.batchId || '', since: x.at, current: x.current !== false, leftAt: x.leftAt || '', hours: w.hours || 0, work: w.state || '', score: w.score != null ? w.score : null });
  }
  return {
    shelter: Object.assign({}, e, { lines: addressLines(e.address), statusLabel: STATUS[e.status] || e.status, history: (e.history || []).slice(-40) }),
    reports: (reports.docs || []).map((d) => { const r = d.data() || {}; return Object.assign({}, r, { lines: addressLines(r.address) }); }),
    interns
  };
}

async function setStatus(db, shelterId, status, note, by, nowMs = Date.now()) {
  if (!['new', 'verified', 'not-shelter'].includes(status)) throw fail('BAD', 'Mark it New, Verified or Not a shelter.');
  const say = clean(note, 300);
  if (status === 'not-shelter' && say.length < 5) throw fail('BAD', 'Say why it is not a shelter.');
  const ref = db.collection(SHELTERS).doc(String(shelterId || ''));
  const at = nowIso(nowMs);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail('NOT_FOUND', 'No such shelter in the directory.', 404);
    const e = snap.data() || {};
    if (e.status === 'merged') throw fail('MERGED', 'This entry was merged into another.', 409);
    tx.set(ref, { status, statusNote: say, statusBy: by, statusAt: at, updatedAt: at, history: (e.history || []).slice(-80).concat([{ at, by, event: `status:${status}`, note: say }]) }, { merge: true });
    return { shelterId: e.shelterId, status };
  });
}

/* PFA's own correction of an entry: the same checks as an intern's. */
async function edit(db, shelterId, input, by, nowMs = Date.now()) {
  const fixed = readPlace(Object.assign({}, input, { agreed: true }));
  const ref = db.collection(SHELTERS).doc(String(shelterId || ''));
  const at = nowIso(nowMs);
  const keys = keysOf(fixed);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail('NOT_FOUND', 'No such shelter in the directory.', 404);
    const e = snap.data() || {};
    const keySnaps = [];
    for (const k of keys) keySnaps.push(await tx.get(db.collection(KEYS).doc(sha(k))));
    const clash = keySnaps.find((s) => s.exists && s.data().shelterId !== e.shelterId);
    if (clash) throw fail('CLASH', `Another entry (${clash.data().shelterId}) already has that ${String(clash.data().key).startsWith('p:') ? 'phone number' : 'name at that PIN code'}. Merge the two instead.`, 409);
    const before = { name: e.name, contact: e.contact, phone: e.phone, altPhone: e.altPhone, email: e.email, address: e.address, mapLink: e.mapLink, animals: e.animals };
    tx.set(ref, Object.assign({}, fixed, { updatedAt: at, keys: [...new Set((e.keys || []).concat(keys))], history: (e.history || []).slice(-80).concat([{ at, by, event: 'edited', before }]) }), { merge: true });
    keys.forEach((k, i) => { if (!keySnaps[i].exists) tx.set(db.collection(KEYS).doc(sha(k)), { key: k, shelterId: e.shelterId, at }); });
    return { shelterId: e.shelterId };
  });
}

/* Two entries that are one place: the second is kept, folded into the first. */
async function merge(db, fromId, intoId, by, nowMs = Date.now()) {
  if (!fromId || !intoId || fromId === intoId) throw fail('BAD', 'Choose two different entries.');
  const at = nowIso(nowMs);
  const fromRef = db.collection(SHELTERS).doc(fromId);
  const intoRef = db.collection(SHELTERS).doc(intoId);
  const places = await db.collection(PLACES).where('shelterId', '==', fromId).get();
  const reports = await fromRef.collection('reports').get();
  await db.runTransaction(async (tx) => {
    const [a, b] = [await tx.get(fromRef), await tx.get(intoRef)];
    if (!a.exists || !b.exists) throw fail('NOT_FOUND', 'One of the two is not in the directory.', 404);
    const f = a.data() || {};
    const t = b.data() || {};
    if (f.status === 'merged' || t.status === 'merged') throw fail('MERGED', 'One of the two was already merged.', 409);
    const ids = new Set((t.interns || []).map((x) => x.internId));
    const interns = (t.interns || []).concat((f.interns || []).filter((x) => !ids.has(x.internId)));
    const have = new Set((t.photos || []).map((x) => x.fileId));
    const photos = (t.photos || []).concat((f.photos || []).filter((x) => !have.has(x.fileId))).slice(-PHOTOS.keep);
    const keys = [...new Set((t.keys || []).concat(f.keys || []))];
    tx.set(intoRef, { interns, photos, keys, updatedAt: at, history: (t.history || []).slice(-80).concat([{ at, by, event: 'merged-in', note: `${fromId} (${f.name}) merged into this` }]) }, { merge: true });
    tx.set(fromRef, { status: 'merged', mergedInto: intoId, updatedAt: at, history: (f.history || []).slice(-80).concat([{ at, by, event: 'merged', note: `merged into ${intoId}` }]) }, { merge: true });
    for (const k of f.keys || []) tx.set(db.collection(KEYS).doc(sha(k)), { key: k, shelterId: intoId, at });
    for (const d of places.docs || []) tx.set(d.ref, { shelterId: intoId, history: ((d.data() || {}).history || []).slice(-30).concat([{ at, by, event: 'merged', shelterId: intoId }]) }, { merge: true });
    for (const d of reports.docs || []) tx.set(intoRef.collection('reports').doc(d.id), d.data());
  });
  return { shelterId: intoId };
}

/* PFA asks an intern to work somewhere else: their shelter proof waits
   until they name the new place. */
async function askToChange(db, internId, reason, by, nowMs = Date.now()) {
  const say = clean(reason, 400);
  if (say.length < 5) throw fail('BAD', 'Say why, in a line the intern will read.');
  const ref = db.collection(PLACES).doc(String(internId || ''));
  const at = nowIso(nowMs);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail('NOT_FOUND', 'This intern has not named a place yet.', 404);
    const p = snap.data() || {};
    tx.set(ref, { state: 'change', changeReason: say, history: (p.history || []).slice(-30).concat([{ at, by, event: 'asked-to-change', note: say }]) }, { merge: true });
  });
  return { internId, state: 'change', reason: say };
}

/* The directory as a CSV for Excel. */
function csvOf(rows) {
  const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Shelter', 'Directory number', 'Status', 'Person there', 'Phone', 'Other phone', 'Email', 'Address', 'Town', 'District', 'State', 'PIN code', 'Map', 'Animals', 'Interns', 'Hours logged', 'Photographs', 'First named', 'Note'];
  const lines = [head.map(cell).join(',')].concat(rows.map((r) => [r.name, r.shelterId, r.statusLabel, r.contact, r.phone, r.altPhone, r.email, r.lines.join('\n'), r.city, r.district, r.state, r.pin, r.mapLink, r.animals, r.interns.map((x) => `${x.name} (${x.internId})`).join('; '), r.hours, r.photos, String(r.createdAt || '').slice(0, 10), r.statusNote].map(cell).join(',')));
  return Buffer.from(`\ufeff${lines.join('\r\n')}\r\n`, 'utf8');
}

module.exports = {
  SHELTERS, KEYS, PLACES, TASK, PHOTOS, STATUS,
  isShelterTask, phoneOf, nameKey, keysOf, readPlace, addressLines,
  register, placeOf, proofBlocked, list, detail, setStatus, edit, merge, askToChange, csvOf
};
