/* POST /api/pfa-submissions        { kind, data, page }   -> { ok, reference, confirmation }
   GET  /api/pfa-submissions?reference=PFA-C-2026-00042&contact=asha@example.com

   The server issues the reference. The browser sends what was typed and gets
   a number back; if the number never arrives, the form says so instead of
   showing one that was never recorded.

   Following a submission needs the number and the email or mobile given with
   it. What comes back is the status and when it changed, never the report.

   Every submission is confirmed in the themed letter (lib/confirmations.js),
   and the answer says what happened to that email - sent, on its way, not
   sent, or no address given - so the page can tell the person where to look,
   Spam and Junk included, instead of promising an email that is not coming. */

'use strict';

const firebase = require('../firebase');
const mail = require('../caregiver-mail');
const caregiverStore = require('../caregiver-store');
const CONFIRM = require('../confirmations');
const FORWARD = require('../submission-forward');
const RULES = require('../../assets/field-rules.js');
const S = require('../submissions');
const FILES = require('../file-store');
const FIELDS = require('../submission-fields');
const MT = require('../mail-thread');

const ALLOWED_KINDS = new Set(Object.keys(S.KIND_LABELS).filter((kind) => !S.PAID_KINDS.has(kind)));
const MAX_TEXT = 20000;          // any one field
const MAX_BODY = 4 * 1024 * 1024; // the whole request, photos included
const ACK_TIMEOUT_MS = 2500;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

/* A plain HTML form, with no script running, posts
   application/x-www-form-urlencoded. That is what help.html sends from a
   phone whose JavaScript never arrived, and it is the one request on this
   site that must work in that state. */
function isFormPost(request) {
  return /application\/x-www-form-urlencoded/i.test(String((request.headers || {})['content-type'] || ''));
}

function parseForm(raw) {
  const out = {};
  new URLSearchParams(String(raw || '')).forEach((value, key) => { out[key] = value; });
  return out;
}

function readBody(request) {
  const form = isFormPost(request);
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    const finish = () => {
      if (form) return resolve(parseForm(raw));
      try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid submission body.')); }
    };
    if (raw) return finish();
    /* Past the cap, stop keeping the bytes. Rejecting alone did not: the data
       listener stayed attached and `raw` went on growing for as long as the
       client cared to send, so a request that had already been refused could
       still take the function's memory with it. */
    let over = false;
    request.on('data', (chunk) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_BODY) {
        over = true;
        raw = '';
        reject(new Error('Submission too large.'));
      }
    });
    request.on('end', () => { if (!over) finish(); });
    request.on('error', reject);
  });
}

/* The flat fields of a form post, lifted into the shape the JSON path uses:
   kind and page are the envelope, everything else is the report. */
