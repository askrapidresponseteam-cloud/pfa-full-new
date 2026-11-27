'use strict';

/* Two things that stood in people's way (owner, 16 Nov 2026):

   "Ensure the chat button never overlaps or obstructs other buttons or
   interactive elements at any screen size": the Chat with PFA button reads
   what lies under it, tries the other corner, and steps aside while either
   would cover something that can be pressed.

   "once added to cart.. the button goes off.. one has to fiddle to find
   where the cart is.. and the next steps": once a piece is in the bag, a
   Go to bag and checkout step stays under its Add to bag, and the Bag
   button stands above the chat button, never under the closer look. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the chat button steps aside from anything pressable, in either corner, at every size', () => {
  const chrome = read('assets/chrome.js');
  assert.match(chrome, /function underneath\(b, words\)[\s\S]*document\.elementsFromPoint/, 'reads what lies under it');
  assert.match(chrome, /var PRESSABLE = 'a\[href\],button,input,select,textarea,summary,label,video\[controls\],iframe/);
  assert.match(chrome, /b\.classList\.add\('is-left'\); blocked = underneath\(b, true\)/, 'the other corner before stepping aside, and only where no words lie');
  assert.match(chrome, /b\.classList\.toggle\('is-clear', blocked\)/);
  assert.match(chrome, /\.pfa-asst-launch\.is-clear\{opacity:0;visibility:hidden;pointer-events:none\}/, 'aside means not seen and not pressable');
  assert.match(chrome, /window\.addEventListener\('scroll', soon, \{ passive: true, capture: true \}\);\s*window\.addEventListener\('resize', soon\)/, 'checked as the page moves and resizes');
  assert.match(chrome, /document\.activeElement === b \|\| b\.getAttribute\('aria-expanded'\) === 'true'/, 'never pulled from under the person using it');
  assert.match(chrome, /guard\(b\);/);
});

test('the shop keeps the next step on screen once a piece is in the bag', () => {
  const js = read('assets/shop.js');
  assert.match(js, /function nextSteps\(\)/);
  assert.match(js, /'Go to bag \(' \+ n \+ '\) and checkout'/);
  assert.match(js, /line\.addEventListener\('click', function \(\) \{ show\(bagEl\); \}\)/, 'one press to the bag and its checkout');
  assert.match(js, /form\.id === 'lookBuy' \|\| form\.id === 'featureBuy'/, 'always on the closer look once the bag has anything');
  assert.match(js, /nextSteps\(\);\s*summary\(\$\('bagSum'\)\)/, 'kept up to date with the bag');
  const html = read('shop.html');
  assert.match(html, /\.bagbtn\{position:fixed;[^}]*z-index:44;/, 'the Bag button (44) stands over the closer look');
  assert.match(html, /#look\{position:fixed;[^}]*z-index:43;/, 'which sits one under it');
  assert.match(html, /\.bagbtn\{bottom:calc\(var\(--tabbar,0px\) \+ 78px/, 'and above the chat button');
  assert.match(read('assets/chrome.css'), /html\[data-pfa-tabs\] \.bagbtn\{bottom:calc\(var\(--tabbar\) \+ 78px\)\}/, 'on a phone too');
});
