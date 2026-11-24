'use strict';
/* Teaching the site's chat (lib/chat-learn.js, lib/routes/admin/chat-learn.js,
   lib/routes/chat-taught.js, assets/admin-chat-learn.js; owner, 23 Nov 2026:
   "can you have chat module keep learning and get better"), and the chat
   noticing a change of mind in the middle of a form (the same day: "shop"
   was taken as a name, "i mean I want to shop" as a mobile number). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { memoryFirestore } = require('./_memory-firestore');
const L = require('../lib/chat-learn');
const A = require('../lib/analytics');
const FL = require('../assets/assistant-flows.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function call(handler, method, body, query) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      end(b) { let json = null; try { json = JSON.parse(String(b || '')); } catch (_) { /* none */ } resolve({ status: this.statusCode, headers, json }); }
    };
    handler({ method, body, query: query || {}, headers: {} }, res);
  });
}
const NOW = Date.parse('2026-11-23T08:00:00Z');
const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36' };

test('a question the chat answered, then a person asked for, is noted as a wrong answer', () => {
  const hit = A.readHit({ p: '/', q: 'Can I donate old newspapers? call 9876543210', w: 1 }, UA, NOW);
  assert.equal(hit.miss, 'can i donate old newspapers? call');
  assert.equal(hit.wrong, true);
  const inc = (n) => ({ inc: n });
  const w = A.writesFor(hit, inc);
  const row = Object.values(w.chat)[0];
  assert.deepEqual(row.w, { inc: 1 });
  const plain = A.writesFor(A.readHit({ p: '/', q: 'hello there friend' }, UA, NOW), inc);
  assert.equal(Object.values(plain.chat)[0].w, undefined);
});

test('a taught answer is checked: a sentence or two, no long dash, a page of the site only', () => {
  assert.equal(L.checkTeach({ answer: 'short' }).ok, false);
  assert.equal(L.checkTeach({ answer: 'x'.repeat(L.MAX_ANSWER + 1) }).ok, false);
  assert.equal(L.checkTeach({ answer: 'Yes — it does.' }).ok, false);
  assert.equal(L.checkTeach({ answer: 'Yes, the shelter takes them.', link: 'https://evil.example/x' }).ok, false);
  const ok = L.checkTeach({ answer: 'Yes, the shelter takes them.', link: '/donate.html#ways', also: 'Can I give newspapers\n\nnewspapers  \ncan i give newspapers' });
  assert.equal(ok.ok, true);
  assert.equal(ok.link, 'donate.html#ways');
  assert.deepEqual(ok.also, ['can i give newspapers', 'newspapers']);
  assert.equal(L.checkTeach({ answer: 'Yes, the shelter takes them.', link: 'https://www.peopleforanimalsindia.org/contact.html' }).link, 'contact.html');
});

