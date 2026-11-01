'use strict';

/* Bringing the old site's payments into a monthly report, once each
   (owner, 1 Nov 2026: "For today's October report, combine the old site's
   payment records from 1-21 October with the new site's records from its
   launch on 21-31 October. Reconcile the migration overlap using payment
   gateway transaction IDs and reference numbers so every payment is
   included exactly once. Do not deduplicate by name or amount alone.
   Verify the combined totals against gateway records, resolve any
   discrepancies, then send the complete report.").

   1. The old site's export (its payments CSV: date, category, name, ...,
      amount, currency, method, orderId, matchedBy, ...) is uploaded in the
      panel for a month. Only what a report needs is kept: the date, the
      category, the payer's name, the amount and currency, the method and
      the order id CCAvenue knows it by. No email, mobile or address.
      Rows outside the month's old-site window (1 to 21 October for
      October 2026) are left out and said so.

   2. Each payment, old and new, is asked about at CCAvenue (the Order
      Status API, lib/ccavenue.js), a few at a time, so the panel can show
      progress. CCAvenue's answer is the gateway record: its status, its
      amount, its own tracking number and the bank's reference.

   3. Reconciliation. Two records are the same payment when they share a
      gateway identifier: the order id CCAvenue knows (compared without
      punctuation or case), CCAvenue's tracking number, or the bank's
      reference. Never by name, amount or date: two people can give the same
      amount on the same day, and one person can give twice. When old and new
      both hold a payment, the new site's record is counted (it carries every
      reference) and the old one is listed as matched, with the identifier
      that matched. Records that only look alike (same name, amount and day,
      different gateway identifiers) are both counted and listed for a look.

   4. Discrepancies, resolved by the gateway's word:
        CCAvenue says it did not succeed (aborted, failed, refunded,
        chargeback, ...)      left out of the totals and listed with the reason
        a different amount    counted at CCAvenue's amount, and listed
        CCAvenue could not be asked or does not know the order
                              counted as the site recorded it, and listed as
                              not confirmed with the gateway

   The report then says, in the email and the CSV, how many came from each
   site, how many matched, what the gateway confirmed, and what was left out. */

const COLLECTION_IMPORTS = 'finance_imports';
const COLLECTION_CHECKS = 'finance_checks';

/* Months whose report must include the old site's payments, and the days
   of that month the old site was taking them. */
const OLD_SITE_WINDOWS = {
  '2026-10': { from: '2026-10-01', to: '2026-10-21', note: 'The old site took payments until 21 October 2026; the new site from its launch on 21 October.' }
};

const GOOD = new Set(['shipped', 'successful', 'success', 'confirmed']);
const BAD = new Set(['aborted', 'cancelled', 'canceled', 'unsuccessful', 'failure', 'failed', 'invalid', 'fraud', 'refunded', 'system refund', 'chargeback', 'auto-cancelled', 'auto-reversed', 'timeout', 'initiated', 'awaited']);

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const idKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/* a reference worth matching on: long enough, and not a placeholder */
const usable = (v) => { const k = idKey(v); return k.length >= 6 && !/^(NA|NULL|NONE|0+)$/.test(k) ? k : ''; };

/* ---- the old site's CSV ---------------------------------------------- */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const OLD_HEADS = { Donation: 'donations', Gift: 'donations', Campaign: 'donations', Sponsorship: 'donations', Membership: 'membership' };

