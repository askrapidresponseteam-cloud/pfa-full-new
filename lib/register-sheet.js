'use strict';

/* The two registers, kept in the office's Google Sheet (owner, 5 Nov 2026:
   "can membership, catc be written here [the sheet] user data should be
   protected. locked so that one doesnt accidentally mess with it?", "1 tab
   for members 1 for catc", "only courier details and date of shipping
   should be editable. the whole details and address of the user should be
   captured in the sheet", "enterprise grade").

   What the sheet holds
     Two tabs, CATC (every paid colony card application the website took)
     [statuses and card numbers left out, owner, 5 Nov 2026: "THESE COLUMNS
     Status, Card number, Card stage, Card status ARE NOT NEEDED IN THE G
     SHEET"]
     and Membership (every paid membership; "Members" until 5 Nov 2026,
     renamed in place): the same lines as the panel's two
     registers (lib/routes/admin/registers.js), with everything the person
     gave: name, numbers, email, the full address and each part of it. Never
     the fee, the order or the bank reference: money records go only to the
     two finance addresses.

   Locked
     Each tab is protected so that only the website can change it. The three
     yellow columns are the exception: Courier, Tracking number and Shipped
     on, typed by the office as cards go out. Google always lets the sheet's
     owner past a protection; anything changed outside the yellow columns,
     by anyone, is put back at the next run, because the website rewrites
     the tab from its own records whenever the two differ.

   The yellow columns go into the panel
     A run reads the sheet first. Where a yellow cell differs from what the
     website last wrote there, the office has typed it: it is saved to the
     application through the register's own save (the same checks, India
     Post numbers and all, the same history line, the same audit entry, by
     "Google Sheet"). Courier, tracking number and date all present: the card
     is shipped. Some of them: it is being prepared. A typed value that
     cannot be taken stays where it was typed, and the last column, Sheet
     check, says why, until it is put right. Nothing is ever emailed from
     here: the shipping letter still goes from the panel, previewed first.

   When it runs
     Every ten minutes, beside the email worker (functions/index.js), and at
     once from the panel's Update now. A run costs one read of the sheet;
     the records are read in full, and the tabs written, only when
     something changed: a typed yellow cell, a record changed since the last
     run (three small queries), a tab that no longer matches what was
     written, or a day since the last full write. One run at a time (a
     lease on the state record).

   Access, at no cost
     The website signs in to Google as its own service account: the key it
     already has on Vercel, or, on Firebase, the project's own account from
     the metadata server. The sheet is shared with that address as an
     Editor, and the Google Sheets API is switched on for the project; the
     panel says which of the two is missing, with the address to share with. */

const crypto = require('crypto');
const firebase = require('./firebase');

const DEFAULT_SHEET = '1L7y18AmQYEbAPVFIbG4ARYLyn-je8UM57b3jtEUWI_k';
const STATE = ['registerSheet', 'state'];
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const LEASE_MS = 4 * 60 * 1000;
const FULL_EVERY_MS = 24 * 60 * 60 * 1000;
const CALL_TIMEOUT_MS = 20000;
const PROTECTION = 'PFA website: written by the website. Only the yellow columns are typed in.';
/* Google lets a sheet's owner past any lock. A second, warning-only
   protection over the written columns asks even the owner to confirm
   before changing one (owner, 5 Nov 2026: "A-P COLUMNS SHOULD BE STRICTLY
   NON EDITABLE!"); whatever is changed is put back at the next run. */
const WARNING = 'PFA website: these columns are written by the website. A change here is put back within ten minutes.';
const COURIERS = ['India Post', 'Speed Post', 'DTDC', 'Blue Dart', 'Delhivery', 'Professional Couriers', 'Ekart', 'Xpressbees', 'Shadowfax', 'Shree Maruti Courier', 'Trackon', 'Gati', 'DHL'];
const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;
const PREFIX = { caregiver: 'PFA-CG-', membership: 'PFA-MEM-' };
const SEP = '\u0001';

const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 200);

function sheetId() {
  const v = String(process.env.PFA_REGISTER_SHEET_ID || '').trim();
  if (/^off$/i.test(v)) return '';
  return /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : DEFAULT_SHEET;
}
function sheetUrl(id) { return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : ''; }

/* ---- the tabs ----------------------------------------------------------- */

const EDIT = ['courier', 'tracking', 'shippedOn'];
const address = (r) => (r.lines || []).join('\n');
/* "PNB 1378 (was PB 1378)": a number given before the state codes of 11 Nov
   2026 says the number it was (lib/member-numbers.js relabel) */
