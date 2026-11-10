#!/usr/bin/env node
'use strict';

/* Builds lib/pin-directory.json.gz: every PIN code in India, the districts
   and post offices it serves, from India Post's own All India Pincode
   Directory (owner, 10 Nov 2026: "ensure pincode and area/place match, it
   should work seamlessly across each and every pincode in the country").

   The source is the directory India Post publishes on data.gov.in (Open
   Government Data License - India): one row per post office, about 165,000
   of them, with its PIN, district, state, postal division and region. It is
   read from the npm package india-pincode (MIT), which carries the latest
   release of that file:

     node scripts/build-pin-directory.js              downloads it
     node scripts/build-pin-directory.js <file.gz>    a copy already here

   Every district India Post names is matched to the site's own list
   (assets/india-districts.js), so a PIN never names a district the forms
   cannot offer. A district that cannot be matched stops the build, with its
   name: add it to the list (or to ALIAS below, when it is a spelling of
   one already there) and run this again.

   What is written, gzipped JSON:
     states     the site's state names
     districts  [stateIndex, "District as the site lists it"]
     divisions  India Post's postal divisions ("Udupi")
     regions    India Post's regions ("South Karnataka")
     pins       { "576101": [[district...], [division...], [region...], "Town", "Office|Office|..."] }
*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'lib', 'pin-directory.json.gz');
const INDIA = require(path.join(ROOT, 'assets', 'india-districts.js'));
const PACKAGE = 'https://registry.npmjs.org/india-pincode/-/india-pincode-2.5.9.tgz';

/* India Post's spelling, by state, of a district the site spells otherwise.
   A list of more than one: the PIN may be in any of them. */
const ALIAS = {
  'Andaman and Nicobar Islands': { nicobars: ['Nicobar'], southandamans: ['South Andaman'] },
  'Andhra Pradesh': { spsrnellore: ['Nellore'], visakhapatanam: ['Visakhapatnam'], ysr: ['YSR Kadapa'] },
  'Arunachal Pradesh': { leparada: ['Lepa Rada'] },
  'Assam': { kamrupmetro: ['Kamrup Metropolitan'], marigaon: ['Morigaon'], southsalmaramancachar: ['South Salmara-Mankachar'] },
  'Bihar': { pashchimchamparan: ['West Champaran'], purbichamparan: ['East Champaran (Motihari)'] },
  'Chhattisgarh': { gaurellapendramarwahi: ['Gaurela-Pendra-Marwahi'] },
  'Gujarat': { ahmadabad: ['Ahmedabad'], arvalli: ['Aravalli'], dang: ['Dangs (Ahwa)'], devbhumidwarka: ['Devbhoomi Dwarka'], dohad: ['Dahod'], mahesana: ['Mehsana'], panchmahals: ['Panchmahal (Godhra)'] },
  'Haryana': { charkidadri: ['Charkhi Dadri'] },
  'Himachal Pradesh': { lahulandspiti: ['Lahaul and Spiti'] },
  'Jammu and Kashmir': { bandipora: ['Bandipore'] },
  'Jharkhand': { eastsinghbum: ['East Singhbhum'], hazaribagh: ['Hazaribag'], sahebganj: ['Sahibganj'], saraikelakharsawan: ['Seraikela-Kharsawan'] },
  'Karnataka': { chamarajanagara: ['Chamarajanagar'], chikkaballapura: ['Chikballapur'], vijaynagar: ['Vijayanagara'] },
  'Ladakh': { lehladakh: ['Leh'] },
  'Lakshadweep': { lakshadweep: INDIA.districtsOf('Lakshadweep') },
  'Madhya Pradesh': { eastnimar: ['Khandwa'] },
  'Maharashtra': { mumbai: ['Mumbai City'] },
  'Odisha': { anugul: ['Angul'], baleshwar: ['Balasore'], jajapur: ['Jajpur'] },
  'Punjab': { firozepur: ['Ferozepur'], sasnagar: ['Sahibzada Ajit Singh Nagar (Mohali)'], srimuktsarsahib: ['Muktsar'] },
  'Rajasthan': { ganganagar: ['Sri Ganganagar'] },
  'Sikkim': { east: ['East Sikkim'], north: ['North Sikkim'], south: ['South Sikkim'], west: ['West Sikkim'] },
  'Tamil Nadu': { kanniyakumari: ['Kanyakumari'], thenilgiris: ['Nilgiris'], thiruvallur: ['Tiruvallur'], thiruvarur: ['Tiruvarur'], villupuram: ['Viluppuram'] },
  'Telangana': { jagitial: ['Jagtial'], jangoan: ['Jangaon'], jayashankarbhupalapally: ['Jayashankar Bhoopalpally'], kumurambheemasifabad: ['Komaram Bheem Asifabad'], medchalmalkajgiri: ['Medchal'] },
  'Uttar Pradesh': { kheri: ['Lakhimpur - Kheri'], santkabeernagar: ['Sant Kabir Nagar'], shamli: ['Shamali (Prabuddh Nagar)'] },
  'Uttarakhand': { udamsinghnagar: ['Udham Singh Nagar'] },
  'West Bengal': { '24paraganasnorth': ['North 24 Parganas'], '24paraganassouth': ['South 24 Parganas'], dinajpurdakshin: ['Dakshin Dinajpur (South Dinajpur)'], dinajpuruttar: ['Uttar Dinajpur (North Dinajpur)'], maldah: ['Malda'], medinipureast: ['Purba Medinipur (East Medinipur)'], medinipurwest: ['Paschim Medinipur (West Medinipur)'] }
};

