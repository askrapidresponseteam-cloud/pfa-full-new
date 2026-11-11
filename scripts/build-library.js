#!/usr/bin/env node
/* The PFA Library: writes the shelves into library.html and the catalogue
   the reader uses into assets/library-data.js, from data/library.json.

     node scripts/build-library.js                 write the page and the catalogue
     node scripts/build-library.js --check         fail if either is out of date
     node scripts/build-library.js --extract       make the cover and index of every
                                                   document whose PDF is here and has
                                                   changed since its index was made
     node scripts/build-library.js --fetch         the same, after downloading from
                                                   Google Drive any PDF not here yet
     ... add --force to redo every one, or slugs to do only those documents

   Where the PDFs are. PFA put the originals in resources/ under their own
   file names (3 Oct 2026); an entry's "pdf" names its file there, and the
   site serves it from that path. A document with no "pdf" is fetched from
   its Google Drive link by --fetch into media/library/<slug>.pdf. A browser
   cannot read a Drive file from another site (Drive sends no CORS headers),
   so a document the site does not serve opens in Google Drive's own viewer
   inside the reading frame, with Download going to Drive.

   The reader shows the PDF itself. What the build adds, per document, is
   its cover, the first page (or the entry's "coverPage", where a foreword
   was bound in front of the cover) rendered as media/library/covers/<slug>.webp,
   and an index, media/library/<slug>.json: its page count and a contents
   list of its headings with their pages, found by scripts/library-extract.js
   (and, where the text can be trusted, its length for a reading time).
   Each index records the size and SHA-1 of the PDF it was made from and the
   extractor's version, so --extract only redoes what has changed.

   The output never depends on today's date, so --check gives the same answer
   on any day. LIBRARY.md has the rest. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'library.html');
const DATA = path.join(ROOT, 'data', 'library.json');
const CLIENT = path.join(ROOT, 'assets', 'library-data.js');
const PDF_DIR = path.join(ROOT, 'media', 'library');
const ED_DIR = PDF_DIR; // beside the PDF: media/ is published by both hosts, data/ only by Vercel
const COVER_DIR = path.join(PDF_DIR, 'covers');
const SITE = 'https://peopleforanimalsindia.org';
const MAX_BYTES = 95 * 1024 * 1024; // GitHub refuses a file over 100 MB

const START = '<!-- library:start. Written by scripts/build-library.js from data/library.json: edit the data, then run the script. -->';
const END = '<!-- library:end -->';
const STACK_START = '<!-- library-stack:start. Written by scripts/build-library.js. -->';
const STACK_END = '<!-- library-stack:end -->';
/* The filter chips and the count, one chip a shelf (8 Oct 2026: they were
   written by hand, so a shelf taken off the data left its chip and the old
   count behind). */
const CHIPS_START = '<!-- library-chips:start. Written by scripts/build-library.js. -->';
const CHIPS_END = '<!-- library-chips:end -->';

/* A document PFA publishes itself for another page, such as the fireworks
   guide on fireworks.html (owner, 10 Nov 2026: "have this pdf - view +
   download like in library module within the fireworks page"), has
   "listed": false: it opens in the same reader and downloads the same way,
   but stands on no shelf here. "own": true marks a document PFA made, kept
   at media/library/<slug>.pdf, with no Google Drive original. */
const shelved = (data) => data.items.filter((it) => it.listed !== false);

