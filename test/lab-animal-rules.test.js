'use strict';

/* The objection to the draft lab animal rules (owner, 22 Oct 2026, with the
   campaign page): "this has to be there. notification icon next to shop on
   the landing page should open this page. keep the page short. who the email
   should go to should be exactly as in
   https://www.rapid-response.in/lab-animal-rules".

   That page (github.com/askrapidresponseteam-cloud/Website-RRT,
   lab-animal-rules.html) sends to seven addresses with gandhim in Cc. These
   are its lists as they stood on 22 Oct 2026. If Rapid Response changes
   them, change both. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGE = 'lab-animal-rules.html';

const RAPID_RESPONSE_TO = ['cpcsea-mef@gov.in', 'js-nlm@dahd.nic.in', 'sk.dutta@nic.in', 'minister-fahdpr@nic.in', 'rrsingh@sansad.nic.in', 'mos-fahd@dahd.nic.in', 'secyahd@nic.in'];
const RAPID_RESPONSE_CC = ['gandhim@exmpls.sansad.in'];

const list = (html, name) => [...((html.match(new RegExp('var ' + name + ' = \\[([^\\]]*)\\]')) || [])[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('the letter goes exactly where Rapid Response\'s goes: seven in To, gandhim in Cc', () => {
  const html = read(PAGE);
  assert.deepEqual(list(html, 'TO'), RAPID_RESPONSE_TO);
  assert.deepEqual(list(html, 'CC'), RAPID_RESPONSE_CC);
  /* written once: everything else reads TO and CC */
  for (const a of RAPID_RESPONSE_TO.concat(RAPID_RESPONSE_CC)) {
    const script = html.slice(html.lastIndexOf('<script>'));
    assert.equal(script.split(a).length - 1, 1, `${a} is written once in the script`);
  }
  assert.match(html, /mailto:' \+ TO\.join\(','\) \+ '\?cc=' \+ encodeURIComponent\(CC\.join\(','\)\)/, 'the email app gets the Cc');
  assert.equal((html.match(/&cc=' \+ encodeURIComponent\(CC\.join\(','\)\)/g) || []).length, 2, 'Gmail and Outlook get it too');
});

test('the page is short: the why, the letter behind its button, the draft under a plus', () => {
  const doc = new JSDOM(read(PAGE)).window.document;
  const main = doc.querySelector('main');
  assert.deepEqual([...main.children].filter((n) => n.tagName === 'SECTION').map((s) => s.id), ['top', 'asks', 'write']);
  assert.equal(doc.querySelectorAll('.lab-points li').length, 3);
  assert.ok(doc.querySelector('#sources').tagName === 'DETAILS' && !doc.querySelector('#sources').hasAttribute('open'), 'the draft is closed until opened');
  /* owner, 22 Oct 2026, of the LinkedIn article and the Rapid Response page
     listed there: "remove these sources". The Gazette stays. */
  assert.deepEqual([...doc.querySelectorAll('#sources a')].map((a) => a.textContent), ['The Gazette notification: G.S.R. 864(E), 6 October 2026']);
  assert.doesNotMatch(read(PAGE), /linkedin\.com|Ghodawat|>Rapid Response:/, 'the two sources are gone');
  const write = doc.getElementById('write');
  assert.ok(write.hasAttribute('data-flow'), 'the letter opens when it is asked for');
  assert.ok(doc.querySelector('main a[href="#write"]'), 'by its button');
  /* one screen (owner, 22 Oct 2026: "remove this..ensure minimal clicks"):
     name, city and the send button, with no steps and no optional line */
  const form = doc.getElementById('labForm');
  assert.equal(form.querySelectorAll('.pfa-step, [data-step-next], [data-step-back]').length, 0, 'no steps to click through');
  assert.ok(!form.hasAttribute('data-steps'));
  assert.deepEqual([...form.querySelectorAll('input:not([type=hidden]), textarea')].filter((el) => !el.closest('details')).map((el) => el.id), ['labName', 'labCity'], 'only the name and the city to fill in');
  for (const id of ['labName', 'labCity']) assert.ok(doc.getElementById(id).hasAttribute('required'), `${id} is required`);
  const sendBtn = doc.getElementById('labSend');
  assert.ok(sendBtn && !sendBtn.hidden && !sendBtn.closest('details'), 'the send button is right there');
  assert.ok(doc.getElementById('labCity').compareDocumentPosition(sendBtn) & 4, 'under the name and city');
  assert.equal(doc.getElementById('labOwn'), null, 'the optional line is gone');
  /* nothing is posted to this site, and nothing heavy is carried */
  const html = read(PAGE);
  const own = html.slice(html.lastIndexOf('<script>'));
  assert.doesNotMatch(own, /\/api\/|PFAForms|fetch\(|XMLHttpRequest|sendBeacon/, 'the letter is sent by the visitor, not by this site');
  assert.doesNotMatch(html, /data:image\/[a-z]+;base64/, 'no pictures written into the page');
  assert.ok(Buffer.byteLength(html) < 80 * 1024, 'and it stays small');
  assert.doesNotMatch(html, /[\u2013\u2014]/, 'no long dashes');
});

/* ---- the page's script, booted --------------------------------------------- */

function boot(now) {
  const html = read(PAGE);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://pfa.test/lab-animal-rules.html', virtualConsole });
  const w = dom.window;
  const opened = [];
  w.open = (url) => { opened.push(url); return null; };
  /* the page re-reads the clock every minute; a test does not wait for it */
  w.setInterval = () => 0;
  if (now) w.Date.now = () => now;
  w.eval(read('assets/field-rules.js'));
  w.eval(read('assets/field-validate.js'));
  w.eval(read('assets/lab-letters.js'));
  w.eval(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')));
  return { w, doc: w.document, errors, opened };
}

test('what opens in Gmail and Outlook carries the To, the Cc, the subject and the letter with the name', () => {
  const { w, doc, errors, opened } = boot(Date.UTC(2026, 9, 22, 10));
  assert.deepEqual(errors, []);
  assert.match(doc.getElementById('labLeft').textContent, /^15 days left to object/);
  /* no name yet: it says so and opens nothing */
  doc.querySelector('[data-way="gmail"]').click();
  assert.equal(opened.length, 0);
  assert.match(doc.getElementById('labStatus').textContent, /name and city/);
  doc.getElementById('labName').value = 'Asha Rao';
  doc.getElementById('labCity').value = 'Udupi';
  doc.getElementById('labCity').dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(doc.getElementById('labStatus').textContent, '', 'the reminder goes once both are in');
  doc.querySelector('[data-way="gmail"]').click();
  doc.querySelector('[data-way="outlook"]').click();
  assert.equal(opened.length, 2);
  const gmail = new URL(opened[0]);
  assert.equal(gmail.searchParams.get('to'), RAPID_RESPONSE_TO.join(','));
  assert.equal(gmail.searchParams.get('cc'), RAPID_RESPONSE_CC.join(','));
  /* one of the owner's three drafts, with its own subject (test/lab-letters.test.js) */
  const draft = require('../assets/lab-letters.js').DRAFTS.find((d) => d.id === doc.getElementById('labForm').getAttribute('data-letter'));
  assert.ok(draft.subjects.includes(gmail.searchParams.get('su')));
  const body = gmail.searchParams.get('body');
  assert.match(body, /^To,\r\nThe Member Secretary/);
  assert.match(body, /Draft Animal Experimentation Rules, 2026/);
  assert.match(body, /,\r\nAsha Rao\r\nUdupi$/);
  const outlook = new URL(opened[1]);
  assert.equal(outlook.searchParams.get('to'), RAPID_RESPONSE_TO.join(','));
  assert.equal(outlook.searchParams.get('cc'), RAPID_RESPONSE_CC.join(','));
  assert.equal(doc.getElementById('labAfter').hidden, false, 'then: press Send, and ask three people');
  assert.deepEqual([...doc.querySelectorAll('#labTo li')].map((li) => li.textContent),
    RAPID_RESPONSE_TO.concat(RAPID_RESPONSE_CC.map((a) => `${a} (cc)`)), 'the page lists the same eight');
});

test('after 5 November it is a letter to read, not to send', () => {
  const { doc, opened } = boot(Date.UTC(2026, 10, 5, 18, 31));
  assert.match(doc.getElementById('labLeft').textContent, /^Closed on 5 November 2026/);
  assert.equal(doc.getElementById('labSend').disabled, true);
  assert.equal(doc.getElementById('labWays').hidden, true);
  doc.getElementById('labName').value = 'Asha Rao';
  doc.getElementById('labCity').value = 'Udupi';
  doc.querySelector('[data-way="gmail"]').click();
  assert.equal(opened.length, 0);
});

/* ---- the bell beside Shop ---------------------------------------------------- */

test('the home page has the bell beside Shop, and it opens this page', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  const bell = doc.querySelector('header.site .navlinks .shop + .pfa-notification');
  assert.ok(bell, 'right after Shop');
  assert.equal(bell.getAttribute('href'), PAGE);
  assert.equal(bell.getAttribute('data-until'), '2026-11-06T00:00:00+05:30', 'gone at the end of 5 November, India time');
  assert.match(bell.getAttribute('aria-label'), /lab animal rules/i, 'a screen reader is told what it opens');
  assert.ok(bell.querySelector('svg') && bell.querySelector('.pfa-notification__dot'));
  /* the landing page only */
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html') && n !== 'index.html')) {
    assert.doesNotMatch(read(f), /class="pfa-notification"/, `${f} has no bell`);
  }
  assert.match(read('assets/chrome.css'), /\.pfa-notification\{/);
});

test('anything with a passed data-until is taken away', () => {
  const html = '<body><a id="old" data-until="2026-11-06T00:00:00+05:30"></a><a id="new" data-until="2099-01-01T00:00:00+05:30"></a><a id="odd" data-until="soon"></a></body>';
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://pfa.test/' });
  const w = dom.window;
  w.Date.now = () => Date.UTC(2026, 10, 7);
  const js = read('assets/chrome.js');
  const from = js.indexOf('/* ---------- what ends on a date');
  assert.ok(from > 0, 'the sweep is in chrome.js');
  w.eval(js.slice(from));
  assert.equal(w.document.getElementById('old'), null);
  assert.ok(w.document.getElementById('new'), 'a date still to come stays');
  assert.ok(w.document.getElementById('odd'), 'a date that cannot be read stays');
});
