'use strict';

/* The panel by people, and its search (owner, 3 Nov 2026: "admin should have
   sections like members, [caregivers], interns, employees etc..not like
   membership cards etc..and the search should work like google grade").

   Through the real search route and index, against the strict in-memory
   Firestore: a member found by their number however it is typed, by their
   name with a letter wrong, and ranked first when it is their name; results
   in groups by who someone is; interns and shelters found too; and the
   panel's sections named by people. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./_review-recheck-harness');

const SEARCH = require('../lib/admin-search');
const ROUTE = () => require('../lib/routes/admin/search');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let W;
test.beforeEach(() => { W = H.fresh({ latency: 0 }); SEARCH._reset(); ROUTE()._private.resetPeople(); });
test.afterEach(() => { W.restore(); });

const find = async (q, token = 'tok-a') => {
  const res = await H.call(ROUTE(), { method: 'GET', query: { q }, token });
  assert.equal(res.statusCode, 200, res.raw);
  return res.json;
};

async function world(db) {
  const at = (iso) => Date.parse(iso);
  await H.seed(db, 'PFA-MEM-2026-00012', { kind: 'PFA-MEM', kindLabel: 'Membership', status: 'new', receivedAtMs: at('2026-11-01T05:00:00Z'), fields: { name: 'Prithpal Singh', mobile: '9811122233', email: 'prithpal@example.com', state: 'Karnataka', tier: 'Annual' }, memberNo: { label: 'KA 2036', code: 'KA', n: 2036, series: 'KA', state: 'Karnataka' }, memberNoBefore: ['KA 1'] });
  await H.seed(db, 'PFA-MEM-2026-00013', { kind: 'PFA-MEM', kindLabel: 'Membership', status: 'new', receivedAtMs: at('2026-11-02T05:00:00Z'), fields: { name: 'Singh Traders welfare fund', mobile: '9811122299', email: 'fund@example.com', state: 'Karnataka' }, memberNo: { label: 'KA 2037', code: 'KA', n: 2037, series: 'KA', state: 'Karnataka' } });
  await H.seed(db, 'PFA-CG-2026-00011', { kind: 'PFA-CG', kindLabel: 'Colony caregiver application', status: 'approved', receivedAtMs: at('2026-10-28T05:00:00Z'), cardId: 'PFA-CCT-4K2M8QRT', fields: { name: 'Ashokkumar S', mobile: '9655971757', state: 'Tamil Nadu', city: 'Coimbatore' }, caregiverNo: { label: 'TN 2074', code: 'TN', n: 2074, series: 'TN', state: 'Tamil Nadu' } });
  await H.seed(db, 'PFA-J-2026-00004', { kind: 'PFA-J', kindLabel: 'Job application', status: 'new', receivedAtMs: at('2026-10-20T05:00:00Z'), fields: { name: 'Meera Nair', mobile: '9900011122', email: 'meera@example.com', roleId: 'veterinary-team', background: 'BVSc, three years in a small-animal clinic' } });
  await H.seed(db, 'PFA-C-2026-00030', { kind: 'PFA-C', kindLabel: 'Cruelty report', status: 'new', receivedAtMs: at('2026-11-03T05:00:00Z'), fields: { what: 'Prithpal Singh saw a dog tied on a roof', name: 'Ravi', mobile: '9000000001' } });
}

test('a member by their number, however it is typed; by name with a letter wrong; their name ranked first', async () => {
  await world(W.db);
  for (const q of ['KA 2036', 'ka2036', 'KA-2036', '2036']) {
    const out = await find(q);
    assert.equal(out.results[0] && out.results[0].id, 'PFA-MEM-2026-00012', q);
    assert.equal(out.results[0].group, 'member');
    assert.equal(out.results[0].title, 'Prithpal Singh', 'shown by name');
    assert.match(out.results[0].line, /^Member KA 2036 · PFA-MEM-2026-00012$/);
  }
  assert.equal((await find('KA 1')).results.filter((r) => r.id === 'PFA-MEM-2026-00012').length, 1, 'the short number it had before still finds it');
  /* the person whose name it is, before a report that mentions the name, and before a name that only contains a word of it */
  const byName = await find('prithpal singh');
  assert.equal(byName.results[0].id, 'PFA-MEM-2026-00012');
  assert.ok(byName.results.findIndex((r) => r.id === 'PFA-C-2026-00030') > 0);
  /* a letter wrong */
  const typo = await find('prithpl');
  assert.equal(typo.results[0] && typo.results[0].id, 'PFA-MEM-2026-00012');
  assert.equal(typo.near, true);
  /* a caregiver by their number; a job applicant as an employee */
  const cg = await find('TN 2074');
  assert.equal(cg.results[0].id, 'PFA-CG-2026-00011');
  assert.equal(cg.results[0].group, 'caregiver');
  assert.match(cg.results[0].line, /^Caregiver TN 2074 · PFA-CG-2026-00011$/);
  const job = await find('meera');
  assert.equal(job.results[0].group, 'jobapplicant', 'an applicant, not an employee');
  assert.equal(job.results[0].title, 'Meera Nair');
  /* a mobile typed with spaces and +91 */
  assert.equal((await find('+91 98111 22233')).results[0].id, 'PFA-MEM-2026-00012');
});

