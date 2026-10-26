'use strict';

/* A copy of every email the site sends, in the Sent folder of the mailbox it
 * sends from.
 *
 * Owner, 8 Oct 2026: "have copies in info@'s Sent folder. fool proof way."
 * An email app puts what it sends into Sent itself; SMTP does not, so the
 * site's emails reached gandhim and the people who wrote in, and info@'s Sent
 * folder stayed empty. This puts them there over IMAP (the same login the
 * site already uses to read replies). Saving into a folder is not sending, so
 * it does not count against GoDaddy's 500-a-day SMTP limit.
 *
 * Fool proof, in this order:
 *
 *   1. kept       The moment SMTP accepts an email, the exact message (the
 *                 same Message-ID, date and attachments) is written to
 *                 Firestore, under sentCopies/<id>, in parts small enough
 *                 for a document. A serverless function can be frozen the
 *                 instant it answers; what is in the database is not lost.
 *   2. saved now  The copy is put into Sent straight away, in the
 *                 background: it never holds up or fails the email itself.
 *   3. saved later Anything still waiting after two minutes is saved by the
 *                 run that reads replies (every ten minutes on Firebase, the
 *                 daily cron on Vercel, "Read the mailbox now" in the panel),
 *                 and retried on every run until it is in.
 *
 * Never twice: before a copy goes in, Sent is searched for its Message-ID,
 * and a copy already there is not added again. Search-then-append is two
 * steps, so two runs at once (Vercel's daily reading, Firebase's ten-minute
 * one, the panel's button) could both search, both find nothing and both
 * append (review C item 12). So each copy is first claimed in a Firestore
 * transaction (a lease, LEASE_MS long): whoever holds it searches and
 * appends, everyone else leaves it. A lease that runs out (a run that died)
 * is anyone's again. Once in, the record is marked saved and the bytes held
 * for the journey are cleared (records are never deleted).
 *
 * One copy the mailbox will not take (too large, refused) no longer holds
 * up the rest (review C item 11): each copy is tried on its own, its
 * attempts counted, and after MAX_REFUSALS refusals it is parked (status
 * 'parked', shown in the panel) instead of being tried forever. A mailbox
 * that cannot be reached at all is not the copy's fault and parks nothing.
 * PFA_SENT_COPY=off turns all of this off. */

const crypto = require('crypto');
const IMAP = require('./imap-open');

const COLLECTION = 'sentCopies';
const PART_BYTES = 700 * 1024;          // under Firestore's 1 MiB per document
const SETTLE_AFTER_MS = 2 * 60 * 1000;  // the immediate attempt's head start
const LEASE_MS = 3 * 60 * 1000;         // one copy's search and append, with room
const MAX_REFUSALS = 5;
const SENT_NAMES = /^(sent|sent items|sent messages|sent mail|inbox[./]sent)$/i;

let makeClient = (options) => {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow(options);
};
let compose = (message) => new Promise((resolve, reject) => {
  const MailComposer = require('nodemailer/lib/mail-composer');
  new MailComposer(Object.assign({}, message)).compile().build((error, raw) => (error ? reject(error) : resolve(raw)));
});
let dbOf = () => require('./firebase').getDb();

/* Which server and which login: lib/imap-open.js, shared with the reading
   of replies. GoDaddy's imap.secureserver.net first (8 Oct 2026). */
function enabled() {
  if (/^off$/i.test(String(process.env.PFA_SENT_COPY || '').trim())) return false;
  return IMAP.configured();
}

const idOf = (messageId) => crypto.createHash('sha256').update(String(messageId), 'utf8').digest('hex').slice(0, 32);

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms); })
  ]).finally(() => clearTimeout(timer));
}

/* ---- the mailbox ------------------------------------------------------ */

async function sentPath(client) {
  const boxes = await client.list();
  const flagged = boxes.find((b) => b.specialUse === '\\Sent');
  if (flagged) return flagged.path;
  const named = boxes.find((b) => SENT_NAMES.test(String(b.path || '')));
  if (named) return named.path;
  await client.mailboxCreate('Sent');
  return 'Sent';
}

/* One copy: searched for by its Message-ID, appended only if not there. */
async function putOne(client, path, copy) {
  let already = [];
  try { already = await client.search({ header: { 'message-id': copy.messageId } }, { uid: true }) || []; } catch (_) { already = []; }
  if (!already.length) {
    await client.append(path, copy.raw, ['\\Seen'], copy.date ? new Date(copy.date) : new Date());
  }
}