function chipsMarkup(data) {
  const n = shelved(data).length;
  return [
    '      <button class="chip" type="button" data-shelf="all" aria-pressed="true">All</button>',
    ...data.shelves.map((s) => `      <button class="chip" type="button" data-shelf="${esc(s.id)}" aria-pressed="false">${esc(s.short || s.name)}</button>`),
    `      <span class="count" id="libCount" aria-live="polite">${n} ${n === 1 ? 'document' : 'documents'}</span>`
  ].join('\n');
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{20,64}$/;

const text = (v) => typeof v === 'string' && v.trim().length > 0;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validate(data) {
  const problems = [];
  if (!data || !Array.isArray(data.shelves) || !Array.isArray(data.items)) return ['the file needs a "shelves" list and an "items" list'];
  const shelves = new Set();
  data.shelves.forEach((s, i) => {
    const at = `shelves[${i}]`;
    if (!text(s.id) || !SLUG.test(s.id)) problems.push(`${at}.id must be lower-case words joined by hyphens`);
    else if (shelves.has(s.id)) problems.push(`${at}.id "${s.id}" is used twice`);
    else shelves.add(s.id);
    for (const k of ['name', 'short', 'head', 'note']) if (!text(s[k])) problems.push(`${at}.${k} is missing`);
  });
  const slugs = new Set();
  const drives = new Set();
  data.items.forEach((it, i) => {
    const at = `items[${i}]${text(it.slug) ? ` (${it.slug})` : ''}`;
    if (!text(it.slug) || !SLUG.test(it.slug)) problems.push(`${at}.slug must be lower-case words joined by hyphens`);
    else if (slugs.has(it.slug)) problems.push(`${at}.slug is used twice`);
    else slugs.add(it.slug);
    for (const k of ['title', 'kind', 'blurb']) if (!text(it[k])) problems.push(`${at}.${k} is missing`);
    if (text(it.blurb) && it.blurb.length > 180) problems.push(`${at}.blurb is ${it.blurb.length} characters; keep it under 180 so the card stays a card`);
    if (!shelves.has(it.shelf)) problems.push(`${at}.shelf "${it.shelf}" is not one of the shelves`);
    if (it.listed !== undefined && it.listed !== false) problems.push(`${at}.listed is only ever false, for a document kept off the shelves`);
    if (it.own !== undefined && it.own !== true) problems.push(`${at}.own is only ever true, for a document PFA made`);
    if (it.own === true) {
      if (it.drive !== undefined) problems.push(`${at} is PFA's own and has no Google Drive original`);
      if (!fs.existsSync(path.join(PDF_DIR, `${it.slug}.pdf`))) problems.push(`${at} is PFA's own: media/library/${it.slug}.pdf is not on disk`);
    } else if (!text(it.drive) || !DRIVE_ID.test(it.drive)) problems.push(`${at}.drive must be the Google Drive file id from the supplied link`);
    else if (drives.has(it.drive)) problems.push(`${at}.drive is the same file as another entry`);
    else drives.add(it.drive);
    if (it.language !== undefined && (!text(it.language) || it.language === 'English')) problems.push(`${at}.language is for a document not in English, such as "Hindi"`);
    if (it.coverPage !== undefined && !(Number.isInteger(it.coverPage) && it.coverPage > 1)) problems.push(`${at}.coverPage is the page of the PDF its cover is on, when that is not page 1, such as 2`);
    if (it.pdf !== undefined) {
      if (!text(it.pdf) || !/^resources\/[^/]+\.pdf$/i.test(it.pdf)) problems.push(`${at}.pdf must name a PDF in resources/, such as "resources/AWBI ULB.pdf"`);
      else if (!fs.existsSync(path.join(ROOT, it.pdf))) problems.push(`${at}.pdf "${it.pdf}" is not on disk`);
    }
  });
  return problems;
}

/* The PDF this site serves for a document, as a path from the root: the one
   PFA put in resources/, else one fetched into media/library/, else none. */
function pdfPath(item) {
  if (item.pdf && fs.existsSync(path.join(ROOT, item.pdf))) return item.pdf;
  const fetched = `media/library/${item.slug}.pdf`;
  return fs.existsSync(path.join(ROOT, fetched)) ? fetched : null;
}

/* As a link: the file names carry spaces, brackets and Devanagari. */
function urlFor(rel) {
  return rel.split('/').map(encodeURIComponent).join('/');
}

/* What is known about each document from the files on disk: nothing until its
   PDF is here, then its size, its pages and, when the text could be trusted,
   its words and reading time. */
function metaFor(item) {
  const rel = pdfPath(item);
  const ed = path.join(ED_DIR, `${item.slug}.json`);
  const meta = {};
  if (rel) {
    meta.file = urlFor(rel);
    meta.name = path.basename(rel);
    meta.bytes = fs.statSync(path.join(ROOT, rel)).size;
    /* The reading copy the reader opens (scripts/build-reading-copies.py):
       the same pages with photographs sized for a screen, linearized, so a
       phone gets the first page without the whole file. Download keeps
       the original. */
    /* Listed whether or not it is on disk yet: the copies are built on
       GitHub after a push (.github/workflows/reading-copies.yml), and until
       one exists the reader opens the original instead. Listing it either
       way keeps this catalogue the same before and after that run. */
    meta.read = urlFor(`resources/read/${item.slug}.pdf`);
  }
  if (fs.existsSync(ed)) {
    try {
      const e = JSON.parse(fs.readFileSync(ed, 'utf8'));
      meta.pages = e.pages;
      meta.lang = e.lang;
      meta.index = `media/library/${item.slug}.json`;
      if (e.text) {
        meta.words = e.words;
        meta.minutes = e.minutes;
      }
      if (e.cover && fs.existsSync(path.join(COVER_DIR, `${item.slug}.webp`))) {
        meta.cover = `media/library/covers/${item.slug}.webp`;
        meta.coverW = e.cover.w;
        meta.coverH = e.cover.h;
      }
    } catch (error) {
      throw new Error(`media/library/${item.slug}.json is not valid JSON: ${error.message}`);
    }
  }
  return meta;
}

function readingTime(minutes) {
  if (!minutes) return '';
  if (minutes < 55) return `${Math.max(5, Math.round(minutes / 5) * 5)} min read`;
  const half = Math.round(minutes / 30) / 2;
  const whole = Math.floor(half);
  const label = half === whole ? String(whole) : `${whole || ''}\u00BD`;
  return `About ${label} hour${half > 1 ? 's' : ''}`;
}

function size(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function downloadHref(item, meta) {
  return meta.file || `https://drive.google.com/uc?export=download&id=${item.drive}`;
}

/* The document's own first page; a plain plate with the title where there
   is no PDF to take it from. */
function cover(item, meta) {
  if (meta && meta.cover) {
    return `<span class="cover"><img class="cover__img" src="${esc(meta.cover)}" width="${meta.coverW}" height="${meta.coverH}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="cover"><span class="cover__plate"><span class="cover__title">${esc(item.title)}</span><span class="cover__none">Cover to come</span></span></span>`;
}

function card(item, shelf, meta) {
  const read = `read.html?r=${encodeURIComponent(item.slug)}`;
  const facts = [meta.pages ? `${meta.pages} pages` : '', item.language ? `In ${item.language}` : '', readingTime(meta.minutes), meta.bytes ? `PDF ${size(meta.bytes)}` : ''].filter(Boolean);
  const dl = downloadHref(item, meta);
  const dlAttrs = meta.file ? ` download="${esc(meta.name)}"` : ' rel="noopener" target="_blank"';
  return [
    `<li class="book" data-slug="${esc(item.slug)}" data-shelf="${esc(item.shelf)}">`,
    `<a class="book__cover" href="${read}" tabindex="-1" aria-hidden="true">${cover(item, meta)}</a>`,
    '<div class="book__body">',
    `<h3 class="book__title"><a href="${read}">${esc(item.title)}</a></h3>`,
    `<p class="book__blurb">${esc(item.blurb)}</p>`,
    /* each fact whole, the dots drawn between them (.dots in assets/chrome.css) */
    facts.length ? `<p class="book__facts dots">${facts.map((f) => `<span>${esc(f).replace(/ /g, '\u00A0')}</span>`).join('')}</p>` : '',
    '<p class="book__progress" hidden><span class="book__bar"><span></span></span><span class="book__pct"></span></p>',
    '<p class="book__actions">',
    `<a class="book__read" href="${read}">Read now</a>`,
    `<a class="book__dl" href="${esc(dl)}"${dlAttrs} aria-label="Download ${esc(item.title)}">Download</a>`,
    '</p>',
    '</div>',
    '</li>'
  ].filter(Boolean).join('\n');
}

function jsonLd(data) {
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'The PFA Library',
    itemListElement: shelved(data).map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'DigitalDocument',
        name: item.title,
        description: item.blurb,
        url: `${SITE}/read.html?r=${item.slug}`,
        publisher: { '@type': 'Organization', name: 'People for Animals' }
      }
    }))
  };
  return JSON.stringify(list).replace(/</g, '\\u003c');
}

