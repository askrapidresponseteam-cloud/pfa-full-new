'use strict';

/* One header, everywhere.

   What was actually different, found by comparing all fourteen pages:

   1. wall.html had no "Get Involved". Its own nav link is
      `<a href="#top" class="current">The Wall</a>`, so the pass that added the
      link matched only the footer's `href="wall.html"` and inserted it there.
   2. quiz.html and get-involved.html carried a Cart button and, worse, marked
      Shop as the current page - both inherited from the shop shell
      they are generated from.
   3. index.html hard-coded `padding:0 16px` in six places, header included, so
      the whole home page sat 16px from the edge while every other page used the
      responsive gutter. That is what made its header look different. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
/* read.html is the library's full-screen reader and carries no site header
   (scripts/sync-chrome.js, SKIP). */
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'submission-collage.html' && f !== 'admin.html' && f !== 'read.html');

function header(page) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const i = html.indexOf('<header');
  assert.ok(i > -1, `${page} has no header`);
  return html.slice(i, html.indexOf('</header>', i));
}
/* Every nav link, as [destination, label]. Read from data-nav rather than
   href: the page's own entry has its href rewritten to #top so the link
   scrolls rather than reloads, and comparing hrefs would report that as a
   nineteenth different header. The wordmark carries an image and no
   data-nav, so it falls out here. */