/* The rows of the old site's export that belong to `month`'s window. */
function parseOld(text, month) {
  const window = OLD_SITE_WINDOWS[month];
  if (!window) throw new Error(`No old-site window is set for ${month}.`);
  const table = parseCsv(text);
  if (!table.length) throw new Error('The file is empty.');
  const head = table[0].map((h) => clean(h, 40).toLowerCase());
  const col = (name) => head.indexOf(name);
  for (const need of ['date', 'category', 'name', 'amount', 'orderid']) {
    if (col(need) < 0) throw new Error(`The file has no "${need}" column. Use the old site's payments export.`);
  }
  const rows = [];
  const skipped = [];
  const seen = new Set();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const get = (name) => (col(name) >= 0 ? clean(r[col(name)], 200) : '');
    const date = get('date');
    const orderId = clean(get('orderid'), 80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped.push({ line, orderId, reason: 'No date' }); return; }
    if (date < window.from || date > window.to) { skipped.push({ line, orderId, date, reason: `Outside ${window.from} to ${window.to}` }); return; }
    const amount = Math.round(Number(String(get('amount')).replace(/[^0-9.]/g, '')) * 100) / 100;
    if (!(amount > 0)) { skipped.push({ line, orderId, date, reason: 'No amount' }); return; }
    if (!usable(orderId)) { skipped.push({ line, date, reason: 'No order id: cannot be matched with the gateway' }); return; }
    if (seen.has(idKey(orderId))) { skipped.push({ line, orderId, date, reason: 'The same order id twice in the file' }); return; }
    seen.add(idKey(orderId));
    const category = get('category') || 'Payment';
    rows.push({
      source: 'old',
      head: OLD_HEADS[category] || 'other',
      date,
      time: '',
      paidAtMs: Date.parse(`${date}T06:30:00.000Z`),
      name: clean(get('name'), 120) || 'Not given',
      purpose: `${category} (old site)`,
      amount,
      currency: (get('currency') || 'INR').toUpperCase() === 'USD' ? 'USD' : 'INR',
      status: 'Success',
      orderId,
      reference: '',
      bankReference: '',
      trackingId: '',
      mode: clean(get('method'), 40),
      oldMatchedBy: clean(get('matchedby'), 30)
    });
  });
  return { rows, skipped, window };
}

async function importOld(db, month, text, by, nowMs = Date.now()) {
  const parsed = parseOld(text, month);
  const at = new Date(nowMs).toISOString();
  await db.collection(COLLECTION_IMPORTS).doc(month).set({
    month, source: 'old-site', window: parsed.window, rows: parsed.rows, skipped: parsed.skipped,
    importedAt: at, importedBy: clean(by, 120), count: parsed.rows.length
  });
  return { count: parsed.rows.length, skipped: parsed.skipped, window: parsed.window };
}

async function importOf(db, month) {
  const snap = await db.collection(COLLECTION_IMPORTS).doc(month).get();
  return snap.exists ? snap.data() || null : null;
}

/* ---- the gateway's word ---------------------------------------------- */

async function checksOf(db, month) {
  const snap = await db.collection(COLLECTION_CHECKS).doc(month).get();
  return snap.exists ? (snap.data() || {}).byOrder || {} : {};
}

function verdict(answer, row) {
  const said = clean(answer.orderStatus, 40).toLowerCase();
  const amount = Math.round(Number(answer.amount) * 100) / 100;
  const base = { gatewayStatus: clean(answer.orderStatus, 40), gatewayAmount: Number.isFinite(amount) ? amount : null,
    trackingId: clean(answer.trackingId, 100), bankReference: clean(answer.bankReference, 100), mode: clean(answer.paymentMode, 60) };
  if (BAD.has(said)) return Object.assign(base, { state: 'not-successful' });
  if (!GOOD.has(said)) return Object.assign(base, { state: 'unknown-status' });
  if (base.gatewayAmount != null && Math.abs(base.gatewayAmount - row.amount) >= 0.01) return Object.assign(base, { state: 'amount-differs' });
  return Object.assign(base, { state: 'confirmed' });
}

/* Ask CCAvenue about up to `limit` payments of the month not asked yet (or
   whose last asking failed). Returns { checked, left }. `ask(orderId,
   row)` resolves to lib/ccavenue.js orderStatus()'s answer. */
async function verify(db, month, { rows, ask, limit = 10, nowMs = Date.now() }) {
  const done = await checksOf(db, month);
  const todo = rows.filter((r) => !done[idKey(r.orderId)] || done[idKey(r.orderId)].state === 'unreachable').slice(0, limit);
  const results = {};
  await Promise.all(todo.map(async (r) => {
    let v;
    try {
      v = verdict(await ask(r.orderId, r), r);
    } catch (error) {
      const msg = clean(error && error.message, 200);
      v = { state: /could not report|not found|no record|invalid order/i.test(msg) ? 'not-found' : 'unreachable', error: msg };
    }
    results[idKey(r.orderId)] = Object.assign(v, { orderId: r.orderId, source: r.source, checkedAt: new Date(nowMs).toISOString() });
  }));
  if (todo.length) {
    const ref = db.collection(COLLECTION_CHECKS).doc(month);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const byOrder = Object.assign({}, snap.exists ? (snap.data() || {}).byOrder || {} : {}, results);
      tx.set(ref, { month, byOrder, updatedAt: new Date(nowMs).toISOString() }, { merge: true });
    });
  }
  const all = Object.assign({}, done, results);
  const left = rows.filter((r) => !all[idKey(r.orderId)] || all[idKey(r.orderId)].state === 'unreachable').length;
  return { checked: todo.length, left, total: rows.length };
}

