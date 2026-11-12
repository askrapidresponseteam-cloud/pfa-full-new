'use strict';

/* GET  /api/admin/registers?kind=caregiver               the colony card register, as rows
     GET  /api/admin/registers?kind=membership              the membership register, as rows
     GET  /api/admin/registers?kind=...&format=csv          the same, as a CSV (logged)
     POST /api/admin/registers { action: 'save', kind, id, courier, trackingNumber, status }
                                                          where one card stands (logged)
     POST /api/admin/registers { action: 'preview', kind, ids: [...] }
                                                          the shipping letters as they would go,
                                                          one per person, and a preview token
     POST /api/admin/registers { action: 'send', kind, ids: [...], token }
                                                          send exactly what was previewed (logged)

   The two registers the office posts cards from, laid out the way the
   office keeps them in its own sheets (owner, 2 Nov 2026, with the CACT 2026
   and membership sheets: "make the admin center for catc and membership
   look simple and easy to consume like this. with option to export and copy
   paste each item"), then (the same day) "The table should display only data
   captured by the website. Admins must be able to update the courier name,
   tracking number, and application status (e.g., Shipped), then send
   applicants an email using a standard template. Support individual and
   bulk sending, with a mandatory email preview before sending."

   Only what the website captured: a line is a paid colony card application
   (PFA-CG) or a paid membership (PFA-MEM) filed by the website, with what
   the person typed. A card issued by hand or brought in from elsewhere,
   with no application behind it, is not listed. Left out too: the site's
   testing (20 Oct 2026 and earlier, lib/test-data.js) and anything
   rejected, removed or marked as spam.

   Where each card stands (courier, tracking number, status) is kept on the
   application or membership as `shipment`, through the case module
   (lib/routes/admin/case.js shipmentStep), never over what the person
   wrote. A line is done (green) once it is shipped or delivered.

   The letter (lib/caregiver-mail.js card_shipping) is sent only after it
   has been previewed: the preview returns a token made from every letter
   exactly as shown, and send renders them again and refuses (409) if any of
   them would now read differently. */

const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const TEST = require('../../test-data');
const MC = require('../../membership-card');
const CASE = require('./case');
const FLOW = require('../../case-flow');
const crypto = require('crypto');

const IST_MS = 330 * 60000;
const MAX_ROWS = 2000;
const KINDS = { caregiver: 'caregivers', membership: 'membership' };
const PREFIX = { caregiver: 'PFA-CG', membership: 'PFA-MEM' };
const LEFT_OUT = new Set(['rejected', 'removed', 'spam', 'withdrawn']);
const SHIP = { processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned to sender' };
const DONE = new Set(['shipped', 'delivered']);
const INDIA_POST = /india\s*post|speed\s*post|registered\s*post|\bepost\b/i;
const MAX_IDS = 200;
/* a send stops delivering itself after this long; the rest are queued and
   the email worker sends them within minutes */
const SEND_BUDGET_MS = 7000;

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const pad = (n) => String(n).padStart(2, '0');
const bare = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) raw = raw.slice(0, 64 * 1024); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function millis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return 0;
}

