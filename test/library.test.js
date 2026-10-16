'use strict';

/* The PFA Library (library.html) and its reader (read.html).

   The shelves hold exactly the documents PFA supplied on its resources
   page (PFA Resources, Downloadable Links), under the titles and Google
   Drive files it gave; the page and the reader's catalogue are in step
   with data/library.json; every PDF has its own cover; and the contents
   the reader lists are the document's own. The extraction tests run pdf.js
   over small PDFs in
   test/fixtures/library/ made to have the shapes of the real documents: a
   cover, running heads and folios, chapters, numbered clauses, bullets, a
   table split over a page turn, a picture page, hyphenated line ends, a
   paragraph across a page break, a scan, and Hindi set in a legacy font. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');

/* The library's PDFs live in the repository and deliberately never travel in
   the site's zip: they are 302 MB and the zip is one file by request. Every
   check below reads them, so from an unpacked zip they would fail, and
   scripts/ship.sh refuses to ship on any failure at all. That turned "the zip
   does not carry the PDFs", which is intended, into "this build cannot be
   shipped", which is not. Skipped with a word when they are absent, run in
   full in the repository, where they are the thing that matters. */
const HAS_RESOURCES = fs.existsSync(path.join(ROOT, 'resources'));
const whenResources = { skip: HAS_RESOURCES ? false : 'resources/ is not in this tree (an unpacked zip); run in the repository' };

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const B = require('../scripts/build-library.js');
const X = require('../scripts/library-extract.js');
const DATA = JSON.parse(read('data/library.json'));
const FIX = path.join(__dirname, 'fixtures', 'library');

/* As supplied, shelf by shelf, in the supplied order. */
const SUPPLIED = {
  essential: [
    ['Prevention of Cruelty to Animals Act 1960', '12aqsaqS6JVgO4AV7dax3hx_6QhsyHvhX'],
    ['Revised Animal Birth Control Module', '12LiBm5L3p6D96-RhOploL_gTafvTgK7w'],
    ['Animal Law Handbook for Urban Local Bodies', '1YhUMAWqUbxZCFlIJ4j7YmWKLnEb_YrG3'],
    ['Law Enforcement Handbook on Animal Welfare Laws', '1Xnb_WxHTdDULwbr7aelo95XlgMyPD2m2'],
    ['Handbook for Veterinary Officers on Animal Welfare Laws', '1jV3sN_CQSrD1sJLVQZEGPgyDZzZ9vRpj']
  ],
  handbooks: [
    ['ABC Training Blue Book, Nagar Nigam, Lucknow', '1Cw8N_-t3DfZKvNC5cynu7XfrdxBg6UyN'],
    ['Delhi Police Handbook', '1xlf_lgf_QF8OrvvKNWMJWuFci1NGJRYv'],
    ['UP UD Handbook', '1qbm0vh0sSzBtlYWRPEfAZ6U2WcNZ5D52'],
    ['EY - Transitioning to Cage-Free', '1vgEnm8yTnIeaFQ607J2Y6jvetpdPUYwR'],
    ['Package Of Practices For Organized Pig Farms', '1xUbK6Vw1rb_YT7U0hg1oiI894vos_vAp'],
    ['Piggery Handbook Uttarakhand', '1XoO45Hs5kq2gPQxFwTbPTfJevSMJnYUS'],
    ['Kanha Gaushala, Govt of UP', '1igF7rS-uUIraStXTPGvTziN664ClPnoI'],
    ['Shvaan Pashu', '17JX79mBQi4rrjEq30zp2aEzXqqBMAfih'],
    ['Minimum Standards for Veterinary Infrastructure', '17ZK8TIqTvPuTrjIvgAlWqUTGUWh068fX']
  ],
  research: [
    ['SCC Policy Brief', '1AD3a39onjZaAexJBH2FCAqzAD7DgzyEo'],
    ['Hidden Costs of Piggery Operations in India', '1OigazDKppHhDateqLwdFmvcsPyNwau0D']
  ]
  /* The Financial scoping reports shelf (Dairy, Pig and Poultry Scoping
     Reports) was removed entirely on the owner's word, 8 Oct 2026:
     data/library-withdrawn.json. */
};

