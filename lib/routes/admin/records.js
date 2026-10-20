/* GET /api/admin/records?type=members|caregivers&q=&limit=&cursor=
   GET /api/admin/records?type=session

   One route behind the admin panel: who am I, and show me the records.

   Members and caregivers are read from their own collections and never merged,
   so the two registers stay separate in the panel exactly as they are in
   Firestore. Search is a prefix match on the document id (the card number)
   plus an exact match on mobile, because Firestore cannot do substring search
   without a separate index - anything cleverer would need Algolia or similar,
   and is not worth adding until the registers are large enough to need it. */

'use strict';

const { requireAdmin } = require('../../../lib/admin-auth');
const { getDb, normalizedMobile } = require('../../../lib/firebase');
const audit = require('../../../lib/admin-audit');

const MAX_LIMIT = 100;

/* Each register is its own module; the session check needs none. The audit log
   is the exception: it is not a register of the public's records but of the
   office's own actions, so it sits behind People, which is super-only. */
const MODULE_FOR = {
  members: 'members', caregivers: 'caregivers', submissions: 'submissions',
  payments: 'payments', audit: 'people'
};

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function memberRow(id, data) {
  return {
    id,
    cardId: data.memberId || id,
    name: data.name || '',
    email: data.email || '',
    mobile: data.mobile || '',
    status: data.status || '',
    physicalCard: Boolean(data.physicalCard),
    memberSince: data.memberSince || '',
    validUntil: data.validUntil || '',
    hasPassword: Boolean(data.hasPassword),
    source: data.source || ''
  };
}

function caregiverRow(id, data) {
  return {
    id,
    cardId: data.cardId || id,
    name: data.name || '',
    issuedAt: data.issuedAt || '',
    validUntil: data.validUntil || '',
    printed: Boolean(data.printed),
    status: data.status || ''
  };
}

/* One vocabulary for kinds, shared with the intake route and the public tracker. */
const { KIND_LABELS, isReference } = require('../../submissions');
const FLOW = require('../../case-flow');

function submissionRow(id, data) {
  return {
    id,
    reference: data.reference || id,
    kind: data.kind || '',
    kindLabel: data.kindLabel || KIND_LABELS[data.kind] || data.kind || '',
    status: data.status || 'new',
    statusLabel: FLOW.labelOf(data.kind || '', data.status || 'new'),
    page: data.page || '',
    createdAt: data.createdAt || '',
    receivedAtMs: data.receivedAtMs || 0,
    attachments: Number(data.attachments) || 0,
    replyCount: Number(data.replyCount) || 0,
    noteCount: Number(data.noteCount) || 0,
    lastReplyAt: data.lastReplyAt || null,
    assignedTo: data.assignedTo && data.assignedTo.email ? data.assignedTo.email : '',
    updatedAt: data.updatedAt || data.handledAt || data.createdAt || null,
    fields: data.fields || {}
  };
}