function envelopeFromForm(flat) {
  const data = Object.assign({}, flat);
  const kind = data.kind; const page = data.page;
  delete data.kind; delete data.page; delete data.photos;
  return { kind, page, data, photos: [] };
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* What a browser with no script gets back: a page it can read, not JSON it
   cannot. Self-contained, so it renders on the same connection that failed
   to deliver the site's scripts. */
function sendHtml(response, status, { title, lead, reference, followUrl, errors, notice }) {
  const list = (errors || []).map((e) => `<li>${escapeHtml(e.message)}</li>`).join('');
  const refBlock = reference
    ? `<p class="k">Your reference number</p><p class="ref">${escapeHtml(reference)}</p>`
      + `<p>Keep it. You can follow what happens with it and the mobile or email you gave.</p>`
      + CONFIRM.noticeHtml(notice)
      + `<p><a class="b" href="${escapeHtml(followUrl)}">Follow it</a> <a class="b l" href="/ask.html">Ask us anything</a></p>`
    : `${list ? `<ul>${list}</ul>` : ''}<p><a class="b" href="javascript:history.back()">Go back and fix it</a> <a class="b l" href="/ask.html">Ask us anything</a></p>`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} | PFA</title>`
    + '<style>body{margin:0;padding:28px 20px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0E1116;background:#fff}main{max-width:560px;margin:auto}h1{font-size:30px;line-height:1.05;letter-spacing:-.03em;margin:0 0 14px}p{margin:12px 0}.k{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#0653EE;margin-bottom:2px}.ref{font-family:ui-monospace,Menlo,monospace;font-size:26px;margin:0 0 8px;padding:14px 16px;background:#EEF4FF;border:1px solid rgba(6,83,238,.18)}ul{padding-left:20px;color:#B42318}.b{display:inline-block;margin:6px 8px 0 0;padding:13px 18px;background:#0E1116;color:#fff;text-decoration:none;font-weight:600;border:1px solid #0E1116}.b.l{background:#fff;color:#0E1116}.mail{margin:18px 0;padding:16px 18px;border:1px solid #0E1116}.mail p{margin:0 0 6px}.mail strong{overflow-wrap:anywhere}.mail__title{font-size:20px;font-weight:600;letter-spacing:-.01em}.mail__ask{margin-top:12px!important;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5c6771}.mail ol{list-style:decimal;margin:6px 0 0;padding-left:20px;color:#444}.mail li{margin:3px 0}</style></head>'
    + `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(lead)}</p>${refBlock}</main></body></html>`;
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.end(html);
}

/* Strip control characters and trim, but do NOT truncate here: the length
   check belongs to validation, which can tell the sender their entry is too
   long. Quietly cutting a rescue report in half and storing the stump is worse
   than refusing it. The overall body cap already bounds memory. */
function cleanValue(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT);
}

/* Firestore reserves any field name matching __.*__ . The keys of `fields`
   come straight from whatever the request called them, so one named __type__
   or __name__ reached the write, and a write Firestore refuses fails a
   submission whose reference number has already been issued and spent. A
   caller cannot be allowed to choose that, and no form has ever sent such a
   name, so they are simply not carried. */
const RESERVED_FIELD = /^__.*__$/;

function cleanFields(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  Object.keys(data).slice(0, 40).forEach((key) => {
    const safeKey = cleanValue(key).slice(0, 60);
    if (!safeKey || RESERVED_FIELD.test(safeKey)) return;
    if (typeof data[key] !== 'object') out[safeKey] = cleanValue(data[key]);
  });
  return out;
}

/* The browser checked these already. So does this, because the browser is not
   a security boundary: anyone can POST here directly. Same rule file both
   sides, so the two can never disagree about what a valid mobile number is.

   What the form asked for is checked as well as what it was given: lib/
   submission-fields.js holds, per kind, the fields the page marks required
   and the lists its <select>s offer. Without it an empty POST filed an empty
   cruelty report, and "animal": "Dragon" was stored as readily as "Dog". */
function validateFields(kind, fields) {
  return FIELDS.validate(kind, fields);
}

/* Where the confirmation goes: the field the form names as the sender's
   email, never the first value shaped like one (lib/submissions.js
   senderEmail). On report.html "Who is doing it" comes before "Email", and
   until 8 Oct 2026 an address typed there was sent the reporter's
   confirmation: their name, the number and the tracking link. */
function emailIn(fields) {
  return S.senderEmail(fields);
}

/* Read by field name only, so it never had the weakness emailIn had. */
function nameIn(fields) {
  const key = Object.keys(fields || {}).find((k) => /^(name|fullname|full name|your name)$/i.test(k));
  return key ? RULES.nameCase(String(fields[key])) : '';
}

function alreadyExists(error) {
  return Boolean(error && (error.code === 6 || /already exists|ALREADY_EXISTS/i.test(String(error.message))));
}

/* What the person is told when a photograph could not be kept. The record is
   on file by then, so this is said beside the number, never instead of it. */
function photoNoticeFor(notKept) {
  const n = Number(notKept) || 0;
  if (!n) return '';
  return n === 1
    ? 'Sorry, one photograph could not be kept. Everything else you sent is on record under this number. If the photograph matters, email it to PFA and mention the number.'
    : `Sorry, ${n} photographs could not be kept. Everything else you sent is on record under this number. If the photographs matter, email them to PFA and mention the number.`;
}

/* The note about the confirmation, with the photograph notice first when
   there is one, so a page that shows the note shows both. */
function noticeFor(kind, reference, outcome, notKept) {
  const told = outcome || { state: 'none', to: '' };
  const notice = CONFIRM.notice({ state: told.state, to: told.to, number: CONFIRM.forKind(kind).number, reference, reason: told.reason });
  const photo = photoNoticeFor(notKept);
  if (photo) notice.lines = [photo].concat(notice.lines || []);
  return notice;
}

function siteUrl(request) {
  const configured = String(process.env.PUBLIC_SITE_URL || '').trim();
  try { const u = new URL(configured); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (_) { /* fall through */ }
  const host = (request.headers || {})['x-forwarded-host'] || (request.headers || {}).host || 'pfa-full-website.vercel.app';
  return `https://${host}`;
}

