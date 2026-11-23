'use strict';
/* An email in a case, drawn as Gmail draws it (owner, 23 Nov 2026: "can the
   emails look/render like how they render within mailbox/gmail.. right now
   looks like lines?"): lib/inbound-mail.js keeps the email's HTML, and
   assets/admin-mail.js draws it in a frame of its own, made safe, with what
   was quoted back folded behind a ... button. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const I = require('../lib/inbound-mail.js');

function panel() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(read('assets/admin-mail.js'));
  return dom.window;
}
function frameDoc(w, html) {
  return new w.DOMParser().parseFromString(html, 'text/html');
}

test('the reply\'s own words, even when Gmail wraps "On ... wrote:" over two lines', () => {
  const t = 'Thank you for your response.\n\nOn Mon, 23 Nov, 2026, 1:04 pm People for Animals, <\ninfo@peopleforanimalsindia.org> wrote:\n\n> Application number PFA-J-2026-00036.';
  assert.equal(I.newText(t), 'Thank you for your response.');
  assert.equal(I.newText('Sure.\n\nOn Mon, 23 Nov 2026 at 13:04, PFA <info@x.org> wrote:\n> hi'), 'Sure.');
});

test('the email\'s HTML is kept, up to a size; larger, the text stands in', () => {
  const from = { value: [{ address: 'a@b.c', name: 'A' }] };
  assert.equal(I.normalise({ text: 'Hi', html: '<div>Hi</div>', from }).html, '<div>Hi</div>');
  assert.equal(I.normalise({ text: 'Hi', html: 'x'.repeat(150001), from }).html, '');
  assert.equal(I.normalise({ text: 'Hi', from }).html, '');
  const src = read('lib/inbound-mail.js');
  assert.match(src, /if \(msg\.html && !auto\) message\.html = msg\.html;/, 'kept on the message, never for an automatic reply');
});

test('the panel draws every email that came in with the email view, loaded with the file viewer', () => {
  const admin = read('admin.html');
  assert.match(admin, /var full = m\.direction === 'in' && window\.PFAMail \? window\.PFAMail\.view\(m\) : '';\n\s+if \(full\) body = '';/);
  assert.doesNotMatch(admin, /Show the quoted text<\/summary><p>' \+ esc\(m\.fullText\)/, 'the whole email no longer repeated under the reply');
  assert.match(read('assets/admin-viewer.js'), /js\.src = 'assets\/admin-mail\.js';/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-mail\.js'/);
});

test('an HTML email: made safe, in a frame that runs no script, its quote folded behind ...', () => {
  const w = panel();
  const html = '<div dir="ltr">Thank you. <b>Any day next week.</b> <a href="https://example.com/p">portfolio</a>'
    + '<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">bad</a><iframe src="https://evil.example"></iframe>'
    + '<form action="https://evil.example"><input name="p"></form><p onclick="alert(4)" style="color:red">Regards</p></div>'
    + '<div class="gmail_quote"><div class="gmail_attr">On Mon, 23 Nov 2026, PFA wrote:</div><blockquote class="gmail_quote"><p>Your answers are in.</p></blockquote></div>';
  const out = w.PFAMail.view({ html, text: 'Thank you.', fullText: 'x' });
  const wrap = frameDoc(w, out);
  const frames = wrap.querySelectorAll('iframe.mailv__frame');
  assert.equal(frames.length, 2, 'the email, and its quote in a frame of its own');
  for (const f of frames) {
    assert.equal(f.getAttribute('sandbox'), 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', 'no allow-scripts: nothing in it runs');
  }
  assert.ok(frames[1].hasAttribute('hidden'), 'the quote folded');
  assert.ok(wrap.querySelector('button.mailv__more[aria-expanded="false"]'), 'the ... button');
  const shown = frameDoc(w, frames[0].getAttribute('srcdoc'));
  assert.match(shown.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'), /default-src 'none'/);
  assert.equal(shown.querySelectorAll('script, iframe, form, input').length, 0);
  assert.equal(shown.querySelectorAll('[onerror], [onclick]').length, 0);
  assert.ok(![...shown.querySelectorAll('a')].some((a) => /^javascript:/i.test(a.getAttribute('href') || '')));
  const link = shown.querySelector('a[href="https://example.com/p"]');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.ok(shown.querySelector('b'), 'its formatting kept');
  assert.equal(shown.querySelector('p').getAttribute('style'), 'color:red', 'its own styles kept');
  assert.doesNotMatch(shown.body.textContent, /Your answers are in/, 'the quote is not in the first frame');
  /* the quote, drawn when asked for */
  w.document.body.innerHTML = out;
  w.document.querySelector('.mailv__more').click();
  const q = w.document.querySelector('[data-mailv-quoted]');
  assert.equal(q.hidden, false);
  assert.match(frameDoc(w, q.getAttribute('srcdoc')).body.textContent, /On Mon, 23 Nov 2026, PFA wrote:[\s\S]*Your answers are in\./);
});

test('an email kept as text only: the new words, the quote folded once, links that work', () => {
  const w = panel();
  const fullText = 'Thank you for your response.\n\nOn Mon, 23 Nov, 2026, 1:04 pm People for Animals, <\ninfo@peopleforanimalsindia.org> wrote:\n\n> Track your application\n> <https://peopleforanimalsindia.org/track.html#ref=PFA-J-2026-00036>\n> With thanks,';
  const text = 'Thank you for your response.\n\nOn Mon, 23 Nov, 2026, 1:04 pm People for Animals, <\ninfo@peopleforanimalsindia.org> wrote:';
  const doc = frameDoc(w, w.PFAMail.view({ text, fullText }));
  assert.equal(doc.querySelector('.mailv__text').textContent, 'Thank you for your response.', 'no "On ... wrote:" left on the reply');
  const quote = doc.querySelector('.mailv__quote');
  assert.ok(quote.hasAttribute('hidden'));
  assert.doesNotMatch(quote.textContent, /Thank you for your response/, 'the reply not repeated in the quote');
  assert.match(quote.textContent, /^On Mon, 23 Nov/);
  assert.doesNotMatch(quote.textContent, /^>/m, 'the > marks gone');
  assert.equal(quote.querySelector('a').getAttribute('href'), 'https://peopleforanimalsindia.org/track.html#ref=PFA-J-2026-00036', 'the link ends where it ends');
  /* nothing quoted: no button */
  const plain = frameDoc(w, w.PFAMail.view({ text: 'Hello <b>there</b>', fullText: 'Hello <b>there</b>' }));
  assert.equal(plain.querySelector('.mailv__more'), null);
  assert.equal(plain.querySelector('.mailv__text b'), null, 'text is text');
});
