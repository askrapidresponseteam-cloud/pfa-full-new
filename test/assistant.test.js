'use strict';

/* The site's assistant (owner, 15 Nov 2026: "build an assistant. enterprise
   grade- it should allow to do anything and everything on the site, lodge
   cases, apply for volunteer. anything and every offering. including
   donate ... understand query in hindi, english etc..summarise, confirm, get
   receipt etc if one provides the valid credentials ... should not depend
   on any API").

   Its understanding in English, Hindi and Hinglish; every conversation,
   from the first message to what it sends; what it sends checked by the
   server's own rules (lib/submission-fields.js validate, lib/payment.js
   parsePaymentRequest), so the assistant can never send what the forms
   could not; the receipt sent again only to the email on a payment; and
   its place on every page. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const N = require('../assets/assistant-nlu.js');
const FL = require('../assets/assistant-flows.js');
const FIELDS = require('../lib/submission-fields.js');
const PAY = require('../lib/payment.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-15T06:00:00.000Z');

/* ---- a conversation, as the page drives it ---- */
function talk(steps, opts) {
  const s = FL.createSession(Object.assign({ now: () => NOW }, opts || {}));
  let o = s.start();
  const said = [o];
  const actions = [];
  for (const step of steps) {
    if (step && step.done) o = s.done(o.action.id, step.done);
    else if (step && step.tap) o = s.tap(step.tap);
    else o = s.hear(step);
    said.push(o);
    if (o.action) actions.push(o.action);
  }
  return { s, o, said, actions, text: said.flatMap((x) => x.messages.map((m) => m.text)).join('\n') };
}
const UDUPI = { done: { state: 'Karnataka', districts: ['Udupi'], places: ['Udupi', 'Bannanje'] } };
const ADDRESS = ['576101', UDUPI, { tap: 'Udupi' }, 'House 14', 'Car Street'];

/* ---- understanding ---- */

test('what someone wants, in English, Hindi and Hinglish', () => {
  const cases = [
    ['someone is beating a dog near my house', 'report'],
    ['mere ghar ke paas kutte ko maar rahe hain', 'report'],
    ['मेरे घर के पास कुत्ते को मार रहे हैं', 'report'],
    ['I want to donate 1000', 'donate'],
    ['mujhe 5 hazaar daan karna hai', 'donate'],
    ['मैं दान करना चाहता हूँ', 'donate'],
    ['injured dog near me', 'nearby'],
    ['ghayal gaay hai, paas mein koi hospital?', 'nearby'],
    ['how do i become a member', 'member'],
    ['volunteer karna hai', 'volunteer'],
    ['internship ke liye apply', 'internship'],
    ['status of PFA-CR-2026-00012', 'track'],
    ['मुझे दान की रसीद चाहिए', 'receipt'],
    ['i need my 80g receipt', 'receipt'],
    ['how to adopt a puppy', 'adopt'],
    ['feed street dogs card', 'caregiver'],
    ['what does the law say about dog bite', 'law'],
    ['namaste ji', 'greet']
  ];
  for (const [text, want] of cases) assert.equal((N.intentOf(text)[0] || {}).id, want, text);
  assert.equal(N.languageOf('mere ghar ke paas kutte ko maar rahe hain'), 'hi', 'Hinglish answered in Hindi');
  assert.equal(N.languageOf('मुझे दान करना है'), 'hi');
  assert.equal(N.languageOf('I want to volunteer'), 'en');
  assert.equal(N.languageOf('9876543210'), '', 'a number says nothing about the language');
});

