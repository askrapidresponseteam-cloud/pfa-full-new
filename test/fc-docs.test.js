'use strict';

/* Foreign contribution documents in the Letter studio (owner, 26 Nov 2026,
   with PFA_Foreign_Contribution_Receipt__Utilization_Certificate_Templates.docx:
   "add this to admin.. it has to render perfectly with signature and seal.
   plan and build the template editable"). lib/fc-docs.js, lib/letters.js,
   lib/routes/admin/letters.js, assets/admin-fcdocs.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { memoryFirestore } = require('./_memory-firestore.js');
const FC = require('../lib/fc-docs');
const L = require('../lib/letters');
const ROUTE = require('../lib/routes/admin/letters');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-26T06:00:00.000Z');

/* every string the PDF draws, and every picture */
const PDFDocument = require('pdfkit');
let drawn = null;
const realText = PDFDocument.prototype.text;
PDFDocument.prototype.text = function (str, ...rest) { if (drawn) drawn.push(String(str)); return realText.call(this, str, ...rest); };
const realImage = PDFDocument.prototype.image;
let images = null;
PDFDocument.prototype.image = function (src, ...rest) { if (images) images.push(rest[2] && rest[2].width); return realImage.call(this, src, ...rest); };

const T = FC.templateOf(null);
const ROSE = T.donors[0];
const RECEIPT = {
  donorName: ROSE.name, donorAka: ROSE.aka, donorStatus: ROSE.status, donorAddress: ROSE.address, donorCountry: ROSE.country,
  currency: 'USD', foreignAmount: '2664.92', inrAmount: '2,55,433', creditDate: '2026-10-09', utr: 'SWIFT',
  project: 'Animal ambulance for PFA Khamgaon', location: 'Khamgaon, Maharashtra'
};
const ROWS = [
  { date: '2026-10-20', vendor: 'Shree Ganesh Motors (GSTIN 27ABCDE1234F1Z5)', invoice: 'SGM/1187', desc: 'Ambulance body and cage', payRef: 'UTR SBIN1', amount: '231500' },
  { date: '2026-10-28', vendor: 'Vet Care Supplies', invoice: 'VCS-4410', desc: 'First aid and oxygen', payRef: 'UTR SBIN2', amount: '18900' }
];

test('the template is the docx, word for word, with plain hyphens for its long dashes', () => {
  const D = FC.DEFAULT_TEMPLATE;
  assert.equal(D.org.fcraNo, '231650850');
  assert.equal(D.org.pan, 'AAATP1590Q');
  assert.equal(D.org.fcraAccount, '40093614594');
  assert.match(D.org.bank, /State Bank of India \(SBI\), New Delhi Main Branch \(Branch Code: 00691\)/);
  assert.equal(D.receipt.clauses.length, 4);
  assert.match(D.receipt.clauses[0].text, /"Social - Welfare of Animals"/);
  assert.match(D.receipt.clauses[3].lead, /Section 7 of FCRA, 2010/);
  assert.equal(D.uc.clauses.length, 4);
  assert.equal(D.uc.enclosures.length, 3);
  assert.deepEqual(D.donors[0], { name: 'ROSIES BROKEN TO BRAVE HEROES', aka: 'd/b/a Rosie\'s Heroes', status: 'U.S. 501(c)(3) Public Charity (EIN: 38-4382498)', address: '1295 Meadow Dr, Livermore, CA 94551, United States of America', country: 'United States of America' });
  assert.ok(!/[–—]/.test(JSON.stringify(D)), 'no long dash anywhere in it');
  /* a stored template fills in only what it changed */
  const t = FC.templateOf({ org: { signTitle: 'Chairperson, PFA — India' }, receipt: { clauses: [] } });
  assert.equal(t.org.signTitle, 'Chairperson, PFA - India');
  assert.equal(t.org.pan, 'AAATP1590Q');
  assert.equal(t.receipt.clauses.length, 4, 'an emptied list comes back as the original');
});

