#!/usr/bin/env node
'use strict';

/* Writes assets/site-modules.json: everything the panel's Website section can
   show or hide (owner, 8 Oct 2026: "show/hide any section or content module
   ... without code changes").

   Generated from the pages, never kept by hand, so the list cannot drift
   from the site: a section added to a page is on it at the next build, and
   one taken away is gone from it.

     pages     every page that carries the site's header (scripts/sync-chrome.js
               PAGES): its id (file name without .html), file, title, the menu
               group it sits in as the header's own menus group it (Our Work,
               Learn, Get Involved, About...), the label it has in that menu
     modules   each page's content modules: every top-level <section id="...">
               (one not inside another), and any element marked
               data-module="...". A data-module whose value is the id of a
               section joins that section, so a card elsewhere on the page that
               belongs to it hides with it. The label is the menu entry that
               leads there if there is one, else its heading, else its own
               aria-label or screen label.
     anchors   for each page, which section every id inside a section belongs
               to. Site search reads this, only when a section is hidden, to
               leave out results that land inside it (laws.html#a5 is inside
               #part-a).

   A top-level section with no id cannot be addressed, so it cannot be hidden;
   it is listed in the build's output so it can be given one.

     node scripts/build-site-modules.js           write it
     node scripts/build-site-modules.js --check   exit 1 if it is out of date
                                                  (test/site-visibility-registry.test.js) */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* PFA_SITE_MODULES_OUT lets the test point --check at a copy, so it can show
   a stale file failing without touching the real one. */
const OUT = process.env.PFA_SITE_MODULES_OUT || path.join(ROOT, 'assets', 'site-modules.json');
const HEADER = path.join(ROOT, 'assets', 'chrome-header.html');
const { PAGES } = require('./sync-chrome.js');

const OTHER = 'Not in the menus';
const BUTTONS = 'Donate and Shop';

/* ---- text ---------------------------------------------------------------- */

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', middot: '·', hellip: '…', rupee: '₹', copy: '©',
  mdash: '-', ndash: '-', minus: '-', times: '×' };
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : ' '))
    .replace(/[‐-―−]/g, '-');
}
function text(html) {
  return decode(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attr(attrs, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(' ' + attrs);
  return m ? decode(m[1]) : null;
}

/* ---- the header's menus ------------------------------------------------- */

/* [{ label, home, links: [{ href, label }] }] in the header's order, then the
   buttons that sit on their own (Donate, Shop). */
function menus() {
  const tpl = fs.readFileSync(HEADER, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const groups = [];
  const items = /<div class="navitem">([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = items.exec(tpl)) !== null) {
    const g = /\{\{GROUP:([^|}]+)\|([^|}]+)\}\}/.exec(m[1]);
    if (!g) continue;
    const links = [...m[1].matchAll(/\{\{CURRENT:([^|}]+)\|([^|}]+)(?:\|[^}]+)?\}\}/g)].map((x) => ({ href: x[1], label: decode(x[2]) }));
    groups.push({ label: decode(g[2]), home: g[1], links });
  }
  const rest = tpl.replace(items, '');
  const buttons = [...rest.matchAll(/\{\{CURRENT:([^|}]+)\|([^|}]+)(?:\|[^}]+)?\}\}/g)].map((x) => ({ href: x[1], label: decode(x[2]) }));
  if (buttons.length) groups.push({ label: BUTTONS, home: null, links: buttons });
  return groups;
}

/* ---- a page's modules ---------------------------------------------------- */

/* The page with everything that is not its own content blanked to spaces of
   the same length, so positions still line up: comments, scripts, styles,
   templates, and the shared header and footer (the chrome is not a page's to
   hide). */
function blankOut(html) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, blank)
    .replace(/<header class="site"[\s\S]*?<\/header>/i, blank)
    .replace(/<div class="announce"[\s\S]*?<\/div>/i, blank)
    .replace(/<footer class="pfa-footer"[\s\S]*?<\/footer>/i, blank);
}

/* Where an element that opens at `at` closes: its own tag, counted. */
function closeOf(html, tag, at) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = at;
  let depth = 0;
  let t;
  while ((t = re.exec(html)) !== null) {
    depth += t[1] ? -1 : 1;
    if (!depth) return re.lastIndex;
  }
  return html.length;
}

/* Ids a reader can land on, as site search does (scripts/build-search-index.js
   BLOCK): never a control or a field. */
