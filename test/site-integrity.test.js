'use strict';

/* The two sites stay in step, and nothing a visitor can click is dead. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('../scripts/audit-site');
const { publicPages } = require('../scripts/build-search-index');
const { KIND_LABELS } = require('../lib/submissions');

const ROOT = path.join(__dirname, '..');

/* The library's PDFs live in the repository and deliberately never travel in
   the site's zip: they are 302 MB and the zip is one file by request. The scan
   below reads links into them, so from an unpacked zip those links would fail
   and scripts/ship.sh refuses to ship on any failure at all. Links into the
   folders that stay behind are left to the repository's run; everything else
   is checked everywhere. */
const HAS_RESOURCES = fs.existsSync(path.join(ROOT, 'resources'));

/* The folders that live in the repository and never travel in the zip, read
   from scripts/ship.sh so the two cannot drift. */
const KEEP_PATHS = ((fs.readFileSync(path.join(ROOT, 'scripts', 'ship.sh'), 'utf8').match(/^KEEP_PATHS=\(([^)]*)\)/m) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
const INTO_KEPT = new RegExp('\\s(?:' + KEEP_PATHS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')/');

/* This used to be skipped whole in an unpacked zip, so a page's own mistake
   (v1.447: a form the audit could not see submitted) passed here and stopped
   the ship on the owner's machine. It now always runs; in an unpacked zip only
   the links into the kept folders are left to the repository's run. */
test('no dead links, fragments, assets, forms, buttons or unmounted API calls on any page', () => {
  const all = audit();
  const { pages, routes } = all;
  const problems = HAS_RESOURCES ? all.problems : all.problems.filter((p) => !INTO_KEPT.test(p));
  /* This guard is here so a scan that silently found nothing cannot pass as a
     clean site. It read pages > 30, from when there were 46 pages; there are
     21, so the guard failed and the scan it protects never ran at all. The
     floor is now well under the real count on both sides, low enough to
     survive a page being retired and high enough to catch a broken walk. */
  assert.ok(pages > 15, `the audit scanned ${pages} pages, which is too few to be a real walk`);
  assert.ok(routes > 20, `the audit found ${routes} mounted routes, which is too few`);
  assert.deepEqual(problems, []);
});

test('the integrity scan knows which folders stay behind in the repository', () => {
  assert.ok(KEEP_PATHS.includes('resources') && KEEP_PATHS.length >= 5, `KEEP_PATHS read from scripts/ship.sh: ${KEEP_PATHS.join(' ')}`);
  assert.ok(INTO_KEPT.test('library.html: link to missing page resources/ABC%20Bluebook.pdf'));
  assert.ok(!INTO_KEPT.test('lab-animal-rules.html: form #labForm has no action and nothing submits it'));
});

test('every submission kind a public form sends is one the server accepts and the panel can name', () => {
  const sent = new Set();
  const sources = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .concat(fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, 'assets', f), 'utf8')));
  sources.forEach((s) => {
    [...s.matchAll(/saveSubmission\(['"](PFA-[A-Z]+)['"]/g)].forEach((m) => sent.add(m[1]));
    [...s.matchAll(/data-(?:reference|help|cinekind)-form=\\?["'](PFA-[A-Z]+)/g)].forEach((m) => sent.add(m[1]));
    /* The two shapes the pages actually use. Without these the scan saw one
       kind out of nine and the assertion below was guarding nothing: a form
       that sent a kind the server refuses would have sailed through. */
    [...s.matchAll(/PFAForms\.submit\(\s*['"](PFA-[A-Z]+)['"]/g)].forEach((m) => sent.add(m[1]));
    [...s.matchAll(/\bkind:\s*['"](PFA-[A-Z]+)['"]/g)].forEach((m) => sent.add(m[1]));
  });
  /* PFA-CG is never sent by the browser: the colony caregiver record is written
     in lib/routes/payment/response.js once CCAvenue confirms the fee, so the
     application cannot exist without payment. It still has to reach the panel. */
  const paid = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'payment', 'response.js'), 'utf8');
  [...paid.matchAll(/\bkind:\s*['"](PFA-[A-Z]+)['"]/g)].forEach((m) => sent.add(m[1]));

  /* Every live intake route on the site. Raise this when a new form lands, so
     deleting a form's submit call is a test failure rather than a silent loss. */
  /* PFA-CK is back: the CineKind nomination form returned for the 2027
     edition (16 Sep 2026), wired through pfa-forms.js the way the note on the
     page demanded, so deleting its submit call is a failure here again. */
  const EXPECTED = ['PFA-CG', 'PFA-CK', 'PFA-CR', 'PFA-EV', 'PFA-J', 'PFA-Q', 'PFA-S', 'PFA-U', 'PFA-V'];
  const missing = EXPECTED.filter((k) => !sent.has(k));
  assert.deepEqual(missing, [], `these no longer reach the panel: ${missing.join(', ')}`);
  const unknown = [...sent].filter((k) => !KIND_LABELS[k]);
  assert.deepEqual(unknown, [], 'kinds the server would refuse with "Unknown submission type"');
  /* and only one vocabulary exists */
  ['lib/routes/admin/records.js', 'lib/routes/admin/metrics.js'].forEach((f) => {
    assert.ok(!/const KIND_LABELS = \{/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} keeps its own copy of the kinds`);
  });
});

test('the search index and sitemap cover every public page', () => {
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-index.json'), 'utf8'));
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const listed = new Set(index.pages.map((p) => (p.url === '/' ? 'index.html' : p.url.slice(1))));
  const missing = publicPages().filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], 'run: node scripts/build-search-index.js');
  /* The sitemap carries clean URLs, because cleanUrls:true makes /laws.html a
     308 to /laws and a sitemap should list the destination, not the redirect.
     The page still has to be there; only the form it is written in changed. */
  publicPages().forEach((f) => assert.ok(sitemap.includes(f === 'index.html' ? '.org/</loc>' : '/' + f.replace(/\.html$/, '') + '</loc>'), `${f} in sitemap.xml`));
  assert.ok(!/\.html<\/loc>/.test(sitemap), 'no sitemap URL points at a redirect');
  assert.ok(!sitemap.includes('admin.html'));
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  assert.match(robots, /Disallow: \/admin\.html/);
  assert.match(robots, /Sitemap: https:\/\/peopleforanimalsindia\.org\/sitemap\.xml/);
});

test('the index the browser downloads carries nothing behind a sign-in', () => {
  /* search-index.json is served at its own URL and anyone may read it. Two
     builders once existed and drifted; the survivor is
     scripts/build-search-index.js, which owns EXCLUDE and PRIVATE itself, so
     the checks below run against the one index and the one builder. */
  const shared = require('../scripts/build-search-index.js');
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-index.json'), 'utf8'));
  const rows = index.rows;
  assert.ok(Array.isArray(rows) && rows.length > 300, 'the shipped index is empty or the wrong shape');

  const leaked = rows.filter((r) => shared.isPrivatePath(r.u));
  assert.deepEqual(leaked.map((r) => r.u), [], 'these are behind a sign-in and are in a public file');

  const excluded = rows.filter((r) => shared.EXCLUDE.has(String(r.u).split('#')[0].split('?')[0]));
  assert.deepEqual(excluded.map((r) => r.u), [], 'these pages are excluded from search and were indexed anyway');

  /* And the builder itself, so the file cannot simply be cleaned by hand while
     the next rebuild puts it back. */
  const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'build-search-index.js'), 'utf8');
  assert.match(builder, /EXCLUDE/, 'the builder does not consult the excluded-page list');
  assert.match(builder, /PRIVATE/, 'the builder does not consult the private-path list');
});

test('the word for the card is the same everywhere a person meets it', () => {
  /* This test was itself a casualty. The card was renamed by blind text
     replacement, which turned 'Colony caregiver' in the renderer into
     'Colony Colony caregiver' - which is what the printed card then said - and
     rewrote this guard into "the public pages must never say the word they are
     supposed to say", so it could not catch it. It reads for the doubling now.
     The word the card was renamed from is hunted across the whole tree by
     test/caregiver-application.test.js, which forbids writing it even here, so
     it is not repeated. The bare second word is left alone on purpose: a page
     may write about caregiver rights or the role of a caregiver, which is the
     ordinary word and not the name of the card. */
  const doubled = /Colony\s+Colony/;
  for (const file of ['assets/caregiver-card.js', 'assets/card-fields.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(!doubled.test(source), `${file} doubles the word for the card`);
  }
  const renderer = fs.readFileSync(path.join(ROOT, 'assets', 'caregiver-card.js'), 'utf8');
  /* the owner's template (24 Oct 2026) names the card at its head */
  assert.ok(renderer.includes("'COLONY CAREGIVER CARD'"), 'the name printed on the card');

  const publicText = publicPages().map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')).join(' ');
  assert.ok(!doubled.test(publicText), 'a public page doubles the word for the card');
  const admin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  assert.ok(!doubled.test(admin), 'the panel doubles the word for the card');
});
