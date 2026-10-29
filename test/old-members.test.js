'use strict';

/* The old site's members (owner, 26 Oct 2026): "keep this as a sep page and
   DONT ADD THEM TO THE CURRENT PANEL. KEEP THIS SEPARATE AND VERY CLEARLY.
   ENSURE NO MEMBERS ARE THERE 2 TIMES. DO AN ENTERPRISE GRADE DEDUPE".

   Every person below is invented. The real list is never committed (this
   repository is public); these workbooks are built here, cell by cell, in
   the shapes the real one uses. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const X = require('../lib/xlsx-read');
const O = require('../lib/old-members');

/* ---------- a tiny .xlsx writer, for the tests only ---------- */

function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); centrals.push(central, n);
    offset += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/* sheets: [{ name, rows: [[cell, ...]], merges: ['C2:C4'] }]; a string is written
   to the shared strings, a number as a number, { inline: 's' } as an inline string */
function workbook(sheets) {
  const shared = []; const sid = (s) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const col = (n) => String.fromCharCode(65 + n);
  const files = {};
  sheets.forEach((sh, k) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = col(ci) + (ri + 1);
      if (v === null || v === undefined) return `<c r="${ref}" s="1"/>`;
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === 'object') return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v.inline)}</t></is></c>`;
      return `<c r="${ref}" t="s"><v>${sid(v)}</v></c>`;
    }).join('') + '</row>').join('');
    const merges = (sh.merges || []).length ? `<mergeCells>${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
    files[`xl/worksheets/sheet${k + 1}.xml`] = `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData>${merges}</worksheet>`;
  });
  files['xl/workbook.xml'] = `<?xml version="1.0"?><workbook xmlns:r="r"><workbookPr/><sheets>${sheets.map((sh, k) => `<sheet name="${xmlEsc(sh.name)}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0"?><Relationships>${sheets.map((sh, k) => `<Relationship Id="rId${k + 1}" Target="worksheets/sheet${k + 1}.xml"/>`).join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  return zip(files);
}

/* The shapes the real workbook uses, with invented people. */
const MASTER_HEAD = [[null, null, 'Golden Membership'], ['NAME / NUMBER / EMAIL', 'ADDRESS', 'MEMBERSHIP TYPE', 'DATE']];
function sample() {
  return workbook([
    { name: 'Sheet1', rows: MASTER_HEAD.concat([
      ['Asha Varma\n9876500001\nasha.varma@gmail.com', '12 Lake Road\nUdupi, Karnataka\nIndia-576101', 'INR 500.00', 45989, null, 'No receipt'],
      ['ROHAN DESAI 9876500002 rohan.desai@yahoo.com', '4 Hill Street\nPune', 'INR 1,000.00', 45990],
      ['Meera Iyer\n\u202a+91\u00a098765\u00a000003\u202c\nmeera@example.org', '9 Temple Road', 'Free', 45991, 'JOINNOWa1b2c3d4e5f6', 'ABCPD1234Q'],
      ['Kiran Rao\n9876500004\nfamily.rao@gmail.com', '1 Park Lane', 'INR 500.00', 45992],
      ['Divya Rao\n9876500005\nfamily.rao@gmail.com', '1 Park Lane', 'INR 500.00', 45992, 123456789012],
      ['Asha Varma\n09876500001\nAsha.Varma@gmail.com', '12 Lake Road', 'INR 500.00', 45993, 'Repeated'],
      ['Tarun Sen\n919876500006', '3 Bay Road', 'INR 500', 45994],
      ['Leela Nair\nleelanair@gmailcom\n9876500007', '7 Canal Road', 'INR 2500', 45995]
    ]) },
    { name: 'KNT', rows: [
      ['Membership Number', 'Name'],
      [3001, 'Asha Varma\n9876500001\nasha.varma@gmail.com'],
      [3002, 'Rohan Desai\n9876500002\nrohandesai@yahoo.com'],
      [3003, null],
      ['KNT 3004', '"Leela Nair\n9876500007\n\nleela.nair@gmail.com"'],
      [3005, 'Gopal Krishna Shetty']
    ] },
    { name: 'JK  BHR', merges: ['C3:C4'], rows: [
      ['Membership Number', 'Name'],
      ['JK 640', 'Gopal Krishna Shetty'],
      [641, 'Sunil Kumar Das', 'Collected by a unit'],
      [642, 'Nirmala Devi\n234567890123 (Aadhaar Number)']
    ] },
    { name: 'TN', rows: [
      ['Membership Number', 'Name'],
      [4700, 'Meera Iyer\n9876500003\nmeera@example.org'],
      [4701, 'Meera Iyer\n9876500003\nmeera@example.org'],
      [4702, 'Kumar\n9876500008\nfriends.club@gmail.com'],
      [4703, 'Selvi\n9876500009\nfriends.club@gmail.com'],
      [4704, 'Arun\n9876500010\nfriends.club@gmail.com']
    ] }
  ]);
}

