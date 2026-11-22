'use strict';

/* The chat answers what the site knows, correctly (owner, 22 Nov 2026,
   screenshots of "do u have a unit in ahmedabad" answered with "Where are
   you?", then "just tell me if u do" answered "There is no PFA unit listed
   near there": "chat bot isnt actually answering correctly", "these are
   very simple questions", and "enrich the knowledge base of the bot so that
   it is able to answer each and every answer known to it correctly from
   the website").

   Driven the way the browser drives it (assets/assistant.js): the real
   session, its look-ups answered from the site's own data (the units list,
   India Post's directory kept with the site, the site's paragraphs). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FL = require('../assets/assistant-flows.js');
const PINS = require('../lib/pin-directory.js');
const PLACES = require('../lib/pin-places.js');

const UNITS = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'assets/assistant-units.js'), 'utf8'))(w); return w.PFA_ASSIST_UNITS; })();
const DOCS = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/assistant-answers.json'), 'utf8')).passages.map((p) => ({ title: p.t, url: p.u, heading: p.h, text: p.x }));

function placeOf(text) {
  if (/^[1-9]\d{5}$/.test(text)) {
    const k = PINS.find(text);
    if (!k) return null;
    const spot = PLACES.placeOf({ pin: text, state: k.state, district: k.district });
    return Object.assign({}, k, spot ? { at: spot.at } : {});
  }
  const f = PINS.town(text);
  if (!f) return null;
  const spot = PLACES.placeOf({ state: f.state, district: f.district });
  return Object.assign(f, spot ? { at: spot.at } : {});
}
/* the browser's look-ups, as assets/assistant.js makes them */
function settle(s, o) {
  for (let i = 0; o && o.action && i < 4; i++) {
    const a = o.action;
    if (a.type === 'nearby') {
      const place = String(a.place || '');
      const mine = FL.unitsNear(UNITS, { text: place });
      let r;
      if (!/^\d{6}$/.test(place) && mine.length && mine[0].here) r = { units: mine, place };
      else { const p = placeOf(place); r = p ? { units: FL.unitsNear(UNITS, Object.assign({ text: place }, p)), place: /^\d{6}$/.test(place) && p.district ? `${place} (${p.district})` : place } : { units: mine, place }; }
      o = s.done(a.id, r);
    } else if (a.type === 'search') {
      o = s.done(a.id, { rows: [], passage: FL.passageOf([a.q, a.question].filter(Boolean).join(' '), DOCS), people: [] });
    } else break;
  }
  return o;
}
function chat(...lines) {
  const s = FL.createSession({ now: () => Date.parse('2026-11-22T06:00:00Z'), units: UNITS, docs: DOCS });
  s.start();
  let o = null;
  const said = lines.map((l) => { o = settle(s, s.hear(l)); return o.messages.map((m) => [m.text].concat((m.list || []).map((r) => r.join(' '))).join(' ')).join(' \n '); });
  return { said, last: said[said.length - 1], o, flow: s.state().flow, links: o.messages.flatMap((m) => (m.links || []).map((l) => l.href)) };
}

test('the owner\'s conversation: the town in the question is the place, and "just tell me if u do" is not a town', () => {
  const r = chat('do u have a unit in ahmedabad');
  assert.match(r.last, /^Yes\. PFA has a unit in Ahmedabad:/);
  assert.match(r.last, /PFA Ahmedabad Mr\. Mahendra Shrimali, 09429100202/);
  assert.match(r.last, /Chandkheda, Ahmedabad, Gujarat - 382424/, 'with its address');
  assert.ok(r.links.includes('tel:09429100202'));
  assert.ok(r.links.includes('mailto:mahendrashrimali@hotmail.com'), 'and its email');
  /* asked for a place, answered with a sentence: asked again, never "no unit" */
  const t = chat('find a pfa unit near me', 'just tell me if u do', 'ahmedabad');
  assert.match(t.said[0], /Where are you\?/);
  assert.match(t.said[1], /^Which town or city\? For example Ahmedabad, or a 6-digit PIN code like 380001\./);
  assert.doesNotMatch(t.said[1], /no PFA unit/);
  assert.match(t.said[2], /^Yes\. PFA has a unit in Ahmedabad:/);
});

test('every unit, asked about in plain words, says yes and names it; every state with units lists them', () => {
  const wrong = [];
  for (const u of UNITS) {
    const c = u.c.replace(/\s*\(.*?\)/g, '').split('/').pop().replace(/\s+(I|II)$/, '').trim();
    for (const q of [`do you have a unit in ${c}`, `pfa ${c}`, c, `contact number of pfa ${c}`, `${c} mein pfa unit hai kya`]) {
      const r = chat(q).last;
      if (!/^(Yes\.|हाँ।)/.test(r) || !r.includes('PFA ' + u.c)) wrong.push(`${q} => ${r.slice(0, 80)}`);
    }
  }
  for (const st of [...new Set(UNITS.map((u) => u.s))]) {
    const r = chat(`units in ${st}`).last;
    if (!/^Yes\./.test(r) || !r.includes('PFA ' + UNITS.find((u) => u.s === st).c)) wrong.push(`units in ${st} => ${r.slice(0, 80)}`);
  }
  assert.deepEqual(wrong, []);
});

