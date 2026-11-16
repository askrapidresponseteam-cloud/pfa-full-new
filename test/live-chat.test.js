'use strict';

/* Live chat (owner, 16 Nov 2026: "build a chat UI for admin side, where
   people can answer questions- when online.. i.e. if one asks for a person.
   and if the answer is not available in the site data", and "live chat
   works for main site user, only if someone from admin panel is online.
   else, ask the main site user to send a query"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { memoryFirestore } = require('./_memory-firestore');
const LC = require('../lib/live-chat');
const PUBLIC = require('../lib/routes/live-chat');
const ADMIN = require('../lib/routes/admin/live-chat');
const adminAuth = require('../lib/admin-auth');
const api = require('../api/index.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const T0 = Date.parse('2026-11-16T05:00:00Z');

function call(handler, { method = 'GET', query = {}, body, ip = '203.0.113.9' } = {}, deps) {
  return new Promise((resolve) => {
    const headers = {};
    const request = { method, query, body, headers: { 'x-forwarded-for': ip, authorization: 'Bearer t' }, socket: { remoteAddress: ip }, url: '/api/x' };
    const response = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      getHeader: (k) => headers[k.toLowerCase()],
      end: (s) => { let json = {}; try { json = JSON.parse(s || '{}'); } catch (_) { json = {}; } resolve({ status: response.statusCode, json, headers }); }
    };
    Promise.resolve(handler(request, response, deps));
  });
}

function setup() {
  const db = memoryFirestore();
  let now = T0;
  const clock = { now: () => now, at: (ms) => { now = ms; } };
  LC.forgetOnline();
  Object.values(PUBLIC._private.stores).forEach((m) => m.clear());
  const site = PUBLIC.createHandler({ getDb: () => db, now: clock.now });
  const panel = (who, opts) => call(ADMIN, opts, { getDb: () => db, now: clock.now });
  return { db, clock, site: (opts) => call(site, opts), panel };
}

const real = adminAuth.identify;
const AS = (who) => { adminAuth.identify = async () => who; };
const GAURI = { mode: 'firebase', uid: 'u-gauri', email: 'gaurimaulekhi@gmail.com', name: 'Gauri Maulekhi', role: 'super', modules: [] };
const STAFF_NO = { mode: 'firebase', uid: 'u-2', email: 's@pfa.test', name: 'Sam', role: 'staff', modules: ['submissions'] };
test.after(() => { adminAuth.identify = real; });

test('no one available: the site says so, and a chat cannot be started', async () => {
  const { site } = setup();
  assert.deepEqual((await site()).json, { ok: true, online: false });
  const r = await site({ method: 'POST', body: { action: 'start', text: 'Can someone help?' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'NO_ONE');
});

test('someone available: a chat is started, taken, answered both ways, and ended', async () => {
  const { site, panel, clock, db } = setup();
  AS(GAURI);
  assert.equal((await panel(GAURI, { method: 'POST', body: { action: 'presence', available: true } })).json.available, true);
  assert.equal((await site()).json.online, true);

  const s = await site({ method: 'POST', body: { action: 'start', text: '  Is the  Delhi shelter open on Sunday?  ', page: 'sgacc.html', lang: 'en' } });
  assert.equal(s.status, 201);
  assert.match(s.json.id, /^LC[0-9A-F]{16}$/);
  const { id, token } = s.json;
  const stored = db.dump()[`live_chats/${id}`];
  assert.ok(stored.tokenHash && !JSON.stringify(stored).includes(token), 'only the token\'s hash is kept');
  assert.equal(stored.messages[0].text, 'Is the Delhi shelter open on Sunday?');

  let list = (await panel(GAURI)).json;
  assert.equal(list.me.available, true);
  assert.deepEqual(list.online, [{ uid: 'u-gauri', name: 'Gauri' }]);
  assert.equal(list.chats.length, 1);
  assert.equal(list.chats[0].status, 'waiting');
  assert.equal(list.chats[0].awaiting, true);
  assert.equal(list.chats[0].page, 'sgacc.html');

  clock.at(T0 + 20000);
  const reply = await panel(GAURI, { method: 'POST', body: { action: 'send', id, text: 'Yes, the wards are open 24 hours.' } });
  assert.equal(reply.json.chat.status, 'open', 'answering a waiting chat takes it');
  assert.deepEqual(reply.json.chat.takenBy, { uid: 'u-gauri', name: 'Gauri' }, 'no email in what the panel lists');

  const look = (await site({ query: { id, token, after: '1' } })).json;
  assert.equal(look.status, 'open');
  assert.equal(look.staff, 'Gauri');
  assert.deepEqual(look.messages.map((m) => [m.from, m.name, m.text]), [['system', '', 'Gauri from PFA joined the chat.'], ['staff', 'Gauri', 'Yes, the wards are open 24 hours.']]);
  assert.ok(!JSON.stringify(look).includes('gaurimaulekhi'), 'the visitor never sees an email');

  assert.equal((await site({ method: 'POST', body: { action: 'send', id, token, text: 'Thank you!' } })).status, 200);
  const chat = (await panel(GAURI, { query: { id } })).json.chat;
  assert.deepEqual(chat.messages.map((m) => m.from), ['visitor', 'system', 'staff', 'visitor']);

  /* a wrong token is not this chat */
  assert.equal((await site({ query: { id, token: 'x'.repeat(48) } })).status, 404);
  assert.equal((await site({ method: 'POST', body: { action: 'send', id, token: 'nope', text: 'hi' } })).status, 404);

  await panel(GAURI, { method: 'POST', body: { action: 'close', id } });
  const after = (await site({ query: { id, token, after: '4' } })).json;
  assert.equal(after.status, 'closed');
  assert.equal(after.closedBy, 'staff');
  assert.equal(after.messages[0].text, 'Gauri from PFA ended the chat.');
  assert.equal((await site({ method: 'POST', body: { action: 'send', id, token, text: 'one more' } })).status, 409);
  list = (await panel(GAURI, { query: { closed: '1' } })).json;
  assert.equal(list.chats.length, 0);
  assert.equal(list.closed.length, 1);
});

