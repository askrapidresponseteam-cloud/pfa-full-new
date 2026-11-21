'use strict';

/* The People directory (owner, 10 Nov 2026: "for admin create a people's
   directory section. state, district, name, address, phone number. ensure
   no duplicates. category- members, caregivers etc.. whatever applicable").

   Held here: who is the same person (one line each, every category on it),
   who is not (a family on one phone stays two people), what is left out,
   where the state and district come from, the route's gate, its download
   and its log, and the panel's wiring. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USERS = {
  'test-admin': { uid: 'u-super', email: 'priya@pfa.test', name: 'Priya', claims: { admin: true, role: 'super' } },
  'test-staff': { uid: 'u-staff', email: 'ravi@pfa.test', name: 'Ravi', claims: { admin: true, role: 'staff', modules: ['membership', 'caregivers'] } },
  'test-dir': { uid: 'u-dir', email: 'asha@pfa.test', name: 'Asha', claims: { admin: true, role: 'staff', modules: ['directory'] } }
};
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { const u = USERS[token]; if (!u) throw new Error('bad token'); return { uid: u.uid, email: u.email, name: u.name }; },
      async getUser(uid) { const u = Object.values(USERS).find((x) => x.uid === uid); return { uid, email: u.email, displayName: u.name, customClaims: u.claims }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const adminAuth = require('../lib/admin-auth');
const D = require('../lib/people-directory');
const route = require('../lib/routes/admin/directory');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const AT = (d) => Date.parse(`2026-11-${String(d).padStart(2, '0')}T10:00:00+05:30`);

function rec(id, kind, day, fields, status = 'new') {
  return [id, { kind, status, receivedAtMs: AT(day), fields }];
}
const RECORDS = [
  rec('PFA-MEM-2026-00001', 'PFA-MEM', 1, { name: 'asha rao', mobile: '+91 98765 43210', email: 'Asha@X.in', address: '12 Car Street', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576101' }),
  rec('PFA-V-2026-00004', 'PFA-V', 2, { name: 'Asha', mobile: '09876543210', email: 'asha@x.in' }, 'approved'),
  rec('PFA-DON-2026-00009', 'PFA-DON', 3, { name: 'Ravi Rao', mobile: '9876543210', address: '12 Car Street, Udupi, 576101' }),
  rec('PFA-SHP-2026-00002', 'PFA-SHP', 4, { name: 'Meera K', mobile: '9900112233', address: 'Meera K, 4/232 Ashraya, Kundapur, Udupi, Karnataka 576222' }),
  rec('PFA-CG-2026-00003', 'PFA-CG', 5, { name: 'Junk', mobile: '9000000001' }, 'spam'),
  rec('PFA-VI-2026-00006', 'PFA-VI', 6, { name: 'Meera K', mobile: '9900112233', email: 'meera@x.in', state: 'Karnataka', district: 'Udupi', address: '4/232 Ashraya', city: 'Kundapur', pincode: '576222' }, 'approved'),
  rec('PFA-VI-2026-00007', 'PFA-VI', 7, { name: 'Kiran S', mobile: '9811122233', email: 'kiran@x.in' }),
  rec('PFA-CR-2026-00010', 'PFA-CR', 8, { name: 'A reporter', mobile: '9822233344' }),
  rec('PFA-J-2026-00011', 'PFA-J', 9, { name: 'Kavya N', mobile: '9833344455' }),
  rec('PFA-U-2026-00012', 'PFA-U', 9, { name: 'Dr. Naveen Kumar', mobile: '9844455566', email: 'naveen@x.in', address: '3 Main Road', city: 'Mysuru', district: 'Mysuru (Mysore)', state: 'Karnataka', pincode: '570001' })
];

let db;
test.beforeEach(() => {
  db = memoryFirestore();
  firebase._setDbForTests(db);
  adminAuth._clearFailures();
});
test.afterEach(() => firebase._setDbForTests(null));

async function seed() {
  for (const [id, d] of RECORDS) await db.collection('submissions').doc(id).set(d);
  /* the site's own testing, before 21 Oct 2026, is never listed */
  await db.collection('submissions').doc('PFA-MEM-2026-00000').set({ kind: 'PFA-MEM', status: 'new', receivedAtMs: Date.parse('2026-10-10T10:00:00Z'), fields: { name: 'Test Person', mobile: '9855566677' } });
}