/* Opens the mailbox once and runs `items` through it, each on its own: a
   copy the mailbox refuses is noted and the next one is tried. `hooks`:
     prepare(item)  -> the copy to put (claimed and loaded), or null to skip
     done(copy)     after it is in Sent
     failed(copy, error, refused)   refused is false when the connection
                    itself went, which says nothing about the copy
   Resolves to { done: [ids], failed: [{ id, error, refused }] }; throws
   only if the mailbox could not be opened at all. */
async function saveEach(items, hooks) {
  const h = hooks || {};
  const out = { done: [], failed: [] };
  if (!items.length) return out;
  const { client, host } = await IMAP.open(makeClient).catch((error) => {
    error.message = `Sent folder could not be reached. ${error.message}`.slice(0, 400);
    throw error;
  });
  const said = (error) => `Sent folder could not be written: ${host} answered ${IMAP.said(error)}`.slice(0, 400);
  try {
    let path;
    let lock;
    try {
      path = await sentPath(client);
      lock = await client.getMailboxLock(path);
    } catch (error) {
      const wrapped = new Error(said(error));
      wrapped.code = (error && error.code) || 'IMAP_FAILED';
      throw wrapped;
    }
    try {
      for (const item of items) {
        if (client.usable === false) break;   // the connection went: the rest wait for the next run
        const copy = h.prepare ? await h.prepare(item) : item;
        if (!copy) continue;
        try {
          await putOne(client, path, copy);
        } catch (error) {
          const refused = client.usable !== false;
          const failure = { id: copy.id, error: new Error(said(error)), refused };
          out.failed.push(failure);
          if (h.failed) await Promise.resolve(h.failed(copy, failure.error, refused)).catch(() => {});
          continue;
        }
        out.done.push(copy.id);
        if (h.done) await Promise.resolve(h.done(copy)).catch(() => {});
      }
    } finally {
      lock.release();
    }
    return out;
  } finally {
    try { await client.logout(); } catch (_) { /* already gone */ }
  }
}

/* Puts each copy into Sent in one session. Resolves to the ids now in Sent
   (added, or found already there); a copy the mailbox refuses is left out
   and the rest still go. Throws only if the mailbox could not be opened. */
async function saveCopies(copies) {
  return (await saveEach(copies)).done;
}

/* ---- the record ------------------------------------------------------- */

const newToken = () => crypto.randomBytes(12).toString('hex');

/* Writes the record, already claimed by `token` for the attempt that is
   about to be made at once, so no run picks it up meanwhile. Resolves to
   true when written, false when a record for this Message-ID was already
   there (the same email sent again: it is claimed like any other). */
async function store(db, copy, token) {
  const ref = db.collection(COLLECTION).doc(copy.id);
  const parts = [];
  for (let i = 0; i < copy.raw.length; i += PART_BYTES) parts.push(copy.raw.subarray(i, i + PART_BYTES));
  const nowMs = Date.now();
  try {
    await ref.create({
      messageId: copy.messageId, date: copy.date, size: copy.raw.length, parts: parts.length,
      status: 'pending', attempts: 0, refusals: 0, lastError: '', createdAtMs: nowMs,
      leaseUntilMs: token ? nowMs + LEASE_MS : 0, leaseToken: token || ''
    });
  } catch (error) {
    if (error && (error.code === 6 || /already exists/i.test(String(error.message)))) return false;
    throw error;
  }
  for (let i = 0; i < parts.length; i += 1) {
    await ref.collection('parts').doc(String(i)).set({ n: i, data: Buffer.from(parts[i]) });
  }
  return true;
}

/* Claims one copy for one attempt, in a transaction: answers the token, or
   null when the copy is saved, parked, gone, or under someone else's lease. */
async function claim(db, id) {
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() || {};
    const nowMs = Date.now();
    if (d.status !== 'pending' || Number(d.leaseUntilMs || 0) > nowMs) return null;
    const token = newToken();
    transaction.update(ref, { leaseUntilMs: nowMs + LEASE_MS, leaseToken: token });
    return token;
  });
}

/* Records a failed attempt under the claim it was made with (or, with no
   token, only while nobody holds the copy), and lets the lease go. Every
   attempt counts in `attempts`; a refusal by the mailbox itself also counts
   in `refusals`, and the fifth parks the copy. */
