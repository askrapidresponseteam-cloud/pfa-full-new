#!/usr/bin/env node
'use strict';

/* Bring the microsites' photographs and documents from PFA's old site.
   ------------------------------------------------------------------------
   data/site-photos.json names each file, where it comes from on the old
   site, and what it shows. The old site was peopleforanimalsindia.org until
   that address became this site (Oct 2026); it lives on, unchanged, at
   pf-acurrent.vercel.app (owner, 22 Oct 2026), built from
   github.com/askrapidresponseteam-cloud/PFAcurrent. PFA_OLD_SITE points the
   fetch at another copy of it (a local one, say) without editing the list. The release zip does not
   carry them (the sandbox that builds it cannot reach that site), so
   DEPLOY.command first copies media/site/ from the live tree when it has it,
   then runs this for whatever is still missing. Once a deploy has fetched a
   file it is in the repository, so it survives the old site going away.

     node scripts/fetch-site-photos.js           fetch what is missing
     node scripts/fetch-site-photos.js --force   fetch everything again

   Best effort: a file that cannot be fetched is reported and skipped. The
   pages show a plain plate with the caption in its place, never a broken
   image, and the audit accepts a missing file only if it is listed in the
   manifest. */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'data', 'site-photos.json');
const FORCE = process.argv.includes('--force');

function get(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = (/^http:/.test(url) ? http : https).get(url, { headers: { 'User-Agent': 'PFA-site-build' }, timeout: 25000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const type = String(res.headers['content-type'] || '');
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), type }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out after 25s')));
    req.on('error', reject);
  });
}

/* Where a listed file is fetched from: as listed, or the same path on
   PFA_OLD_SITE when that is set. */
function sourceOf(from) {
  const other = String(process.env.PFA_OLD_SITE || '').replace(/\/+$/, '');
  if (!other) return from;
  const u = new URL(from);
  return other + u.pathname + u.search;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* What the bytes are, read from the bytes: a site that answers a missing
   file with an HTML page and a 200 must not leave that page saved as a .jpg. */
function looksRight(file, bytes) {
  if (!bytes || bytes.length < 1024) return false;
  if (/\.pdf$/i.test(file)) return bytes.slice(0, 4).toString('latin1') === '%PDF';
  const head = bytes.slice(0, 12);
  const jpeg = head[0] === 0xff && head[1] === 0xd8;
  const png = head.slice(0, 4).toString('latin1') === '\x89PNG';
  const webp = head.slice(0, 4).toString('latin1') === 'RIFF' && head.slice(8, 12).toString('latin1') === 'WEBP';
  return jpeg || png || webp;
}

async function fetchOne(entry) {
  const target = path.join(ROOT, entry.file);
  if (!FORCE && fs.existsSync(target) && fs.statSync(target).size > 1024) return 'here';
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { bytes } = await get(sourceOf(entry.from));
      if (!looksRight(entry.file, bytes)) throw new Error('the answer was not the file');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      return 'fetched';
    } catch (error) {
      last = error;
      if (attempt < 3) await sleep(800 * attempt);
    }
  }
  throw last;
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const all = [...(manifest.photos || []), ...(manifest.documents || [])];
  const tally = { here: 0, fetched: 0, failed: 0 };
  for (const entry of all) {
    try {
      tally[await fetchOne(entry)] += 1;
    } catch (error) {
      tally.failed += 1;
      console.log(`  could not fetch ${entry.file} from ${entry.from}: ${error.message}`);
    }
  }
  console.log(`  site photographs: ${tally.here} already here, ${tally.fetched} fetched, ${tally.failed} not available`);
}

if (require.main === module) main();

module.exports = { looksRight, sourceOf, MANIFEST };
