'use strict';

/* Foreign contribution documents, on PFA's letterhead, signed and sealed
   (owner, 26 Nov 2026, with PFA_Foreign_Contribution_Receipt__Utilization_
   Certificate_Templates.docx: "add this to admin.. it has to render
   perfectly with signature and seal. plan and build the template editable";
   Maneka Sanjay Gandhi the same day, of the ambulance Rosie's Heroes gave PFA
   Khamgaon: "Receipts following this template: one for receipt of the
   funds, one for delivery of the ambulance").

   Two documents, made in the Letter studio and kept as letters are (lib/
   letters.js, lib/routes/admin/letters.js): the same references, the same
   kept PDF, email, public check and withdrawal.
     fc-receipt  Official foreign contribution receipt and acknowledgment
     fc-uc       Grant utilization certificate and expenditure report

   The template is editable in the panel and kept in Firestore
   (letterTemplates/fcra): PFA's registration and bank details, the
   signatory, every clause, the enclosures, and the donors PFA has had. A
   document copies all of it when it is made, so one issued stays as it was
   whatever the template says later.

   Wording in a clause may carry {donor}, {project}, {received} and
   {utilized}: the donor's name, the project, the amount received and the
   amount used, filled in from the document.

   Amounts are written as the template wrote them, without separators:
   USD 2664.92, INR 255433. Long dashes in the template became hyphens (the
   site never shows one). */

const crypto = require('crypto');
const FONTS = require('./pdf-fonts');

const KINDS = {
  'fc-receipt': { label: 'Foreign contribution receipt', subject: 'Official foreign contribution receipt and acknowledgment' },
  'fc-uc': { label: 'Grant utilization certificate', subject: 'Grant utilization certificate and expenditure report' }
};
const isKind = (k) => Object.prototype.hasOwnProperty.call(KINDS, k);

/* Every heading and label the documents print, editable (owner, 26 Nov 2026:
   "all variables should be editable"): in the template, for every document
   after, and on each document under Wording. [key, the docx's own words]. */
const COMMON_LABELS = [['office', 'Registered Office'], ['fcra', 'FCRA Registration No.'], ['pan', 'PAN']];
const SIGN_LABELS = [['behalf', 'For and on behalf of PEOPLE FOR ANIMALS (PFA):'], ['signatory', 'Authorized Signatory'], ['name', 'Name'], ['designation', 'Designation']];
const LABEL_SPEC = {
  'fc-receipt': COMMON_LABELS.concat([
    ['number', 'Receipt No.'], ['date', 'Date'],
    ['s1', '1. Donor / Grantor Details'], ['donorName', 'Legal Name of Foreign Donor'], ['donorStatus', 'Legal Status & Tax ID'], ['donorAddress', 'Registered Address'],
    ['donorCountry', 'Country of Origin'], ['sanction', 'Grant Sanction Letter Reference & Date'], ['refNo', 'Ref. No.'], ['dated', 'dated'],
    ['s2', '2. Remittance & FCRA Bank Credit Details'], ['foreign', 'Foreign Currency Amount Remitted'], ['inr', 'Net INR Amount Credited'], ['rate', 'Exchange Rate'],
    ['credit', 'Date of Credit into Designated FCRA Account'], ['mode', 'Mode of Remittance & Wire / SWIFT UTR No.'], ['utr', 'UTR'],
    ['bank', 'Designated FCRA Bank Account'], ['fcraAc', 'FCRA A/c No.'], ['util', 'FCRA Utilization Bank Account'], ['utilBank', 'Bank / Branch'], ['utilAc', 'Utilization A/c No.'],
    ['s3', '3. Approved Purpose & FCRA Compliance Confirmation'], ['s4', '4. Mandatory Bank Enclosure Attached']
  ], SIGN_LABELS),
  'fc-uc': COMMON_LABELS.concat([
    ['number', 'UC Reference No.'], ['period', 'Reporting Period'], ['to', 'to'], ['date', 'Date'],
    ['s1', '1. Grant & Project Summary'], ['donor', 'Foreign Donor / Grantor'], ['sanction', 'Grant Sanction Letter Ref. & Official Receipt No.'],
    ['sanctionRef', 'Sanction Ref'], ['receiptNo', 'PFA Receipt No.'], ['project', 'Approved Initiative & Facility Location'],
    ['received', 'Total Grant Received'], ['net', 'Net'], ['credited', 'credited'], ['utilized', 'Total INR Utilized During Period'], ['balance', 'Unexpended Balance'],
    ['s2', '2. Itemized Direct Vendor, Contractor & Program Expenditure Statement'], ['colDate', 'Date'], ['colVendor', 'Vendor / Contractor Name & GSTIN'],
    ['colInvoice', 'Invoice / Bill No.'], ['colDesc', 'Description of Street Dog Goods / Works / Veterinary Services'], ['colPay', 'Payment Ref (UTR / Chq)'],
    ['colAmount', 'Amount Paid (INR ₹)'], ['total', 'TOTAL DIRECT PROJECT EXPENDITURE (INR ₹)'],
    ['s3', '3. Certification of FCRA & Grant Compliance'], ['certify', 'We hereby certify that:'], ['s4', '4. Mandatory Proof of Utilization Enclosures Attached']
  ], SIGN_LABELS)
};
const LABEL_KEYS = { 'fc-receipt': 'receipt', 'fc-uc': 'uc' };
const defaultLabels = (kind) => Object.fromEntries(LABEL_SPEC[kind].map(([k, v]) => [k, v]));
/* labels as given, each one known and kept short; a missing or emptied one is the original */
function labelsOf(kind, raw, fallback) {
  const r = raw || {};
  const f = fallback || defaultLabels(kind);
  const out = {};
  for (const [k, v] of LABEL_SPEC[kind]) {
    const x = r[k] != null ? one(r[k], 160) : '';
    out[k] = x || f[k] || v;
  }
  return out;
}
const TEMPLATE_DOC = { collection: 'letterTemplates', id: 'fcra' };