function isoOf(value) {
  if (!value) return '';
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function paymentRow(id, data) {
  const customer = data.customer || {};
  const cca = data.ccaVenue || {};
  const meta = data.metadata || {};
  return {
    id,
    orderId: data.orderId || id,
    type: data.type || '',
    amount: Number(data.amount) || 0,
    currency: String(data.currency || 'INR').toUpperCase(),
    status: data.status || '',
    name: customer.name || '',
    email: customer.email || '',
    mobile: customer.mobile || '',
    address: [customer.address, customer.district, customer.state, customer.pin].filter(Boolean).join(', '),
    trackingId: cca.trackingId || '',
    bankReference: cca.bankReference || '',
    paymentMode: cca.paymentMode || '',
    responseStatus: cca.responseStatus || '',
    failureMessage: cca.failureMessage || '',
    memberId: data.memberId || meta.memberId || '',
    cardId: data.cardId || meta.cardId || '',
    note: meta.note || meta.purpose || meta.message || '',
    /* a payment that settled an order already cancelled (lib/shop-backend.js) */
    needsAttention: data.needsAttention === true,
    attentionNote: data.attentionNote || '',
    settledAfter: data.settledAfter || '',
    createdAt: isoOf(data.createdAt),
    updatedAt: isoOf(data.updatedAt)
  };
}

function expired(validUntil) {
  if (!validUntil) return null;
  const until = new Date(validUntil);
  if (isNaN(until.getTime())) return null;
  return until.getTime() < Date.now();
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  const query = request.query || {};
  const type = String(query.type || 'session');
  const who = await requireAdmin(request, response, MODULE_FOR[type]);
  if (!who) return;

  if (type === 'audit') {
    try {
      const page = await audit.read(getDb(), {
        limit: query.limit, cursor: query.cursor,
        actor: String(query.actor || '').trim().toLowerCase(),
        action: String(query.action || '').trim()
      });
      return sendJson(response, 200, { ok: true, type, rows: page.rows, total: page.rows.length, done: page.done, cursor: page.cursor });
    } catch (error) {
      console.error('admin audit read failed', error && error.message);
      return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The log could not be read.' });
    }
  }

  if (type === 'session') {
    return sendJson(response, 200, {
      ok: true,
      admin: { uid: who.uid, email: who.email, name: who.name, mode: who.mode, role: who.role, modules: who.modules, legacy: Boolean(who.legacy) }
    });
  }

  const TYPES = {
    members: 'members',
    caregivers: 'caretakerPublic',
    submissions: 'submissions',
    payments: 'transactions'
  };
  if (!TYPES[type]) {
    return sendJson(response, 400, {
      code: 'BAD_TYPE',
      message: 'type must be members, caregivers, submissions or payments.'
    });
  }
  const isMembers = type === 'members';

  const term = String(query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), MAX_LIMIT);

  try {
    const db = getDb();
    const collection = TYPES[type];

    /* A submission is found by its reference, the number the sender was given. */
    if (type === 'submissions' && term) {
      const reference = term.toUpperCase().replace(/\s+/g, '');
      /* Checked before it is used as a document id (8 Oct 2026): "PFA-Q/2026"
         made the Firestore client throw ("must point to a document") and the
         register answered 500. Something that is not a reference simply
         finds nothing. */
      if (!isReference(reference)) {
        return sendJson(response, 200, {
          ok: true, type, rows: [], total: 0, done: true, cursor: null,
          message: 'That is not a reference. A reference reads like PFA-C-2026-00042.'
        });
      }
      const doc = await db.collection('submissions').doc(reference).get();
      const rows = doc.exists ? [withState(submissionRow(doc.id, doc.data()))] : [];
      return sendJson(response, 200, {
        ok: true, type, rows, total: rows.length, done: true, cursor: null,
        message: rows.length ? '' : 'No submission carries that reference. It reads like PFA-C-2026-00042.'
      });
    }

    /* A single record: either a card number or a mobile. Answered directly so
       the commonest thing an administrator does - look up one person who is on
       the phone - never pages through the register. */
    if (term && type !== 'payments') {
      const upper = term.toUpperCase();

      if (/^PFA-(MBR|CCT)-[A-Z0-9]{8}$/.test(upper)) {
        const snapshot = isMembers
          ? await db.collection('members').doc(upper).get()
          : await db.collection('caretakerPublic').doc(upper).get();
        const rows = snapshot.exists
          ? [isMembers ? memberRow(snapshot.id, snapshot.data()) : caregiverRow(snapshot.id, snapshot.data())]
          : [];
        return sendJson(response, 200, { ok: true, type, rows: rows.map(withState), total: rows.length, done: true });
      }

      const mobile = normalizedMobile(term);
      if (mobile && isMembers) {
        const snapshot = await db.collection('members').where('mobile', '==', mobile).limit(limit).get();
        const rows = snapshot.docs.map((doc) => withState(memberRow(doc.id, doc.data())));
        return sendJson(response, 200, { ok: true, type, rows, total: rows.length, done: true });
      }

      return sendJson(response, 200, {
        ok: true, type, rows: [], total: 0, done: true,
        message: 'Search by full card number, or by mobile number for members.'
      });
    }

    /* Browsing.

       Submissions are the one register where recency is what matters - an
       administrator wants what just arrived - so they are read newest-first on
       the timestamp the intake route writes. Firestore will only combine that
       ordering with a status or category filter if a composite index has been
       built in the console, and a register that goes blank until someone
       clicks an index link is not a register. So the filters are applied
       here, to pages read in arrival order, which needs nothing but the
       single-field index every field has by default. */
    if (type === 'submissions') {
      const page = await scanSubmissions(db, {
        kind: String(query.kind || ''), status: String(query.status || ''),
        cursor: query.cursor ? Number(query.cursor) : null, limit
      });
      return sendJson(response, 200, {
        ok: true, type, rows: page.rows.map((r) => withState(r)), total: page.rows.length, done: page.done, cursor: page.cursor
      });
    }

    if (type === 'payments') {
      const f = paymentFilters(query);
      const wantCsv = String(query.format || '') === 'csv';
      const page = await scanPayments(db, f, {
        cursor: query.cursor ? Number(query.cursor) : null, limit,
        wantSummary: wantCsv || !query.cursor, cap: wantCsv ? 5000 : undefined
      });
      if (wantCsv) {
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.setHeader('Content-Disposition', `attachment; filename="pfa-payments-${new Date().toISOString().slice(0, 10)}.csv"`);
        response.setHeader('Cache-Control', 'no-store');
        return response.end('\ufeff' + csvOf(page.all));
      }
      /* Sorting by anything but arrival needs the whole filtered set; in that
         case the page is a slice of it and the cursor is an offset. */
      let rows = page.rows, done = page.done, cursor = page.cursor;
      if (f.sort !== 'newest') {
        const offset = Number(query.offset) || 0;
        rows = page.all.slice(offset, offset + limit);
        done = offset + limit >= page.all.length;
        cursor = null;
      }
      return sendJson(response, 200, {
        ok: true, type, rows, total: rows.length, done, cursor,
        offset: f.sort !== 'newest' ? (Number(query.offset) || 0) + rows.length : undefined,
        summary: page.summary, capped: page.capped, filters: f
      });
    }

    /* The others page on document id, which needs no composite index either;
       store orders on their creation time. */
    const newestFirst = type === 'store';
    const orderField = type === 'store' ? 'createdAt' : '__name__';

    let base = db.collection(collection);

    let ref = newestFirst
      ? base.orderBy(orderField, 'desc').limit(limit + 1)
      : base.orderBy(orderField).limit(limit + 1);
    if (query.cursor) {
      ref = newestFirst
        ? base.orderBy(orderField, 'desc').startAfter(String(query.cursor)).limit(limit + 1)
        : base.orderBy(orderField).startAfter(String(query.cursor)).limit(limit + 1);
    }

    const snapshot = await ref.get();
    const docs = snapshot.docs.slice(0, limit);
    const shape = { members: memberRow, caregivers: caregiverRow, payments: paymentRow }[type];
    const rows = docs.map((doc) => withState(shape(doc.id, doc.data())));

    return sendJson(response, 200, {
      ok: true,
      type,
      rows,
      total: rows.length,
      done: snapshot.docs.length <= limit,
      cursor: docs.length
        ? (type === 'store' ? docs[docs.length - 1].data().createdAt : docs[docs.length - 1].id)
        : null
    });
  } catch (error) {
    console.error('admin records failed', error && error.message);
    const needsIndex = error && (error.code === 9 || /requires an index/i.test(String(error.message)));
    return sendJson(response, 500, {
      code: needsIndex ? 'INDEX_REQUIRED' : 'SERVER_ERROR',
      message: needsIndex
        ? 'Firestore needs an index for that filter. Open the Vercel function logs: the error there carries a one-click link to create it.'
        : 'Those records could not be read.'
    });
  }
};