test('the panel: questions most asked first; taught and set aside leave the list; forgotten ones come back', async () => {
  const db = memoryFirestore();
  const day = (ms) => A.dayOf(ms);
  const q1 = 'do you take old newspapers', q2 = 'is the hospital open on sunday', q3 = 'something odd';
  await db.collection('analytics_days').doc(day(NOW) + '_chat').set({ [L.idOf(q1)]: { q: q1, n: 3, w: 1 }, [L.idOf(q2)]: { q: q2, n: 5 } });
  await db.collection('analytics_days').doc(day(NOW - 3 * 864e5) + '_chat').set({ [L.idOf(q1)]: { q: q1, n: 4 }, [L.idOf(q3)]: { q: q3, n: 1 } });
  /* older than 30 days: not on the list */
  await db.collection('analytics_days').doc(day(NOW - 40 * 864e5) + '_chat').set({ abcdefabcdef: { q: 'long ago', n: 50 } });
  const handler = require('../lib/routes/admin/chat-learn').createHandler({ getDb: () => db, requireAdmin: async () => ({ email: 'a@pfa' }), now: () => NOW });
  let r = await call(handler, 'GET');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.open.map((x) => [x.q, x.n, x.wrong]), [[q1, 7, 1], [q2, 5, 0], [q3, 1, 0]]);
  const bad = await call(handler, 'POST', { action: 'teach', id: L.idOf(q1), q: q1, answer: 'no' });
  assert.equal(bad.status, 422);
  r = await call(handler, 'POST', { action: 'teach', id: L.idOf(q1), q: q1, answer: 'Yes. The Delhi shelter takes clean old newspapers for bedding.', link: 'contact.html', also: 'can i donate newspapers' });
  assert.equal(r.status, 200);
  assert.equal((await call(handler, 'POST', { action: 'ignore', id: L.idOf(q3), q: q3 })).status, 200);
  assert.equal((await call(handler, 'POST', { action: 'nothing' })).status, 400);
  r = await call(handler, 'GET');
  assert.deepEqual(r.json.open.map((x) => x.q), [q2]);
  assert.equal(r.json.taught.length, 1);
  assert.equal(r.json.taught[0].by, 'a@pfa');
  assert.equal(r.json.ignored, 1);
  /* the public list: only what is taught, and nothing about who taught it */
  const pub = require('../lib/routes/chat-taught').createHandler({ getDb: () => db });
  let p = await call(pub, 'GET');
  assert.deepEqual(p.json.taught, [{ q: q1, also: ['can i donate newspapers'], answer: 'Yes. The Delhi shelter takes clean old newspapers for bedding.', link: 'contact.html' }]);
  assert.match(p.headers['cache-control'], /max-age/);
  /* forgotten: no longer given, the record kept */
  assert.equal((await call(handler, 'POST', { action: 'forget', id: L.idOf(q1) })).status, 200);
  p = await call(pub, 'GET');
  assert.deepEqual(p.json.taught, []);
  assert.equal((await db.collection(L.COLLECTION).doc(L.idOf(q1)).get()).exists, true);
  r = await call(handler, 'GET');
  assert.ok(r.json.open.some((x) => x.q === q1), 'back on the list once forgotten');
});

const TAUGHT = [
  { q: 'do you take old newspapers for the shelter', also: ['can i donate newspapers', 'newspaper donation'], answer: 'Yes. The Delhi shelter takes clean old newspapers for bedding.', link: 'contact.html' },
  { q: 'how to donate', also: [], answer: 'TAUGHT DONATE' }
];
function session() { const s = FL.createSession({ now: () => NOW, docs: [], taught: TAUGHT }); s.start(); return s; }

test('the chat gives what it was taught, to the question and its other wordings, and only to them', () => {
  for (const q of ['Do you take old newspapers for the shelter?', 'can I donate newspapers', 'newspapers donation', 'how to donate?']) {
    const o = session().hear(q);
    assert.ok(/newspapers for bedding|TAUGHT DONATE/.test(o.messages[0].text), q);
  }
  /* a word that is one of the chat's own offerings stays that offering */
  const d = session().hear('donate');
  assert.notEqual(d.messages[0].text, 'TAUGHT DONATE');
  /* close is not the same: a question with more besides is not answered so */
  assert.equal(FL.taughtOf('how do i donate newspapers and old blankets and towels and clothes', TAUGHT), null);
  assert.equal(FL.taughtOf('anything', []), null);
});

test('a person asked for straight after an answer is noted, once, as a wrong answer', () => {
  const s = session();
  s.hear('can i donate newspapers');
  const o = s.hear('#desk', true);
  assert.equal(o.miss, 'can i donate newspapers');
  assert.equal(o.missWrong, 1);
  s.hear('#menu', true);
  const again = s.hear('#desk', true);
  assert.equal(again.missWrong, undefined);
});

function form(lines) {
  const s = FL.createSession({ now: () => NOW, docs: [] });
  s.start();
  let o = null;
  for (const l of lines) o = s.hear(l);
  return { o, state: s.state(), text: o.messages.map((m) => m.text).join(' ') };
}

