'use strict';

/* A form opens when it is asked for, one step at a time, with a way to
   reach PFA beside it.

   Owner, 9 Oct 2026, of PFA Campus's Register button with the form already
   on the screen under it: "open step 1 after another, else register button
   has no meaning/purpose. be sensible. you need to think like apple/google.
   across the whole site". The same minute: "always have a link to contact
   when at such stages".

   A section marked data-flow holds a form and stays closed until a link or
   the address asks for it (assets/chrome.js, PFAFlow); open, it is the page,
   under a bar with the way back and "Need help? Contact PFA". A long form is
   written as steps (form[data-steps], .pfa-step). Every flow was driven in a
   browser at desktop and phone width: closed on arrival, opened by its own
   button, closed by the bar and by the browser's Back, opened straight from
   its address; and all thirteen forms behind them were filled step by step
   against the real intake route, filed, and copied to gandhim once. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !['admin.html', 'submission-collage.html', 'read.html'].includes(f));
const FLOWS = {
  'campus.html': 'start', 'csr.html': 'start', 'legacy.html': 'start', 'campaign.html': 'plan',
  'sgacc.html': 'help', 'privacy.html': 'request', 'careers.html': 'apply', 'events.html': 'request',
  'wall.html': 'submit', 'report.html': 'follow', 'ask.html': 'follow', 'units.html': 'apply'
};

test('no button points at a form that is already on the screen', () => {
  const found = [];
  for (const file of PAGES) {
    /* the shop's links go to products, each with its own quantity box; Get
       Involved closes its three journeys with its own script */
    if (file === 'shop.html' || file === 'get-involved.html') continue;
    const doc = new JSDOM(read(file)).window.document;
    for (const a of doc.querySelectorAll('main a[href]')) {
      const m = /^(?:([a-z-]+\.html))?#([\w-]+)/.exec(a.getAttribute('href'));
      if (!m || (m[1] && m[1] !== file)) continue;
      const target = doc.getElementById(m[2]);
      /* a form that sends something (the academy's dose checker sends nothing) */
      if (!target || !(target.matches('form') || target.querySelector('form'))) continue;
      if (!target.closest('[data-flow]')) found.push(`${file}: "${a.textContent.trim()}" -> #${m[2]}`);
    }
  }
  assert.deepEqual(found, [], 'the form it points at should open when it is asked for (data-flow)');
});

test('each of those forms is closed until asked for, and says where Back goes', () => {
  for (const [file, id] of Object.entries(FLOWS)) {
    const doc = new JSDOM(read(file)).window.document;
    const flow = doc.getElementById(id);
    assert.ok(flow && flow.hasAttribute('data-flow'), `${file}#${id} is a flow`);
    assert.ok(flow.querySelector('form'), `${file}#${id} holds a form`);
    assert.ok((flow.getAttribute('data-flow-back') || '').length >= 4, `${file}#${id}: the way back is named`);
    assert.ok(doc.querySelector(`main a[href="#${id}"]`), `${file}: something on the page opens #${id}`);
  }
  const gi = read('get-involved.html');
  assert.match(gi, /document\.body\.classList\.toggle\('in-flow', found\)/, 'Get Involved\'s journeys, by its own script');
});

test('closed only with the script, and before the page is painted', () => {
  const js = read('assets/chrome.js');
  const css = read('assets/chrome.css');
  assert.match(js, /root\.classList\.add\('pfa-flows'\);/);
  assert.match(css, /\.pfa-flows \[data-flow\]:not\(\.is-flow\)\{display:none\}/, 'no script, no closing');
  assert.match(css, /body\.in-flow \.pfa-footer,body\.in-flow \.announce\{display:none\}/, 'open, the form is the page');
  for (const file of Object.keys(FLOWS)) {
    const html = read(file);
    const script = html.indexOf('<script src="assets/chrome.js');
    assert.ok(script > 0 && script < html.indexOf('<main'), `${file}: chrome.js runs before main is read, so no form shows and then hides`);
  }
});

test('the address opens a flow and the browser\'s Back closes it', () => {
  const js = read('assets/chrome.js');
  assert.match(js, /history\.pushState\(\{ pfaFlow: id \}, '', '#' \+ id\)/);
  assert.match(js, /window\.addEventListener\('popstate', sync\)/);
  assert.match(js, /var flow = flowById\(idOf\(location\.hash\)\);\n {4}if \(flow && !current\) show\(flow\);/, 'search results and links from other pages land in the form');
  assert.match(js, /if \(history\.state && history\.state\.pfaFlow\) \{ history\.back\(\); return; \}/, 'the bar\'s way back is the browser\'s');
  /* a role or a Zone in the address is an application */
  assert.match(read('careers.html'), /if \(\(pre \|\| preRole\) && window\.PFAFlow\) \{ history\.replaceState\(null, '', '#apply'\); window\.PFAFlow\.open\('apply'\); \}/);
  for (const file of ['report.html', 'ask.html', 'careers.html']) {
    assert.match(read(file), /if \(window\.PFAFlow\) window\.PFAFlow\.open\('follow'\);/, `${file}: #follow=REF opens with the number in`);
  }
});