/* ---------- the reader ---------- */

test('the reader: shared and inline text, numbers, merged ranges and dates', () => {
  const book = X.readWorkbook(workbook([{ name: 'A&B', merges: ['B1:B3'], rows: [['x', 'merged'], [{ inline: 'inline <text>' }, null], [12.5]] }]));
  assert.equal(book.sheets[0].name, 'A&B');
  const rows = book.sheets[0].rows;
  assert.equal(rows.get(1).A, 'x');
  assert.equal(rows.get(2).A, 'inline <text>');
  assert.equal(rows.get(3).A, 12.5);
  assert.equal(rows.get(3).B, 'merged', 'a merged range shows its value on every row it covers');
  assert.equal(X.serialDate(45989, false), '2025-11-28');
});

test('the reader refuses what is not a workbook, and a workbook that would unpack too large', () => {
  assert.throws(() => X.readWorkbook(Buffer.from('not a zip at all, just words')), { code: 'BAD_WORKBOOK' });
  const bomb = workbook([{ name: 'S', rows: [['a']] }]);
  /* claim an enormous unpacked size in the central directory */
  const cd = bomb.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(0xfffffff0, cd + 24);
  assert.throws(() => X.readWorkbook(bomb), /too large/);
});

/* ---------- reading people ---------- */

test('every way the name cell is written gives the same name, mobile and email', () => {
  const shapes = [
    'Asha Varma\n9876500001\nasha.varma@gmail.com',
    'Asha Varma 9876500001 asha.varma@gmail.com',
    'Asha Varma\nasha.varma@gmail.com\n9876500001',
    '"Asha Varma\n9876500001\n\nasha.varma@gmail.com"',
    'Asha Varma\n\u202a+91\u00a098765\u00a000001\u202c\nasha.varma@gmail.com',
    'Asha Varma\n09876500001\nasha.varma@gmail.com',
    'Asha Varma\n919876500001\nasha.varma@gmail.com',
    ' Ms. Asha Varma 98765 00001 asha.varma@gmail.com'
  ];
  for (const s of shapes) {
    const c = O.readContact(s);
    assert.match(c.name, /Asha Varma$/, JSON.stringify(s));
    assert.deepEqual(c.mobiles, ['9876500001'], JSON.stringify(s));
    assert.deepEqual(c.emails, ['asha.varma@gmail.com'], JSON.stringify(s));
  }
  assert.deepEqual(O.readContact('Ravi Yadav (Guddu)\n9876500011').aka, ['Guddu']);
  assert.equal(O.displayName('ROHAN DESAI'), 'Rohan Desai');
});

test('Aadhaar and PAN numbers written into the sheet are left out, never carried over', () => {
  const out = O.build(sample());
  const all = JSON.stringify(out);
  assert.doesNotMatch(all, /234567890123|123456789012|ABCPD1234Q/);
  assert.ok(out.stats.idsLeftOut >= 3, 'and the count of what was left out is kept');
  const nirmala = out.members.find((m) => m.name === 'Nirmala Devi');
  assert.ok(nirmala, 'the person is kept, only the number goes');
});

/* ---------- the dedupe ---------- */

test('one person in the master list and a state list, written differently, is one person', () => {
  const out = O.build(sample());
  const asha = out.members.filter((m) => m.name === 'Asha Varma');
  assert.equal(asha.length, 1, 'three rows (two master, one KNT), case and a leading 0 aside');
  assert.equal(asha[0].rowsJoined, 3);
  assert.deepEqual(asha[0].numbers, [{ list: 'KNT', number: '3001' }]);
  assert.equal(asha[0].addresses[0], '12 Lake Road Udupi, Karnataka India-576101');
  assert.equal(asha[0].joined, '2025-11-28', 'the earliest date');
  const rohan = out.members.filter((m) => /rohan desai/i.test(m.name));
  assert.equal(rohan.length, 1, 'ALL CAPS on one, Gmail-style dots on the other');
  const leela = out.members.filter((m) => m.name === 'Leela Nair');
  assert.equal(leela.length, 1, 'a quoted cell with a blank line, and a mistyped email');
  assert.deepEqual(leela[0].emails, [{ email: 'leela.nair@gmail.com', looksWrong: false }], 'one mailbox, shown as the spelling that works');
  const tarun = out.members.find((m) => m.name === 'Tarun Sen');
  assert.deepEqual(tarun.mobiles, ['98765 00006'], 'a 91 in front is the country code');
});