test('available lasts while the panel says so: 75 seconds without a word and the site stops offering a chat', async () => {
  const { site, panel, clock } = setup();
  AS(GAURI);
  await panel(GAURI, { method: 'POST', body: { action: 'presence', available: true } });
  clock.at(T0 + 60000);
  LC.forgetOnline();
  assert.equal((await site()).json.online, true);
  clock.at(T0 + 80000);
  LC.forgetOnline();
  assert.equal((await site()).json.online, false);
  await panel(GAURI, { method: 'POST', body: { action: 'presence', available: true } });
  await panel(GAURI, { method: 'POST', body: { action: 'presence', available: false } });
  assert.equal((await site()).json.online, false, 'switching off is at once');
});

test('the visitor can end it; a visitor gone 15 minutes is closed as left', async () => {
  const { site, panel, clock } = setup();
  AS(GAURI);
  await panel(GAURI, { method: 'POST', body: { action: 'presence', available: true } });
  const a = (await site({ method: 'POST', body: { action: 'start', text: 'first' } })).json;
  const b = (await site({ method: 'POST', body: { action: 'start', text: 'second' } })).json;
  await site({ method: 'POST', body: { action: 'end', id: a.id, token: a.token } });
  clock.at(T0 + 16 * 60000);
  const list = (await panel(GAURI, { query: { closed: '1' } })).json;
  assert.equal(list.chats.length, 0);
  const by = Object.fromEntries(list.closed.map((c) => [c.id, c.closedBy]));
  assert.deepEqual(by, { [a.id]: 'visitor', [b.id]: 'left' });
});

test('only someone with the Live chat module answers; the rest are refused', async () => {
  const { panel } = setup();
  AS(STAFF_NO);
  const r = await panel(STAFF_NO);
  assert.equal(r.status, 403);
  assert.equal(r.json.module, 'livechat');
  AS(Object.assign({}, STAFF_NO, { modules: ['livechat'] }));
  assert.equal((await panel(STAFF_NO)).status, 200);
});

test('a flood is braked, an empty or overlong message is handled', async () => {
  const { site, panel } = setup();
  AS(GAURI);
  await panel(GAURI, { method: 'POST', body: { action: 'presence', available: true } });
  assert.equal((await site({ method: 'POST', body: { action: 'start', text: '   ' } })).status, 400);
  const long = (await site({ method: 'POST', body: { action: 'start', text: 'a'.repeat(5000) } })).json;
  assert.equal(long.ok, true);
  for (let i = 0; i < 4; i++) await site({ method: 'POST', body: { action: 'start', text: 'again ' + i } });
  assert.equal((await site({ method: 'POST', body: { action: 'start', text: 'too many' } })).status, 429);
  assert.equal((await site({ method: 'POST', body: { action: 'start', text: 'other place' }, ip: '198.51.100.4' })).status, 201);
});