const counts0 = (res) => Object.fromEntries(res.json.categories.map((c) => [c.key, c.count]));

function call({ token, url = '/api/admin/directory', query } = {}) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method: 'GET', url, query, headers: Object.assign({ host: 'pfa.test', 'x-forwarded-for': '198.51.100.' + Math.floor(Math.random() * 200) }, token ? { authorization: `Bearer ${token}` } : {}) };
    Promise.resolve(route(request, response)).catch(reject);
  });
}

test('one line per person, every category on it; a family on one phone stays two people', () => {
  const people = D.merge(RECORDS.map(([id, d]) => D.entryOf(id, d)));
  const names = people.map((p) => p.name).sort();
  assert.deepEqual(names, ['Asha Rao', 'Dr. Naveen Kumar', 'Kavya N', 'Kiran S', 'Meera K', 'Ravi Rao']);
  const asha = people.find((p) => p.name === 'Asha Rao');
  assert.deepEqual(asha.categories, ['member', 'volunteer'], 'a member who volunteers is one line');
  assert.equal(asha.mobile, '9876543210', '+91 and a leading 0 are the same number');
  assert.equal(asha.email, 'asha@x.in');
  assert.deepEqual(asha.records.map((r) => r.id), ['PFA-V-2026-00004', 'PFA-MEM-2026-00001'], 'newest first');
  const ravi = people.find((p) => p.name === 'Ravi Rao');
  assert.deepEqual(ravi.categories, ['donor']);
  assert.deepEqual(ravi.sharesWith, ['Asha Rao'], 'the same phone, another person: kept, and said');
  assert.deepEqual(asha.sharesWith, ['Ravi Rao']);
  const meera = people.find((p) => p.name === 'Meera K');
  assert.deepEqual(meera.categories, ['intern', 'customer'], 'an accepted intern is an intern; she also bought from the shop');
  assert.equal(people.find((p) => p.name === 'Kiran S').categories[0], 'internapplicant');
  assert.ok(!names.includes('Junk'), 'spam is left out');
  assert.ok(!names.includes('A reporter'), 'a cruelty report is a case, not a person in the directory');
  /* every number is on one line only */
  const seen = new Map();
  for (const p of people) for (const m of [p.mobile].concat(p.otherMobiles)) if (m) seen.set(`${m}|${p.name}`, (seen.get(`${m}|${p.name}`) || 0) + 1);
  assert.ok([...seen.values()].every((n) => n === 1));
});

test('state and district as chosen, or read from the PIN code; the address on one line', () => {
  const people = D.merge(RECORDS.map(([id, d]) => D.entryOf(id, d)));
  const asha = people.find((p) => p.name === 'Asha Rao');
  assert.equal(asha.state, 'Karnataka');
  assert.equal(asha.district, 'Udupi');
  assert.equal(asha.placeFromPin, false);
  assert.equal(asha.address, '12 Car Street, Udupi 576101');
  const ravi = people.find((p) => p.name === 'Ravi Rao');
  assert.equal(ravi.state, 'Karnataka', 'a donation keeps one line: the state from its PIN');
  assert.equal(ravi.district, 'Udupi');
  assert.equal(ravi.placeFromPin, true);
  assert.equal(ravi.pin, '576101');
  assert.equal(ravi.address, '12 Car Street, Udupi 576101', 'the PIN after the town, as on every other line');
  const meera = people.find((p) => p.name === 'Meera K');
  assert.equal(meera.address, '4/232 Ashraya, Kundapur 576222', 'the latest address she gave');
  assert.equal(people.find((p) => p.name === 'Dr. Naveen Kumar').district, 'Mysuru', 'the bracketed old name left off');
  assert.equal(D.entryOf('PFA-SHP-1', { kind: 'PFA-SHP', status: 'new', receivedAtMs: AT(2), fields: { name: 'Meera K', mobile: '9900112233', address: 'Meera K, 4/232 Ashraya, Kundapur, Udupi, Karnataka 576222' } }).address, '4/232 Ashraya, Kundapur, Udupi, Karnataka 576222', 'a shop order\'s address loses the name it starts with');
  assert.ok(D.namesAgree('Dr. Naveen Kumar', 'naveen kumar'));
  assert.ok(!D.namesAgree('Asha Rao', 'Ravi Rao'));
  assert.equal(D.mobileOf('123'), '');
});