test('the same membership number twice on one list, or two numbers for one person, is one person', () => {
  const out = O.build(sample());
  const meera = out.members.filter((m) => m.name === 'Meera Iyer');
  assert.equal(meera.length, 1);
  assert.deepEqual(meera[0].numbers.map((n) => n.number), ['4700', '4701'], 'both numbers are kept on the one person');
  assert.deepEqual(meera[0].orders, ['JOINNOWA1B2C3D4E5F6']);
});

test('a name with no contact details joins the same full name, and nothing else', () => {
  const out = O.build(sample());
  const gopal = out.members.filter((m) => m.name === 'Gopal Krishna Shetty');
  assert.equal(gopal.length, 1, 'the KNT and JK BHR rows');
  assert.equal(gopal[0].rowsJoined, 2);
  const sunil = out.members.find((m) => m.name === 'Sunil Kumar Das');
  assert.deepEqual(sunil.notes, ['Collected by a unit'], 'a merged note reaches each row it covers');
});

test('different names on one email or mobile are never joined: they are listed to check by hand', () => {
  const out = O.build(sample());
  for (const name of ['Kiran Rao', 'Divya Rao', 'Kumar', 'Selvi', 'Arun']) {
    assert.equal(out.members.filter((m) => m.name === name).length, 1, name);
  }
  const pair = (a, b) => out.review.find((r) => r.people.map((p) => p.name).sort().join('|') === [a, b].sort().join('|'));
  assert.ok(pair('Kiran Rao', 'Divya Rao'));
  for (const [a, b] of [['Kumar', 'Selvi'], ['Kumar', 'Arun'], ['Selvi', 'Arun']]) assert.ok(pair(a, b), `${a} and ${b}: every pair on one shared email is listed`);
});

test('nobody is in the result twice, ids are unique, and a second run gives the same ids', () => {
  const a = O.build(sample());
  const b = O.build(sample());
  assert.equal(a.stats.missedDuplicates, 0);
  assert.equal(new Set(a.members.map((m) => m.id)).size, a.members.length);
  assert.deepEqual(a.members.map((m) => m.id), b.members.map((m) => m.id));
  assert.equal(a.stats.emptyNumbersSkipped, 1, 'a number with nobody against it is not a member');
  assert.equal(a.stats.rowsRead - a.stats.people, a.stats.rowsJoined);
});

test('names agree on the same words, one inside the other, or a close spelling; not otherwise', () => {
  assert.ok(O.namesAgree('Ravi Kiran S', 'Ravi Kiran'));
  assert.ok(O.namesAgree('Varma Asha', 'Asha Varma'));
  assert.ok(O.namesAgree('Venkatesan Ramaswamy', 'Venkatesan Ramaswami'));
  assert.ok(O.namesAgree('Dr. Asha Varma', 'Asha Varma'));
  assert.ok(!O.namesAgree('Kiran Rao', 'Divya Rao'));
  assert.ok(!O.namesAgree('Rahul Sharma', 'Rohit Sharma'));
  assert.ok(!O.namesAgree('Priya R Menon', 'Anjali'));
  assert.equal(O.emailKey('A.Sha.Varma+club@GoogleMail.com'), 'ashavarma@gmail.com');
  assert.equal(O.emailKey('asha@gmail.comh.com'), 'asha@gmail.com');
  assert.ok(O.emailLooksWrong('asha@gmailcom') && O.emailLooksWrong('asha@gmail.cpm') && !O.emailLooksWrong('asha@gmail.com'));
});

/* ---------- the route, against the in-memory database ---------- */