function shelvesMarkup(data, metas) {
  const out = [];
  data.shelves.forEach((shelf) => {
    const items = shelved(data).filter((it) => it.shelf === shelf.id);
    if (!items.length) return;
    out.push(
      `<section class="band lib-shelf" id="shelf-${esc(shelf.id)}" data-shelf="${esc(shelf.id)}" aria-labelledby="shelf-${esc(shelf.id)}-h">`,
      '<div class="band__head">',
      `<p class="eyebrow">${esc(shelf.name)}<span class="lib-shelf__count">${items.length} ${items.length === 1 ? 'document' : 'documents'}</span></p>`,
      `<h2 class="display" id="shelf-${esc(shelf.id)}-h">${esc(shelf.head)}</h2>`,
      `<p>${esc(shelf.note)}</p>`,
      '</div>',
      `<ul class="lib-grid${shelf.id === 'essential' ? ' lib-grid--feature' : ''}">`,
      items.map((item) => card(item, shelf, metas[item.slug])).join('\n'),
      '</ul>',
      '</section>'
    );
  });
  out.push(`<script type="application/ld+json">${jsonLd(data)}</script>`);
  return out.join('\n');
}

/* The hero's display: the essential shelf, standing in a fan. Decorative
   (the same documents are on the shelf below), so hidden from assistive
   technology and from the tab order. */
