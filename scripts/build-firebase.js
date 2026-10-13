#!/usr/bin/env node
'use strict';

/* Assembles the two directories `firebase deploy` needs, from an allowlist.
 *
 *   public/       what the world may download
 *   functions/    the API, wrapped as one Cloud Function
 *
 * An allowlist, not an ignore list, and deliberately. Firebase Hosting can be
 * pointed at "." with an "ignore" array, and one missing entry there publishes
 * lib/ccavenue.js, api/index.js and firestore.rules as static files anyone can
 * fetch. Naming what ships means a new server file is private by default; the
 * failure mode of a forgotten entry is a missing asset, not a leaked key.
 *
 *   node scripts/build-firebase.js
 *   firebase deploy --project pfa-new-website
 *
 * What Firebase serves, and what it does not
 * -----------------------------------------
 * The public site is on GitHub and served by Vercel. Firebase serves the admin
 * panel and the API behind it, and nothing else. So public/ holds admin.html,
 * the handful of files admin.html loads, and no other page.
 *
 * It used to hold all 31 pages, media/ and a second copy of the library's
 * PDFs, about 480 MB, because `firebase deploy --only functions,hosting`
 * deploys the whole of public/ and public/ was built as a complete mirror of
 * the site. Firebase keeps every version forever and does not dedupe between
 * them, so twenty ships in five days put Hosting storage at 9.73 GB of the
 * 10 GB that is free, for copies of a website Firebase does not serve: the
 * month's downloads were 8.21 MB. See scripts/hosting-limits.js.
 *
 * The full mirror is still one flag away, for comparing the two deployments
 * or moving off Vercel:
 *
 *   node scripts/build-firebase.js --full
 *
 * That bundle is around 480 MB, so the budget below refuses it until the
 * library's PDFs are served from somewhere that is not Hosting. That refusal
 * is the point. It is the thing that was missing on 8 Oct.
 */

const fs = require('fs');
const path = require('path');
const limits = require('./hosting-limits.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const FN = path.join(ROOT, 'functions');

/* ---- what the world may download: the panel, and only the panel --------- */
/* Every other page is on Vercel. admin.html is served here, and every route
   behind it checks the admin token server-side. */
const PANEL_PAGES = ['admin.html'];
/* The files admin.html loads. checkPanel() below reads admin.html and the
   scripts named here and stops the build if any of them wants something that
   is not in this list, so adding a <script> to the panel cannot quietly ship
   a panel that half loads. */
const PANEL_ASSETS = [
  'assets/card-fields.js',
  'assets/caregiver-card.js',
  'assets/firebase-config.js',
  'assets/qr.js',
  'img/logo.png',
  'fonts/marcellus-latin.woff2',
  'fonts/marcellus-latin-ext.woff2',
  /* The signature printed on a caregiver card. The panel draws the card
     itself, so this is the panel's asset, not the site's. */
  'media/pfa-signature.png'
];

/* ---- the whole site, for --full only ----------------------------------- */
/* resources/ holds the library's documents, the PDFs PFA supplied. */
const PUBLIC_DIRS = ['assets', 'fonts', 'img', 'media', '.well-known', 'resources'];
const PUBLIC_FILES = [
  'pfa-search.js', 'pfa-search.css', 'pfa-forms.js',
  'search-index.json', 'search-index.js', 'sitemap.xml', 'robots.txt'
];
/* Never published, whatever else happens. product.html is a template the
   function renders; admin.html is the panel and is served, but every route
   behind it checks the admin token server-side. */
const NEVER = new Set(['product.html']);

/* ---- what the function needs ----------------------------------------- */
const FN_DIRS = ['api', 'lib'];
/* product.html is vercel.json's includeFiles. The two assets/ files are the
   validation rules and district list that lib/ shares with the browser and
   loads as ../assets/<file>. Vercel ships the whole tree so they were always
   there; this bundle ships only what is named, and until 7 Oct 2026 they were
   not named, so every route on the Firebase deployment died on load with
   "Cannot find module '../assets/field-rules.js'" and the panel reported that
   it could not reach /api/admin. checkRequires() below now stops the build if
   anything lib/ or api/ loads is missing from the bundle. */
const FN_FILES = ['product.html', 'assets/field-rules.js', 'assets/india-districts.js', 'assets/site-modules.json'];

function rmrf(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function copyDir(from, to) {
  let n = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    /* Documentation is not content. A README sitting beside media files should
       not become a URL. */
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name.endsWith('.md')) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) n += copyDir(src, dst);
    else { fs.copyFileSync(src, dst); n += 1; }
  }
  return n;
}

function copyFileInto(rel) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) return false;
  const dst = path.join(PUBLIC, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(from, dst);
  return true;
}