const authPath = require.resolve('firebase-admin/auth');
const ACCOUNTS = {
  'tok-super': { uid: 'u-super', email: 'super@pfa.test', customClaims: { admin: true, role: 'super' } },
  'tok-staff': { uid: 'u-staff', email: 'staff@pfa.test', customClaims: { admin: true, role: 'staff', modules: ['oldmembers'] } },
  'tok-other': { uid: 'u-other', email: 'other@pfa.test', customClaims: { admin: true, role: 'staff', modules: ['submissions'] } }
};
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { getAuth: () => ({
    async verifyIdToken(token) { const a = ACCOUNTS[token]; if (!a) throw new Error('bad token'); return { uid: a.uid, email: a.email }; },
    async getUser(uid) { return Object.values(ACCOUNTS).find((a) => a.uid === uid); }
  }) }
};
const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
let db;
test.beforeEach(() => { db = memoryFirestore(); firebase._setDbForTests(db); });
test.afterEach(() => { firebase._setDbForTests(null); });

function call({ method = 'GET', token = 'tok-super', body }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader() {}, getHeader() {}, writeHead(code) { out.statusCode = code; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api/admin/old-members', query: {}, body, headers: { host: 'pfa.test', authorization: 'Bearer ' + token, 'content-type': 'application/json' } };
    Promise.resolve(require('../lib/routes/admin/old-members.js')(request, response)).catch(reject);
  });
}
const load = (token) => call({ method: 'POST', token, body: { action: 'import', fileName: 'members.xlsx', data: sample().toString('base64') } });
async function collections() {
  const names = ['members', 'submissions', 'caretakerPublic', 'caretakerCards', 'transactions', 'storeOrders'];
  const out = {};
  for (const n of names) out[n] = (await db.collection(n).get()).size;
  return out;
}

test('a super administrator loads the list; it lands in oldSiteMembers and nowhere else', async () => {
  const before = await collections();
  const empty = await call({});
  assert.equal(empty.json.empty, true);
  assert.equal(empty.json.canImport, true);
  const res = await load('tok-super');
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.equal(res.json.stats.missedDuplicates, 0);
  assert.deepEqual(await collections(), before, 'no member, submission, card or payment was touched');
  const got = await call({});
  assert.equal(got.json.members.length, res.json.stats.people);
  assert.equal(new Set(got.json.members.map((m) => m.id)).size, got.json.members.length);
  assert.ok(got.json.review.length >= 4);
  const log = (await db.collection('adminAudit').get()).docs.map((d) => d.data());
  assert.ok(log.some((e) => e.action === 'old-members-import' && e.outcome === 'done'), 'the import is in the audit log');
});

test('staff with the section may read it but not load it; staff without it may not read it', async () => {
  await load('tok-super');
  const read = await call({ token: 'tok-staff' });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json.canImport, false);
  const refused = await load('tok-staff');
  assert.equal(refused.statusCode, 403);
  const other = await call({ token: 'tok-other' });
  assert.equal(other.statusCode, 403);
});

test('a newer copy becomes the current list; the earlier one is kept, not deleted', async () => {
  const first = (await load('tok-super')).json.importId;
  await new Promise((r) => setTimeout(r, 5));
  const second = (await load('tok-super')).json.importId;
  assert.notEqual(first, second);
  assert.equal((await db.collection('oldSiteMembers').doc('current').get()).data().importId, second);
  assert.ok((await db.collection('oldSiteMembers').doc(first).get()).exists, 'the first import is still there');
  assert.equal((await call({})).json.importId, second);
});

test('a file that is not a workbook, or has no members, is refused and nothing is saved', async () => {
  const bad = await call({ method: 'POST', body: { action: 'import', fileName: 'x.xlsx', data: Buffer.from('hello').toString('base64') } });
  assert.equal(bad.statusCode, 422);
  const none = await call({ method: 'POST', body: { action: 'import', fileName: 'x.xlsx', data: workbook([{ name: 'S', rows: [['Price', 'Item'], [1, 'Tea']] }]).toString('base64') } });
  assert.equal(none.statusCode, 422);
  assert.equal((await db.collection('oldSiteMembers').get()).size, 0);
});

/* ---------- kept apart ---------- */

test('kept apart: only its own route touches the collection, and the browser cannot read it', () => {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f); });
  walk(path.join(ROOT, 'lib'));
  const users = files.filter((f) => /oldSiteMembers/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
  assert.deepEqual(users, [path.join('lib', 'routes', 'admin', 'old-members.js')], 'no count, search or register reads the old list or its changes');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib/routes/admin/old-members.js'), 'utf8'), /collection\('members'\)|collection\("members"\)/);
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  for (const c of ['oldSiteMembers', 'oldSiteMembersChanges', 'oldSiteMembersProposals']) assert.match(rules, new RegExp(`match /${c}/\\{id\\}\\s*\\{ allow read, write: if false; \\}`), c);
  const panel = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(panel, /<div class="railgroup railgroup--apart">\s*<p>Kept apart<\/p>\s*<button class="tab" type="button" data-tab="oldmembers">Old site members<\/button>/);
  assert.match(panel, /These people are not in the current members register, hold no card here, and are counted nowhere else in this panel\./);
});