test('a receipt: the sums read as typed, the rate worked out, and nothing issued without the essentials', () => {
  const ok = FC.check({ kind: 'fc-receipt', date: '2026-11-26', doc: RECEIPT }, NOW, true, T, L._shared);
  assert.equal(ok.ok, true);
  const d = ok.values.doc;
  assert.equal(d.foreignAmount, 2664.92);
  assert.equal(d.inrAmount, 255433);
  assert.equal(d.rate, 95.85);
  assert.equal(FC.inr(d.inrAmount), 'INR ₹255433');
  assert.equal(FC.foreign('USD', d.foreignAmount), 'USD $2664.92');
  assert.equal(ok.values.name, ROSE.name);
  assert.equal(ok.values.amount, 'INR ₹255433');
  assert.equal(ok.values.layout.headSize, FC.LAYOUT.headSize, 'a smaller letterhead than a letter, so it keeps to fewer pages');
  for (const [k, word] of [['foreignAmount', 'remitted'], ['inrAmount', 'INR'], ['creditDate', 'credited'], ['project', 'project'], ['donorName', 'donor']]) {
    const bad = FC.check({ kind: 'fc-receipt', doc: Object.assign({}, RECEIPT, { [k]: '' }) }, NOW, true, T, L._shared);
    assert.equal(bad.ok, false, k);
    assert.equal(bad.field, k);
    assert.match(bad.message, new RegExp(word, 'i'));
  }
  /* a preview shows what is there, blanks and all */
  assert.equal(FC.check({ kind: 'fc-receipt', doc: {} }, NOW, false, T, L._shared).ok, true);
  assert.equal(FC.check({ kind: 'nope', doc: {} }, NOW, false, T, L._shared).ok, false);
  /* a letter kind cannot be made through here, nor a document through the letters' check */
  assert.equal(L.check({ kind: 'fc-receipt', body: 'x' }, NOW, false).ok, false);
});

test('a utilization certificate: the payments add up, the balance is what is left, and it cannot claim more than came in', () => {
  const base = Object.assign({}, RECEIPT, { periodFrom: '2026-10-09', periodTo: '2026-11-25', receiptNo: 'pfa-let-k7m2q9xa' });
  const ok = FC.check({ kind: 'fc-uc', doc: Object.assign({}, base, { rows: ROWS.concat([{ vendor: '', desc: '', amount: '' }]) }) }, NOW, true, T, L._shared);
  assert.equal(ok.ok, true);
  const d = ok.values.doc;
  assert.equal(d.rows.length, 2, 'an empty row is dropped');
  assert.equal(d.utilized, 250400);
  assert.equal(d.balance, 5033);
  assert.equal(d.receiptNo, 'PFA-LET-K7M2Q9XA');
  assert.equal(FC.fill('The sum of {utilized} for {project}, from {donor}', d, 'fc-uc'), `The sum of INR ₹250400 for Animal ambulance for PFA Khamgaon, at Khamgaon, Maharashtra, from ${ROSE.name}`);
  const over = FC.check({ kind: 'fc-uc', doc: Object.assign({}, base, { rows: [{ vendor: 'X', amount: '300000' }] }) }, NOW, true, T, L._shared);
  assert.equal(over.ok, false); assert.match(over.message, /more than the INR ₹255433 received/);
  assert.equal(FC.check({ kind: 'fc-uc', doc: Object.assign({}, base, { rows: [] }) }, NOW, true, T, L._shared).field, 'rows');
  assert.equal(FC.check({ kind: 'fc-uc', doc: Object.assign({}, base, { rows: [{ vendor: 'X', amount: '' }] }) }, NOW, true, T, L._shared).message, 'Row 1 of the expenditure statement has no amount.');
  assert.equal(FC.check({ kind: 'fc-uc', doc: Object.assign({}, base, { rows: ROWS, periodTo: '2026-10-01' }) }, NOW, true, T, L._shared).field, 'periodTo');
});

