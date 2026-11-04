'use strict';

/* The site-wide control scan (scripts/ui-scan.js, npm run check:ui), run
   before every release, keeps the rules the owner set: "this is still not
   fixed! so a site wide scan and ensure no such goof ups ever happen" (3 Nov
   2026), and, of a label set above its tick box, "this kinda misalignment
   issue can never happen anywhere on any page" (4 Nov 2026). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scan = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ui-scan.js'), 'utf8');

test('the scan checks every tick box is level with its words, beside them, with room', () => {
  assert.match(scan, /tick box not level with its words/);
  assert.match(scan, /tick box overlaps its words/);
  assert.match(scan, /gap < 6\) out\.push\(`tick box/);
  assert.match(scan, /input\[type="checkbox"\], input\[type="radio"\]/);
});

test('the scan checks contrast, cut words and sideways scroll, and is a release step', () => {
  assert.match(scan, /ratio < 3/);
  assert.match(scan, /cut off:/);
  assert.match(scan, /wider than the screen/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts['check:ui'], /ui-scan\.js/);
});

test('the portal\'s show-key tick sits on one line with its words', () => {
  const portal = fs.readFileSync(path.join(__dirname, '..', 'intern.html'), 'utf8');
  assert.match(portal, /\.ip-field label\.ip-show\{display:flex;align-items:center;gap:10px;[^}]*text-transform:none/);
});

test('the scan keeps every table\'s columns at least 24px apart, by the room the table keeps, not one width\'s line ends', () => {
  assert.match(scan, /if \(gap < 24\) out\.push\(`table columns/);
  assert.match(scan, /paddingLeft[\s\S]*paddingRight/);
  /* owner, 4 Nov 2026, of the interns' guide: "not enough gap ... fix holistically" */
  const guide = fs.readFileSync(path.join(__dirname, '..', 'assets', 'intern-guide.css'), 'utf8');
  assert.match(guide, /\.gd-weeks td\{padding:10px 28px 10px 0;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'assets', 'micro.css'), 'utf8'), /#projects \.cp__lines td\+td\{[^}]*padding-left:28px/);
  /* the panel, which the scan cannot sign in to: its tables keep the same room */
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(admin, /\ntd\{padding:12px 14px;/);
  assert.match(admin, /\.rg td\{padding:6px;/);
  assert.match(admin, /\.fr-sum td \+ td\{[^}]*padding-left:28px/);
});

/* owner, 4 Nov 2026, of two buttons stacked edge to edge under "Send your
   proof": "wtf is this.. look at the buttons. we can never have such issues
   ever" */
test('the scan fails any two boxed buttons closer than 8px, and opens every closed form section to look', () => {
  assert.match(scan, /buttons \$\{yOver > 0 \? 'overlap'/);
  assert.match(scan, /yOver > -8/);
  assert.match(scan, /xOver > -8/);
  /* sections that open only when asked for, by their address */
  assert.match(scan, /querySelectorAll\('\[data-flow\]\[id\]'\)/);
  assert.match(scan, /\$\{base\}\/\$\{f\}#\$\{id\}/);
  /* the application with the guide unread and read */
  assert.match(scan, /pfa\.internGuideRead/);
  /* what sits in a closed <details> is not on the screen */
  assert.match(scan, /const folded = /);
});

test('the Send proof buttons sit in a row with room, and the tight spots found with them are opened up', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'internship.html'), 'utf8');
  assert.match(page, /<div class="btn-row"><a class="btn" href="intern\.html">Open your intern dashboard<\/a><a class="btn btn--light" href="intern-guide\.html">The two-page guide<\/a><\/div>/);
  assert.match(page, /\.btn-row\{display:flex;flex-wrap:wrap;gap:12px;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'laws.html'), 'utf8'), /\.cites\{[^}]*gap:10px/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'events.html'), 'utf8'), /\.ev-nav\{display:flex;gap:10px\}/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'assets', 'deck.css'), 'utf8'), /\.deck__ctl\{position:static;transform:none;display:inline-block;margin:6px 14px\}/);
});