test('no spreadsheet of people can be committed to this public repository', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const p of ['*.xlsx', '*.xls', '*.xlsm']) assert.ok(ignore.split('\n').includes(p), p);
});

/* ---------- changes by hand: two confirmations, a reason, a history ---------- */

const CH = require('../lib/old-members-changes');
const WHY = 'Same mobile and address; she confirmed on the phone that she joined twice.';

test('a change needs a reason that says why; placeholders are refused', () => {
  for (const bad of ['', 'ok', 'fixed', 'duplicate', 'as discussed', 'same person', 'aaaaaaaaaaaaaaaaaaaa', 'yes yes', 'n/a']) {
    assert.equal(CH.checkReason(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(CH.checkReason(WHY).ok, true);
  assert.equal(CH.checkReason('Typo in the surname, checked against her receipt').ok, true);
});

async function people(token = 'tok-super') { return (await call({ token })).json; }
const find = (list, name) => list.members.find((m) => m.name === name);
const propose = (change, reason = WHY, token = 'tok-super') => call({ method: 'POST', token, body: { action: 'propose', change, reason } });
const confirmIt = (proposalId, word = 'CONFIRM', token = 'tok-super') => call({ method: 'POST', token, body: { action: 'confirm', proposalId, confirm: word } });

test('step one alone changes nothing; step two needs the word CONFIRM, from the same person', async () => {
  await load('tok-super');
  const before = await people();
  const kiran = find(before, 'Kiran Rao');
  const p = await propose({ op: 'edit', id: kiran.id, set: { name: 'Kiran S Rao' } });
  assert.equal(p.statusCode, 200, p.raw);
  assert.equal(p.json.before[0].name, 'Kiran Rao');
  assert.equal(p.json.after[0].name, 'Kiran S Rao');
  assert.ok(find(await people(), 'Kiran Rao'), 'proposed, not saved');
  assert.equal((await confirmIt(p.json.proposalId, 'confirm please')).statusCode, 422, 'the word must be typed exactly');
  ACCOUNTS['tok-super2'] = { uid: 'u-super2', email: 'second@pfa.test', customClaims: { admin: true, role: 'super' } };
  assert.equal((await confirmIt(p.json.proposalId, 'CONFIRM', 'tok-super2')).statusCode, 403, 'only the person who reviewed it');
  const ok = await confirmIt(p.json.proposalId);
  assert.equal(ok.statusCode, 200, ok.raw);
  assert.ok(find(await people(), 'Kiran S Rao'));
  assert.equal((await confirmIt(p.json.proposalId)).statusCode, 409, 'a proposal is used once');
  assert.ok((await db.collection('oldSiteMembersProposals').doc(p.json.proposalId).get()).exists, 'and kept, not deleted');
});

test('no reason, no change: the server refuses it before anything is proposed', async () => {
  await load('tok-super');
  const kiran = find(await people(), 'Kiran Rao');
  const res = await propose({ op: 'edit', id: kiran.id, set: { name: 'Kiran S Rao' } }, 'fixed');
  assert.equal(res.statusCode, 422);
  assert.equal(res.json.code, 'REASON');
  assert.equal((await db.collection('oldSiteMembersProposals').get()).size, 0);
});

test('a review goes stale if anyone changes the list before it is confirmed', async () => {
  await load('tok-super');
  const list = await people();
  const a = await propose({ op: 'edit', id: find(list, 'Kiran Rao').id, set: { plans: ['INR 1000'] } });
  const b = await propose({ op: 'edit', id: find(list, 'Divya Rao').id, set: { plans: ['INR 1000'] } });
  assert.equal((await confirmIt(a.json.proposalId)).statusCode, 200);
  const late = await confirmIt(b.json.proposalId);
  assert.equal(late.statusCode, 409);
  assert.equal(late.json.code, 'STALE');
});

test('merge: two people become one, and the history says who, what and why', async () => {
  await load('tok-super');
  const list = await people();
  const kiran = find(list, 'Kiran Rao'); const divya = find(list, 'Divya Rao');
  const p = await propose({ op: 'merge', keep: kiran.id, absorb: divya.id });
  assert.equal(p.json.before.length, 2);
  assert.equal(p.json.after.length, 1);
  await confirmIt(p.json.proposalId);
  const after = await people();
  assert.equal(after.members.length, list.members.length - 1);
  const one = after.members.find((m) => m.id === kiran.id);
  assert.equal(one.rowsJoined, 2);
  assert.equal(one.name, 'Kiran Rao', 'the record chosen to stay keeps its name');
  assert.ok(one.joinedBecause.includes('joined by hand'));
  assert.ok(!after.review.some((r) => r.people.some((x) => x.id === divya.id)), 'the pair leaves the check list');
  const h = after.history[0];
  assert.equal(h.by.email, 'super@pfa.test');
  assert.equal(h.reason, WHY);
  assert.match(h.summary, /^Joined Divya Rao into Kiran Rao, as one person$/);
  assert.ok(h.at && h.before.length === 2 && h.after.length === 1);
  const log = (await db.collection('adminAudit').get()).docs.map((d) => d.data());
  assert.ok(log.some((e) => e.action === 'old-members-change' && e.detail.includes('Why: ' + WHY) && e.actor.email === 'super@pfa.test'));
});

test('split: a row joined by mistake becomes a person of its own; resolve: a pair is marked different', async () => {
  await load('tok-super');
  const list = await people();
  const asha = find(list, 'Asha Varma');
  const row = asha.sources.find((s) => s.list === 'KNT');
  const p = await propose({ op: 'split', id: asha.id, list: row.list, row: row.row });
  await confirmIt(p.json.proposalId);
  const after = await people();
  assert.equal(after.members.filter((m) => m.name === 'Asha Varma').length, 2);
  assert.equal(after.members.find((m) => m.id === asha.id).rowsJoined, 2);
  const pair = after.review.find((r) => r.people.map((x) => x.name).sort().join('|') === 'Arun|Kumar');
  const r = await propose({ op: 'resolve', a: pair.people[0].id, b: pair.people[1].id }, 'Different people: Kumar and Arun are brothers who share one email.');
  await confirmIt(r.json.proposalId);
  const done = await people();
  assert.ok(!done.review.some((x) => x.people.map((y) => y.name).sort().join('|') === 'Arun|Kumar'));
  assert.equal(done.history.length, 2);
  assert.match(done.history[0].summary, /^Marked .* as two different people$/);
});

test('edits are checked: a bad mobile or email is refused; nothing different is refused', async () => {
  await load('tok-super');
  const kiran = find(await people(), 'Kiran Rao');
  assert.equal((await propose({ op: 'edit', id: kiran.id, set: { mobiles: ['12345'] } })).statusCode, 422);
  assert.equal((await propose({ op: 'edit', id: kiran.id, set: { emails: ['not an email'] } })).statusCode, 422);
  assert.equal((await propose({ op: 'edit', id: kiran.id, set: { name: 'Kiran Rao' } })).json.code, 'NO_CHANGE');
  const warn = await propose({ op: 'edit', id: kiran.id, set: { mobiles: ['9876500005'] } });
  assert.ok(warn.json.warnings.some((w) => /also on Divya Rao/.test(w)), 'a contact another person holds is pointed out before confirming');
});

test('staff can read the history but cannot propose or confirm a change', async () => {
  await load('tok-super');
  const kiran = find(await people(), 'Kiran Rao');
  assert.equal((await propose({ op: 'edit', id: kiran.id, set: { name: 'K Rao' } }, WHY, 'tok-staff')).statusCode, 403);
  const read = await people('tok-staff');
  assert.equal(read.canEdit, false);
  assert.ok(Array.isArray(read.history));
});

test('changes carry over to a newer copy of the list, replayed by person', async () => {
  await load('tok-super');
  const list = await people();
  const p = await propose({ op: 'merge', keep: find(list, 'Kiran Rao').id, absorb: find(list, 'Divya Rao').id });
  await confirmIt(p.json.proposalId);
  await new Promise((r) => setTimeout(r, 5));
  await load('tok-super');
  const again = await people();
  assert.equal(again.members.length, list.members.length - 1, 'the merge still holds on the new copy');
  assert.equal(again.history[0].appliesNow, true);
  assert.equal((await db.collection('oldSiteMembers').doc('current').get()).data().changeSeq, 1, 'the count of changes is not reset by an import');
});

/* ---------- notes and emails (owner, 28 Oct 2026) ----------
   "there should be a section to add notes if someone from admin side reaches
   out to the person and email should go out..optional. from here.. like for
   existing tickets" */

const MAILER = require('../lib/caregiver-mail');
const INBOUND = require('../lib/inbound-mail');
const NOTE_ENV = ['PFA_SMTP_USER', 'PFA_SMTP_PASS', 'PFA_IMAP_USER', 'PFA_CAPTURE_REPLIES', 'PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX'];
async function withMail(fn) {
  const saved = {}; NOTE_ENV.forEach((k) => { saved[k] = process.env[k]; });
  Object.assign(process.env, { PFA_SMTP_USER: 'info@peopleforanimalsindia.org', PFA_SMTP_PASS: 'x', PFA_SUBMISSIONS_INBOX: 'gandhim@exmpls.sansad.in', PFA_PAYMENTS_INBOX: 'pay@pfa.test' });
  delete process.env.PFA_IMAP_USER; delete process.env.PFA_CAPTURE_REPLIES;
  const sent = [];
  MAILER._setSmtpTransport(() => ({ async sendMail(m) { sent.push(m); return { messageId: m.messageId }; }, close() {} }));
  try { return await fn(sent); } finally {
    MAILER._setSmtpTransport(null);
    NOTE_ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  }
}
function callQ({ token = 'tok-super', query }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200 };
    const response = { get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; }, setHeader() {}, getHeader() {}, writeHead(c) { out.statusCode = c; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); } };
    const request = { method: 'GET', url: '/api/admin/old-members', query, headers: { host: 'pfa.test', authorization: 'Bearer ' + token } };
    Promise.resolve(require('../lib/routes/admin/old-members.js')(request, response)).catch(reject);
  });
}
const note = (personId, text, email, token = 'tok-super') => call({ method: 'POST', token, body: { action: 'note', personId, text, email } });
const notesOf = async (id, token) => (await callQ({ token, query: { notes: id } })).json.notes;