test('a change of mind in the middle of a form: asked about, or followed when said plainly', () => {
  /* one word that is an offering, where a name is asked: asked first */
  let r = form(['become a member', 'Silver, ₹1,000', 'shop']);
  assert.match(r.text, /^Stop Become a member and go to /);
  assert.equal(r.state.flow, 'member');
  /* said plainly: the form is left, nothing sent, and nothing after answers it */
  r = form(['become a member', 'Silver, ₹1,000', 'i mean I want to shop']);
  assert.match(r.text, /Become a member: stopped\. Nothing was sent\./);
  assert.equal(r.state.flow, '');
  r = form(['become a member', 'Silver, ₹1,000', 'actually i want to donate']);
  assert.equal(r.state.flow, 'donate');
  /* a real name, even one with an offering in it, is a name */
  r = form(['become a member', 'Silver, ₹1,000', 'Rahul Shopkar']);
  assert.equal(r.state.flow, 'member');
  assert.match(r.text, /mobile/i);
  /* where a few sentences are asked, only a plain correction leaves */
  r = form(['report cruelty', 'yes', 'i want to volunteer instead']);
  assert.equal(r.state.flow, 'volunteer');
  r = form(['report cruelty', 'yes', 'i want to help this dog, a man is beating it']);
  assert.equal(r.state.flow, 'report');
});

test('wired in: routes, the rule, the panel, the chat and the privacy page', () => {
  const api = read('api/index.js');
  assert.match(api, /'admin\/chat-learn': \(\) => require\('\.\.\/lib\/routes\/admin\/chat-learn\.js'\)/);
  assert.match(api, /'chat-taught': \(\) => require\('\.\.\/lib\/routes\/chat-taught\.js'\)/);
  assert.match(read('firestore.rules'), /match \/chatLearn\/\{id\}\s+\{ allow read, write: if false; \}/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-chat-learn\.js'/);
  assert.match(read('assets/admin-live-chat.js'), /assets\/admin-chat-learn\.js/);
  assert.match(read('assets/admin-live-chat.js'), /PFAChatLearn\.mount\(p\)/);
  assert.match(read('assets/assistant.js'), /\/api\/chat-taught/);
  assert.match(read('privacy.html'), /teach it a better answer/);
  for (const f of ['assets/admin-chat-learn.js', 'lib/chat-learn.js', 'lib/routes/admin/chat-learn.js', 'lib/routes/chat-taught.js']) assert.ok(!/[–—]/.test(read(f)), f);
});

test('a page asked for is given, in any wording, and a form in hand is kept to carry on with', () => {
  const said = (lines, taps) => {
    const s = FL.createSession({ now: () => NOW, docs: [] });
    s.start();
    let o = null;
    for (const l of lines) o = l.charAt(0) === '#' ? s.tap(l) : s.hear(l);
    const last = o.messages[o.messages.length - 1];
    return { text: o.messages.map((m) => m.text).join(' '), links: (last.links || []).map((x) => x.href), chips: (last.chips || []).map((c) => c.label), flow: s.state().flow };
  };
  /* the screenshot: in Donate, then in a nomination, "visit cinekind page" */
  for (const ask of ['visit cinekind page', 'open cinekind page', 'i want to see cinekind', 'mujhe cinekind ka page dikhao']) {
    const r = said(['donate', ask]);
    assert.deepEqual(r.links, ['cinekind.html'], ask);
    assert.equal(r.flow, 'donate', ask + ': Donate is kept');
    assert.match(r.chips[0], /^Carry on with Donate$/);
  }
  let r = said(['donate', 'cinekind', '#switch', 'visit cinekind page']);
  assert.deepEqual(r.links, ['cinekind.html']);
  assert.equal(r.flow, 'cinekind', 'not taken as the nominee');
  r = said(['donate', 'cinekind', '#switch', 'visit cinekind page', '#stay']);
  assert.match(r.text, /Who or what are you nominating/);
  /* a task named in a form offers its page too */
  r = said(['donate', 'cinekind']);
  assert.deepEqual(r.chips, ['Nominate for CineKind', 'See the CineKind page', 'Carry on here']);
  r = said(['donate', 'cinekind', '#seepage']);
  assert.deepEqual(r.links, ['cinekind.html']);
  /* outside a form: the page, with its task beside it */
  r = said(['link to donate']);
  assert.deepEqual(r.links, ['donate.html']);
  assert.equal(r.flow, '');
  /* where a few sentences are asked, seeing is not a page request */
  r = said(['report cruelty', 'yes', 'I can see a dog being beaten near the construction site']);
  assert.equal(r.flow, 'report');
  assert.deepEqual(r.links, []);
  /* Carry on with no form is the menu, not an error */
  assert.doesNotThrow(() => said(['visit cinekind page', '#stay']));
});
