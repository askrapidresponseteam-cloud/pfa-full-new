'use strict';

/* The chat knows every page the site has, the day it is added (owner,
   27 Nov 2026: "the chatbot always needs to get updated whenever something
   small or big gets added to the site.."; "partner" had been answered "I
   could not find Partner on the site").

   scripts/build-answer-index.js writes every public page into the chat's
   index by its own names (its title, the name the menu or the footer gives
   it, its description) at every build. Here the chat is asked for each of
   them as a visitor would, through the same search and the same paragraphs
   the browser uses: by its name in the menu, by its title, and by the one
   word that names it. A page added to the site that the chat cannot reach
   fails here, with no list kept by hand. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FL = require('../assets/assistant-flows.js');
const BUILD = require('../scripts/build-answer-index.js');
const SEARCH = require('../scripts/build-search-index.js');

const IX = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'assistant-answers.json'), 'utf8'));
const DOCS = IX.passages.map((p) => ({ title: p.t, url: p.u, heading: p.h, text: p.x }));

/* the site's own search, as the browser runs it */
const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://pfa.test/index.html' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'search-index.js'), 'utf8'));
dom.window.eval(fs.readFileSync(path.join(ROOT, 'pfa-search.js'), 'utf8'));
const PS = dom.window.PFASearch;