test('interns and shelters are found too, by name, ID, phone or place, a letter off forgiven', async () => {
  const VIEW = require('../lib/intern-admin-view');
  const SH = require('../lib/intern-shelters');
  const realReg = VIEW.register; const realList = SH.list;
  VIEW.register = async () => [{ internId: 'PFA-IN-2EQCC3', name: 'Asha Rao', email: 'asha@example.com', mobile: '9000000001', batch: 'November 2026', status: 'active', place: { name: 'Karuna Animal Shelter' }, createdAt: '2026-11-09T05:00:00Z' }];
  /* the shape the directory really returns: { rows, counts } */
  SH.list = async () => ({ counts: { all: 1, new: 1 }, rows: [{ shelterId: 'SH-9F2K7QX4M', name: 'Karuna Animal Shelter', contact: 'Ravi Shetty', phone: '9845012345', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576102', status: 'new', interns: [{ name: 'Asha Rao', internId: 'PFA-IN-2EQCC3' }], updatedAt: '2026-11-09T05:00:00Z' }] });
  try {
    const intern = await find('asha rao');
    const hit = intern.results.find((r) => r.type === 'intern');
    assert.ok(hit, JSON.stringify(intern.results));
    assert.equal(hit.group, 'intern');
    assert.match(hit.line, /^Intern PFA-IN-2EQCC3 · November 2026 · Karuna Animal Shelter$/);
    assert.equal((await find('PFA-IN-2EQCC3')).results[0].type, 'intern');
    const shelter = await find('karuna udupi');
    assert.equal(shelter.results.find((r) => r.type === 'shelter').id, 'SH-9F2K7QX4M');
    assert.ok((await find('9845012345')).results.some((r) => r.type === 'shelter'));
    assert.ok((await find('karuns')).results.some((r) => r.type === 'shelter'), 'a letter off');
    /* not for someone without the internship */
    const desk = await find('asha rao', 'tok-desk');
    assert.ok(!desk.results.some((r) => r.type === 'intern' || r.type === 'shelter'));
  } finally { VIEW.register = realReg; SH.list = realList; }
});

test('the panel by people: Members, Caregivers, Volunteers, Internship, Job applicants; results grouped the same way', () => {
  const html = read('admin.html');
  assert.match(html, /<div class="pane" data-pane="employees" role="region" aria-label="Job applicants"><\/div>/);
  assert.match(html, /data-tab="employees">Job applicants<\/button>/);
  assert.match(html, /data-tab="internship">Internship</);
  assert.doesNotMatch(html, />Employees</, 'nobody who only applied is called an employee');
  assert.match(html, /if \(tab === 'employees'\) return window\.PFAPeople && window\.PFAPeople\.pane\(\);/);
  assert.match(html, /\(\(window\.PFAPeople && window\.PFAPeople\.groups\) \|\| GS_GROUPS\)\.forEach/);
  assert.match(html, /var rows = all\.filter\(function \(r\) \{ return \(r\.group \|\| r\.type\) === g\[0\]; \}\);/);
  assert.match(html, /if \(window\.PFAPeople && window\.PFAPeople\.open\(r\)\) return undefined;/);
  assert.match(html, /<script src="assets\/admin-people\.js"><\/script>/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-people\.js'/);
  const js = read('assets/admin-people.js');
  assert.match(js, /\[\['member', 'Members'\], \['caregiver', 'Caregivers'\], \['intern', 'Interns'\], \['volunteer', 'Volunteers'\], \['internapplicant', 'Internship applicants'\], \['jobapplicant', 'Job applicants'\], \['shelter', 'Shelters'\],/);
  assert.match(js, /\/api\/admin\/records\?type=submissions&kind=PFA-J&limit=100/);
  assert.match(js, /a\.download = 'pfa-job-applicants-'/);
  const M = require('../lib/admin-modules');
  assert.ok(M.MODULE_KEYS.includes('employees'), 'staff can be given Job applicants on its own');
  assert.equal(M.MODULES.find((m) => m.key === 'employees').label, 'Job applicants');
  assert.equal(M.MODULES.find((m) => m.key === 'membership').label, 'Members');
  assert.equal(M.MODULES.find((m) => m.key === 'caregivers').label, 'Caregivers');
  assert.equal(M.MODULES.find((m) => m.key === 'internship').label, 'Internship');
});

test('an applicant is not one of PFA\u2019s people yet: internship and job applications are applicants; only an intern with an ID is an intern', async () => {
  await H.seed(W.db, 'PFA-VI-2026-00009', { kind: 'PFA-VI', kindLabel: 'Remote internship application', status: 'new', receivedAtMs: Date.parse('2026-11-01T05:00:00Z'), fields: { name: 'Kavya Menon', mobile: '9876500011', email: 'kavya@example.com' } });
  const out = await find('kavya');
  assert.equal(out.results[0].group, 'internapplicant');
  assert.match(out.results[0].line, /^Remote internship application · PFA-VI-2026-00009$/);
});
