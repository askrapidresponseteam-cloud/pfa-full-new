'use strict';

/* The panel's layout (owner, 16 Nov 2026: "you cant be showing less important
   stuffs above hero elements ... admin panel really needs to be made user
   friendly in terms of layout and UX. dont change colors and font family"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('a section in parts shows one part at a time, chosen from a switch under its title', () => {
  const html = read('admin.html');
  assert.match(html, /<nav class="subnav" id="subnav" aria-label="In this section" hidden><\/nav>/);
  assert.ok(html.indexOf('id="subnav"') < html.indexOf('id="replyAlert"'), 'the switch sits right under the title');
  assert.match(html, /var SUBNAME = \{ cgsheet: 'Register', apply: 'To decide', caregivers: 'Card studio', verify: 'Verify a card', cards: 'Print and post', memsheet: 'Register', membership: 'Photos and cards',/);
  assert.match(html, /function show\(tab, part\) \{/);
  assert.match(html, /if \(live\.length > 1\) live = \[sub\];/, 'only the part chosen is drawn');
  assert.match(html, /var want = part \|\| \(asked !== tab \? asked : ''\) \|\| subOf\[tab\];/, 'an old name opens its part; otherwise the last used');
  assert.match(html, /show\('membership', 'membership'\);/, 'Review now opens the photographs');
  assert.match(html, /show\('caregivers', 'caregivers'\);/, 'a card found opens the card studio');
  assert.match(html, /\.main\[data-sub\] \.pane::before\{content:none!important\}/, 'no stacked headings once there is a switch');
  /* the font and colours are the panel's own */
  assert.doesNotMatch(html.slice(html.indexOf('.subnav{'), html.indexOf('.main[data-sub]')), /font-family|#(?!fff\b)[0-9a-f]{3,6}\b/i, "the rail pip's own black and white only");
  assert.match(read('scripts/ui-scan.js'), /#subnav \[data-sub\]/, 'the UI check looks at every part');
});

test('a register: the list first; above it only find, show, period, Export and what needs doing now', () => {
  const js = read('assets/admin-registers.js');
  const paint = js.slice(js.indexOf('function paintRegister'), js.indexOf('function exportsInto'));
  const at = (s) => { const i = paint.indexOf(s); assert.ok(i > -1, s); return i; };
  assert.ok(at('class="rg-tools"') < at('attention(kind, st)'));
  assert.ok(at('attention(kind, st)') < at('<table>'));
  assert.ok(at('<table>') < at('sheetHtml(kind, st.sheet)'), 'the Google Sheet under the list');
  assert.ok(at('<table>') < at('codesHtml(st)'), 'the state codes under the list');
  assert.ok(at('<table>') < at("numbersHtml(st)"), 'the numbering under the list');
  assert.match(paint, /<span data-sr-slot><\/span>/, 'the period and Export on the same line as find');
  assert.doesNotMatch(paint, />Copy table<|>Export to Excel</, 'no row of export buttons');
  assert.match(js, /data-rg="copyall">Copy the table<\/button><button type="button" role="menuitem" data-rg="csv">Download for Excel<\/button>/, 'they are in the Export menu');
  assert.match(js, /function attention\(kind, st\)/);
});

test('reports: the period is a filter and the exports one menu', () => {
  const js = read('assets/admin-reports.js');
  assert.match(js, /<details class="sr-menu"><summary class="ghost">Export<\/summary><div class="sr-pop" role="menu">/);
  assert.match(js, /data-sr-act="csv">Download CSV<\/button>/);
  assert.match(js, /data-sr-act="mail" aria-expanded="false">Email this report<\/button>/);
  assert.match(js, /var slot = p\.querySelector\('\[data-sr-slot\]'\);/);
});
