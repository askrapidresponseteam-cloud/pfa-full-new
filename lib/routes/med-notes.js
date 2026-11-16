'use strict';

/* The public side of the medical notes (pet-health.html; lib/med-notes.js).

   GET  /api/med-notes                         the notes on the site: PFA's own, then those published
   GET  /api/med-notes?ref=PFA-MED-2026-00001&file=1
                                               a file of a published note (a PDF or a photograph)
   POST /api/med-notes { t, action: 'open' }   what the sender's private link may do, and their note
   POST /api/med-notes { t, action: 'send', note, photos? }
                                               the sender's updated note, filed for PFA to read again

   A note is public only while it is Published (status "approved"); its
   files open here only then, exactly as a field note's photographs do
   (lib/routes/field-note-photo.js). A file on a note that is not published
   is a 404, as if it did not exist.

   The update is all or nothing, like a member's photograph
   (lib/routes/membership/photo.js): the files go to the private bucket
   first, then one transaction re-reads the link and the record, checks the
   link is still live, files the new version beside the old one, moves the
   note to "Updated" and marks the link used. Then the sender is told it
   arrived and PFA's inbox gets the updated note, as a second copy in the
   same email conversation as the first. */

const firebase = require('../firebase');
const S = require('../submissions');
const FILES = require('../file-store');
const MED = require('../med-notes');
const ORDER = require('../message-order');
const FORWARD = require('../submission-forward');

const LIST_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';
const FILE_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';
const MISS_CACHE = 'public, max-age=0, s-maxage=30';
const LIMIT = 200;
const MAX_BODY = 4 * 1024 * 1024;

function sendJson(response, status, payload, cache) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', cache || 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let raw = typeof request.body === 'string' ? request.body : '';
    if (raw) { try { return resolve(JSON.parse(raw)); } catch (_) { return reject(new Error('Invalid body.')); } }
    if (request.body === null || request.readableEnded) return resolve({});
    let over = false;
    request.on('data', (chunk) => {
      if (over) return;
      raw += chunk;
      if (raw.length > MAX_BODY) { over = true; raw = ''; reject(Object.assign(new Error('That is too large to send. Attach a smaller PDF or fewer photographs.'), { tooLarge: true })); }
    });
    request.on('end', () => { if (over) return; try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(new Error('Invalid body.')); } });
    request.on('error', reject);
  });
}

function firstName(name) {
  const word = MED.clean(name, 80).split(' ').filter((w) => w && !/\.$/.test(w))[0] || '';
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
}

