#!/usr/bin/env node
'use strict';

/* Does every submission reach the admin panel, and does every one send the
   person an acknowledgement email?

     npm run check:emails

   Asked on 16 Sep 2026. This runs offline: no Firestore, no email provider,
   no payment gateway. Each public form, and each application that is only
   filed once its fee clears, is driven through the real server route with a
   stand-in database and a stand-in mail provider that records what it is
   asked to send. The record is then read back by its reference, the way the
   admin panel's Submissions search finds it.

   So a passing row means the code files the record and sends the letter.
   Whether production can actually send is a separate question with a
   one-word answer: PFA_MAIL_API_KEY set in Vercel or not, which
   /api/payment/health reports as "mail" and DEPLOY.command prints after a
   deploy. Without it every form still files, and the page tells the person
   the email did not go.

   Exits 1 if any row fails. */

const { EventEmitter } = require('events');
const S = require('../lib/submissions');
const mail = require('../lib/caregiver-mail');
const FORWARD = require('../lib/submission-forward');
const firebase = require('../lib/firebase');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;

const EMAIL = 'check@example.com';
const TEMPLATES = { 'PFA-MEM': 'membership_welcome', 'PFA-CG': 'caregiver_application_received' };
const WORKING_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const MERCHANT = '123456';
const NOW = Date.UTC(2026, 8, 16, 5, 0);

/* Just enough Firestore for a record, its counter, a queue row and a transaction. */
function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const data = store.get(key(c, id)); return { exists: Boolean(data), id, data: () => data }; },
    async create(data) {
      if (store.has(key(c, id))) { const e = new Error('Document already exists'); e.code = 6; throw e; }
      store.set(key(c, id), Object.assign({}, data));
    },
    async set(data, opts) {
      const prev = (opts && opts.merge && store.get(key(c, id))) || {};
      store.set(key(c, id), Object.assign({}, prev, data));
    },
    async update(data) {
      if (!store.has(key(c, id))) throw new Error('No document to update');
      store.set(key(c, id), Object.assign({}, store.get(key(c, id)), data));
    }
  });
  return {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        create: (ref, data) => ref.create(data),
        update: (ref, data) => ref.update(data)
      };
      return fn(tx);
    }
  };
}

const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: EMAIL };

/* Every public form, as its page sends it. The same list as
   test/every-form-reaches-admin.test.js, less the caregiver card, which is
   paid and so checked below with membership. */
const FORMS = [
  ['report.html', 'Report cruelty', 'PFA-CR', { what: 'A dog tied without water', animal: 'Dog', urgency: 'Happening now', location: 'Bus stand, Udupi' }],
  ['ask.html', 'Ask a question', 'PFA-Q', { question: 'Can I adopt a dog I feed?', topic: 'Adoption', state: 'Karnataka', city: 'Udupi' }],
  ['careers.html', 'Apply for a job', 'PFA-J', { city: 'Udupi', background: 'Ten years in rescue', zone: 'South', pfaMember: 'No', travel: 'Yes' }],
  ['wall.html', 'Send a film to The Wall', 'PFA-S', { url: 'https://youtu.be/abc123', wall: 'Short form, under a minute' }],
  ['get-involved.html', 'Volunteer', 'PFA-V', { city: 'Udupi', title: 'Volunteer: Rescue Operations' }],
  ['events.html', 'Ask for an event', 'PFA-EV', { title: 'An adoption drive', city: 'Udupi' }],
  ['cinekind.html', 'Nominate for CineKind', 'PFA-CK', { nominee: 'A rescue documentary', category: 'A film or documentary', why: 'It changed how a town treats its dogs' }],
  ['campus.html', 'Register a campus society', 'PFA-CAM', { college: 'Government College, Udupi', city: 'Udupi, Karnataka', desks: 'Rescue and first aid', faculty: 'Yes' }],
  ['sgacc.html', 'Offer help to the Animal Care Centre', 'PFA-SG', { offer: 'Supplies for the animals', items: 'Blankets and bedding' }],
  ['csr.html', 'Propose a CSR partnership', 'PFA-CSR', { focus: 'Rural animal hospitals', company: 'Udupi Foods Limited' }],
  ['legacy.html', 'Ask about a legacy', 'PFA-LEG', { interest: 'I am only exploring', contactBy: 'Email' }],
  ['campaign.html', 'Plan a campaign', 'PFA-CMP', { cause: 'Community dogs', format: 'A birthday or celebration', title: 'A birthday for the dogs', city: 'Udupi' }],
  ['privacy.html', 'Ask for my data', 'PFA-PRV', { request: 'A copy of what PFA holds about me' }],
  ['units.html', 'Apply for a new PFA unit', 'PFA-U', Object.assign({
    unitPlace: 'Kundapur', unitDistrict: 'Udupi', address: '12 Main Road, Koteshwara', city: 'Kundapur', district: 'Udupi',
    criteria: 'B. Rescue work', rescue1: 'Animal: Dog · Nature of the problem: Hit by a bus · Date: 3 Jan 2026 · Action taken: Treated and released',
    salutation: 'Ms.', relation: 'Daughter of Ramesh Rao', workingAs: 'Teacher',
    undertaking: 'I agree to this undertaking.', signature: 'Asha Rao', signedOn: '22 October 2026'
  }, Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`member${n}`, `Member ${n}, age 40, ${n === 1 ? 'Advocate' : 'Teacher'} · Address: ${n} Main Road, Udupi · Phone: 9876543210`])))]
];

