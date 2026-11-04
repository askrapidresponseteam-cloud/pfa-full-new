'use strict';

/* A report for a period from five sections of the panel: Volunteers,
   Interns, Shop orders, Job applicants and the Colony card register (owner,
   4 Nov 2026, with the five sections: "these also should have date and range
   filters and option to send the report to those email;
   anushkapfacampus@gmail.com").

   Members (the register) came the same day. rowsFor(db, kind, period) gives the section's lines that fall in the
   period (India time), newest first, with the columns the CSV and the panel
   show. send() keeps the CSV (Firebase Storage, or the record), files
   section_report_sends/{id}, and queues one email per address chosen
   (template section_report in lib/caregiver-mail.js), the CSV attached.

   To whom:
     every section but the shop   the forms inbox, the reports inbox
                                  (PFA_SECTION_REPORT_TO, by default
                                  anushkapfacampus@gmail.com) and the
                                  payments inboxes
     shop orders                  money, so only where money goes (owner,
                                  21 Oct 2026): the payments inboxes, or the
                                  forms inbox with them in copy
                                  (lib/finance-report.js periodRecipients).
   No other address, whatever is asked; lib/caregiver-mail.js deliver()
   checks again at the last door. */

const crypto = require('crypto');

const SENDS = 'section_report_sends';
const IST_MS = 330 * 60000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_ROWS = 300;
const DEFAULT_REPORT_TO = 'anushkapfacampus@gmail.com';
const LEFT_OUT = new Set(['spam', 'removed']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const KINDS = {
  volunteers: { label: 'Volunteers', module: 'volunteers', file: 'volunteers', money: false },
  jobs: { label: 'Job applicants', module: 'employees', file: 'job-applicants', money: false },
  interns: { label: 'Interns', module: 'internship', file: 'interns', money: false },
  shop: { label: 'Shop orders', module: 'shop', file: 'shop-orders', money: true },
  caregivers: { label: 'Colony card register', module: 'caregivers', file: 'colony-cards', money: false },
  /* owner, 4 Nov 2026, on the Members register: "where is the option to send
     this to email..". The register, not the money: no amount is in it, so it
     goes where the other registers go. */
  members: { label: 'Members register', module: 'membership', file: 'members', money: false }
};

const ROLES = { 'zonal-head': 'Zonal Head', 'veterinary-team': 'Veterinary doctors', 'cruelty-response-coordinator': 'Cruelty Response Coordinator', 'social-media-fundraising': 'Social Media and Fundraising', internship: 'Internship' };

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
const pad = (n) => String(n).padStart(2, '0');

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

/* "4 Nov 2026", India time */
function dayText(ms) {
  if (!ms) return '';
  const d = new Date(ms + IST_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function dayKey(ms) {
  const d = new Date(ms + IST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/* ---- the period ------------------------------------------------------- */

function istDay(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - IST_MS : null;
}

/* { from, to } as days (YYYY-MM-DD, India time, either order, either left
   out) -> { from, to, label, file } in milliseconds; neither is all time. */
function periodOf(input, nowMs = Date.now()) {
  const q = input || {};
  let a = q.from ? istDay(q.from) : null;
  let z = q.to ? istDay(q.to) : null;
  if ((q.from && a === null) || (q.to && z === null)) throw Object.assign(new Error('A date is YYYY-MM-DD.'), { code: 'BAD_DATE' });
  if (a !== null && z !== null && z < a) { const x = a; a = z; z = x; }
  const from = a === null ? 0 : a;
  let to = z === null ? nowMs : z + DAY_MS;
  if (from >= nowMs) throw Object.assign(new Error('That period has not begun yet.'), { code: 'NOT_BEGUN' });
  if (to > nowMs) to = nowMs;
  const label = a === null && z === null ? `All time, to ${dayText(nowMs)}`
    : a === null ? `Up to ${dayText(to - 1)}`
      : (dayKey(from) === dayKey(to - 1) ? dayText(from) : `${dayText(from)} to ${dayText(to - 1)}`);
  const file = from ? `${dayKey(from)}-to-${dayKey(to - 1)}` : `to-${dayKey(to - 1)}`;
  return { from, to, label, file };
}

/* ---- the lines, by section ------------------------------------------- */

async function submissions(db, kind) {
  const TEST = require('./test-data');
  const FLOW = require('./case-flow');
  const snap = await db.collection('submissions').where('kind', '==', kind).get();
  const out = [];
  for (const doc of snap.docs || []) {
    const d = doc.data() || {};
    if (TEST.isTest(d) || LEFT_OUT.has(String(d.status || ''))) continue;
    out.push({ id: doc.id, d, f: d.fields || {}, at: Number(d.receivedAtMs) || millis(d.createdAt), status: FLOW.labelOf(kind, d.status || 'new') });
  }
  return out;
}

const list = (v) => (Array.isArray(v) ? v.join(', ') : v);
const placeOf = (f) => [f.city, f.district, f.state].map((x) => clean(x, 60)).filter(Boolean).join(', ');

const READERS = {
  async volunteers(db) {
    const rows = await submissions(db, 'PFA-V');
    return {
      columns: ['Reference', 'Name', 'Mobile', 'Email', 'Town', 'Areas', 'Status', 'Arrived'],
      lines: rows.map((r) => ({ at: r.at, id: r.id, name: clean(r.f.name, 100), cells: [r.id, clean(r.f.name, 100), clean(r.f.mobile, 20), clean(r.f.email, 160), placeOf(r.f), clean(list(r.f.title), 200), r.status, dayText(r.at)] }))
    };
  },
  async jobs(db) {
    const rows = await submissions(db, 'PFA-J');
    return {
      columns: ['Reference', 'Name', 'Post', 'Zone', 'Mobile', 'Email', 'Status', 'Applied'],
      lines: rows.map((r) => ({ at: r.at, id: r.id, name: clean(r.f.name, 100), cells: [r.id, clean(r.f.name, 100), ROLES[r.f.roleId] || clean(r.f.roleId, 60) || ROLES['zonal-head'], clean(r.f.zone, 60), clean(r.f.mobile, 20), clean(r.f.email, 160), r.status, dayText(r.at)] }))
    };
  },
  async interns(db, nowMs) {
    const rows = await require('./intern-admin-view').register(db, nowMs);
    return {
      columns: ['Intern ID', 'Name', 'Mobile', 'Email', 'Town', 'College', 'Batch', 'Tasks accepted', 'Law quiz', 'Shelter', 'Certificate', 'Status', 'Joined'],
      lines: rows.map((r) => {
        const at = millis(r.createdAt);
        const p = r.progress || {};
        const q = r.quiz || {};
        return { at, id: r.internId, name: clean(r.name, 100), cells: [
          r.internId, clean(r.name, 100), clean(r.mobile, 20), clean(r.email, 160), clean(r.town, 120), clean(r.college, 120), clean(r.batch, 60),
          p.accepted != null ? `${p.accepted} of ${p.need}` : '', q.best != null ? `${q.best}%${q.passed ? ' pass' : ''}` : 'Not taken',
          r.place ? clean(`${r.place.name}${r.place.city ? `, ${r.place.city}` : ''}`, 120) : '', r.certificate ? clean(r.certificate.number, 40) : '',
          clean(r.status, 30), dayText(at)
        ] };
      })
    };
  },
  async shop(db) {
    const rows = await require('./routes/admin/shop-orders')._private.paidOrders(db);
    return {
      columns: ['Order', 'Name', 'Mobile', 'Email', 'Deliver to', 'Items', 'Amount (INR)', 'Stage', 'Courier', 'Tracking number', 'Ordered'],
      lines: rows.map((r) => {
        const at = millis(r.at);
        const s = r.shipment || {};
        return { at, id: r.orderId, name: clean(r.name, 100), amount: Number(r.total) || 0, cells: [
          r.orderId, clean(r.name, 100), clean(r.mobile, 20), clean(r.email, 160), clean(r.place, 300), clean((r.items || []).join('; '), 400),
          (Number(r.total) || 0).toFixed(2), r.stage === 'shipped' ? 'Shipped' : 'To ship', clean(s.courier, 60), clean(s.trackingNumber, 60), dayText(at)
        ] };
      })
    };
  },
  async caregivers(db) {
    const rows = await require('./routes/admin/registers')._test.caregiverRows(db);
    return {
      columns: ['Application', 'Caregiver number', 'Name', 'Mobile', 'Email', 'Address', 'Courier', 'Tracking number', 'Status', 'Applied'],
      lines: rows.map((r) => ({ at: r.sortMs, id: r.id, name: clean(r.name, 100), cells: [
        r.id, clean(r.caregiverNo, 24), clean(r.name, 100), clean(r.mobile, 20), clean(r.email, 160),
        clean((r.lines || []).join(', ') || [r.address, r.city, r.state, r.pin].filter(Boolean).join(', '), 300),
        clean(r.courier, 60), clean(r.tracking, 60), clean(r.shipLabel || 'Processing', 40), dayText(r.sortMs)
      ] }))
    };
  },
  async members(db, nowMs) {
    const rows = await require('./routes/admin/registers')._test.membershipRows(db, nowMs);
    return {
      columns: ['Membership', 'Member number', 'Name', 'Mobile', 'Email', 'Address', 'Membership type', 'Card', 'Courier', 'Tracking number', 'Status', 'Joined'],
      lines: rows.map((r) => ({ at: r.sortMs, id: r.id, name: clean(r.name, 100), cells: [
        r.id, clean(r.memberNo, 24), clean(r.name, 100), clean(r.mobile, 20), clean(r.email, 160),
        clean((r.lines || []).join(', ') || [r.address, r.city, r.state, r.pin].filter(Boolean).join(', '), 300),
        clean(r.type, 60), clean(r.cardStage, 40), clean(r.courier, 60), clean(r.tracking, 60), clean(r.shipLabel || 'Processing', 40), dayText(r.sortMs)
      ] }))
    };
  }
};

/* The section's lines in the period, newest first. */
async function rowsFor(db, kind, period, nowMs = Date.now()) {
  if (!KINDS[kind]) throw Object.assign(new Error('No such section.'), { code: 'BAD_KIND' });
  const got = await READERS[kind](db, nowMs);
  const lines = got.lines.filter((l) => l.at && l.at >= period.from && l.at < period.to)
    .sort((a, b) => b.at - a.at || String(a.id).localeCompare(String(b.id)));
  const out = { kind, label: KINDS[kind].label, period: period.label, columns: got.columns, count: lines.length, rows: lines };
  if (KINDS[kind].money) out.total = Math.round(lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100;
  return out;
}

/* ---- the CSV ---------------------------------------------------------- */

function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvOf(report) {
  const lines = [];
  const row = (cells) => lines.push(cells.map(csvCell).join(','));
  row([`PFA ${report.label}, ${report.period} (India time)`]);
  row([]);
  row(report.columns);
  for (const r of report.rows) row(r.cells);
  row([]);
  row([`${report.count} ${report.count === 1 ? 'line' : 'lines'}`].concat(report.total != null ? [`Total INR ${report.total.toFixed(2)}`] : []));
  return `\ufeff${lines.join('\r\n')}\r\n`;
}
const fileName = (kind, period) => `PFA-${KINDS[kind].file}-${period.file}.csv`;

/* ---- who it may go to -------------------------------------------------- */

function reportInbox() {
  const named = String(process.env.PFA_SECTION_REPORT_TO || '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return named.length ? named : [DEFAULT_REPORT_TO];
}

/* [{ address, role, cc }] for a section, as the panel offers them */
function recipients(kind) {
  if (!KINDS[kind]) return [];
  if (KINDS[kind].money) return require('./finance-report').periodRecipients();
  const FWD = require('./submission-forward');
  const out = [];
  const add = (address, role) => {
    const a = String(address || '').trim().toLowerCase();
    if (a && !out.some((x) => x.address === a)) out.push({ address: a, role, cc: [] });
  };
  add((FWD.formInboxes() || [])[0], 'Forms inbox');
  reportInbox().forEach((a) => add(a, 'Reports'));
  (FWD.paymentInboxes() || []).forEach((a) => add(a, 'Payments inbox'));
  return out;
}

function allowed(kind, to) {
  return recipients(kind).some((x) => x.address === String(to || '').trim().toLowerCase());
}

/* ---- the email --------------------------------------------------------- */

/* What the email shows: the first few columns of each line, up to
   EMAIL_ROWS lines (the CSV has every column of every line). */
function payloadOf(report, extra) {
  const show = Math.min(report.columns.length, 5);
  const rows = report.rows.slice(0, EMAIL_ROWS).map((r) => r.cells.slice(0, show).concat([r.cells[r.cells.length - 1]]));
  return Object.assign({
    kind: report.kind, label: report.label, period: report.period, count: report.count,
    total: report.total != null ? `INR ${report.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '',
    columns: report.columns.slice(0, show).concat([report.columns[report.columns.length - 1]]),
    rows, more: Math.max(0, report.count - rows.length)
  }, extra || {});
}

async function send({ db, kind, period, to, by = '', nowMs = Date.now(), siteUrl = '', mail, queue } = {}) {
  if (!KINDS[kind]) throw Object.assign(new Error('No such section.'), { code: 'BAD_KIND' });
  const store = queue || require('./caregiver-store');
  const sender = mail || require('./caregiver-mail');
  const offered = recipients(kind);
  const asked = [...new Set((Array.isArray(to) ? to : [to]).map((a) => String(a || '').trim().toLowerCase()).filter(Boolean))];
  if (!asked.length) throw Object.assign(new Error('Choose who the report goes to.'), { code: 'NO_RECIPIENT' });
  const stray = asked.filter((a) => !offered.some((x) => x.address === a));
  if (stray.length) {
    throw Object.assign(new Error(KINDS[kind].money
      ? `Shop orders are a record of money: they go only to the payments inboxes or the forms inbox, not ${stray.join(', ')}.`
      : `This report goes only to the addresses offered, not ${stray.join(', ')}.`), { code: 'NOT_ALLOWED' });
  }
  /* the forms inbox carries the payments inboxes in copy: no second email to them */
  const form = offered.find((x) => x.cc.length && asked.includes(x.address));
  const copied = form ? form.cc : [];
  const targets = asked.filter((a) => !copied.includes(a));

  const report = await rowsFor(db, kind, period, nowMs);
  const csv = csvOf(report);
  const sendId = `S-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const csvName = fileName(kind, period);
  const kept = await (async () => {
    const bytes = Buffer.from(csv, 'utf8');
    const k = await require('./file-store').put(`section-reports/${sendId}.csv`, bytes, 'text/csv; charset=utf-8');
    return k.bytes && k.bytes.length > 700 * 1024 ? null : k;
  })();
  const ref = db.collection(SENDS).doc(sendId);
  await ref.set({
    sendId, kind, at: new Date(nowMs).toISOString(), by, label: report.label, period: report.period,
    from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(),
    count: report.count, csv: kept, csvName, recipients: targets, copied, emails: []
  });
  const payload = payloadOf(report, { sendId, csvName, siteUrl: String(siteUrl || '').replace(/\/+$/, '') });
  const configured = sender.isConfigured();
  const emails = [];
  for (const address of targets) {
    const queued = await store.queueEmail({ template: 'section_report', to: address, dedupeKey: `${sendId}:${address}`, claim: configured ? 'section-report' : undefined, payload });
    const e = { to: address, cc: form && address === form.address ? copied : [], emailId: queued.emailId, state: 'queued' };
    if (queued.created && configured) {
      try {
        const out = await sender.deliver({ to: address, template: 'section_report', payload });
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: true, providerId: out.providerId });
        e.state = 'sent';
      } catch (error) {
        await store.recordEmailResult({ emailId: queued.emailId, claimToken: queued.claimToken, ok: false, error });
        e.state = 'retrying'; e.error = clean(error && error.message, 200);
      }
    }
    emails.push(e);
  }
  await ref.update({ emails });
  return { state: emails.every((e) => e.state === 'sent') ? 'sent' : 'queued', sendId, label: report.label, period: report.period, count: report.count, emails };
}

/* The CSV a sent report carried, for its email (and only for the section it
   was made for). */
async function readSentCsv(db, sendId, kind) {
  if (!/^S-[0-9A-F]{10}$/.test(String(sendId || ''))) return null;
  const snap = await db.collection(SENDS).doc(String(sendId)).get();
  const d = snap.exists ? snap.data() || {} : {};
  if (!d.csv || (kind && d.kind !== kind)) return null;
  const bytes = await require('./file-store').read(d.csv);
  return bytes ? { name: d.csvName || `PFA-report-${sendId}.csv`, bytes: Buffer.from(bytes) } : null;
}

module.exports = { KINDS, SENDS, EMAIL_ROWS, DEFAULT_REPORT_TO, periodOf, rowsFor, csvOf, fileName, recipients, allowed, payloadOf, send, readSentCsv, reportInbox };
