#!/usr/bin/env node
'use strict';

/* One header, one announcement bar, one stylesheet, one script - stamped
   into every page from a single source.

   Why this exists. The site is static HTML with no build step, so each page
   carried its own copy of the header markup, the header CSS and the script
   that measures it. Fourteen copies drifted into three families:

     - nine pages copied founder.html (collapse at 860px, links hidden at 720px)
     - four copied the shop (collapse at 720px, logo pinned left, letter
       spacing on the links, a Cart style even on pages with no cart)
     - index.html was a bundler export with the header written inline

   ...and a 14 KB base64 logo in every one of them. The header looked
   different from page to page because it *was* different.

   Now:
     assets/chrome-header.html   the markup (template)
     assets/chrome.css           the styling
     assets/chrome.js            the behaviour
     img/logo.png                the logo, a real file

   This script writes the markup into each page between the announcement bar
   and </header>, and makes sure the <link> and <script> are in place. It is
   idempotent; `--check` exits 1 if any page is out of date, which is what
   test/chrome-in-sync.test.js runs.

   Per-page facts live in PAGES below: which nav item is the page's own,
   whether it shows a Cart, and what its announcement says. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'assets', 'chrome-header.html');
const FOOTER = path.join(ROOT, 'assets', 'chrome-footer.html');

const DEFAULT_ANNOUNCE = 'Every drive, camp and open day is free to attend';

/* current: the nav href that is this page. announce: bar text. Every page has the bar; three used to opt out and the
   header looked different on them for it. root: links are absolute because the
   page is served from a nested URL.

   The label, the order and the destination of every nav item are the same on
   every page, so test/header-consistency.test.js sees one header everywhere. */
/* group: which of the four top-level items owns this page, so the trigger is
   marked while the page's own entry inside the menu carries aria-current. A
   page can sit in a section without being a destination in it (report.html
   belongs to Our Work but is not listed there), which is why the two columns
   are separate rather than one derived from the other. */
const PAGES = {
  'index.html':        { current: null,               group: null,               announce: 'Every donation funds rescue, treatment, and lifelong care' },
  'founder.html':      { current: 'founder.html',     group: 'founder.html',     announce: DEFAULT_ANNOUNCE },
  'laws.html':         { current: 'laws.html',        group: 'laws.html',        announce: DEFAULT_ANNOUNCE },
  'academy.html':      { current: 'academy.html',     group: 'laws.html',        announce: DEFAULT_ANNOUNCE },
  'library.html':      { current: 'library.html',     group: 'laws.html',        announce: DEFAULT_ANNOUNCE },
  'someone.html':      { current: 'someone.html',     group: 'laws.html',        announce: DEFAULT_ANNOUNCE },
  'units.html':        { current: 'units.html',       group: 'units.html',       announce: DEFAULT_ANNOUNCE },
  'careers.html':      { current: 'careers.html',     group: 'founder.html', announce: DEFAULT_ANNOUNCE },
  'ask.html':          { current: 'ask.html',         group: 'founder.html',     announce: DEFAULT_ANNOUNCE },
  'track.html':        { current: null,               group: null,               announce: DEFAULT_ANNOUNCE },
  'caregiver-card.html': { current: null,             group: 'get-involved.html',               announce: DEFAULT_ANNOUNCE }, /* the card page is about the card; the nav's tribe entry leads to applying (15 Sep 2026) */
  'achievements.html': { current: 'achievements.html', group: 'units.html',      announce: DEFAULT_ANNOUNCE },
  'report.html':       { current: 'report.html',               group: 'units.html',       announce: 'An animal being hurt? Call 112 first, then tell us here' },
  'newsroom.html':     { current: 'newsroom.html',    group: 'units.html',       announce: DEFAULT_ANNOUNCE },
  'wall.html':         { current: 'wall.html',        group: 'get-involved.html', announce: DEFAULT_ANNOUNCE },
  'get-involved.html': { current: 'get-involved.html#volunteer', group: 'get-involved.html', announce: DEFAULT_ANNOUNCE }, /* the menu's Volunteer opens the one volunteer application, as the footer's does (9 Oct 2026) */
  'cinekind.html':     { current: 'cinekind.html',    group: 'get-involved.html', announce: '' }, /* no bar (22 Oct 2026): the page is the logo and the menu over the trophy, and "4 October" read as a date still to come once it had passed. Before that: */ /* the credit went back over the photograph and above the trophy, where it reads; putting it here cost the hero 115px of black and left the bar saying the same sentence twice. The bar keeps the where and the when */
  'donate.html':       { current: 'donate.html',      group: null,               announce: DEFAULT_ANNOUNCE },
  'events.html':       { current: 'events.html',      group: 'get-involved.html', announce: DEFAULT_ANNOUNCE },
  'shop.html':         { current: 'shop.html',        group: null,               announce: 'Every purchase supports PFA\u2019s work for animals' },
  'search.html':       { current: null,               group: null,               announce: DEFAULT_ANNOUNCE },
  'quiz.html':         { current: 'quiz.html',        group: 'laws.html',        announce: DEFAULT_ANNOUNCE },
  /* The microsites (9 Oct 2026). Privacy is in the footer's legal line, not a menu. */
  'campus.html':       { current: 'campus.html',      group: 'get-involved.html', announce: DEFAULT_ANNOUNCE },
  'campaign.html':     { current: 'campaign.html',    group: 'get-involved.html', announce: DEFAULT_ANNOUNCE },
  'legacy.html':       { current: 'legacy.html',      group: 'get-involved.html', announce: DEFAULT_ANNOUNCE },
  'csr.html':          { current: 'csr.html',         group: 'get-involved.html', announce: DEFAULT_ANNOUNCE },
  'sgacc.html':        { current: 'sgacc.html',       group: 'founder.html',     announce: DEFAULT_ANNOUNCE },
  'privacy.html':      { current: null,               group: null,               announce: DEFAULT_ANNOUNCE }
};

