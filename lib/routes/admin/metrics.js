/* GET /api/admin/metrics
   The overview: what is waiting, what arrived, what it was worth, and how the
   registers are moving - shaped for the charts on the admin dashboard.

   Firestore charges per document read, so this uses aggregation queries
   (`count()`) wherever a number is all that is wanted. A count is billed as a
   handful of reads rather than one per document, which is what keeps an
   overview page from becoming the most expensive thing on the site. The few
   places that do read documents (arrivals by day, money by purpose) are capped
   and the response says so.

   Nothing here reads a customer record into the response. The numbers are
   counts and sums; the detail lives behind the register tabs, where an
   administrator has to ask for a specific person. */

'use strict';

const { requireAdmin, canAccess } = require('../../../lib/admin-auth');
const { getDb } = require('../../../lib/firebase');

/* One vocabulary for kinds, shared with the intake route and the public tracker. */
const { KIND_LABELS } = require('../../submissions');

const SUBMISSION_STATUSES = ['new', 'in-progress', 'handled', 'spam'];
/* Applications and memberships move through their own stages (lib/case-flow.js,
   8 Oct 2026: a caregiver card issued is "approved", not "handled"). Each stage
   is counted under the generic figure it means for the desk, so the four
   figures still add up to every record: open stages are in progress, closing
   stages are handled. */
const STAGE_BUCKET = {
  'under-review': 'in-progress', shortlisted: 'in-progress', verified: 'in-progress', dispatched: 'in-progress',
  approved: 'handled', rejected: 'handled', withdrawn: 'handled', revoked: 'handled', delivered: 'handled'
};

async function submissionCounts(collection) {
  const out = await countsByValue(collection, 'status', SUBMISSION_STATUSES.concat(Object.keys(STAGE_BUCKET)));
  for (const [stage, bucket] of Object.entries(STAGE_BUCKET)) {
    out[bucket] = (out[bucket] || 0) + (out[stage] || 0);
    delete out[stage];
  }
  return out;
}
/* The payment flow writes these (lib/firebase.js applyPaymentResult). A
   payment that went through is 'success' - there is no 'paid' status, and
   counting one would always give zero. */
const PAYMENT_TYPES = ['donate', 'caregiver', 'caregiver-application', 'membership', 'shop'];
const STORE_STATUSES = ['AWAITING_PAYMENT', 'CONFIRMED', 'FULFILLED', 'CANCELLED', 'REFUND_RECORDED', 'PAYMENT_FAILED'];
/* Direct-pay orders (storePayments): PFA took the money. PLACEMENT_FAILED is
   paid and not with the seller, which is the one figure on this page that
   means somebody has to act today. */
const DIRECT_STATUSES = ['PENDING_PAYMENT', 'PAID', 'PLACED', 'PLACEMENT_FAILED', 'REFUNDED'];

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const MONTHS_BACK = 12;
const READ_CAP = 1000;

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

/* ---- pure shaping, tested in test/admin-metrics.test.js ------------------ */

/* 'YYYY-MM-DD' in UTC for the day a timestamp falls on. The dashboard labels
   days, not hours, so UTC is fine and keeps every caller consistent. */
function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function monthKey(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}

/* Every day in the window, oldest first, each with a zero that the data fills
   in - a chart must show the quiet days as quiet, not skip them. */
function dayBuckets(nowMs, days = WINDOW_DAYS) {
  const start = nowMs - (days - 1) * DAY_MS;
  const out = [];
  for (let i = 0; i < days; i += 1) out.push({ day: dayKey(start + i * DAY_MS), count: 0, amount: 0 });
  return out;
}

function fillDays(buckets, items, getMs, getAmount) {
  const index = new Map(buckets.map((b, i) => [b.day, i]));
  items.forEach((item) => {
    const ms = getMs(item);
    if (!ms) return;
    const i = index.get(dayKey(ms));
    if (i === undefined) return;
    buckets[i].count += 1;
    if (getAmount) buckets[i].amount += Number(getAmount(item)) || 0;
  });
  return buckets;
}

/* The last N calendar months as [{ month:'YYYY-MM', fromIso, toIso }], oldest
   first, for range counts on ISO-string date fields. */
function monthRanges(nowMs, months = MONTHS_BACK) {
  const now = new Date(nowMs);
  const out = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    out.push({ month: monthKey(from.getTime()), fromIso: from.toISOString(), toIso: to.toISOString() });
  }
  return out;
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/* ---- Firestore ------------------------------------------------------------ */

async function countOf(query) {
  try {
    const snapshot = await query.count().get();
    return snapshot.data().count;
  } catch (error) {
    // Older firebase-admin without aggregation support: fall back to a capped
    // read so the panel degrades to "at least this many" rather than breaking.
    const snapshot = await query.limit(500).get();
    return snapshot.size;
  }
}