/* ---- the catalogue ------------------------------------------------------ */

test('the shelves hold exactly the supplied documents, as supplied, and nothing else', () => {
  assert.deepEqual(DATA.shelves.map((s) => s.id), Object.keys(SUPPLIED));
  for (const shelf of Object.keys(SUPPLIED)) {
    const got = DATA.items.filter((it) => it.shelf === shelf).map((it) => [it.title, it.drive]);
    assert.deepEqual(got, SUPPLIED[shelf], `shelf ${shelf}`);
  }
  assert.equal(DATA.items.length, 16);
});

test('data/library.json passes its own validation', whenResources, () => {
  assert.deepEqual(B.validate(DATA), []);
  const broken = JSON.parse(JSON.stringify(DATA));
  broken.items[1].drive = broken.items[0].drive;
  broken.items[2].shelf = 'nowhere';
  broken.items[3].coverPage = 1;
  const problems = B.validate(broken);
  assert.ok(problems.some((p) => /coverPage/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /same file/.test(p)), problems.join('; '));
  assert.ok(problems.some((p) => /not one of the shelves/.test(p)), problems.join('; '));
});

test('library.html and the reader catalogue are in step with the data (run node scripts/build-library.js)', whenResources, () => {
  const metas = {};
  for (const it of DATA.items) metas[it.slug] = B.metaFor(it);
  const page = read('library.html');
  assert.equal(B.render(page, DATA, metas), page, 'library.html is out of date');
  assert.equal(B.clientData(DATA, metas), read('assets/library-data.js'), 'assets/library-data.js is out of date');
});

test('every document has a card that opens the reader and offers the original', whenResources, () => {
  const page = read('library.html');
  for (const it of DATA.items) {
    const card = page.slice(page.indexOf(`data-slug="${it.slug}"`));
    assert.match(card, new RegExp(`href="read\\.html\\?r=${it.slug}"`), `${it.slug} has no Read link`);
    const meta = B.metaFor(it);
    if (meta.file) assert.ok(card.includes(`href="${meta.file}"`), `${it.slug} should download the copy served here`);
    else assert.ok(card.includes(`id=${it.drive}`), `${it.slug} should download from the supplied Drive file`);
  }
});

test('every PDF PFA put in resources/ belongs to a document, and every named one is there', whenResources, () => {
  const named = new Set(DATA.items.filter((it) => it.pdf).map((it) => it.pdf));
  for (const f of fs.readdirSync(path.join(ROOT, 'resources')).filter((x) => /\.pdf$/i.test(x))) {
    assert.ok(named.has(`resources/${f}`), `resources/${f} is on no shelf`);
  }
  for (const rel of named) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
});

test('a card links each PDF by its encoded name, and the file is on disk', whenResources, () => {
  const page = read('library.html');
  for (const m of page.matchAll(/href="((?:resources|media\/library)\/[^"]+)"/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, decodeURIComponent(m[1]))), m[1]);
    assert.doesNotMatch(m[1], /\s|\p{Script=Devanagari}/u, `${m[1]} should be percent-encoded`);
  }
});

test('every index is current with its PDF and with the extractor (run node scripts/build-library.js --extract)', () => {
  const crypto = require('crypto');
  for (const it of DATA.items) {
    const rel = B.pdfPath(it);
    if (!rel) continue;
    const file = path.join(ROOT, 'media', 'library', `${it.slug}.json`);
    assert.ok(fs.existsSync(file), `${it.slug} has no index`);
    const e = JSON.parse(fs.readFileSync(file, 'utf8'));
    const buf = fs.readFileSync(path.join(ROOT, rel));
    assert.equal(e.x, X.VERSION, `${it.slug} was read by an older extractor`);
    assert.equal(e.src.bytes, buf.length, `${it.slug}: the PDF has changed`);
    assert.equal(e.src.sha1, crypto.createHash('sha1').update(buf).digest('hex'), `${it.slug}: the PDF has changed`);
  }
});