async function noteFailure(db, id, token, error, refused) {
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() || {};
    if (d.status !== 'pending') return null;
    const held = Number(d.leaseUntilMs || 0) > Date.now();
    if (token ? d.leaseToken !== token : held) return null;
    const refusals = (Number(d.refusals) || 0) + (refused ? 1 : 0);
    const parked = refusals >= MAX_REFUSALS;
    transaction.update(ref, Object.assign({
      attempts: (Number(d.attempts) || 0) + 1,
      refusals,
      lastError: String((error && error.message) || error || '').slice(0, 300),
      lastErrorAtMs: Date.now(),
      leaseUntilMs: 0,
      leaseToken: ''
    }, parked ? { status: 'parked', parkedAtMs: Date.now() } : {}));
    return parked ? 'parked' : 'pending';
  });
}

/* Lets a claim go without counting an attempt (the copy's parts were not
   all there yet). */
async function release(db, id, token) {
  const ref = db.collection(COLLECTION).doc(id);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || (snap.data() || {}).leaseToken !== token) return;
    transaction.update(ref, { leaseUntilMs: 0, leaseToken: '' });
  });
}

async function load(doc) {
  const d = doc.data() || {};
  const snap = await doc.ref.collection('parts').get();
  const parts = snap.docs.map((p) => p.data() || {}).sort((a, b) => a.n - b.n);
  if (parts.length !== Number(d.parts)) return null;   // still being written
  return { id: doc.id, messageId: d.messageId, date: d.date, raw: Buffer.concat(parts.map((p) => Buffer.from(p.data))) };
}

/* Once the copy is in Sent, the record stays (nothing is ever deleted
   here; test/admin-master-record.test.js holds every server file to that)
   and is marked saved. Only the bytes held for the journey are cleared: the
   email itself is now in the mailbox, and the submission and its photographs
   are untouched in their own records. */
async function forget(db, id) {
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.collection('parts').get();
  for (const p of snap.docs) await p.ref.set({ n: (p.data() || {}).n, data: Buffer.alloc(0), cleared: true });
  await ref.set({ status: 'saved', savedAtMs: Date.now(), lastError: '', leaseUntilMs: 0, leaseToken: '' }, { merge: true });
}

/* On Vercel a function can be frozen as soon as it answers, which would
   stop the copy half way and leave it for the daily cron. Vercel's runtime
   offers waitUntil for exactly this: the function stays alive until the
   promise settles. It is read from the request context, the same place the
   @vercel/functions package reads it, so no dependency is added. Anywhere
   else (Firebase, tests) there is no such context and nothing changes; the
   ten-minute run picks up whatever did not finish. */
function extendLife(promise) {
  try {
    const holder = globalThis[Symbol.for('@vercel/request-context')];
    const context = holder && typeof holder.get === 'function' ? holder.get() : null;
    if (context && typeof context.waitUntil === 'function') context.waitUntil(promise);
  } catch (_) { /* not on Vercel */ }
}

/* ---- in flight in this process ----------------------------------------- */

const inFlight = new Map();

/* Waits, at most `ms`, for the copies this process is saving right now. For
   the panel's own sends (a test, the copies it sends on a press), so the
   answer can say the copy is in Sent. */
async function settle(ms = 12000) {
  const all = [...inFlight.values()];
  if (!all.length) return { saved: 0, waiting: 0 };
  const results = await withTimeout(Promise.allSettled(all), ms, 'Saving to Sent').catch(() => null);
  if (!results) return { saved: 0, waiting: all.length };
  const saved = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  return { saved, waiting: all.length - saved };
}

/* Called by the mailer once SMTP has accepted `message` (nodemailer's own
   message object, with messageId and date already set). Never throws, and
   waits only for the database write (at most 4 s), never for the mailbox. */