test('a note is kept under the person, by whoever has the section, and never changes them', async () => {
  await load('tok-super');
  const asha = find(await people(), 'Asha Varma');
  assert.equal((await note(asha.id, ' ')).statusCode, 422, 'an empty note is refused');
  const saved = await note(asha.id, 'Called her on 9876500001. She is still with us and will renew in March.', null, 'tok-staff');
  assert.equal(saved.statusCode, 200, saved.raw);
  assert.equal(saved.json.note.type, 'note');
  assert.equal((await note(asha.id, 'x y', null, 'tok-other')).statusCode, 403, 'not without the Old site members section');
  const list = await notesOf(asha.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].by.email, 'staff@pfa.test');
  assert.match(list[0].text, /renew in March/);
  const after = await people();
  assert.equal(after.noteCounts[asha.id], 1, 'the list shows how many notes');
  assert.deepEqual(find(after, 'Asha Varma'), Object.assign({}, asha), 'the person is as they were');
  assert.equal(after.history.length, 0, 'a note is not a change to the list');
  const log = (await db.collection('adminAudit').get()).docs.map((d) => d.data());
  assert.ok(log.some((e) => e.action === 'old-members-note' && e.actor.email === 'staff@pfa.test'));
});

test('ticked, the note goes to them by email from info@, to one of their own addresses, and their reply comes back here and to whoever wrote', async () => {
  await load('tok-super');
  const asha = find(await people(), 'Asha Varma');
  await withMail(async (sent) => {
    assert.equal((await note(asha.id, 'Hello', { to: 'someone@else.com' })).json.code, 'NOT_THEIR_EMAIL');
    const r = await note(asha.id, 'Dear Asha,\n\nWe are bringing old members across to the new site. May we?', { to: 'asha.varma@gmail.com', subject: 'Your PFA membership' }, 'tok-staff');
    assert.equal(r.statusCode, 200, r.raw);
    assert.equal(r.json.emailed, true);
    const out = sent[sent.length - 1];
    assert.equal(String(out.to), 'asha.varma@gmail.com');
    assert.equal(out.subject, 'Your PFA membership');
    assert.match(String(out.replyTo), /info@peopleforanimalsindia\.org/, 'their Reply comes to the site');
    const ref = 'PFA-OLD-' + asha.id.replace(/^OSM-/, '');
    const thread = db.dump()[`oldSiteMembersThreads/${asha.id}`];
    const msgId = `<${ref}.${thread.threadId}.msg.1@peopleforanimalsindia.org>`;
    assert.equal(out.messageId, msgId);
    assert.match(out.text, /staff, People for Animals/i, 'signed by who wrote it');
    assert.equal((await notesOf(asha.id))[0].email.state, 'sent');

    /* her answer, read from the mailbox */
    const reply = { from: 'asha.varma@gmail.com', fromName: 'Asha Varma', to: ['info@peopleforanimalsindia.org'], subject: 'Re: Your PFA membership', messageId: '<a1@gmail.com>', inReplyTo: [msgId], references: [msgId], text: 'Yes please.', newText: 'Yes please.', date: new Date(), attachments: [], cc: [] };
    const filed = await INBOUND.file(db, reply, { mail: MAILER });
    assert.equal(filed.filed, true);
    assert.deepEqual(filed.relayed, ['staff@pfa.test']);
    const again = await INBOUND.file(db, reply, { mail: MAILER });
    assert.equal(again.reason, 'DUPLICATE', 'read twice, filed once');
    const relay = sent[sent.length - 1];
    assert.equal(String(relay.to), 'staff@pfa.test', 'carried to the member of staff who wrote');
    assert.match(relay.text, /Yes please\./);
    assert.match(String(relay.replyTo), /info@peopleforanimalsindia\.org/);
    let list = await notesOf(asha.id);
    assert.equal(list[0].type, 'email-in');
    assert.equal(list[0].party, 'person');
    assert.equal(list[0].text, 'Yes please.');

    /* staff press Reply on that, in their own mailbox: it goes on to her */
    const answer = { from: 'staff@pfa.test', fromName: 'Staff', to: ['info@peopleforanimalsindia.org'], subject: relay.subject, messageId: '<s1@pfa.test>', inReplyTo: [relay.messageId], references: [msgId, relay.messageId], text: 'Thank you, done.', newText: 'Thank you, done.', date: new Date(), attachments: [], cc: [] };
    const on = await INBOUND.file(db, answer, { mail: MAILER });
    assert.equal(on.filed, true);
    assert.deepEqual(on.relayed, ['asha.varma@gmail.com']);
    const toHer = sent[sent.length - 1];
    assert.equal(String(toHer.to), 'asha.varma@gmail.com');
    assert.match(toHer.text, /Thank you, done\./);
    assert.equal(toHer.inReplyTo, msgId, 'in the same conversation in her mailbox');
    list = await notesOf(asha.id);
    assert.deepEqual(list.map((n) => n.type).slice(0, 2).sort(), ['email-in', 'email-out']);
  });
});