test('a way to reach PFA wherever someone is in the middle of something', () => {
  const js = read('assets/chrome.js');
  assert.match(js, /var HELP = 'ask\.html';/);
  assert.match(js, /help\.target = '_blank';/, 'it opens beside the form, so nothing typed is lost');
  assert.match(js, /<span class="pfa-flow-bar__q">Need help\? <\/span><b>Contact PFA<\/b>/);
  const gi = new JSDOM(read('get-involved.html')).window.document;
  assert.equal(gi.querySelectorAll('.gi__bar a.gi__help[href="ask.html"][target="_blank"]').length, 3, 'each Get Involved journey');
  const donate = new JSDOM(read('donate.html')).window.document;
  assert.ok(donate.querySelector('.give__top #barGive + a.give__help[href="ask.html"]'), 'donating, beside the steps');
  assert.match(read('donate.html'), /a\.href = 'ask\.html'; a\.target = '_blank'; a\.rel = 'noopener'; a\.textContent = 'contact PFA';/, 'a gift above the limit');
});

test('where the words say to ask PFA, they are a link to it', () => {
  assert.match(read('legacy.html'), /<a href="ask\.html">Ask PFA<\/a> to confirm its name and details before you sign/);
  const wall = read('wall.html');
  assert.match(wall, /<a href="ask\.html">Ask us<\/a> to take it down at any time/);
  assert.match(wall, /<a href="ask\.html">Ask us<\/a> to remove yours at any time/);
  const privacy = read('privacy.html');
  assert.match(privacy, /<a href="#request">Make a request<\/a>\. PFA may confirm it is you first/);
  assert.match(privacy, /or <a href="#request">make a request<\/a>, which gives you a reference number to follow\. Anything else: <a href="ask\.html">contact PFA<\/a>\./);
  /* a closed form is not "below" anything */
  for (const file of PAGES) {
    const doc = new JSDOM(read(file)).window.document;
    doc.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
    assert.doesNotMatch(doc.body.textContent, /\b(use|fill in|see) the form below\b/i, `${file} points at a form below`);
  }
});

test('the long forms ask one step at a time', () => {
  for (const [file, id, names] of [['events.html', 'eventForm', ['The event', 'You']], ['wall.html', 'wallForm', ['The video', 'You']]]) {
    const doc = new JSDOM(read(file)).window.document;
    const form = doc.getElementById(id);
    assert.ok(form.hasAttribute('data-steps'), `${file}: stepped`);
    assert.deepEqual([...form.querySelectorAll('.pfa-step')].map((s) => s.getAttribute('data-step')), names);
    assert.equal(form.querySelectorAll('.pfa-steps__tabs li').length, names.length);
    const nav = form.querySelector('.pfa-steps__nav');
    assert.ok(nav.querySelector('[data-step-back]') && nav.querySelector('[data-step-next]') && nav.querySelector('[type="submit"][hidden]'), `${file}: Back, Continue, and the send button for the last step`);
    for (const el of form.querySelectorAll('[required]')) assert.ok(el.closest('.pfa-step'), `${file}: #${el.id} is in a step`);
  }
  const js = read('assets/chrome.js');
  assert.match(js, /new CustomEvent\('pfa:step-check', \{ cancelable: true/, 'a page can add its own rule to a step');
  assert.match(read('wall.html'), /f\.addEventListener\('pfa:step-check', function\(e\)\{/, 'the wall\'s six platforms, at the first step');
  assert.match(js, /the page checks the whole form on sending: a fault in an earlier step brings that step back/);
  assert.match(read('assets/chrome.css'), /\.pfa-flows form\[data-steps\] \.pfa-step:not\(\.is-current\)\{display:none\}/, 'without the script, a plain form');
});

test('nothing from checking the pages ships with them', () => {
  /* the browser checks above write screenshots; two of them once went out
     in a release from the site's root folder (v1.415) */
  const stray = fs.readdirSync(ROOT).filter((f) => /\.(png|jpe?g)$/i.test(f));
  assert.deepEqual(stray, [], 'screenshots in the site folder');
});
