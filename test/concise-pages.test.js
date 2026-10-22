'use strict';

/* Short, staged, and the rest under plus signs (owner, 9 Oct 2026: "never
   make anything complicated and show more than what is needed. keep things
   super concise- like for csr. show things one after another in stages like
   you have for application.. dont bombard people with too much info or gyaan.
   show more only when one shows interest. have things under plus if need be").
   And, the same day, of a step with Continue a screen below it: "too much
   blank space. some people might think it is incomplete or under work".
   And of the footer's PFA name under a form: "pfa on top and again below..
   looks confusing".

   A microsite is three things: a hero (a headline, one line, a button or
   two), the stage (one question at a time), and "Good to know", closed until
   someone opens it. Each section sits beside its heading, so a short step
   does not leave half the page empty. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SITES = ['campus.html', 'sgacc.html', 'csr.html', 'legacy.html', 'campaign.html', 'privacy.html'];
const dom = (f) => new JSDOM(read(f)).window.document;

test('the hero says one thing: a headline, one line, at most two buttons', () => {
  for (const file of SITES.concat(['careers.html'])) {
    const doc = dom(file);
    const hero = doc.querySelector('main > .hero');
    const lede = hero.querySelector('.lede').textContent.trim();
    assert.ok(lede.length <= 100, `${file}: the hero's line is ${lede.length} characters: "${lede}"`);
    assert.ok(hero.querySelectorAll('.m-hero__acts a').length <= 2, `${file}: too many buttons`);
    assert.equal(hero.querySelector('.m-hero__facts'), null, `${file}: no strip of facts`);
  }
});

test('one stage, one question at a time', () => {
  for (const file of SITES) {
    const doc = dom(file);
    const stages = doc.querySelectorAll('.m-stage');
    assert.equal(stages.length, 1, `${file}: one stage`);
    const steps = stages[0].querySelectorAll('form .m-step');
    assert.ok(steps.length >= 2, `${file}: in steps`);
    assert.equal(stages[0].querySelectorAll('.m-tabs li').length, steps.length, `${file}: a tab for every step`);
    assert.equal(doc.querySelector('.m-live, .m-aside'), null, `${file}: no running card beside the form`);
  }
});

test('the rest is under plus signs, closed until opened', () => {
  for (const file of SITES) {
    const doc = dom(file);
    const more = doc.querySelector('.band.m-more');
    assert.ok(more, `${file}: a "Good to know" section`);
    const items = more.querySelectorAll('.m-acc > details');
    assert.ok(items.length >= 3, `${file}: its items`);
    for (const d of items) assert.equal(d.hasAttribute('open'), false, `${file}: "${d.querySelector('summary').textContent}" opens itself`);
    /* nothing to read outside the hero, the stage, a short list of facts and the plus signs */
    const loose = [...doc.querySelectorAll('main p')].filter((p) => !p.closest('.hero, .m-stage, details, .band__head, dialog, .m-done'));
    assert.deepEqual(loose.map((p) => p.textContent.trim().slice(0, 50)), [], `${file}: paragraphs outside a plus sign`);
    for (const head of doc.querySelectorAll('.band > .band__head')) {
      assert.equal(head.querySelectorAll('p:not(.eyebrow)').length, 0, `${file}: a section heading with a paragraph under it`);
    }
  }
});

test('each section beside its heading, so a short step leaves no empty half', () => {
  const css = read('assets/micro.css');
  assert.match(css, /\.band\.m-twin\{[^}]*display:grid;grid-template-columns:minmax\(0,\.8fr\) minmax\(0,1\.45fr\)/);
  for (const file of SITES) {
    const doc = dom(file);
    for (const band of doc.querySelectorAll('main > .band')) {
      assert.ok(band.classList.contains('m-twin'), `${file}: #${band.id} is not beside its heading`);
    }
  }
});

test('careers: short cards, and each role\'s detail under plus signs', () => {
  const doc = dom('careers.html');
  for (const card of doc.querySelectorAll('.jobs .m-card')) {
    const p = card.querySelector('p:not(.m-card__foot)');
    assert.ok(p.textContent.trim().length <= 80, `a card says too much: "${p.textContent.trim()}"`);
    assert.equal(card.querySelector('dl'), null);
  }
  for (const jd of doc.querySelectorAll('.opening .jd')) {
    const kids = [...jd.children];
    assert.ok(kids.length && kids.every((k) => k.tagName === 'DETAILS'), `${jd.closest('.opening').id}: detail outside a plus sign`);
    assert.equal(jd.querySelectorAll('details[open]').length, 0);
  }
});

test('a journey on Get Involved is the whole screen: step and Continue as one block, nothing else', () => {
  /* owner, 9 Oct 2026, the PFA name large under Continue: "pfa on top and
     again below.. looks confusing right.. not the bext ux". While a journey
     is open the footer steps aside, the step and its Continue sit together in
     the middle of the screen, and on a phone Continue stays at the thumb. */
  const gi = read('get-involved.html');
  assert.match(gi, /body\.in-flow \.pfa-footer,body\.in-flow \.announce\{display:none\}/, 'no footer under a form, no promo strip over it');
  assert.match(read('assets/chrome.js'), /getComputedStyle\(ann\)\.display !== 'none'/, 'the header closes the strip\'s gap');
  assert.match(gi, /document\.body\.classList\.toggle\('in-flow', found\)/);
  assert.match(gi, /document\.body\.classList\.remove\('in-flow'\)/, 'and back on the landing');
  assert.match(gi, /\.gi\.is-guided \.gi__section\.is-open \.gi__form\{[^}]*flex:1;justify-content:center/, 'centred, so no empty screen under Continue');
  assert.match(gi, /\.gi\.is-guided \.gi__section\.is-open \.gi__form > \.gi__nav\{flex:none\}/, 'Continue belongs to the step');
  assert.doesNotMatch(gi, /\.is-stepped \.gi__step\.is-current\{[^}]*flex:1/, 'the step is as tall as what it says');
  assert.match(gi, /\.gi\.is-guided\.has-open \.is-stepped \.gi__nav\{position:sticky;bottom:0/, 'on a phone, Continue at the thumb');
});

test('no photograph frame ever asks for a photo', () => {
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(read(file), /add photo/i, `${file} shows "add photo" where a photograph did not arrive`);
  }
  const founder = read('founder.html');
  assert.match(founder, /src="media\/site\/sgacc\/centre-01\.jpg" data-alt-src="https:\/\/pf-acurrent\.vercel\.app\/front\/img\/center1\.jpg"/);
  /* a quiet plate: the faint PFA mark, as on the microsites */
  assert.match(founder, /\.frame\.is-empty::before\{[^}]*background:url\("img\/mail\/logo-mark\.png"\)[^}]*opacity:\.16;filter:grayscale\(1\)\}/);
  /* and no wall of plates: with none arrived, the gallery steps aside */
  assert.match(founder, /if \(frames\.length && empty\.length === frames\.length\) g\.hidden = true;/);
});
