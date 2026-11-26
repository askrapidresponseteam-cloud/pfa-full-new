#!/usr/bin/env node
'use strict';

/* Bring every unit's own photograph from the official directory.
   ------------------------------------------------------------------------
   PFA's old site keeps one page per unit at
   units/details/<id>.html, and each page carries that unit's photograph
   under /uploads/unit/ with an arbitrary timestamp filename (everything
   else on the page is site chrome under /front/img/). The filename cannot
   be guessed from the id, so the only correct way to get Wardha's picture
   is to read Wardha's page - which is exactly what this does, for every
   unit in units.html's UNITS array, keyed by the d: field, which is the
   official site's own unit id (d:31 is units/details/31.html, Guwahati).

   By construction the picture can only come from that unit's page: no
   search, no stock, no neighbour's photograph. A unit whose page has no
   /uploads/unit/ image gets no file - units.html's typographic plate is
   the designed fallback and never shows a broken frame - and is listed in
   the manifest with status "no-photo" for review. If the official site
   serves the same file for two units, both are kept (the source is
   authoritative) and the sharing is recorded and printed.

     node scripts/fetch-unit-photos.js            # skip files already here
     node scripts/fetch-unit-photos.js --force    # re-download everything

   media/units/manifest.json records slug, city, official id, source URL
   and status for every unit, so the mapping can be reviewed line by line.
   ------------------------------------------------------------------------ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/* The old site, where every unit has its page. It was
   peopleforanimalsindia.org until that address became this site (Oct 2026);
   it lives on, unchanged, at pf-acurrent.vercel.app (owner, 22 Oct 2026),
   built from github.com/askrapidresponseteam-cloud/PFAcurrent.
   PFA_OLD_SITE points it elsewhere, a local copy of that repository say. */
const HOST = String(process.env.PFA_OLD_SITE || 'https://pf-acurrent.vercel.app').replace(/\/+$/, '');
const OUT = path.join(__dirname, '..', 'media', 'units');
const PAGE = path.join(__dirname, '..', 'units.html');
const FORCE = process.argv.includes('--force');

function get(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = (/^http:/.test(url) ? http : https).get(url, { headers: { 'User-Agent': 'PFA-site-build' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out after 20s')));
    req.on('error', reject);
  });
}

/* A dropped socket is weather, not a verdict. */
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
async function getWithRetry(url, tries = 3) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await get(url);
    } catch (error) {
      last = error;
      if (attempt < tries) await sleep(800 * attempt);
    }
  }
  throw last;
}

/* The same slug units.html computes, so the file lands where the page
   already looks: lower-case, runs of anything non-alphanumeric become one
   hyphen. "Gurgaon / Sadhana" -> gurgaon-sadhana. */
