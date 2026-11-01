'use strict';

/* The Monday digest's read of the register (lib/weekly-digest.js): last
   week's records, India time, as rows for the email. Reads only; the
   digest's own record is written by weekly-digest.js. */

const IST_MS = 330 * 60000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LEFT_OUT = new Set(['PFA-DON']);
const pad = (n) => String(n).padStart(2, '0');
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);
function ist(ms) {
  const d = new Date(Number(ms) + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
function millis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  return 0;
}

function nameOf(record) {
  const f = record.fields || {};
  const key = Object.keys(f).find((k) => /^(name|fullname|full name|your name|applicant|applicantname)$/i.test(k));
  return clean(key ? f[key] : record.name, 120) || 'Name not given';
}

function placeOf(record) {
  const f = record.fields || {};
  const key = Object.keys(f).find((k) => /^(city|district|town|place)$/i.test(k));
  return clean(key ? f[key] : '', 60);
}

function statusOf(record) {
  const S = require('./submissions');
  const status = String(record.status || 'new');
  return S.stageLabel(record.kind, status) || (S.PUBLIC_STATUS && S.PUBLIC_STATUS[status]) || status.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

async function collect(db, week, { bounds, caseLink, groupOf }) {
  const { from, to } = bounds(week);
  const TEST = require('./test-data');
  const S = require('./submissions');
  const snap = await db.collection('submissions')
    .where('createdAt', '>=', new Date(from).toISOString())
    .where('createdAt', '<', new Date(to).toISOString())
    .get();
  const rows = [];
  for (const doc of snap.docs || []) {
    const r = Object.assign({ reference: doc.id }, doc.data() || {});
    const kind = String(r.kind || '');
    if (!kind || LEFT_OUT.has(kind) || r.status === 'removed') continue;
    if (TEST.isTest && TEST.isTest(r)) continue;
    const at = millis(r.createdAt);
    if (!at || at < from || at >= to) continue;
    const p = ist(at);
    rows.push({
      reference: clean(r.reference || doc.id, 60),
      kind,
      kindLabel: clean(r.kindLabel || S.KIND_LABELS[kind] || 'Form', 60),
      group: groupOf(kind),
      name: nameOf(r),
      place: placeOf(r),
      at,
      date: `${p.day} ${MONTHS[p.m - 1]}, ${pad(p.hh)}:${pad(p.mm)}`,
      status: statusOf(r),
      open: !r.status || r.status === 'new',
      link: caseLink(clean(r.reference || doc.id, 60))
    });
  }
  rows.sort((a, b) => a.at - b.at || a.reference.localeCompare(b.reference));
  return rows;
}

module.exports = { collect, LEFT_OUT };