function stackMarkup(data, metas) {
  const shelf = data.shelves[0];
  const items = shelved(data).filter((it) => it.shelf === shelf.id && metas[it.slug] && metas[it.slug].cover).slice(0, 5);
  if (items.length < 3) return '';
  return [
    '<div class="lib-stack" aria-hidden="true">',
    items.map((item) => `<a class="lib-stack__book" href="read.html?r=${encodeURIComponent(item.slug)}" tabindex="-1">${cover(item, metas[item.slug])}</a>`).join('\n'),
    '</div>'
  ].join('\n');
}

function between(page, start, end, inner, label) {
  const a = page.indexOf(start);
  const b = page.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`library.html has lost its ${label} markers (${start.slice(0, 22)}... / ${end})`);
  return page.slice(0, a + start.length) + '\n' + inner + '\n' + page.slice(b);
}

function render(page, data, metas) {
  return between(between(between(page, START, END, shelvesMarkup(data, metas), 'library'), STACK_START, STACK_END, stackMarkup(data, metas), 'library-stack'),
    CHIPS_START, CHIPS_END, chipsMarkup(data), 'library-chips');
}

function clientData(data, metas) {
  const shelves = data.shelves.map((s) => ({ id: s.id, name: s.name, short: s.short }));
  const items = data.items.map((it) => {
    const m = metas[it.slug] || {};
    const row = { slug: it.slug, title: it.title, shelf: it.shelf, kind: it.kind, blurb: it.blurb };
    if (it.drive) row.drive = it.drive;
    if (it.listed === false) row.listed = false;
    if (it.language) row.language = it.language;
    for (const k of ['file', 'read', 'name', 'bytes', 'pages', 'lang', 'index', 'words', 'minutes', 'cover', 'coverW', 'coverH']) if (m[k] !== undefined) row[k] = m[k];
    return row;
  });
  return [
    '/* The PFA Library catalogue, for library.html and read.html.',
    '   Written by scripts/build-library.js from data/library.json and the files',
    '   in resources/ and media/library/. Do not edit: edit the data and run the',
    '   script. */',
    `window.PFA_LIBRARY = ${JSON.stringify({ shelves, items }, null, 1)};`,
    ''
  ].join('\n');
}