test('the PDFs: letterhead, every section, the payments and their total, the signature and the seal', async () => {
  drawn = []; images = [];
  const r = FC.check({ kind: 'fc-receipt', date: '2026-11-26', doc: RECEIPT }, NOW, true, T, L._shared).values;
  const made = await L.pdfOf(r, { number: 'PFA-LET-K7M2Q9XA' });
  const text = drawn.join('');
  assert.ok(made.bytes.subarray(0, 5).toString() === '%PDF-');
  assert.ok(made.pages >= 1 && made.pages <= 3, `${made.pages} pages`);
  for (const want of ['OFFICIAL', 'FOREIGN', 'PFA-LET-K7M2Q9XA', 'November', '1. Donor / Grantor Details', '2. Remittance & FCRA Bank Credit Details', '3. Approved Purpose & FCRA Compliance Confirmation', '4. Mandatory Bank Enclosure Attached',
    'ROSIES', '$2664.92', '₹255433', '₹95.85', '231650850', 'AAATP1590Q', '40093614594', 'Authorized Signatory', 'Maneka Sanjay Gandhi', 'Chairperson']) {
    assert.ok(text.includes(want), `the receipt shows ${want}`);
  }
  assert.equal(images.length, 3, 'the letterhead, the signature and the seal');
  drawn = []; images = [];
  const u = FC.check({ kind: 'fc-uc', date: '2026-11-26', doc: Object.assign({}, RECEIPT, { periodFrom: '2026-10-09', periodTo: '2026-11-25', rows: ROWS }) }, NOW, true, T, L._shared).values;
  await L.pdfOf(u, { number: 'PFA-LET-Q4W8E2RT' });
  const ut = drawn.join('');
  for (const want of ['GRANT', 'UTILIZATION', 'Shree', 'SGM/1187', '231500', '18900', 'TOTAL', '₹250400', 'Unexpended', '₹5033', 'Chief', 'Treasurer']) assert.ok(ut.includes(want), `the certificate shows ${want}`);
  assert.equal(images.length, 3);
  /* unsigned and unsealed: the name typed where the signature was, no seal */
  drawn = []; images = [];
  await L.pdfOf(Object.assign({}, r, { signed: false, sealed: false }), {});
  assert.equal(images.length, 1, 'only the letterhead');
  assert.ok(drawn.join('').includes('Given when issued'), 'a preview says it has no reference yet');
  drawn = null; images = null;
});

