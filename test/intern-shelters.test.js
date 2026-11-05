'use strict';

/* Where interns do their shelter work, the directory it builds, and the
   internship in the panel (owner, 3 Nov 2026, after Mrs Gandhi's note "Just
   remove one sentence : shelter work only at shelters PFA knows ...": "before
   one starts, the applicant needs to enter where they plan to work. the
   address in full with phone number, 2-3 photos of the place. this needs to
   come to admin and it has to start building a directory. and there needs
   to be a proper panel for the admin to see who worked where"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const mail = require('../lib/caregiver-mail');
const fileStore = require('../lib/file-store');
const audit = require('../lib/admin-audit');
const SH = require('../lib/intern-shelters');
const PORTAL = require('../lib/routes/intern/portal');
const ADMIN = require('../lib/routes/admin/internship');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const at = (iso) => Date.parse(iso);
let NOW;
let db; let sent; let realRecord;
const ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_MAIL_API_KEY', 'PFA_PUBLIC_SITE_URL'];
const saved = {};
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  fileStore._setBucket(async () => null);
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
  process.env.PFA_SMTP_PASS = 'secret';
  sent = [];
  mail._setSmtpTransport(() => ({ sendMail: async (m) => { sent.push(m); return { messageId: m.messageId }; } }));
  realRecord = audit.record;
  audit.record = async () => {};
  NOW = at('2026-11-09T05:00:00.000Z');
});
test.afterEach(() => {
  firebase._setDbForTests(null);
  fileStore._setBucket(null);
  mail._setSmtpTransport(null);
  audit.record = realRecord;
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function respond(handler, request) {
  return new Promise((resolve, reject) => {
    const out = { status: 200, headers: {} };
    const response = {
      set statusCode(v) { out.status = v; }, get statusCode() { return out.status; },
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, getHeader(k) { return out.headers[k.toLowerCase()]; },
      end(raw) { out.raw = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || ''); try { out.json = JSON.parse(out.raw || '{}'); } catch (_) { out.json = null; } resolve(out); }
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}
function admin(method, { body, query } = {}) {
  const h = ADMIN.createHandler({ getDb: () => db, requireAdmin: async () => ({ uid: 'u1', email: 'priya@pfa.test', role: 'super' }), now: () => NOW });
  return respond(h, { method, url: '/api/admin/internship', query: query || {}, body, headers: {} });
}
function browser() {
  let cookie = '';
  const go = async (op, method, body) => {
    const h = PORTAL.createHandler(op, { getDb: () => db, now: () => NOW });
    const headers = { 'x-real-ip': '203.0.113.9' };
    if (cookie) headers.cookie = `pfa_intern=${cookie}`;
    if (method !== 'GET') headers['x-pfa-intern'] = '1';
    const r = await respond(h, { method, url: `/api/intern/${op}`, query: {}, body, headers, socket: { remoteAddress: '203.0.113.9' } });
    const set = r.headers['set-cookie'];
    if (set) { const m = /pfa_intern=([^;]*)/.exec(set); cookie = m ? m[1] : ''; }
    return r;
  };
  return { go };
}

let batchId = '';
async function intern(name, mobile) {
  if (!batchId) {
    const b = await admin('POST', { body: { action: 'batch-save', name: 'November 2026', startDate: '2026-11-09' } });
    batchId = b.json.batch.batchId;
  }
  const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
  const issued = await admin('POST', { body: { action: 'issue', batchId, name, email, mobile: mobile || '9876543210', dob: '2004-05-14' } });
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  /* approved: signed in with the three (5 Nov 2026) */
  const br = browser();
  assert.equal((await br.go('session', 'POST', { email, mobile: mobile || '9876543210', dob: '2004-05-14' })).status, 200);
  return { br, internId: issued.json.internId };
}
test.beforeEach(() => { batchId = ''; });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 7)]);
async function photos(br, n) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const r = await br.go('file', 'POST', { taskKey: 'shelter', name: `place-${i + 1}.png`, type: 'image/png', data: PNG.toString('base64') });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    ids.push(r.json.file.id);
  }
  return ids;
}
const PLACE = {
  name: 'Karuna Animal Shelter', contact: 'Ravi Shetty', phone: '98450 12345', house: 'Survey 12, near the water tank', street: 'Kunjibettu, Manipal Road',
  landmark: 'Opposite the temple', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576102', animals: 'Dogs, cats', agreed: true
};