/* Every relative require() in the bundled api/ and lib/ must resolve inside
   functions/, or that route crashes on Firebase while working on Vercel. */
function checkRequires() {
  const missing = [];
  const resolves = (p) => [p, p + '.js', p + '.json', path.join(p, 'index.js')].some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      const re = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
      let m;
      while ((m = re.exec(src))) {
        const target = path.resolve(path.dirname(full), m[1]);
        if (!resolves(target)) missing.push(`${path.relative(FN, full)} -> ${m[1]}`);
      }
    }
  };
  for (const dir of FN_DIRS) walk(path.join(FN, dir));
  return missing;
}

/* The same idea for the browser side of the panel. The panel bundle names six
   files; admin.html and those files must not reach for a seventh. A missing
   asset on Firebase is not a 404 in a corner, it is the panel loading without
   the script that draws the cards.
 *
 * Only same-origin paths count. https:// and // are somebody else's server,
 * data: and blob: carry their own bytes, and a bare #id is this page. */
const PANEL_DIRS = ['assets', 'img', 'fonts', 'media'];
function panelReferences(text) {
  const out = new Set();
  const add = (raw) => {
    if (!raw) return;
    let p = raw.trim().replace(/^\.\//, '').replace(/^\//, '');
    p = p.split('?')[0].split('#')[0];
    if (!p || /^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) || raw.trim().startsWith('//')) return;
    if (!PANEL_DIRS.some((d) => p.startsWith(d + '/'))) return;
    out.add(p);
  };
  let m;
  const attr = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  while ((m = attr.exec(text))) add(m[1]);
  const css = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = css.exec(text))) add(m[1]);
  /* 'assets/qr.js' written inside a script, however it is quoted. */
  const quoted = new RegExp('["\'`](?:\\./|/)?((?:' + PANEL_DIRS.join('|') + ')/[A-Za-z0-9._/-]+)["\'`]', 'g');
  while ((m = quoted.exec(text))) add(m[1]);
  return out;
}

function checkPanel() {
  const allowed = new Set(PANEL_ASSETS);
  const wanted = new Set();
  for (const rel of PANEL_PAGES.concat(PANEL_ASSETS)) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    if (!/\.(html|js|css)$/.test(rel)) continue;
    for (const ref of panelReferences(fs.readFileSync(full, 'utf8'))) wanted.add(`${rel} -> ${ref}`);
  }
  const missing = [];
  const optional = [];
  for (const entry of wanted) {
    const ref = entry.split(' -> ')[1];
    if (allowed.has(ref)) continue;
    if (fs.existsSync(path.join(PUBLIC, ref))) continue;
    /* A reference to a file that is not in the tree at all cannot have been
       left out of the bundle: Vercel does not serve it either. The panel's
       OPTIONAL_FACES are the case this exists for - two brand fonts the card
       uses when they are present and synthesises when they are not. Noted, not
       fatal. A file that IS in the tree and not in the bundle is a real
       omission and stops the build. */
    if (!fs.existsSync(path.join(ROOT, ref))) { optional.push(entry); continue; }
    missing.push(entry);
  }
  return { missing, optional };
}

/* ---- the budget ------------------------------------------------------- */
function dirBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += dirBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function biggest(dir, n = 8) {
  const rows = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    rows.push([e.name, e.isDirectory() ? dirBytes(full) : fs.statSync(full).size]);
  }
  return rows.sort((a, b) => b[1] - a[1]).slice(0, n);
}

function checkBudget() {
  const bytes = dirBytes(PUBLIC);
  const worst = limits.worstCaseBytes(bytes);
  const ok = limits.withinBudget(bytes);
  return { bytes, worst, ok };
}