/* Reads submissions newest-first in slices and keeps the ones that match,
   until a page is full or the register runs out. A few hundred documents is
   the normal case; the scan is capped so a pathological filter cannot read
   the whole collection in one request. */
const SCAN_SLICE = 200;
const SCAN_CAP = 2000;

/* Memberships recorded before 7 Oct 2026 carry no receivedAtMs, and an
   ordered query skips any document without the field it orders by, so they
   were on record and invisible here. Once per server instance, the first
   time the register is read, each one gets the field from its own createdAt.
   update(), never a merge: test/submissions.test.js forbids merging into a
   submission. A failure is logged and the register is still read. */
let healed = null;
function healUnlisted(db) {
  if (healed) return healed;
  healed = (async () => {
    const snap = await db.collection('submissions').where('kind', '==', 'PFA-MEM').limit(500).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (Number.isFinite(Number(data.receivedAtMs)) && Number(data.receivedAtMs) > 0) continue;
      const at = Date.parse(data.createdAt || '') || Date.now();
      await doc.ref.update({ receivedAtMs: at });
    }
  })().catch((error) => {
    console.warn('membership records not relisted', error && error.message);
    healed = null;
  });
  return healed;
}

/* The register's status filter names the four generic states. A kind with
   stages (lib/case-flow.js, 8 Oct 2026) is found under the one its stage
   means: its first stage under new, a closing stage (a card issued, an
   application not taken forward) under handled, any other stage under in
   progress. A stage asked for by its own key matches exactly. */