/* what assets/assistant.js does with a search the chat asks for */
function ask(text) {
  const s = FL.createSession({ docs: () => DOCS, pages: () => IX.pages, page: () => 'index.html' });
  s.start();
  let o = s.hear(text);
  for (let n = 0; o.action && o.action.type === 'search' && n < 3; n += 1) {
    const a = o.action;
    const found = PS.search(a.q, { limit: 5 });
    const rows = found && found.via !== 'closest' ? (found.rows || []).map((r) => ({ title: r.t, url: r.u, desc: r.d || '' })) : [];
    let passage = null;
    try { passage = FL.passageOf([a.q, a.question].filter(Boolean).join(' '), DOCS, null, 'index.html'); } catch (_) { passage = null; }
    o = s.done(a.id, { rows, passage, people: [] });
  }
  return {
    flow: s.state().flow,
    links: o.messages.flatMap((m) => (m.links || []).map((l) => String(l.href).replace(/^\//, '').split('#')[0])),
    text: o.messages.map((m) => m.text).join(' / ')
  };
}

/* a page whose name is a task: the chat starts the task (its form) */
const TASK_PAGE = {
  donate: ['donate.html'], internship: ['internship.html', 'intern-guide.html'], report: ['report.html'],
  track: ['track.html'], nearby: ['units.html'], verify: ['verify-certificate.html']
};
function reaches(r, page) {
  return r.links.includes(page) || Boolean(r.flow && (TASK_PAGE[r.flow] || []).includes(page))
    || (page === 'shop.html' && /^Opening the shop/.test(r.text));
}
const head = (p) => String(p.t).split(/\s*:\s*/)[0];

test('the chat\'s index carries every public page by its names, as built', () => {
  const built = BUILD.build();
  assert.deepEqual(IX.pages, built.pages, 'assets/assistant-answers.json is out of date: run node scripts/build-answer-index.js');
  const pub = SEARCH.publicPages().filter((f) => f !== 'index.html'
    && !/<meta name="robots" content="noindex/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(IX.pages.map((p) => p.u).sort(), pub.sort(), 'every public page, and only those');
  for (const p of IX.pages) {
    assert.ok(p.t && !/People for Animals$/.test(p.t), `${p.u} has its own title`);
    assert.ok(p.d, `${p.u} has a description the chat can say`);
  }
  assert.equal(IX.pages.find((p) => p.u === 'partners.html').l, 'Partners in giving');
});

test('every page, asked for by its name in the menu or its title, is answered with that page', () => {
  const missed = [];
  for (const p of IX.pages) {
    for (const q of new Set([p.l, head(p)].filter(Boolean))) {
      /* a title that is itself a question is answered, not named */
      if (/\?\s*$/.test(q)) continue;
      const r = ask(q);
      if (!reaches(r, p.u)) missed.push(`${p.u} asked as "${q}": ${r.links.join(' ') || r.text.slice(0, 80)}`);
    }
  }
  assert.deepEqual(missed, []);
});

test('every page, asked for by the one word that names it, is among the pages the chat gives', () => {
  const plain = /^(the|and|for|with|pfa|people|animal|animals|page|site|about|your|our|find|help|near|you|what|says|thank|test|yourself|plan|leave|check|track|get|involved|report)$/;
  const missed = [];
  for (const p of IX.pages) {
    const words = (String(p.l || head(p)).toLowerCase().match(/[a-z’']+/g) || []).filter((w) => w.length >= 4 && !plain.test(w));
    if (!words.length) continue;
    const r = ask(words[0]);
    if (!reaches(r, p.u)) missed.push(`${p.u} asked as "${words[0]}": ${r.links.join(' ') || r.text.slice(0, 80)}`);
  }
  assert.deepEqual(missed, []);
});

test('"partner", the word that was missed, finds Partners in giving; a name is still a name; a task is still a task', () => {
  for (const w of ['partner', 'partners', 'Partner', 'partners in giving', 'rosie\'s heroes']) {
    assert.ok(ask(w).links.includes('partners.html'), w);
  }
  assert.ok(ask('rabies').links[0] === 'rabies.html', 'Rabies opens its own page, not the Academy');
  assert.ok(ask('cinekind').links[0] === 'cinekind.html', 'CineKind opens its own page, not the newsroom');
  assert.ok(ask('the wall').links[0] === 'the-wall.html', 'The Wall opens its landing page');
  assert.match(ask('zorawar').text, /Is it your name/, 'a name no page carries is asked about, as before');
  assert.equal(ask('donate').flow, 'donate');
  assert.equal(ask('thank you').links.length, 0, 'thanks is not the thank-you page');
  assert.equal(ask('pfa pune').flow, 'nearby', 'a town is still a town');
});

test('the browser hands the chat the list of pages with the paragraphs', () => {
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'assistant.js'), 'utf8');
  assert.match(js, /pagesKept = ix && Array\.isArray\(ix\.pages\) \? ix\.pages : null;/);
  assert.equal((js.match(/docs: docsNow, pages: pagesNow, page: pageNow/g) || []).length, 2);
});

/* owner, 27 Nov 2026, of "partner" typed into the help desk's question
   ("A little more, please"), "parnter", and "need to find partner" ("Which
   animal?"): "what nonsense reply is this" */
test('a page named inside a form, with a slip of the keys, or with a wish around it, is the page; the form is kept', () => {
  const s = FL.createSession({ docs: () => DOCS, pages: () => IX.pages, page: () => 'index.html' });
  s.start();
  s.tap('#desk');
  assert.equal(s.state().flow, 'helpdesk');
  let o = s.hear('partner');
  assert.ok(o.messages.some((m) => (m.links || []).some((l) => l.href === 'partners.html')), 'the page, not "A little more, please"');
  assert.ok(o.messages.some((m) => (m.chips || []).some((c) => c.value === '#stay' && /Carry on with my question/.test(c.label))));
  assert.equal(s.state().flow, 'helpdesk', 'the question is kept');
  o = s.tap('#stay');
  assert.match(o.messages.map((m) => m.text).join(' '), /What would you like to ask PFA\?/);
  /* a real question is still a question */
  o = s.hear('My neighbour keeps beating the dog he owns, what can I do about it legally?');
  assert.ok(!o.messages.some((m) => (m.links || []).some((l) => l.href === 'partners.html')));
  for (const w of ['parnter', 'need to find partner', 'i want to partner with pfa', 'find partner']) {
    assert.ok(ask(w).links.includes('partners.html'), w);
  }
});

/* review of 27 Nov 2026 (the frontend-developer agent): a near word is not a
   page, a task keeps its own page, and a short question said again after
   "Carry on" is the question */
test('near words, tasks with their own page, and a question said twice', () => {
  for (const w of ['Carmen', 'callers']) assert.ok(!ask(w).links.includes('careers.html'), w);
  assert.ok(!ask('dog').links.includes('laws.html'), 'one animal word is not the law page');
  assert.ok(!ask('police').links.includes('achievements.html'));
  assert.ok(!ask('course').links.includes('careers.html'));
  assert.equal(ask('caregiver').links[0], 'get-involved.html', 'the caregiver card, not Care Guides');
  const s = FL.createSession({ docs: () => DOCS, pages: () => IX.pages, page: () => 'index.html' });
  s.start();
  s.tap('#desk');
  s.hear('animal cruelty');
  s.tap('#stay');
  const again = s.hear('animal cruelty');
  assert.ok(!again.messages.some((m) => (m.chips || []).some((c) => c.value === '#stay')), 'said again, it is the answer, not the page once more');
});