const DEFAULT_TEMPLATE = {
  org: {
    office: '14 Ashoka Road, Jantar Mantar Road, New Delhi - 110001, India',
    fcraNo: '231650850',
    pan: 'AAATP1590Q',
    bank: 'State Bank of India (SBI), New Delhi Main Branch (Branch Code: 00691), Parliament Street, New Delhi - 110001',
    fcraAccount: '40093614594',
    signName: 'Smt. Maneka Sanjay Gandhi',
    signTitle: 'Chairperson'
  },
  receipt: {
    title: 'Official Foreign Contribution Receipt & Acknowledgment',
    intro: 'People For Animals (PFA) hereby gratefully acknowledges receipt of the above foreign contribution from {donor} and confirms that:',
    clauses: [
      { lead: 'FCRA Purpose Classification', text: 'Received and recorded under the FCRA purpose "Social - Welfare of Animals" exclusively for the rescue, shelter, veterinary care, sterilization, feeding, and rehabilitation of street, abandoned, and rescued dogs in India.' },
      { lead: 'Approved Project / Initiative', text: '{project}' },
      { lead: '100% Direct Project Utilization (0% Administrative Overhead)', text: 'In accordance with the Grantor\'s Grant Sanction Letter, 100% of the net INR funds credited shall be applied directly toward third-party vendor, contractor, supplier, equipment procurement, infrastructure and veterinary program costs for the approved street dog welfare initiative, with zero percent (0%) deducted for general administrative overhead.' },
      { lead: 'No Prohibited Onward Transfer (Section 7 of FCRA, 2010)', text: 'No portion of these funds shall be transferred or sub-granted to any other NGO, trust, or entity; all disbursements shall be made directly by PFA from its FCRA account(s) to commercial vendors, contractors, and service providers against valid tax invoices.' }
    ],
    enclosure: 'Copy of State Bank of India (SBI) e-FIRC (Electronic Foreign Inward Remittance Certificate) / Inward Remittance Credit Advice confirming the USD amount, exchange rate, net INR credited, and SWIFT UTR number.'
  },
  uc: {
    title: 'Grant Utilization Certificate (UC) & Expenditure Report',
    clauses: [
      { lead: '100% Direct Utilization for Street Dog Welfare', text: 'The sum of {utilized} has been utilized exclusively for the approved dog welfare project under the FCRA category "Social - Welfare of Animals".' },
      { lead: 'Direct Vendor Disbursement (Section 7 Compliance)', text: 'All payments were disbursed directly from PFA\'s designated FCRA / FCRA Utilization Bank Account to third-party commercial vendors, contractors, or suppliers against valid bills/GST invoices, with no sub-granting or transfer to any other entity.' },
      { lead: 'Segregated Accounting & Statutory Filing', text: 'Full books of account and original vouchers are maintained in PFA\'s segregated FCRA ledger and shall be reported in PFA\'s annual Form FC-4 filing with the Ministry of Home Affairs (MHA), Government of India.' },
      { lead: 'Asset Ownership & Relocation Safeguard', text: 'Any capital equipment, vehicle/ambulance, or modular/shipping-container clinic funded under this Grant remains the legal property of PFA for street dog welfare and, in the event of a local shelter/facility closure, shall be relocated by PFA to another active shelter or hospital for the same purpose.' }
    ],
    enclosures: [
      'Copies of Paid Vendor / Contractor Tax Invoices & Receipts',
      'High-Resolution Photos / Videos of Completed Work & Dogs Benefited',
      'Brief Impact Summary (number of street dogs treated, sterilized, fed, or sheltered)'
    ],
    secondLabel: 'Chief Functionary / Treasurer / CA (if applicable)'
  },
  donors: [
    { name: 'ROSIES BROKEN TO BRAVE HEROES', aka: 'd/b/a Rosie\'s Heroes', status: 'U.S. 501(c)(3) Public Charity (EIN: 38-4382498)', address: '1295 Meadow Dr, Livermore, CA 94551, United States of America', country: 'United States of America' }
  ]
};

/* ---- cleaning what comes in ------------------------------------------- */