test('the details in what someone wrote', () => {
  assert.equal(N.mobileOf('call me on +91 98765 43210'), '9876543210');
  assert.equal(N.mobileOf('mera number 09876543210 hai'), '9876543210');
  assert.equal(N.mobileOf('pin 560001 and 9876543210'), '9876543210');
  assert.equal(N.mobileOf('१९८७६५४३२१०'.slice(1)), '9876543210', 'Devanagari digits');
  assert.equal(N.pinOf('pin 560 001'), '560001');
  assert.equal(N.pinOf('9876543210'), '', 'never the digits of a mobile');
  assert.equal(N.emailOf('mail me at Asha.Rao@Example.com.'), 'asha.rao@example.com');
  assert.equal(N.referenceOf('pfa cr 2026 00012 ka status'), 'PFA-CR-2026-00012');
  assert.equal(N.referenceOf('PFA-DON-AB12CD34'), 'PFA-DON-AB12CD34');
  assert.equal(N.amountOf('Rs 2,500'), 2500);
  assert.equal(N.amountOf('5k'), 5000);
  assert.equal(N.amountOf('ek hazaar'), 1000);
  assert.equal(N.amountOf('2 lakh rupaye'), 200000);
  assert.equal(N.amountOf('1500', true), 1500);
  assert.equal(N.dateOf('14/05/2004'), '2004-05-14');
  assert.equal(N.dateOf('14 May 2004'), '2004-05-14');
  assert.equal(N.dateOf('31/02/2004'), '', 'not a real day');
  assert.equal(N.nameOf('my name is Asha Rao and my number is 98765 43210'), 'Asha Rao');
  assert.equal(N.nameOf('mera naam ravi kumar hai'), 'Ravi Kumar');
  assert.equal(N.nameOf('मेरा नाम आशा है'), 'आशा', 'the vowel signs kept');
  assert.equal(N.yesNoOf('haan ji'), true);
  assert.equal(N.yesNoOf('नहीं'), false);
  assert.equal(N.animalOf('gaay ko maara'), 'Cow or buffalo');
  assert.equal(N.animalOf('बिल्ली'), 'Cat');
  assert.equal(N.urgencyOf('abhi maar rahe hain'), 'Happening now');
  assert.equal(N.urgencyOf('roz pitai hoti hai'), 'Ongoing');
  assert.equal(N.urgencyOf('kal maar diya'), 'Past');
  assert.equal(N.commandOf('rehne do'), 'cancel');
  assert.equal(N.commandOf('pata nahi'), 'skip');
});

/* ---- every form the assistant sends, judged by the server's own rules ---- */

