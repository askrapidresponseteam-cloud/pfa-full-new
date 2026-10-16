'use strict';

/* The CineKind poster wall, matched to its reference (owner, 7 Oct 2026:
   "cinekind tiles look and feel should exactly match the references",
   omrimalka.art). These pin what was changed to get there. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'cinekind.html'), 'utf8');

/* The reels' .mp4 files stay in the repository and out of the site's zip: 13 MB
   that has not changed in weeks, against a zip that must stay under 30 MB.
   KEEP_EXCLUDES in scripts/ship.sh preserves them through a ship, and their
   stills travel as normal. This check reads the videos, so from an unpacked
   zip it would fail, and ship.sh refuses to ship on any failure at all. */
const REELS = path.join(__dirname, '..', 'media/cinekind-2026/reels');
const HAS_REELS = fs.existsSync(REELS) && fs.readdirSync(REELS).some((f) => f.endsWith('.mp4'));
const whenReels = { skip: HAS_REELS ? false : 'the reels\' videos are not in this tree (an unpacked zip); run in the repository' };

const wall = page.slice(page.indexOf('<ul class="hoarding__wall" id="wall">'), page.indexOf('</ul>', page.indexOf('id="wall"')));

test('the wall holds pieces of three kinds, each poster tagged with its kind', () => {
  const kinds = [...wall.matchAll(/<li class="poster" data-kind="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(kinds.filter((k) => k === 'honours').length, 33);
  assert.equal(kinds.filter((k) => k === 'reels').length, 6);
  assert.ok(kinds.filter((k) => k === '2025').length >= 10);
  assert.equal((wall.match(/<li class="poster"/g) || []).length, kinds.length, 'no poster without a kind');
});

test('a filter for each kind, the way the reference splits its own', () => {
  for (const k of ['all', 'honours', 'reels', '2025']) assert.match(page, new RegExp(`<button type="button" data-show="${k}" aria-pressed="(true|false)">${k}</button>`));
  /* The lit tab was yellow (#ffe03a) to match the reference; the owner asked
     for it to change (8 Oct 2026: "make it classy ... change that bar
     color"). Smoked glass, the lit tab a white pill, no yellow anywhere. */
  assert.match(page, /\.hoarding__filter button\[aria-pressed="true"\]\{background:#fff;color:#111/);
  assert.doesNotMatch(page, /#ffe03a/i, 'the yellow is gone from the wall, its tabs and its controls');
  assert.match(page, /kind === 'all' \|\| kindOf\(p\) === kind/);
});

test('every file a wall poster shows is in the tree', whenReels, () => {
  for (const m of wall.matchAll(/(?:src|data-video)="(media\/[^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', m[1])), m[1]);
  }
});

test('a reel on the wall plays on this site, never as a link out, and never starts the PR film', () => {
  for (const m of wall.matchAll(/<li class="poster" data-kind="reels"[^>]*>(<a [^>]*>)/g)) {
    assert.match(m[1], /href="#reels-2026" data-reel-open="[\w-]+"/);
    assert.doesNotMatch(m[0], /instagram|data-film/);
  }
  assert.match(page, /window\.__ckOpenReel = function\(slug\)/);
});

test('the name in the corner is a bold sans, the controls small white tiles, the map always shown', () => {
  assert.match(page, /\.hoarding__label h1,\.hoarding__label \.hoarding__cap-name\{font-family:'Helvetica Neue'[^}]*font-weight:700/);
  assert.match(page, /\.hoarding__ctl button,\.hoarding__ctl a\{flex-direction:column/);
  assert.match(page, /\.hoarding__map\{opacity:1;transform:none;[^}]*border:3px solid #fff/);
});
