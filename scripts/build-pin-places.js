#!/usr/bin/env node
'use strict';

/* Builds lib/pin-places.json.gz: where each PIN code is on the map, and the
   middle of each district, for the People directory's Map (owner, 18 Nov
   2026: "can you give map view").

   From the same India Post All India Pincode Directory as
   lib/pin-directory.json.gz (scripts/build-pin-directory.js), which gives a
   latitude and longitude for most post offices. A PIN's place is the middle
   (the median) of its offices that have one inside India; a district's is
   the middle of its PINs. Nothing is looked up anywhere when the panel runs.

     node scripts/build-pin-places.js              downloads it
     node scripts/build-pin-places.js <file.gz>    a copy already here

   What is written, gzipped JSON:
     pins       { "576101": [lat, lng] }               to 3 decimals, about 100 m
     districts  { "Karnataka|Udupi": [lat, lng] }      the site's own names,
                                                         and without a bracket */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PD = require('./build-pin-directory');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'lib', 'pin-places.json.gz');
const PACKAGE = 'https://registry.npmjs.org/india-pincode/-/india-pincode-2.5.9.tgz';

/* India, with its islands; a point outside is a clerk's slip */
const inIndia = (a, n) => a > 6 && a < 37.6 && n > 68 && n < 97.6;
const median = (list) => { const s = list.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (v) => Math.round(v * 1000) / 1000;

function build(rows) {
  const byPin = new Map();
  const pinDistricts = new Map();
  for (const r of rows) {
    const pin = String(r.p || '');
    if (!/^[1-9]\d{5}$/.test(pin)) continue;
    const state = PD.stateOf(r.s);
    const ds = state ? PD.siteDistricts(state, r.i) : null;
    if (ds && ds.length === 1) {
      const k = `${state}|${ds[0]}`;
      if (!pinDistricts.has(pin)) pinDistricts.set(pin, new Set());
      pinDistricts.get(pin).add(k);
    }
    const a = Number(r.a); const n = Number(r.n);
    if (!inIndia(a, n)) continue;
    if (!byPin.has(pin)) byPin.set(pin, []);
    byPin.get(pin).push([a, n]);
  }
  const pins = {};
  for (const [pin, pts] of byPin) pins[pin] = [round(median(pts.map((p) => p[0]))), round(median(pts.map((p) => p[1])))];
  const inDistrict = new Map();
  for (const [pin, keys] of pinDistricts) {
    if (!pins[pin]) continue;
    for (const k of keys) { if (!inDistrict.has(k)) inDistrict.set(k, []); inDistrict.get(k).push(pins[pin]); }
  }
  const districts = {};
  for (const [k, pts] of inDistrict) districts[k] = [round(median(pts.map((p) => p[0]))), round(median(pts.map((p) => p[1])))];
  /* the directory names "Mysuru (Mysore)" as Mysuru: both are kept */
  for (const k of Object.keys(districts)) {
    const plain = k.replace(/\s*\([^)]*\)/g, '').trim();
    if (plain !== k && !districts[plain]) districts[plain] = districts[k];
  }
  return { v: 1, source: 'India Post, All India Pincode Directory (data.gov.in, Open Government Data License - India), via the india-pincode package', pins, districts };
}

async function main() {
  const given = process.argv[2];
  const https = require('https');
  const download = (url) => new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(download(res.headers.location));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => resolve(Buffer.concat(parts)));
    }).on('error', reject);
  });
  let gz;
  if (given) gz = fs.readFileSync(given);
  else {
    const tgz = await download(PACKAGE);
    const tar = zlib.gunzipSync(tgz);
    for (let at = 0; at + 512 <= tar.length;) {
      const name = tar.slice(at, at + 100).toString('utf8').replace(/\0.*$/s, '');
      if (!name) break;
      const size = parseInt(tar.slice(at + 124, at + 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
      if (name.endsWith('data/pincodes.json.gz')) { gz = tar.slice(at + 512, at + 512 + size); break; }
      at += 512 + Math.ceil(size / 512) * 512;
    }
  }
  const rows = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  const data = build(rows);
  const out = zlib.gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
  fs.writeFileSync(OUT, out);
  console.log(`${Object.keys(data.pins).length} PIN codes and ${Object.keys(data.districts).length} districts placed: ${path.relative(ROOT, OUT)} (${Math.round(out.length / 1024)} KB)`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });
module.exports = { build };