test('Mrs Gandhi’s sentence is gone; any shelter, named first in the portal', () => {
  const html = read('internship.html');
  assert.doesNotMatch(html, /Shelter work only at shelters PFA knows/);
  assert.doesNotMatch(html, /PFA units directory<\\\/a>; if there is none within reach, PFA finds you one/);
  assert.doesNotMatch(html, /Find one PFA knows/);
  assert.match(html, /Any shelter near you: new ones start all the time, and every one of them needs help/);
  assert.match(html, /tell PFA where, in your portal: the shelter’s full address, a phone number and two or three photographs/);
  const t = require('../lib/internship').DEFAULT_TASKS.find((x) => x.key === 'shelter');
  assert.match(t.need, /any shelter near you/);
  assert.match(t.need, /First tell PFA where, in this portal/);
});

test('no shelter proof until the place is named; the place is checked field by field', async () => {
  const { br } = await intern('Asha Rao');
  const early = await br.go('work', 'POST', { taskKey: 'shelter', links: ['https://drive.google.com/x'], hours: 20 });
  assert.equal(early.status, 409);
  assert.match(early.json.message, /First tell PFA where you will do your shelter work/);
  const ids = await photos(br, 3);
  const bad = async (patch, field, re) => {
    const r = await br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: ids }, patch));
    assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.field, field);
    if (re) assert.match(r.json.message, re);
  };
  await bad({ name: '' }, 'name');
  await bad({ phone: '12345' }, 'phone', /not one we can read/);
  await bad({ pin: '400001' }, 'pin', /is in Maharashtra, not Karnataka/);
  await bad({ district: 'Pune' }, 'district', /Choose a district in Karnataka/);
  await bad({ agreed: false }, 'agreed');
  await bad({ mapLink: 'javascript:alert(1)' }, 'mapLink');
  assert.equal((await br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: ids.slice(0, 1) }))).json.field, 'photos', 'two at least');
  /* a PDF is not a photograph; another intern's file is not theirs */
  const pdf = await br.go('file', 'POST', { taskKey: 'shelter', name: 'x.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4 hello').toString('base64') });
  assert.match((await br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: [ids[0], pdf.json.file.id] }))).json.message, /must be pictures/);
  const other = await intern('Ravi Kumar', '9123456780');
  const theirs = await photos(other.br, 1);
  assert.match((await br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: [ids[0], theirs[0]] }))).json.message, /not one you sent/);

  const ok = await br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: ids }));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.place.shelter.name, 'Karuna Animal Shelter');
  assert.equal(ok.json.place.shelter.status, 'checking');
  assert.deepEqual(ok.json.place.shelter.lines, ['Survey 12, near the water tank', 'Kunjibettu, Manipal Road', 'Opposite the temple', 'Udupi', 'Karnataka 576102']);
  /* then the proof, with the hours */
  assert.equal((await br.go('work', 'POST', { taskKey: 'shelter', links: ['https://drive.google.com/sheet'] })).json.code, 'NO_HOURS');
  const sentProof = await br.go('work', 'POST', { taskKey: 'shelter', links: ['https://drive.google.com/sheet'], hours: 21.5 });
  assert.equal(sentProof.status, 200, JSON.stringify(sentProof.json));
  const w = db.dump()[`intern_work/${sentProof.json.intern.internId}__shelter`];
  assert.equal(w.hours, 21.5);
  /* the photographs are kept with the place */
  const f = db.dump()[`intern_files/${ids[0]}`];
  assert.equal(f.unused, false);
  assert.match(f.shelterId, /^SH-[A-Z0-9]{9}$/);
});