test('every PDF on the shelves shows its own first page as its cover', () => {
  const page = read('library.html');
  for (const it of DATA.items) {
    if (!B.pdfPath(it)) continue;
    const meta = B.metaFor(it);
    assert.equal(meta.cover, `media/library/covers/${it.slug}.webp`, `${it.slug} has no cover`);
    assert.ok(fs.existsSync(path.join(ROOT, meta.cover)), meta.cover);
    const card = page.slice(page.indexOf(`data-slug="${it.slug}"`));
    assert.ok(card.slice(0, card.indexOf('</article>')).includes(`<img class="cover__img" src="${meta.cover}"`), `${it.slug}: the card does not show the cover`);
  }
});

test('reading time reads like a person would say it', () => {
  assert.equal(B.readingTime(0), '');
  assert.equal(B.readingTime(3), '5 min read');
  assert.equal(B.readingTime(22), '20 min read');
  assert.equal(B.readingTime(60), 'About 1 hour');
  assert.equal(B.readingTime(150), 'About 2\u00BD hours');
});

/* ---- the reader -------------------------------------------------------- */

test('the reader bar is Library, title, Aa, Search, Download, in that order', () => {
  const html = read('read.html');
  const bar = html.slice(html.indexOf('<header class="rd-bar"'), html.indexOf('</header>'));
  const order = ['id="rdBack"', 'id="rdTitle"', 'id="rdAaBtn"', 'id="rdFindBtn"', 'id="rdDl"'].map((id) => bar.indexOf(id));
  assert.ok(order.every((i) => i > -1), 'a control is missing from the bar');
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
});

test('the Aa panel sets the paper, the page size, and how the pages turn', () => {
  const html = read('read.html');
  for (const [k, vs] of Object.entries({ theme: ['light', 'sepia', 'dark'], layout: ['paged', 'scroll'], spread: ['1', '2'] })) {
    for (const v of vs) assert.ok(html.includes(`data-k="${k}" data-v="${v}"`), `${k}=${v}`);
  }
  assert.match(html, /id="rdSizeDown"[\s\S]*id="rdSize"[\s\S]*id="rdSizeUp"/, 'A-, slider, A+');
});

test('the reader shows the PDF itself: no title page of its own, no retyped text', () => {
  const js = read('assets/reader.js');
  assert.match(js, /PFA_READER_PDF/);
  assert.doesNotMatch(js, /rd-cover|rd-flow|item\.edition/);
  assert.doesNotMatch(read('read.html'), /rdFrame|rdText|Literata/);
  assert.doesNotMatch(read('assets/reader.css'), /Literata|OpenDyslexic|\.rd-cover/);
});

test('the library and the reader keep progress under the same key', () => {
  const key = /'pfa:library:v1'/;
  assert.match(read('assets/library.js'), key);
  assert.match(read('assets/reader.js'), key);
  assert.match(read('read.html'), /pfa:library:settings/);
  assert.match(read('assets/reader.js'), /'pfa:library:settings'/);
});

test('the reader loads the catalogue first, stays out of search engines, and needs no site chrome', () => {
  const html = read('read.html');
  assert.ok(html.indexOf('<script src="assets/library-data.js">') > -1);
  assert.ok(html.indexOf('<script src="assets/library-data.js">') < html.indexOf('<script src="assets/reader.js">'));
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.doesNotMatch(html, /<header class="site"/);
  assert.match(read('scripts/build-search-index.js'), /'read\.html'\]\);/);
});