function request(body, headers = {}) {
  const r = new EventEmitter();
  r.method = 'POST'; r.query = {}; r.headers = Object.assign({ host: 'peopleforanimalsindia.org' }, headers);
  process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}
function responder() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.raw = String(b || ''); } };
}
const subjectOf = (msg) => { try { return mail.render(msg.template, msg.payload).subject; } catch (e) { return `(${msg.template})`; } };

async function freeForm([page, doing, kind, fields], { withEmail = true, configured = true } = {}) {
  const db = fakeDb();
  const sent = [];
  const handler = createHandler({
    getDb: () => db, now: () => NOW,
    deliver: async (msg) => { sent.push(msg); return { providerId: `p${sent.length}` }; },
    isConfigured: () => configured,
    queue: { async queueEmail() { return { emailId: 'e1', created: true }; }, async recordEmailResult() { return {}; } }
  });
  const data = Object.assign({}, PERSON, fields);
  if (!withEmail) delete data.email;
  const res = responder();
  await handler(request({ kind, page, data }), res);
  let body = {};
  try { body = JSON.parse(res.raw); } catch (e) { body = { raw: res.raw.slice(0, 200) }; }
  const ref = body.reference;
  const record = ref ? await db.collection('submissions').doc(ref).get() : null;
  return { page, doing, kind, status: res.statusCode, body, ref, filed: Boolean(record && record.exists && record.data().kind === kind), sent };
}

async function paid(label, body, kind, template) {
  const db = fakeDb();
  const sent = [];
  firebase._setDbForTests(db);
  mail.deliver = async (msg) => { sent.push(msg); return { providerId: `p${sent.length}` }; };
  mail.isConfigured = () => true;
  Object.assign(process.env, { CCAVENUE_MERCHANT_ID: MERCHANT, CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: WORKING_KEY, CCAVENUE_MODE: 'test', PUBLIC_SITE_URL: 'https://peopleforanimalsindia.org' });
  const create = require('../lib/routes/payment/create');
  const respond = require('../lib/routes/payment/response');
  const out = { page: 'get-involved.html', doing: label, kind, sent, filed: false, error: '' };
  const rec = { statusCode: 200, setHeader() {}, end(raw) { this.html = String(raw || ''); } };
  await create({ method: 'POST', url: '/api/payment/create', headers: { host: 'pfa.test' }, body }, rec);
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(rec.html || '');
  if (!enc) { out.error = `payment/create answered ${rec.statusCode}: ${String(rec.html || '').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`; return out; }
  const order = decodeMerchantData(decrypt(enc[1], WORKING_KEY));
  const bank = Object.assign({}, order, {
    order_id: order.order_id, merchant_id: MERCHANT, amount: order.amount, currency: 'INR',
    order_status: 'Success', tracking_id: '310000000001', bank_ref_no: 'BANK0001', payment_mode: 'Net Banking', status_message: 'Transaction Successful'
  });
  const back = { statusCode: 200, setHeader() {}, end(raw) { this.html = String(raw || ''); } };
  await respond({ method: 'POST', url: '/api/payment/response', headers: { host: 'pfa.test' }, body: { encResp: encrypt(encodeMerchantData(bank), WORKING_KEY) } }, back);
  for (const [k, v] of db.store) if (k.startsWith('submissions/') && k.split('/').length === 2 && v.kind === kind) { out.filed = true; out.ref = v.reference || k.split('/')[1]; }
  out.template = template;
  if (!out.filed && !sent.length) out.error = `payment/response answered ${back.statusCode}: ${String(back.html || '').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`;
  return out;
}

/* Which email is which. The acknowledgement goes to the person; the forward
   (lib/submission-forward.js) goes to PFA's inbox with Reply-To set to the
   person. They are sent side by side, so neither is "the first" one. */
function classify(r) {
  const me = String(EMAIL).toLowerCase();
  r.ack = r.sent.find((m) => String(m.to).toLowerCase() === me) || null;
  /* each record by its own route: a record of money to the payments
     inboxes, a form to the forms inbox; every one of them gets a copy, and
     no copy goes anywhere else */
  const route = FORWARD.inboxes({ kind: r.kind });
  const fwds = r.sent.filter((m) => m.template === 'submission_forward');
  r.forwardTo = fwds.map((m) => m.to).join(', ');
  /* a volunteer application or a membership is kept in the panel only:
     right when nothing at all was forwarded */
  r.panelOnly = route.length === 0 && FORWARD.panelOnly({ kind: r.kind });
  r.forwarded = r.panelOnly ? fwds.length === 0 : route.length > 0
    && route.every((to) => fwds.some((m) => String(m.to).toLowerCase() === to && m.payload && m.payload.replyTo === me))
    && fwds.every((m) => route.includes(String(m.to).toLowerCase()));
  return r;
}

