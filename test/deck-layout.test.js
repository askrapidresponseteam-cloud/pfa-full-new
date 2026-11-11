'use strict';
/* The Academy's deck, every card at once (owner, 11 Nov 2026, with a
   screenshot of the cards across the title: "the cards are above the
   text..fix"). deck.js lays the cards out from the centre of a stage it
   gives a height; held to flex:1, the stage kept the height of the one-card
   view and the rows ran up over the title and down past the view switch.
   Checked in a browser at 1440, 1024, 820, 390 and 360 wide: every card
   inside the stage, under the title, over the switch, inside the screen,
   none on another. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const css = read('assets/deck.css');
const js = read('assets/deck.js');

test('every card at once: the stage takes the height deck.js gives it, and the cards fill it from its top', () => {
  assert.match(css, /\.deck\.is-grid \.deck__stage\{flex:none\}/);
  assert.match(css, /\.deck\.is-grid \.deck__cards\{inset:0\}/, 'not the 60px a phone keeps under one card for its buttons');
  assert.match(js, /stage\.style\.height = H \+ 'px';/);
  assert.match(js, /put\(c, \(col - \(cols - 1\) \/ 2\) \* \(gw \+ gap\), row \* \(gh \+ gap\) \+ gh \/ 2 - H \/ 2 \+ 20, 0, s, false, 10\);/);
});

test('on a narrow screen the cards shrink to their columns rather than run off the edges', () => {
  assert.match(js, /gw = Math\.min\(gw, \(W - gap \* \(cols - 1\)\) \/ cols\);\n {8}var s = gw \/ cw, gh = ch \* s;/);
});

test('one card at a time on a phone: Next card and Show me share one row under the cards, clear of them', () => {
  assert.match(css, /@media \(max-width:720px\)\{[^\n]*\.deck__stage\{display:flex;flex-direction:row;flex-wrap:wrap;justify-content:center;align-items:flex-end;align-content:flex-end;padding-bottom:6px\}\.deck__cards\{bottom:60px\}\}/);
});