test('wired in: its routes, its module, rules that keep browsers out', () => {
  assert.equal(api._private.ROUTES['live-chat'], './live-chat.js');
  assert.equal(api._private.ROUTES['admin/live-chat'], './admin/live-chat.js');
  assert.ok(require('../lib/admin-modules').MODULES.some((m) => m.key === 'livechat' && m.label === 'Live chat'));
  const rules = read('firestore.rules');
  assert.match(rules, /match \/live_chats\/\{id\} +\{ allow read, write: if false; \}/);
  assert.match(rules, /match \/live_chat_staff\/\{id\} +\{ allow read, write: if false; \}/);
});

/* ---- the site's chat ---- */
const FL = require('../assets/assistant-flows.js');
const N = require('../assets/assistant-nlu.js');

test('asking for a person is understood, in English and Hindi; a person in a report is not', () => {
  for (const s of ['I want to talk to a person', 'can I speak to someone from PFA?', 'human please', 'live chat', 'kisi se baat karni hai', 'किसी से बात करनी है']) assert.equal(N.personOf(s), true, s);
  for (const s of ['someone is beating a dog', 'a person hit my dog', 'I want to donate', 'I am a human rights lawyer and want to volunteer']) assert.equal(N.personOf(s), false, s);
});

test('no one available: the visitor is asked to send their question to the help desk', () => {
  const s = FL.createSession({ lang: 'en', live: () => false });
  s.start();
  const o = s.hear('I want to talk to a person');
  assert.equal(o.action, null);
  assert.match(o.messages[0].text, /No one from PFA is on the chat right now\. Send your question to the help desk/);
  assert.deepEqual(o.messages[0].chips.map((c) => c.value), ['#desk', '#menu']);
  assert.equal(s.tap('#desk').messages.some((m) => /help desk answers by email/.test(m.text)), true);
});

test('someone available: a chat starts, their replies show with their name, and it ends', () => {
  let t = 0;
  const s = FL.createSession({ lang: 'en', live: () => true, now: () => t });
  s.start();
  let o = s.hear('can I talk to someone');
  assert.equal(o.action.type, 'live-start');
  assert.equal(o.action.text, 'can I talk to someone');
  s.live({ type: 'started', id: 'LC1', token: 'tok', seq: 1 });
  assert.equal(s.hear('hello?').action.type, 'live-send', 'what they type goes to the person');
  o = s.live({ type: 'news', status: 'open', staff: 'Gauri', seq: 3, online: true, messages: [{ n: 2, from: 'system', text: 'x' }, { n: 3, from: 'staff', name: 'Gauri', text: 'Hi, how can I help?' }] });
  assert.deepEqual(o.messages, [{ text: 'Gauri from PFA has joined.' }, { text: 'Hi, how can I help?', from: 'Gauri' }]);
  assert.equal(s.live({ type: 'news', status: 'open', staff: 'Gauri', seq: 3, messages: [] }).messages.length, 0, 'nothing twice');
  o = s.live({ type: 'news', status: 'closed', closedBy: 'staff', seq: 4, messages: [] });
  assert.equal(o.messages[0].text, 'Gauri has ended the chat. Thank you for writing to PFA.');
  assert.equal(s.state().phase, 'menu');
});

test('no one picks it up in 3 minutes: keep waiting, or the help desk with what they wrote', () => {
  let t = 0;
  const s = FL.createSession({ lang: 'en', live: () => true, now: () => t });
  s.start();
  s.hear('talk to a human about a stray cow');
  s.live({ type: 'started', id: 'LC2', token: 't2', seq: 1 });
  t = 3 * 60000 + 1;
  const o = s.live({ type: 'news', status: 'waiting', seq: 1, online: true, messages: [] });
  assert.deepEqual(o.messages[0].chips.map((c) => c.value), ['#wait', '#desk']);
  const d = s.tap('#desk');
  assert.deepEqual(d.action, { id: d.action.id, type: 'live-end', chat: 'LC2', token: 't2' });
  assert.equal(s.state().data.question, 'talk to a human about a stray cow');
});