async function keep(message) {
  if (!enabled()) return { kept: false };
  try {
    const raw = await compose(message);
    const copy = { id: idOf(message.messageId), messageId: String(message.messageId), date: (message.date instanceof Date ? message.date : new Date()).toISOString(), raw };
    let db = null;
    let token = newToken();
    try {
      db = dbOf();
      const created = await withTimeout(store(db, copy, token), 4000, 'Keeping the copy');
      /* the same Message-ID kept before (an email sent again): claimed like
         any other, and left alone when it is saved or someone holds it */
      if (!created) token = await withTimeout(claim(db, copy.id), 4000, 'Claiming the copy');
    } catch (error) {
      console.warn('sent copy not kept in the database; trying the mailbox at once', error && error.message);
    }
    if (!token) return { kept: true, id: copy.id, skipped: true };
    const failed = (error, refused) => {
      console.warn('sent copy not saved yet; the next mailbox run saves it', error && error.message);
      return db ? noteFailure(db, copy.id, token, error, refused).catch(() => {}) : null;
    };
    const attempt = saveEach([copy], { failed: (c, error, refused) => failed(error, refused) })
      .then(async (result) => {
        if (!result.done.includes(copy.id)) return false;
        if (db) await forget(db, copy.id).catch(() => {});
        return true;
      })
      .catch(async (error) => { await failed(error, false); return false; })
      .finally(() => inFlight.delete(copy.id));
    inFlight.set(copy.id, attempt);
    extendLife(attempt);
    return { kept: true, id: copy.id };
  } catch (error) {
    console.warn('sent copy not made', error && error.message);
    return { kept: false, error: String(error && error.message) };
  }
}

/* Saves everything still waiting (older than the immediate attempt's head
   start, so the two never race). Run by the reading of replies. */
async function flush(db, options) {
  const o = options || {};
  const summary = { saved: 0, waiting: 0, parked: 0, skipped: 0, error: '' };
  if (!enabled()) return summary;
  const snap = await db.collection(COLLECTION).where('status', '==', 'pending').limit(o.limit || 25).get();
  const nowMs = Date.now();
  const cutoff = nowMs - (o.settleAfterMs == null ? SETTLE_AFTER_MS : o.settleAfterMs);
  const due = snap.docs.filter((doc) => {
    const d = doc.data() || {};
    return !inFlight.has(doc.id) && Number(d.createdAtMs || 0) <= cutoff && Number(d.leaseUntilMs || 0) <= nowMs;
  });
  if (!due.length) { summary.waiting = snap.size; return summary; }
  const errors = [];
  try {
    /* each copy is claimed just before its own search and append, so a
       lease covers one copy, not a whole batch */
    const result = await saveEach(due, {
      async prepare(doc) {
        const token = await claim(db, doc.id);
        if (!token) { summary.skipped += 1; return null; }
        const copy = await load(doc);
        if (!copy) { await release(db, doc.id, token); return null; }   // still being written
        return Object.assign(copy, { token });
      },
      done: (copy) => forget(db, copy.id),
      async failed(copy, error, refused) {
        errors.push(String(error && error.message));
        if (await noteFailure(db, copy.id, copy.token, error, refused) === 'parked') summary.parked += 1;
      }
    });
    summary.saved = result.done.length;
    summary.error = errors[0] || '';
  } catch (error) {
    /* the mailbox could not be opened: no copy was tried, so none is
       claimed; each is noted (not as a refusal) for the panel */
    summary.error = String(error && error.message);
    for (const doc of due) await noteFailure(db, doc.id, null, error, false).catch(() => {});
  }
  const left = await db.collection(COLLECTION).where('status', '==', 'pending').limit(200).get();
  summary.waiting = left.size;
  return summary;
}

/* For the panel: how many copies are still on their way to Sent, and why,
   and how many the mailbox refused five times and were parked. */
async function status(db) {
  if (!enabled()) return { on: false, waiting: 0, parked: 0, lastError: '' };
  const snap = await db.collection(COLLECTION).where('status', '==', 'pending').limit(200).get();
  const parked = await db.collection(COLLECTION).where('status', '==', 'parked').limit(200).get();
  const stuck = snap.docs.map((d) => d.data() || {}).filter((d) => Number(d.attempts) > 0 && d.lastError);
  const parkedRows = parked.docs.map((d) => d.data() || {});
  const lastError = stuck.length ? stuck[stuck.length - 1].lastError : (parkedRows.length ? parkedRows[parkedRows.length - 1].lastError || '' : '');
  return {
    on: true, waiting: snap.size, parked: parked.size, lastError,
    parkedIds: parkedRows.slice(0, 20).map((d) => d.messageId)
  };
}

module.exports = {
  enabled, keep, flush, settle, status, idOf, saveCopies, MAX_REFUSALS, extendLife,
  _setClient: (fn) => { makeClient = fn || ((options) => { const { ImapFlow } = require('imapflow'); return new ImapFlow(options); }); },
  _setDb: (fn) => { dbOf = fn || (() => require('./firebase').getDb()); },
  _inFlight: inFlight
};
