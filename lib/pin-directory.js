'use strict';

/* Every PIN code in India, and whether a place matches it (owner, 10 Nov
   2026: "ensure pincode and area/place match, it should work seamlessly
   across each and every pincode in the country").

   Read from lib/pin-directory.json.gz, which scripts/build-pin-directory.js
   makes from India Post's All India Pincode Directory: 19,586 PINs and the
   165,627 post offices that serve them, each PIN with its districts (as the
   site lists them, assets/india-districts.js), its postal divisions and
   regions, its town and its post offices.

   What it answers:
     find(pin)                 the PIN's state, districts, town and areas, or null
     districtProblem(pin, state, district)   words when the district is not the PIN's
     placeProblem(pin, place)  words when the town typed is somewhere else

   Fair to the person first. A PIN's delivery area crosses district lines at
   the edges, so a district is accepted when it is the PIN's own or shares a
   postal division with it. A town is refused only on positive evidence: a
   place India Post knows, in few enough districts to be one place, and
   none of them near the PIN (a district name: the PIN's postal region; a
   post office: the PIN's districts and their neighbours). A village India
   Post does not list, or a name shared by many districts, is never refused.
   "New Delhi" for a South Delhi PIN, or "Hyderabad" for one in Rangareddy,
   is how people write their address, and is accepted. */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, 'pin-directory.json.gz');
const PIN = /^[1-9]\d{5}$/;

let data = null;
let index = null;

function load() {
  if (!data) {
    try { data = JSON.parse(zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8')); } catch (error) {
      console.error('PIN directory not read; PINs are judged by their state alone', error && error.message);
      data = { states: [], districts: [], divisions: [], regions: [], pins: {} };
    }
  }
  return data;
}

/* The old and new names of places people still use both of. */
const SAME = {
  bangalore: 'bengaluru', bombay: 'mumbai', calcutta: 'kolkata', madras: 'chennai', gurgaon: 'gurugram',
  mysore: 'mysuru', mangalore: 'mangaluru', belgaum: 'belagavi', gulbarga: 'kalaburagi', shimoga: 'shivamogga',
  tumkur: 'tumakuru', hubli: 'hubballi', bellary: 'ballari', bijapur: 'vijayapura', chikmagalur: 'chikkamagaluru',
  poona: 'pune', trivandrum: 'thiruvananthapuram', cochin: 'kochi', ernakulam: 'kochi', calicut: 'kozhikode', trichur: 'thrissur',
  baroda: 'vadodara', benares: 'varanasi', banaras: 'varanasi', allahabad: 'prayagraj', faizabad: 'ayodhya', cawnpore: 'kanpur',
  pondicherry: 'puducherry', vizag: 'visakhapatnam', visakhapatanam: 'visakhapatnam', trichy: 'tiruchirappalli', tiruchi: 'tiruchirappalli',
  tuticorin: 'thoothukudi', simla: 'shimla', mewat: 'nuh', panjim: 'panaji', secunderabad: 'hyderabad', cuttack: 'cuttack',
  gauhati: 'guwahati', jubbulpore: 'jabalpur', kanjeevaram: 'kanchipuram', conjeevaram: 'kanchipuram', ooty: 'udhagamandalam'
};
/* words that say what kind of place it is, not which */
const NOISE = /\b(city|town|village|vill|post|po|p o|dist|district|distt|tehsil|taluk|taluka|tq|mandal|block|urban|rural|nagar nigam|municipal corporation|cantonment|cantt)\b/g;

function norm(v) {
  const n = String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z ]+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, '');
  return SAME[n] || n;
}
/* "Bengaluru (Bangalore) Urban" is Bengaluru and Bangalore */
function namesOfDistrict(d) {
  const out = new Set([norm(d)]);
  const m = /^(.*?)\s*\((.*)\)\s*(.*)$/.exec(d);
  if (m) { out.add(norm(m[1] + ' ' + m[3])); out.add(norm(m[2] + ' ' + m[3])); out.add(norm(m[1])); out.add(norm(m[2])); }
  return [...out].filter((n) => n.length >= 3);
}

function record(pin) {
  const p = String(pin || '').replace(/\s+/g, '');
  if (!PIN.test(p)) return null;
  const row = load().pins[p];
  return row ? { pin: p, districts: row[0], divisions: row[1], regions: row[2], town: row[3], offices: row[4] ? row[4].split('|') : [] } : null;
}

/* The national index, made once, the first time a place is judged:
   name -> the districts it is in; division and region -> their districts. */