/* ---- once each --------------------------------------------------------- */

function keysOf(row, check) {
  return [usable(row.orderId), usable(row.trackingId || (check && check.trackingId)), usable(row.bankReference || (check && check.bankReference))].filter(Boolean);
}

/* newRows: this site's (lib/finance-report.js collect); oldRows: the import;
   checks: the gateway's answers by order id. */
function reconcile(newRows, oldRows, checks) {
  const c = checks || {};
  const counted = [];
  const matched = [];
  const excluded = [];
  const corrected = [];
  const unconfirmed = [];
  const lookalikes = [];
  const owner = new Map();   // gateway identifier -> the counted row
  let confirmed = 0;

  const take = (row) => {
    const check = c[idKey(row.orderId)];
    const keys = keysOf(row, check);
    const twin = keys.map((k) => owner.get(k)).find(Boolean);
    if (twin) {
      const by = keys.find((k) => owner.get(k) === twin);
      const how = by === usable(row.orderId) ? 'order id' : by === usable(row.trackingId || (check && check.trackingId)) ? 'CCAvenue tracking number' : 'bank reference';
      matched.push({ kept: twin.orderId, keptSource: twin.source, dropped: row.orderId, droppedSource: row.source, by: how, amount: row.amount, sameAmount: Math.abs(twin.amount - row.amount) < 0.01 });
      return;
    }
    const out = Object.assign({}, row);
    if (check) {
      if (check.trackingId && !out.trackingId) out.trackingId = check.trackingId;
      if (check.bankReference && !out.bankReference) out.bankReference = check.bankReference;
      if (check.mode && !out.mode) out.mode = check.mode;
      if (check.state === 'not-successful') {
        excluded.push({ orderId: row.orderId, source: row.source, name: row.name, amount: row.amount, currency: row.currency, reason: `CCAvenue: ${check.gatewayStatus || 'not successful'}` });
        keys.forEach((k) => owner.set(k, out));
        return;
      }
      if (check.state === 'amount-differs') {
        corrected.push({ orderId: row.orderId, source: row.source, name: row.name, recorded: row.amount, gateway: check.gatewayAmount, currency: row.currency });
        out.amount = check.gatewayAmount;
        out.gateway = 'confirmed, amount corrected';
        confirmed += 1;
      } else if (check.state === 'confirmed') {
        out.gateway = 'confirmed';
        confirmed += 1;
      } else {
        out.gateway = 'not confirmed';
        unconfirmed.push({ orderId: row.orderId, source: row.source, name: row.name, amount: row.amount, currency: row.currency, reason: check.state === 'not-found' ? 'CCAvenue has no record of this order id' : check.state === 'unknown-status' ? `CCAvenue status: ${check.gatewayStatus}` : `Could not ask CCAvenue: ${check.error || 'no answer'}` });
      }
    } else {
      out.gateway = 'not asked';
      unconfirmed.push({ orderId: row.orderId, source: row.source, name: row.name, amount: row.amount, currency: row.currency, reason: 'Not checked with CCAvenue yet' });
    }
    keysOf(out, null).forEach((k) => owner.set(k, out));
    counted.push(out);
  };

  /* the new site's records first: when both hold a payment, theirs is kept */
  newRows.forEach(take);
  oldRows.forEach(take);

  /* alike, never merged: same name, amount and day on both sites, different gateway ids */
  const sig = (r) => `${String(r.name).toLowerCase().replace(/\s+/g, ' ')}|${r.amount}|${r.date}`;
  const bySig = new Map();
  for (const r of counted) {
    const k = sig(r);
    if (bySig.has(k) && bySig.get(k).source !== r.source) lookalikes.push({ a: bySig.get(k).orderId, b: r.orderId, name: r.name, amount: r.amount, date: r.date });
    else bySig.set(k, r);
  }

  counted.sort((a, b) => a.paidAtMs - b.paidAtMs || a.orderId.localeCompare(b.orderId));
  return {
    rows: counted,
    summary: {
      newSite: newRows.length, oldSite: oldRows.length,
      matched: matched.length, counted: counted.length,
      confirmed, unconfirmed: unconfirmed.length, corrected: corrected.length, excluded: excluded.length
    },
    matched, excluded, corrected, unconfirmed, lookalikes
  };
}

module.exports = {
  OLD_SITE_WINDOWS, COLLECTION_IMPORTS, COLLECTION_CHECKS,
  parseCsv, parseOld, importOld, importOf, checksOf, verify, verdict, reconcile, idKey, usable
};
