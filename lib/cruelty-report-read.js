'use strict';

/* The monthly cruelty report's read of the submissions
   (lib/cruelty-report.js): the month's cruelty reports, India time, as rows
   for the PDF and the email. Reads only; the report's own record is written
   by cruelty-report.js. Also the calendar both use. */

const KIND = 'PFA-CR';
const IST_MS = 330 * 60000;
const SEND_DAY = 2;
const LAST_DAY = 8;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS = { new: 'New', 'in-progress': 'Being handled', handled: 'Closed' };
const LEFT_OUT = new Set(['spam', 'removed']);

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\t]+/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n || 200);
const line = (v, n) => clean(v, n).replace(/\n+/g, ' ');
const pad = (n) => String(n).padStart(2, '0');

/* ---- the calendar, India time ---------------------------------------- */

function istParts(ms) {
  const d = new Date(Number(ms) + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

function bounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error('A month is YYYY-MM.');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error('A month is YYYY-MM.');
  return { from: Date.UTC(y, mo - 1, 1) - IST_MS, to: Date.UTC(y, mo, 1) - IST_MS, label: `${MONTHS[mo - 1]} ${y}` };
}

function previousMonth(nowMs) {
  const p = istParts(nowMs);
  return p.m === 1 ? `${p.y - 1}-12` : `${p.y}-${pad(p.m - 1)}`;
}

function currentMonth(nowMs) {
  const p = istParts(nowMs);
  return `${p.y}-${pad(p.m)}`;
}

/* The 2nd, India time, or up to the 8th if the 2nd went by without a run. */
function due(nowMs) {
  const p = istParts(nowMs);
  return p.day >= SEND_DAY && p.day <= LAST_DAY;
}

/* "14 Oct 2026, 3:42 pm" */
function when(ms) {
  const p = istParts(ms);
  const h = p.hh % 12 || 12;
  return `${p.day} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}, ${h}:${pad(p.mm)} ${p.hh < 12 ? 'am' : 'pm'}`;
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

/* "9876543210" -> "+91 98765 43210"; anything else as it was given */
function mobileOf(v) {
  const d = String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : line(v, 30);
}

/* ---- reading the reports ---------------------------------------------- */

async function collect(db, month) {
  const { from, to } = bounds(month);
  const TEST = require('./test-data');
  const INDIA = require('../assets/india-districts.js');
  const snap = await db.collection('submissions').where('kind', '==', KIND).get();
  const rows = [];
  const leftOut = { spam: 0, removed: 0 };
  for (const doc of snap.docs || []) {
    const r = Object.assign({ reference: doc.id }, doc.data() || {});
    const at = Number(r.receivedAtMs) || millis(r.createdAt);
    if (!at || at < from || at >= to) continue;
    if (TEST.isTest && TEST.isTest(r)) continue;
    const status = String(r.status || 'new');
    if (LEFT_OUT.has(status)) { leftOut[status] += 1; continue; }
    const f = r.fields || {};
    const stateGiven = line(f.state, 60);
    const state = stateGiven && INDIA.isState(stateGiven) ? stateGiven : '';
    rows.push({
      reference: line(r.reference || doc.id, 40),
      atMs: at,
      when: when(at),
      status: STATUS[status] || line(status, 30),
      name: line(f.name, 120) || 'Not given',
      mobile: mobileOf(f.mobile),
      email: line(f.email, 160),
      address: clean(f.address, 400),
      city: line(f.city, 80),
      district: line(f.district, 80),
      state,
      stateGiven: state ? '' : stateGiven,
      pincode: line(f.pincode, 10).replace(/\s+/g, ''),
      mapLink: /^https?:\/\//i.test(String(f.mapLink || '').trim()) ? line(f.mapLink, 300) : '',
      animal: line(f.animal, 60),
      urgency: line(f.urgency, 40),
      happened: line(f.when, 200),
      accused: clean(f.accused, 600),
      what: clean(f.what, 6000),
      photos: Number(r.attachments) || 0
    });
  }
  rows.sort((a, b) => a.atMs - b.atMs || a.reference.localeCompare(b.reference));
  return { rows, leftOut };
}

module.exports = { KIND, SEND_DAY, LAST_DAY, MONTHS, STATUS, LEFT_OUT, istParts, bounds, previousMonth, currentMonth, due, when, millis, mobileOf, clean, line, collect };