function createHandler(deps) {
  const d = deps || {};
  const getDb = d.getDb || (() => firebase.getDb());
  const now = d.now || (() => Date.now());
  const fieldValue = d.fieldValue || (() => firebase.fieldValue());
  const notify = d.notify || ((args) => require('../membership-notify').send(args));
  const site = d.site || (() => require('../public-site').publicSite());
  const forward = d.forward || ((args) => FORWARD.forward(args));
  const mailDeps = d.mail || (() => {
    const mail = require('../caregiver-mail');
    return { deliver: mail.deliver, isConfigured: mail.isConfigured, smtpConfigured: mail.smtpConfigured };
  });
  const queue = d.queue === undefined ? require('../caregiver-store') : d.queue;

  /* ---- the list ---- */
  async function list(response) {
    const out = [];
    let hidden = new Set();
    let degraded = false;
    try {
      const db = getDb();
      const [snap, seedSnap] = await Promise.all([
        db.collection('submissions').where('kind', '==', MED.KIND).where('status', '==', 'approved').limit(LIMIT).get(),
        db.collection(MED.SEEDS).get().catch(() => null)
      ]);
      if (seedSnap) seedSnap.forEach((doc) => { if ((doc.data() || {}).hidden === true) hidden.add(doc.id); });
      const rows = [];
      snap.forEach((doc) => rows.push({ id: doc.id, data: doc.data() || {} }));
      for (const row of rows) {
        const meta = {};
        const files = MED.filesOf(row.data);
        await Promise.all(files.map(async (n) => {
          try {
            const a = await db.collection('submissions').doc(row.id).collection('attachments').doc(n).get();
            if (a.exists) { const x = a.data() || {}; meta[n] = { type: String(x.contentType || ''), size: Number(x.size) || 0 }; }
          } catch (_) { /* the file still opens; its size is a courtesy */ }
        }));
        const item = MED.publicOf(row.id, row.data, meta);
        if (item) out.push(item);
      }
    } catch (error) {
      console.error('med-notes: read failed', String(error && error.message).slice(0, 200));
      degraded = true;
    }
    out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const own = MED.seeds().filter((s) => !hidden.has(s.id)).map(MED.seedPublic);
    return sendJson(response, 200, Object.assign({ ok: true, notes: out.concat(own) }, degraded ? { degraded: true } : {}), degraded ? 'no-store' : LIST_CACHE);
  }

  /* ---- one file of a published note ---- */
  async function file(request, response, query) {
    const ref = String(query.ref || '').trim().toUpperCase().replace(/\s+/g, '');
    const n = String(query.file || '').trim();
    const notFound = () => { response.statusCode = 404; response.setHeader('Cache-Control', MISS_CACHE); return response.end(); };
    if (!S.isReference(ref) || !ref.startsWith(`${MED.KIND}-`) || !/^\d{1,2}$/.test(n)) {
      response.statusCode = 400;
      return response.end();
    }
    let data;
    try {
      const db = getDb();
      const snap = await db.collection('submissions').doc(ref).get();
      const rec = snap.exists ? (snap.data() || {}) : {};
      if (!MED.isPublished(rec) || !MED.filesOf(rec).includes(n)) return notFound();
      const shot = await db.collection('submissions').doc(ref).collection('attachments').doc(n).get();
      if (!shot.exists) return notFound();
      data = shot.data() || {};
    } catch (error) {
      console.error('med-notes: file lookup failed', { ref, n, message: String(error && error.message).slice(0, 200) });
      response.statusCode = 503;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Retry-After', '30');
      return response.end();
    }
    let bytes;
    try {
      bytes = (await FILES.readStrict(data)) || Buffer.alloc(0);
    } catch (error) {
      if (error.code === 'FILE_MISSING') return notFound();
      response.statusCode = 503;
      response.setHeader('Cache-Control', 'no-store');
      return response.end();
    }
    const type = S.isPdf(bytes) ? 'application/pdf' : S.imageType(bytes);
    if (!bytes.length || !type) return notFound();
    response.statusCode = 200;
    response.setHeader('Content-Type', type);
    response.setHeader('Content-Length', String(bytes.length));
    response.setHeader('Cache-Control', FILE_CACHE);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (type === 'application/pdf') response.setHeader('Content-Disposition', `inline; filename="${ref}-${n}.pdf"`);
    return response.end(request.method === 'HEAD' ? undefined : bytes);
  }

  /* ---- the sender's link ---- */
  async function lookUp(db, token, nowMs, tx) {
    const hash = MED.hashToken(token);
    const linkRef = db.collection(MED.LINKS).doc(hash);
    const linkSnap = tx ? await tx.get(linkRef) : await linkRef.get();
    if (!linkSnap.exists) return { state: 'unknown', hash, linkRef };
    const link = Object.assign({ hash }, linkSnap.data() || {});
    const recordRef = db.collection('submissions').doc(String(link.reference || 'none'));
    const recordSnap = tx ? await tx.get(recordRef) : await recordRef.get();
    if (!recordSnap.exists) return { state: 'unknown', hash, linkRef };
    const record = recordSnap.data() || {};
    return { state: MED.linkState(link, record, nowMs), hash, link, linkRef, record, recordRef };
  }

  async function edit(request, response) {
    const ip = S.clientIp(request) || '';
    if (S.rateLimited(ip)) return sendJson(response, 429, { ok: false, error: 'Too many attempts. Wait a few minutes and try again.' });
    let body;
    try { body = await readBody(request); } catch (error) {
      return sendJson(response, error.tooLarge ? 413 : 400, { ok: false, error: error.message });
    }
    const token = String(body.t || '');
    if (!MED.isToken(token)) return sendJson(response, 404, { ok: false, state: 'unknown', error: MED.SAY.unknown });
    const action = MED.clean(body.action, 10);
    const nowMs = now();
    const at = new Date(nowMs).toISOString();
    const dead = (state) => sendJson(response, state === 'unknown' ? 404 : 410, { ok: false, state, error: MED.SAY[state] || MED.SAY.unknown });

    try {
      const db = getDb();
      if (action === 'open') {
        const found = await lookUp(db, token, nowMs);
        if (found.state !== 'live') return dead(found.state);
        const note = MED.noteOf(found.record);
        return sendJson(response, 200, {
          ok: true, state: 'live',
          reference: found.link.reference,
          firstName: firstName((found.record.fields || {}).name),
          asked: MED.clean((found.record.changes || {}).text, MED.ASK_MAX),
          expiresAt: found.link.expiresAt,
          note: Object.assign({}, note, { files: undefined }),
          files: note.files.length
        });
      }

      if (action !== 'send') return sendJson(response, 400, { ok: false, error: 'Unknown action.' });
      if (S.writeLimited(ip)) return sendJson(response, 429, { ok: false, error: 'Too many attempts. Wait a few minutes and try again.' });
      const checked = MED.checkNote(body.note);
      if (checked.errors.length) return sendJson(response, 422, { ok: false, error: 'Some fields need another look.', fields: checked.errors });
      const photos = S.parsePhotos(body.photos, S.MAX_PHOTOS, MED.KIND);
      if (photos.rejected.length) return sendJson(response, 422, { ok: false, field: 'photos', error: photos.rejected[0] });

      const first = await lookUp(db, token, nowMs);
      if (first.state !== 'live') return dead(first.state);
      const reference = first.link.reference;
      const had = Math.max(0, Number(first.record.attachments) || 0);
      if (had + photos.accepted.length > S.MAX_PHOTOS_ANY) {
        return sendJson(response, 422, { ok: false, field: 'photos', error: 'This note already has as many files as it can. Send it without a new file, and email the file to PFA quoting your reference.' });
      }

      /* the files first, numbered after the ones already on the record */
      const stored = [];
      for (let i = 0; i < photos.accepted.length; i += 1) {
        const n = String(had + i + 1);
        const p = photos.accepted[i];
        stored.push({ n, contentType: p.contentType, size: p.bytes.length, label: p.label || '', where: await FILES.put(`submissions/${reference}/${n}`, p.bytes, p.contentType) });
      }

      const done = await db.runTransaction(async (tx) => {
        const found = await lookUp(db, token, nowMs, tx);
        if (found.state !== 'live') return { ok: false, state: found.state };
        const rec = found.record;
        if ((Number(rec.attachments) || 0) !== had) return { ok: false, state: 'used' };
        const before = MED.noteOf(rec);
        const files = stored.length ? stored.map((s) => s.n) : before.files;
        const note = Object.assign({}, checked.note, { files });
        const revision = (Array.isArray(rec.revisions) ? rec.revisions.length : 0) + 1;
        /* the fields as they now read, for PFA's copy of the update only */
        const fields = Object.assign({}, rec.fields || {});
        MED.CONTENT.forEach((k) => { fields[k] = note[k]; });
        const fv = fieldValue();
        tx.set(found.linkRef, { usedAt: at }, { merge: true });
        stored.forEach((s) => {
          tx.create(found.recordRef.collection('attachments').doc(s.n), Object.assign({ contentType: s.contentType, size: s.size, createdAt: at, fromUpdate: revision }, s.label ? { label: s.label } : {}, s.where));
        });
        const text = `The sender updated the note through the link PFA emailed (version ${revision + 1}). Changed: ${MED.describeChanges(MED.changedKeys(before, note))}.`;
        /* what the sender first sent stays as it was (test/submissions.test.js:
           nothing rewrites a sender's fields); the update is the note, and the
           version it replaced is kept in revisions */
        tx.set(found.recordRef, {
          note,
          attachments: had + stored.length,
          status: 'updated',
          revisions: fv.arrayUnion({ n: revision, at, by: 'sender', before }),
          changes: Object.assign({}, rec.changes || {}, { answeredAt: at }),
          history: fv.arrayUnion({ status: 'updated', event: 'sender-update', at, by: 'sender' }),
          awaitingReply: true,
          updatedAt: at
        }, { merge: true });
        const id = `${nowMs}-med-update`;
        tx.set(found.recordRef.collection('messages').doc(id), { id, seq: ORDER.nextSeq(), type: 'note', text, by: 'sender', at, status: 'updated' });
        return { ok: true, revision, record: Object.assign({}, rec, { fields, note, attachments: had + stored.length, status: 'updated' }) };
      });

      if (!done.ok) {
        for (const s of stored) { try { await FILES.drop(s.where, at); } catch (_) { /* unreferenced; harmless */ } }
        return dead(done.state);
      }

      const who = MED.senderOf(done.record);
      const home = site();
      if (who.email) {
        await notify({ template: 'med_note_update_received', to: who.email, dedupeKey: `${reference}:update:${done.revision}`, claimBy: 'med-notes',
          payload: { name: who.name, reference, title: done.record.note.title, receivedAt: at, siteUrl: home } });
      }
      /* PFA's inbox: the updated note, threaded under the first copy */
      try {
        await forward({ record: Object.assign({ reference }, done.record, { followUp: `update-${done.revision}` }), siteUrl: home, mail: mailDeps(), queue, db });
      } catch (error) {
        console.error('med-notes: updated note not forwarded', error && error.message);
      }
      return sendJson(response, 200, { ok: true, state: 'sent', reference, firstName: firstName(who.name) });
    } catch (error) {
      console.error('med-notes edit failed', error && error.message);
      return sendJson(response, 500, { ok: false, error: 'Your note could not be sent just now. Please try again in a minute.' });
    }
  }

  return async function handler(request, response) {
    const query = request.query || {};
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (query.file != null) return file(request, response, query);
      return list(response);
    }
    if (request.method === 'POST') return edit(request, response);
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD, POST');
    return response.end();
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
