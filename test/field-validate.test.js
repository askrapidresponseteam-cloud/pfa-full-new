'use strict';

/* assets/field-validate.js, driven in a real DOM.

   field-rules.js was written to be shared by the browser and the API, and for
   its whole life only the API used it: no page in the tree carried a
   <script src="assets/field-rules.js">, so window.PFA_RULES did not exist in
   any browser that ever visited the site, and every page checked mobiles and
   emails with a hand-written regex of its own.

   These tests boot the two files against the two error conventions the pages
   actually use, and check the four things the person filling in the form
   experiences: what may be typed, what is stored, what they are told, and
   that the page's own wording survives. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const RULES = fs.readFileSync(path.join(ROOT, 'assets', 'field-rules.js'), 'utf8');
const VALIDATE = fs.readFileSync(path.join(ROOT, 'assets', 'field-validate.js'), 'utf8');

/* report.html, ask.html and careers.html show a message by clearing `hidden`
   on a <p class="err">. donate.html, get-involved.html, events.html and
   wall.html show one with .is-bad on the .field, which the sheet turns into
   `display:block` for the <span class="error">. Both are exercised. */
const HIDDEN_CONVENTION = `
  <form id="f" novalidate>
    <div class="field"><label for="name">Your name</label>
      <input id="name" name="name"><p class="err" hidden></p></div>
    <div class="field"><label for="mobile">Mobile</label>
      <input id="mobile" name="mobile" inputmode="tel"><p class="err" hidden></p></div>
    <div class="field"><label for="email">Email</label>
      <input id="email" name="email" type="email"><p class="err" hidden></p></div>
    <div class="field"><label for="pincode">PIN</label>
      <input id="pincode" name="pincode"><p class="err" hidden></p></div>
    <div class="field"><label for="what">What happened</label>
      <textarea id="what" name="what"></textarea><p class="err" hidden></p></div>
  </form>`;

const CLASS_CONVENTION = `
  <form id="f" novalidate>
    <div class="field"><label for="evName">Your name</label>
      <input id="evName" type="text"><span class="error">Add your name.</span></div>
    <div class="field"><label for="evMobile">Mobile</label>
      <input id="evMobile" type="tel"><span class="error">Enter a 10-digit Indian mobile number.</span></div>
    <div class="field"><label for="evCity">City</label>
      <input id="evCity" type="text"><span class="error">Tell us where.</span></div>
  </form>`;