/* submission-collage.html is a full-viewport piece with no site chrome.
   admin.html is the staff panel: it carries no public nav, announcement bar
   or footer, and must not be given them. read.html is the library's reader:
   a full-screen reading room with its own quiet bar (Library, title, Aa,
   Search, Download), where the site header would sit on top of the page
   being read. It links back to library.html, which carries the chrome. */
const SKIP = new Set(['submission-collage.html', 'admin.html', 'read.html']);


function announceMarkup(text) {
  if (!text) return '';
  return '<div class="announce" id="announce" data-cursor="light">\n' +
    '  <p>' + text + '</p>\n' +
    '  <button type="button" aria-label="Close" id="annClose">\u2715</button>\n' +
    '</div>\n';
}

function rootify(html) {
  return html
    .replace(/\b(href|src)="(?!\/|#|https?:|mailto:|tel:|data:)([^"]+)"/g, '$1="/$2"');
}

/* What the site shows (8 Oct 2026). assets/site-visibility.js, inlined at
   the very top of the include, so on every page it runs before any section
   is parsed and hides what the panel has hidden with no flash. Inlined, not
   linked: a <script src> here would hold up the first paint of every page
   for a round trip. The file keeps its comments for whoever reads it; the
   pages get it without them and without indentation, and nothing else is
   changed, so what runs is line for line what the tests require in Node.
   The file is written so that no string or pattern in it contains a comment
   marker (test/site-visibility-page.test.js holds it to that). */
const VISIBILITY = path.join(ROOT, 'assets', 'site-visibility.js');
function visibilityScript() {
  const code = fs.readFileSync(VISIBILITY, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  return `<script id="pfa-vis">\n${code}\n</script>\n`;
}
const VIS_TAG = /[ \t]*<script id="pfa-vis">[\s\S]*?<\/script>\n?/g;

/* Render the template for one page. Pure: string in, string out. */
function renderChrome(page) {
  const spec = PAGES[page];
  if (!spec) throw new Error(`sync-chrome: ${page} is not in PAGES; add it`);
  let out = fs.readFileSync(TEMPLATE, 'utf8')
    .replace(/<!--[\s\S]*?-->\n?/, '')             // the explanatory comment at the top
    .replace('{{VISIBILITY}}\n', '')               // put back below, after rootify, which would rewrite its selectors
    .replace('{{ANNOUNCE}}\n', announceMarkup(spec.announce))
    /* The four top-level items. They are signposts to a section, not the
       page itself, so they take .in-section and never aria-current: a page
       that is its own group's landing page (laws.html under Learn) would
       otherwise emit two aria-current="page" links in one nav. */
    .replace(/\{\{GROUP:([^|}]+)\|([^|}]+)\}\}/g, (m, href, label) => {
      const own = href === spec.group;
      return `<a href="${href}" data-nav="${href}"${own ? ' class="in-section"' : ''}>${label}</a>`;
    })
    .replace(/\{\{CURRENT:([^|}]+)\|([^|}]+)(?:\|([^}]+))?\}\}/g, (m, href, label, cls) => {
      const classes = [];
      if (cls) classes.push(cls);
      /* Where this page sends the item, which is the item itself unless `to`
         says otherwise. data-nav keeps naming the section either way, so a
         rule can still target one nav item without guessing at the href. */
      const dest = href;
      if (href === spec.current) {
        classes.push('current');
        /* On the page itself the link scrolls to the top. On a page that
           only belongs to a section it is highlighted but still goes there,
           rather than to the top of the page you are already on. */
        const own = href === page;
        const target = own ? '#top' : (spec.root ? `/${dest}` : dest);
        return `<a href="${target}" data-nav="${href}" class="${classes.join(' ')}" aria-current="page">${label}</a>`;
      }
      return classes.length ? `<a href="${dest}" data-nav="${href}" class="${classes.join(' ')}">${label}</a>` : `<a href="${dest}" data-nav="${href}">${label}</a>`;
    });
  return visibilityScript() + (spec.root ? rootify(out) : out);
}