const SUBMIT_FLOWS = {
  report: ['#report', 'A man is beating a dog with a stick outside the market', { tap: 'Dog' }, { tap: 'Happening now' }, ...ADDRESS, '#skip', '#skip', 'Ravi Kumar', '9876543210', 'ravi@example.com'],
  helpdesk: ['#helpdesk', 'How do I get a street dog vaccinated in my area?', { tap: 'An animal I found or feed' }, 'Ravi Kumar', 'ravi@example.com', '#skip', ...ADDRESS],
  volunteer: ['#volunteer', { tap: 'Shelters' }, { tap: 'Hospitals' }, { tap: '#done' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS, 'Weekends', '#skip'],
  internship: ['#internship', 'Asha Rao', '14/05/2004', '9876543210', 'asha@example.com', ...ADDRESS, 'I feed the dogs on my street and want to learn the law to help them.', '#skip', { tap: 'yes' }],
  event: ['#event', { tap: 'A sterilisation or vaccination camp' }, '#skip', 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS],
  sgacc: ['#sgacc', { tap: 'Supplies for the animals' }, '#skip', 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS],
  cinekind: ['#cinekind', 'The film Test Subject V', { tap: 'A film or documentary' }, 'It shows the truth about testing on animals.', 'Asha Rao', 'asha@example.com', '#skip', ...ADDRESS],
  legacy: ['#legacy', { tap: 'A sum of money' }, { tap: 'Phone' }, 'Asha Rao', 'asha@example.com', '9876543210', ...ADDRESS],
  privacy: ['#privacy', { tap: 'A correction' }, 'My mobile number is wrong on my report.', 'Asha Rao', 'asha@example.com', ...ADDRESS],
  campaign: ['#campaign', { tap: 'Community dogs' }, { tap: 'A birthday or celebration' }, 'Asha turns 30 for the dogs', 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS],
  csr: ['#csr', 'Acme Industries', 'Rescue and hospitals', 'Asha Rao', 'asha@example.com', '9876543210', ...ADDRESS],
  campus: ['#campus', 'MGM College, Udupi', 'Rescue and awareness', { tap: 'Yes' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS]
};

test('every form the assistant sends passes the server\'s own checks, field for field', () => {
  for (const [flow, steps] of Object.entries(SUBMIT_FLOWS)) {
    const t = talk(steps.map((x) => (typeof x === 'string' && x.charAt(0) === '#' ? { tap: x } : x)).concat([{ tap: '#send' }]));
    const sent = t.actions.filter((a) => a.type === 'submit');
    assert.equal(sent.length, 1, `${flow}: one send, after the summary: ${t.text.slice(-400)}`);
    const a = sent[0];
    assert.equal(a.kind, FL.FLOWS[flow].kind);
    const v = FIELDS.validate(a.kind, a.data);
    assert.deepEqual(v.errors, [], `${flow}: ${JSON.stringify(a.data)}`);
    assert.equal(a.data.via, 'Assistant', 'the panel can see where it came from');
    /* the summary came first, with what will be sent */
    const summary = t.said.filter((x) => x.messages.some((m) => m.list && m.chips && m.chips.some((c) => c.value === '#send')));
    assert.ok(summary.length, `${flow}: summarised and confirmed before sending`);
  }
});

test('a volunteer application reads as the form\'s does; an internship carries the guide and the age', () => {
  const v = talk(SUBMIT_FLOWS.volunteer.map((x) => (typeof x === 'string' && x.charAt(0) === '#' ? { tap: x } : x)).concat([{ tap: '#send' }])).actions.find((a) => a.type === 'submit');
  assert.equal(v.data.title, 'Volunteer: Shelters, Hospitals');
  assert.equal(v.data.notes, 'Free: Weekends. ');
  const i = talk(SUBMIT_FLOWS.internship.map((x) => (typeof x === 'string' && x.charAt(0) === '#' ? { tap: x } : x)).concat([{ tap: '#send' }])).actions.find((a) => a.type === 'submit');
  assert.deepEqual([i.data.dob, i.data.age, i.data.guide], ['2004-05-14', '22', 'Read and understood']);
  /* 16 or 17: a parent's agreement; under 16: not at all */
  const young = talk([{ tap: '#internship' }, 'Meera Das', '15/03/2009']);
  assert.match(young.o.messages[0].text, /parent or guardian/);
  const child = talk([{ tap: '#internship' }, 'Meera Das', '15/03/2012']);
  assert.match(child.text, /16 and over/);
  assert.equal(child.actions.length, 0);
});

test('the first message is used: the animal, how urgent, the number, the PIN, the amount', () => {
  const t = talk(['mere ghar ke paas kutte ko maar rahe hain, mera number 9876543210, pin 576101']);
  const st = t.s.state();
  assert.equal(st.lang, 'hi', 'answered in Hindi');
  assert.deepEqual([st.data.animal, st.data.urgency, st.data.mobile], ['Dog', 'Happening now', '9876543210']);
  assert.equal(st.data.what, 'mere ghar ke paas kutte ko maar rahe hain, pin 576101', 'the account, without the number');
  assert.equal(t.o.action.type, 'pin', 'the PIN looked up at once');
  const d = talk(['I want to donate 1000 for rescue']).s.state();
  assert.deepEqual([d.flow, d.data.amount, d.data.cause], ['donate', '1000', 'Rescue']);
});

/* ---- paying: CCAvenue's own page, as the site's buttons ---- */

test('a donation and a membership are posted as the pages post them, and the payment code accepts them', () => {
  const tapAll = (list) => list.map((x) => (typeof x === 'string' && x.charAt(0) === '#' ? { tap: x } : x));
  const don = talk(tapAll(['#donate', { tap: '2500' }, { tap: 'Hospitals' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS]));
  /* owner, 15 Nov 2026: "chat isnt showing the prviwe at the right stage".
     The details come first, then what paying agrees to, then the button:
     the terms are never asked before the details are in view. */
  assert.doesNotMatch(don.text, /Do you confirm these details are yours/, 'no terms question before the summary');
  const [shownFirst, termsAfter] = don.o.messages;
  assert.match(shownFirst.text, /^Please check before it is sent: Donate/);
  assert.ok(shownFirst.list.some(([k, v]) => k === 'Amount' && v === '₹2,500'), 'the details, listed');
  assert.ok(!shownFirst.chips, 'no button above the terms');
  assert.match(termsAfter.text, /^Paying confirms these details are yours and that you accept the donation and receipt terms\./);
  assert.equal(termsAfter.links[0].href, 'donate.html');
  assert.equal(termsAfter.chips[0].label, 'Accept and pay ₹2,500 on CCAvenue');
  const pay = talk(tapAll(['#donate', { tap: '2500' }, { tap: 'Hospitals' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS, { tap: '#send' }])).actions.find((a) => a.type === 'pay');
  assert.equal(pay.fields.terms, 'yes', 'accepted by pressing Accept and pay');
  const p = PAY.parsePaymentRequest(pay.fields);
  assert.deepEqual([p.type, p.amount, p.metadata.cause, p.customer.name, p.customer.pin], ['donate', '2500.00', 'Hospitals', 'Asha Rao', '576101']);
  const memSummary = talk(tapAll(['#member', { tap: 'golden' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS]));
  assert.match(memSummary.o.messages[1].text, /accept the membership terms/);
  const mem = talk(tapAll(['#member', { tap: 'golden' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS, { tap: '#send' }])).actions.find((a) => a.type === 'pay');
  const m = PAY.parsePaymentRequest(mem.fields);
  assert.deepEqual([m.type, m.amount, m.metadata.tier, m.customer.district], ['membership', 2500, 'golden', 'Udupi']);
  /* nothing goes until the button is pressed */
  const waiting = talk(tapAll(['#donate', { tap: '500' }, { tap: 'Hospitals' }, 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS, { tap: '#cancel' }]));
  assert.equal(waiting.actions.filter((a) => a.type === 'pay').length, 0);
});

/* ---- summarise, change, cancel, fix ---- */

test('summarised, any answer changed, cancelled with nothing sent, and a refusal put right where it lies', () => {
  const base = ['#sgacc', { tap: 'Supplies for the animals' }, '#skip', 'Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS].map((x) => (typeof x === 'string' && x.charAt(0) === '#' ? { tap: x } : x));
  const changed = talk(base.concat([{ tap: '#change' }, { tap: '@mobile' }, '9123456789']));
  const list = changed.o.messages[0].list;
  assert.deepEqual(list.find((r) => r[0] === 'Mobile'), ['Mobile', '9123456789'], 'back to the summary, changed');
  const cancelled = talk(base.concat(['cancel']));
  assert.equal(cancelled.o.messages[0].text, 'Stopped. Nothing was sent.');
  assert.equal(cancelled.actions.filter((a) => a.type === 'submit').length, 0);
  /* the server names a field: that one is asked again, the rest stands */
  const fixed = talk(base.concat([{ tap: '#send' }, { done: { ok: false, fields: [{ field: 'city', message: 'That town is not at PIN 576101.' }] } }, 'Udupi', { tap: '#send' }]));
  assert.match(fixed.text, /It was not sent: That town is not at PIN 576101\. Let us fix that\./);
  const again = fixed.actions.filter((a) => a.type === 'submit');
  assert.equal(again.length, 2);
  assert.deepEqual([again[1].data.city, again[1].data.address], ['Udupi', 'House 14, Car Street'], 'the house and street kept');
});

test('looking things up needs the details that prove whose they are, and nothing is shown that should not be', () => {
  const tr = talk(['status of PFA-CR-2026-00012', 'ravi@example.com']);
  assert.deepEqual(tr.o.action, { id: tr.o.action.id, type: 'track', reference: 'PFA-CR-2026-00012', contact: 'ravi@example.com' });
  const rc = talk(['meri raseed chahiye', 'asha@example.com', '9876543210', ]);
  assert.equal(rc.o.action.type, 'receipt');
  const done = rc.s.done(rc.o.action.id, { ok: true });
  assert.match(done.messages[0].text, /ईमेल पते पर भेज दी गई/, 'sent to the address on the payment, never shown here');
  const near = talk(['nearest pfa unit 282001']);
  assert.equal(near.o.action.type, 'nearby');
});

test('the nearest units: the person\'s own district first, then the rest of the state; the head office where there is none', () => {
  const units = [
    { c: 'Agra', s: 'Uttar Pradesh', p: 'Dr. Gupta', t: ['9536639207'], u: 'units/agra.html', la: 27.18, lo: 78.01 },
    { c: 'Firozabad', s: 'Uttar Pradesh', p: 'Mr. Sharma', t: ['9250004141'], u: 'units/firozabad.html', la: 27.15, lo: 78.39 },
    { c: 'Lucknow', s: 'Uttar Pradesh', p: 'Ms. Singh', t: [], u: 'units/lucknow.html', la: 26.85, lo: 80.95 },
    { c: 'Mysore', s: 'Karnataka', p: 'Ms. Savitha', t: ['9845654429'], u: 'units/mysore.html', la: 12.3, lo: 76.64 }
  ];
  const near = FL.unitsNear(units, { state: 'Uttar Pradesh', district: 'Agra', near: ['Agra'], areas: [] });
  assert.deepEqual(near.map((u) => u.title), ['PFA Agra', 'PFA Firozabad', 'PFA Lucknow']);
  assert.equal(near[0].detail, 'Dr. Gupta, 9536639207');
  assert.deepEqual(FL.unitsNear(units, { state: 'Delhi', district: 'New Delhi' }), []);
  const s = FL.createSession({ now: () => NOW });
  s.start();
  const o = s.hear('nearest unit 110001');
  const none = s.done(o.action.id, { units: [], place: '110001' });
  assert.match(none.messages[0].text, /head office in New Delhi can help: \+91 11 2081 8191/);
  assert.ok(none.messages[0].links.some((l) => l.href === 'tel:+911120818191'));
  /* the list is the units page's own (scripts/build-assistant-units.js) */
  const { render } = require('../scripts/build-assistant-units.js');
  assert.equal(read('assets/assistant-units.js'), render(), 'in step with units.html');
});

test('a question goes to the site first, then to the help desk with the question already in it', () => {
  const t = talk(['what should i do if a dog bites someone']);
  assert.equal(t.o.action.type, 'search');
  const s = t.s;
  const r = s.done(t.o.action.id, { rows: [{ title: 'Laws: dogs', url: 'laws.html#part-a', desc: 'Bites' }] });
  assert.deepEqual(r.messages[0].links, [{ label: 'Laws: dogs', href: 'laws.html#part-a' }]);
  const desk = s.tap('#desk');
  assert.equal(s.state().data.question, 'what should i do if a dog bites someone');
  assert.match(desk.messages[desk.messages.length - 1].text, /closest to/);
});

test('in Hindi throughout when spoken to in Hindi; a tapped button never changes the language', () => {
  const t = talk(['मुझे स्वयंसेवक बनना है', { tap: 'Shelters' }, { tap: '#done' }, 'Asha Rao', '9876543210']);
  assert.equal(t.s.state().lang, 'hi');
  assert.match(t.o.messages[0].text, /ईमेल/);
  const s = FL.createSession({ now: () => NOW });
  s.start();
  s.setLang('hi');
  s.hear('I want to donate');
  assert.equal(s.state().lang, 'hi', 'a language chosen stays chosen');
});

/* ---- the receipt, sent again ---- */

test('a receipt is sent again only to the email on a paid payment whose email and mobile both match; the answer never says which', async () => {
  const { memoryFirestore } = require('./_memory-firestore');
  const db = memoryFirestore();
  db.collection('transactions').doc('PFA-DON-AB12CD34').set({ orderId: 'PFA-DON-AB12CD34', type: 'donate', status: 'success', amount: '1500.00', currency: 'inr', paidAt: '2026-11-10T06:00:00.000Z', receiptKey: 'k'.repeat(43),
    customer: { name: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210', address: '14 Car Street', city: 'Udupi', state: 'Karnataka', pin: '576101' }, metadata: { cause: 'Rescue' }, ccaVenue: { bankReference: 'BR1' } });
  db.collection('transactions').doc('PFA-DON-ZZ99ZZ99').set({ orderId: 'PFA-DON-ZZ99ZZ99', type: 'donate', status: 'failure', customer: { email: 'asha@example.com', mobile: '9876543210' } });
  const sent = [];
  const H = require('../lib/routes/assistant/receipt.js').createHandler({
    getDb: () => db, now: () => NOW,
    mail: { isConfigured: () => true, deliver: async (m) => { sent.push(m); return { providerId: 'p1' }; } },
    queue: { queueEmail: async (q) => ({ created: true, emailId: 'e' + sent.length, claimToken: 't', status: 'queued', ...q }), recordEmailResult: async () => ({}) }
  });
  const call = (body, ip) => new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(raw) { resolve({ status: this.statusCode, json: JSON.parse(raw) }); } };
    H({ method: 'POST', body, headers: { 'x-forwarded-for': ip || '203.0.113.5' }, socket: { remoteAddress: ip || '203.0.113.5' } }, res);
  });
  const ok = await call({ email: 'Asha@Example.com', mobile: '+91 98765 43210' });
  assert.equal(ok.status, 200);
  assert.equal(sent.length, 1, 'the paid one, not the failed one');
  assert.equal(sent[0].to, 'asha@example.com');
  assert.equal(sent[0].template, 'payment_received');
  assert.equal(sent[0].payload.orderId, 'PFA-DON-AB12CD34');
  const wrong = await call({ email: 'asha@example.com', mobile: '9000000000' }, '203.0.113.6');
  assert.equal(sent.length, 1, 'a mobile that does not match sends nothing');
  assert.deepEqual(wrong.json, ok.json, 'and the answer is word for word the same');
  const bad = await call({ email: 'not-an-email', mobile: '9876543210' }, '203.0.113.7');
  assert.equal(bad.status, 400);
  assert.match(read('api/index.js'), /'assistant\/receipt': \(\) => require\('\.\.\/lib\/routes\/assistant\/receipt\.js'\)/);
});

/* ---- on every page, costing nothing ---- */

test('on every page, loaded only when opened, talking only to the site itself', () => {
  const chrome = read('assets/chrome.js');
  assert.match(chrome, /var FILES = \['\/assets\/assistant-nlu\.js', '\/assets\/assistant-flows\.js', '\/assets\/assistant-units\.js', '\/assets\/assistant\.js'\]\.map/);
  assert.match(chrome, /if \(kept && kept\.open && !off\(\)\) load\(\);/, 'a conversation open in this tab comes to the next page, unless the panel has hidden it');
  assert.match(chrome, /\(certificate\|card\|caregiver-card\|member-photo\|tax-receipt\|submission-collage\|admin\)/, 'not on a page to print or a private step');
  const files = ['assets/assistant.js', 'assets/assistant-nlu.js', 'assets/assistant-flows.js', 'assets/assistant.css'];
  const all = files.map(read).join('\n');
  /* no outside service: every call goes to this site */
  const calls = [...all.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(calls.length >= 4);
  for (const c of calls) assert.match(c, /^\/api\//, c);
  assert.doesNotMatch(all, /https?:\/\/(?!peopleforanimalsindia)[a-z0-9.-]+\.(?:com|ai|io|org|net)\/[a-z]/i, 'no outside address');
  assert.doesNotMatch(all, /[–—]/, 'no long dash');
  assert.match(read('assets/assistant.js'), /f\.action = '\/api\/payment\/create';/, 'payments through the site\'s own door to CCAvenue');
  /* every page that has the chrome has the button, through chrome.js */
  for (const page of ['index.html', 'report.html', 'donate.html', 'units/agra.html']) assert.match(read(page), /assets\/chrome\.js\?v=/, page);
});

/* ---- v1.574: every visitor task the site offers (owner, 15 Nov 2026:
   "Comprehensively audit and fix the PFA assistant so it supports all
   visitor-facing tasks across the site") ---- */

test('the audit: every form a visitor fills in on the site is in the chat or handed to its page, by name', () => {
  const inChat = Object.values(FL.FLOWS).map((f) => f.kind).filter(Boolean);
  /* the two that stay on their pages, and why (see PAGES in assistant-flows.js) */
  const onPage = { 'PFA-J': 'careers.html', 'PFA-U': 'units.html#apply' };
  for (const kind of Object.keys(FIELDS.KINDS)) {
    assert.ok(inChat.includes(kind) || onPage[kind], `${kind} (${FIELDS.KINDS[kind].page}) is reachable from the chat`);
  }
  const pages = Object.values(FL.PAGES).map((p) => p.href);
  for (const href of Object.values(onPage)) assert.ok(pages.includes(href), href);
  for (const id of ['caregiver', 'shop', 'interndash']) assert.ok(FL.PAGES[id]);
  assert.doesNotMatch(FL.PAGES.shop.say.en, /track it with your order number/, 'no promise of a lookup the site does not have');
  for (const id of ['wallstory', 'proof', 'verify']) assert.ok(FL.MORE.includes(id), `${id} is under More`);
});

test('a film for The Wall: the link, the wall, the credit, and it passes the server\'s own checks', () => {
  assert.equal((N.intentOf('I want to share my film for the wall')[0] || {}).id, 'wall');
  const t = talk(['share my reel on the wall instagram.com/reel/Cx12ab', { tap: 'Short form, under a minute' }, 'Asha Rao', 'asha@example.com', ...ADDRESS, '#send']);
  const sub = t.actions.find((a) => a.type === 'submit');
  assert.equal(sub.kind, 'PFA-S');
  assert.equal(sub.data.url, 'https://instagram.com/reel/Cx12ab', 'a bare link is given its https://');
  assert.deepEqual(FIELDS.validate('PFA-S', sub.data).errors, []);
  const odd = talk(['#wallstory', 'https://example.com/my-film']);
  assert.match(odd.text, /Instagram, Facebook, YouTube or Vimeo/, 'only the hosts The Wall takes');
});

test('internship proof: the application number, the task, the links, and it passes the server\'s own checks', () => {
  assert.equal((N.intentOf('proof for internship')[0] || {}).id, 'proof');
  const t = talk(['internship task proof PFA-VI-2026-00012', { tap: 'Map your district' }, 'I mapped every feeding spot in my ward and shared it with the unit.',
    'drive.google.com/drive/folders/abc and https://docs.google.com/d/xyz', 'Asha Rao', 'asha@example.com', ...ADDRESS, '#send']);
  const sub = t.actions.find((a) => a.type === 'submit');
  assert.equal(sub.kind, 'PFA-VP');
  assert.equal(sub.data.application, 'PFA-VI-2026-00012', 'the number in the first message is kept');
  assert.equal(sub.data.links, 'https://drive.google.com/drive/folders/abc\nhttps://docs.google.com/d/xyz');
  assert.deepEqual(FIELDS.validate('PFA-VP', sub.data).errors, []);
});

test('checking a certificate or a card: genuine, withdrawn, expired, unknown', () => {
  assert.equal((N.intentOf('verify caregiver card')[0] || {}).id, 'verify');
  assert.equal((N.intentOf('PFA-INT-AB2CD3EF')[0] || {}).id, 'verify', 'a certificate number alone is checked, not tracked');
  let t = talk(['is this certificate genuine pfa int ab2cd3ef']);
  assert.deepEqual(t.actions[0], Object.assign({}, t.actions[0], { type: 'verify', number: 'PFA-INT-AB2CD3EF' }));
  t = talk(['is this certificate genuine PFA-INT-AB2CD3EF', { done: { found: true, genuine: true, name: 'Asha Rao', issuedOn: '2026-10-02', startDate: '2026-08-01', endDate: '2026-09-26' } }]);
  assert.match(t.text, /Genuine\. PFA issued internship certificate PFA-INT-AB2CD3EF to Asha Rao on 2 Oct 2026, for 1 Aug 2026 to 26 Sep 2026\./);
  t = talk(['PFA-INT-AB2CD3EF', { done: { found: true, withdrawn: true, withdrawnOn: '2026-11-01', name: 'Asha Rao' } }]);
  assert.match(t.text, /withdrew it on 1 Nov 2026/);
  t = talk(['check this card PFA-CCT-AB2CD3EF', { done: { found: true, valid: false, name: 'Ravi Kumar', validUntil: '2026-01-31T00:00:00.000Z' } }]);
  assert.match(t.text, /expired on 31 Jan 2026/);
  t = talk(['#verify', 'PFA-CCT-ZZZZZZZZ', { done: { notFound: true, found: false } }]);
  assert.match(t.text, /PFA has no certificate or card with that number/);
  const ui = read('assets/assistant.js');
  assert.match(ui, /'\/api\/verify-certificate\?n=' \+ encodeURIComponent\(a\.number\)/);
  assert.match(ui, /'\/api\/verify-card\?id=' \+ encodeURIComponent\(a\.number\)/);
});

test('monthly giving in the chat: asked only while the panel has it on, and sent as monthly only then', () => {
  const donor = ['Asha Rao', '9876543210', 'asha@example.com', ...ADDRESS];
  const off = talk(['donate', { tap: '1000' }, { tap: 'Rescue' }, ...donor, '#send'], { monthly: () => false });
  assert.doesNotMatch(off.text, /every month/i, 'not asked while it is off');
  const offPay = off.actions.find((a) => a.type === 'pay').fields;
  assert.equal(offPay.frequency, 'once');
  assert.equal(PAY.parsePaymentRequest(offPay).recurring, false);

  const on = talk(['donate', { tap: '1000' }, { tap: 'monthly' }, { tap: 'Rescue' }, ...donor], { monthly: () => true });
  assert.match(on.text, /Once, or the same amount every month\?/);
  assert.ok(on.o.messages.some((m) => (m.chips || []).some((c) => c.label === 'Accept and pay ₹1,000 a month on CCAvenue')), 'the pay button says monthly');
  const pay = on.s.tap('#send').action.fields;
  assert.equal(pay.frequency, 'monthly');
  assert.equal(PAY.parsePaymentRequest(pay).recurring, true);

  const said = talk(['har mahine 500 daan karna hai'], { monthly: () => true });
  assert.equal(said.s.state().data.frequency, 'monthly', 'said in the first message, in Hinglish');
  const late = talk(['donate 500 every month'], { monthly: () => false });
  assert.equal(late.s.state().data.frequency, undefined, 'not taken while it is off');
  assert.match(read('assets/assistant.js'), /v\.choices\['donate#monthly'\] === 'on'/, 'the page asks the panel\'s choice');
});

test('the chat\'s files are fetched fresh after every deploy that changes them', () => {
  /* they load from inside chrome.js, so chrome.js carries their fingerprint */
  const SC = require('../scripts/sync-chrome.js');
  const chrome = read('assets/chrome.js');
  assert.match(chrome, new RegExp(`var ASSIST_V = '${SC.assistStamp()}';`), 'run npm run sync:chrome');
  assert.match(chrome, /return f \+ '\?v=' \+ ASSIST_V;/);
  assert.match(chrome, /css\.href = '\/assets\/assistant\.css\?v=' \+ ASSIST_V;/);
  assert.deepEqual(SC.ASSIST_FILES.slice(0, 4).map((f) => '/assets/' + f), ['/assets/assistant-nlu.js', '/assets/assistant-flows.js', '/assets/assistant-units.js', '/assets/assistant.js']);
});

test('a long reply opens at its first line, so the summary is read before the button', () => {
  const ui = read('assets/assistant.js');
  assert.match(ui, /reveal\(logEl\.children\[before\]\);/);
  assert.match(ui, /logEl\.scrollTop = bottom - top > logEl\.clientHeight \? top : bottom;/);
});

test('a straight question gets a straight answer: one line, the one link that does it (owner, 15 Nov 2026: "maneka gandhi email id should give a simple and straight answer.. instead of tons of links")', () => {
  const ask = (q) => { const t = talk([q]); return { m: t.o.messages[0], action: t.o.action }; };
  let a = ask('maneka gandhi email id');
  assert.equal(a.m.text, 'You can write to Smt. Maneka Sanjay Gandhi at PFA\'s office: gandhim@exmpls.sansad.in');
  assert.deepEqual(a.m.links.map((l) => l.href), ['mailto:gandhim@exmpls.sansad.in']);
  assert.equal(a.action, null, 'no search, no list of pages');
  assert.match(read('index.html'), /mailto:gandhim@exmpls\.sansad\.in/, 'the address the site publishes');
  assert.match(ask('pfa email').m.text, /^PFA's email is gandhim@exmpls\.sansad\.in\.$/);
  assert.match(ask('what is the phone number of pfa office').m.text, /\+91 11 2081 8191/);
  assert.match(ask('where is pfa head office').m.text, /16 Barakhamba Road, New Delhi 110001/);
  assert.match(ask('who founded pfa').m.text, /founded by Smt\. Maneka Sanjay Gandhi/);
  assert.match(ask('is donation tax exempt?').m.text, /^Yes\. Donations to PFA are eligible for tax deduction under Section 80G/);
  assert.match(ask('membership fees').m.text, /Student ₹500, Silver ₹1,000, Golden ₹2,500, Platinum ₹5,000, Lifetime ₹10,000/);
  assert.match(ask('is the internship paid?').m.text, /free to join and unpaid/);
  assert.match(ask('sanjay gandhi care centre address').m.text, /Raja Garden, New Delhi 110027/);
  assert.match(ask('मेनका गांधी का ईमेल').m.text, /gandhim@exmpls\.sansad\.in/);
  /* and a task is still a task */
  assert.equal(talk(['I want to donate 500']).s.state().flow, 'donate');
  assert.equal(talk(['become a member']).s.state().flow, 'member');
  assert.equal(talk(['I want to help the sanjay gandhi care centre']).s.state().flow, 'sgacc');
  assert.equal(talk(['someone is beating a dog']).s.state().flow, 'report');
  /* the facts are the site's own */
  assert.match(read('sgacc.html'), /tel:\+919560802425/);
  assert.match(read('internship.html'), /Free to join/);
});

test('a search answers with the one page that fits, not a list of links', () => {
  const t = talk(['what should i do if a dog bites someone', { done: { rows: [{ title: 'Laws: dogs', url: 'laws.html#part-a', desc: 'What the law says when a dog bites.' }, { title: 'Newsroom', url: 'newsroom.html', desc: 'x' }, { title: 'Wall', url: 'wall.html', desc: 'y' }] } }]);
  const m = t.o.messages[0];
  assert.equal(m.text, 'What the law says when a dog bites.');
  assert.equal(m.links.length, 1);
  assert.equal(m.links[0].href, 'laws.html#part-a');
  assert.ok(!m.list, 'no table of pages');
});

test('every straight answer is the site\'s own: each email, phone number, PIN code and rupee figure is printed on the site (owner, 15 Nov 2026: "always answer from site database. not google or anywhere else. that is 100% the rule")', () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map(read).join('\n');
  const site = pages.replace(/&nbsp;| /g, ' ').replace(/&#8377;/g, '₹');
  const digits = site.replace(/[^0-9]/g, '');
  for (const f of FL.FACTS) {
    for (const lang of ['en', 'hi']) {
      const say = f.say[lang];
      for (const email of say.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []) assert.ok(site.includes(email), `${f.id}: ${email} is on the site`);
      for (const phone of say.match(/\+91[\d ]{10,14}\d/g) || []) assert.ok(digits.includes(phone.replace(/\D/g, '').slice(2)), `${f.id}: ${phone} is on the site`);
      for (const pin of say.match(/\b[1-9]\d{5}\b/g) || []) assert.ok(site.includes(pin), `${f.id}: PIN ${pin} is on the site`);
      for (const rupees of say.match(/₹\d[\d,]*\d/g) || []) assert.ok(site.includes(rupees) || site.includes(rupees.replace(/,/g, '')) || site.includes('Rs ' + rupees.slice(1)) || site.includes(rupees.slice(1)), `${f.id}: ${rupees} is on the site`);
    }
    for (const l of f.links || []) assert.match(l.href, /^(mailto:|tel:|[a-z-]+\.html)/, `${f.id}: a link to write, call, or a page of the site, never anywhere else`);
  }
  for (const words of ['4-T, DCM Building, 16 Barakhamba Road', 'Raja Garden, New Delhi 110027', 'Free to join', '16-17 need a parent', '80G']) assert.ok(site.includes(words), words);
  /* and the chat itself asks nothing of anywhere but the site */
  const ui = read('assets/assistant.js');
  for (const c of [...ui.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1])) assert.match(c, /^\/api\//, c);
});