test('notes follow a person who is joined into another', async () => {
  await load('tok-super');
  const list = await people();
  const kiran = find(list, 'Kiran Rao'); const divya = find(list, 'Divya Rao');
  await note(divya.id, 'Spoke to Divya about the family membership.');
  const p = await propose({ op: 'merge', keep: kiran.id, absorb: divya.id });
  await confirmIt(p.json.proposalId);
  const notes = await notesOf(kiran.id);
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Divya/);
  assert.equal((await people()).noteCounts[kiran.id], 1);
});

test('the panel: a Notes and emails section in each person, with the email optional and staged', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.match(html, /\+ \(d\.canNote \? omNotesBox\(m\) : ''\)\n {6}\+ \(d\.canEdit \?/, 'first thing under their details');
  /* in plain view, not behind a + (owner, 28 Oct 2026: "make add note option more prominent and visible and unmissable") */
  assert.match(html, /'<div class="om-notes" data-omnotes="' \+ esc\(m\.id\) \+ '"><h3>Add a note<\/h3>'\n {6}\+ '<div class="om-nadd">'/);
  assert.doesNotMatch(html, /<details class="fold om-nadd">/);
  assert.match(html, /<h4>Notes and emails<\/h4>/);
  assert.match(html, /\.om-notes\{[^}]*border:1px solid var\(--ink\);box-shadow:inset 4px 0 0 var\(--ink\)\}/);
  assert.match(html, /<input type="checkbox" id="omNoteMail"> Also email this to them/);
  assert.match(html, /<div id="omNoteMailBox" hidden>/);
  assert.match(html, /It goes from info@ with your name at the end\. Their reply comes back here and to your email\./);
  assert.match(html, /api\('\/api\/admin\/old-members\?notes=' \+ encodeURIComponent\(id\)\)/);
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  for (const c of ['oldSiteMembersNotes', 'oldSiteMembersThreads']) assert.match(rules, new RegExp(`match /${c}/\\{id\\}\\s*\\{ allow read, write: if false; \\}`), c);
});
