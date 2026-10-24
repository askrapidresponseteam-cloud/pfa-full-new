'use strict';

/* The application for a new PFA unit, on the units page (owner, 22 Oct 2026):
   "there should be an option to download this form. fill it in and send it to
   gandhim. and there should be a ditto digital version, which on submission
   should go to gandhim eail email ID.. it should be within PFA units page".

   Held here, end to end:
     1. the page offers both ways: the PDF, served from this site (the old
        link pointed at PFA's old site, which this site replaces at that
        address), with the address to email it to; and Apply online;
     2. the online form is the paper form: the same fields, closed until asked
        for, one screen at a time;
     3. the page's own script, booted with the real pfa-forms.js, refuses a
        screen until it is right and sends the application as the paper reads;
     4. what it sent goes through the real intake route: filed for the admin
        panel, and one copy to gandhim, Reply-To the applicant, every board
        member, case and rescue on its own line, the photograph attached;
     5. this kind may send six photographs, every other kind three. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const S = require('../lib/submissions');
const FIELDS = require('../lib/submission-fields');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INBOX = 'gandhim@exmpls.sansad.in';
const SENDER = 'tester.pfa@example.com';
const JPEG = fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg'));
const PHOTO = 'data:image/jpeg;base64,' + JPEG.toString('base64');

/* ---- the page ------------------------------------------------------------- */

test('the units page offers the paper form to download and the address to send it to', () => {
  const doc = new JSDOM(read('units.html')).window.document;
  const ways = doc.querySelector('#setup #apply-ways');
  assert.ok(ways, 'the two ways sit in the setup section');
  const pdf = ways.querySelector('a[download][href$=".pdf"]');
  assert.ok(pdf, 'a download link to the PDF');
  const file = path.join(ROOT, decodeURIComponent(pdf.getAttribute('href')));
  assert.ok(fs.existsSync(file), `${pdf.getAttribute('href')} is in the tree`);
  assert.equal(fs.readFileSync(file).subarray(0, 5).toString('latin1'), '%PDF-', 'and it is a PDF');
  assert.match(fs.readFileSync(file).toString('latin1'), /Application form for approval for new PFA Unit/, 'the form the owner supplied');
  assert.ok(ways.querySelector('a[href^="mailto:gandhim@exmpls.sansad.in"]'), 'it says where to email it');
  assert.ok(ways.querySelector('a[href="#apply"]'), 'and offers the online form');
  assert.doesNotMatch(read('units.html'), /public\/front\/file\/PFA_unit\.pdf/, 'not the old site\'s copy, which this site replaces at that address');
  assert.ok(doc.querySelector('main .u-hero a[href="#setup"]'), 'the hero points at it, so nobody has to scroll past eighty units to find it');
});

test('the online form is the paper form: closed until asked for, a screen at a time', () => {
  const doc = new JSDOM(read('units.html')).window.document;
  const flow = doc.getElementById('apply');
  assert.ok(flow.hasAttribute('data-flow'), 'closed until Apply online asks for it');
  assert.equal(flow.getAttribute('data-flow-back'), 'Units');
  const form = flow.querySelector('form#unitForm');
  assert.ok(form);
  assert.deepEqual([...form.querySelectorAll('.pfa-steps__tabs li')].map((li) => li.textContent.replace(/^\d+/, '').trim()),
    [...form.querySelectorAll('.u-step')].map((s) => s.getAttribute('data-step')), 'a tab for every step');
  for (const id of ['uaName', 'uaMobile', 'uaPhone2', 'uaEmail']) assert.ok(doc.getElementById(id), id);
  /* the applicant's address is the block every form carries (24 Oct 2026) */
  const block = form.querySelector('[data-screen="you"] fieldset[data-address][data-kind="PFA-U"]');
  assert.ok(block, 'the applicant\'s address block');
  assert.equal(block.getAttribute('data-legend'), 'Address of the applicant');
  assert.ok(form.hasAttribute('data-address-own'), 'checked with the screen\'s own boxes');
  /* seven board members: name, address, phone, email, age, profession */
  const members = form.querySelectorAll('[data-screen="member"]');
  assert.equal(members.length, 7);
  for (const m of members) {
    for (const part of ['Name', 'Addr', 'Phone', 'Age', 'Prof']) {
      assert.ok(m.querySelector(`#m${m.getAttribute('data-n')}${part}[required]`), `member ${m.getAttribute('data-n')}: ${part} is asked for`);
    }
    assert.ok(m.querySelector(`#m${m.getAttribute('data-n')}Email[type="email"]`));
  }
  assert.match(form.textContent, /one of them an advocate/i);
  /* A: five cases; B: the rescue work, the first required, the rest optional */
  const cases = form.querySelectorAll('[data-screen="case"][data-when="A"]');
  assert.equal(cases.length, 5);
  const rescues = [...form.querySelectorAll('[data-screen="rescue"][data-when="B"]')];
  assert.equal(rescues.length, 5);
  assert.deepEqual(rescues.map((r) => r.hasAttribute('data-optional')), [false, true, true, true, true]);
  /* the undertaking, word for word */
  const oath = doc.getElementById('uaOath').textContent.replace(/\s+/g, ' ');
  for (const line of ['I shall be the member in-charge for the Unit', 'I shall make at least 100 members of People for Animals',
    'I shall strive to rescue and rehabilitate all kinds of animals that may be in distress',
    'www.peopleforanimalsindia.org or through any other means of communication',
    'all 7 members of the proposed Board to be available for a training session to be conducted at New Delhi, within 6 months']) {
    assert.ok(oath.includes(line), `the undertaking says "${line}"`);
  }
  /* a way to reach PFA at every stage comes from the flow's bar (assets/chrome.js) */
  assert.match(read('assets/chrome.js'), /<span class="pfa-flow-bar__q">Need help\? <\/span><b>Contact PFA<\/b>/);
});