const DASHES = /[\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const one = (v, n) => String(v == null ? '' : v).replace(DASHES, '-').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const many = (v, n) => String(v == null ? '' : v).replace(DASHES, '-').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
function dayOf(v) {
  const m = DAY.exec(one(v, 10));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100 ? m[0] : '';
}
/* a sum as typed: 2664.92, 2,664.92, 255433; null when it is not one */
function sumOf(v) {
  const s = String(v == null ? '' : v).replace(/[,\s]/g, '').replace(/^(?:usd|inr|rs\.?|\$|₹)/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1e12 ? Math.round(n * 100) / 100 : null;
}
const CURRENCY = /^[A-Z]{3}$/;
/* written as the template writes them: no separators, paise only when there are any */
function amount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
const inr = (n) => (n == null ? '' : `INR ₹${amount(n)}`);
const foreign = (cur, n) => (n == null ? '' : `${cur || 'USD'} ${cur === 'USD' || !cur ? '$' : ''}${amount(n)}`);

/* ---- the template ------------------------------------------------------ */

const T_LIMITS = { line: 200, long: 1500, lead: 120, clauses: 8, donors: 30, enclosures: 6 };
function clausesOf(list, fallback) {
  const out = (Array.isArray(list) ? list : []).slice(0, T_LIMITS.clauses)
    .map((c) => ({ lead: one(c && c.lead, T_LIMITS.lead), text: many(c && c.text, T_LIMITS.long) }))
    .filter((c) => c.lead || c.text);
  return out.length ? out : fallback.map((c) => Object.assign({}, c));
}
function donorOf(d) {
  const x = d || {};
  return { name: one(x.name, 160), aka: one(x.aka, 120), status: one(x.status, 200), address: one(x.address, 300), country: one(x.country, 80) };
}
/* The template as kept, every part present: what is missing comes from the
   original. */
function templateOf(stored) {
  const s = stored || {};
  const D = DEFAULT_TEMPLATE;
  const so = s.org || {};
  const sr = s.receipt || {};
  const su = s.uc || {};
  const org = {};
  for (const k of Object.keys(D.org)) org[k] = so[k] != null ? one(so[k], T_LIMITS.line) : D.org[k];
  const enclosures = (Array.isArray(su.enclosures) ? su.enclosures : D.uc.enclosures).map((e) => one(e, 300)).filter(Boolean).slice(0, T_LIMITS.enclosures);
  const donors = (Array.isArray(s.donors) ? s.donors : D.donors).map(donorOf).filter((d) => d.name).slice(0, T_LIMITS.donors);
  return {
    org,
    receipt: {
      title: sr.title != null ? one(sr.title, 120) || D.receipt.title : D.receipt.title,
      intro: sr.intro != null ? many(sr.intro, T_LIMITS.long) : D.receipt.intro,
      clauses: clausesOf(sr.clauses, D.receipt.clauses),
      enclosure: sr.enclosure != null ? many(sr.enclosure, 600) : D.receipt.enclosure
    },
    uc: {
      title: su.title != null ? one(su.title, 120) || D.uc.title : D.uc.title,
      clauses: clausesOf(su.clauses, D.uc.clauses),
      enclosures: enclosures.length ? enclosures : D.uc.enclosures.slice(),
      secondLabel: su.secondLabel != null ? one(su.secondLabel, 120) : D.uc.secondLabel
    },
    donors,
    labels: { receipt: labelsOf('fc-receipt', (s.labels || {}).receipt), uc: labelsOf('fc-uc', (s.labels || {}).uc) },
    updatedAt: s.updatedAt || '',
    updatedBy: s.updatedBy || ''
  };
}
async function readTemplate(db) {
  try {
    const snap = await db.collection(TEMPLATE_DOC.collection).doc(TEMPLATE_DOC.id).get();
    return templateOf(snap.exists ? snap.data() : null);
  } catch (_) { return templateOf(null); }
}
async function saveTemplate(db, raw, who, nowMs) {
  const t = templateOf(raw);
  delete t.updatedAt; delete t.updatedBy;
  t.updatedAt = new Date(nowMs).toISOString();
  t.updatedBy = who || '';
  await db.collection(TEMPLATE_DOC.collection).doc(TEMPLATE_DOC.id).set(t);
  return t;
}
/* A donor used on a document joins the template's list, so the next
   document for them is one choice. */
async function rememberDonor(db, doc, who, nowMs) {
  const d = donorOf({ name: doc.donorName, aka: doc.donorAka, status: doc.donorStatus, address: doc.donorAddress, country: doc.donorCountry });
  if (!d.name) return;
  const t = await readTemplate(db);
  const key = (x) => x.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const at = t.donors.findIndex((x) => key(x) === key(d));
  if (at >= 0) {
    const was = t.donors[at];
    const merged = { name: d.name, aka: d.aka || was.aka, status: d.status || was.status, address: d.address || was.address, country: d.country || was.country };
    if (JSON.stringify(merged) === JSON.stringify(was)) return;
    t.donors[at] = merged;
  } else t.donors.unshift(d);
  await saveTemplate(db, t, who, nowMs);
}

/* ---- the document's own fields ----------------------------------------- */

const ROWS_MAX = 40;
function docOf(kind, raw, template) {
  const r = raw || {};
  const T = template || templateOf(null);
  const o = T.org;
  const base = {
    office: r.office != null ? one(r.office, 200) : o.office,
    fcraNo: r.fcraNo != null ? one(r.fcraNo, 40) : o.fcraNo,
    pan: r.pan != null ? one(r.pan, 20).toUpperCase() : o.pan,
    donorName: one(r.donorName, 160),
    donorAka: one(r.donorAka, 120),
    donorStatus: one(r.donorStatus, 200),
    donorAddress: one(r.donorAddress, 300),
    donorCountry: one(r.donorCountry, 80),
    sanctionRef: one(r.sanctionRef, 80),
    sanctionDate: dayOf(r.sanctionDate),
    currency: CURRENCY.test(one(r.currency, 3).toUpperCase()) ? one(r.currency, 3).toUpperCase() : 'USD',
    foreignAmount: sumOf(r.foreignAmount),
    inrAmount: sumOf(r.inrAmount),
    creditDate: dayOf(r.creditDate),
    project: one(r.project, 300),
    location: one(r.location, 200),
    /* the number printed, when PFA's own receipt or UC book is used; empty: PFA's reference */
    printedNo: one(r.printedNo, 40),
    labels: labelsOf(kind, r.labels, (T.labels || {})[LABEL_KEYS[kind]])
  };
  const typedRate = sumOf(r.rate);
  base.rate = typedRate || (base.foreignAmount && base.inrAmount ? Math.round((base.inrAmount / base.foreignAmount) * 100) / 100 : null);
  if (kind === 'fc-receipt') {
    return Object.assign(base, {
      title: r.title != null ? one(r.title, 120) || T.receipt.title : T.receipt.title,
      mode: r.mode != null ? one(r.mode, 120) : 'SWIFT Wire Transfer',
      utr: one(r.utr, 80),
      bank: r.bank != null ? one(r.bank, 240) : o.bank,
      fcraAccount: r.fcraAccount != null ? one(r.fcraAccount, 40) : o.fcraAccount,
      utilBank: one(r.utilBank, 240),
      utilAccount: one(r.utilAccount, 40),
      intro: r.intro != null ? many(r.intro, T_LIMITS.long) : T.receipt.intro,
      clauses: Array.isArray(r.clauses) ? clausesOf(r.clauses, T.receipt.clauses) : T.receipt.clauses.map((c) => Object.assign({}, c)),
      enclosure: r.enclosure != null ? many(r.enclosure, 600) : T.receipt.enclosure,
      enclosed: r.enclosed !== false,
      signName: r.signName != null ? one(r.signName, 120) : o.signName,
      signTitle: r.signTitle != null ? one(r.signTitle, 120) : o.signTitle
    });
  }
  const rows = (Array.isArray(r.rows) ? r.rows : []).slice(0, ROWS_MAX).map((x) => ({
    date: dayOf(x && x.date), vendor: one(x && x.vendor, 200), invoice: one(x && x.invoice, 60),
    desc: one(x && x.desc, 400), payRef: one(x && x.payRef, 80), amount: sumOf(x && x.amount)
  })).filter((x) => x.vendor || x.desc || x.amount || x.invoice || x.payRef);
  const utilized = Math.round(rows.reduce((s, x) => s + (x.amount || 0), 0) * 100) / 100;
  const encl = Array.isArray(r.enclosures) ? r.enclosures : T.uc.enclosures.map((text) => ({ text, checked: true }));
  return Object.assign(base, {
    title: r.title != null ? one(r.title, 120) || T.uc.title : T.uc.title,
    periodFrom: dayOf(r.periodFrom),
    periodTo: dayOf(r.periodTo),
    receiptNo: one(r.receiptNo, 40).toUpperCase(),
    rows,
    utilized: utilized || null,
    balance: base.inrAmount != null ? Math.round((base.inrAmount - utilized) * 100) / 100 : null,
    clauses: Array.isArray(r.clauses) ? clausesOf(r.clauses, T.uc.clauses) : T.uc.clauses.map((c) => Object.assign({}, c)),
    enclosures: encl.slice(0, T_LIMITS.enclosures).map((e) => (typeof e === 'string' ? { text: one(e, 300), checked: true } : { text: one(e && e.text, 300), checked: e && e.checked !== false })).filter((e) => e.text),
    signName: r.signName != null ? one(r.signName, 120) : o.signName,
    signTitle: r.signTitle != null ? one(r.signTitle, 120) : o.signTitle,
    secondOn: r.secondOn !== false,
    secondName: one(r.secondName, 120),
    secondTitle: r.secondTitle != null ? one(r.secondTitle, 120) : T.uc.secondLabel
  });
}

/* What must be there before it is issued: the field and what to say. */
function missingOf(kind, d) {
  const need = [
    ['donorName', 'the donor\'s legal name'],
    ['foreignAmount', 'the amount remitted'],
    ['inrAmount', 'the net INR amount credited'],
    ['project', 'the approved project']
  ];
  if (kind === 'fc-receipt') need.push(['creditDate', 'the date it was credited']);
  else need.push(['periodFrom', 'the start of the reporting period'], ['periodTo', 'the end of the reporting period']);
  for (const [k, what] of need) if (d[k] == null || d[k] === '') return { field: k, message: `Add ${what}.` };
  if (kind === 'fc-uc') {
    if (!d.rows.length) return { field: 'rows', message: 'Add at least one payment to the expenditure statement.' };
    const bad = d.rows.findIndex((x) => !x.amount);
    if (bad >= 0) return { field: 'rows', message: `Row ${bad + 1} of the expenditure statement has no amount.` };
    if (d.periodFrom > d.periodTo) return { field: 'periodTo', message: 'The reporting period ends before it starts.' };
    if (d.utilized > d.inrAmount + 0.005) return { field: 'rows', message: `The payments add up to ${inr(d.utilized)}, more than the ${inr(d.inrAmount)} received.` };
  }
  return null;
}

/* {donor}, {project}, {received} and {utilized}, filled in */
function fill(str, d, kind) {
  const project = [d.project, d.location].filter(Boolean).join(', at ');
  return String(str || '')
    .split('{donor}').join(d.donorName || '________')
    .split('{project}').join(project || '________')
    .split('{received}').join(d.inrAmount != null ? inr(d.inrAmount) : '________')
    .split('{utilized}').join(kind === 'fc-uc' && d.utilized != null ? inr(d.utilized) : '________');
}

/* ---- the PDF ------------------------------------------------------------ */

const SIZE = { body: 9.6, small: 8.2, label: 9.2, head: 10.8, title: 14, table: 8, tableHead: 7.4 };
const LINE = 1.42;
const LABEL_W = 60;   /* mm: the label column of a detail row */
/* where the letterhead, the signature and the seal start on these documents:
   a smaller letterhead than a letter's, so a receipt keeps to one page */
const LAYOUT = { headSize: 56, sigSize: 52, sealSize: 36 };

function pdfOf(letter, opts, shared) {
  const o = opts || {};
  const S = shared;
  const PDFDocument = require('pdfkit');
  const F = FONTS.loadFonts();
  const L = S.layoutOf(letter.layout);
  const MM = S.MM;
  const kind = letter.kind;
  const d = letter.doc || docOf(kind, {}, null);
  const number = o.number || '';
  const B = d.labels || defaultLabels(kind);
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    info: { Title: d.title, Author: 'People For Animals', Subject: number ? `${KINDS[kind].label} ${number}` : `${KINDS[kind].label}, not yet issued`, Creator: 'peopleforanimalsindia.org' }
  });
  for (const key of Object.keys(F)) doc.registerFont(key, F[key].bytes);
  const raw = S.artOf();
  const A = { letterhead: doc.openImage(raw.letterhead), signature: doc.openImage(Buffer.isBuffer(o.signature) ? o.signature : raw.signature), seal: doc.openImage(raw.seal) };
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const INK = S.COLOUR.ink;
  const META = S.COLOUR.meta;
  const HAIR = '#cfd8dc';
  const left = S.PAD.side * MM;
  const width = S.TEXT_W * MM;
  const bottom = (S.PAGE.h - 14) * MM;
  const asc = (key) => F[key].font.ascent / F[key].font.unitsPerEm;
  const desc = (key) => -F[key].font.descent / F[key].font.unitsPerEm;
  const lines = (str, size, w, bold) => S.linesOf(doc, S.runsOfText(str, bold), size, w);
  const lineW = (pieces) => pieces.reduce((s, p) => s + p.w, 0);
  let y = 0;
  let page = 0;
  let onNewPage = null;   /* a table repeats its head */

  function drawPieces(pieces, size, x, top, lh) {
    const content = (asc('arial') + desc('arial')) * size;
    const base = top + (lh - content) / 2 + asc('arial') * size;
    let at = x;
    for (const p of pieces) {
      doc.font(p.key).fontSize(size).text(p.text, at, base, { lineBreak: false, baseline: 'alphabetic' });
      at += p.w;
    }
  }
  function startPage() {
    if (page > 0) doc.addPage({ size: 'A4', margin: 0 });
    page += 1;
    /* a page after the first carries its reference and title, not the
       letterhead again: the document runs on, as a printed one does */
    if (page > 1) {
      y = S.PAD.top * MM;
      doc.fillColor(META);
      const cont = `${d.printedNo || number || 'Not yet issued'} · ${d.title} · continued`;
      for (const ln of lines(cont, SIZE.small, width)) { drawPieces(ln, SIZE.small, left, y, SIZE.small * 1.35); y += SIZE.small * 1.35; }
      y += 1.5 * MM;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(HAIR).stroke();
      y += 4 * MM;
      doc.fillColor(INK);
      if (onNewPage) onNewPage();
      return;
    }
    const headW = S.TEXT_W * (L.headSize / 100);
    const headH = headW / S.ART_RATIO.letterhead;
    const hx = S.PAD.side + (S.TEXT_W - headW) / 2 + L.headX;
    const hy = S.PAD.top + L.headY;
    doc.image(A.letterhead, hx * MM, hy * MM, { width: headW * MM, height: headH * MM });
    y = Math.max(S.PAD.top, hy + headH) * MM + 3 * MM;
    /* the registration line under the letterhead, on every page */
    const reg = [d.office ? `${B.office}: ${d.office}` : '', d.fcraNo ? `${B.fcra}: ${d.fcraNo}` : '', d.pan ? `${B.pan}: ${d.pan}` : ''].filter(Boolean).join('   |   ');
    if (reg) {
      doc.fillColor(META);
      for (const ln of lines(reg, SIZE.small, width)) {
        const lh = SIZE.small * 1.35;
        drawPieces(ln, SIZE.small, left + (width - lineW(ln)) / 2, y, lh);
        y += lh;
      }
      y += 1.5 * MM;
    }
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(INK).stroke();
    y += 4 * MM;
    doc.fillColor(INK);
  }
  const room = (h) => { if (y + h > bottom) startPage(); };
  function para(str, opt) {
    const p = opt || {};
    const size = p.size || SIZE.body;
    const x = left + (p.indent || 0) * MM;
    const w = width - (p.indent || 0) * MM;
    doc.fillColor(p.color || INK);
    const lh = size * LINE;
    const ls = lines(str, size, w, p.bold);
    for (const ln of ls) {
      room(lh);
      const dx = p.align === 'center' ? (w - lineW(ln)) / 2 : p.align === 'right' ? w - lineW(ln) : 0;
      drawPieces(ln, size, x + dx, y, lh);
      y += lh;
    }
    y += (p.after == null ? 2 : p.after) * MM;
  }
  function heading(str) {
    room(SIZE.head * 2 + 18 * MM);
    y += 2.5 * MM;
    para(`**${str}**`, { size: SIZE.head, after: 1.2 });
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.4).strokeColor(HAIR).stroke();
    y += 1.2 * MM;
  }
  /* a label and its value, side by side; the value wraps under itself */
  function detail(label, value, opt) {
    const p = opt || {};
    if (!p.always && (value == null || value === '')) return;
    const shown = value == null || value === '' ? '________________' : String(value);
    const lw = LABEL_W * MM;
    const vw = width - lw - 3 * MM;
    const size = SIZE.label;
    const lh = size * LINE;
    const ll = lines(label, size, lw - 2 * MM);
    const vl = lines(p.bold ? `**${shown}**` : shown, size, vw);
    const h = Math.max(ll.length, vl.length) * lh + 2.4 * MM;
    room(h);
    const top = y + 1.2 * MM;
    doc.fillColor(META);
    ll.forEach((ln, i) => drawPieces(ln, size, left, top + i * lh, lh));
    doc.fillColor(INK);
    vl.forEach((ln, i) => drawPieces(ln, size, left + lw + 3 * MM, top + i * lh, lh));
    y += h;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.3).strokeColor('#e3e8ea').stroke();
  }
  /* a point with its bold words first */
  function point(lead, text) {
    const size = SIZE.body;
    const lh = size * LINE;
    const str = lead ? `**${lead}:** ${text}` : text;
    const ls = lines(str, size, width - 5 * MM);
    room(Math.min(ls.length, 3) * lh);
    doc.fillColor(INK);
    doc.circle(left + 1.4 * MM, y + lh / 2, 0.55 * MM).fill(INK);
    ls.forEach((ln) => { room(lh); drawPieces(ln, size, left + 5 * MM, y, lh); y += lh; });
    y += 1.6 * MM;
  }
  function box(checked, text) {
    const size = SIZE.body;
    const lh = size * LINE;
    const ls = lines(text, size, width - 7 * MM);
    room(ls.length * lh);
    const s = 3.4 * MM;
    const bx = left;
    const by = y + (lh - s) / 2;
    doc.rect(bx, by, s, s).lineWidth(0.7).strokeColor(INK).stroke();
    if (checked) {
      doc.moveTo(bx + s * 0.2, by + s * 0.52).lineTo(bx + s * 0.42, by + s * 0.76).lineTo(bx + s * 0.82, by + s * 0.22).lineWidth(1).strokeColor(INK).stroke();
    }
    doc.fillColor(INK);
    ls.forEach((ln) => { room(lh); drawPieces(ln, size, left + 7 * MM, y, lh); y += lh; });
    y += 1.6 * MM;
  }
  /* the expenditure statement */
  function table(rows, total) {
    const cols = [
      { k: 'date', label: B.colDate, w: 17 },
      { k: 'vendor', label: B.colVendor, w: 35 },
      { k: 'invoice', label: B.colInvoice, w: 24 },
      { k: 'desc', label: B.colDesc, w: 45 },
      { k: 'payRef', label: B.colPay, w: 29 },
      { k: 'amount', label: B.colAmount, w: 22, right: true }
    ];
    const pad = 1.4 * MM;
    const cellLines = (str, w, size, bold) => lines(bold ? `**${str}**` : str, size, w * MM - 2 * pad);
    function rowDraw(cells, size, fill, bold) {
      const lh = size * 1.3;
      const ls = cols.map((c, i) => cellLines(cells[i], c.w, size, bold));
      const h = Math.max(...ls.map((x) => x.length || 1)) * lh + 2 * pad;
      room(h);
      let x = left;
      if (fill) doc.rect(left, y, width, h).fill(fill);
      doc.fillColor(INK);
      cols.forEach((c, i) => {
        ls[i].forEach((ln, j) => drawPieces(ln, size, c.right ? x + c.w * MM - pad - lineW(ln) : x + pad, y + pad + j * lh, lh));
        x += c.w * MM;
      });
      /* the grid */
      doc.lineWidth(0.4).strokeColor('#9fb0b8');
      doc.rect(left, y, width, h).stroke();
      let gx = left;
      cols.slice(0, -1).forEach((c) => { gx += c.w * MM; doc.moveTo(gx, y).lineTo(gx, y + h).stroke(); });
      y += h;
    }
    const head = () => rowDraw(cols.map((c) => c.label), SIZE.tableHead, '#e9eef0', true);
    room(30 * MM);
    head();
    onNewPage = head;
    for (const r of rows) {
      rowDraw([r.date ? S.dateWords(r.date).replace(/^(\d+) (\w{3})\w* (\d{4})$/, '$1 $2 $3') : '', r.vendor, r.invoice, r.desc, r.payRef, r.amount != null ? amount(r.amount) : ''], SIZE.table, null, false);
    }
    onNewPage = null;
    /* the total, across the first five columns */
    const size = SIZE.table;
    const lh = size * 1.3;
    const totalW = cols.slice(0, 5).reduce((s, c) => s + c.w, 0) * MM;
    const label = B.total;
    const ll = lines(`**${label}**`, size, totalW - 2 * pad);
    const h = ll.length * lh + 2 * pad;
    room(h);
    doc.rect(left, y, width, h).fill('#f4f6f7');
    doc.fillColor(INK);
    ll.forEach((ln, j) => drawPieces(ln, size, left + totalW - pad - lineW(ln), y + pad + j * lh, lh));
    const tv = lines(`**₹${amount(total || 0)}**`, size, cols[5].w * MM - 2 * pad)[0];
    drawPieces(tv, size, left + width - pad - lineW(tv), y + pad, lh);
    doc.lineWidth(0.4).strokeColor('#9fb0b8').rect(left, y, width, h).stroke();
    doc.moveTo(left + totalW, y).lineTo(left + totalW, y + h).stroke();
    y += h + 3 * MM;
  }
  /* the signatures and the seal, kept together on one page */
  function signatures(second) {
    const sigW = L.sigSize;
    const sigH = sigW / S.ART_RATIO.signature;
    const sealW = L.sealSize;
    const sealH = sealW / S.ART_RATIO.seal;
    const rowH = Math.max(letter.signed !== false ? sigH : 12, letter.sealed !== false ? sealH * 0.62 : 0, 14);
    const under = SIZE.label * LINE * 3 + 4 * MM;
    room(SIZE.body * LINE + 4 * MM + rowH * MM + under);
    y += 3 * MM;
    para(`**${B.behalf}**`, { after: 1 });
    const rowTop = y;
    const mid = rowTop + (rowH * MM) / 2;
    const colW = second ? width * 0.36 : width * 0.5;
    if (letter.signed !== false) {
      const sw = Math.min(sigW * MM, colW);
      const sh = sw / S.ART_RATIO.signature;
      doc.image(A.signature, left + L.sigX * MM, mid - sh / 2 + L.sigY * MM, { width: sw, height: sh });
    }
    if (letter.sealed !== false) {
      doc.image(A.seal, left + width - sealW * MM + L.sealX * MM, mid - (sealH * MM) / 2 + L.sealY * MM, { width: sealW * MM, height: sealH * MM });
    }
    y = rowTop + rowH * MM + 1 * MM;
    const lineY = y;
    doc.lineWidth(0.6).strokeColor(INK);
    doc.moveTo(left, lineY).lineTo(left + colW - 6 * MM, lineY).stroke();
    const secondX = left + colW + 4 * MM;
    if (second) doc.moveTo(secondX, lineY).lineTo(secondX + colW - 6 * MM, lineY).stroke();
    y += 1.6 * MM;
    const size = SIZE.label;
    const lh = size * LINE;
    const col = (x, w, strs) => {
      let yy = y;
      doc.fillColor(INK);
      for (const s of strs.filter(Boolean)) for (const ln of lines(s, size, w)) { drawPieces(ln, size, x, yy, lh); yy += lh; }
      return yy;
    };
    const a = col(left, colW - 6 * MM, [`**${B.signatory}**`, `${B.name}: ${d.signName || '________________'}`, `${B.designation}: ${d.signTitle || '________________'}`]);
    const b = second ? col(secondX, colW - 6 * MM, [`**${d.secondTitle || 'Chief Functionary / Treasurer / CA'}**`, `${B.name}: ${d.secondName || '________________'}`]) : y;
    y = Math.max(a, b) + 2 * MM;
  }

  startPage();
  /* the title, then the reference and the date */
  para(`**${d.title.toUpperCase()}**`, { size: SIZE.title, align: 'center', after: 3 });
  /* PFA's own receipt or UC number when one is given; PFA's reference otherwise */
  const ref = d.printedNo || number || 'Given when issued';
  const dateText = S.dateWords(letter.date);
  if (kind === 'fc-receipt') {
    const l1 = lines(`**${B.number}:** ${ref}`, SIZE.body, width / 2)[0];
    const l2 = lines(`**${B.date}:** ${dateText}`, SIZE.body, width / 2)[0];
    room(SIZE.body * LINE);
    doc.fillColor(INK);
    drawPieces(l1, SIZE.body, left, y, SIZE.body * LINE);
    drawPieces(l2, SIZE.body, left + width - lineW(l2), y, SIZE.body * LINE);
    y += SIZE.body * LINE + 2 * MM;

    heading(B.s1);
    detail(B.donorName, [d.donorName, d.donorAka ? `(${d.donorAka})` : ''].filter(Boolean).join(' '), { always: true, bold: true });
    detail(B.donorStatus, d.donorStatus);
    detail(B.donorAddress, d.donorAddress);
    detail(B.donorCountry, d.donorCountry);
    if (d.sanctionRef || d.sanctionDate) detail(B.sanction, [d.sanctionRef ? `${B.refNo} ${d.sanctionRef}` : '', d.sanctionDate ? `${B.dated} ${S.dateWords(d.sanctionDate)}` : ''].filter(Boolean).join(' '));

    heading(B.s2);
    detail(B.foreign, foreign(d.currency, d.foreignAmount), { always: true, bold: true });
    detail(B.inr, d.inrAmount != null ? `${inr(d.inrAmount)}${d.rate ? ` (${B.rate}: ₹${amount(d.rate)} / ${d.currency})` : ''}` : '', { always: true, bold: true });
    detail(B.credit, d.creditDate ? S.dateWords(d.creditDate) : '', { always: true });
    detail(B.mode, [d.mode, d.utr ? `${B.utr}: ${d.utr}` : ''].filter(Boolean).join(' | '));
    detail(B.bank, [d.bank, d.fcraAccount ? `${B.fcraAc}: ${d.fcraAccount}` : ''].filter(Boolean).join(' | '));
    if (d.utilBank || d.utilAccount) detail(B.util, [d.utilBank ? `${B.utilBank}: ${d.utilBank}` : '', d.utilAccount ? `${B.utilAc}: ${d.utilAccount}` : ''].filter(Boolean).join(' | '));

    heading(B.s3);
    if (d.intro) para(fill(d.intro, d, kind), { after: 2 });
    for (const c of d.clauses) point(c.lead, fill(c.text, d, kind));

    heading(B.s4);
    box(d.enclosed, d.enclosure);
    signatures(false);
  } else {
    const period = `${d.periodFrom ? S.dateWords(d.periodFrom) : '________'} ${B.to} ${d.periodTo ? S.dateWords(d.periodTo) : '________'}`;
    for (const s of [`**${B.number}:** ${ref}`, `**${B.period}:** ${period}`, `**${B.date}:** ${dateText}`]) para(s, { after: 0.6 });
    y += 1.5 * MM;

    heading(B.s1);
    detail(B.donor, [d.donorName, d.donorStatus ? `(${d.donorStatus})` : ''].filter(Boolean).join(' '), { always: true, bold: true });
    if (d.sanctionRef || d.receiptNo) detail(B.sanction, [d.sanctionRef ? `${B.sanctionRef}: ${d.sanctionRef}` : '', d.receiptNo ? `${B.receiptNo}: ${d.receiptNo}` : ''].filter(Boolean).join(' | '));
    detail(B.project, [d.project, d.location].filter(Boolean).join(', at '), { always: true });
    detail(B.received, [d.foreignAmount != null ? foreign(d.currency, d.foreignAmount) : '', d.inrAmount != null ? `${B.net} ${inr(d.inrAmount)}${d.creditDate ? ` (${B.credited} ${S.dateWords(d.creditDate)})` : ''}` : ''].filter(Boolean).join(' | '), { always: true, bold: true });
    detail(B.utilized, d.utilized != null ? `${inr(d.utilized)}${d.balance != null ? ` | ${B.balance}: ${inr(Math.max(0, d.balance))}` : ''}` : '', { always: true, bold: true });

    heading(B.s2);
    table(d.rows.length ? d.rows : [{}, {}, {}].map(() => ({ date: '', vendor: '', invoice: '', desc: '', payRef: '', amount: null })), d.utilized || 0);

    heading(B.s3);
    para(B.certify, { after: 1.5 });
    for (const c of d.clauses) point(c.lead, fill(c.text, d, kind));

    heading(B.s4);
    for (const e of d.enclosures) box(e.checked, e.text);
    signatures(d.secondOn !== false);
  }

  /* page numbers, once every page is known */
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.fillColor(META);
    if (range.count > 1) {
      const ln = lines(`Page ${i + 1} of ${range.count}`, SIZE.small, width)[0];
      drawPieces(ln, SIZE.small, left + width - lineW(ln), (S.PAGE.h - 10) * MM, SIZE.small * 1.3);
    }
    /* a number of PFA's own printed above: the reference the public check knows, at the foot */
    if (d.printedNo && number && i === 0) {
      const ln = lines(`PFA reference ${number}`, SIZE.small, width / 2)[0];
      drawPieces(ln, SIZE.small, left, (S.PAGE.h - 10) * MM, SIZE.small * 1.3);
    }
  }
  doc.end();
  return done.then((bytes) => ({ bytes, pages: range.count }));
}

