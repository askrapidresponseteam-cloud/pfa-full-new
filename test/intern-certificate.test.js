'use strict';

/* The internship certificate, issued and emailed by itself when the work is
   complete (owner, 11 Nov 2026: "once one completes, this is automatically
   sent with the person's name. and this should be like one of those
   coursera certs that can be seen live online in a url"), and the page that
   shows it online (certificate.html). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const I = require('../lib/internship');
const S = require('../lib/intern-store');
const C = require('../lib/intern-certificate');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const INTERN = 'PFA-IN-ABCDEF';
const NOW = Date.parse('2026-11-01T10:30:00.000Z'); /* 1 November 2026, 4 pm in India */
let db; let sent; let audits; let deps;

function setUp({ accepted = 7, status = 'active', approvedAt = '2026-09-10T05:00:00.000Z' } = {}) {
  db = memoryFirestore();
  sent = []; audits = [];
  const plan = I.defaultPlan();
  db.collection('intern_batches').doc('B1').set(Object.assign({ batchId: 'B1', name: 'September 2026', startDate: '2026-09-07', status: 'open' }, plan));
  db.collection('interns').doc(INTERN).set({ internId: INTERN, name: '  asha   rao ', email: 'Asha@Example.com', batchId: 'B1', status, approvedAt });
  plan.tasks.forEach((t, k) => {
    db.collection('intern_work').doc(S.workId(INTERN, t.key)).set({ internId: INTERN, batchId: 'B1', taskKey: t.key, state: k < accepted ? 'accepted' : 'submitted', score: k < accepted ? 8 : null, history: [] });
  });
  let n = 0;
  deps = {
    queue: {
      queueEmail: async (m) => { n += 1; sent.push(m); return { created: true, emailId: `e${n}`, claimToken: 't' }; },
      recordEmailResult: async () => {}
    },
    mail: { isConfigured: () => true, deliver: async () => ({ providerId: 'p' }) },
    audit: { record: async (who, e) => { audits.push(Object.assign({ who }, e)); } }
  };
  return plan;
}
const lastKey = (plan) => plan.tasks[plan.tasks.length - 1].key;
const certs = () => Object.entries(db.dump()).filter(([k]) => k.startsWith('certificates/')).map(([, v]) => v);

test('the last task accepted issues the certificate, with the name, the dates and a number, once', async () => {
  const plan = setUp();
  await S.review(db, { internId: INTERN, taskKey: lastKey(plan), decision: 'accept', score: 9 }, { email: 'priya@pfa.test' }, NOW, deps);
  const all = certs();
  assert.equal(all.length, 1);
  const c = all[0];
  assert.match(c.number, C.NUMBER);
  assert.equal(c.name, 'Asha Rao', 'the name as given, tidied');
  assert.equal(c.email, 'asha@example.com');
  assert.equal(c.startDate, '2026-09-10', 'from the day they were approved, later than the batch began');
  assert.equal(c.endDate, '2026-11-01', 'to the day it was completed, in India');
  assert.equal(c.issuedOn, '2026-11-01');
  assert.equal(c.kind, 'internship');
  assert.equal(c.internId, INTERN);
  assert.equal(c.auto, true);
  assert.equal(c.revoked, false);
  assert.equal(c.issuedBy.name, 'Automatic, on completion');
  assert.equal(db.dump()[`interns/${INTERN}`].certificateNumber, c.number, 'marked on the intern');

  /* emailed, with the certificate online */
  const letter = sent.find((m) => m.template === 'internship_certificate');
  assert.ok(letter, 'the certificate email');
  assert.equal(letter.to, 'asha@example.com');
  assert.equal(letter.payload.certificateUrl, `https://peopleforanimalsindia.org/certificate?n=${c.number}`);
  assert.equal(letter.payload.attached, false, 'no PDF: it is online');
  assert.equal(letter.payload.name, 'Asha Rao');
  assert.deepEqual(db.dump()[`certificates/${c.number}`].sends.map((s) => [s.to, s.state]), [['asha@example.com', 'sent']]);
  assert.ok(audits.some((a) => a.action === 'certificate-issued' && a.subject === c.number && /automatically/.test(a.detail)));
  assert.ok(audits.some((a) => a.action === 'certificate-emailed' && a.subject === c.number));

  /* the email, as it reads */
  const m = require('../lib/caregiver-mail').render('internship_certificate', letter.payload);
  assert.match(m.html, /See your certificate/);
  assert.ok(m.html.includes(letter.payload.certificateUrl));
  assert.match(m.text, /Your certificate is ready\./);
  assert.doesNotMatch(m.text + m.html, /attached as a PDF/);
  assert.doesNotMatch(m.text + m.html, /[–—]/);

  /* a later review, or the same one again, issues nothing more */
  await S.review(db, { internId: INTERN, taskKey: plan.tasks[0].key, decision: 'accept', score: 10 }, { email: 'priya@pfa.test' }, NOW + 3600000, deps);
  assert.equal(certs().length, 1);
  assert.equal(sent.filter((x) => x.template === 'internship_certificate').length, 1);
});

test('two acceptances at the same moment still make one certificate', async () => {
  setUp({ accepted: 8 });
  const [a, b] = await Promise.all([C.issueIfComplete(db, INTERN, NOW, deps), C.issueIfComplete(db, INTERN, NOW, deps)]);
  assert.equal(certs().length, 1);
  assert.equal([a, b].filter((r) => r.issued).length, 1);
});

