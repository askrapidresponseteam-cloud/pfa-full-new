'use strict';

/* Owner, 17 Nov 2026: of Request an event, "better if this is also planned
   at least 30 days in advance"; of The Wall, "mention criteria of videos.
   and how to etc." */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FIELDS = require('../lib/submission-fields');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const iso = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const DAY = 86400000;

test('an event is asked for at least 30 days ahead: the page says so, and the form and the server hold it', () => {
  const html = read('events.html');
  assert.match(html, /<li><b>Apply 30 days ahead<\/b><span>Choose a date at least 30 days from today, so it can be planned well\.<\/span><\/li>/);
  assert.match(html, /<input id="evDate" type="date" required>/);
  assert.match(html, /var evEarliest = evDay\(Date\.now\(\) \+ 330 \* 60000 \+ 30 \* 86400000\);/);
  assert.match(html, /errs \+= bad\(evDate, !evDate\.value \|\| evDate\.value < evEarliest\)/);
  const spec = FIELDS.specFor('PFA-EV');
  if (spec) assert.deepEqual(spec.ahead, { field: 'date', days: 30, why: 'Events are planned that far ahead.' });
  const source = read('lib/submission-fields.js');
  assert.match(source, /ahead: \{ field: 'date', days: 30, why: 'Events are planned that far ahead\.' \}/);
  assert.match(source, /date: 'Choose a date at least 30 days from today\.'/);
  const check = FIELDS.validate || FIELDS.check;
  if (typeof check === 'function') {
    const base = { title: 'An adoption drive', name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', address: '12 Car Street', city: 'Udupi', district: 'Udupi', state: 'Karnataka', pin: '576101' };
    const soon = check('PFA-EV', Object.assign({}, base, { date: iso(Date.now() + 10 * DAY) }));
    const later = check('PFA-EV', Object.assign({}, base, { date: iso(Date.now() + 40 * DAY) }));
    const errsOf = (r) => (r && (r.errors || r)) || [];
    assert.ok([].concat(errsOf(soon)).some((e) => e && e.field === 'date'), 'ten days ahead is refused');
    assert.ok(![].concat(errsOf(later)).some((e) => e && e.field === 'date'), 'forty days ahead is taken');
  }
});

test('The Wall says what goes on it, and how to film and send yours', () => {
  const html = read('wall.html');
  for (const rule of ['About animals', 'Long or short', 'Yours to share', 'Never on the wall']) assert.ok(html.includes(`<li><b>${rule}</b>`), rule);
  assert.match(html, /<summary>How to film and send yours<\/summary>/);
  for (const step of ['Film it', 'Say what it is', 'Post it publicly', 'Send the link', 'An editor watches it']) assert.ok(html.includes(`<p>${step}</p>`), step);
  assert.ok(html.indexOf('class="wall-rules"') < html.indexOf('href="#submit">Share your video'), 'before Share your video');
});