/* The panel's letter, checked: kind, date, the document, the places. */
function check(body, nowMs, issuing, template, shared) {
  const b = body || {};
  const S = shared;
  const kind = isKind(b.kind) ? b.kind : '';
  if (!kind) return { ok: false, field: 'kind', message: 'Choose which document it is.' };
  const date = b.date ? S.dayOf(b.date) : S.todayIst(nowMs);
  if (!date) return { ok: false, field: 'date', message: 'Choose the date it carries.' };
  const d = docOf(kind, b.doc, template);
  if (issuing) {
    const miss = missingOf(kind, d);
    if (miss) return { ok: false, field: miss.field, message: miss.message };
  }
  const email = S.emailOf(b.email);
  if (b.email && String(b.email).trim() && !email) return { ok: false, field: 'email', message: 'That email does not look right.' };
  const v = {
    kind, date, doc: d,
    subject: KINDS[kind].subject,
    recipient: [d.donorName, d.donorAddress].filter(Boolean).join('\n'),
    salutation: '', body: '', closing: '',
    signed: b.signed !== false, sealed: b.sealed !== false,
    layout: S.layoutOf(Object.assign({}, LAYOUT, b.layout || {})),
    name: d.donorName || ''
  };
  if (email) v.email = email;
  if (kind === 'fc-receipt' && d.inrAmount != null) v.amount = inr(d.inrAmount);
  if (kind === 'fc-uc' && d.utilized != null) v.amount = inr(d.utilized);
  return { ok: true, values: v };
}

/* An issued receipt, as a UC starts from it. */
function receiptSummary(number, l) {
  const d = l.doc || {};
  return {
    number, date: l.date || '', donorName: d.donorName || '', donorStatus: d.donorStatus || '', sanctionRef: d.sanctionRef || '',
    currency: d.currency || 'USD', foreignAmount: d.foreignAmount, inrAmount: d.inrAmount, creditDate: d.creditDate || '',
    project: d.project || '', location: d.location || '', withdrawn: Boolean(l.withdrawn)
  };
}

const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);

module.exports = { LAYOUT, LABEL_SPEC, defaultLabels, labelsOf, KINDS, isKind, DEFAULT_TEMPLATE, TEMPLATE_DOC, templateOf, readTemplate, saveTemplate, rememberDonor, docOf, missingOf, fill, check, pdfOf, receiptSummary, amount, inr, foreign, sumOf, sha };