const LANDING = /^(section|article|div|main|aside|details|summary|figure|li|h[1-6]|header|fieldset|dl|dt|table|ol|ul|p|blockquote)$/i;
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function modulesOf(file, html, menuLabels, warn) {
  const page = blankOut(html);
  const found = [];
  for (const m of page.matchAll(/<(section)\b([^>]*)>/gi)) {
    found.push({ tag: m[1].toLowerCase(), attrs: m[2], at: m.index, end: closeOf(page, m[1], m.index), id: attr(m[2], 'id'), joins: false });
  }
  for (const m of page.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\sdata-module="[^"]*"[^>]*)>/gi)) {
    if (m[1].toLowerCase() === 'section' && attr(m[2], 'id')) continue;   // a section with an id is already in
    found.push({ tag: m[1].toLowerCase(), attrs: m[2], at: m.index, end: closeOf(page, m[1], m.index), id: attr(m[2], 'data-module'), joins: true });
  }
  /* Top level: not inside another candidate that can itself be hidden. */
  const addressable = found.filter((f) => f.id);
  const top = found.filter((f) => !addressable.some((o) => o !== f && o.at < f.at && o.end >= f.end));
  const modules = [];
  const byId = new Map();
  top.forEach((f) => {
    if (!f.id) {
      /* A wrapper whose own sections carry ids is fine: they are the modules
         (get-involved.html's three journeys sit inside one such). */
      if (addressable.some((o) => o.at > f.at && o.end <= f.end)) return;
      const head = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(page.slice(f.at, f.end));
      warn(`${file}: a top-level <${f.tag}> has no id, so it cannot be hidden (${head ? text(head[1]).slice(0, 50) : 'no heading'})`);
      return;
    }
    if (!ID.test(f.id)) { warn(`${file}: "${f.id}" is not an id the panel can use`); return; }
    const inner = page.slice(f.at, f.end);
    let mod = byId.get(f.id);
    if (!mod) {
      mod = { id: f.id, label: labelOf(f, inner, menuLabels), ranges: [] };
      byId.set(f.id, mod);
      modules.push(mod);
    } else if (!f.joins) {
      warn(`${file}: two sections carry id="${f.id}"; the second is hidden with the first`);
    }
    mod.ranges.push([f.at, f.end]);
  });
  /* Which section each landing id inside it belongs to. */
  const anchors = {};
  for (const m of page.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*?\sid="([^"]+)"/gi)) {
    if (!LANDING.test(m[1])) continue;
    const owner = modules.find((mod) => mod.ranges.some(([a, b]) => m.index > a && m.index < b));
    if (owner && m[2] !== owner.id && !byId.has(m[2])) anchors[m[2]] = owner.id;
  }
  return { modules: modules.map((mod) => ({ id: mod.id, label: mod.label })), anchors };
}

/* What the panel calls a section: what the menu calls it, or what it calls
   itself. A kicker or eyebrow inside a heading ("PFA Academy") is not its
   name, and nor is the title of the first item in it: achievements.html's
   record list would otherwise be called after its first record. */
function labelOf(f, inner, menuLabels) {
  if (menuLabels[f.id]) return menuLabels[f.id];
  const journey = attr(f.attrs, 'data-journey');
  if (journey) return journey;
  const own = inner
    .replace(/<(article|details|li)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<span class="[^"]*(kicker|eyebrow)[^"]*">[\s\S]*?<\/span>/gi, ' ');
  const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(own);
  const heading = h ? text(h[1]) : '';
  if (heading) return heading.slice(0, 90);
  const named = attr(f.attrs, 'aria-label') || attr(f.attrs, 'data-screen-label');
  if (named) return named.slice(0, 90);
  return f.id.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function titleOf(file, html) {
  if (file === 'index.html') return 'Home';
  /* a page whose title is written for search results names itself here */
  const own = /<meta name="pfa-name" content="([^"]+)">/i.exec(html);
  if (own) return text(own[1]);
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
  return text(t ? t[1] : file).replace(/\s*[|·]\s*People for Animals\s*$/i, '') || file;
}

/* ---- the registry -------------------------------------------------------- */

function build({ warn } = {}) {
  const say = warn || (() => {});
  const groups = menus();
  const pages = [];
  for (const file of Object.keys(PAGES)) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, 'utf8');
    let group = null;
    let menu = '';
    let order = 999;
    groups.forEach((g, gi) => {
      g.links.forEach((l, li) => {
        if (group || l.href !== file) return;
        group = g.label; menu = l.label; order = gi * 100 + li;
      });
    });
    if (!group && PAGES[file].group) {
      const gi = groups.findIndex((g) => g.home === PAGES[file].group);
      if (gi > -1) { group = groups[gi].label; order = gi * 100 + 99; }
    }
    if (!group) { group = OTHER; order = 10000; }
    /* Menu entries that lead to a section of this page name that section. */
    const menuLabels = {};
    groups.forEach((g) => g.links.forEach((l) => {
      const [f, hash] = l.href.split('#');
      if (f === file && hash && !menuLabels[hash]) menuLabels[hash] = l.label;
    }));
    const { modules, anchors } = modulesOf(file, html, menuLabels, say);
    pages.push({ order, id: file.replace(/\.html$/, ''), file, title: titleOf(file, html), group, menu, modules, anchors });
  }
  pages.sort((a, b) => a.order - b.order || (a.id === 'index' ? -1 : b.id === 'index' ? 1 : a.title.localeCompare(b.title)));
  const labels = groups.map((g) => g.label).concat(pages.some((p) => p.group === OTHER) ? [OTHER] : []);
  const anchors = {};
  pages.forEach((p) => { if (Object.keys(p.anchors).length) anchors[p.id] = p.anchors; });
  return {
    about: 'Everything the panel can show or hide. Generated by scripts/build-site-modules.js from the pages; do not edit by hand.',
    groups: labels.filter((g) => pages.some((p) => p.group === g)),
    pages: pages.map(({ id, file, title, group, menu, modules }) => ({ id, file, title, group, menu, modules })),
    anchors
  };
}

function render(registry) { return JSON.stringify(registry, null, 1) + '\n'; }

function run({ check } = {}) {
  const warnings = [];
  const next = render(build({ warn: (w) => warnings.push(w) }));
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const stale = current !== next;
  if (stale && !check) fs.writeFileSync(OUT, next);
  return { stale, warnings };
}

module.exports = { build, render, run, menus, modulesOf, OUT };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const { stale, warnings } = run({ check });
  warnings.forEach((w) => console.warn(`note: ${w}`));
  if (check) {
    if (stale) {
      console.error('assets/site-modules.json is out of date with the pages.\nrun: npm run build:site-modules');
      process.exit(1);
    }
    console.log('assets/site-modules.json matches the pages.');
  } else {
    console.log(stale ? 'assets/site-modules.json written.' : 'assets/site-modules.json already up to date.');
  }
}