test('the route: its own module, the people and their counts, and a logged download of what was filtered', async () => {
  await seed();
  assert.equal((await call()).statusCode, 401);
  assert.equal((await call({ token: 'test-staff' })).statusCode, 403, 'Members and Caregivers do not carry the whole directory');
  const res = await call({ token: 'test-dir' });
  assert.equal(res.statusCode, 200, res.raw);
  assert.equal(res.json.people.length, 6, 'the site\'s own testing is not listed');
  assert.equal(counts0(res).jobapplicant, 1);
  const counts = Object.fromEntries(res.json.categories.map((c) => [c.key, c.count]));
  assert.equal(counts.member, 1);
  assert.equal(counts.donor, 1);
  assert.equal(counts.unitapplicant, 1);

  const csv = await call({ token: 'test-admin', url: '/api/admin/directory?format=csv&district=Udupi&category=member' });
  assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
  assert.match(csv.headers['content-disposition'], /attachment; filename="PFA-people-directory-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = csv.raw.replace(/^\ufeff/, '').trim().split('\r\n');
  assert.equal(lines[0], 'State,District,Name,Address,PIN code,Phone number,Other phones,Email,Date of birth,Category,Records', 'in the owner\'s order, with the date of birth (11 Nov 2026)');
  assert.equal(lines.length, 2, 'only what was filtered');
  assert.match(lines[1], /^Karnataka,Udupi,Asha Rao,/);
  assert.match(lines[1], /"Member, Volunteer"/);
  const audit = Object.entries(db.dump()).filter(([k]) => k.startsWith('adminAudit/')).map(([, v]) => v);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'directory-download');
  assert.match(audit[0].detail, /^1 person, category member, district Udupi$/);
});

