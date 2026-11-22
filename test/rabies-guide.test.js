'use strict';
/* Care Guide 04, rabies (owner, 22 Nov 2026: "the rabies sheet and page
   within pfa care guide. has to be be super detailed..details .. take them
   from multiple pages in who.int/health-topics/rabies and give WHO links as
   well"): rabies.html, its PDF and cover, its card in Care Guides, and the
   chat answering a bite with the WHO's first aid. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FL = require('../assets/assistant-flows.js');
const MED = require('../lib/med-notes.js');
const UNITS = (() => { const w = {}; new Function('window', read('assets/assistant-units.js'))(w); return w.PFA_ASSIST_UNITS; })();
const DOCS = JSON.parse(read('assets/assistant-answers.json')).passages.map((p) => ({ title: p.t, url: p.u, heading: p.h, text: p.x }));

function chat(line) {
  const s = FL.createSession({ now: () => Date.parse('2026-11-22T06:00:00Z'), units: UNITS, docs: DOCS });
  s.start();
  let o = s.hear(line);
  for (let i = 0; o && o.action && o.action.type === 'search' && i < 3; i++) {
    const a = o.action;
    o = s.done(a.id, { rows: [], passage: FL.passageOf([a.q, a.question].filter(Boolean).join(' '), DOCS), people: [] });
  }
  return { text: o.messages.map((m) => m.text).join(' \n '), links: o.messages.flatMap((m) => (m.links || []).map((l) => l.href)) };
}

const page = read('rabies.html');
const main = page.slice(page.indexOf('<main>'), page.indexOf('</main>'));

test('the page: a guide in Care Guides, in eleven parts, every part with the WHO pages it comes from', () => {
  assert.match(page, /<title>Rabies: the facts \| People for Animals<\/title>/);
  assert.match(page, /<link rel="stylesheet" href="assets\/rabies-guide\.css">/);
  assert.match(main, /<a href="pet-health\.html">Care Guides<\/a> &middot; Guide 04/);
  assert.match(main, /<a class="btn" href="media\/med-notes\/rabies\.pdf" download>Download the PDF<\/a>/);
  const parts = main.match(/<article class="rb-part"[\s\S]*?<\/article>/g);
  assert.equal(parts.length, 11, 'first aid, contact, treatment, spread, dogs, people, bites, the dog, PrEP, vaccines, Zero by 30');
  for (const p of parts) assert.match(p, /<p class="rb-src">From WHO: <a href="https:\/\/(www|cdn)\.who\.int\//, 'every part says which WHO page it is from');
  const who = new Set(main.match(/https:\/\/(?:www\.|cdn\.)?who\.int\/[^"]+|https:\/\/openwho\.org\/[^"]+/g));
  assert.ok(who.size >= 9, `WHO pages linked: ${who.size}`);
  for (const a of main.match(/<a [^>]*href="https:[^"]+"[^>]*>/g)) assert.match(a, /target="_blank" rel="noopener"/);
  assert.doesNotMatch(main, /[–—]/, 'no long dash');
  /* the figures, as WHO gives them */
  for (const f of ['44,203', '99%', '40%', '70%', '15 minutes', '10 days', '2 to 3 months', '40 IU', '20 IU', 'RABIVAX-S', 'VaxiRab N', 'VERORAB', '60 to 80%', 'US$108', '28 September']) assert.ok(main.includes(f), f);
  /* no contact strip (owner, 22 Nov 2026: "remove this") */
  assert.doesNotMatch(main, /2081 8191|tel:/);
  /* the clinical detail under its +, never in the first view */
  assert.equal((main.match(/<details class="rb-more">/g) || []).length, 2);
});

test('the owner\'s photographs, each with words for a screen reader, beside the part it shows', () => {
  for (const f of ['wash', 'category-1', 'category-2', 'category-3', 'clinic', 'child', 'give-room', 'vaccination']) {
    assert.ok(fs.existsSync(path.join(ROOT, `media/med-notes/rabies/${f}.webp`)), f);
    assert.match(main, new RegExp(`<img [^>]*src="media/med-notes/rabies/${f}\\.webp" width="\\d+" height="\\d+" alt="[^"]{20,}" loading="lazy"`), f);
  }
  assert.match(main, /The photographs are illustrative scenes, not real cases/);
});