test('nothing is issued while any task is still open, for a withdrawn intern, or on a revision', async () => {
  let plan = setUp({ accepted: 6 });
  await S.review(db, { internId: INTERN, taskKey: plan.tasks[6].key, decision: 'accept', score: 9 }, { email: 'priya@pfa.test' }, NOW, deps);
  assert.equal(certs().length, 0, 'seven of eight');
  plan = setUp({ accepted: 7, status: 'revoked' });
  assert.equal((await C.issueIfComplete(db, INTERN, NOW, deps)).issued, false);
  assert.equal(certs().length, 0);
  plan = setUp({ accepted: 7 });
  await S.review(db, { internId: INTERN, taskKey: lastKey(plan), decision: 'revise', feedback: 'One more photograph, please.' }, { email: 'priya@pfa.test' }, NOW, deps);
  assert.equal(certs().length, 0);
});

test('it never fails the review that called it', async () => {
  const plan = setUp();
  deps.audit = { record: async () => { throw new Error('audit down'); } };
  const w = await S.review(db, { internId: INTERN, taskKey: lastKey(plan), decision: 'accept', score: 9 }, { email: 'priya@pfa.test' }, NOW, deps);
  assert.equal(w.state, 'accepted');
});

test('the law quiz passed last issues it too', () => {
  assert.match(read('lib/intern-quiz.js'), /if \(pass\) await require\('\.\/intern-certificate'\)\.issueIfComplete\(db, intern\.internId, nowMs, Object\.assign\(\{ store: S \}, deps\)\);/);
  assert.match(read('lib/intern-store.js'), /if \(state === 'accepted'\) await require\('\.\/intern-certificate'\)\.issueIfComplete\(db, internId, nowMs, Object\.assign\(\{ store: module\.exports \}, deps\)\);/);
});

/* ---- the certificate online --------------------------------------------- */

test('the certificate online: drawn from the record, verified, downloadable, shareable', () => {
  const html = read('certificate.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'a person\'s certificate is not for search engines');
  assert.match(html, /fetch\('\/api\/verify-certificate\?n=' \+ encodeURIComponent\(n\)/, 'what PFA issued, never what the address says');
  assert.match(html, /<script src="assets\/certificate\.js"><\/script>/);
  assert.match(html, /C\.draw\(canvas, record, scale\)/);
  for (const id of ['cvPdf', 'cvCopy', 'cvLinkedIn']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /https:\/\/www\.linkedin\.com\/profile\/add\?startTask=CERTIFICATION_NAME/);
  assert.match(html, /if \(d\.withdrawn\) \{ lost\('People for Animals withdrew this certificate'/, 'a withdrawn one is not drawn');
  assert.match(html, /<details class="cv-more" id="cvMore" hidden>\s*<summary>About this certificate<\/summary>/, 'the details under a +');
  assert.match(html, /\.cv-acts\[hidden\],\.cv-cert\[hidden\],\.cv-more\[hidden\],\.cv-other\[hidden\]\{display:none\}/);
  assert.doesNotMatch(html.replace(/<script id="pfa-vis">[\s\S]*?<\/script>/, ''), /[–—]/, 'no long dash');
  /* kept out of search, the sitemap and the SEO pages */
  assert.ok(require('../scripts/build-search-index').EXCLUDE.has('certificate.html'));
  assert.doesNotMatch(read('sitemap.xml'), /\/certificate</);
  /* the check page opens it */
  assert.match(read('verify-certificate.html'), /<a href="certificate\.html\?n=' \+ encodeURIComponent\(d\.number\) \+ '">See the certificate<\/a>/);
  assert.equal((read('intern.html').match(/<a href="certificate\.html\?n=' \+ encodeURIComponent\(data\.intern\.certificateNumber\) \+ '">See your certificate<\/a>/g) || []).length, 2, 'the intern\'s dashboard, once issued');
  /* and the panel lists it */
  assert.match(read('admin.html'), /r\.certificateUrl \? ' \\u00b7 <a class="linky" href="' \+ esc\(r\.certificateUrl\) \+ '" target="_blank" rel="noopener">Online<\/a>'/);
});

test('the design is the owner\'s, in Marcellus, its fields where the design puts them', () => {
  const js = read('assets/certificate.js');
  assert.match(js, /var ART = ROOT \+ 'assets\/certificates\/completion\.webp';/);
  assert.match(js, /var W = 1120;\n {2}var H = 792;/, 'A4 landscape, the design\'s own size');
  assert.match(js, /var FONTS = \[\n {4}\['Marcellus', ROOT \+ 'fonts\/marcellus-latin\.woff2', '400'\]\n {2}\];/, 'Marcellus only (owner: "font has to be marcellus")');
  assert.doesNotMatch(js, /Cinzel|Garamond/);
  assert.match(js, /var AT = \{ name: \{ x: 560, y: 420\.16, max: 900 \}, date: \{ x: 66, y: 649\.7 \}, number: \{ x: 66, y: 697\.7 \} \};/);
  assert.match(js, /var margin = 0;/, 'the PDF is the certificate, edge to edge');
  assert.match(read('scripts/build-certificate-art.js'), /\.rule:before,\.rule:after/, 'the art is made from the design, its dash-shaped rules taken out');
});