function inBucket(data, wanted) {
  const status = data.status || 'new';
  if (status === wanted) return true;
  const kind = data.kind || '';
  if (!FLOW.flowOf(kind).staged || ['new', 'in-progress', 'handled', 'spam'].includes(status)) return false;
  const bucket = status === 'new' ? 'new' : FLOW.isClosed(kind, status) ? 'handled' : 'in-progress';
  return bucket === wanted;
}

async function scanSubmissions(db, { kind, status, cursor, limit }) {
  await healUnlisted(db);
  const rows = [];
  let after = cursor;
  let scanned = 0;
  let exhausted = false;
  while (rows.length <= limit && !exhausted && scanned < SCAN_CAP) {
    let ref = db.collection('submissions').orderBy('receivedAtMs', 'desc').limit(SCAN_SLICE);
    if (after !== null && after !== undefined && Number.isFinite(after)) ref = ref.startAfter(after);
    const snapshot = await ref.get();
    if (snapshot.empty) { exhausted = true; break; }
    for (const doc of snapshot.docs) {
      scanned += 1;
      const data = doc.data();
      after = Number(data.receivedAtMs) || 0;
      /* A removed record is off the register. It is listed only when asked
         for by name (status=removed), which is how one is found to restore;
         the audit log carries the reference either way. */
      const hidden = data.status === 'removed';
      if (hidden !== (status === 'removed')) continue;
      if ((!kind || data.kind === kind) && (hidden || !status || inBucket(data, status))) {
        rows.push(submissionRow(doc.id, data));
        if (rows.length > limit) break;
      }
    }
    if (snapshot.size < SCAN_SLICE) exhausted = true;
  }
  const page = rows.slice(0, limit);
  const more = rows.length > limit || (!exhausted && scanned >= SCAN_CAP);
  return { rows: page, done: !more, cursor: more && page.length ? page[page.length - 1].receivedAtMs : null };
}

/* Payments: every filter at once, newest first, with no composite index.
   The date range rides on the query itself (a single field, createdAt);
   purpose, status, amount and search are applied to each slice here. The
   summary is the whole filtered set, not the page, so totals are honest. */
const PAYMENT_STATUSES = { paid: ['success'], failed: ['failed'], unverified: ['verification_failed'], abandoned: ['aborted', 'cancelled'], started: ['initiated', 'pending', 'awaited'] };
const { timestampFromMillis } = require('../../firebase');

function paymentFilters(query) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const day = (v) => { const d = new Date(String(v || '')); return isNaN(d.getTime()) ? null : d.getTime(); };
  const statuses = String(query.status || '').split(',').map((s) => s.trim()).filter(Boolean)
    .flatMap((s) => PAYMENT_STATUSES[s] || [s]);
  return {
    types: String(query.purpose || query.type2 || '').split(',').map((s) => s.trim()).filter(Boolean),
    statuses,
    currency: String(query.currency || '').toUpperCase(),
    from: day(query.from),
    to: query.to ? day(query.to) + 24 * 60 * 60 * 1000 - 1 : null,
    min: num(query.min),
    max: num(query.max),
    q: String(query.q || '').trim().toLowerCase(),
    sort: ['newest', 'oldest', 'amount-desc', 'amount-asc'].includes(String(query.sort)) ? String(query.sort) : 'newest'
  };
}