test('pdf.js ships as .js under assets/vendor, so the deploy keeps it and lint skips it', () => {
  for (const f of ['pdf.min.js', 'pdf.worker.min.js', 'wasm/jbig2.wasm', 'wasm/openjpeg.wasm', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/vendor/pdfjs', f)), f);
  }
  assert.match(read('eslint.config.mjs'), /'assets\/vendor\/\*\*'/);
  assert.match(read('assets/reader-pdf.js'), /isEvalSupported: false/);
});

test('the Drive viewer the reader falls back to is named in the policy on both hosts', () => {
  for (const f of ['vercel.json', 'firebase.json']) assert.match(read(f), /frame-src [^;]*https:\/\/drive\.google\.com/);
});

/* ---- the reading editions ---------------------------------------------- */

const squash = (s) => String(s).toLowerCase().replace(/[\s\u00AD-]+/g, '');

async function edition(name) {
  const raw = await X.readPdf(fs.readFileSync(path.join(FIX, name)));
  return { raw, ed: X.buildEdition(raw) };
}

test('an edition says only what the PDF says: every block is the PDF\'s own text, joined', async () => {
  for (const name of ['legal.pdf', 'hyphen.pdf']) {
    const { raw, ed } = await edition(name);
    /* the PDF's text less its running heads and folios, which an edition drops */
    const pages = raw.pages.map((p) => ({ ...p, lines: p.lines.slice() }));
    X.stripFurniture(pages);
    const source = squash(pages.map((p) => p.lines.map((l) => l.cells.join('')).join('')).join(''));
    for (const b of ed.blocks) {
      if (b[0] === 'fig') continue;
      const text = b[0] === 'table' ? b[1].map((r) => r.join('')).join('') : b[1];
      assert.ok(source.includes(squash(text)), `${name}: "${String(text).slice(0, 60)}" is not in the PDF`);
    }
  }
});

test('running heads and page numbers are dropped, chapters ranked, clauses and bullets kept', async () => {
  const { ed } = await edition('legal.pdf');
  assert.equal(ed.text, true);
  const all = ed.blocks.map((b) => (Array.isArray(b[1]) ? b[1].flat().join(' ') : b[1]));
  assert.ok(!all.some((t) => t === 'Handbook on Animal Welfare Laws'), 'the running head survived');
  assert.ok(!all.some((t) => /^\d+$/.test(t)), 'a folio survived');
  const heads = ed.blocks.filter((b) => /^h\d$/.test(b[0])).map((b) => b[1]);
  assert.ok(heads.includes('CHAPTER I') && heads.includes('Preliminary'));
  const li = ed.blocks.filter((b) => b[0] === 'li');
  assert.deepEqual(li.slice(0, 3).map((b) => b[3]), ['(1)', '(a)', '(b)']);
  assert.ok(li.some((b) => b[3] === '\u2022' && /species, sex/.test(b[1])));
  assert.ok(ed.toc.some((t) => t.t === 'CHAPTER II: Duties of the municipal body'), 'a chapter label and its title make one contents entry');
});

test('a table keeps its rows, and a picture page is pointed to rather than lost', async () => {
  const { ed } = await edition('legal.pdf');
  const table = ed.blocks.find((b) => b[0] === 'table');
  assert.ok(table, 'no table');
  assert.deepEqual(table[1][0], ['Offence', 'First conviction', 'Repeat']);
  assert.equal(table[1].length, 4);
  const fig = ed.blocks.find((b) => b[0] === 'fig');
  assert.ok(fig && fig[2] === 5, 'the picture page is not marked');
});

test('hyphenated line ends join, and a paragraph that crosses a page stays one paragraph', async () => {
  const { ed } = await edition('hyphen.pdf');
  const paras = ed.blocks.filter((b) => b[0] === 'p').map((b) => b[1]);
  assert.ok(paras[0].includes('financial exposure of the sector') && paras[0].includes('the assumptions behind'), paras[0]);
  assert.ok(paras.some((p) => /before the page ended, so the reader must see one paragraph/.test(p)), 'the page break split the paragraph');
  assert.ok(paras.includes('Third paragraph is separate.'));
});

test('a scan, and Hindi in a legacy font, are offered as original pages, not as gibberish', async () => {
  const scan = (await edition('scanned.pdf')).ed;
  assert.equal(scan.text, false);
  assert.match(scan.quality.reason, /scan/);
  assert.deepEqual(scan.blocks, []);
  const legacy = (await edition('legacy-hindi.pdf')).ed;
  assert.equal(legacy.text, false);
  assert.match(legacy.quality.reason, /legacy Hindi font/);
});

test('Devanagari read in visual order is put back, and logical order is left alone', () => {
  const logical = '\u0915\u093F\u0938 \u0938\u092E\u093F\u0924\u093F';
  assert.equal(X.fixDevanagari(logical), logical);
  assert.equal(X.fixDevanagari('\u093F\u0915\u0938 \u093F\u0915\u0924\u093E\u092C \u093F\u0926\u0928'), '\u0915\u093F\u0938 \u0915\u093F\u0924\u093E\u092C \u0926\u093F\u0928');
});

test('Hindi a font has scrambled is recognised, and good Hindi is not', () => {
  const good = '\u0936\u094D\u0935\u093E\u0928 \u092A\u0936\u0941 \u092A\u094D\u0930\u092C\u0928\u094D\u0927\u0928 \u092E\u0948\u0928\u0941\u0905\u0932';
  assert.equal(X.devanagariDamage(good).bad, 0);
  const scrambled = '\u1B6B \u0935\u093E\u0928 \u092A\u1CEF\u0930\u091A\u092F \u092A\u0930\u093E\u092E?\u0930\u094D\u0936\u0940';
  assert.ok(X.devanagariDamage(scrambled).ratio > 0.5);
});

test('bookmarks that are ids, file names or bare page numbers are not contents', () => {
  assert.equal(X.saneTitle('Chapter 2: Summary'), true);
  assert.equal(X.saneTitle('Page 12'), false);
  assert.equal(X.saneTitle('ee2613e3defed6fd3d7bb6e5a762c444dbaa4d9e6100348fb392267cc4681b38.pdf'), false);
  assert.equal(X.saneTitle('9bb0e1cce4a8b9ba40b6661b55f47abb8a928015'), false);
});

test('only a hyphen before a lower-case continuation is a line-end hyphen', () => {
  assert.equal(X.joinLine('the ex-', 'posure'), 'the exposure');
  assert.equal(X.joinLine('Section 11 of the PCA-', 'Act'), 'Section 11 of the PCA- Act');
  assert.equal(X.joinLine('one', 'two'), 'one two');
});

/* A contents page as the real ones are set: a page number in its own column
   beside the first line of a title run over onto a second, and a cover and
   a contents page ahead of page 1, so printed numbers are two behind. */
test('the printed contents become the contents, each entry on the page where it starts', () => {
  const L = (text, x0, y, size = 12, bold = false) => ({ text, cells: [text], xs: [x0], x0, x1: x0 + text.length * size * 0.5, y, size, bold });
  const prose = 'Pigs are kept in many parts of the country, in backyards and on farms of every size.';
  const page = (n, lines) => ({ n, width: 595, height: 842, lines: lines.concat([L(prose, 72, 600), L(prose, 72, 585), L(prose, 72, 570)]) });
  const contents = { n: 2, width: 595, height: 842, lines: [
    L('Contents', 72, 760, 24),
    L('Sl. No. Name of the chapter Page Number', 72, 730),
    L('1 Introduction 1', 72, 700),
    L('2 Breeding strategy to be followed in organised', 72, 678),
    L('6', 500, 678),
    L('farms', 90, 664),
    L('3 Care of Pigs ........ 9', 72, 640)
  ] };
  const entries = X.readContents([contents]);
  assert.deepEqual(entries.map((e) => [e.t, e.printed]), [
    ['1 Introduction', 1], ['2 Breeding strategy to be followed in organised farms', 6], ['3 Care of Pigs', 9]
  ]);
  const pages = [page(1, [L('PIG FARMS', 72, 700, 30)]), contents];
  for (let n = 3; n <= 12; n++) {
    const heads = { 3: '1. Introduction', 8: '2. Breeding Strategy to be Followed in Organised Farms', 11: '3. Care of Pigs' };
    pages.push(page(n, heads[n] ? [L(heads[n], 72, 760, 18, true)] : [L('The introduction of new breeds is covered later.', 72, 760)]));
  }
  assert.deepEqual(X.placeContents(entries, pages, 3), [
    { t: '1 Introduction', l: 1, p: 3 },
    { t: '2 Breeding strategy to be followed in organised farms', l: 1, p: 8 },
    { t: '3 Care of Pigs', l: 1, p: 11 }
  ]);
  /* not one entry found by its words: no contents is better than wrong pages */
  assert.equal(X.placeContents(entries, pages.slice(0, 2), 3), null);
});

/* ---- withdrawn on purpose ----------------------------------------------- */

const WITHDRAWN = JSON.parse(read('data/library-withdrawn.json'));

test('the Financial scoping reports shelf is gone entirely: no shelf, no document, no file, no chip, no word', () => {
  assert.deepEqual(WITHDRAWN.withdrawn.map((w) => w.slug).sort(), ['dairy-scoping-report', 'pig-scoping-report', 'poultry-scoping-report']);
  assert.ok(!DATA.shelves.some((s) => s.id === 'scoping'), 'no shelf');
  for (const w of WITHDRAWN.withdrawn) {
    assert.ok(!DATA.items.some((it) => it.slug === w.slug), `${w.slug} is on no shelf`);
    for (const f of w.files) assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} is deleted`);
    for (const f of [`media/library/${w.slug}.json`, `media/library/covers/${w.slug}.webp`]) assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} is deleted`);
  }
  for (const f of ['library.html', 'assets/library-data.js', 'search-index.json', 'assets/site-modules.json']) {
    assert.doesNotMatch(read(f), /[Ss]coping|Following the money/, `${f} still mentions them`);
  }
});