/* The stylesheet and script are linked with a fingerprint of their own
   contents (?v=...). vercel.json lets browsers keep assets/ for an hour and
   serve a stale copy for a day while they refresh, and the HTML only five
   minutes. Without the fingerprint, a deploy that changed the header put new
   markup in front of the previous chrome.css: on 3 Oct 2026 the new Shop
   button arrived unstyled, as the word "Shop", until the cache let go. Now a
   changed file is a new URL, fetched at once, and an unchanged one keeps its
   cache. --check fails when a file changed and the pages were not stamped. */
const crypto = require('crypto');
function fingerprint(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets', file))).digest('hex').slice(0, 10);
}
const LINK = (root) => `<link rel="stylesheet" href="${root ? '/' : ''}assets/chrome.css?v=${fingerprint('chrome.css')}">`;
/* Not deferred: it sits right after </header>, so the header exists when it
   runs and window.PFA_CHROME exists for every page script that follows. */
const SCRIPT = (root) => `<script src="${root ? '/' : ''}assets/chrome.js?v=${fingerprint('chrome.js')}"></script>`;

/* Apply the chrome to a page's HTML. Pure. Used by this script and by the
   product/quiz template builders, so a rebuild can never reintroduce a
   hand-copied header. */
function applyChrome(html, page) {
  const spec = PAGES[page];
  if (!spec) throw new Error(`sync-chrome: ${page} is not in PAGES; add it`);

  /* 1. The block: from the announcement bar (if any) to </header> and the
        chrome script right after it. Anything in between is chrome. The
        visibility script in front of the bar is chrome too: taken out here
        wherever it is, and put back at the top of the block. */
  html = html.replace(/[ \t]*<script src="\/?assets\/chrome\.js(?:\?v=[a-f0-9]+)?"( defer)?><\/script>\n?/g, '');
  html = html.replace(VIS_TAG, '');
  const headerOpen = html.indexOf('<header');
  const headerClose = html.indexOf('</header>', headerOpen);
  if (headerOpen < 0 || headerClose < 0) throw new Error(`sync-chrome: ${page} has no <header>`);
  let blockStart = headerOpen;
  const annOpen = html.lastIndexOf('<div class="announce"', headerOpen);
  if (annOpen > -1 && annOpen > html.lastIndexOf('<body', headerOpen)) blockStart = annOpen;
  /* index.html's old bar was `.pfa-ann`; treat it the same way. */
  const oldAnn = html.lastIndexOf('<div class="pfa-ann"', headerOpen);
  if (oldAnn > -1 && oldAnn > html.lastIndexOf('<body', headerOpen)) blockStart = Math.min(blockStart, oldAnn);
  /* Eat the whitespace between the bar and the header so the stamp is tidy. */
  const before = html.slice(0, blockStart).replace(/[ \t]*$/, '');
  const after = html.slice(headerClose + '</header>'.length).replace(/^\n?/, '\n');
  html = before + renderChrome(page).trimEnd() + '\n' + SCRIPT(spec.root) + after;

  /* 1b. The footer: byte-identical everywhere. wall.html's had a stray
         "Get Involved" link inside The Wall's <li>, from a find-and-replace
         that meant to hit the header. One source ends that class of bug. */
  const footOpen = html.indexOf('<footer class="pfa-footer"');
  const footClose = html.indexOf('</footer>', footOpen);
  if (footOpen < 0 || footClose < 0) throw new Error(`sync-chrome: ${page} has no <footer class="pfa-footer">`);
  let footer = fs.readFileSync(FOOTER, 'utf8').replace(/<!--[\s\S]*?-->\n?/, '').trimEnd();
  if (spec.root) footer = rootify(footer);
  html = html.slice(0, footOpen) + footer + html.slice(footClose + '</footer>'.length);

  /* 2. The stylesheet link: once, in <head>, before the page's own <style>. */
  const linkTag = LINK(spec.root);
  html = html.replace(/[ \t]*<link rel="stylesheet" href="\/?assets\/chrome\.css(?:\?v=[a-f0-9]+)?">\n?/g, '');
  const headEnd = html.indexOf('</head>');
  const firstStyle = html.indexOf('<style>', html.indexOf('</title>'));
  const at = firstStyle > -1 && firstStyle < headEnd ? firstStyle : headEnd;
  html = html.slice(0, at) + linkTag + '\n' + html.slice(at);

  return html;
}

function pages() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !SKIP.has(f)).sort();
}

function run({ check } = {}) {
  const stale = [];
  for (const page of pages()) {
    const file = path.join(ROOT, page);
    const current = fs.readFileSync(file, 'utf8');
    const next = applyChrome(current, page);
    if (next !== current) {
      stale.push(page);
      if (!check) fs.writeFileSync(file, next);
    }
  }
  return stale;
}

module.exports = { applyChrome, renderChrome, visibilityScript, PAGES, run };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = run({ check });
  if (check) {
    if (stale.length) {
      console.error(`chrome out of date on: ${stale.join(', ')}\nrun: npm run sync:chrome`);
      process.exit(1);
    }
    console.log('chrome in sync on every page.');
  } else {
    console.log(stale.length ? `chrome stamped into: ${stale.join(', ')}` : 'chrome already in sync.');
  }
}