function paymentMatches(row, f) {
  if (f.types.length && !f.types.includes(row.type)) return false;
  if (f.statuses.length && !f.statuses.includes(row.status)) return false;
  if (f.currency && row.currency !== f.currency) return false;
  if (f.min !== null && row.amount < f.min) return false;
  if (f.max !== null && row.amount > f.max) return false;
  if (f.q) {
    const hay = [row.orderId, row.name, row.email, row.mobile, row.trackingId, row.bankReference, row.memberId, row.cardId].join(' ').toLowerCase();
    if (!hay.includes(f.q)) return false;
  }
  return true;
}

async function scanPayments(db, f, { cursor, limit, wantSummary, cap }) {
  const base = () => {
    let q = db.collection('transactions');
    if (f.from !== null) q = q.where('createdAt', '>=', timestampFromMillis(f.from));
    if (f.to !== null) q = q.where('createdAt', '<=', timestampFromMillis(f.to));
    return q.orderBy('createdAt', 'desc');
  };
  const rows = [];
  const summary = { count: 0, paidCount: 0, paidInr: 0, paidUsd: 0, failed: 0, abandoned: 0, started: 0, unverified: 0 };
  let after = cursor;
  let scanned = 0;
  let exhausted = false;
  const bySort = f.sort !== 'newest';
  const needAll = wantSummary || bySort;
  while ((needAll || rows.length <= limit) && !exhausted && scanned < (cap || SCAN_CAP)) {
    let ref = base().limit(SCAN_SLICE);
    if (after) ref = ref.startAfter(timestampFromMillis(after));
    const snapshot = await ref.get();
    if (snapshot.empty) { exhausted = true; break; }
    for (const doc of snapshot.docs) {
      scanned += 1;
      const row = paymentRow(doc.id, doc.data());
      after = new Date(row.createdAt).getTime() || after;
      if (!paymentMatches(row, f)) continue;
      summary.count += 1;
      if (row.status === 'success') { summary.paidCount += 1; if (row.currency === 'USD') summary.paidUsd += row.amount; else summary.paidInr += row.amount; }
      else if (row.status === 'failed') summary.failed += 1;
      else if (row.status === 'verification_failed') summary.unverified += 1;
      else if (row.status === 'aborted' || row.status === 'cancelled') summary.abandoned += 1;
      else summary.started += 1;
      rows.push(row);
      if (!needAll && rows.length > limit) break;
    }
    if (snapshot.size < SCAN_SLICE) exhausted = true;
  }
  if (bySort) {
    rows.sort((a, b) => f.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : f.sort === 'amount-desc' ? b.amount - a.amount : a.amount - b.amount);
  }
  const page = rows.slice(0, limit);
  const more = rows.length > limit || (!exhausted && scanned >= (cap || SCAN_CAP));
  return {
    rows: page, done: !more, all: rows,
    /* In arrival order the cursor is the last row's time, whether or not the
       whole set was scanned for the summary; sorted views page by offset. */
    cursor: !bySort && more && page.length ? new Date(page[page.length - 1].createdAt).getTime() : null,
    summary: wantSummary ? summary : null,
    capped: !exhausted && scanned >= (cap || SCAN_CAP)
  };
}

function csvOf(rows) {
  const cols = ['orderId', 'createdAt', 'type', 'status', 'amount', 'currency', 'name', 'email', 'mobile', 'paymentMode', 'trackingId', 'bankReference', 'memberId', 'cardId', 'failureMessage'];
  const cell = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return cols.join(',') + '\n' + rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\n') + '\n';
}

function withState(row) {
  const isExpired = expired(row.validUntil);
  return Object.assign({}, row, {
    expired: isExpired,
    state: isExpired === null ? 'unknown' : (isExpired ? 'expired' : 'valid')
  });
}


/* for tests: forget that the relisting has run in this process */
module.exports._resetHeal = () => { healed = null; };