function build(opts = {}) {
  const full = Boolean(opts.full);

  rmrf(PUBLIC);
  rmrf(path.join(FN, 'api'));
  rmrf(path.join(FN, 'lib'));
  rmrf(path.join(FN, 'assets'));
  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.mkdirSync(FN, { recursive: true });

  let pages = 0;
  let assets = 0;

  if (full) {
    for (const file of fs.readdirSync(ROOT)) {
      if (!file.endsWith('.html') || NEVER.has(file)) continue;
      fs.copyFileSync(path.join(ROOT, file), path.join(PUBLIC, file));
      pages += 1;
    }
    for (const dir of PUBLIC_DIRS) {
      const from = path.join(ROOT, dir);
      if (fs.existsSync(from)) assets += copyDir(from, path.join(PUBLIC, dir));
    }
    for (const file of PUBLIC_FILES) {
      if (copyFileInto(file)) assets += 1;
    }
  } else {
    for (const file of PANEL_PAGES) {
      if (NEVER.has(file)) continue;
      if (copyFileInto(file)) pages += 1;
    }
    for (const file of PANEL_ASSETS) {
      if (copyFileInto(file)) assets += 1;
      else console.error(`  missing: ${file}`);
    }
    /* Without this the bare domain is a Firebase 404, and the bare domain is
       how the panel is reached: ship.sh has said "the admin panel is used at
       pfa-new-website.web.app" since 8 Oct. Written here rather than added to
       firebase.json as a redirect, because a redirect on "/" would also shadow
       the real index.html in a --full build. A static file cannot: --full
       copies the site's own index.html over this one. */
    fs.writeFileSync(path.join(PUBLIC, 'index.html'),
      '<!doctype html>\n<meta charset="utf-8">\n<title>PFA admin</title>\n'
      + '<meta name="robots" content="noindex, nofollow">\n'
      + '<meta http-equiv="refresh" content="0; url=/admin.html">\n'
      + '<link rel="canonical" href="/admin.html">\n'
      + '<p>Taking you to the <a href="/admin.html">admin panel</a>.\n');
    pages += 1;
  }

  let server = 0;
  for (const dir of FN_DIRS) server += copyDir(path.join(ROOT, dir), path.join(FN, dir));
  for (const file of FN_FILES) {
    const from = path.join(ROOT, file);
    if (!fs.existsSync(from)) continue;
    fs.mkdirSync(path.dirname(path.join(FN, file)), { recursive: true });
    fs.copyFileSync(from, path.join(FN, file)); server += 1;
  }

  const missing = checkRequires();
  if (missing.length) {
    console.error('\nREFUSING TO BUILD: the function loads files that are not in functions/\n  ' + missing.join('\n  ')
      + '\nAdd them to FN_FILES in scripts/build-firebase.js.');
    process.exit(1);
  }

  if (!full) {
    const panel = checkPanel();
    if (panel.missing.length) {
      console.error('\nREFUSING TO BUILD: the panel loads files that are not in the bundle\n  ' + panel.missing.join('\n  ')
        + '\nAdd them to PANEL_ASSETS in scripts/build-firebase.js.');
      process.exit(1);
    }
    for (const entry of panel.optional) console.log(`  optional, not in the tree: ${entry}`);
  }

  /* The guard that matters: nothing server-side may have reached public/. */
  const leaked = [];
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (/^(lib|api|test|scripts|functions|_inline-extracts|tools)\//.test(r)
               || /(firestore|storage)\.(rules|indexes)/.test(r)
               || r === 'package.json' || r === 'package-lock.json' || r === 'vercel.json'
               || r === 'firebase.json' || r.endsWith('.md')) leaked.push(r);
    }
  };
  walk(PUBLIC);
  if (leaked.length) {
    console.error('\nREFUSING TO BUILD: server files reached public/\n  ' + leaked.join('\n  '));
    process.exit(1);
  }

  /* The second guard that matters: this bundle, kept as many times as Firebase
     keeps it, must not fill the free allowance. */
  const budget = checkBudget();
  if (!budget.ok) {
    console.error(`\nREFUSING TO BUILD: this bundle would fill Firebase Hosting storage.
  bundle              ${limits.mb(budget.bytes)}
  kept versions       ${limits.RETAINED_RELEASES}
  worst case storage  ${limits.gb(budget.worst)}
  allowed             ${limits.gb(limits.SAFE_BYTES)}  (half of Firebase's free ${limits.gb(limits.CEILING_BYTES)})

  Largest things in public/:`);
    for (const [name, size] of biggest(PUBLIC)) console.error(`    ${limits.mb(size).padStart(10)}  ${name}`);
    console.error(`
  Hosting keeps every version and does not dedupe between them, so this is
  multiplied by ${limits.RETAINED_RELEASES} + 1, not stored once. Either keep this bundle under
  ${limits.mb(limits.MAX_BUNDLE_BYTES)}, or serve the large files from somewhere that is not Hosting.
  The numbers are in scripts/hosting-limits.js.`);
    process.exit(1);
  }

  console.log(full
    ? `public/     ${pages} pages, ${assets} assets  (--full: the whole site)`
    : `public/     ${pages} pages, ${assets} assets  (the admin panel; the site is on Vercel)`);
  console.log(`functions/  ${server} server files`);
  console.log('nothing server-side in public/  (checked, not assumed)');
  console.log(`hosting     ${limits.mb(budget.bytes)} a version, ${limits.RETAINED_RELEASES} kept, worst case ${limits.gb(budget.worst)} of ${limits.gb(limits.CEILING_BYTES)} free`);
}

if (require.main === module) build({ full: process.argv.includes('--full') });
module.exports = {
  build, checkRequires, checkPanel, panelReferences, checkBudget, dirBytes,
  PANEL_PAGES, PANEL_ASSETS, PUBLIC_DIRS, PUBLIC_FILES, NEVER
};
