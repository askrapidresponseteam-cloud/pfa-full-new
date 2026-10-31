'use strict';

/* The donate page's first step, calm (owner, 9 Oct 2026, of black switches,
   a black chosen card, the figures in the display face and a row of black
   marks: "looks a bit hard and uneasy on the eyes. make it supreme").

   Nothing on the step is a slab of ink but Continue, which names the amount.
   Donate or a gift and the currency share one row of light switches; the
   chosen amount is drawn round in ink with the site's red tick; what it buys
   is said once (on its card on a wide screen, beside the form in the panel;
   on a phone in one line under the cards); and a phone opens on the amount
   rather than on the picture. These hold the parts that are easy to undo. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'donate.html'), 'utf8');
const rule = (sel) => (html.match(new RegExp(`(?:^|\\n|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`)) || [])[1] || '';

test('the switches are light: the choice is lifted out in white, never filled with ink', () => {
  assert.match(rule('.seg'), /background:#f3f2ef;border:1px solid var\(--line\)/);
  assert.match(rule('.seg button[aria-pressed="true"]'), /background:#fff;color:var\(--ink\)/);
  assert.doesNotMatch(html, /\.seg button\[aria-pressed="true"\]\{background:var\(--ink\)/);
  /* both on one row: Donate or a gift, and a small currency switch */
  assert.match(html, /<div class="give__opts">\s*<div class="seg"[^>]*id="giveKind"[\s\S]*?<div class="seg seg--mini"[^>]*id="giveCur"/);
  assert.match(rule('.give__opts'), /display:flex;flex-wrap:wrap;gap:8px/);
  assert.match(html, /data-gcur="INR" aria-pressed="true" aria-label="Indian rupees">&#8377;<span class="cur__code"> INR<\/span>/, 'a phone shows the sign; a screen reader hears the currency');
});

test('the chosen amount is drawn round, without a red tick; the figures are in the text face', () => {
  assert.match(rule('.amts button b'), /font-family:var\(--body\);font-weight:600/, 'the display face\'s zeros read as the letter O');
  assert.match(rule('.amts button b'), /tabular-nums/);
  assert.match(rule('.amts button'), /justify-content:flex-start/, 'every figure on one line, whatever its caption');
  /* no red line anywhere (owner, 31 Oct 2026: "why the heck that red line .. dont need it anywhere") */
  assert.doesNotMatch(html, /\.amts button::after/);
  assert.match(rule('.amts button[aria-pressed="true"]'), /border-color:var\(--ink\);box-shadow:inset 0 0 0 1px var\(--ink\)/);
});

test('what it buys is said once, and no black marks count it out', () => {
  assert.doesNotMatch(html, /gift__marks|giftMarks|giftN\b/);
  assert.match(html, /<p class="gift" id="gift" aria-live="polite" hidden><span id="giftWhat"><\/span><\/p>/);
  assert.match(html, /\$\('#giftWhat'\)\.textContent = line\(\);/, 'the same sentence the panel carries');
  assert.match(html, /@media \(min-width:861px\)\{\.gift\{display:none\}\}/, 'beside the panel it would be said twice');
  assert.match(html, /#amts button small\{display:none\}/, 'on a phone the cards carry the figures alone');
});

test('Continue names the amount', () => {
  assert.match(html, /\$\('#next1'\)\.textContent = amt >= minAmt\(\) \? 'Continue with ' \+ fmt\(amt\) : 'Continue';/);
});

test('a phone opens on the amount, not on the picture', () => {
  const phone = (html.match(/@media \(max-width:860px\)\{\n {2}\.give\{min-height:0\}([\s\S]*?)\n\}/) || [])[1] || '';
  assert.match(phone, /\.give__side\{flex-direction:row;/, 'the word and the ring share a row');
  assert.match(phone, /#sideGive\{display:none\}/);
  assert.match(html, /\.stepbar span:not\(\.on\) em\{display:none\}/, 'the step bar never wraps');
});
