'use strict';

/* Examples as data (17 Nov 2026, borrowed from a chatbot framework's way of
   working: intents and names learnt from example sentences, and an
   evaluation run on every change). test/data/assistant-examples.json holds
   what people type and what the assistant must do; every miss the owner
   reports is added there first, "raghavendra" the first of them. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../assets/assistant-nlu.js');
const FL = require('../assets/assistant-flows.js');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'assistant-examples.json'), 'utf8'));
const NOW = Date.parse('2026-11-17T10:00:00.000Z');

/* one message, then the site's answer to its search, as the page gives it */
function ask(say) {
  const s = FL.createSession({ now: () => NOW });
  s.start();
  let o = s.hear(say);
  if (o.action && o.action.type === 'search') {
    o = s.done(o.action.id, { rows: [{ title: 'Care Guides', url: 'pet-health.html', desc: 'Plain guides to animal health.' }], passage: null, people: FL.peopleOf(o.action.question || o.action.q, DATA.people) });
  }
  return { s, o, text: o.messages.map((m) => m.text).join('\n'), links: o.messages.flatMap((m) => m.links || []), chips: o.messages.flatMap((m) => m.chips || []) };
}

test('every example does what it must', () => {
  const misses = [];
  for (const ex of DATA.examples) {
    if (ex.intent) {
      const got = (N.intentOf(ex.say)[0] || {}).id || '';
      if (got !== ex.intent) misses.push(`"${ex.say}": read as ${got || 'nothing'}, not ${ex.intent}`);
      continue;
    }
    if (ex.search) {
      const s = FL.createSession({ now: () => NOW }); s.start();
      const o = s.hear(ex.say);
      if (!(o.action && o.action.type === 'search')) misses.push(`"${ex.say}": not looked up on the site`);
      continue;
    }
    const r = ask(ex.say);
    if (ex.person) {
      if (!r.text.startsWith(ex.person)) misses.push(`"${ex.say}": answered "${r.text.slice(0, 80)}", not ${ex.person}`);
      else if (!r.links.length) misses.push(`"${ex.say}": no link to what ${ex.person} did`);
      else if (!r.chips.some((c) => c.value === '#notwho')) misses.push(`"${ex.say}": no way to say it is someone else`);
    }
    if (ex.asks) {
      if (!r.text.includes(`"${ex.asks}"`)) misses.push(`"${ex.say}": did not ask who "${ex.asks}" is: ${r.text.slice(0, 80)}`);
      const v = r.chips.map((c) => c.value);
      for (const need of ['#iam', '#track', '#nearhere', '#desk']) if (!v.includes(need)) misses.push(`"${ex.say}": no ${need}`);
      if (r.links.some((l) => /pet-health/.test(l.href))) misses.push(`"${ex.say}": guessed a page`);
    }
  }
  assert.deepEqual(misses, [], misses.join('\n'));
});

test('a name never reaches anyone the site does not name publicly', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'assistant.js'), 'utf8');
  const gather = src.slice(src.indexOf('function publicPeople()'), src.indexOf('function siteText()'));
  assert.match(gather, /get\('\/api\/med-notes'\)/);
  assert.match(gather, /get\('\/api\/wall'\)/);
  assert.match(gather, /window\.PFA_ASSIST_UNITS/);
  assert.doesNotMatch(gather, /submissions|records|registers|members|caregivers|track|admin/, 'nothing private is read to answer a name');
});

test('after a person is named, "what else did he write" is about them; "not who I meant" asks', () => {
  const s = FL.createSession({ now: () => NOW }); s.start();
  let o = s.hear('raghavendra');
  o = s.done(o.action.id, { rows: [], passage: null, people: FL.peopleOf('raghavendra', DATA.people) });
  assert.match(o.messages[0].text, /^Sunny Raghvendra Singh, Dehradun, wrote a Care Guide on the PFA site\.$/);
  o = s.hear('what else did he write');
  assert.match(o.messages[0].text, /That is everything the PFA site has from Sunny Raghvendra Singh\./);
  o = s.tap('#notwho');
  assert.match(o.messages[0].text, /Is it your name, a place, or someone who reported something\?/);
  assert.ok(o.messages[0].chips.some((c) => c.value === '#track'), 'a reporter follows their report by its number');
  assert.ok(FL.sameName('raghavendra', 'raghvendra'), 'a letter apart is the same name');
  assert.ok(!FL.sameName('ramesh', 'suresh'), 'a different name is not');
});

test('what the chat could not answer is counted for Analytics, the words only', async () => {
  const A = require('../lib/analytics');
  assert.equal(A.missOf('raghavendra'), 'raghavendra');
  assert.equal(A.missOf('my number is 9876543210, call me'), 'my number is , call me');
  assert.equal(A.missOf('status of PFA-CR-2026-00012'), 'status of');
  assert.equal(A.missOf('mail asha@example.com about the dog'), 'mail about the dog');
  assert.equal(A.missOf('560001'), '', 'nothing left: nothing kept');
  const hit = A.readHit({ p: '/index.html', q: 'raghavendra kumar 98765' }, { 'user-agent': 'Mozilla/5.0' }, Date.parse('2026-11-17T10:00:00Z'));
  assert.equal(hit.miss, 'raghavendra kumar');
  const w = A.writesFor(hit, (n) => ({ inc: n }));
  assert.deepEqual(w.main, { day: hit.day, chatMisses: { inc: 1 } }, 'not a page view');
  assert.equal(Object.values(w.chat)[0].q, 'raghavendra kumar');
  const route = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes', 'analytics.js'), 'utf8');
  assert.match(route, /col\.doc\(`\$\{hit\.day\}_chat`\)\.set\(w\.chat, \{ merge: true \}\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'assets', 'admin-analytics.js'), 'utf8'), /more\('What the chat could not answer'/);
  /* the engine says what it missed; the page counts it */
  const s = FL.createSession({ now: () => NOW }); s.start();
  let o = s.hear('ramesh');
  o = s.done(o.action.id, { rows: [], passage: null, people: [] });
  assert.equal(o.miss, 'ramesh');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'assets', 'assistant.js'), 'utf8'), /if \(o\.miss\) missed\(o\.miss, o\.missWrong\);/);
});