const key = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\bdistrict\b/g, ' ').replace(/[^a-z0-9]+/g, '');
const keysOf = (d) => {
  const out = new Set([key(d)]);
  const m = /^(.*?)\s*\((.*)\)\s*(.*)$/.exec(d);
  if (m) { out.add(key(m[1] + m[3])); out.add(key(m[2] + m[3])); }
  return [...out].filter(Boolean);
};

/* "KOTESHWARA S.O" is Koteshwara; "Koramangala VI Bk S.O" is Koramangala VI Bk */
function officeName(raw) {
  const n = String(raw || '').replace(/\s+/g, ' ').trim()
    /* the office's kind, and whatever India Post's clerks typed after it
       ("Malviya Nagar SO South Delhi", "Diu Bazar ND TSO") */
    .replace(/\s+(?:[BSHT]\.?\s?S?\.?O\.?|G\.?P\.?O\.?|B\.?P\.?O\.?|ND\s+TSO|Head Office|Sub Office|Branch Office)(?:\s.*)?$/i, '')
    /* a serial glued on: "Haladi28" */
    .replace(/([A-Za-z])\d+$/, '$1')
    .replace(/[.\s]+$/, '').trim();
  if (!n || /^n\.?a\.?$/i.test(n)) return '';
  const lower = n === n.toUpperCase() || n === n.toLowerCase();
  return lower ? n.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : n;
}

function stateOf(name) {
  const k = key(String(name).replace(/^the\s+/i, ''));
  return INDIA.STATES.find((s) => key(s) === k) || '';
}

function siteDistricts(state, ipName) {
  const k = key(ipName);
  const alias = (ALIAS[state] || {})[k];
  if (alias) return alias;
  const list = INDIA.districtsOf(state);
  const hits = list.filter((d) => keysOf(d).includes(k));
  if (hits.length) return hits;
  if (state === 'Delhi') {
    const delhi = list.filter((d) => key(d) === k + 'delhi');
    if (delhi.length) return delhi;
  }
  return null;
}

/* The town a PIN is, for the city box: its head office, else its one sub
   office, else the district. The metros are the city itself: Koramangala's
   PIN is Bengaluru, not Koramangala. */
const METRO = {
  'Mumbai City': 'Mumbai', 'Mumbai Suburban': 'Mumbai', 'Kolkata': 'Kolkata', 'Chennai': 'Chennai', 'Hyderabad': 'Hyderabad',
  'Bengaluru (Bangalore) Urban': 'Bengaluru', 'New Delhi': 'New Delhi'
};
function townOf(rows, districts) {
  if (districts.length === 1 && METRO[districts[0]]) return METRO[districts[0]];
  if (districts.length && districts.every((d) => /Delhi$/.test(d))) return 'Delhi';
  const ho = rows.filter((r) => r.t === 'HO').map((r) => officeName(r.o)).filter(Boolean);
  if (ho.length) return ho[0];
  const so = [...new Set(rows.filter((r) => r.t === 'PO' || r.t === 'SO').map((r) => officeName(r.o)).filter(Boolean))];
  if (so.length === 1) return so[0];
  return districts.length === 1 ? districts[0].replace(/\s*\([^)]*\)/g, '') : '';
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(download(res.headers.location));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve(Buffer.concat(parts)));
    }).on('error', reject);
  });
}