test('one place is one entry: the same phone, or the same name at the same PIN, even named at the same moment', async () => {
  const a = await intern('Asha Rao', '9000000001');
  const b = await intern('Ravi Kumar', '9000000002');
  const c = await intern('Meena Iyer', '9000000003');
  const [pa, pb, pc] = [await photos(a.br, 2), await photos(b.br, 2), await photos(c.br, 3)];
  /* two at once, the same place spelt two ways, the same phone */
  const [ra, rb] = await Promise.all([
    a.br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: pa })),
    b.br.go('shelter', 'POST', Object.assign({}, PLACE, { name: 'Karuna Shelter Trust', phone: '+91 98450-12345', photos: pb }))
  ]);
  assert.equal(ra.status, 200, JSON.stringify(ra.json));
  assert.equal(rb.status, 200, JSON.stringify(rb.json));
  /* a third: another phone, the same name at the same PIN */
  const rc = await c.br.go('shelter', 'POST', Object.assign({}, PLACE, { name: 'The Karuna Animal Shelter', phone: '0820 2571234', photos: pc }));
  assert.equal(rc.status, 200);
  const list = await admin('GET', { query: { shelters: '1' } });
  assert.equal(list.json.rows.length, 1, 'one entry');
  const e = list.json.rows[0];
  assert.equal(e.name, 'Karuna Animal Shelter', 'the first report names it; later ones do not overwrite');
  assert.deepEqual(e.interns.map((x) => x.name).sort(), ['Asha Rao', 'Meena Iyer', 'Ravi Kumar']);
  assert.equal(e.photos, 7);
  assert.equal(list.json.counts.new, 1);
  const d = await admin('GET', { query: { shelter: e.shelterId } });
  assert.equal(d.json.reports.length, 3, 'each intern’s own report is kept');
  assert.ok(d.json.reports.some((r) => r.name === 'Karuna Shelter Trust'));
  assert.deepEqual(d.json.interns.map((x) => x.mobile).sort(), ['9000000001', '9000000002', '9000000003'], 'how to reach each intern');
  /* the panel's badge counts the new one */
  assert.equal((await admin('GET')).json.sheltersNew, 1);
});

