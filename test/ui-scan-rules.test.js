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
  const guide = fs.readFileSync(path.join(__dirname, '..', 'intern-guide.html'), 'utf8');
  assert.match(guide, /\.gd-weeks td\{padding:10px 28px 10px 0;/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'assets', 'micro.css'), 'utf8'), /#projects \.cp__lines td\+td\{[^}]*padding-left:28px/);
  /* the panel, which the scan cannot sign in to: its tables keep the same room */
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(admin, /\ntd\{padding:12px 14px;/);
  assert.match(admin, /\.rg td\{padding:6px;/);
  assert.match(admin, /\.fr-sum td \+ td\{[^}]*padding-left:28px/);
});