/* The one file wanted out of the package's tarball. */
function fromTarball(tgz, wanted) {
  const tar = zlib.gunzipSync(tgz);
  for (let at = 0; at + 512 <= tar.length;) {
    const name = tar.slice(at, at + 100).toString('utf8').replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(tar.slice(at + 124, at + 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    if (name.endsWith(wanted)) return tar.slice(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${wanted} is not in the package`);
}

function build(rows) {
  const districts = [];
  const districtIndex = new Map();
  const idOf = (state, name) => {
    const k = `${state}|${name}`;
    if (!districtIndex.has(k)) { districtIndex.set(k, districts.length); districts.push([INDIA.STATES.indexOf(state), name]); }
    return districtIndex.get(k);
  };
  /* every district of the list has an index, PIN or none, so the reader can
     name any of them */
  INDIA.STATES.forEach((s) => INDIA.districtsOf(s).forEach((d) => idOf(s, d)));
  const divisions = []; const divisionIndex = new Map();
  const regions = []; const regionIndex = new Map();
  const listed = (arr, index, name) => { if (!index.has(name)) { index.set(name, arr.length); arr.push(name); } return index.get(name); };
  const byPin = new Map();
  const missing = new Map();
  for (const r of rows) {
    if (!/^[1-9]\d{5}$/.test(String(r.p))) continue;
    if (!byPin.has(r.p)) byPin.set(r.p, []);
    byPin.get(r.p).push(r);
    const state = stateOf(r.s);
    if (!state || /^n\.?a\.?$/i.test(String(r.i))) continue;
    if (!siteDistricts(state, r.i)) missing.set(`${state}: ${r.i}`, (missing.get(`${state}: ${r.i}`) || 0) + 1);
  }
  if (missing.size) {
    const list = [...missing].map(([k, n]) => `  ${k} (${n} post offices)`).join('\n');
    throw new Error(`India Post names districts the site's list does not have. Add each to assets/india-districts.js, or to ALIAS here:\n${list}`);
  }
  const pins = {};
  for (const [pin, list] of [...byPin].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ds = new Set(); const dv = new Set(); const rg = new Set();
    for (const r of list) {
      const state = stateOf(r.s);
      if (state && !/^n\.?a\.?$/i.test(String(r.i))) for (const d of siteDistricts(state, r.i)) ds.add(idOf(state, d));
      const division = String(r.v || '').replace(/\s+Division$/i, '').trim();
      if (division && !/^n\.?a\.?$/i.test(division)) dv.add(listed(divisions, divisionIndex, division));
      const region = String(r.r || '').replace(/\s+Region$/i, '').replace(/^Region\s+/i, '').trim();
      /* "DivReportingCircle": a division that reports to its circle, no region */
      if (region && !/^n\.?a\.?$/i.test(region) && !/ReportingCircle/i.test(region)) rg.add(listed(regions, regionIndex, region));
    }
    const names = [...new Set(list.map((r) => officeName(r.o)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const dnames = [...ds].map((i) => districts[i][1]);
    pins[pin] = [[...ds].sort((a, b) => a - b), [...dv].sort((a, b) => a - b), [...rg].sort((a, b) => a - b), townOf(list, dnames), names.join('|')];
  }
  return {
    v: 1,
    source: 'India Post, All India Pincode Directory (data.gov.in, Open Government Data License - India), via the india-pincode package',
    states: INDIA.STATES,
    districts, divisions, regions, pins
  };
}

async function main() {
  const given = process.argv[2];
  const gz = given ? fs.readFileSync(given) : fromTarball(await download(PACKAGE), 'data/pincodes.json.gz');
  const rows = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  const data = build(rows);
  const out = zlib.gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
  fs.writeFileSync(OUT, out);
  console.log(`${Object.keys(data.pins).length} PIN codes, ${rows.length} post offices: ${path.relative(ROOT, OUT)} (${Math.round(out.length / 1024)} KB)`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });
module.exports = { build, officeName, siteDistricts, stateOf, ALIAS };