const numberWas = (key) => (r) => (r[key] ? r[key] + (r[`${key}Was`] ? ` (was ${r[`${key}Was`]})` : '') : '');
const LAYOUT = {
  caregiver: {
    tab: 'CATC',
    cols: [
      ['Application number', 'id', 160], ['Applied on', 'appliedOn', 95], ['Name', 'name', 170], ['Caregiver number', numberWas('caregiverNo'), 190],
      ['Phone number', 'mobile', 110], ['Other phone', 'altMobile', 110], ['Email', 'email', 210],
      ['Full address', address, 280], ['House, street and area', 'address', 240], ['Floor', 'floor', 80], ['Colony', 'colony', 150],
      ['City', 'city', 110], ['District', 'district', 120], ['State', 'state', 110], ['PIN code', 'pin', 75],
      ['About the colony', 'notes', 220], ['Issued on', 'issuedOn', 90],
      ['Courier', EDIT[0], 140], ['Tracking number', EDIT[1], 150], ['Shipped on', EDIT[2], 100],
      ['Sheet check', 'check', 240]
    ]
  },
  membership: {
    tab: 'Membership',
    cols: [
      /* the state just before the member number, whose code it starts with
         (owner, 11 Nov 2026: "let state come before member number column");
         a number relabelled with the new state codes says what it was */
      ['Membership reference', 'id', 170], ['Applied on', 'paidOn', 95], ['Name', 'name', 170], ['State', 'state', 110], ['Member number', numberWas('memberNo'), 190],
      ['Phone number', 'mobile', 110], ['Other phone', 'altMobile', 110], ['Email', 'email', 210],
      ['Full address', address, 280], ['House, street and area', 'address', 240], ['Floor', 'floor', 80],
      ['City', 'city', 110], ['District', 'district', 120], ['PIN code', 'pin', 75],
      ['Membership type', 'type', 150], ['Welcome kit', 'kit', 180],
      ['Courier', EDIT[0], 140], ['Tracking number', EDIT[1], 150], ['Shipped on', EDIT[2], 100],
      ['Sheet check', 'check', 240]
    ]
  }
};
const KINDS = Object.keys(LAYOUT);
/* never in the sheet, whatever the register grows to carry */
const NEVER = /amount|order|bank|payment|fee/i;

function layoutOf(kind) {
  const L = LAYOUT[kind];
  const headers = L.cols.map((c) => c[0]);
  const at = (key) => L.cols.findIndex((c) => c[1] === key);
  return { tab: L.tab, cols: L.cols, headers, edit: EDIT.map(at), check: at('check'), id: 0 };
}

function letter(n) {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const q = (tab) => `'${String(tab).replace(/'/g, "''")}'`;

/* ---- dates: the sheet's day number, and what the office types ------------ */

function serialOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH_MS) / DAY_MS) : '';
}
function isoOfParts(y, m, d) {
  if (y < 100) y += 2000;
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/* '' for nothing; null for something that is not a date */
function dateOf(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(EPOCH_MS + Math.floor(v) * DAY_MS);
    return isoOfParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = clean(v, 40).toLowerCase();
  if (!s) return '';
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return isoOfParts(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoOfParts(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[,\s-]+(\d{2}|\d{4})$/.exec(s);
  if (m && MONTHS.indexOf(m[2].slice(0, 3)) !== -1) return isoOfParts(+m[3], MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]);
  m = /^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m && MONTHS.indexOf(m[1].slice(0, 3)) !== -1) return isoOfParts(+m[3], MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]);
  return null;
}

/* the three yellow cells as one comparable value */
function typedOf(cells) {
  const courier = clean(cells[0], 60);
  const tracking = clean(cells[1], 60).replace(/\s+/g, '').toUpperCase();
  const raw = cells[2];
  const date = dateOf(raw);
  return { courier, tracking, date, badDate: date === null ? clean(raw, 40) : '' };
}
function keyOf(t) { return [t.courier, t.tracking, t.badDate ? `?${t.badDate}` : (t.date || '')].join(SEP); }
function recordTyped(r) { return { courier: clean(r.courier, 60), tracking: clean(r.tracking, 60).toUpperCase(), date: r.shippedOn || '', badDate: '' }; }

/* ---- Google: signing in, and calls ----------------------------------------- */

function b64url(v) { return Buffer.from(v).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }

function accountOf() {
  try { return firebase.firebaseConfig(); } catch (_) { return null; }
}
function onGoogleCloud() {
  return Boolean(process.env.K_SERVICE || process.env.FUNCTION_TARGET || process.env.FUNCTION_NAME || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
}

class SheetError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); }
}

let cachedToken = null;
function _resetForTests() { cachedToken = null; }