test('the filter chips and the count are written from the data, one chip a shelf', () => {
  const page = read('library.html');
  const chips = [...page.matchAll(/<button class="chip" type="button" data-shelf="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['all'].concat(DATA.shelves.map((s) => s.id)));
  assert.match(page, new RegExp(`id="libCount"[^>]*>${DATA.items.length} documents<`));
});

test('a deploy deletes the withdrawn files it copies in from the live tree, and only under resources/', () => {
  const os = require('node:os');
  const W = require('../scripts/withdraw-library.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pfa-withdraw-'));
  fs.mkdirSync(path.join(tmp, 'data'));
  fs.mkdirSync(path.join(tmp, 'resources', 'read'), { recursive: true });
  const list = JSON.parse(JSON.stringify(WITHDRAWN));
  list.withdrawn.push({ slug: 'evil', files: ['data/library.json', 'resources/../data/library.json'] });
  fs.writeFileSync(path.join(tmp, 'data', 'library-withdrawn.json'), JSON.stringify(list));
  fs.writeFileSync(path.join(tmp, 'data', 'library.json'), '{}');
  for (const w of WITHDRAWN.withdrawn) for (const f of w.files) fs.writeFileSync(path.join(tmp, f), 'pdf');
  fs.writeFileSync(path.join(tmp, 'resources', 'Keep me.pdf'), 'pdf');
  const removed = W.withdraw(tmp);
  assert.equal(removed.length, 6);
  assert.ok(fs.existsSync(path.join(tmp, 'resources', 'Keep me.pdf')), 'nothing else is touched');
  assert.ok(fs.existsSync(path.join(tmp, 'data', 'library.json')), 'nothing outside resources/');
  assert.match(read('DEPLOY.command'), /node scripts\/withdraw-library\.js/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ---- the reader: a way back, always ------------------------------------- */

test('the reader keeps its bar and dock on screen, with Back and Home, and never hides them', () => {
  const css = read('assets/reader.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const bar = /\.rd-bar\{[^}]*\}/.exec(css)[0];
  const dock = /\.rd-dock\{[^}]*\}/.exec(css)[0];
  assert.doesNotMatch(bar, /translateY\(-100%\)|opacity:0/, 'the bar is not moved off screen');
  assert.doesNotMatch(dock, /translateY\(100%\)|opacity:0/, 'nor the dock');
  const js = read('assets/reader.js');
  assert.doesNotMatch(js.replace(/\/\*[\s\S]*?\*\//g, ''), /classList\.remove\('rd-chrome'\)/, 'nothing takes the chrome away');
  const html = read('read.html');
  assert.match(html, /id="rdBack" href="library\.html"/);
  assert.match(html, /id="rdHome" href="index\.html" aria-label="People for Animals home"/);
  assert.match(js, /Back to the page you came from/, 'Back says where it goes when it goes back');
});
