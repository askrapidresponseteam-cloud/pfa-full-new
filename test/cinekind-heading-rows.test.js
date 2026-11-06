'use strict';

/* CineKind's section headings (owner, 6 Nov 2026, of "On the national
   record." set over two rows with the second indented: "why 2 rows?"). The
   letter animation split every heading at each space, the non-breaking one
   too, so a pair meant to stay together parted and the next line opened on
   a stray space; and a 16-character cap wrapped any longer heading. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'cinekind.html'), 'utf8');

test('the letter animation splits at ordinary spaces only, so a non-breaking pair stays one piece', () => {
  const re = new RegExp(/text\.split\(\/(.+?)\/\)/.exec(html)[1]);
  assert.deepEqual('On the national record.'.split(re).filter((w) => w && !re.test(w)), ['On', 'the', 'national record.']);
  /* the page's own code, on the heading as written */
  const dom = new JSDOM('<div class="band__head"><h2 class="display">On the national&nbsp;record.</h2></div>');
  const el = dom.window.document.querySelector('h2');
  const body = /document\.querySelectorAll\('\.band__head h2'\)\.forEach\(function\(el\)\{([\s\S]*?)\n\}\);/.exec(html)[1];
  new Function('el', 'Array', 'document', body)(el, Array, dom.window.document);
  const words = [...el.querySelectorAll('.ck-letters')].map((w) => w.textContent);
  assert.deepEqual(words, ['On', 'the', 'national record.']);
  assert.equal(el.getAttribute('aria-label'), 'On the national record.');
  assert.ok([...el.childNodes].every((n) => n.nodeType !== 3 || /^[ \t\n\r\f]+$/.test(n.textContent)), 'only ordinary spaces sit between the words');
});

test('a heading takes the width it needs, after the old 16 and 17 character caps', () => {
  const rule = /<style id="ck-heads-wide">([\s\S]*?)<\/style>/.exec(html);
  assert.ok(rule);
  assert.match(rule[1], /\.band__head h2,\.band--grand \.band__head h2\{max-width:none\}/);
  assert.ok(html.indexOf('<style id="ck-heads-wide">') > html.indexOf('.band--grand .band__head h2,.band--grand .feature__body h2{'));
});
