'use strict';

/* GET  /api/admin/letters                         letters issued, newest first, and what the
                                                   studio starts from (its templates, the places)
   GET  /api/admin/letters?people=<words>           people to write to, from the People directory:
                                                   name, address and email
   GET  /api/admin/letters?number=<ref>&format=pdf  an issued letter, as issued (logged)
   POST /api/admin/letters { action: 'preview', letter }    the letter as it would be issued, a PDF
   POST /api/admin/letters { action: 'issue', letter }      given its reference, kept, logged
   POST /api/admin/letters { action: 'mail', number, email } the email as it would go
   POST /api/admin/letters { action: 'email', number, email } emailed with its PDF (logged)
   POST /api/admin/letters { action: 'withdraw', number, reason }

   The Letter studio (owner, 20 Nov 2026: "add this feature to the admin
   panel. admin should be able to select the name of the person and issue
   the cert. the cert should automatically take the address from the
   selected. also the email ID should be fetchable"). lib/letters.js makes
   the letter.

   A letter carries Maneka Sanjay Gandhi's signature, so it is its own
   module, 'letters': a super admin has it, staff only when ticked on the
   People page. Issuing gives it the next reference of the year, in one
   transaction with the record (PFA/LET/2026/00001), keeps the PDF exactly
   as issued (lib/file-store.js), and writes the audit log. A withdrawn
   letter is never emailed. */

const crypto = require('crypto');
const adminAuth = require('../../admin-auth');
const firebase = require('../../firebase');
const audit = require('../../admin-audit');
const L = require('../../letters');

const MODULE = 'letters';
const COLLECTION = 'letters';
/* a PDF kept in its record when the bucket is away must leave room for the rest */
const RECORD_MAX = 900 * 1024;
const PEOPLE_TTL = 60 * 1000;
const PEOPLE_MAX = 12;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return resolve({}); } }
    request.on('data', (c) => { raw += c; if (raw.length > 200000) raw = raw.slice(0, 200000); });
    request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (_) { resolve({}); } });
    request.on('error', () => resolve({}));
  });
}

function queryOf(request) {
  if (request.query && typeof request.query === 'object') return request.query;
  try { return Object.fromEntries(new URL(request.url || '/', 'https://pfa.invalid').searchParams); } catch (_) { return {}; }
}

const short = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const emailOf = (v) => { const e = short(v, 254).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''; };
/* PFA-LET-K7M2Q9XA; the first letters, PFA/LET/2026/00001 (or PFA-LET-2026-00001) */
const numberOf = (v) => {
  const n = short(v, 30).toUpperCase();
  if (L.NUMBER.test(n)) return n;
  const legacy = n.replace(/^PFA-LET-(\d{4})-(\d{5})$/, 'PFA/LET/$1/$2');
  return L.LEGACY.test(legacy) ? legacy : '';
};

/* The People directory, read at most once a minute per instance: it reads
   every register (lib/people-directory.js). */
let peopleCache = null;
async function peopleOf(db, nowMs, read) {
  if (peopleCache && peopleCache.db === db && nowMs - peopleCache.at < PEOPLE_TTL) return peopleCache.people;
  const people = await (read || require('../../people-directory').read)(db);
  peopleCache = { db, at: nowMs, people };
  return people;
}
function findPeople(people, q) {
  const words = short(q, 80).toLowerCase().split(' ').filter(Boolean);
  if (!words.length) return [];
  const LABEL = Object.fromEntries(require('../../people-directory').CATEGORIES.map((c) => [c.key, c.label]));
  return people.filter((p) => {
    const hay = [p.name, p.email, (p.otherEmails || []).join(' '), p.mobile, p.address, p.district, p.state, p.pin].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  }).sort((a, b) => {
    /* a name that starts with what was typed first */
    const w = words[0];
    const sa = String(a.name || '').toLowerCase().startsWith(w) ? 0 : 1;
    const sb = String(b.name || '').toLowerCase().startsWith(w) ? 0 : 1;
    return sa - sb || String(a.name || '').localeCompare(String(b.name || ''));
  }).slice(0, PEOPLE_MAX).map((p) => ({
    id: p.id, name: p.name || '', email: p.email || '', otherEmails: p.otherEmails || [], mobile: p.mobile || '',
    address: p.address || '', district: p.district || '', state: p.state || '', pin: p.pin || '',
    categories: (p.categories || []).map((c) => LABEL[c] || c),
    recipient: L.recipientOf(p),
    /* the address alone, for a letter that names them in its words */
    addressBlock: L.recipientOf(p, false),
    records: p.records || []
  }));
}