function slug(c) { return String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

/* The units, read from the page itself rather than kept as a second list
   that could drift: every {c:'City', ... d:NN} entry in UNITS. */
function readUnits() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const body = html.slice(html.indexOf('var UNITS = ['));
  const out = [];
  const entry = /\{c:'((?:[^'\\]|\\.)*)'[^}]*?d:(\d+)/g;
  let m;
  while ((m = entry.exec(body)) !== null) {
    out.push({ city: m[1].replace(/\\'/g, "'"), id: Number(m[2]) });
    if (body[entry.lastIndex] === ']' ) break;
  }
  return out;
}

async function main() {
  const units = readUnits();
  if (!units.length) { console.error('no UNITS found in units.html'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`\n${units.length} units in units.html; each photograph not already here is read from its unit's page on ${HOST}\n`);

  const manifest = [];
  const bySource = {};
  let ok = 0, had = 0, none = 0, failed = 0;
  /* What the last run learned, kept: a unit's photograph already here is not
     asked for again, and the old site going away (26 Nov 2026: its Vercel
     address answers 402, "there is no vercel anymore") never undoes what was
     fetched while it was up. */
  let before = {};
  try { for (const r of JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'))) before[r.slug] = r; } catch (_) { before = {}; }
  const here = (s) => ['jpg', 'jpeg', 'png', 'webp', 'gif'].map((e) => `${s}.${e}`).find((f) => { const p = path.join(OUT, f); return fs.existsSync(p) && fs.statSync(p).size > 0; });
  let gone = '';

  for (const u of units) {
    const s = slug(u.city);
    const pageUrl = `${HOST}/units/details/${u.id}.html`;
    let record = { slug: s, city: u.city, id: u.id, page: pageUrl, source: null, file: null, status: null };
    const was = before[s];
    const kept = !FORCE && here(s);
    if (kept) {
      manifest.push(Object.assign({}, record, was && was.page ? { page: was.page, source: was.source || null } : {}, { file: `media/units/${kept}`, status: 'already-here' }));
      had += 1;
      continue;
    }
    if (!FORCE && was && was.status === 'no-photo') { manifest.push(Object.assign({}, was)); none += 1; continue; }
    if (gone) { manifest.push(Object.assign({}, was || record, { status: was && was.status ? was.status : 'not-fetched' })); continue; }
    try {
      const html = (await getWithRetry(pageUrl)).toString('utf8');
      /* Only the unit's own photograph lives under /uploads/unit/; the
         first one is the page's lead image. Chrome lives under /front/. */
      const imgs = [...new Set((html.match(/\/uploads\/unit\/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|gif)/gi) || []))];
      if (!imgs.length) {
        record.status = 'no-photo';
        none += 1;
        console.log(`  none ${s} (id ${u.id}) - page has no /uploads/unit/ photograph; typographic plate stays; review`);
      } else {
        const src = new URL(imgs[0], HOST).href;
        const ext = (src.match(/\.(jpe?g|png|webp|gif)$/i) || [, 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
        const file = path.join(OUT, `${s}.${ext}`);
        record.source = src;
        record.file = `media/units/${s}.${ext}`;
        if (!FORCE && fs.existsSync(file) && fs.statSync(file).size > 0) {
          record.status = 'already-here';
          had += 1;
          console.log(`  here ${s}.${ext}`);
        } else {
          const bytes = await getWithRetry(src);
          fs.writeFileSync(file, bytes);
          record.status = 'ok';
          ok += 1;
          console.log(`  ok   ${s}.${ext} (${Math.round(bytes.length / 1024)} KB) from unit page ${u.id}`);
        }
        (bySource[src] = bySource[src] || []).push(s);
      }
    } catch (error) {
      /* the old site gone, not this unit: said once, and the rest not asked */
      if (/HTTP (402|403|404|410)|ENOTFOUND|EAI_AGAIN/.test(String(error.message))) {
        gone = String(error.message);
        console.log(`  The old site (${HOST}) no longer answers (${gone}). Every photograph already here is kept;`);
        console.log('  a unit without one keeps its typographic plate. Set PFA_OLD_SITE to a copy of the old site to fetch more.');
        manifest.push(Object.assign({}, was || record, { status: was && was.status ? was.status : 'not-fetched' }));
        continue;
      }
      record.status = `failed: ${error.message}`;
      failed += 1;
      console.log(`  FAIL ${s} (id ${u.id}) - ${error.message}`);
    }
    manifest.push(record);
  }

  /* The source is authoritative: if it serves one file for two units, both
     keep it - but the sharing is a fact worth seeing, so it is printed and
     recorded rather than silently accepted. */
  const shared = Object.entries(bySource).filter(([, slugs]) => slugs.length > 1);
  for (const [src, slugs] of shared) {
    console.log(`\n  shared by the official site itself: ${slugs.join(', ')}\n    ${src}`);
    manifest.forEach((r) => { if (r.source === src) r.sharedWith = slugs.filter((x) => x !== r.slug); });
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\n  ${ok} fetched, ${had} already here, ${none} without a photograph on their page, ${failed} failed.`);
  console.log('  media/units/manifest.json maps every unit to its official page and photograph for review.\n');
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