/* 28/11/2025, India time, as the office's sheets write it */
function day(v) {
  const ms = millis(v);
  if (!ms) return '';
  const d = new Date(ms + IST_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/* 2026-11-05, India time */
function isoDay(ms) {
  const d = new Date(Number(ms) + IST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/* 2026-11-05 as 05/11/2026 */
function dmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function mobile(v) {
  const d = String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^\d{10}$/.test(d) ? d : clean(v, 20);
}

/* The address as the envelope reads it, three lines at most:
     Flat 4B, Sai Residency, 2nd Floor, 12th Cross, Kodavoor, Near Krishna Temple
     Udupi
     Karnataka - 576101
   The town, and the district when it is not the town, each once. */
function linesOf(p) {
  const pin = clean(p.pin, 10).replace(/\D/g, '');
  let street = clean(p.address, 300).replace(/\s*,\s*$/, '');
  if (pin && street.includes(pin)) street = street.replace(new RegExp(`[\\s,-]*${pin}`), '').trim().replace(/,\s*$/, '');
  const has = (word) => word && bare(street).includes(bare(word));
  const place = [];
  for (const w of [clean(p.city, 80), clean(p.district, 80)]) {
    if (w && !has(w) && !place.some((x) => bare(x) === bare(w) || bare(x).includes(bare(w)) || bare(w).includes(bare(x)))) place.push(w);
  }
  const lines = [];
  if (street) lines.push(street);
  if (place.length) lines.push(place.join(', '));
  const last = [clean(p.state, 40), pin].filter(Boolean).join(' - ');
  if (last) lines.push(last);
  return lines;
}

/* ---- where a card stands ---------------------------------------------- */

/* The shipment on record, or what the older steps already said: a card
   marked posted in Print and post, a membership card dispatched by courier
   or its kit delivered. */
function shipmentOf(d, legacy) {
  const s = d.shipment || null;
  if (s && SHIP[s.status]) return { courier: clean(s.courier, 60), trackingNumber: clean(s.trackingNumber, 60), status: s.status, shippedOn: clean(s.shippedOn, 10), emails: Array.isArray(s.emails) ? s.emails : [], updatedAt: s.updatedAt || '' };
  return Object.assign({ courier: '', trackingNumber: '', status: '', shippedOn: '', emails: [], updatedAt: '' }, legacy || {});
}

function shipFields(sh) {
  const last = sh.emails.length ? sh.emails[sh.emails.length - 1] : null;
  /* the day it left (5 Nov 2026, the Google Sheet's "Shipped on"); a card
     marked shipped before the day was kept takes the day it was marked */
  const shippedOn = /^\d{4}-\d{2}-\d{2}$/.test(sh.shippedOn || '') ? sh.shippedOn
    : DONE.has(sh.status) && millis(sh.updatedAt) ? isoDay(millis(sh.updatedAt)) : '';
  return {
    courier: sh.courier, tracking: sh.trackingNumber, ship: sh.status, shipLabel: SHIP[sh.status] || '', shippedOn, shippedOnLabel: dmy(shippedOn),
    emailed: last ? `${SHIP[last.status] || last.status} on ${day(last.at)}` : '', done: DONE.has(sh.status)
  };
}

/* ---- the colony card register ---------------------------------------- */

async function caregiverRows(db) {
  const [apps, cards] = await Promise.all([
    db.collection('submissions').where('kind', '==', 'PFA-CG').get(),
    db.collection('caretakerCards').limit(MAX_ROWS).get().catch(() => ({ docs: [] }))
  ]);
  const cardOf = new Map();
  for (const doc of cards.docs || []) {
    const c = doc.data() || {};
    const ref = clean(c.applicationRef, 40);
    if (ref) cardOf.set(ref, Object.assign({ id: doc.id }, c));
  }
  const rows = [];
  for (const doc of apps.docs || []) {
    const d = doc.data() || {};
    if (TEST.isTest(d) || LEFT_OUT.has(String(d.status || ''))) continue;
    const f = d.fields || {};
    const card = cardOf.get(doc.id) || null;
    const place = { address: clean(f.address, 300), city: clean(f.city, 80), district: clean(f.district, 60), state: clean(f.state, 40), pin: clean(f.pin || f.pincode, 10).replace(/\D/g, '') };
    const sh = shipmentOf(d, card && card.cardPostedAt ? { status: 'shipped' } : null);
    rows.push(Object.assign({
      id: doc.id,
      cardId: card ? card.id : '',
      caregiverNo: clean(d.caregiverNo && d.caregiverNo.label, 24),
      /* the number it was before the state codes of 11 Nov 2026 */
      caregiverNoWas: clean(d.caregiverNo && d.caregiverNo.was, 24),
      numberHold: clean(d.caregiverNumberHold && d.caregiverNumberHold.reason, 200),
      /* how the state was found when the form had none (lib/member-numbers.js stateOf) */
      numberNote: clean(d.caregiverNo && d.caregiverNo.note, 200),
      name: require('../../../assets/field-rules.js').nameCase(clean(f.name, 100)),
      mobile: mobile(f.mobile),
      altMobile: mobile(f.altMobile),
      email: clean(f.email, 254).toLowerCase(),
      address: place.address, floor: clean(f.floor, 40), city: place.city, district: place.district, state: place.state, pin: place.pin,
      colony: clean(f.colony, 120),
      /* how many animals, and anything else they told us */
      notes: clean(f.notes, 500),
      appStatus: FLOW.labelOf('PFA-CG', d.status || 'new'),
      lines: linesOf(place),
      appliedOn: day(d.receivedAtMs || d.createdAt),
      issuedOn: card ? day(card.issuedAt) : '',
      sortMs: Number(d.receivedAtMs) || millis(d.createdAt)
    }, shipFields(sh)));
  }
  rows.sort((a, b) => a.sortMs - b.sortMs || a.id.localeCompare(b.id));
  return rows;
}

/* ---- the membership register ------------------------------------------ */

function amountOf(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
}

async function membershipRows(db, nowMs = Date.now()) {
  const snap = await db.collection('submissions').where('kind', '==', 'PFA-MEM').get();
  const rows = [];
  for (const doc of snap.docs || []) {
    const d = doc.data() || {};
    if (TEST.isTest(d)) continue;
    if (LEFT_OUT.has(String(d.status || ''))) continue;
    const f = d.fields || {};
    const r = MC.rowOf(doc.id, d, nowMs);
    const place = { address: clean(f.address, 300), city: clean(f.city, 80), district: clean(f.district, 60), state: clean(f.state, 40), pin: clean(f.pin || f.pincode, 10).replace(/\D/g, '') };
    const legacy = r.dispatchedAt ? { courier: r.courier || '', trackingNumber: r.trackingNumber || '', status: d.status === 'delivered' ? 'delivered' : 'shipped' } : null;
    const sh = shipmentOf(d, legacy);
    rows.push(Object.assign({
      id: doc.id,
      memberNo: r.memberNo || '',
      memberNoWas: clean(d.memberNo && d.memberNo.was, 24),
      /* optional on the form (11 Nov 2026): 12/05/1990 */
      dob: /^\d{4}-\d{2}-\d{2}$/.test(String(f.dob || '')) ? String(f.dob).split('-').reverse().join('/') : '',
      numberHold: r.numberHold || '',
      numberNote: clean(d.memberNo && d.memberNo.note, 200),
      cardId: r.cardId || '',
      name: r.name,
      mobile: mobile(f.mobile),
      altMobile: mobile(f.altMobile),
      email: r.email,
      address: place.address, floor: clean(f.floor, 40), city: place.city, district: place.district, state: place.state, pin: place.pin,
      lines: linesOf(place),
      type: r.tier,
      kit: clean(f.kit, 200),
      appStatus: FLOW.labelOf('PFA-MEM', d.status || 'new'),
      amount: amountOf(f.amount),
      paidOn: day(r.receivedAtMs),
      cardStage: r.queueLabel,
      sortMs: r.receivedAtMs
    }, shipFields(sh)));
  }
  rows.sort((a, b) => a.sortMs - b.sortMs || a.id.localeCompare(b.id));
  return rows;
}

/* ---- the CSV ----------------------------------------------------------- */

const COLUMNS = {
  caregiver: [
    ['Name', 'name'], ['Caregiver number', 'caregiverNo'], ['Earlier number', 'caregiverNoWas'], ['Phone number', 'mobile'], ['Other phone', 'altMobile'], ['Email', 'email'],
    ['Address', (r) => r.lines.join('\n')], ['House, street and area', 'address'], ['City', 'city'], ['District', 'district'], ['State', 'state'], ['PIN code', 'pin'],
    ['Application number', 'id'], ['Applied on', 'appliedOn'], ['Card number', 'cardId'], ['Issued on', 'issuedOn'],
    ['Courier', 'courier'], ['Tracking number', 'tracking'], ['Status', 'shipLabel'], ['Last email', 'emailed']
  ],
  membership: [
    ['Name', 'name'], ['Phone number', 'mobile'], ['Other phone', 'altMobile'], ['Email', 'email'],
    ['Address', (r) => r.lines.join('\n')], ['House, street and area', 'address'], ['City', 'city'], ['District', 'district'], ['State', 'state'], ['PIN code', 'pin'],
    ['Membership type', 'type'], ['Amount', 'amount'], ['Date', 'paidOn'], ['Member number', 'memberNo'], ['Membership reference', 'id'], ['Card number', 'cardId'],
    ['Courier', 'courier'], ['Tracking number', 'tracking'], ['Status', 'shipLabel'], ['Last email', 'emailed'],
    /* the number it had before the state codes of 11 Nov 2026 */
    ['Earlier number', 'memberNoWas'], ['Date of birth', 'dob']
  ]
};

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvOf(kind, rows) {
  const cols = COLUMNS[kind];
  const lines = [cols.map(([h]) => csvCell(h)).join(',')];
  for (const r of rows) lines.push(cols.map(([, k]) => csvCell(typeof k === 'function' ? k(r) : r[k])).join(','));
  /* Excel reads UTF-8 by its mark; CRLF between lines, a line break inside a
     quoted cell stays a line break in the cell */
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

function fileName(kind, nowMs) {
  const d = new Date(nowMs + IST_MS);
  return `PFA-${kind === 'caregiver' ? 'colony-cards' : 'members'}-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}.csv`;
}

/* ---- saving where a card stands ---------------------------------------- */

function refOf(db, kind, id) {
  const ref = clean(id, 40);
  if (!new RegExp(`^${PREFIX[kind]}-\\d{4}-\\d{5}$`).test(ref)) return null;
  return { id: ref, doc: db.collection('submissions').doc(ref) };
}

/* What the office typed, checked: a shipped card names its courier and its
   tracking number, so the person can follow it. */
function shipmentInput(body) {
  const status = String(body.status || '');
  if (!SHIP[status]) return { error: 'Choose a status: Processing, Shipped, Delivered or Returned to sender.' };
  const courier = MC.courierOf(body.courier);
  const rawTracking = clean(body.trackingNumber, 60);
  const trackingNumber = rawTracking ? MC.trackingOf(rawTracking) : '';
  if (rawTracking && !trackingNumber) return { error: 'A tracking number is 4 to 40 letters and digits.' };
  /* once it has left PFA (shipped, delivered, or back again) the card has a
     courier and a number the person can follow; India Post's is EE123456789IN */
  if (status !== 'processing' && (courier.length < 2 || !trackingNumber)) return { error: `A card marked ${SHIP[status].toLowerCase()} needs the courier and the tracking number.` };
  if (trackingNumber && INDIA_POST.test(courier) && !/^[A-Z]{2}\d{9}IN$/.test(trackingNumber)) return { error: 'An India Post number looks like EE123456789IN: 2 letters, 9 digits, then IN.' };
  /* the day it left, when it is given (the Google Sheet gives it; the
     panel leaves it to the day the card is marked shipped) */
  const shippedOn = clean(body.shippedOn, 10);
  if (shippedOn) {
    const ms = Date.parse(`${shippedOn}T00:00:00Z`);
    const today = isoDay(body.nowMs || Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shippedOn) || !Number.isFinite(ms) || isoDay(ms - IST_MS) !== shippedOn || shippedOn < '2020-01-01' || shippedOn > today) {
      return { error: 'The shipping date is not a real date, or it is later than today.' };
    }
  }
  return { status, courier, trackingNumber, shippedOn };
}

async function save(db, kind, body, who, nowMs) {
  const r = refOf(db, kind, body.id);
  if (!r) return { status: 400, body: { code: 'BAD_ID', message: 'Choose an application.' } };
  const input = shipmentInput(Object.assign({}, body, { nowMs }));
  if (input.error) return { status: 422, body: { code: 'BAD_SHIPMENT', message: input.error } };
  const at = new Date(nowMs).toISOString();
  const by = who.email || who.uid || 'admin';
  const firebase = require('../../firebase');
  const done = await db.runTransaction(async (tx) => {
    const snap = await tx.get(r.doc);
    if (!snap.exists) return { status: 404, body: { code: 'NOT_FOUND', message: 'That application is not on record.' } };
    const d = snap.data() || {};
    if (d.kind !== PREFIX[kind]) return { status: 404, body: { code: 'NOT_FOUND', message: 'That application is not on record.' } };
    const old = d.shipment || {};
    /* the day it left: as given, or as kept, or today once it is marked
       shipped; a card back to being prepared has not left */
    const shippedOn = input.shippedOn || (input.status !== 'processing' ? (old.shippedOn || isoDay(nowMs)) : '');
    const shipment = { courier: input.courier, trackingNumber: input.trackingNumber, status: input.status, shippedOn, updatedAt: at, updatedBy: by, emails: Array.isArray(old.emails) ? old.emails.slice(-19) : [] };
    const same = old.status === shipment.status && (old.courier || '') === shipment.courier && (old.trackingNumber || '') === shipment.trackingNumber && (old.shippedOn || '') === shipment.shippedOn;
    if (same) return { status: 200, body: { ok: true, unchanged: true } };
    CASE.shipmentStep(tx, r.doc, firebase.fieldValue, { event: 'shipment', at, by, status: d.status, shipment,
      note: `Card ${({ processing: 'being prepared', returned: 'returned to sender' })[input.status] || input.status}${input.courier ? `, ${input.courier}` : ''}${input.trackingNumber ? `, tracking number ${input.trackingNumber}` : ''}${shippedOn ? `, sent on ${dmy(shippedOn)}` : ''}${body.via ? ` (${body.via})` : ''}.` });
    return { status: 200, body: { ok: true } };
  });
  if (done.status === 200 && !done.body.unchanged) {
    await audit.record(who, { module: KINDS[kind], action: 'shipment-updated', subject: r.id, detail: `${SHIP[input.status]}${input.courier ? `, ${input.courier}` : ''}${input.trackingNumber ? ` ${input.trackingNumber}` : ''}${input.shippedOn ? `, sent on ${dmy(input.shippedOn)}` : ''}${body.via ? ` (${body.via})` : ''}` });
  }
  return done;
}

/* ---- the letters: preview, then send exactly that ----------------------- */

async function letters(db, kind, ids, siteUrl) {
  const mail = require('../../caregiver-mail');
  const unique = [...new Set((Array.isArray(ids) ? ids : []).map((x) => clean(x, 40)).filter(Boolean))];
  const out = [];
  for (const id of unique) {
    const r = refOf(db, kind, id);
    const snap = r ? await r.doc.get() : null;
    const d = snap && snap.exists ? snap.data() || {} : null;
    if (!d || d.kind !== PREFIX[kind] || TEST.isTest(d) || LEFT_OUT.has(String(d.status || ''))) { out.push({ id, ok: false, problem: 'Not on record.' }); continue; }
    const f = d.fields || {};
    const name = require('../../../assets/field-rules.js').nameCase(clean(f.name, 100));
    const to = clean(f.email, 254).toLowerCase();
    const sh = d.shipment || {};
    let cardId = '';
    if (kind === 'membership') cardId = clean(d.memberCard && d.memberCard.cardId, 40);
    else {
      const cards = await db.collection('caretakerCards').where('applicationRef', '==', id).limit(1).get().catch(() => ({ docs: [] }));
      cardId = cards.docs && cards.docs[0] ? cards.docs[0].id : '';
    }
    const problem = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) ? 'No email address on the application.'
      : !SHIP[sh.status] ? 'Set the status and save it first.'
      : sh.status !== 'processing' && (!sh.courier || !sh.trackingNumber) ? 'Add the courier and the tracking number, and save.'
      : '';
    if (problem) { out.push({ id, name, to, ok: false, problem }); continue; }
    const place = { address: clean(f.address, 300), city: clean(f.city, 80), district: clean(f.district, 60), state: clean(f.state, 40), pin: clean(f.pin || f.pincode, 10).replace(/\D/g, '') };
    const payload = {
      kind, name, reference: id, cardId, status: sh.status, statusLabel: SHIP[sh.status],
      courier: clean(sh.courier, 60), trackingNumber: clean(sh.trackingNumber, 60), addressLines: linesOf(place), siteUrl
    };
    const rendered = mail.render('card_shipping', payload);
    out.push({ id, name, to, ok: true, status: sh.status, payload, subject: rendered.subject, html: rendered.html, text: rendered.text });
  }
  return out;
}

/* The token: every letter as shown, by whom. Send makes it again from the
   records as they are then; a letter that would read differently (a status
   changed, a tracking number fixed, an email address corrected) refuses. */
function tokenOf(items, who) {
  const h = crypto.createHash('sha256');
  h.update(String(who.uid || who.email || ''));
  for (const x of items.filter((i) => i.ok)) h.update(`\u0000${x.id}\u0000${x.to}\u0000${x.subject}\u0000${x.text}`);
  return h.digest('hex');
}

async function send(db, kind, items, token, who, nowMs, deps) {
  const store = deps.queue || require('../../caregiver-store');
  const mail = deps.mail || require('../../caregiver-mail');
  const firebase = require('../../firebase');
  const by = who.email || who.uid || 'admin';
  const started = Date.now();
  const results = [];
  for (const x of items) {
    if (!x.ok) { results.push({ id: x.id, state: 'skipped', reason: x.problem }); continue; }
    const at = new Date(nowMs).toISOString();
    const configured = mail.isConfigured();
    const inTime = Date.now() - started < SEND_BUDGET_MS;
    let state = 'queued';
    let reason = '';
    try {
      const queued = await store.queueEmail({ template: 'card_shipping', to: x.to, payload: x.payload, dedupeKey: `${x.id}:${token.slice(0, 20)}`, claim: configured && inTime ? 'registers' : undefined });
      if (!queued.created) state = queued.status === 'sent' ? 'sent' : 'queued';
      else if (configured && inTime) {
        try {
          const sent = await mail.deliver({ to: x.to, template: 'card_shipping', payload: x.payload });
          await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent && sent.providerId });
          state = 'sent';
        } catch (error) {
          await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
          reason = 'Not sent just now; it will be tried again.';
        }
      } else if (!configured) reason = 'Email is not set up on the server; the letter is queued.';
      if (queued.created) {
        const r = refOf(db, kind, x.id);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(r.doc);
          const d = snap.exists ? snap.data() || {} : {};
          const old = d.shipment || {};
          const emails = (Array.isArray(old.emails) ? old.emails.slice(-19) : []).concat([{ at, by, status: x.status, to: x.to, emailId: queued.emailId }]);
          CASE.shipmentStep(tx, r.doc, firebase.fieldValue, { event: 'shipment-emailed', at, by, status: d.status, shipment: Object.assign({}, old, { emails }),
            note: `Shipping letter (${SHIP[x.status]}) sent to ${x.to}.` });
        });
      }
    } catch (error) {
      state = 'failed';
      reason = 'The letter could not be queued.';
      console.error('shipping letter not queued', x.id, error && error.message);
    }
    results.push({ id: x.id, to: x.to, state, reason });
  }
  return results;
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());

  return async function handler(request, response) {
    const q = queryOf(request);
    const body = request.method === 'POST' ? await readBody(request) : {};
    const kind = String(q.kind || body.kind || '');
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) {
      /* asked who is calling first, so a stranger learns nothing either way */
      const who = await requireAdmin(request, response, 'overview');
      if (!who) return undefined;
      return sendJson(response, 400, { code: 'BAD_KIND', message: 'Ask for kind=caregiver or kind=membership.' });
    }
    const who = await requireAdmin(request, response, KINDS[kind]);
    if (!who) return undefined;
    if (request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const db = getDb();
      const nowMs = now();
      if (request.method === 'POST') {
        const siteUrl = require('../../public-site').publicSite();
        if (body.action === 'save') {
          const done = await save(db, kind, body, who, nowMs);
          return sendJson(response, done.status, done.body);
        }
        if (body.action === 'preview' || body.action === 'send') {
          const ids = Array.isArray(body.ids) ? body.ids : [];
          if (!ids.length) return sendJson(response, 400, { code: 'NO_IDS', message: 'Choose who to write to.' });
          if (ids.length > MAX_IDS) return sendJson(response, 400, { code: 'TOO_MANY', message: `At most ${MAX_IDS} at a time.` });
          const items = await letters(db, kind, ids, siteUrl);
          const token = tokenOf(items, who);
          if (body.action === 'preview') {
            return sendJson(response, 200, { ok: true, token, items: items.map((x) => ({ id: x.id, name: x.name || '', to: x.to || '', ok: x.ok, problem: x.problem || '', status: x.status || '', subject: x.subject || '', html: x.html || '' })) });
          }
          if (!items.some((x) => x.ok)) return sendJson(response, 422, { code: 'NOTHING_TO_SEND', message: 'None of these can be sent: see each one.' });
          if (String(body.token || '') !== token) return sendJson(response, 409, { code: 'PREVIEW_STALE', message: 'Something changed since the preview. Preview again, then send.' });
          const results = await send(db, kind, items, token, who, nowMs, d);
          const sent = results.filter((x) => x.state === 'sent').length;
          const queued = results.filter((x) => x.state === 'queued').length;
          await audit.record(who, { module: KINDS[kind], action: 'shipping-letters-sent', subject: kind, detail: `${sent} sent, ${queued} queued, ${results.length - sent - queued} not sent: ${results.map((x) => x.id).join(', ').slice(0, 400)}` }, request);
          return sendJson(response, 200, { ok: true, results, sent, queued });
        }
        /* the Google Sheet, brought up to date now (lib/register-sheet.js) */
        if (body.action === 'sheet') {
          const SHEET = d.sheet || require('../../register-sheet');
          const ran = await SHEET.sync(db, { force: true });
          await audit.record(who, { module: KINDS[kind], action: 'register-sheet-updated', subject: kind, detail: ran.ok ? `${ran.applied.length} typed in the sheet taken, ${ran.refused.length} not taken` : `not updated: ${ran.code}` }, request);
          return sendJson(response, 200, { ok: true, sheet: ran });
        }
        return sendJson(response, 400, { code: 'BAD_ACTION', message: 'action must be save, preview, send or sheet.' });
      }
      /* Opening the membership register numbers whoever is waiting, there
         and then, rather than at the email worker's next run (owner, 3 Nov
         2026: "still dont see the membership number issue sorted"); what
         could not be numbered, and why, comes back with the list. */
      let numbering;
      if (String(q.format || '') !== 'csv') {
        const CASEMOD = require('./case');
        const give = kind === 'membership' ? CASEMOD.numberWaitingMembers : CASEMOD.numberWaitingCaregivers;
        numbering = await give(db, { limit: 40, nowMs, by: `admin:${who.email || who.uid || ''}` })
          .catch((error) => ({ error: `${kind === 'membership' ? 'Member' : 'Caregiver'} numbers could not be given just now: ${String((error && error.message) || error).slice(0, 200)}` }));
      }
      const rows = kind === 'caregiver' ? await caregiverRows(db) : await membershipRows(db, nowMs);
      if (String(q.format || '') === 'csv') {
        await audit.record(who, { module: KINDS[kind], action: 'register-exported', subject: kind, detail: `${rows.length} rows` }, request);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="${fileName(kind, nowMs)}"`);
        response.setHeader('Cache-Control', 'no-store');
        return response.end(csvOf(kind, rows));
      }
      /* the member numbers, series by series, and what the old lists left for PFA (lib/member-numbers.js) */
      const numbers = kind === 'membership' ? await require('../../member-numbers').status(db).catch((error) => ({ error: String((error && error.message) || error).slice(0, 200), series: [] })) : undefined;
      const sheet = await (d.sheet || require('../../register-sheet')).statusOf(db).catch(() => null);
      /* PFA's state code directory (lib/member-numbers.js directory), in both registers */
      const codes = require('../../member-numbers').directory();
      return sendJson(response, 200, { ok: true, kind, statuses: SHIP, numbers, numbering, sheet, codes, rows: rows.map((r) => { const o = Object.assign({}, r); delete o.sortMs; return o; }) });
    } catch (error) {
      console.error('register route failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports._test = { linesOf, csvOf, day, caregiverRows, membershipRows, shipmentInput, tokenOf, SHIP };
/* for the Google Sheet (lib/register-sheet.js): the same lines, and the same
   checked, logged way of saving where a card stands */
module.exports.register = { caregiverRows, membershipRows, save, SHIP, DONE, KINDS, isoDay, dmy, day };