test('PFA marks, corrects and merges entries; asks an intern to choose another place, who is told and must', async () => {
  const a = await intern('Asha Rao', '9000000001');
  const b = await intern('Ravi Kumar', '9000000002');
  await a.br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: await photos(a.br, 2) }));
  await b.br.go('shelter', 'POST', Object.assign({}, PLACE, { name: 'Udupi Paws', phone: '9988776655', photos: await photos(b.br, 2) }));
  let rows = (await admin('GET', { query: { shelters: '1' } })).json.rows;
  assert.equal(rows.length, 2);
  const karuna = rows.find((r) => r.name === 'Karuna Animal Shelter').shelterId;
  const paws = rows.find((r) => r.name === 'Udupi Paws').shelterId;
  /* marks */
  assert.equal((await admin('POST', { body: { action: 'shelter-status', shelterId: karuna, status: 'not-shelter', note: '' } })).status, 400, 'say why');
  const v = await admin('POST', { body: { action: 'shelter-status', shelterId: karuna, status: 'verified', note: 'Called Ravi Shetty' } });
  assert.equal(v.json.shelter.status, 'verified');
  /* a correction may not take another entry's phone */
  const clash = await admin('POST', { body: { action: 'shelter-edit', shelterId: paws, fields: Object.assign({}, PLACE, { name: 'Udupi Paws', phone: '9845012345' }) } });
  assert.equal(clash.status, 409);
  assert.match(clash.json.message, /Merge the two instead/);
  const fixed = await admin('POST', { body: { action: 'shelter-edit', shelterId: paws, fields: Object.assign({}, PLACE, { name: 'Udupi Paws Rescue', phone: '9988776655', landmark: 'Behind the bus stand' }) } });
  assert.equal(fixed.json.shelter.name, 'Udupi Paws Rescue');
  assert.ok(fixed.json.shelter.history.some((h) => h.event === 'edited' && h.before.name === 'Udupi Paws'));
  /* merge: one place after all */
  const m = await admin('POST', { body: { action: 'shelter-merge', from: paws, into: karuna } });
  assert.equal(m.status, 200, JSON.stringify(m.json));
  rows = (await admin('GET', { query: { shelters: '1' } })).json.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].interns.length, 2);
  assert.equal(db.dump()[`intern_places/${b.internId}`].shelterId, karuna, 'the intern follows the merge');
  /* the merged entry's phone now finds the kept one */
  const c = await intern('Meena Iyer', '9000000003');
  await c.br.go('shelter', 'POST', Object.assign({}, PLACE, { name: 'Paws Udupi', phone: '99887 76655', pin: '576101', photos: await photos(c.br, 2) }));
  assert.equal(db.dump()[`intern_places/${c.internId}`].shelterId, karuna);

  /* ask Asha to choose another place */
  sent = [];
  assert.equal((await admin('POST', { body: { action: 'place-change', internId: a.internId, reason: '' } })).status, 400);
  const ch = await admin('POST', { body: { action: 'place-change', internId: a.internId, reason: 'The shelter has closed for repairs this month.' } });
  assert.equal(ch.json.mailed, 'sent');
  assert.equal(sent[0].to, 'asha@example.com');
  assert.equal(sent[0].subject, 'Your shelter work: please choose another place');
  assert.match(sent[0].text, /The shelter has closed for repairs this month\./);
  const blocked = await a.br.go('work', 'POST', { taskKey: 'shelter', links: ['https://x.example/s'], hours: 20 });
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.message, /asked you to choose another place: The shelter has closed/);
  const me = await a.br.go('me', 'GET');
  assert.equal(me.json.place.state, 'change');
  /* she names another; the old entry shows she left */
  const again = await a.br.go('shelter', 'POST', Object.assign({}, PLACE, { name: 'Manipal Animal Care', phone: '9876501234', pin: '576104', photos: await photos(a.br, 2) }));
  assert.equal(again.status, 200);
  const old = (await admin('GET', { query: { shelter: karuna } })).json;
  const asha = old.interns.find((x) => x.internId === a.internId);
  assert.equal(asha.current, false);
  assert.ok(asha.leftAt);
  assert.equal((await a.br.go('work', 'POST', { taskKey: 'shelter', links: ['https://x.example/s'], hours: 20 })).status, 200);
});

test('every intern in the panel: contact, the eight tasks, quiz, shelter and hours; one opens to all of it; Excel', async () => {
  const a = await intern('Asha Rao', '9000000001');
  await intern('Ravi Kumar', '9000000002');
  await a.br.go('shelter', 'POST', Object.assign({}, PLACE, { photos: await photos(a.br, 2) }));
  await a.br.go('work', 'POST', { taskKey: 'shelter', links: ['https://drive.google.com/sheet'], hours: 20 });
  await db.collection('certificates').doc('PFA-INT-ABCDEFGH').set({ number: 'PFA-INT-ABCDEFGH', name: 'Asha Rao', email: 'asha@example.com', issuedOn: '2026-12-28', kind: 'Internship' });
  const all = await admin('GET', { query: { interns: 'all' } });
  assert.equal(all.status, 200, JSON.stringify(all.json));
  const asha = all.json.interns.find((r) => r.internId === a.internId);
  assert.equal(asha.email, 'asha@example.com');
  assert.equal(asha.mobile, '9000000001');
  assert.equal(asha.batch, 'November 2026');
  assert.equal(asha.progress.tasks.length, 8);
  assert.equal(asha.progress.tasks.find((t) => t.key === 'shelter').state, 'submitted');
  assert.deepEqual(asha.quiz, { attempts: 0, open: false, best: null, passed: false, max: 3 });
  assert.equal(asha.place.name, 'Karuna Animal Shelter');
  assert.equal(asha.hours, 20);
  assert.equal(asha.certificate.number, 'PFA-INT-ABCDEFGH');
  const one = await admin('GET', { query: { profile: a.internId } });
  assert.equal(one.json.contact.mobile, '9000000001');
  assert.equal(one.json.works.find((w) => w.taskKey === 'shelter').hours, 20);
  assert.equal(one.json.place.shelterId, asha.place.shelterId);
  assert.ok(one.json.place.history.length >= 1);
  assert.doesNotMatch(JSON.stringify(all.json) + JSON.stringify(one.json), /keyHash|scrypt|sessionHash/i, 'never a key');
  const csv = await admin('GET', { query: { interns: 'all', format: 'csv' } });
  assert.match(csv.headers['content-disposition'], /pfa-interns-2026-11-09\.csv/);
  assert.match(csv.raw, /^\ufeffIntern,Intern ID,Email,Mobile,Town,College,Batch,Week,Status,Done,Percent,Learn the law,Map your district,/);
  assert.match(csv.raw, /Asha Rao,PFA-IN-\w{6},asha@example\.com,9000000001,.*Karuna Animal Shelter,Udupi,20,0,PFA-INT-ABCDEFGH/);
  const scsv = await admin('GET', { query: { shelters: '1', format: 'csv' } });
  assert.match(scsv.raw, /^\ufeffShelter,Directory number,Status,Person there,Phone,/);
  assert.match(scsv.raw, /Karuna Animal Shelter,SH-\w{9},"New, to check",Ravi Shetty,9845012345,/);
});