/* ---- the page's script, booted ------------------------------------------- */

function boot() {
  const html = read('units.html');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://pfa.test/units.html', virtualConsole });
  const w = dom.window;
  const posted = [];
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.PFA_CHROME = { recolourCursor() {}, measure() {} };
  /* the network: the intake answers with a number, everything else is empty */
  w.fetch = (url, init) => {
    if (String(url) === '/api/pfa-submissions') {
      posted.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, reference: 'PFA-U-2026-00042', confirmation: { state: 'sent', to: SENDER, title: 'Check your email.', lines: [] } }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  };
  w.eval(read('assets/field-rules.js'));
  w.eval(read('assets/field-validate.js'));
  w.eval(read('assets/india-districts.js'));
  w.eval(read('assets/address.js'));
  w.eval(read('pfa-forms.js'));
  /* a canvas is not drawn here; the photograph arrives already shrunk */
  w.PFAForms.shrink = () => Promise.resolve(PHOTO);
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(m[1])) continue;
    const type = (m[1].match(/type\s*=\s*["']([^"']+)["']/) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue;
    if (!/unitForm/.test(m[2])) continue;   // the application's own script, not the list's
    try { w.eval(m[2]); } catch (error) { errors.push(`inline script: ${error.message}`); }
  }
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  w.PFAAddress.mountAll();
  const doc = w.document;
  const page = {
    w, doc, errors, posted,
    type(id, value) {
      const el = doc.getElementById(id);
      assert.ok(el, `no #${id}`);
      el.value = value;
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
      el.dispatchEvent(new w.Event('blur', { bubbles: false }));
    },
    pick(id) {
      const el = doc.getElementById(id);
      el.checked = true;
      el.dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    /* a box of the address block, typed or chosen as a person does */
    address(key, value) {
      const el = doc.querySelector(`#unitForm [data-address] [data-addr="${key}"]`);
      assert.ok(el, `no address box for ${key}`);
      el.value = value;
      el.dispatchEvent(new w.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      el.dispatchEvent(new w.Event('blur', { bubbles: false }));
    },
    next() { doc.querySelector('#unitForm [data-next]').click(); },
    back() { doc.querySelector('#unitForm [data-back]').click(); },
    on() { const s = doc.querySelector('#unitForm .u-screen.is-on'); return s.getAttribute('data-screen') + (s.getAttribute('data-n') || ''); },
    bad() { return [...doc.querySelectorAll('#unitForm .u-screen.is-on .is-bad')].length; }
  };
  return page;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function fillYou(page) {
  page.type('uaName', 'asha rao');
  page.address('address', '12 main road, koteshwara');
  page.address('state', 'Karnataka');
  page.address('district', 'Udupi');
  page.address('city', 'kundapur');
  page.address('pincode', '576222');
  page.type('uaMobile', '+91 98765 43210');
  page.type('uaPhone2', '0820 252 0000');
  page.type('uaEmail', SENDER);
}
function fillMember(page, n, profession) {
  page.type(`m${n}Name`, `Member ${n}`);
  page.type(`m${n}Addr`, `${n} Temple Street, Udupi`);
  page.type(`m${n}Phone`, `984501000${n}`);
  if (n === 1) page.type(`m${n}Email`, 'member1@example.com');
  page.type(`m${n}Age`, String(30 + n));
  page.type(`m${n}Prof`, profession);
}

let filled = null;

test('the page checks each screen, and sends the application as the paper reads', async () => {
  const page = boot();
  assert.deepEqual(page.errors, [], 'the page threw while booting');
  assert.equal(page.on(), 'you');

  /* nothing typed: it stays, and says what is missing */
  page.next();
  assert.equal(page.on(), 'you');
  assert.ok(page.bad() >= 8, 'every required box is marked, the five of the address among them');
  fillYou(page);
  /* a PIN that cannot be in the state keeps it here */
  page.address('pincode', '700016');
  page.next();
  assert.equal(page.on(), 'you');
  assert.match(page.doc.querySelector('#unitForm [data-addr="pincode"]').closest('.field').querySelector('.err').textContent, /in West Bengal, not Karnataka/);
  page.address('pincode', '576222');
  assert.equal(page.doc.getElementById('uaMobile').value, '9876543210', 'the shared rules tidy the mobile');
  page.next();
  assert.equal(page.on(), 'member1');

  /* an age under 18 is refused */
  fillMember(page, 1, 'Farmer');
  page.type('m1Age', '15');
  page.next();
  assert.equal(page.on(), 'member1');
  page.type('m1Age', '41');
  page.next();
  for (let n = 2; n <= 7; n++) { fillMember(page, n, n === 6 ? 'Teacher' : 'Farmer'); page.next(); }
  /* no advocate among the seven: it stops on the seventh and says so */
  assert.equal(page.on(), 'member7');
  assert.equal(page.doc.getElementById('uaAdvocate').hidden, false);
  page.back(); page.back();
  assert.equal(page.on(), 'member5');
  page.type('m5Prof', 'Advocate');
  page.next(); page.next(); page.next();
  assert.equal(page.on(), 'criteria');

  /* A or B must be chosen; both brings the cases, then the rescues */
  page.next();
  assert.equal(page.on(), 'criteria');
  page.pick('uaCritAB');
  page.next();
  for (let n = 1; n <= 5; n++) {
    assert.equal(page.on(), `case${n}`);
    page.type(`c${n}No`, `${100 + n}/2025`);
    page.type(`c${n}Ps`, 'Kundapur Town');
    page.type(`c${n}Date`, `2025-0${n}-1${n}`);
    page.next();
  }
  assert.equal(page.on(), 'rescue1');
  page.next();
  assert.equal(page.on(), 'rescue1', 'the first rescue is required');
  page.type('r1Animal', 'Dog');
  page.type('r1Date', '2026-01-03');
  page.type('r1Problem', 'Hit by a bus near the market, leg fractured');
  page.type('r1Action', 'Taken to the vet, treated, and released where she lives');
  page.next();
  assert.equal(page.on(), 'rescue2');
  /* half a rescue is not a rescue */
  page.type('r2Animal', 'Cow');
  page.next();
  assert.equal(page.on(), 'rescue2');
  page.type('r2Date', '2026-02-10');
  page.type('r2Problem', 'Plastic in the stomach');
  page.type('r2Action', 'Operated on by the vet; recovered at the gaushala');
  page.next();
  /* a blank optional rescue ends the list */
  assert.equal(page.on(), 'rescue3');
  page.next();
  assert.equal(page.on(), 'undertaking');
  assert.equal(page.doc.getElementById('uaUnitPlace').value, 'Kundapur', 'the applicant\'s town is offered for the unit');

  page.pick('uaSalMs');
  page.doc.getElementById('uaRelation').value = 'Daughter of';
  page.type('uaRelName', 'Ramesh Rao');
  page.type('uaWork', 'Teacher');
  page.next();
  assert.equal(page.on(), 'sign');
  assert.match(page.doc.getElementById('uaOathLead').textContent,
    /^I, Ms\. Asha Rao, daughter of Ramesh Rao, resident of 12 Main Road, Koteshwara, Kundapur, Udupi district, Karnataka 576222, and presently working as Teacher, am desirous of forming a Unit of PFA in Kundapur, District Udupi\.$/);
  /* not agreed, not signed; then signed with a different name */
  page.next();
  assert.equal(page.on(), 'sign');
  page.pick('uaAgree');
  page.type('uaSign', 'Someone Else');
  page.next();
  assert.equal(page.on(), 'sign');
  assert.match(page.doc.getElementById('uaSignErr').textContent, /Asha Rao/);
  page.type('uaSign', 'Asha Rao');
  page.next();
  assert.equal(page.on(), 'send');

  /* a photograph, then a PDF, which is turned away with where to send it */
  const input = page.doc.getElementById('uaPhotos');
  Object.defineProperty(input, 'files', { configurable: true, value: [new page.w.File(['x'], 'proof.jpg', { type: 'image/jpeg' }), new page.w.File(['%PDF'], 'case.pdf', { type: 'application/pdf' })] });
  input.dispatchEvent(new page.w.Event('change', { bubbles: true }));
  await settle();
  assert.equal(page.doc.querySelectorAll('#uaFiles li').length, 1);
  assert.match(page.doc.getElementById('uaFilesErr').textContent, /replying to the confirmation email/);

  page.doc.getElementById('unitForm').dispatchEvent(new page.w.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(page.posted.length, 1, 'the application was sent');
  const body = page.posted[0];
  assert.equal(body.kind, 'PFA-U');
  assert.equal(body.page, 'units.html');
  assert.equal(body.photos.length, 1, 'with its photograph');
  const data = body.data;
  assert.ok(Object.keys(data).length <= 40, 'under the intake\'s forty fields');
  assert.equal(data.name, 'Asha Rao');
  assert.equal(data.mobile, '9876543210');
  assert.equal(data.unitPlace, 'Kundapur');
  assert.deepEqual([data.address, data.pincode, data.city, data.state, data.district],
    ['12 Main Road, Koteshwara', '576222', 'Kundapur', 'Karnataka', 'Udupi'], 'the applicant\'s address, whole');
  assert.equal(data.member1, 'Member 1, age 41, Farmer · Address: 1 Temple Street, Udupi · Phone: 9845010001 · Email: member1@example.com');
  assert.equal(data.member5.split(' · ')[0], 'Member 5, age 35, Advocate');
  assert.equal(data.criteria, 'Both A and B');
  assert.equal(data.case3, 'Case number: 103/2025 · Police station: Kundapur Town · Date: 13 March 2025');
  assert.equal(data.rescue2, 'Animal: Cow · Nature of the problem: Plastic in the stomach · Date: 10 February 2026 · Action taken: Operated on by the vet; recovered at the gaushala');
  assert.equal(data.rescue3, undefined, 'a blank rescue is not sent');
  assert.equal(data.salutation, 'Ms.');
  assert.equal(data.relation, 'Daughter of Ramesh Rao');
  assert.match(data.undertaking, /am desirous of forming a Unit of PFA in Kundapur, District Udupi\. I agree to this undertaking\.$/);
  assert.equal(data.signature, 'Asha Rao');
  assert.deepEqual(FIELDS.validate('PFA-U', data).errors, [], 'the server\'s own rules take what the page sent');
  for (const value of Object.values(data)) assert.doesNotMatch(String(value), /[–—]/, 'no long dashes');

  /* sent: the number the server gave, and how to send the rest */
  assert.equal(page.doc.getElementById('unitForm').hidden, true);
  assert.equal(page.doc.getElementById('uaDone').hidden, false);
  assert.equal(page.doc.getElementById('uaRef').textContent, 'PFA-U-2026-00042');
  assert.equal(page.doc.getElementById('uaTrack').getAttribute('href'), 'track.html#ref=PFA-U-2026-00042');
  filled = body;
});

test('criterion B alone skips the cases, and A alone the rescues', () => {
  const page = boot();
  fillYou(page);
  page.next();
  for (let n = 1; n <= 7; n++) { fillMember(page, n, n === 2 ? 'Lawyer' : 'Farmer'); page.next(); }
  assert.equal(page.on(), 'criteria');
  page.pick('uaCritB');
  page.next();
  assert.equal(page.on(), 'rescue1');
  page.back();
  page.pick('uaCritA');
  page.next();
  assert.equal(page.on(), 'case1');
  for (let n = 1; n <= 5; n++) {
    page.type(`c${n}No`, `${n}/2025`); page.type(`c${n}Ps`, 'Udupi Town'); page.type(`c${n}Date`, '2025-06-01');
    page.next();
  }
  assert.equal(page.on(), 'undertaking', 'no rescue screens under A');
  /* a date in the future is refused */
  page.back();
  page.type('c5Date', '2999-01-01');
  page.next();
  assert.equal(page.on(), 'case5');
});

/* ---- the server ------------------------------------------------------------ */

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method: 'POST', url: '/api', query: {}, body, headers: { host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) } };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test('what the page sent is filed, and gandhim gets every line with the photograph attached', async (t) => {
  assert.ok(filled, 'the page test above produced a submission');
  const saved = { ...process.env };
  const realFetch = global.fetch;
  const sent = [];
  Object.assign(process.env, { PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails', PUBLIC_SITE_URL: 'https://pfa.test' });
  delete process.env.PFA_SUBMISSIONS_INBOX;
  const db = memoryFirestore();
  firebase._setDbForTests(db);
  global.fetch = async (url, init) => {
    assert.equal(String(url), 'https://mail.test/emails');
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mail_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = realFetch; firebase._setDbForTests(null); process.env = saved; });

  const res = await call(require('../lib/routes/pfa-submissions'), Object.assign({}, filled, { clientRequestId: 'unit-test-1' }));
  assert.equal(res.statusCode, 200, res.raw.slice(0, 400));
  const ref = res.json.reference;
  assert.match(ref, /^PFA-U-\d{4}-\d{5}$/);
  const record = db.dump()['submissions/' + ref];
  assert.equal(record.kind, 'PFA-U');
  assert.equal(record.kindLabel, 'New PFA unit application');
  assert.equal(record.attachments, 1);
  assert.ok(Number(record.receivedAtMs) > 0, 'listed by the admin panel');

  const confirm = sent.find((m) => [].concat(m.to).includes(SENDER));
  assert.ok(confirm, 'the applicant is confirmed');
  assert.match(confirm.subject, /^Your unit application is in/);
  assert.match(confirm.text, /reply to this email with them attached/);

  const copies = sent.filter((m) => [].concat(m.to).includes(INBOX));
  assert.equal(copies.length, 1, 'one copy to gandhim');
  const copy = copies[0];
  assert.equal(copy.reply_to, SENDER, 'Reply answers the applicant');
  assert.equal(copy.subject, `${ref}: New PFA unit application from Asha Rao`);
  for (const line of ['Unit of PFA in: Kundapur', 'Address of the applicant: 12 Main Road, Koteshwara, Kundapur, Udupi district, Karnataka 576222', 'Phone number (2): 0820 252 0000',
    'Board member 1: Member 1, age 41, Farmer', 'Board member 7: Member 7, age 37, Farmer', 'Qualifies under: Both A and B',
    'A) Case 1: Case number: 101/2025', 'A) Case 5: Case number: 105/2025', 'B) Rescue 1: Animal: Dog', 'B) Rescue 2: Animal: Cow',
    'Son, daughter or wife of: Daughter of Ramesh Rao', 'Presently working as: Teacher', 'Signature (name typed): Asha Rao']) {
    assert.ok(copy.text.includes(line), `the copy carries "${line}"`);
  }
  assert.equal(copy.attachments.length, 1, 'the photograph is attached, not only mentioned');
  assert.match(copy.attachments[0].filename, new RegExp(`^${ref}-photo-1\\.jpg$`));
  assert.doesNotMatch(copy.text, /[–—]/, 'no long dashes in the copy');
});

test('an application may carry six photographs; every other form three', () => {
  assert.equal(S.maxPhotosFor('PFA-U'), 6);
  assert.equal(S.maxPhotosFor('PFA-CR'), 3);
  assert.equal(S.maxPhotosFor(''), 3);
  const small = Array.from({ length: 6 }, () => PHOTO);
  assert.equal(S.parsePhotos(small, S.maxPhotosFor('PFA-U')).accepted.length, 6);
  const seven = S.parsePhotos(small.concat([PHOTO]), S.maxPhotosFor('PFA-U'));
  assert.equal(seven.accepted.length, 0);
  assert.match(seven.rejected[0], /Up to 6 photos/);
  assert.match(S.parsePhotos(small.slice(0, 4), S.maxPhotosFor('PFA-CR')).rejected[0], /Up to 3 photos/);
  /* the panel can read every one of them back */
  assert.match(read('lib/routes/admin/attachment.js'), /n <= S\.MAX_PHOTOS_ANY/);
  assert.ok(S.MAX_PHOTOS_ANY >= S.maxPhotosFor('PFA-U'));
  /* and the page asks for no more than the server takes */
  assert.match(read('units.html'), /var MAX_FILES = 6;/);
});