function boot(body) {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${body}</body></html>`, { runScripts: 'outside-only' });
  dom.window.eval(RULES);
  dom.window.eval(VALIDATE);
  const { document, Event } = dom.window;
  return {
    dom,
    document,
    $: (sel) => document.querySelector(sel),
    type(sel, value) {
      const el = document.querySelector(sel);
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el;
    },
    leave(sel) {
      const el = document.querySelector(sel);
      el.dispatchEvent(new Event('blur', { bubbles: false }));
      return el;
    },
    /* The script primes maxlength on DOMContentLoaded, exactly as it does in
       a browser, so a test that reads those attributes waits for it. */
    ready() { return new Promise((done) => setTimeout(done, 20)); },
    /* What the person would actually see, given how that page shows it. */
    shown(sel) {
      const box = document.querySelector(sel).closest('.field');
      const err = box.querySelector('.err');
      if (err) return err.hidden ? '' : err.textContent;
      const error = box.querySelector('.error');
      return box.classList.contains('is-bad') ? error.textContent : '';
    }
  };
}

test('the rules reach the browser at all: PFA_RULES exists once the file is loaded', () => {
  const page = boot(HIDDEN_CONVENTION);
  assert.ok(page.dom.window.PFA_RULES, 'field-rules.js did not define the global the pages need');
  assert.ok(page.dom.window.PFAFieldValidate, 'field-validate.js did not start');
});

test('a digit never lands in a name box and a letter never lands in a mobile', () => {
  const page = boot(HIDDEN_CONVENTION);
  assert.equal(page.type('#name', 'Priya 123 Sharma!').value, 'Priya  Sharma');
  assert.equal(page.type('#mobile', 'abc9876543210xyz').value, '9876543210');
  assert.equal(page.type('#mobile', '+91 98765 43210').value, '9876543210');
  assert.equal(page.type('#pincode', '57a6b2c2d2e').value, '576222');
});

test('what leaves the box is the stored form, not the keystrokes', () => {
  const page = boot(HIDDEN_CONVENTION);
  page.type('#name', 'rAJESH kumAR');
  page.leave('#name');
  assert.equal(page.$('#name').value, 'Rajesh Kumar');

  page.type('#email', '  Asha@Example.COM ');
  page.leave('#email');
  assert.equal(page.$('#email').value, 'asha@example.com');
});

test('a malformed entry is named, in the element the page already uses', () => {
  const page = boot(HIDDEN_CONVENTION);
  page.type('#email', 'test.com');
  page.leave('#email');
  assert.equal(page.shown('#email'), 'An email address needs an @ sign.');

  page.type('#email', 'asha@gmail');
  page.leave('#email');
  assert.equal(page.shown('#email'), 'Check this email address, for example name@example.com.');
  assert.equal(page.$('#email').getAttribute('aria-invalid'), 'true');

  /* and it clears itself the moment it stops being true */
  page.type('#email', 'asha@example.com');
  assert.equal(page.shown('#email'), '');
  assert.equal(page.$('#email').getAttribute('aria-invalid'), 'false');
});

test('the addresses people mistype are the ones refused', () => {
  const page = boot(HIDDEN_CONVENTION);
  /* A space is taken out as it is typed rather than refused afterwards, so
     "a b@c.com" is not in this list: by the time it is judged it is fixed. */
  for (const bad of ['test.com', 'abc@', '@gmail.com', 'asha@gmail', 'asha@@gmail.com', 'asha@.com', 'asha..b@c.com']) {
    page.type('#email', bad);
    page.leave('#email');
    assert.notEqual(page.shown('#email'), '', `${bad} was accepted`);
  }
  for (const good of ['asha@example.com', 'a.b+c@sub.example.co.in']) {
    page.type('#email', good);
    page.leave('#email');
    assert.equal(page.shown('#email'), '', `${good} was refused`);
  }
});

test('a mobile that is not an Indian mobile is refused with the reason', () => {
  const page = boot(HIDDEN_CONVENTION);
  page.type('#mobile', '1234567890');
  page.leave('#mobile');
  assert.equal(page.shown('#mobile'), 'Indian mobile numbers start with 6, 7, 8 or 9.');
  page.type('#mobile', '98765');
  page.leave('#mobile');
  assert.equal(page.shown('#mobile'), 'An Indian mobile number is 10 digits.');
});

test('the class convention works too, and the page keeps its own wording', () => {
  const page = boot(CLASS_CONVENTION);
  const before = page.$('#evName').closest('.field').querySelector('.error').textContent;
  assert.equal(before, 'Add your name.');

  page.type('#evMobile', '1234567890');
  page.leave('#evMobile');
  assert.equal(page.shown('#evMobile'), 'Indian mobile numbers start with 6, 7, 8 or 9.');

  page.type('#evMobile', '9876543210');
  page.leave('#evMobile');
  assert.equal(page.shown('#evMobile'), '');
  assert.equal(page.$('#evMobile').closest('.field').querySelector('.error').textContent,
    'Enter a 10-digit Indian mobile number.', 'the page\'s own message was not put back');
});

test('a control the page names only by id is still governed', () => {
  const page = boot(CLASS_CONVENTION);
  assert.equal(page.type('#evName', 'Meena 7 Iyer').value, 'Meena  Iyer');
  assert.equal(page.type('#evCity', 'Kundapur 3').value, 'Kundapur ');
});

test('the length the record holds is written onto the box, and never loosened', async () => {
  const page = boot(HIDDEN_CONVENTION);
  await page.ready();
  assert.equal(page.$('#name').getAttribute('maxlength'), '80');
  assert.equal(page.$('#what').getAttribute('maxlength'), '2000');
  assert.equal(page.$('#pincode').getAttribute('maxlength'), '6');
  assert.equal(page.$('#pincode').getAttribute('inputmode'), 'numeric');
  /* A mobile box admits the country code so the filter can take it off. */
  assert.equal(page.$('#mobile').getAttribute('maxlength'), '15');
});

test('a mobile box is widened, not only tightened, so a pasted country code survives', async () => {
  /* donate.html's mobile boxes carry maxlength="10". The browser cut a pasted
     "+91 98765 43210" down to "+91 98765 " before the filter ever saw it, and
     the number that survived was 9198765. The rule layer needs fifteen
     characters of room to take the prefix off. */
  const page = boot(`<form id="f">
    <div class="field"><input id="gMobile" name="mobile" type="tel" maxlength="10"><span class="error">Add a mobile.</span></div>
    <div class="field"><input id="pincode" name="pincode" maxlength="6"><span class="error">Add a PIN.</span></div>
  </form>`);
  await page.ready();
  assert.equal(page.$('#gMobile').getAttribute('maxlength'), '15');
  assert.equal(page.type('#gMobile', '+91 98765 43210').value, '9876543210');
  /* Everything else is only ever tightened: a page asking for less knows why. */
  assert.equal(page.$('#pincode').getAttribute('maxlength'), '6');
});

test('a verdict always has somewhere to appear', async () => {
  /* Some .field wrappers carry no message element at all - donate.html's
     village and PIN boxes among them - so a verdict was reached, aria-invalid
     was set, and the person was told nothing at all. */
  const page = boot('<form id="f"><div class="field"><label for="fPin">PIN</label><input id="fPin" name="pin"></div></form>');
  await page.ready();
  page.type('#fPin', '012345');
  page.leave('#fPin');
  assert.equal(page.$('#fPin').getAttribute('aria-invalid'), 'true');
  assert.equal(page.shown('#fPin'), 'A PIN code does not start with 0.', 'the message had nowhere to go');

  page.type('#fPin', '576222');
  page.leave('#fPin');
  assert.equal(page.shown('#fPin'), '');
});

test('a box the page renders later is primed as it arrives', async () => {
  const page = boot(HIDDEN_CONVENTION);
  const extra = page.document.createElement('div');
  extra.className = 'field';
  extra.innerHTML = '<input id="volCity" type="text"><span class="error">Tell us where you are.</span>';
  page.document.querySelector('#f').appendChild(extra);
  await page.ready();
  assert.equal(page.$('#volCity').getAttribute('maxlength'), '60');
});

test('a password, a search box and a file picker are left alone', () => {
  const page = boot(`<form id="f">
    <div class="field"><input id="pass" name="pass" type="password"></div>
    <div class="field"><input id="q" name="q" type="search"></div>
    <div class="field"><input id="photos" name="photos" type="file"></div>
  </form>`);
  assert.equal(page.type('#pass', 'Sh0rt!Pass-word').value, 'Sh0rt!Pass-word');
  assert.equal(page.type('#q', 'dog food 12kg').value, 'dog food 12kg');
  assert.equal(page.$('#photos').getAttribute('maxlength'), null);
});

/* ---- and that the pages actually load it -------------------------------- */

const WIRED = ['report.html', 'ask.html', 'careers.html', 'wall.html', 'get-involved.html',
  'events.html', 'donate.html', 'track.html', 'caregiver-card.html',
  /* newsroom.html left this list on 16 Sep 2026: the editorial cut carries
     no entry box at all, which the left-out check below confirms. */
  /* the CineKind nomination form, back for 2027 (16 Sep 2026) */
  'cinekind.html',
  /* the microsites (9 Oct 2026) */
  'campus.html', 'sgacc.html', 'csr.html', 'legacy.html', 'campaign.html', 'privacy.html',
  /* the objection to the draft lab animal rules (22 Oct 2026) */
  'lab-animal-rules.html'];

test('every page that takes an entry loads the rules, and loads them first', () => {
  for (const file of WIRED) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const rules = html.indexOf('src="assets/field-rules.js"');
    const validate = html.indexOf('src="assets/field-validate.js"');
    assert.ok(rules > -1, `${file} does not load the shared rules, so nothing is checked as it is typed`);
    assert.ok(validate > -1, `${file} loads the rules but nothing applies them`);
    assert.ok(rules < validate, `${file} loads field-validate.js before the rules it needs`);
  }
});

test('no page with a data entry box was left out', () => {
  /* academy.html carries a search box and the dose checker, neither of which
     is an entry anyone submits. */
  /* library.html and read.html carry a find box each (a title on the shelves,
     a word in the document); nothing typed there leaves the browser. */
  const skip = new Set(['admin.html', 'search.html', 'quiz.html', 'laws.html',
    'academy.html', 'units.html', 'shop.html', 'submission-collage.html',
    'library.html', 'read.html']);
  const missed = [];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    if (skip.has(file) || WIRED.includes(file)) continue;
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    /* A range input is a slider, not an entry: the CineKind screening's seek
       bar is one, and nothing typed into it goes anywhere. Only the boxes
       a person can put a value into count. */
    const controls = (html.match(/<(input|textarea|select)\b[^>]*>/g) || []).filter((tag) => !/type="range"/.test(tag)).length;
    if (controls) missed.push(`${file} (${controls} controls)`);
  }
  assert.deepEqual(missed, [], 'these pages take entries and load no rules');
});