test('phones, names and keys: the same place is found however it is written', () => {
  assert.equal(SH.phoneOf('+91 98450-12345'), '9845012345');
  assert.equal(SH.phoneOf('09845012345'), '9845012345');
  assert.equal(SH.phoneOf('0820 2571234'), '08202571234');
  assert.equal(SH.phoneOf('12345'), '');
  assert.equal(SH.nameKey('The Karuna Animal Shelter'), SH.nameKey('Karuna Shelter Trust'));
  assert.equal(SH.nameKey('Karuna Animal Shelter'), 'karuna');
  assert.deepEqual(SH.addressLines({ city: 'Manipal', district: 'Udupi', state: 'Karnataka', pin: '576104' }), ['Manipal, Udupi', 'Karnataka 576104']);
  assert.deepEqual(SH.addressLines({ city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576102' }), ['Udupi', 'Karnataka 576102'], 'the town once');
});

test('wired: the portal route and page, the panel’s two new parts, the Firebase bundle', () => {
  const api = read('api/index.js');
  assert.match(api, /'intern\/shelter': \(\) => require\('\.\.\/lib\/routes\/intern\/portal\.js'\)\.shelter/);
  const page = read('intern.html');
  assert.match(page, /<script src="assets\/india-districts\.js"><\/script>\n<script src="assets\/intern-shelter\.js"><\/script>/);
  assert.match(page, /if \(shelter\) out \+= root\.PFAShelter\.card\(data\.place, state === 'accepted'\);/);
  const sh = read('assets/intern-shelter.js');
  assert.match(sh, /H\.api\('\/api\/intern\/shelter', \{ method: 'POST', body: body \}\)/);
  /* the site's field tidier would make "Dr Prakash" DrPrakash and a landline a
     mobile: the shelter's name, person and phones are kept as typed */
  for (const f of ['name', 'contact', 'phone', 'altPhone']) assert.match(sh, new RegExp(`field\\('${f}', [^)]*raw: true`), f);
  assert.match(sh, /' data-no-filter'/);
  const panel = read('admin.html');
  assert.match(panel, /panes: \['internship', 'interns', 'shelters', 'certificates'\]/);
  assert.match(panel, /<script src="assets\/admin-internship\.js"><\/script>/);
  assert.match(panel, /<div class="pane" data-pane="interns" role="region" aria-label="Interns">/);
  assert.match(panel, /<div class="pane" data-pane="shelters" role="region" aria-label="Shelter directory">/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600, 'the panel under its weight ceiling');
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-internship\.js'/);
});