async function countsByValue(collection, field, values) {
  const out = {};
  await Promise.all(values.map(async (value) => {
    out[value] = await countOf(collection.where(field, '==', value));
  }));
  return out;
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED' });
  }

  const who = await requireAdmin(request, response, 'overview');
  if (!who) return;
  /* Each section of the dashboard belongs to a register. Someone without
     Payments is not shown money, and the queries for it are not even run. */
  const can = (module) => canAccess(who, module);
  const ifCan = (module, promise) => (can(module) ? promise() : Promise.resolve(null));

  try {
    const db = getDb();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const since7 = nowMs - 7 * DAY_MS;
    const since30 = nowMs - WINDOW_DAYS * DAY_MS;
    const plus = (days) => new Date(nowMs + days * DAY_MS).toISOString();
    const months = monthRanges(nowMs);

    const submissions = db.collection('submissions');
    const members = db.collection('members');
    const caregivers = db.collection('caretakerPublic');
    const transactions = db.collection('transactions');
    const storeOrders = db.collection('storeOrders');
    const storePayments = db.collection('storePayments');

    const [
      submissionsTotal, submissions7, submissionsByStatus, waitingByKind,
      membersTotal, membersExpired, expiring30, expiring60, expiring90, joinedByMonth,
      caregiversTotal, caregiversPrinted, caregiversExpired,
      storeByStatus, directByStatus, directMirrored,
      recentSubmissions, recentTransactions, paidStoreOrders, paidDirectOrders
    ] = await Promise.all([
      /* minus the removed: set aside whole by the panel, kept but counted
         nowhere, like everything else on this page they no longer appear in */
      ifCan('submissions', async () => {
        const [all, removed] = await Promise.all([
          countOf(submissions),
          countOf(submissions.where('status', '==', 'removed'))
        ]);
        return all === null ? null : Math.max(0, all - (removed || 0));
      }),
      ifCan('submissions', () => countOf(submissions.where('receivedAtMs', '>=', since7))),
      ifCan('submissions', () => submissionCounts(submissions)),
      ifCan('submissions', () => Promise.all(Object.keys(KIND_LABELS).map(async (kind) => [
        kind, await countOf(submissions.where('kind', '==', kind).where('status', '==', 'new'))
      ]))),

      ifCan('members', () => countOf(members)),
      ifCan('members', () => countOf(members.where('validUntil', '<', nowIso))),
      ifCan('members', () => countOf(members.where('validUntil', '>=', nowIso).where('validUntil', '<', plus(30)))),
      ifCan('members', () => countOf(members.where('validUntil', '>=', nowIso).where('validUntil', '<', plus(60)))),
      ifCan('members', () => countOf(members.where('validUntil', '>=', nowIso).where('validUntil', '<', plus(90)))),
      ifCan('members', () => Promise.all(months.map(async (m) => ({
        month: m.month,
        count: await countOf(members.where('memberSince', '>=', m.fromIso).where('memberSince', '<', m.toIso))
      })))),

      ifCan('caregivers', () => countOf(caregivers)),
      ifCan('caregivers', () => countOf(caregivers.where('printed', '==', true))),
      ifCan('caregivers', () => countOf(caregivers.where('validUntil', '<', nowIso))),

      ifCan('store', () => countsByValue(storeOrders, 'status', STORE_STATUSES)),
      ifCan('store', () => countsByValue(storePayments, 'status', DIRECT_STATUSES)),
      /* Mirrors of direct-pay orders, so the same order is not counted twice. */
      ifCan('store', () => countOf(storeOrders.where('directPay', '==', true))),

      /* Arrivals by day: one small field per document, capped. */
      ifCan('submissions', () => submissions.where('receivedAtMs', '>=', since30).select('receivedAtMs', 'kind').limit(READ_CAP).get()),
      /* The most recent transactions, every outcome, so the dashboard can show
         both what was paid and how many attempts did not complete. Ordered on
         a single field so no composite index is needed. */
      ifCan('payments', () => transactions.orderBy('createdAt', 'desc').select('createdAt', 'status', 'type', 'amount', 'currency').limit(READ_CAP).get()),
      ifCan('store', () => storeOrders.where('status', 'in', ['CONFIRMED', 'FULFILLED']).select('createdAt', 'total', 'currency').limit(READ_CAP).get()),
      ifCan('store', () => storePayments.where('status', 'in', ['PAID', 'PLACED', 'PLACEMENT_FAILED']).select('createdAt', 'total', 'currency').limit(READ_CAP).get())
    ]);

    /* Submissions --------------------------------------------------------- */
    const arrivals = fillDays(dayBuckets(nowMs), (recentSubmissions ? recentSubmissions.docs : []).map((d) => d.data()), (r) => Number(r.receivedAtMs) || 0);
    const byKind = {};
    (waitingByKind || []).forEach(([kind, waiting]) => { byKind[kind] = { label: KIND_LABELS[kind], waiting }; });
    const submissionsWaiting = (submissionsByStatus && submissionsByStatus.new) || 0;

    /* Money ----------------------------------------------------------------- */
    const rows = (recentTransactions ? recentTransactions.docs : []).map((d) => d.data());
    const paid = rows.filter((r) => r.status === 'success' && millisOf(r.createdAt) >= since30);
    const attempted30 = rows.filter((r) => millisOf(r.createdAt) >= since30);
    const inr = (r) => String(r.currency || 'INR').toUpperCase() !== 'USD';
    const revenue = { inr: 0, usd: 0, count: paid.length, capped: Boolean(recentTransactions) && recentTransactions.size >= READ_CAP };
    const byType = {};
    PAYMENT_TYPES.forEach((t) => { byType[t] = { inr: 0, usd: 0, count: 0 }; });
    paid.forEach((r) => {
      const amount = Number(r.amount) || 0;
      const bucket = byType[r.type] || (byType[r.type] = { inr: 0, usd: 0, count: 0 });
      if (inr(r)) { revenue.inr += amount; bucket.inr += amount; } else { revenue.usd += amount; bucket.usd += amount; }
      bucket.count += 1;
    });
    const paymentsByDay = fillDays(dayBuckets(nowMs), paid.filter(inr), (r) => millisOf(r.createdAt), (r) => r.amount);
    const outcomes = { success: 0, failed: 0, abandoned: 0, pending: 0 };
    attempted30.forEach((r) => {
      const s = String(r.status || '');
      if (s === 'success') outcomes.success += 1;
      else if (s === 'failed' || s === 'verification_failed') outcomes.failed += 1;
      else if (s === 'aborted' || s === 'cancelled') outcomes.abandoned += 1;
      else outcomes.pending += 1;
    });

    /* Store ----------------------------------------------------------------- */
    /* Revenue counts each order once: a direct-pay order is in storePayments
       and, once the seller's webhook lands, in storeOrders too. The mirrors
       are excluded from the storeOrders side by the directPay flag. */
    const storeRows = (paidStoreOrders ? paidStoreOrders.docs : []).map((d) => d.data())
      .filter((r) => !r.directPay && millisOf(r.createdAt) >= since30);
    const directRows = (paidDirectOrders ? paidDirectOrders.docs : []).map((d) => d.data()).filter((r) => millisOf(r.createdAt) >= since30);
    const storeRevenue30 = storeRows.concat(directRows).reduce((sum, r) => sum + (Number(r.total) || 0), 0);
    const directPaid = ['PAID', 'PLACED', 'PLACEMENT_FAILED', 'REFUNDED'].reduce((sum, s) => sum + ((directByStatus || {})[s] || 0), 0);
    const storeNeedsAttention = (directByStatus || {}).PLACEMENT_FAILED || 0;

    return sendJson(response, 200, {
      ok: true,
      generatedAt: new Date(nowMs).toISOString(),
      windowDays: WINDOW_DAYS,
      cards: {
        submissionsWaiting,
        submissionsTotal,
        submissionsLast7: submissions7,
        members: membersTotal,
        caregivers: caregiversTotal,
        paymentsPaid: revenue.count,
        storeOrders: STORE_STATUSES.reduce((sum, s) => sum + ((storeByStatus || {})[s] || 0), 0) - (directMirrored || 0) + directPaid,
        storeOrdersAwaitingShipment: ((storeByStatus || {}).CONFIRMED || 0) + ((directByStatus || {}).PLACED || 0) + ((directByStatus || {}).PAID || 0),
        storeNeedsAttention
      },
      access: { role: who.role, modules: who.modules },
      byKind,
      revenue30d: can('payments') ? revenue : undefined,
      submissions: can('submissions') ? { byStatus: submissionsByStatus, arrivals, arrivalsCapped: recentSubmissions.size >= READ_CAP } : undefined,
      payments: can('payments') ? { byDay: paymentsByDay, byType, outcomes30d: outcomes } : undefined,
      members: can('members') ? {
        total: membersTotal,
        expired: membersExpired,
        current: Math.max(0, membersTotal - membersExpired),
        expiring: { in30: expiring30, in60: expiring60, in90: expiring90 },
        joinedByMonth
      } : undefined,
      caregivers: can('caregivers') ? {
        total: caregiversTotal,
        printed: caregiversPrinted,
        unprinted: Math.max(0, caregiversTotal - caregiversPrinted),
        expired: caregiversExpired
      } : undefined,
      store: can('store') ? { byStatus: storeByStatus, direct: directByStatus, needsAttention: storeNeedsAttention, revenue30d: storeRevenue30 } : undefined
    });
  } catch (error) {
    console.error('admin metrics failed', error && error.message);
    return sendJson(response, 500, { code: 'SERVER_ERROR', message: 'The overview could not be built.' });
  }
};

module.exports._private = { dayBuckets, fillDays, monthRanges, dayKey, millisOf, KIND_LABELS, PAYMENT_TYPES, STORE_STATUSES, DIRECT_STATUSES };