test('a town with no unit: the nearest, with how far, from India Post\'s directory kept with the site', () => {
  const chennai = chat('is there pfa in chennai').last;
  assert.match(chennai, /^PFA has no unit in Chennai itself\. The nearest:/);
  assert.match(chennai, /PFA Tambaram .*about \d+ km away/);
  assert.match(chat('nearest unit to udupi').last, /PFA Hubli|PFA Mysore/);
  assert.match(chat('unit near 576101').last, /576101 \(Udupi\)/);
  assert.match(chat('pfa pune').last, /PFA Panchgani/);
  /* old names and India Post's own spellings */
  for (const [said, district] of [['Bangalore', 'Bengaluru'], ['Bombay', 'Mumbai'], ['Gurgaon', 'Gurugram'], ['Kundapur', 'Udupi'], ['Ooty', 'Nilgiris'], ['Manipal', 'Udupi']]) {
    const f = PINS.town(said);
    assert.ok(f && f.district.includes(district), `${said} is in ${district}: ${JSON.stringify(f)}`);
  }
  assert.equal(PINS.town('just tell me if u do'), null);
  assert.equal(PINS.town('xyz'), null);
});

test('the site\'s own words answer a question before a task is guessed from one of its words', () => {
  const cases = [
    ['can i donate in dollars', /PayPal/],
    ['can i donate in someone\'s name', /someone's behalf|in their name|Certificate of Appreciation/],
    ['is animal cruelty a crime', /Section/],
    ['what is the punishment for killing a dog', /Section|BNS|years/],
    ['can my society stop me from feeding dogs', /resident association|RWA/i],
    ['are pets allowed in lifts', /lift/i],
    ['what do i get with lifetime membership', /Lifetime membership costs ₹10,000/],
    ['how much is membership', /Student ₹500/],
    ['how much does an animal ambulance cost to sponsor', /ambulance/i],
    ['when were the cinekind awards', /2026/],
    ['how to file an fir for animal cruelty', /FIR/]
  ];
  const wrong = cases.filter(([q, re]) => !re.test(chat(q).last)).map(([q]) => `${q} => ${chat(q).last.slice(0, 100)}`);
  assert.deepEqual(wrong, []);
  /* and a wish is still the task */
  assert.equal(chat('I want to donate 500').flow, 'donate');
  assert.equal(chat('become a member').flow, 'member');
  assert.equal(chat('someone is beating a dog').flow, 'report');
  assert.equal(chat('how do i track my report').flow, 'track');
  assert.equal(chat('I want to volunteer').flow, 'volunteer');
  /* fixed answers the site states */
  assert.match(chat('what number to call in an emergency').last, /112/);
  assert.match(chat('what is people for animals').last, /India's largest animal welfare organisation/);
  assert.match(chat('how many units does pfa have').last, new RegExp(`PFA has ${UNITS.length} units in \\d+ states`));
  assert.match(chat('upcoming events').last, /events page/);
});

test('a question outside what the site covers is not answered with a stray paragraph', () => {
  assert.equal(FL.passageOf('who is the prime minister', DOCS), null);
  assert.equal(FL.passageOf('what is the weather today', DOCS), null);
});

test('what the bot reads: tables, form explanations, short lists, and what pages draw from data', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/assistant-answers.json'), 'utf8')).passages;
  const has = (re, u) => idx.some((p) => (!u || p.u.startsWith(u)) && re.test(p.x));
  assert.ok(has(/Student ₹500, Silver ₹1,000, Golden ₹2,500, Platinum ₹5,000, Lifetime ₹10,000/, 'get-involved.html'), 'membership fees');
  assert.ok(has(/CineKind Awards 2026: 4 October 2026, Mumbai/, 'events.html'), 'events');
  assert.ok(has(/costs ₹31,75,000 for a company to fund/, 'csr.html'), 'what a company can fund');
  assert.ok(has(/Prevention of Cruelty to Animals Act 1960/, 'library.html'), 'the library');
  assert.ok(has(/Diabetes in dogs/, 'pet-health.html'), 'care guides');
  assert.ok(has(/02 Director of Change Amit Rai/, 'cinekind.html'), 'a short list, read together');
  assert.ok(idx.some((p) => /^Cats/.test(p.h) && /: What helps$/.test(p.h)), 'a sub-heading keeps its section');
});

test('the town lookup the chat asks the server for: India Post\'s directory, nothing outside', async () => {
  const route = require('../lib/routes/location-lookup.js');
  const call = (query) => new Promise((resolve) => {
    const out = { statusCode: 200, headers: {} };
    route({ method: 'GET', query }, { set statusCode(v) { out.statusCode = v; }, get statusCode() { return out.statusCode; }, setHeader(k, v) { out.headers[k] = v; }, end(b) { out.body = JSON.parse(b); resolve(out); } });
  });
  const a = await call({ town: 'Manipal' });
  assert.equal(a.statusCode, 200);
  assert.equal(a.body.state, 'Karnataka');
  assert.equal(a.body.district, 'Udupi');
  assert.ok(Array.isArray(a.body.at) && a.body.at.length === 2, 'with the middle of its district');
  assert.equal((await call({ town: 'just tell me if u do' })).statusCode, 404);
  assert.equal((await call({ town: 'ab' })).statusCode, 404);
  const pin = await call({ pin: '576101' });
  assert.ok(Array.isArray(pin.body.at), 'a PIN gives its place too');
});