/* ---- fetching from Google Drive ---------------------------------------- */

async function fetchPdf(item) {
  const urls = [
    `https://drive.usercontent.google.com/download?id=${item.drive}&export=download&confirm=t`,
    `https://drive.google.com/uc?export=download&id=${item.drive}`
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      let res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'PFA-site-build' } });
      let buf = Buffer.from(await res.arrayBuffer());
      /* Drive answers a large file with a "cannot scan for viruses" page whose
         form carries the real download address. */
      if (buf.subarray(0, 5).toString() !== '%PDF-' && /<form[^>]+id="download-form"/.test(buf.toString('utf8'))) {
        const html = buf.toString('utf8');
        const action = (html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"/) || [])[1];
        const params = new URLSearchParams();
        for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) params.set(m[1], m[2]);
        if (action) {
          res = await fetch(`${action.replace(/&amp;/g, '&')}?${params}`, { redirect: 'follow', headers: { 'User-Agent': 'PFA-site-build' } });
          buf = Buffer.from(await res.arrayBuffer());
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Drive did not return a PDF (is the file shared with "Anyone with the link"?)');
      if (buf.length > MAX_BYTES) throw new Error(`the PDF is ${size(buf.length)}, over the ${size(MAX_BYTES)} a repository file may be`);
      return buf;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('could not download');
}

function sourceOf(buf) {
  return { bytes: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex') };
}

/* The index already made from these exact bytes by this extractor, with its
   cover on disk, if any. */
function currentEdition(item, src) {
  const X = require('./library-extract.js');
  try {
    const e = JSON.parse(fs.readFileSync(path.join(ED_DIR, `${item.slug}.json`), 'utf8'));
    const coverHere = !e.cover || (fs.existsSync(path.join(COVER_DIR, `${item.slug}.webp`)) && (e.cover.page || 1) === (item.coverPage || 1));
    if (e.x === X.VERSION && e.src && e.src.sha1 === src.sha1 && e.src.bytes === src.bytes && coverHere) return e;
  } catch (error) { /* none yet, or unreadable: make it */ }
  return null;
}

async function buildEdition(item, { force } = {}) {
  const X = require('./library-extract.js');
  const buf = fs.readFileSync(path.join(ROOT, pdfPath(item)));
  const src = sourceOf(buf);
  const kept = !force && currentEdition(item, src);
  if (kept) return { edition: kept, kept: true };
  const edition = await X.extract(buf);
  edition.slug = item.slug;
  edition.x = X.VERSION;
  edition.src = src;
  fs.mkdirSync(COVER_DIR, { recursive: true });
  try {
    const c = await X.renderCover(buf, 520, item.coverPage || 1);
    fs.writeFileSync(path.join(COVER_DIR, `${item.slug}.webp`), c.image);
    edition.cover = item.coverPage ? { w: c.w, h: c.h, page: item.coverPage } : { w: c.w, h: c.h };
  } catch (error) {
    console.log(`  ${item.slug}: no cover (${error.message}); the shelf shows its title instead`);
  }
  fs.writeFileSync(path.join(ED_DIR, `${item.slug}.json`), JSON.stringify(orderKeys(edition)) + '\n');
  return { edition, kept: false };
}

/* The index keeps what the reader and the shelf use: no text. */
function orderKeys(e) {
  const { v, x, slug, src, pages, lang, text: t, words, minutes, quality, toc, cover: c } = e;
  return { v, x, slug, src, pages, lang, text: t, words, minutes, quality, toc: (toc || []).map((k) => ({ t: k.t, l: k.l, p: k.p })), cover: c };
}

async function fetchAndExtract(data, { fetchMissing, force, only }) {
  const picked = data.items.filter((it) => !only.length || only.includes(it.slug));
  const unknown = only.filter((s) => !data.items.some((it) => it.slug === s));
  if (unknown.length) throw new Error(`not in data/library.json: ${unknown.join(', ')}`);
  fs.mkdirSync(PDF_DIR, { recursive: true });
  let failed = 0;
  for (const item of picked) {
    const fetched = path.join(PDF_DIR, `${item.slug}.pdf`);
    try {
      /* only what PFA has not put in resources/ is fetched */
      if (fetchMissing && !item.pdf && !item.own && (force || !fs.existsSync(fetched))) {
        process.stdout.write(`  ${item.slug}: downloading from Google Drive... `);
        const buf = await fetchPdf(item);
        fs.writeFileSync(fetched, buf);
        process.stdout.write(`${size(buf.length)}\n`);
      }
      if (!pdfPath(item)) { console.log(`  ${item.slug}: no PDF here yet (put it in resources/ and name it in data/library.json, or run with --fetch)`); continue; }
      const { edition: e, kept } = await buildEdition(item, { force });
      const verdict = `${e.toc.length} contents entries${e.text ? `, about ${e.minutes} min of reading` : `, no reading time (${e.quality.reason})`}${e.cover ? ', cover' : ''}`;
      console.log(`  ${item.slug}: ${e.pages} pages, ${verdict}${kept ? ' (unchanged)' : ''}`);
    } catch (error) {
      failed++;
      console.log(`\n  ${item.slug}: FAILED - ${error.message}`);
    }
  }
  return failed;
}

/* ---- main --------------------------------------------------------------- */

function load() {
  let data;
  try { data = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (error) {
    console.error(`data/library.json could not be read as JSON: ${error.message}`);
    process.exit(1);
  }
  const problems = validate(data);
  if (problems.length) {
    console.error(`data/library.json has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  return data;
}

function outputs(data) {
  const metas = {};
  for (const it of data.items) metas[it.slug] = metaFor(it);
  const page = fs.readFileSync(PAGE, 'utf8');
  return { page, html: render(page, data, metas), client: clientData(data, metas), metas };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const fetchMissing = args.includes('--fetch');
  const extractOnly = args.includes('--extract');
  const force = args.includes('--force');
  const only = args.filter((a) => !a.startsWith('--'));
  const data = load();

  if (fetchMissing || extractOnly) {
    console.log(fetchMissing ? 'Fetching what is missing from Google Drive, then reading every PDF for its cover and contents:' : 'Reading every PDF here for its cover and contents:');
    const failed = await fetchAndExtract(data, { fetchMissing, force, only });
    if (failed) process.exitCode = 1;
  }

  const { page, html, client, metas } = outputs(data);
  const current = fs.existsSync(CLIENT) ? fs.readFileSync(CLIENT, 'utf8') : '';
  if (check) {
    const stale = [];
    if (html !== page) stale.push('library.html');
    if (client !== current) stale.push('assets/library-data.js');
    if (stale.length) { console.error(`${stale.join(' and ')} out of date with data/library.json. Run: node scripts/build-library.js`); process.exit(1); }
    console.log(`library.html carries all ${shelved(data).length} shelved documents; the catalogue all ${data.items.length}.`);
    return;
  }
  if (html !== page) fs.writeFileSync(PAGE, html);
  if (client !== current) fs.writeFileSync(CLIENT, client);
  const fetched = Object.values(metas).filter((m) => m.file).length;
  const covers = Object.values(metas).filter((m) => m.cover).length;
  console.log(`library.html: ${data.items.length} documents on ${data.shelves.length} shelves. PDFs served from this site: ${fetched}; with their own cover: ${covers}.`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}

module.exports = { validate, render, clientData, metaFor, pdfPath, urlFor, readingTime, size, START, END, fetchPdf };