/* The email, as it would go. */
function mailOf(number, l, to) {
  const payload = { name: L.rowOf(L.docIdOf(number), l).name, number, kind: l.kind, subject: l.subject || '', dateWords: L.dateWords(l.date), pdfName: L.fileName(number), verifyUrl: L.verifyUrl(number) };
  const r = require('../../caregiver-mail').render('pfa_letter', payload);
  return { payload, to, subject: r.subject, html: r.html, text: r.text };
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || firebase.getDb;
  const requireAdmin = d.requireAdmin || adminAuth.requireAdmin;
  const now = d.now || (() => Date.now());
  const makeNumber = d.makeNumber || L.newNumber;
  const fileStore = d.fileStore || require('../../file-store');

  async function pdfBytesOf(l, number) {
    let bytes = l.pdf ? await fileStore.read(l.pdf) : null;
    if (!bytes) bytes = (await L.pdfOf(L.letterOfRecord(l), { number })).bytes;
    return Buffer.from(bytes);
  }

  return async function handler(request, response) {
    const who = await requireAdmin(request, response, MODULE);
    if (who && request.method !== 'GET' && request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
    }
    if (!who) return undefined;
    const by = { email: who.email || '', name: who.name || '' };
    try {
      const db = getDb();
      const nowMs = now();
      const at = new Date(nowMs).toISOString();

      if (request.method === 'GET') {
        const q = queryOf(request);
        if (q.people != null) {
          const people = await peopleOf(db, nowMs, d.readPeople);
          const found = findPeople(people, q.people);
          /* each donor's donations, so the certificate can say how much (owner,
             20 Nov 2026: "amount isnt there in the body") */
          for (const p of found) {
            p.donations = await L.donationsOf(db, p);
            delete p.records;
          }
          return sendJson(response, 200, { ok: true, people: found });
        }
        if (q.number != null) {
          const number = numberOf(q.number);
          if (!number) return sendJson(response, 400, { code: 'BAD_NUMBER', message: 'That is not a letter reference.' });
          const snap = await db.collection(COLLECTION).doc(L.docIdOf(number)).get();
          if (!snap.exists) return sendJson(response, 404, { code: 'NO_LETTER', message: 'No letter has that reference.' });
          const l = snap.data() || {};
          const bytes = await pdfBytesOf(l, number);
          await audit.record(who, { module: MODULE, action: 'letter-downloaded', subject: number, detail: `${L.rowOf(snap.id, l).name}${l.withdrawn ? ' (withdrawn)' : ''}` }, request);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/pdf');
          response.setHeader('Content-Disposition', `attachment; filename="${L.fileName(number)}"`);
          response.setHeader('Cache-Control', 'no-store');
          return response.end(bytes);
        }
        const snap = await db.collection(COLLECTION).get();
        const letters = snap.docs.map((doc) => L.rowOf(doc.id, doc.data() || {}))
          .sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)) || b.number.localeCompare(a.number));
        return sendJson(response, 200, {
          ok: true, letters, today: L.todayIst(nowMs), maxPages: L.MAX_PAGES,
          templates: L.KIND_ORDER.map((k) => Object.assign({ kind: k }, L.TEMPLATES[k])),
          layout: L.LAYOUT
        });
      }

      const body = await readBody(request);

      if (body.action === 'preview' || body.action === 'issue') {
        const issuing = body.action === 'issue';
        const checked = L.check(body.letter, nowMs, issuing);
        if (!checked.ok) return sendJson(response, 422, { code: 'BAD_FIELD', field: checked.field, message: checked.message });
        const v = checked.values;
        /* made first without a reference: too long is refused before a reference is taken */
        const draft = await L.pdfOf(v, {});
        if (draft.pages > L.MAX_PAGES) return sendJson(response, 422, { code: 'TOO_LONG', field: 'body', message: `The letter runs to ${draft.pages} pages; the most is ${L.MAX_PAGES}. Shorten it.` });
        if (!issuing) return sendJson(response, 200, { ok: true, pages: draft.pages, pdf: draft.bytes.toString('base64') });
        /* a reference at random, never one already given */
        const record = Object.assign({}, v, { issuedAt: at, issuedBy: by, withdrawn: false });
        let number = '';
        for (let tries = 0; tries < 8 && !number; tries += 1) {
          const candidate = makeNumber();
          if (!L.NUMBER.test(candidate)) continue;
          try {
            await db.collection(COLLECTION).doc(candidate).create(Object.assign({ number: candidate }, record));
            number = candidate;
          } catch (error) {
            if (!/already exists|ALREADY_EXISTS|code 6/i.test(String((error && (error.message || error.code)) || ''))) throw error;
          }
        }
        if (!number) return sendJson(response, 503, { code: 'NO_NUMBER', message: 'A reference could not be given just now. Try again.' });
        const ref = db.collection(COLLECTION).doc(L.docIdOf(number));
        const made = await L.pdfOf(v, { number });
        const sha256 = crypto.createHash('sha256').update(made.bytes).digest('hex');
        let kept = await fileStore.put(`letters/${L.docIdOf(number)}.pdf`, made.bytes, 'application/pdf');
        /* no bucket and too large to keep in the record: made again from the record when asked for */
        if (kept && kept.bytes && made.bytes.length > RECORD_MAX) kept = { remade: true };
        await ref.set({ pages: made.pages, pdf: Object.assign({ size: made.bytes.length, sha256 }, kept) }, { merge: true });
        const row = L.rowOf(ref.id, Object.assign({ number, pages: made.pages }, record));
        await audit.record(who, { module: MODULE, action: 'letter-issued', subject: number, detail: `${L.TEMPLATES[v.kind].label} to ${row.name}: ${v.subject}${v.amount ? `, ${v.amount}` : ''}${v.donation ? ` (${v.donation})` : ''}${v.signed ? ', signed' : ', not signed'}${v.sealed ? ', sealed' : ''}, ${made.pages} ${made.pages === 1 ? 'page' : 'pages'}` }, request);
        return sendJson(response, 200, { ok: true, letter: row, pdf: made.bytes.toString('base64') });
      }

      if (body.action === 'withdraw') {
        const number = numberOf(body.number);
        if (!number) return sendJson(response, 400, { code: 'BAD_NUMBER', message: 'That is not a letter reference.' });
        const reason = short(body.reason, 300);
        if (reason.length < 4) return sendJson(response, 422, { code: 'NO_REASON', field: 'reason', message: 'Say why the letter is withdrawn.' });
        const ref = db.collection(COLLECTION).doc(L.docIdOf(number));
        const snap = await ref.get();
        if (!snap.exists) return sendJson(response, 404, { code: 'NO_LETTER', message: 'No letter has that reference.' });
        const l = snap.data() || {};
        if (l.withdrawn) return sendJson(response, 409, { code: 'ALREADY', message: 'That letter is already withdrawn.' });
        const update = { withdrawn: true, withdrawnAt: at, withdrawnBy: by, withdrawnReason: reason };
        await ref.set(update, { merge: true });
        await audit.record(who, { module: MODULE, action: 'letter-withdrawn', subject: number, detail: `${L.rowOf(snap.id, l).name}: ${reason}` }, request);
        return sendJson(response, 200, { ok: true, letter: L.rowOf(snap.id, Object.assign({}, l, update)) });
      }

      if (body.action === 'mail' || body.action === 'email') {
        const number = numberOf(body.number);
        if (!number) return sendJson(response, 400, { code: 'BAD_NUMBER', message: 'That is not a letter reference.' });
        const ref = db.collection(COLLECTION).doc(L.docIdOf(number));
        const snap = await ref.get();
        if (!snap.exists) return sendJson(response, 404, { code: 'NO_LETTER', message: 'No letter has that reference.' });
        const l = snap.data() || {};
        if (l.withdrawn) return sendJson(response, 409, { code: 'WITHDRAWN', message: 'A withdrawn letter is not sent.' });
        const to = emailOf(body.email || l.email || (l.person && l.person.email));
        if (!to) return sendJson(response, 422, { code: 'BAD_FIELD', field: 'email', message: 'Type the email it goes to.' });
        const mail = mailOf(number, l, to);
        if (body.action === 'mail') return sendJson(response, 200, { ok: true, to, subject: mail.subject, html: mail.html });
        const store = d.queue || require('../../caregiver-store');
        const sender = d.mail || require('../../caregiver-mail');
        const configured = sender.isConfigured();
        const pdfSha = (l.pdf && l.pdf.sha256) || '';
        const queued = await store.queueEmail({ template: 'pfa_letter', to, payload: mail.payload, dedupeKey: `${number}:${to}:${pdfSha.slice(0, 12)}:${(Array.isArray(l.sends) ? l.sends.length : 0)}`, claim: configured ? 'letters' : undefined });
        let state = queued.created ? 'queued' : (queued.status === 'sent' ? 'sent' : 'queued');
        let reason = configured ? '' : 'Email is not set up on the server; it is queued.';
        if (queued.created && configured) {
          try {
            const sent = await sender.deliver({ to, template: 'pfa_letter', payload: mail.payload });
            await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: sent && sent.providerId });
            state = 'sent';
          } catch (error) {
            await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
            reason = 'Not sent just now; it will be tried again.';
          }
        }
        const sends = (Array.isArray(l.sends) ? l.sends.slice(-19) : []).concat([{ at, by: by.email || by.name || '', to, state, emailId: queued.emailId || '' }]);
        await ref.set({ email: to, sends }, { merge: true });
        await audit.record(who, { module: MODULE, action: 'letter-emailed', subject: number, detail: `${L.rowOf(snap.id, l).name}, to ${to}: ${state}` }, request);
        return sendJson(response, 200, { ok: true, state, reason, to, letter: L.rowOf(snap.id, Object.assign({}, l, { email: to, sends })) });
      }

      return sendJson(response, 400, { code: 'BAD_ACTION', message: 'Nothing to do.' });
    } catch (error) {
      console.error('letters failed', (error && error.message) || error);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'That could not be done just now. Nothing was changed.' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.COLLECTION = COLLECTION;
module.exports._private = { findPeople, mailOf, numberOf, resetPeople: () => { peopleCache = null; } };