async function run() {
  const saved = { warn: console.warn, info: console.info, deliver: mail.deliver, isConfigured: mail.isConfigured, env: Object.assign({}, process.env) };
  const rows = [];
  S.resetForTests();
  console.warn = () => {}; console.info = () => {};
  try {
    for (const form of FORMS) {
      /* one connection sending three of every form would meet the intake's
         own flood brake by the fifth form; each form is its own visitor */
      S.resetForTests();
      const r = classify(await freeForm(form));
      const plain = await freeForm(form, { withEmail: false });
      const off = await freeForm(form, { configured: false });
      r.free = true;
      r.noEmailRefused = plain.status >= 400 && !plain.filed;
      r.noEmailField = (plain.body.fields && plain.body.fields[0] && plain.body.fields[0].field) || '';
      r.unconfiguredState = off.body.confirmation && off.body.confirmation.state;
      r.unconfiguredFiled = off.filed;
      r.state = (r.body.confirmation || {}).state;
      r.ok = r.filed && Boolean(r.ack) && r.state === 'sent' && r.forwarded;
      rows.push(r);
    }
    rows.push(await paid('Become a member (paid)', { type: 'membership', tier: 'golden', amount: '2500', name: PERSON.name, mobile: PERSON.mobile, email: EMAIL, address: '16 MG Road', city: 'Udupi', state: 'Karnataka', district: 'Udupi', pincode: '576101', terms: 'yes' }, 'PFA-MEM', TEMPLATES['PFA-MEM']));
    rows.push(await paid('Colony caregiver card (paid)', { type: 'caregiver-application', name: PERSON.name, mobile: PERSON.mobile, email: EMAIL, address: 'Car Street colony, near the temple', city: 'Udupi', animals: '12', district: 'Udupi', state: 'Karnataka', pincode: '576101', documents: 'a'.repeat(48), terms: 'yes' }, 'PFA-CG', TEMPLATES['PFA-CG']));
    for (const r of rows.filter((x) => !x.free)) { classify(r); r.ok = r.filed && Boolean(r.ack) && r.ack.template === r.template && r.forwarded; }
  } finally {
    console.warn = saved.warn; console.info = saved.info;
    mail.deliver = saved.deliver; mail.isConfigured = saved.isConfigured;
    firebase._setDbForTests(null);
    for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
    Object.assign(process.env, saved.env);
    S.resetForTests();
  }
  return rows;
}

function print(rows, brief) {
  if (!brief) console.log('\nEvery submission, through the real server code (offline, nothing is sent)\n');
  for (const r of rows) {
    const ack = r.ack;
    const email = ack ? `email "${subjectOf(ack)}"` : 'NO EMAIL';
    if (brief) {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.doing.padEnd(30)} ${r.filed ? `admin: ${r.ref}` : 'admin: NOT FILED'}, ${email}`);
      continue;
    }
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.doing.padEnd(30)} ${r.kind.padEnd(8)} ${r.page}`);
    console.log(`      admin panel: ${r.filed ? `filed in Submissions as ${r.ref}` : 'NOT FILED'}`);
    console.log(`      email:       ${ack ? `sent to ${ack.to}, "${subjectOf(ack)}"` : 'NONE SENT'}`);
    console.log(`      forwarded:   ${r.panelOnly ? (r.forwarded ? 'not emailed, kept in the admin panel only (as it should be)' : `EMAILED to ${r.forwardTo}, but it should stay in the panel only`) : r.forwarded ? `to ${r.forwardTo}, Reply-To ${EMAIL}` : 'NOT FORWARDED to the inbox with Reply-To set'}`);
    if (r.free) {
      console.log(`      no email given: ${r.noEmailRefused ? `refused (${r.noEmailField}), nothing filed` : 'FILED WITHOUT AN EMAIL'}`);
      console.log(`      mail switched off: still filed (${r.unconfiguredFiled ? 'yes' : 'NO'}), email ${r.unconfiguredState}, and the page tells the person`);
    }
    if (r.error) console.log(`      ${r.error}`);
  }
  const failed = rows.filter((r) => !r.ok).length;
  console.log(`${brief ? '  ' : '\n'}${rows.length - failed} of ${rows.length} pass. Whether production can send them: "mail" at /api/payment/health.${brief ? '' : '\n'}`);
  return failed;
}

module.exports = { run, print, EMAIL, FORMS };

if (require.main === module) {
  run().then((rows) => { process.exitCode = print(rows, process.argv.includes('--brief')) ? 1 : 0; })
    .catch((error) => { console.error('check-emails failed:', error); process.exitCode = 1; });
}