async function timed(fetchFn, url, init) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS) : null;
  try { return await fetchFn(url, Object.assign({}, init, ctl ? { signal: ctl.signal } : {})); } finally { if (timer) clearTimeout(timer); }
}

/* An access token and the address the sheet is shared with. */
async function signIn(fetchFn, nowMs) {
  if (cachedToken && cachedToken.until > nowMs + 60000) return cachedToken;
  const key = accountOf();
  if (key && key.client_email && key.private_key) {
    const iat = Math.floor(nowMs / 1000);
    const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
    let sig;
    try { sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(key.private_key, 'base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); } catch (_) {
      throw new SheetError('no-access', 'The website\'s Google key could not be read.', { email: key.client_email });
    }
    let res;
    try {
      res = await timed(fetchFn, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${head}.${body}.${sig}` });
    } catch (_) { throw new SheetError('busy', 'Google could not be reached just now.', { email: key.client_email }); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new SheetError('no-access', 'Google refused the website\'s key.', { email: key.client_email });
    cachedToken = { token: j.access_token, email: key.client_email, until: nowMs + (Number(j.expires_in) || 3600) * 1000 };
    return cachedToken;
  }
  if (onGoogleCloud()) {
    const base = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default';
    const H = { headers: { 'Metadata-Flavor': 'Google' } };
    let email = '';
    let j = {};
    try {
      const e = await timed(fetchFn, `${base}/email`, H);
      email = e.ok ? clean(await e.text(), 254) : '';
      const t = await timed(fetchFn, `${base}/token?scopes=${encodeURIComponent(SCOPE)}`, H);
      j = t.ok ? await t.json().catch(() => ({})) : {};
    } catch (_) { throw new SheetError('busy', 'Google could not be reached just now.', { email }); }
    if (!j.access_token) throw new SheetError('no-access', 'The project\'s Google account gave no access.', { email });
    cachedToken = { token: j.access_token, email, until: nowMs + (Number(j.expires_in) || 3000) * 1000 };
    return cachedToken;
  }
  throw new SheetError('not-set-up', 'The website has no Google account to write with here.');
}

/* One call to the Sheets API, tried again once on a busy or failed answer. */
async function call(ctx, method, path, body) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, ctx.backoffMs * attempt));
    let res;
    try {
      res = await timed(ctx.fetch, `${API}/${ctx.sheet}${path}`, { method, headers: Object.assign({ Authorization: `Bearer ${ctx.auth.token}` }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (error) { last = new SheetError('busy', 'Google could not be reached just now.'); continue; }
    if (res.ok) return res.json().catch(() => ({}));
    const j = await res.json().catch(() => ({}));
    const msg = String((j.error && j.error.message) || '');
    if (res.status === 429 || res.status >= 500) { last = new SheetError('busy', 'Google was busy; it is tried again at the next run.'); continue; }
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(msg + JSON.stringify(j.error && j.error.details || ''))) {
      const link = (/(https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+)/.exec(msg) || [])[1] || 'https://console.cloud.google.com/apis/library/sheets.googleapis.com';
      throw new SheetError('api-off', 'The Google Sheets API is switched off for the website\'s Google project.', { link: link.replace(/[).,]+$/, '') });
    }
    if (res.status === 403 || res.status === 401) throw new SheetError('not-shared', 'The sheet is not shared with the website yet.');
    if (res.status === 404) throw new SheetError('no-sheet', 'There is no sheet at that address.');
    throw new SheetError('refused', `Google refused the change: ${clean(msg, 200) || res.status}.`);
  }
  throw last;
}

/* ---- reading what is there ----------------------------------------------- */

const META_FIELDS = 'properties(title,locale,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,description,range,unprotectedRanges,warningOnly))';

function norm(v) { return v == null ? '' : typeof v === 'number' ? String(v) : String(v); }
function lockedHash(values, L) {
  const keep = (row) => row.map((v, i) => (L.edit.includes(i) ? '' : norm(v)));
  const rows = (values || []).map((r) => keep(r || []).join(SEP).replace(new RegExp(`${SEP}+$`), ''));
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  return crypto.createHash('sha256').update(rows.join('\u0002')).digest('hex');
}

/* the tab as the office has it: is it laid out as now, and what is typed
   in yellow. The yellow cells are found by their headings, so what was
   typed survives a change of columns (5 Nov 2026: four columns dropped). */
function readTab(values, L) {
  const v = values || [];
  const header = (v[0] || []).map(norm);
  const ours = header.length === L.headers.length && header.every((h, i) => h === L.headers[i]);
  const at = EDIT.map((k, j) => header.indexOf(L.headers[L.edit[j]]));
  const typed = new Map();
  if (header[0] === L.headers[0] && at.every((c) => c >= 0)) {
    for (let i = 1; i < v.length; i += 1) {
      const row = v[i] || [];
      const id = norm(row[0]).trim();
      if (!id || typed.has(id)) continue;
      typed.set(id, typedOf(at.map((c) => row[c])));
    }
  }
  return { ours, typed, hash: lockedHash(v, L), width: Math.max(0, ...v.map((r) => (r || []).length)) };
}

/* ---- the run ------------------------------------------------------------- */

async function takeLease(db, nowMs, runId) {
  const ref = db.collection(STATE[0]).doc(STATE[1]);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() || {} : {};
    if (s.lease && Number(s.lease.until) > nowMs && s.lease.id !== runId) return null;
    /* the whole record written back with the lease on it: no merge in a
       file that reads submissions (test/submissions.test.js) */
    tx.set(ref, Object.assign({}, s, { lease: { id: runId, until: nowMs + LEASE_MS } }));
    return s;
  });
}

async function changedSince(db, marks) {
  if (!marks || !Number.isFinite(Number(marks.receivedAtMs)) || typeof marks.updatedIso !== 'string') return true;
  const ours = (d) => d.id.startsWith(PREFIX.caregiver) || d.id.startsWith(PREFIX.membership);
  const a = await db.collection('submissions').where('receivedAtMs', '>', Number(marks.receivedAtMs)).orderBy('receivedAtMs').limit(50).get();
  if (a.docs.length >= 50 || a.docs.some(ours)) return true;
  const b = await db.collection('submissions').where('updatedAt', '>', marks.updatedIso).orderBy('updatedAt').limit(50).get();
  if (b.docs.length >= 50 || b.docs.some(ours)) return true;
  const c = await db.collection('caretakerCards').where('updatedAt', '>', firebase.timestampFromMillis(Number(marks.cardsMs) || 0)).limit(1).get().catch(() => ({ docs: [] }));
  return c.docs.length > 0;
}

/* What a typed row asks for, as the register's save takes it. */
function wantedOf(t, row) {
  if (t.badDate) return { problem: `Shipped on "${t.badDate}" is not a date: type it like 05/11/2026.` };
  const any = t.courier || t.tracking || t.date;
  const all = t.courier && t.tracking && t.date;
  if (!any && !row.ship) return null;
  const status = all ? (['delivered', 'returned'].includes(row.ship) ? row.ship : 'shipped') : 'processing';
  return { body: { id: row.id, status, courier: t.courier, trackingNumber: t.tracking, shippedOn: t.date } };
}

function cellOf(r, key) {
  if (typeof key === 'function') return key(r);
  if (NEVER.test(key)) return '';
  const v = r[key];
  return v == null ? '' : String(v);
}

function valuesOf(kind, rows, held) {
  const L = layoutOf(kind);
  const out = [L.headers.slice()];
  for (const r of rows) {
    const keep = held[r.id];
    const t = keep ? keep.t : recordTyped(r);
    out.push(L.cols.map(([, key], i) => {
      if (i === L.edit[0]) return t.courier;
      if (i === L.edit[1]) return t.tracking;
      if (i === L.edit[2]) return t.badDate ? t.badDate : serialOf(t.date);
      if (i === L.check) return keep ? keep.note : '';
      return cellOf(r, key);
    }));
  }
  return out;
}

/* Shape, colours, the date rules and the lock: asked for on every full
   write, so a tab whose look was changed is put back too. */
function shapeRequests(kind, tab, rowsNeeded, email, fresh) {
  const L = layoutOf(kind);
  const id = tab.properties.sheetId;
  const grid = tab.properties.gridProperties || {};
  const width = L.cols.length;
  const reqs = [];
  if ((grid.rowCount || 0) < rowsNeeded + 20) reqs.push({ appendDimension: { sheetId: id, dimension: 'ROWS', length: rowsNeeded + 200 - (grid.rowCount || 0) } });
  if ((grid.columnCount || 0) < width) reqs.push({ appendDimension: { sheetId: id, dimension: 'COLUMNS', length: width - (grid.columnCount || 0) } });
  reqs.push({ updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
  /* the look starts clean each time, so nothing is left where a column used to be */
  const all = { sheetId: id, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: Math.max(width, grid.columnCount || 0) };
  reqs.push({ repeatCell: { range: all, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat(backgroundColor,numberFormat)' } });
  reqs.push({ setDataValidation: { range: all } });
  reqs.push({ updateCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: all.endColumnIndex }, fields: 'note' } });
  const grey = { red: 0.93, green: 0.93, blue: 0.93 };
  const yellow = { red: 1, green: 0.965, blue: 0.8 };
  const deep = { red: 1, green: 0.898, blue: 0.6 };
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
    cell: { userEnteredFormat: { backgroundColor: grey, textFormat: { bold: true }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat.bold,wrapStrategy,verticalAlignment)' } });
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
    cell: { userEnteredFormat: { verticalAlignment: 'TOP', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)' } });
  const first = L.edit[0];
  const last = L.edit[2] + 1;
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: first, endColumnIndex: last }, cell: { userEnteredFormat: { backgroundColor: deep } }, fields: 'userEnteredFormat.backgroundColor' } });
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: first, endColumnIndex: last }, cell: { userEnteredFormat: { backgroundColor: yellow } }, fields: 'userEnteredFormat.backgroundColor' } });
  /* courier and tracking number stay as typed (a number keeps its zeros);
     the date shows as 05/11/2026 */
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: L.edit[0], endColumnIndex: L.edit[1] + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } });
  reqs.push({ repeatCell: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: L.edit[2], endColumnIndex: L.edit[2] + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } });
  reqs.push({ setDataValidation: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: L.edit[0], endColumnIndex: L.edit[0] + 1 },
    rule: { condition: { type: 'ONE_OF_LIST', values: COURIERS.map((c) => ({ userEnteredValue: c })) }, strict: false, showCustomUi: true, inputMessage: 'Choose the courier, or type another.' } } });
  reqs.push({ setDataValidation: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: L.edit[2], endColumnIndex: L.edit[2] + 1 },
    rule: { condition: { type: 'DATE_IS_VALID' }, strict: true, inputMessage: 'The day it was posted, like 05/11/2026.' } } });
  const notes = ['Type the courier here. The website reads it within ten minutes.', 'Type the tracking number here.', 'The day it was posted, like 05/11/2026. With all three filled, the card shows as shipped in the panel.'];
  reqs.push({ updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: first }, rows: [{ values: notes.map((n) => ({ note: n })) }], fields: 'note' } });
  reqs.push({ updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: L.check }, rows: [{ values: [{ note: 'Written by the website: why a typed yellow cell was not taken.' }] }], fields: 'note' } });
  if (fresh) {
    L.cols.forEach(([, , px], i) => reqs.push({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }));
  }
  /* the lock: the whole tab, but the yellow cells under the headings */
  const open = [{ sheetId: id, startRowIndex: 1, startColumnIndex: first, endColumnIndex: last }];
  const mine = (tab.protectedRanges || []).filter((p) => p.description === PROTECTION);
  const want = { range: { sheetId: id }, description: PROTECTION, warningOnly: false, unprotectedRanges: open, editors: { users: email ? [email] : [] } };
  if (!mine.length) reqs.push({ addProtectedRange: { protectedRange: want } });
  else {
    const p = mine[0];
    const same = JSON.stringify((p.unprotectedRanges || []).map((u) => [u.startRowIndex, u.startColumnIndex, u.endColumnIndex, u.endRowIndex || null]))
      === JSON.stringify(open.map((u) => [u.startRowIndex, u.startColumnIndex, u.endColumnIndex, null]));
    /* who may edit is left as it is once set: Google keeps the owner on
       the list whatever is asked, and the website is on it by making it */
    if (!same || p.warningOnly || (p.range && (p.range.startRowIndex != null || p.range.startColumnIndex != null))) {
      const fix = { protectedRangeId: p.protectedRangeId, range: want.range, warningOnly: false, unprotectedRanges: open };
      reqs.push({ updateProtectedRange: { protectedRange: fix, fields: 'range,warningOnly,unprotectedRanges' } });
    }
    for (const extra of mine.slice(1)) reqs.push({ deleteProtectedRange: { protectedRangeId: extra.protectedRangeId } });
  }
  return reqs;
}

/* the owner's warning: before the yellow columns, and Sheet check after them */
function warnRequests(kind, tab) {
  const L = layoutOf(kind);
  const id = tab.properties.sheetId;
  const want = [
    { sheetId: id, startColumnIndex: 0, endColumnIndex: L.edit[0] },
    { sheetId: id, startColumnIndex: L.edit[2] + 1, endColumnIndex: L.cols.length }
  ];
  const key = (r) => [r.startColumnIndex || 0, r.endColumnIndex || 0, r.startRowIndex || 0, r.endRowIndex || null].join(',');
  const have = (tab.protectedRanges || []).filter((p) => p.description === WARNING);
  if (have.length === want.length && have.every((p) => p.warningOnly && want.some((w) => key(w) === key(p.range || {})))) return [];
  return have.map((p) => ({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } }))
    .concat(want.map((range) => ({ addProtectedRange: { protectedRange: { range, description: WARNING, warningOnly: true } } })));
}

/* The sheet reads a typed date day first (05/11/2026 is 5 November) and
   keeps India time. Google takes no "en_IN" (5 Nov 2026: "Unsupported
   locale: en_IN"); British English reads dates the same way. Asked on its
   own, so a setting Google will not take never stops the tabs being
   written. */
const LOCALE = 'en_GB';
async function ensureLocale(ctx, p) {
  if (p.locale === LOCALE && p.timeZone === 'Asia/Kolkata') return;
  try {
    await call(ctx, 'POST', ':batchUpdate', { requests: [{ updateSpreadsheetProperties: { properties: { locale: LOCALE, timeZone: 'Asia/Kolkata' }, fields: 'locale,timeZone' } }] });
  } catch (error) {
    if (!(error instanceof SheetError) || error.code !== 'refused') throw error;
    console.warn('register sheet: locale not set', error.message);
  }
}

/* The look and the lock, in one go. Should Google refuse any part of it,
   what keeps the data whole and locked (room for the rows, the frozen
   heading, the lock itself) is asked again on its own, and the colours,
   notes and date rules wait for the next run. */
const ESSENTIAL = ['appendDimension', 'updateSheetProperties', 'addProtectedRange', 'updateProtectedRange', 'deleteProtectedRange'];
async function shapeTabs(ctx, requests) {
  try {
    await call(ctx, 'POST', ':batchUpdate', { requests });
  } catch (error) {
    if (!(error instanceof SheetError) || error.code !== 'refused') throw error;
    console.warn('register sheet: look not set, the lock asked on its own', error.message);
    const must = requests.filter((r) => ESSENTIAL.some((k) => r[k]));
    if (must.length) await call(ctx, 'POST', ':batchUpdate', { requests: must });
  }
}

/* The two tabs there. An empty "Sheet1" left by a new spreadsheet goes
   once the two tabs are in. */
async function ensureTabs(ctx) {
  let meta = await call(ctx, 'GET', `?fields=${encodeURIComponent(META_FIELDS)}`);
  await ensureLocale(ctx, meta.properties || {});
  const titles = (meta.sheets || []).map((s) => s.properties.title);
  const reqs = [];
  /* the membership tab was "Members" in v1.534 (owner, 5 Nov 2026: "1 tab
     should be catc and another membership"): renamed, rows and lock kept */
  const was = (meta.sheets || []).find((x) => x.properties.title === 'Members');
  if (was && !titles.includes(LAYOUT.membership.tab) && (was.protectedRanges || []).some((r) => r.description === PROTECTION)) {
    reqs.push({ updateSheetProperties: { properties: { sheetId: was.properties.sheetId, title: LAYOUT.membership.tab }, fields: 'title' } });
    titles.push(LAYOUT.membership.tab);
  }
  const missing = KINDS.filter((k) => !titles.includes(LAYOUT[k].tab));
  for (const k of missing) reqs.push({ addSheet: { properties: { title: LAYOUT[k].tab, index: KINDS.indexOf(k), gridProperties: { rowCount: 500, columnCount: LAYOUT[k].cols.length, frozenRowCount: 1 } } } });
  if (missing.length) {
    const others = (meta.sheets || []).filter((s) => !KINDS.some((k) => LAYOUT[k].tab === s.properties.title));
    if (others.length === 1 && /^(Sheet1|Sheet 1)$/.test(others[0].properties.title)) {
      const got = await call(ctx, 'GET', `/values/${encodeURIComponent(`${q(others[0].properties.title)}!A1:Z50`)}`);
      if (!(got.values || []).some((r) => (r || []).some((c) => norm(c).trim()))) reqs.push({ deleteSheet: { sheetId: others[0].properties.sheetId } });
    }
  }
  if (reqs.length) {
    await call(ctx, 'POST', ':batchUpdate', { requests: reqs });
    meta = await call(ctx, 'GET', `?fields=${encodeURIComponent(META_FIELDS)}`);
  }
  const tabs = {};
  for (const k of KINDS) tabs[k] = (meta.sheets || []).find((s) => s.properties.title === LAYOUT[k].tab);
  return { tabs, fresh: new Set(missing) };
}

function emptyKind() { return { written: {}, held: {}, hash: '', rows: 0 }; }

/* One run. Resolves to what the panel shows; never throws. */
async function sync(db, options) {
  const o = options || {};
  const nowFn = o.now || (() => Date.now());
  const nowMs = nowFn();
  const sheet = o.sheet || sheetId();
  const ref = db.collection(STATE[0]).doc(STATE[1]);
  if (!sheet) return { ok: false, code: 'off', message: 'Writing to the Google Sheet is switched off (PFA_REGISTER_SHEET_ID=off).' };
  const runId = crypto.randomBytes(8).toString('hex');
  const before = await takeLease(db, nowMs, runId);
  if (!before) return { ok: false, code: 'running', message: 'An update is running now; the sheet is up to date within a minute.' };
  const state = before.sheet === sheet ? before : { sheet };
  const kinds = {};
  for (const k of KINDS) kinds[k] = Object.assign(emptyKind(), (state.kinds || {})[k] || {});
  const R = require('./routes/admin/registers').register;
  const out = { ok: true, wrote: false, applied: [], refused: [] };
  /* numbers given before the state codes of 11 Nov 2026 say their new code
     before the sheet is written (lib/member-numbers.js relabel; once, then a
     single read) */
  await require('./routes/admin/case').applyStateCodes(db, { nowMs }).catch((error) => console.warn('register sheet: state codes not applied yet', error && error.message));
  let email = state.email || '';
  try {
    const auth = await signIn(o.fetch || globalThis.fetch, nowMs);
    email = auth.email || email;
    const ctx = { fetch: o.fetch || globalThis.fetch, sheet, auth, backoffMs: o.backoffMs == null ? 1500 : o.backoffMs };
    const { tabs, fresh } = await ensureTabs(ctx);
    const got = await call(ctx, 'GET', `/values:batchGet?${KINDS.map((k) => `ranges=${encodeURIComponent(q(LAYOUT[k].tab))}`).join('&')}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`);
    const read = {};
    KINDS.forEach((k, i) => { read[k] = readTab(((got.valueRanges || [])[i] || {}).values, layoutOf(k)); });

    /* what the office typed since the last write */
    const typedNow = {};
    let typed = 0;
    for (const k of KINDS) {
      typedNow[k] = [];
      for (const [id, t] of read[k].typed) {
        const was = kinds[k].written[id];
        if (was === undefined || was === keyOf(t)) continue;
        typedNow[k].push({ id, t });
        typed += 1;
      }
    }
    const tampered = KINDS.some((k) => !read[k].ours || read[k].hash !== kinds[k].hash || fresh.has(k));
    const changed = o.force || typed > 0 || tampered || !state.lastFullMs || nowMs - Number(state.lastFullMs) > FULL_EVERY_MS || await changedSince(db, state.marks);
    if (!changed) {
      await ref.update({ sheet, email, lease: null, lastRunMs: nowMs, lastOkMs: nowMs, error: null });
      return Object.assign(out, await statusOf(db, { nowMs }));
    }

    /* the typed cells into the records, through the register's own save */
    const who = { uid: 'google-sheet', email: 'Google Sheet', name: 'Google Sheet' };
    const rowsOf = async (k) => (k === 'caregiver' ? R.caregiverRows(db) : R.membershipRows(db, nowMs));
    let rows = {};
    for (const k of KINDS) rows[k] = await rowsOf(k);
    let saved = 0;
    for (const k of KINDS) {
      const byId = new Map(rows[k].map((r) => [r.id, r]));
      for (const { id, t } of typedNow[k]) {
        const row = byId.get(id);
        if (!row) continue;
        const want = wantedOf(t, row);
        delete kinds[k].held[id];
        if (!want) continue;
        let problem = want.problem || '';
        if (!problem) {
          const same = keyOf(recordTyped(row)) === keyOf(t) && row.ship === want.body.status;
          if (same) continue;
          const done = await R.save(db, k, Object.assign({ via: 'Google Sheet' }, want.body), who, nowMs);
          if (done.status === 200) { saved += 1; out.applied.push({ kind: k, id, status: want.body.status }); continue; }
          problem = clean(done.body && done.body.message, 200) || 'This could not be taken.';
        }
        kinds[k].held[id] = { t, note: problem, rec: keyOf(recordTyped(row)) };
        out.refused.push({ kind: k, id, problem });
      }
    }
    const markMs = nowFn() - 5000;
    if (saved) for (const k of KINDS) rows[k] = await rowsOf(k);

    /* the tabs, written whole */
    const tabFor = (k) => tabs[k];
    const shape = [];
    for (const k of KINDS) {
      /* a held value stays only while the record has not moved and the cell still says it */
      const held = {};
      for (const r of rows[k]) {
        const h = kinds[k].held[r.id];
        if (!h) continue;
        const cell = read[k].typed.get(r.id);
        if (h.rec === keyOf(recordTyped(r)) && cell && keyOf(cell) === keyOf(h.t)) held[r.id] = h;
        else if (typedNow[k].some((x) => x.id === r.id)) held[r.id] = h;
      }
      kinds[k].held = held;
      shape.push(...shapeRequests(k, tabFor(k), rows[k].length + 1, email, fresh.has(k) || !read[k].ours));
    }
    await shapeTabs(ctx, shape);
    /* the owner's warning, on its own: Google may not take it beside the lock */
    const warn = [];
    for (const k of KINDS) warn.push(...warnRequests(k, tabs[k]));
    if (warn.length) await call(ctx, 'POST', ':batchUpdate', { requests: warn }).catch((error) => console.warn('register sheet: owner warning not set', error && error.message));
    const data = [];
    const clear = [];
    for (const k of KINDS) {
      const L = layoutOf(k);
      const values = valuesOf(k, rows[k], kinds[k].held);
      data.push({ range: `${q(L.tab)}!A1:${letter(L.cols.length - 1)}${values.length}`, values });
      clear.push(`${q(L.tab)}!A${values.length + 1}:${letter(Math.max(L.cols.length, 26, read[k].width) - 1)}`);
      /* columns that are no longer the sheet's, emptied */
      if (read[k].width > L.cols.length) clear.push(`${q(L.tab)}!${letter(L.cols.length)}1:${letter(read[k].width - 1)}`);
      const written = {};
      for (let i = 1; i < values.length; i += 1) {
        const v = values[i];
        written[v[0]] = keyOf(typedOf(L.edit.map((c) => v[c])));
      }
      kinds[k].written = written;
      kinds[k].hash = lockedHash(values, L);
      kinds[k].rows = rows[k].length;
    }
    await call(ctx, 'POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
    await call(ctx, 'POST', '/values:batchClear', { ranges: clear });
    out.wrote = true;

    const recent = (Array.isArray(state.recent) ? state.recent : []).concat(out.applied.map((x) => ({ at: nowMs, id: x.id, ok: true, status: x.status })), out.refused.map((x) => ({ at: nowMs, id: x.id, ok: false, problem: x.problem }))).slice(-20);
    await ref.set({
      sheet, email, lease: null, kinds, recent, lastRunMs: nowMs, lastOkMs: nowMs, lastFullMs: nowMs, error: null,
      marks: { receivedAtMs: markMs, updatedIso: new Date(markMs).toISOString(), cardsMs: markMs }
    });
    return Object.assign(out, await statusOf(db, { nowMs }));
  } catch (error) {
    const e = error instanceof SheetError ? error : new SheetError('error', 'The sheet could not be written just now.');
    if (!(error instanceof SheetError)) console.error('register sheet failed', String((error && error.stack) || error).slice(0, 500));
    await ref.update({ sheet, email: (error && error.email) || email, lease: null, lastRunMs: nowMs, error: { code: e.code, message: e.message, link: e.link || '', at: nowMs } }).catch(() => {});
    return Object.assign({ ok: false }, await statusOf(db, { nowMs }).catch(() => ({})), { code: e.code, message: e.message });
  }
}

/* What the panel shows above each register. */
async function statusOf(db, options) {
  const sheet = sheetId();
  const snap = await db.collection(STATE[0]).doc(STATE[1]).get();
  const s = snap.exists ? snap.data() || {} : {};
  const same = s.sheet === sheet;
  const key = accountOf();
  const kinds = same ? s.kinds || {} : {};
  return {
    on: Boolean(sheet),
    url: sheetUrl(sheet),
    email: s.email || (key && key.client_email) || '',
    lastOkMs: same ? Number(s.lastOkMs) || 0 : 0,
    lastRunMs: same ? Number(s.lastRunMs) || 0 : 0,
    error: same && s.error ? { code: clean(s.error.code, 20), message: clean(s.error.message, 300), link: clean(s.error.link, 300) } : null,
    rows: { caregiver: Number((kinds.caregiver || {}).rows) || 0, membership: Number((kinds.membership || {}).rows) || 0 },
    held: { caregiver: Object.keys((kinds.caregiver || {}).held || {}).length, membership: Object.keys((kinds.membership || {}).held || {}).length },
    recent: (same && Array.isArray(s.recent) ? s.recent : []).slice(-10)
  };
}

module.exports = { sync, statusOf, sheetId, sheetUrl, LAYOUT, PROTECTION, WARNING, _test: { warnRequests, dateOf, serialOf, typedOf, keyOf, valuesOf, lockedHash, readTab, wantedOf, shapeRequests, letter, layoutOf, resetToken: _resetForTests } };