test('registered as the site\'s pages are: header, search, sitemap', () => {
  assert.match(read('scripts/sync-chrome.js'), /'rabies\.html':\s+\{ current: null,\s+group: 'laws\.html'/);
  assert.match(read('test/header-consistency.test.js'), /'rabies\.html':\s+\[null,\s+'laws\.html'\]/);
  assert.match(read('sitemap.xml'), /peopleforanimalsindia\.org\/rabies</);
  assert.match(page, /<link rel="canonical" href="https:\/\/peopleforanimalsindia\.org\/rabies">/);
});

test('the PDF is the owner\'s illustrated guide (23 Nov 2026), with its WHO links, at the size the card says', () => {
  const pdf = fs.readFileSync(path.join(ROOT, 'media/med-notes/rabies.pdf'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(pages, 11);
  assert.ok((pdf.toString('latin1').match(/\/URI ?\(https:\/\/(www\.|cdn\.)?who\.int/g) || []).length >= 5, 'the WHO links work in the PDF');
  /* never printed over from the page again: the owner's file is the guide */
  assert.ok(!fs.existsSync(path.join(ROOT, 'scripts/build-rabies-pdf.js')));
  assert.doesNotMatch(read('package.json'), /build-rabies-pdf/);
  const note = JSON.parse(read('data/med-notes.json')).notes.find((n) => n.id === 'rabies');
  assert.equal(note.files[0].size, pdf.length);
  assert.match(read('pet-health.html'), new RegExp(`href="media/med-notes/rabies\\.pdf" download>Download PDF <small>\\(${(pdf.length / 1048576).toFixed(1)} MB\\)</small>`), 'the size, as the card script writes it');
});

test('the card: Guide 04, its cover, Read guide opens the page', () => {
  const note = JSON.parse(read('data/med-notes.json')).notes.find((n) => n.id === 'rabies');
  assert.equal(note.number, 4);
  assert.equal(note.page, 'rabies.html');
  assert.equal(note.animal, 'Dogs');
  const pub = MED.seedPublic(note);
  assert.equal(pub.page, 'rabies.html');
  assert.equal(MED.seedPublic(Object.assign({}, note, { page: 'https://evil.example/x.html' })).page, '', 'only a page of the site');
  /* the owner's cover (23 Nov 2026), by a new name so no browser keeps the first */
  assert.equal(note.cover, 'media/med-notes/rabies-cover-v3.webp');
  const webp = fs.readFileSync(path.join(ROOT, note.cover));
  assert.equal(webp.toString('latin1', 8, 12), 'WEBP');
  assert.ok(!fs.existsSync(path.join(ROOT, 'media/med-notes/rabies-cover-v2.webp')));
  const ph = read('pet-health.html');
  assert.match(ph, /<li class="ph-series" id="series-dogs">[\s\S]*?<p class="ph-card__part">Guide 04<\/p>[\s\S]*?<a class="btn" href="rabies\.html">Read guide<\/a>[\s\S]*?<li class="ph-series" id="series-cows">/);
  assert.match(ph, /\(pageOf\(n\) \? '<a class="btn" href="' \+ esc\(pageOf\(n\)\) \+ '">Read guide<\/a>'/);
  assert.match(ph, /if \(n && pageOf\(n\)\) \{ location\.href = pageOf\(n\); return; \}/, 'a link to the guide in the list opens its page');
});

test('the chat: a bite gets the WHO first aid at once, in English or Hindi, and only a bite', () => {
  for (const q of ['a dog bit me what should i do', 'what to do after dog bite', 'my cat scratched me', 'puppy bit my hand', 'a monkey scratched my son']) {
    const r = chat(q);
    assert.match(r.text, /^Wash the bite or scratch at once with soap and plenty of running water for 15 minutes/, q);
    assert.ok(r.links.includes('rabies.html#bite'), q);
  }
  for (const q of ['kutte ne kaat liya kya karu', 'कुत्ते ने काट लिया']) assert.match(chat(q).text, /15 मिनट/, q);
  for (const q of ['how to stop my puppy biting', 'my cat scratches furniture', 'why does my dog keep scratching', 'snake bite on dog first aid', 'my dog is a bit sick']) assert.doesNotMatch(chat(q).text, /Wash the bite or scratch/, q);
});

test('the chat: rabies questions answered from the guide', () => {
  const cases = [
    ['symptoms of rabies in humans', /fear of water/],
    ['how long does rabies take to show', /2 to 3 months/],
    ['can rabies be cured', /^Can rabies be cured\? No\./],
    ['is rabies vaccine safe in pregnancy', /pregnan/],
    ['can i get rabies from milk', /milk/],
    ['should i wait 10 days to see if the dog dies', /^Should I wait 10 days/],
    ['world rabies day', /28 September/],
    ['does killing dogs stop rabies', /^No\. The WHO says culling free-roaming dogs does not control rabies/]
  ];
  for (const [q, re] of cases) {
    const r = chat(q);
    assert.match(r.text, re, q);
    assert.ok(r.links.some((l) => /^rabies\.html/.test(l)), `${q}: ${r.links.join(' ')}`);
  }
});