function createHandler(deps) {
  const { getDb, deliver, isConfigured, now } = deps;
  /* The outbound queue the email worker drains. Optional, so a handler built
     for a test sends at once or not at all. */
  const queue = deps.queue || null;
  const mailDeps = () => ({ deliver, isConfigured, smtpConfigured: deps.smtpConfigured });

  /* Files the record, and takes its number, in ONE transaction (8 Oct 2026).

     Before, the number was allocated first and the record written after it,
     with checks in between, so a refused photograph or a failed write spent
     a number that then existed nowhere (PFA-CR-2026-00001 skipped, 00002
     filed). And the double-send key was written only after the emails, two
     to nine seconds later, so a second press inside that time filed a second
     record. Now everything is validated first, and then the idempotency key,
     the counter and the record are read and written together: either all of
     them are on file, or none is, and a second attempt with the same key
     finds the first one's number.

     Only get() and set() are used inside: the record's slot and the key are
     read in the transaction and found empty before they are written, which is
     what create() would check, and Firestore re-runs the transaction if
     anyone else writes either of them meanwhile. */
  async function fileOnce(db, { kind, dedupe, nowMs, makeRecord, claimFor }) {
    /* A number already on file means the counter is behind (a restore, a
       hand edit). S.withFreeReference steps past it, across transactions if
       it is far behind, and never writes over what is there. */
    return S.withFreeReference(db, kind, nowMs, async (tx, slot) => {
      const record = makeRecord(slot.reference);
      slot.take();
      tx.set(db.collection('submissions').doc(slot.reference), record);
      if (dedupe) tx.set(dedupe, claimFor(slot.reference));
      return { replay: false, reference: slot.reference, record };
    }, dedupe ? async (tx) => {
      const seen = await tx.get(dedupe);
      const earlier = seen.exists ? seen.data() : null;
      return earlier && earlier.reference ? { replay: true, claim: earlier } : null;
    } : null);
  }

  /* Keeps one photograph beside the record. Safe to run twice for the same
     photograph: a resumed or doubled request finds it already kept. One
     retry, because a single transient failure should not cost a picture. */
  async function keepPhoto(doc, reference, n, photo, createdAt) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const stored = await FILES.put(`submissions/${reference}/${n}`, photo.bytes, photo.contentType);
        await doc.collection('attachments').doc(String(n)).create(Object.assign({
          contentType: photo.contentType, size: photo.bytes.length, createdAt
        }, stored));
        return;
      } catch (error) {
        if (alreadyExists(error)) return;
        if (attempt >= 2) throw error;
      }
    }
  }

  /* Everything after the record is on file: the photographs, the
     confirmation, PFA's copy, and the key marked filed. Run by the request
     that filed the record, and again by a repeat of it that finds the key
     still "filing" (the first attempt died part way, or is still running):
     every step is safe to repeat, so the repeat finishes the work instead of
     taking a second number. Never throws: the number is issued, and the
     answer must say so. */
  async function finish({ db, request, kind, reference, record, photos, dedupe, nowMs }) {
    const doc = db.collection('submissions').doc(reference);
    const createdAt = record.createdAt || new Date(nowMs).toISOString();
    const wanted = Math.max(0, Number(record.attachments) || 0);

    /* In order, stopping at the first that cannot be kept, so the record's
       count always names photographs 1 to n that are really there. */
    let kept = 0;
    for (let i = 0; i < wanted && i < photos.length; i += 1) {
      try {
        await keepPhoto(doc, reference, i + 1, photos[i], createdAt);
        kept += 1;
      } catch (error) {
        console.warn('submission photo not kept', { reference, n: i + 1, message: error && error.message });
        break;
      }
    }
    const notKept = wanted - kept;
    if (notKept) {
      try { await doc.update({ attachments: kept, attachmentsNotKept: notKept }); } catch (error) {
        console.warn('submission photo count not corrected', { reference, message: error && error.message });
      }
    }
    const filed = Object.assign({}, record, { reference, attachments: kept });

    /* The confirmation is a courtesy, never a condition: the number is already
       on record, so a slow or unconfigured mail provider must not hold up or
       fail the response. It goes on the outbound queue first, so an email the
       provider could not take at this moment is sent by the email worker on
       its next run, and the answer says which of those happened. */
    const to = emailIn(filed.fields);
    const site = siteUrl(request);
    let confirming;
    if (to && await S.confirmLimited(db, to, nowMs)) {
      console.warn('confirmation held back: too many to one address', { reference });
      confirming = Promise.resolve({ state: 'unsent', to, reason: 'RECIPIENT_LIMIT' });
    } else {
      confirming = CONFIRM.send({
        to,
        template: 'submission_received',
        /* the conversation is part of the key (CONTRACT.md section 4) */
        dedupeKey: filed.threadId ? `submission_received:${reference}:${filed.threadId}` : `submission_received:${reference}`,
        payload: {
          kind, name: nameIn(filed.fields), reference, threadId: filed.threadId, kindLabel: S.KIND_LABELS[kind], receivedAt: createdAt, attachments: kept,
          siteUrl: site,
          followUrl: `${siteUrl(request)}/track.html#ref=${encodeURIComponent(reference)}`
        },
        mail: mailDeps(),
        queue,
        timeoutMs: ACK_TIMEOUT_MS
      });
    }
    /* PFA's own copy, to the inbox, with Reply-To set to the sender. Started
       after the sender's confirmation and run beside it, so the page waits
       once, not twice. */
    const forwarding = FORWARD.forward({ record: filed, siteUrl: site, mail: mailDeps(), queue, timeoutMs: ACK_TIMEOUT_MS, db })
      .catch((error) => { console.warn('submission forward failed', { reference, message: error && error.message }); return []; });
    let outcome;
    try { [outcome] = await Promise.all([confirming, forwarding]); } catch (error) {
      console.warn('confirmation failed', { reference, message: error && error.message });
      outcome = { state: to ? 'unsent' : 'none', to };
    }
    outcome = outcome || { state: 'none', to: '' };

    if (dedupe) {
      /* The whole key again (set, not merge): the same values whichever
         attempt writes it last. Never allowed to fail the response. */
      try {
        await dedupe.set({
          reference, kind, createdAt, state: 'filed', filedAt: new Date(now()).toISOString(),
          acknowledged: outcome.state === 'sent', attachments: kept, attachmentsNotKept: notKept,
          confirmation: Object.assign({ state: outcome.state, to: outcome.to || '' }, outcome.reason ? { reason: outcome.reason } : {})
        });
      } catch (error) {
        console.warn('submission idempotency key not marked filed', { reference, message: error && error.message });
      }
    }
    return { outcome, kept, notKept, createdAt };
  }

  function answer(response, form, { kind, reference, receivedAt, outcome, kept, notKept, duplicate }) {
    const confirmation = noticeFor(kind, reference, outcome, notKept);
    const photoNotice = photoNoticeFor(notKept);
    if (form) {
      return sendHtml(response, 200, {
        title: 'Sent to PFA',
        lead: `${S.KIND_LABELS[kind]} received. A named person at PFA can now see it.`,
        reference,
        followUrl: `/track.html#ref=${encodeURIComponent(reference)}`,
        notice: confirmation
      });
    }
    return sendJson(response, 200, Object.assign({
      ok: true, reference, kindLabel: S.KIND_LABELS[kind], receivedAt: receivedAt || null,
      acknowledged: Boolean(outcome && outcome.state === 'sent'), attachments: Number(kept) || 0, confirmation
    }, photoNotice ? { photosNotKept: notKept, photoNotice } : {}, duplicate ? { duplicate: true } : {}));
  }

  async function receive(request, response) {
    const form = isFormPost(request);
    const fail = (status, error, fields) => (form
      ? sendHtml(response, status, { title: 'Not sent', lead: error, errors: fields })
      : sendJson(response, status, Object.assign({ ok: false, error }, fields ? { fields } : {})));
    const slowDown = () => fail(429, 'That is a lot of forms from one connection in a short time. Wait a few minutes and try again. If an animal is in danger now, call 112.');
    const ip = S.clientIp(request);

    /* The door: this instance's own count of every POST, before the body is
       read, so a flood of junk is turned away without touching the database.
       The shared count, across both servers, is taken once the submission
       has passed validation (below). */
    if (S.writeLimited(ip, now())) return slowDown();

    let body;
    try { body = await readBody(request); } catch (error) {
      return fail(400, error.message);
    }
    if (form) body = envelopeFromForm(body);
    const kind = cleanValue(body.kind).toUpperCase().slice(0, 30);
    if (!ALLOWED_KINDS.has(kind)) return fail(400, 'Unknown submission type.');

    /* Everything is judged before anything is written or any number taken:
       the fields, and the photographs by their bytes. */
    const { errors, clean } = validateFields(kind, cleanFields(body.data));
    if (errors.length) {
      return fail(422, 'Some fields did not pass validation.', errors);
    }
    /* Photos travel as data URLs, shrunk by the browser. They are checked
       here by their bytes, not their label, and kept as private documents
       beside the report - never on a public image host - so only the panel
       can show them. */
    const photos = S.parsePhotos(body.photos, S.maxPhotosFor(kind));
    if (photos.rejected.length) {
      return fail(422, photos.rejected[0], [{ field: 'photos', message: photos.rejected[0] }]);
    }

    const db = getDb();
    const nowMs = now();
    if (await S.sendLimited(db, ip, nowMs)) return slowDown();

    /* The same submission sent twice - a double press, or a retry after the
       first answer was lost on the way back - is one record. The browser
       sends a key for what it is sending; the reference issued under that key
       is kept, and a replay is answered with it rather than with a second
       number. A form posted with no script has no key and no such guard,
       which is the price of working without one. */
    const requestId = cleanValue(body.clientRequestId).slice(0, 120);
    const dedupe = requestId ? db.collection('submissionIdempotency').doc(firebase.hashKey(`${kind}:${requestId}`)) : null;
    const createdAt = new Date(nowMs).toISOString();

    const filing = await fileOnce(db, {
      kind,
      dedupe,
      nowMs,
      makeRecord: (reference) => ({
        reference,
        kind,
        kindLabel: S.KIND_LABELS[kind],
        fields: clean,
        contactKeys: S.contactKeysFor(clean),
        page: cleanValue(body.page).slice(0, 120),
        status: 'new',
        history: [{ status: 'new', at: createdAt }],
        createdAt,
        receivedAtMs: nowMs,
        attachments: photos.accepted.length,
        /* the conversation this record is: every email about it carries this
           in its Message-ID, and a reply is filed here by it (lib/mail-thread.js) */
        threadId: MT.newThreadId(),
        threadSubject: CONFIRM.threadSubject({ kind, reference })
      }),
      claimFor: (reference) => ({ reference, kind, createdAt, state: 'filing', attachments: photos.accepted.length })
    });

    /* From here the record is on file under its number. Whatever happens
       next, the answer gives the number; it never says nothing was saved. */
    if (!filing.replay) {
      const done = await finish({ db, request, kind, reference: filing.reference, record: filing.record, photos: photos.accepted, dedupe, nowMs });
      return answer(response, form, { kind, reference: filing.reference, receivedAt: createdAt, outcome: done.outcome, kept: done.kept, notKept: done.notKept });
    }

    const earlier = filing.claim;
    /* "filing": the attempt that took the number has not finished (it died
       part way, or is still running). This one finishes the work, every step
       of which is safe to repeat, instead of taking a second number. A key
       written before 8 Oct 2026 has no state and was written when the work
       was done. */
    if (earlier.state === 'filing') {
      let stored = null;
      try {
        const snapshot = await db.collection('submissions').doc(earlier.reference).get();
        stored = snapshot.exists ? snapshot.data() : null;
      } catch (error) {
        console.warn('submission to resume could not be read', { reference: earlier.reference, message: error && error.message });
      }
      if (stored) {
        const done = await finish({ db, request, kind, reference: earlier.reference, record: stored, photos: photos.accepted, dedupe, nowMs });
        return answer(response, form, { kind, reference: earlier.reference, receivedAt: stored.createdAt || earlier.createdAt, outcome: done.outcome, kept: done.kept, notKept: done.notKept, duplicate: true });
      }
    }
    /* The page is told again what it was told the first time. A key still
       "filing" whose record could not be read just now has no answer yet, so
       the email is not promised either way. */
    const told = earlier.confirmation
      || (earlier.state === 'filing' ? { state: emailIn(clean) ? 'unsent' : 'none', to: emailIn(clean) } : null)
      || { state: earlier.acknowledged ? 'sent' : 'none', to: '' };
    return answer(response, form, {
      kind, reference: earlier.reference, receivedAt: earlier.createdAt, outcome: told,
      kept: earlier.attachments, notKept: earlier.attachmentsNotKept, duplicate: true
    });
  }

  /* One answer for a number that does not exist and a number that is not
     yours (8 Oct 2026): two answers let anyone walk the sequential numbers and
     learn which exist, then test a phone or email they know against each. */
  const NO_MATCH = {
    ok: false,
    code: 'NO_MATCH',
    error: 'Nothing matches that number with that email or mobile. Check both against what you were given when you sent it.'
  };

  async function follow(request, response) {
    const nowMs = now();
    let db = null;
    try { db = getDb(); } catch (_) { db = null; }
    if (await S.lookupLimited(db, S.clientIp(request), nowMs)) {
      return sendJson(response, 429, { ok: false, code: 'SLOW_DOWN', error: 'Too many lookups from this connection. Try again in a few minutes.' });
    }
    const query = request.query || {};
    const reference = cleanValue(query.reference).toUpperCase().replace(/\s+/g, '').slice(0, 40);
    const contact = cleanValue(query.contact).slice(0, 120);
    if (!reference || !S.isReference(reference)) {
      return sendJson(response, 400, { ok: false, code: 'BAD_REFERENCE', error: 'That does not look like a PFA reference. It reads like PFA-C-2026-00042.' });
    }

    const snapshot = await (db || getDb()).collection('submissions').doc(reference).get();
    const record = snapshot.exists ? Object.assign({ reference }, snapshot.data()) : null;
    const match = record ? S.contactMatches(record, contact) : { required: true, ok: false };
    if (match.required && !contact) {
      /* asked for whether the number exists or not, so it says nothing either way */
      return sendJson(response, 403, { ok: false, code: 'CONTACT_NEEDED', error: 'Add the email or mobile you gave with it, so only you can follow it.' });
    }
    /* A removed record answers exactly as an unknown reference does, and
       before the contact check, so the tracker says nothing about it either
       way (lib/routes/admin/case.js 'remove'). */
    if (!record || record.status === 'removed' || (match.required && !match.ok)) return sendJson(response, 404, NO_MATCH);
    return sendJson(response, 200, Object.assign({ ok: true }, S.publicView(record)));
  }

  return async function handler(request, response) {
    try {
      if (request.method === 'POST') return await receive(request, response);
      if (request.method === 'GET') return await follow(request, response);
      response.setHeader('Allow', 'GET, POST');
      return sendJson(response, 405, { ok: false, error: 'Use POST to send, GET to follow.' });
    } catch (error) {
      console.error('pfa-submissions failed', error && error.message);
      /* Reached only before the record and its number were committed
         together (receive() answers with the number once they are), so
         "nothing was saved" is true when it is said. */
      return sendJson(response, 500, { ok: false, error: request.method === 'GET'
        ? 'The status could not be read right now. Try again in a minute.'
        : 'Could not record the submission right now. Nothing was saved - please try again.' });
    }
  };
}

module.exports = createHandler({
  getDb: firebase.getDb,
  deliver: mail.deliver,
  isConfigured: mail.isConfigured,
  smtpConfigured: mail.smtpConfigured,
  now: () => Date.now(),
  queue: { queueEmail: caregiverStore.queueEmail, recordEmailResult: caregiverStore.recordEmailResult }
});
module.exports._private = { createHandler, cleanFields, validateFields, emailIn, nameIn, isFormPost, envelopeFromForm, photoNoticeFor };