test('wired into the panel, the API and the bundle', () => {
  const api = require('../api/index.js');
  assert.equal(api._private.ROUTES['admin/directory'], './admin/directory.js');
  assert.match(read('api/index.js'), /'admin\/directory': \(\) => require\('\.\.\/lib\/routes\/admin\/directory\.js'\)/);
  const M = require('../lib/admin-modules');
  assert.equal(M.MODULES.find((m) => m.key === 'directory').label, 'People directory');
  const admin = read('admin.html');
  assert.match(admin, /<button class="tab" type="button" data-tab="employees">Job applicants<\/button>\n {6}<button class="tab" type="button" data-tab="directory">People directory<\/button>/);
  assert.match(admin, /<div class="pane" data-pane="directory" role="region" aria-label="People directory"><\/div>/);
  assert.match(admin, /directory: \{ title: 'People directory', module: 'directory', needs: 'directory' \}/);
  assert.match(admin, /if \(tab === 'directory'\) return window\.PFADirectory && window\.PFADirectory\.pane\(\);/);
  assert.match(admin, /<script src="assets\/admin-directory\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-directory\.js'/);
  const js = read('assets/admin-directory.js');
  assert.match(js, /<th>State<\/th><th>District<\/th><th>Name<\/th><th>Address<\/th><th>Phone<\/th><th>Birthday<\/th><th>Category<\/th>/, 'the owner\'s order');
  assert.doesNotMatch(js + read('lib/people-directory.js') + read('lib/routes/admin/directory.js'), /[–—]/);
  assert.doesNotMatch(read('lib/people-directory.js'), /oldMembers|old-members/, 'the old website\'s members stay apart');
});

/* ---- the Map (owner, 18 Nov 2026: "can you give map view") ---------- */
test('the Map: each person at their PIN code, else their district, from India Post’s own directory', async () => {
  const PLACES = require('../lib/pin-places');
  const pin = PLACES.placeOf({ pin: '576101', state: 'Karnataka', district: 'Udupi' });
  assert.equal(pin.by, 'pin');
  assert.ok(Math.abs(pin.at[0] - 13.34) < 0.1 && Math.abs(pin.at[1] - 74.75) < 0.1, 'Udupi town is where Udupi is');
  const district = PLACES.placeOf({ state: 'Karnataka', district: 'Mysuru' });
  assert.equal(district.by, 'district', 'no PIN: the district, by the name the directory shows');
  assert.ok(Math.abs(district.at[0] - 12.3) < 0.6 && Math.abs(district.at[1] - 76.6) < 0.6);
  assert.equal(PLACES.placeOf({ name: 'Kiran S' }), null, 'nothing given, not on the map');

  await seed();
  const res = await call({ token: 'test-admin' });
  const by = Object.fromEntries(res.json.people.map((p) => [p.name, p]));
  assert.equal(by['Asha Rao'].atBy, 'pin');
  assert.equal(by['Dr. Naveen Kumar'].atBy, 'pin');
  assert.ok(!by['Kiran S'].at, 'no PIN and no district: off the map, and the panel says how many');
  const csv = await call({ token: 'test-admin', url: '/api/admin/directory?format=csv' });
  assert.ok(!/13\.3\d\d/.test(csv.raw), 'the download is unchanged: no map points in it');

  const js = read('assets/admin-directory.js');
  assert.match(js, /data-dr-view="list"/);
  assert.match(js, /data-dr-view="map"/);
  assert.match(js, /data-dr-mapshow/, 'a dot can show its people in the list');
  assert.match(js, /assets\/vendor\/leaflet\/leaflet\.js/, 'Leaflet is the site’s own copy');
  assert.ok(!/unpkg|cdnjs|jsdelivr/.test(js), 'no other site serves the map’s code');
  assert.match(js, /OpenStreetMap<\/a> contributors/, 'the map’s makers are credited');
  /* 18 Nov 2026: OpenStreetMap blocked every square, as the panel sends no
     referrer; its images, and only they, name the site */
  assert.match(js, /referrerPolicy: 'strict-origin'/);
  assert.match(read('admin.html'), /<meta name="referrer" content="no-referrer">/, 'the rest of the panel still names nothing');
  for (const f of ['leaflet.js', 'leaflet.css', 'LICENSE.txt']) assert.ok(fs.existsSync(path.join(ROOT, 'assets/vendor/leaflet', f)), f);
  const build = read('scripts/build-firebase.js');
  assert.match(build, /'assets\/vendor\/leaflet\/leaflet\.js'/, 'the Firebase panel carries it');
  for (const f of ['firebase.json', 'vercel.json']) assert.match(read(f), /img-src [^;]* https:\/\/tile\.openstreetmap\.org /, f + ' lets the map’s tiles in');
  assert.ok(fs.existsSync(path.join(ROOT, 'lib/pin-places.json.gz')));
});

/* District borders on the Map (owner, 21 Nov 2026: "can you have district
   borders in the map using https://github.com/abhatia08/india_shp_2020"). */
test('the Map draws India\'s district borders from the panel\'s own copy, kept off the public site', () => {
  const dir = path.join(ROOT, 'assets/vendor/india-districts');
  const file = path.join(dir, 'india-districts.json');
  assert.ok(fs.statSync(file).size < 1.5 * 1024 * 1024, 'small enough to fetch on a phone');
  const geo = JSON.parse(fs.readFileSync(file, 'utf8'));
  const districts = geo.features.filter((f) => f.properties && f.properties.d);
  const states = geo.features.filter((f) => f.properties && f.properties.k === 'state');
  assert.equal(districts.length, 735, 'every district of the 2020 layer');
  assert.ok(states.length > 0, 'and the state lines');
  districts.forEach((f) => {
    assert.match(f.geometry.type, /^(Multi)?Polygon$/);
    assert.doesNotMatch(f.properties.d, /\*|&/, `a name in full: ${f.properties.d}`);
    assert.ok(f.properties.s, `${f.properties.d} has its state`);
  });
  for (const f of ['SOURCE.txt', 'LICENSE.txt']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  const js = fs.readFileSync(path.join(ROOT, 'assets/admin-directory.js'), 'utf8');
  assert.match(js, /assets\/vendor\/india-districts\/india-districts\.json/, 'the map fetches it');
  assert.match(js, /createPane\('drBorders'\)\.style\.zIndex = 350/, 'under the dots, which stay clickable');
  const build = fs.readFileSync(path.join(ROOT, 'scripts/build-firebase.js'), 'utf8');
  assert.match(build, /'assets\/vendor\/india-districts\/india-districts\.json'/, 'the Firebase panel carries it');
  assert.match(fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8'), /^\/assets\/vendor\/india-districts$/m, 'the public site does not');
});
