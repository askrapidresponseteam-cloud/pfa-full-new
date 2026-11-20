'use strict';

/* The chat knows every feature the site shows (owner, 16 Nov 2026: "ensure
   chatbot know about each and every feature of the main site (visible
   ones)"). Every page in the site's menu, read from the menu itself
   (assets/chrome-header.html), and every offering beyond it, is reached
   from a plain sentence: either the chat does it there and then (a form, a
   payment, a lookup), or it answers in the page's own words with the one
   link that does it. A page added to the menu without a way in from the
   chat fails here the day it is added. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FL = require('../assets/assistant-flows.js');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-11-16T06:00:00.000Z');

function reply(text) {
  const s = FL.createSession({ now: () => NOW });
  s.start();
  let o = s.hear(text);
  /* a question is answered from the site's own words first; with no
     paragraph that answers it, the page for it */
  if (o.action && o.action.type === 'search') o = s.done(o.action.id, { rows: [] });
  const links = o.messages.flatMap((m) => (m.links || []).map((l) => l.href));
  return { flow: s.state().flow, links, text: o.messages.map((m) => m.text).join(' '), action: o.action };
}

/* what someone might say, and how the chat answers it */
const WAYS = {
  'units.html': ['find a pfa unit near me', { flow: 'nearby' }],
  'report.html': ['someone is beating a dog on my street', { flow: 'report' }],
  'newsroom.html': ['latest news from pfa', { link: 'newsroom.html' }],
  'achievements.html': ['what has pfa done, its achievements', { link: 'achievements.html' }],
  'laws.html': ['what the law says', { link: 'laws.html' }],
  'library.html': ['show me the resources library', { link: 'library.html' }],
  'academy.html': ['animal first aid lessons in the academy', { link: 'academy.html' }],
  'behaviour.html': ['why does my dog keep barking', { link: 'behaviour.html' }],
  'pet-health.html': ['care guides for pet parents', { link: 'pet-health.html' }],
  'someone.html': ['do pigs feel things, someone not something', { link: 'someone.html' }],
  'fireworks.html': ['crackers scare my dog on diwali', { link: 'fireworks.html' }],
  'quiz.html': ['test yourself quiz on farm animals', { link: 'quiz.html' }],
  'get-involved.html#volunteer': ['I want to volunteer', { flow: 'volunteer' }],
  'get-involved.html#membership': ['become a member', { flow: 'member' }],
  'get-involved.html#caregiver': ['colony caregiver card', { link: 'get-involved.html#caregiver' }],
  'campus.html': ['start a campus society at my college', { flow: 'campus' }],
  'internship.html': ['apply for the remote internship', { flow: 'internship' }],
  'gifts.html': ['seasonal gifts for diwali', { link: 'gifts.html' }],
  'campaign.html': ['plan a birthday fundraiser campaign', { flow: 'campaign' }],
  'legacy.html': ['leave a gift in my will', { flow: 'legacy' }],
  'csr.html': ['csr partnership for our company', { flow: 'csr' }],
  'wall.html': ['share my film on the wall', { flow: 'wallstory' }],
  'events.html': ['request an event in my area', { flow: 'event' }],
  'cinekind.html': ['nominate someone for cinekind', { flow: 'cinekind' }],
  'founder.html': ['who founded pfa', { link: 'founder.html' }],
  'manekas-picks.html': ['films she recommends, maneka picks', { link: 'manekas-picks.html' }],
  'sgacc.html': ['I want to help the sanjay gandhi care centre', { flow: 'sgacc' }],
  'careers.html': ['jobs at pfa', { link: 'careers.html' }],
  'ask.html': ['I have a question for pfa', { flow: 'helpdesk' }],
  'donate.html': ['I want to donate 500', { flow: 'donate' }],
  /* the shop opens in the chat itself (20 Nov 2026): its pieces are read first */
  'shop.html': ['buy a pfa t-shirt from the shop', { action: 'shop-pieces' }]
};

/* offerings that are not a page of the menu */
const MORE = [
  ['a podcast with maneka gandhi', { link: 'events.html#podcast' }],
  ['share a care guide I wrote', { link: 'pet-health.html#share' }],
  ['track my application PFA-V-2026-00003', { flow: 'track' }],
  ['is this certificate real PFA-INT-4K2M8QRT', { flow: 'verify' }],
  ['send me my donation receipt', { flow: 'receipt' }],
  ['start a new pfa unit', { link: 'units.html#apply' }],
  ['send internship task proof', { flow: 'proof' }],
  ['my data with pfa, erase it', { flow: 'privacy' }]
];

function holds(href, [said, want]) {
  const r = reply(said);
  if (want.action) return assert.equal(r.action && r.action.type, want.action, `"${said}" (${href}) should ${want.action}; got "${r.text.slice(0, 120)}"`);
  if (want.flow) assert.equal(r.flow, want.flow, `"${said}" (${href}) should start ${want.flow}; got "${r.text.slice(0, 120)}"`);
  else assert.ok(r.links.includes(want.link), `"${said}" (${href}) should link ${want.link}; got ${JSON.stringify(r.links)}: "${r.text.slice(0, 120)}"`);
}

test('every page in the site\'s menu is listed here, so none can be added without a way in from the chat', () => {
  const header = fs.readFileSync(path.join(ROOT, 'assets', 'chrome-header.html'), 'utf8');
  const menu = [...header.matchAll(/\{\{CURRENT:([^|}]+)\|/g)].map((m) => m[1]);
  assert.ok(menu.length >= 30, `${menu.length} menu entries`);
  assert.deepEqual(menu.filter((href) => !WAYS[href]), [], 'menu entries the chat does not know');
});

for (const [href, way] of Object.entries(WAYS)) {
  test(`the chat reaches ${href}: "${way[0]}"`, () => holds(href, way));
}

test('and every offering beyond the menu', () => {
  for (const way of MORE) holds(way[1].link || way[1].flow, way);
});

test('in Hindi too, for the pages that are read', () => {
  for (const [said, href] of [['पटाखे से कुत्ता डरता है', 'fireworks.html'], ['मेरे कुत्ते का व्यवहार', 'behaviour.html'], ['संसाधन पुस्तकालय', 'library.html']]) {
    const r = reply(said);
    assert.ok(r.links.includes(href), `"${said}" should link ${href}; got ${JSON.stringify(r.links)}`);
  }
});