const items = (nav) => [...nav.matchAll(/<a\s[^>]*data-nav="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
  .map((m) => `${m[1]}|${m[2].trim()}`);

/* Four sections, each opening a menu, and Donate. The order is the reading
   order of the markup: the section's own trigger, then what is inside it. */
const NAV = [
  'units.html|Our Work',
  'units.html|Units: find help near you',
  'report.html|Report cruelty',
  'newsroom.html|Newsroom and cases',
  'achievements.html|Policies and achievements',
  'laws.html|Learn',
  'laws.html|What the law says',
  'library.html|Resources library',
  'academy.html|Academy',
  'someone.html|Someone, not something',
  'quiz.html|Test yourself',
  'get-involved.html|Get Involved',
  'get-involved.html#volunteer|Volunteer',          /* the one volunteer application, as in the footer (9 Oct 2026) */
  'get-involved.html#membership|Become a member',
  'get-involved.html#caregiver|Colony caregiver', /* leads to applying; the card page itself left the nav, 15 Sep 2026 */
  'campus.html|PFA Campus',                          /* the microsites, 9 Oct 2026 */
  'internship.html|Virtual internship',              /* 31 Oct 2026 */
  'campaign.html|Plan a campaign',
  'legacy.html|Leave a legacy',
  'csr.html|CSR partnerships',
  'wall.html|The Wall',
  'events.html|Events',
  'cinekind.html|CineKind',
  'founder.html|About',
  'founder.html|The founder',
  'sgacc.html|Sanjay Gandhi Animal Care Centre',
  'careers.html|Careers',
  'ask.html|Contact',
  'donate.html|Donate',
  'shop.html|Shop'
];

test('every page lists the same navigation, in the same order', () => {
  const wrong = [];
  for (const page of pages) {
    const got = items(header(page));
    if (got.join(' · ') !== NAV.join(' · ')) wrong.push(`${page}: ${got.join(' · ')}`);
  }
  assert.deepEqual(wrong, [], `headers disagree:\n  ${wrong.join('\n  ')}`);
});

/* The destination a page is, and the section it sits in. They are not the
   same question: track.html and search.html sit in no section and are no
   item, and the Get Involved menu lists one page twice - Volunteer and
   Become a member are two sections of get-involved.html - so only the first
   of them can carry aria-current. */
const EXPECTED = {
  'founder.html':      ['The founder',               'founder.html'],
  'ask.html':          ['Contact',                   'founder.html'],
  'laws.html':         ['What the law says',         'laws.html'],
  'academy.html':      ['Academy',                   'laws.html'],
  'library.html':      ['Resources library',         'laws.html'],
  'someone.html':      ['Someone, not something',   'laws.html'],
  'quiz.html':         ['Test yourself',             'laws.html'],
  'units.html':        ['Units: find help near you', 'units.html'],
  'newsroom.html':     ['Newsroom and cases',        'units.html'],
  'wall.html':         ['The Wall',                  'get-involved.html'],
  'achievements.html': ['Policies and achievements', 'units.html'],
  'report.html':       ['Report cruelty',            'units.html'],
  'get-involved.html': ['Volunteer',                 'get-involved.html'],
  'cinekind.html':     ['CineKind',                  'get-involved.html'],
  'events.html':       ['Events',                    'get-involved.html'],
  'shop.html':         ['Shop',                      null],
  'careers.html':      ['Careers',                   'founder.html'],
  'caregiver-card.html': [null,                       'get-involved.html'], /* in the section, no longer a destination in it */
  'member-photo.html':   [null,                       'get-involved.html'], /* reached only from the emailed photo link (26 Oct 2026) */
  'donate.html':       ['Donate',                    null],
  /* the microsites (9 Oct 2026): each its own entry, in the section whose
     menu lists it; privacy sits in none, as track and search do */
  'campus.html':       ['PFA Campus',                'get-involved.html'],
  'internship.html':   ['Virtual internship',        'get-involved.html'],
  'campaign.html':     ['Plan a campaign',           'get-involved.html'],
  'legacy.html':       ['Leave a legacy',            'get-involved.html'],
  'csr.html':          ['CSR partnerships',          'get-involved.html'],
  'sgacc.html':        ['Sanjay Gandhi Animal Care Centre', 'founder.html'],
  'privacy.html':      [null,                        null]
};

test('no page marks the wrong item as the current one', () => {
  const wrong = [];
  for (const page of pages) {
    const nav = header(page);
    const marks = [...nav.matchAll(/aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
    /* Two links claiming to be the page at once is what a section landing
       page would produce if the trigger were marked as well as its entry. */
    if (marks.length > 1) wrong.push(`${page}: marks ${marks.length} items (${marks.join(', ')})`);
    const current = marks[0] || null;
    const want = (EXPECTED[page] || [])[0] || null;
    if (want && current !== want) wrong.push(`${page}: marks "${current}", should mark "${want}"`);
    /* A page with no nav entry of its own must not borrow someone else's. */
    if (!want && current) wrong.push(`${page}: marks "${current}" but has no nav entry`);
  }
  assert.deepEqual(wrong, [], wrong.join('; '));
});

test('every page shows which of the four sections it is in', () => {
  const wrong = [];
  for (const page of pages) {
    const nav = header(page);
    const open = [...nav.matchAll(/<a href="[^"]*" data-nav="([^"]+)" class="in-section"/g)].map((m) => m[1]);
    const want = (EXPECTED[page] || [])[1] || null;
    if (open.length > 1) wrong.push(`${page}: opens ${open.length} sections at once`);
    if ((open[0] || null) !== want) wrong.push(`${page}: in-section is "${open[0] || null}", should be "${want}"`);
  }
  assert.deepEqual(wrong, [], wrong.join('; '));
});

test('every header insets by the shared gutter, not a hard-coded value', () => {
  const wrong = [];
  for (const page of pages) {
    const nav = header(page);
    const padding = nav.match(/padding:\s*0\s+([^;"']+)/);
    if (!padding) continue;                      // class-based pages carry it in CSS
    if (!/var\(--g(?:utter)?\)/.test(padding[1])) wrong.push(`${page}: padding 0 ${padding[1]}`);
  }
  assert.deepEqual(wrong, [], `these use a fixed gutter: ${wrong.join(', ')}`);
});

test('the home page is measured like the rest, not pinned to a literal', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/top:34px/.test(html), 'the header must not be pinned to a literal bar height');
  assert.match(html, /<header class="site" id="header"/, 'the home page uses the shared header');
  assert.match(html, /<link rel="stylesheet" href="assets\/chrome\.css\?v=[a-f0-9]{10}">/);
  assert.match(html, /<script src="assets\/chrome\.js\?v=[a-f0-9]{10}"><\/script>/);
  assert.ok(!/header nav\{max-width/.test(html), 'the home page must not cap the nav width on its own');
  assert.ok(!/padding:0 16px/.test(html), 'the home page must not hard-code the gutter');
});