function built() {
  if (index) return index;
  const d = load();
  const names = new Map();
  const byDivision = new Map();
  const byRegion = new Map();
  const add = (map, k, i) => { if (!k) return; let s = map.get(k); if (!s) { s = new Set(); map.set(k, s); } s.add(i); };
  const districtNames = new Map();
  d.districts.forEach(([, name], i) => namesOfDistrict(name).forEach((n) => add(districtNames, n, i)));
  for (const row of Object.values(d.pins)) {
    const ds = row[0];
    for (const dv of row[1]) for (const i of ds) add(byDivision, dv, i);
    for (const rg of row[2]) for (const i of ds) add(byRegion, rg, i);
    if (row[3]) for (const i of ds) add(names, norm(row[3]), i);
    for (const office of (row[4] ? row[4].split('|') : [])) for (const i of ds) add(names, norm(office), i);
  }
  index = { names, districtNames, byDivision, byRegion };
  return index;
}

function stateOfDistrict(i) {
  const d = load();
  const row = d.districts[i];
  return row ? d.states[row[0]] : '';
}
function nameOfDistrict(i) { const row = load().districts[i]; return row ? row[1] : ''; }

/* The districts a PIN may honestly be written with: its own, and those
   sharing a postal division with it. */
function nearOf(rec) {
  const ix = built();
  const out = new Set(rec.districts);
  for (const dv of rec.divisions) for (const i of ix.byDivision.get(dv) || []) out.add(i);
  return out;
}
/* Its postal region's districts, or its state's when India Post gives none */
function regionOf(rec) {
  const ix = built();
  const out = new Set(nearOf(rec));
  for (const rg of rec.regions) for (const i of ix.byRegion.get(rg) || []) out.add(i);
  if (!rec.regions.length) {
    const states = new Set(rec.districts.map(stateOfDistrict));
    load().districts.forEach((row, i) => { if (states.has(load().states[row[0]])) out.add(i); });
  }
  return out;
}

function find(pin) {
  const rec = record(pin);
  if (!rec) return null;
  const districts = rec.districts.map(nameOfDistrict);
  const states = [...new Set(rec.districts.map(stateOfDistrict))].filter(Boolean);
  return {
    pincode: rec.pin,
    state: states.length === 1 ? states[0] : '',
    states,
    district: districts.length === 1 ? districts[0] : '',
    districts,
    near: [...nearOf(rec)].map(nameOfDistrict),
    city: rec.town,
    areas: rec.offices
  };
}

function words(list) {
  return list.length > 2 ? `${list.slice(0, 2).join(', ')} or ${list[2]}` : list.join(' or ');
}
function where(rec) {
  const ds = rec.districts.map(nameOfDistrict);
  const st = [...new Set(rec.districts.map(stateOfDistrict))];
  return `${rec.town ? `${rec.town}, ` : ''}${ds.length ? `${words(ds.map((d) => d.replace(/\s*\([^)]*\)/g, '')))} district, ` : ''}${words(st)}`;
}

/* The district chosen against the PIN: '' when it can be the PIN's. */
function districtProblem(pin, state, district) {
  const rec = record(pin);
  if (!rec || !rec.districts.length || !district) return '';
  const d = load();
  const chosen = d.districts.findIndex((row) => d.states[row[0]] === state && row[1] === district);
  if (chosen < 0) return '';
  if (nearOf(rec).has(chosen)) return '';
  const own = rec.districts.map(nameOfDistrict).map((x) => x.replace(/\s*\([^)]*\)/g, ''));
  return `PIN code ${rec.pin} is in ${words(own)} district, not ${district.replace(/\s*\([^)]*\)/g, '')}. Check the PIN code or the district.`;
}

/* The town typed against the PIN: '' unless it is clearly somewhere else. */
function placeProblem(pin, place) {
  const rec = record(pin);
  const typed = String(place || '').trim();
  if (!rec || !rec.districts.length || !typed) return '';
  const ix = built();
  const own = new Set(rec.offices.map(norm).concat(norm(rec.town)));
  const near = nearOf(rec);
  let region = null;
  const states = new Set(load().states.map(norm));
  const parts = typed.split(/[,/]+/).map((s) => s.trim()).filter(Boolean);
  let elsewhere = '';
  for (const part of parts) {
    const n = norm(part);
    if (n.length < 3 || states.has(n)) continue;
    if (own.has(n)) return '';
    /* a district's name: anywhere in the PIN's postal region will do */
    const asDistrict = ix.districtNames.get(n);
    if (asDistrict) {
      region = region || regionOf(rec);
      if ([...asDistrict].some((i) => region.has(i))) return '';
    }
    /* a post office's name: in the PIN's districts or their neighbours */
    const at = ix.names.get(n);
    if (at && [...at].some((i) => near.has(i))) return '';
    /* a name many villages share ("Rampur") says nothing; one place does */
    if (at && at.size > 3) continue;
    if ((asDistrict || at) && !elsewhere) elsewhere = part;
  }
  if (!elsewhere) return '';
  return `PIN code ${rec.pin} is ${where(rec)}, not ${elsewhere}. Check the PIN code or the town.`;
}

module.exports = { find, districtProblem, placeProblem, norm, _private: { load, record, built, nearOf, regionOf } };