test('the site has no answer: a person is offered while someone is available, the help desk otherwise', () => {
  for (const [on, label] of [[true, 'Chat with someone at PFA'], [false, 'Ask PFA\'s help desk']]) {
    const s = FL.createSession({ lang: 'en', live: () => on });
    s.start();
    const a = s.hear('Do you sell aquarium fish food?');
    const o = s.done(a.action.id, { rows: [] });
    assert.equal(o.messages[0].chips[0].label, label);
    if (on) assert.match(o.messages[0].text, /Someone at PFA is on the chat now/);
  }
});

test('the panel: its own section on the rail, after Submissions, with a count waiting', () => {
  const admin = read('admin.html');
  assert.match(admin, /data-tab="submissions">Submissions<span class="pip" id="pipWaiting" hidden>0<\/span><\/button>\s+<button class="tab" type="button" data-tab="livechat">Live chat<span class="pip" id="pipLive" hidden>0<\/span><\/button>/);
  assert.match(admin, /livechat: \{ title: 'Live chat', module: 'livechat', needs: 'livechat' \}/);
  assert.match(admin, /<script src="assets\/admin-live-chat\.js"><\/script>/);
  assert.match(admin, /if \(can\('livechat'\) && window\.PFALiveChat\) window\.PFALiveChat\.watch\(\);/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-live-chat\.js'/);
  const js = read('assets/admin-live-chat.js');
  assert.match(js, /Available for chat/);
  assert.match(js, /var BEAT_MS = 20000;/);
  assert.doesNotMatch(js + read('lib/live-chat.js'), /[–—]/, 'no long dashes');
});


/* ---- v1.589: fast, several people, offline, edge cases (owner, 16 Nov 2026:
   "make chat work super fast ... enterprise grade. like whatsapp grade",
   "how will chat be handled when multiple users are there in admin",
   "when the person goes offline. end user needs to know ... diff color",
   "no new chat should be allowed", "edge cases everything") ---- */

const KARTHIK = { mode: 'firebase', uid: 'u-k', email: 'k@pfa.test', name: 'Karthik Dhanya', role: 'super', modules: [] };
async function twoOn() {
  const t = setup();
  AS(GAURI); await t.panel(GAURI, { method: 'POST', body: { action: 'presence', available: true } });
  AS(KARTHIK); await t.panel(KARTHIK, { method: 'POST', body: { action: 'presence', available: true } });
  return t;
}

test('two people: the first reply takes the chat; the other cannot write into it without Take over, and the visitor is told who answers', async () => {
  const t = await twoOn();
  const { id, token } = (await t.site({ method: 'POST', body: { action: 'start', text: 'Help please', cid: 'abc123x' } })).json;
  AS(GAURI);
  assert.equal((await t.panel(GAURI, { method: 'POST', body: { action: 'send', id, text: 'Hello, Gauri here', cid: 'g1aaaaa' } })).status, 200);
  AS(KARTHIK);
  let k = await t.panel(KARTHIK, { method: 'POST', body: { action: 'send', id, text: 'Karthik here', cid: 'k1aaaaa' } });
  assert.equal(k.status, 409);
  assert.equal(k.json.code, 'TAKEN');
  assert.match(k.json.message, /Gauri is answering this chat\. Take it over to reply\./);
  const listK = (await t.panel(KARTHIK)).json.chats[0];
  assert.equal(listK.mine, false);
  assert.deepEqual(listK.takenBy, { uid: 'u-gauri', name: 'Gauri' });
  k = await t.panel(KARTHIK, { method: 'POST', body: { action: 'take', id, force: true } });
  assert.equal(k.status, 200);
  assert.equal(k.json.chat.mine, true);
  const v = (await t.site({ query: { id, token, after: '0' } })).json;
  assert.equal(v.staff, 'Karthik');
  assert.ok(v.messages.some((m) => m.text === 'Karthik from PFA took over from Gauri.'));
});

test('a send tried twice is one message, and each side sees what the other has read', async () => {
  const t = await twoOn();
  AS(GAURI);
  const { id, token } = (await t.site({ method: 'POST', body: { action: 'start', text: 'First', cid: 'first01' } })).json;
  const a = await t.site({ method: 'POST', body: { action: 'send', id, token, text: 'Again', cid: 'dupe001' } });
  const b = await t.site({ method: 'POST', body: { action: 'send', id, token, text: 'Again', cid: 'dupe001' } });
  assert.equal(a.json.n, b.json.n, 'the same message number');
  const r = await t.panel(GAURI, { method: 'POST', body: { action: 'send', id, text: 'Reply', cid: 'rep0001' } });
  const replyN = r.json.chat.seq;
  await t.panel(GAURI, { method: 'POST', body: { action: 'send', id, text: 'Reply', cid: 'rep0001' } });
  let chat = (await t.panel(GAURI, { query: { id } })).json.chat;
  assert.equal(chat.messages.filter((m) => m.text === 'Again').length, 1);
  assert.equal(chat.messages.filter((m) => m.text === 'Reply').length, 1);
  assert.equal(chat.visitorSeenN, 0);
  /* the visitor's page shows it, and says so */
  await t.site({ query: { id, token, after: '0', seen: String(replyN) } });
  chat = (await t.panel(GAURI, { query: { id } })).json.chat;
  assert.equal(chat.visitorSeenN, replyN, 'Seen');
  /* and the person answering read the visitor's latest */
  await t.site({ method: 'POST', body: { action: 'send', id, token, text: 'Thanks', cid: 'thanks1' } });
  const before = (await t.site({ query: { id, token, after: '99' } })).json.staffSeenN;
  const seq = (await t.panel(GAURI, { query: { id } })).json.chat.seq;
  await t.panel(GAURI, { query: { id, seen: String(seq) } });
  assert.ok((await t.site({ query: { id, token, after: '99' } })).json.staffSeenN > before);
});

test('typing shows on the other side for a few seconds', async () => {
  const t = await twoOn();
  AS(GAURI);
  const { id, token } = (await t.site({ method: 'POST', body: { action: 'start', text: 'Hi' } })).json;
  await t.panel(GAURI, { method: 'POST', body: { action: 'take', id } });
  await t.site({ method: 'POST', body: { action: 'typing', id, token } });
  assert.equal((await t.panel(GAURI, { query: { id } })).json.chat.visitorTyping, true);
  await t.panel(GAURI, { method: 'POST', body: { action: 'typing', id } });
  assert.equal((await t.site({ query: { id, token } })).json.staffTyping, true);
  t.clock.at(T0 + 10000);
  assert.equal((await t.site({ query: { id, token } })).json.staffTyping, false);
});

test('the person answering goes offline: the visitor is told, what they write is marked away and the chat is first, in amber, until answered', async () => {
  const t = await twoOn();
  AS(GAURI);
  const { id, token } = (await t.site({ method: 'POST', body: { action: 'start', text: 'Hi' } })).json;
  await t.panel(GAURI, { method: 'POST', body: { action: 'send', id, text: 'Hello', cid: 'hello01' } });
  await t.panel(GAURI, { method: 'POST', body: { action: 'presence', available: false } });
  LC.forgetOnline();
  const v = (await t.site({ query: { id, token } })).json;
  assert.equal(v.staffOnline, false, 'the visitor is told');
  assert.equal(v.online, true, 'someone else is still on');
  const sent = await t.site({ method: 'POST', body: { action: 'send', id, token, text: 'are you there?', cid: 'away001' } });
  assert.equal(sent.json.away, true);
  AS(KARTHIK);
  const row = (await t.panel(KARTHIK)).json.chats[0];
  assert.equal(row.away, 1, 'came in while away');
  assert.equal(row.ownerOnline, false);
  const chat = (await t.panel(KARTHIK, { query: { id } })).json.chat;
  assert.equal(chat.messages.find((m) => m.text === 'are you there?').away, true);
  assert.equal(chat.messages.find((m) => m.text === 'are you there?').awayOf, 'Gauri', 'whose absence it was');
  /* answered: no longer away */
  await t.panel(KARTHIK, { method: 'POST', body: { action: 'send', id, text: 'Karthik here, I can help', cid: 'kk00001', force: true } });
  assert.equal((await t.panel(KARTHIK)).json.chats[0].away, 0);
});

test('nobody available: no new chat starts; one already open keeps its messages', async () => {
  const t = await twoOn();
  AS(GAURI);
  const { id, token } = (await t.site({ method: 'POST', body: { action: 'start', text: 'Hi' } })).json;
  await t.panel(GAURI, { method: 'POST', body: { action: 'presence', available: false } });
  AS(KARTHIK); await t.panel(KARTHIK, { method: 'POST', body: { action: 'presence', available: false } });
  LC.forgetOnline();
  const s2 = await t.site({ method: 'POST', body: { action: 'start', text: 'New one' }, ip: '198.51.100.7' });
  assert.equal(s2.status, 409);
  assert.equal(s2.json.code, 'NO_ONE');
  const kept = await t.site({ method: 'POST', body: { action: 'send', id, token, text: 'still here', cid: 'still01' } });
  assert.equal(kept.status, 200);
  assert.equal(kept.json.away, true);
});

test('the visitor gone 15 minutes with nothing answered: closed and marked unanswered', async () => {
  const t = await twoOn();
  const { id } = (await t.site({ method: 'POST', body: { action: 'start', text: 'Anyone?' } })).json;
  t.clock.at(T0 + 16 * 60000);
  AS(GAURI);
  const l = (await t.panel(GAURI, { query: { closed: '1' } })).json;
  const c = l.closed.find((x) => x.id === id);
  assert.equal(c.closedBy, 'left');
  assert.equal(c.unanswered, 1);
});

test('the site\'s chat: the person answering going offline and coming back is said in a line; a take over is said too', () => {
  let t0 = 0;
  const s = FL.createSession({ lang: 'en', live: () => true, now: () => t0 });
  s.start();
  s.hear('talk to a person');
  s.live({ type: 'started', id: 'LC1', token: 't', seq: 1 });
  s.live({ type: 'news', status: 'open', staff: 'Gauri', staffOnline: true, seq: 2, messages: [] });
  let o = s.live({ type: 'news', status: 'open', staff: 'Gauri', staffOnline: false, seq: 2, messages: [] });
  assert.match(o.messages[0].text, /^Gauri has gone offline\. Your messages are kept, and Gauri will answer here when back\./);
  assert.deepEqual(o.messages[0].chips.map((c) => c.value), ['#desk', '#endlive']);
  assert.equal(s.live({ type: 'news', status: 'open', staff: 'Gauri', staffOnline: false, seq: 2, messages: [] }).messages.length, 0, 'said once');
  o = s.live({ type: 'news', status: 'open', staff: 'Gauri', staffOnline: true, seq: 2, messages: [] });
  assert.equal(o.messages[0].text, 'Gauri is back online.');
  o = s.live({ type: 'news', status: 'open', staff: 'Karthik', staffOnline: true, seq: 3, messages: [] });
  assert.equal(o.messages[0].text, 'Karthik from PFA is answering now.');
  const send = s.hear('hello');
  assert.equal(send.action.type, 'live-send');
  assert.match(send.action.cid, /^v[a-z0-9]{6,}$/);
  assert.equal(send.cid, send.action.cid, 'the bubble and the send share the id');
});

test('the visitor\'s page: Sending, Sent, Seen and Not sent; typing; quick checks', () => {
  const js = read('assets/assistant.js');
  assert.match(js, /var TICK = \{ sending: \['Sending', ''\], sent: \['\u2713', 'Sent'\], seen: \['\u2713\u2713', 'Seen'\], failed: \['Not sent\. Tap to send again', ''\] \};/);
  assert.match(js, /return Date\.now\(\) - liveActive < 60000 \? 1000 : 3000;/, 'every second while lively');
  assert.match(js, /post\(\{ action: 'typing', id: st\.live\.id, token: st\.live\.token \}\)/);
  assert.match(js, /'&seen=' \+ \(l\.seq \|\| 0\)/);
  const panel = read('assets/admin-live-chat.js');
  assert.match(panel, /Came in while away/);
  assert.match(panel, /data-lc-take="force">Take over</);
  assert.match(panel, /Copy transcript/);
  assert.match(panel, /new Notification\(title/);
  assert.match(panel, /window\.addEventListener\('storage'/, 'one switch for every tab');
  assert.match(panel, /return Date\.now\(\) - L\.activeAt < 60000 \? 1000 : 2500;/);
  assert.doesNotMatch(panel + js + read('lib/live-chat.js'), /[–—]/);
});
