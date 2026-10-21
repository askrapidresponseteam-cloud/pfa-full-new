'use strict';

/* The CineKind 2026 red carpet film (owner, 5 Oct 2026: "it should play like
   the video player in the wall and the founder section"). It opens in the
   site's one theatre, assets/theatre.js, not in a frame of its own. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'cinekind.html'), 'utf8');

test('the red carpet film sits at the head of the 2026 honours', () => {
  const sec = page.slice(page.indexOf('id="honours-2026"'));
  assert.ok(sec.indexOf('id="night-2026"') > 0 && sec.indexOf('id="night-2026"') < sec.indexOf('<ol class="roll">'));
  assert.match(page, /class="night__play" href="https:\/\/www\.youtube\.com\/watch\?v=LCwIbbSg-8E" data-yt="LCwIbbSg-8E"/, 'without a script it is still a link to the film');
});

test('it plays in the same theatre as the wall and the founder page', () => {
  assert.match(page, /<link rel="stylesheet" href="assets\/theatre\.css">/);
  assert.match(page, /<script src="assets\/theatre\.js"><\/script>/);
  /* owner, 21 Oct 2026: "every video that streams from YT on the website
     should play like this. across the website": the PR film by the wall and
     the red carpet film, one theatre, two films */
  assert.match(page, /var list = \[\{ wall: 'long', title: 'CineKind 2026', credit: 'People for Animals and the Film Federation of India', yt: 'GgrFF97F8_s' \}\];/);
  assert.match(page, /list\.push\(\{ wall: 'long', title: 'CineKind 2026: on the red carpet at The Leela', credit: 'BollywoodHelpline', yt: nightId \}\)/);
  assert.match(page, /window\.PFA_THEATRE\.mount\(\{\s*films: list,/);
  assert.match(page, /progKey: 'pfa:cinekind:progress'/);
  assert.match(page, /closest\('\[data-film\]'\)[\s\S]{0,120}T\.open\(0, 'long'\)/, 'the PR button opens the theatre');
  assert.match(page, /T\.open\(1, 'long'\)/, 'the poster opens the red carpet film');
  assert.doesNotMatch(page, /cineScreen|youtube-nocookie|iframe_api|class="screen"/, 'no screening room of its own any more');
  assert.doesNotMatch(page, /night__frame/, 'no second, page-made player beside it');
});

test('the theatre hides its idle video even where a page sets video to display:block', () => {
  assert.match(page, /img,svg,video\{display:block\}/);
  assert.match(fs.readFileSync(path.join(ROOT, 'assets/theatre.css'), 'utf8'), /\.th-stage video\[hidden\]\{display:none\}/);
});