test('the route: the template is read and saved (and logged), a receipt is issued as a letter, its donor kept, a certificate starts from it', async () => {
  const db = memoryFirestore();
  const files = new Map();
  const logged = [];
  const audit = require('../lib/admin-audit');
  const realRecord = audit.record;
  audit.record = async (who, e) => { logged.push(e); };
  let n = 0;
  const handler = ROUTE.createHandler({
    getDb: () => db, requireAdmin: async () => ({ uid: 'u', email: 'o@pfa.test' }), now: () => NOW,
    makeNumber: () => `PFA-LET-FCDXC${String.fromCharCode(65 + (++n))}AB`,
    fileStore: { put: async (p, bytes) => { files.set(p, Buffer.from(bytes)); return { storage: 'test', path: p }; }, read: async (doc) => files.get(doc.path) || null },
    signatureVault: { pictureFor: async () => null }
  });
  const call = (method, body, query) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(raw) { let j = null; try { j = JSON.parse(String(raw)); } catch (_) { /* pdf */ } resolve({ status: this.statusCode, json: j }); } };
    handler({ method, body, query: query || {}, headers: {} }, res);
  });
  try {
    let r = await call('GET');
    assert.equal(r.json.fc.template.org.fcraNo, '231650850');
    assert.deepEqual(r.json.fc.receipts, []);
    const t = r.json.fc.template;
    t.org.signTitle = 'Chairperson, People for Animals';
    t.receipt.clauses.push({ lead: 'Thanks', text: 'With thanks to {donor}.' });
    r = await call('POST', { action: 'fc-template', template: t });
    assert.equal(r.status, 200);
    assert.equal(r.json.template.org.signTitle, 'Chairperson, People for Animals');
    assert.equal(r.json.template.updatedBy, 'o@pfa.test');
    assert.equal(logged.pop().action, 'fc-template-saved');
    /* a new donor, issued for */
    const doc = Object.assign({}, RECEIPT, { donorName: 'Friends of Dogs Trust', donorAka: '', donorStatus: 'UK registered charity 123', donorAddress: '1 High St, London', donorCountry: 'United Kingdom', currency: 'GBP' });
    const bad = await call('POST', { action: 'issue', letter: { kind: 'fc-receipt', doc: Object.assign({}, doc, { project: '' }) } });
    assert.equal(bad.status, 422); assert.equal(bad.json.field, 'project');
    r = await call('POST', { action: 'issue', letter: { kind: 'fc-receipt', date: '2026-11-26', doc, email: 'gifts@fod.example' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const number = r.json.letter.number;
    assert.equal(r.json.letter.kindLabel, 'Foreign contribution receipt');
    assert.equal(r.json.letter.name, 'Friends of Dogs Trust');
    const kept = (await db.collection('letters').doc(number).get()).data();
    assert.equal(kept.doc.signTitle, 'Chairperson, People for Animals', 'the template as it was when made');
    assert.equal(kept.doc.clauses.length, 5);
    assert.equal(kept.doc.inrAmount, 255433);
    assert.ok(files.has(`letters/${number}.pdf`), 'the PDF kept as issued');
    assert.equal(logged.pop().action, 'letter-issued');
    r = await call('GET');
    assert.equal(r.json.fc.template.donors[0].name, 'Friends of Dogs Trust', 'the donor is kept for next time');
    assert.equal(r.json.fc.template.donors.length, 2, JSON.stringify(r.json.fc.template.donors));
    assert.deepEqual(r.json.fc.receipts.map((x) => [x.number, x.donorName, x.inrAmount, x.currency]), [[number, 'Friends of Dogs Trust', 255433, 'GBP']]);
    /* the template changed later: the receipt issued earlier is drawn as it was */
    await call('POST', { action: 'fc-template', template: Object.assign({}, t, { org: Object.assign({}, t.org, { signTitle: 'Someone else' }) }) });
    drawn = [];
    const pdf = await call('GET', null, { number, format: 'pdf' });
    assert.equal(pdf.status, 200);
    /* reset keeps the donors */
    const donorsBefore = (await call('GET')).json.fc.template.donors.map((x) => x.name);
    r = await call('POST', { action: 'fc-template-reset' });
    assert.equal(r.json.template.org.signTitle, 'Chairperson');
    assert.deepEqual(r.json.template.donors.map((x) => x.name), donorsBefore, 'the donors are kept');
    drawn = null;
    /* the public check names it */
    const verify = require('../lib/routes/verify-certificate');
    const out = await new Promise((resolve) => {
      const res = { statusCode: 200, setHeader() {}, end(raw) { resolve({ status: this.statusCode, json: JSON.parse(String(raw)) }); } };
      (verify.createHandler ? verify.createHandler({ getDb: () => db }) : verify)({ method: 'GET', query: { n: number }, headers: {} }, res);
    });
    assert.match(JSON.stringify(out.json), /Foreign contribution receipt/);
  } finally { audit.record = realRecord; }
});

test('the email for each says what it is, and greets an organisation plainly', () => {
  const m = require('../lib/caregiver-mail');
  const r = m.render('pfa_letter', { name: 'ROSIES BROKEN TO BRAVE HEROES', number: 'PFA-LET-K7M2Q9XA', kind: 'fc-receipt', dateWords: '26 November 2026' });
  assert.match(r.subject, /^Your foreign contribution receipt from People for Animals - PFA-LET-K7M2Q9XA$/);
  assert.match(r.text, /^Hello,\nThank you\. People for Animals has received your contribution/);
  const u = m.render('pfa_letter', { name: 'X', number: 'PFA-LET-Q4W8E2RT', kind: 'fc-uc' });
  assert.match(u.subject, /^Grant utilization certificate from People for Animals/);
  assert.ok(!/ROSIES,/.test(r.text));
});

test('wiring: the studio\'s three choices, the editor in its own file and in the panel bundle, the template closed to browsers', () => {
  const studio = read('assets/admin-letters.js');
  assert.match(studio, /\['fc-receipt', 'Foreign contribution receipt'\], \['fc-uc', 'Utilization certificate'\]/);
  assert.match(studio, /sc\.src = 'assets\/admin-fcdocs\.js'/);
  assert.match(studio, /window\.PFALetters = \{ pane: render, draw: draw \}/);
  const ed = read('assets/admin-fcdocs.js');
  assert.match(ed, /window\.PFAFcDocs = \{ show: show \}/);
  assert.match(ed, /data-fc="tpl-save"/);
  assert.match(ed, /data-fc="row-add"/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-fcdocs\.js'/);
  assert.match(read('firestore.rules'), /match \/letterTemplates\/\{id\}\s+\{ allow read, write: if false; \}/);
  for (const f of ['lib/fc-docs.js', 'assets/admin-fcdocs.js']) assert.ok(!/[–—−]/.test(read(f)), `${f} carries a long dash`);
});
