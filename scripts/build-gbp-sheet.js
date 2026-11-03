#!/usr/bin/env node
/* The Google Business Profile bulk upload sheet: one row for every PFA unit
   and one for the Sanjay Gandhi Animal Care Centre (owner, 3 Nov 2026:
   "Give each unit and the Care Centre its own Google Business Profile").

     node scripts/build-gbp-sheet.js   ->  business-profiles/google-business-profiles.csv

   Google's bulk upload takes ten or more locations of one organisation in a
   single spreadsheet (business.google.com > Add business > Import
   businesses). The columns below are Google's own template headings. Each
   row's website is the unit's own page on the site (units/<city>), so a
   search on Maps and a search on Google lead to the same place.

   Only facts the site already holds are filled in. A unit without a street
   address or PIN code on file has those cells empty and "needs address" in
   Labels: Google will not accept the row until the unit fills them in.
   Hours are left empty for the same reason: no unit's hours are on file.

   Not published: business-profiles/ is not part of the website (minify skips
   .csv files). */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const UP = require('./build-unit-pages');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://peopleforanimalsindia.org';
const OUT = path.join(ROOT, 'business-profiles', 'google-business-profiles.csv');

const HEAD = ['Store code', 'Business name', 'Address line 1', 'Address line 2', 'Sub-locality', 'Locality', 'Administrative area', 'Country / Region', 'Postal code',
  'Latitude', 'Longitude', 'Primary phone', 'Additional phones', 'Website', 'Primary category', 'Additional categories', 'From the business', 'Labels'];

function cell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function phone(p) { const t = UP.tel(p); return t.startsWith('+91') ? '+91 ' + t.slice(3) : t; }

function rows() {
  const { list } = UP.build();
  const out = [];
  out.push({
    'Store code': 'PFA-SGACC', 'Business name': 'Sanjay Gandhi Animal Care Centre',
    'Address line 1': 'Raja Garden, near Shivaji College', Locality: 'New Delhi', 'Administrative area': 'Delhi', 'Country / Region': 'IN', 'Postal code': '110027',
    'Primary phone': '+91 9560802425', 'Additional phones': '+91 8882325407', Website: `${SITE}/sgacc`,
    'Primary category': 'Animal shelter', 'Additional categories': 'Animal protection organization, Animal hospital',
    'From the business': "People for Animals' animal hospital and shelter in Raja Garden, New Delhi, since 1980: rescue, treatment and lifelong care for injured, sick and abandoned animals.",
    Labels: 'Care Centre'
  });
  for (const u of list) {
    const pin = (/\b([1-9]\d{5})\b/.exec(u.address || '') || [])[1] || '';
    const line = (u.address || '').split('(')[0].replace(/\s+/g, ' ').trim().replace(/[.,]\s*$/, '');
    const phones = (u.phones || []).filter(Boolean);
    out.push({
      'Store code': `PFA-${u.slug.toUpperCase()}`, 'Business name': `People for Animals ${u.city.replace(/\s*\(.*\)$/, '')}`,
      'Address line 1': line.slice(0, 80), 'Address line 2': line.length > 80 ? line.slice(80, 160) : '',
      Locality: u.city.replace(/\s*\(.*\)$/, '').split(' / ').pop(), 'Administrative area': u.state, 'Country / Region': 'IN', 'Postal code': pin,
      Latitude: u.la || '', Longitude: u.lo || '',
      'Primary phone': phones[0] ? phone(phones[0]) : '', 'Additional phones': phones.slice(1, 3).map(phone).join(', '),
      Website: `${SITE}/units/${u.slug}`,
      'Primary category': 'Animal protection organization', 'Additional categories': 'Animal shelter',
      'From the business': `People for Animals in ${u.city}, ${u.state}: rescue and care for injured, sick and abused animals, and help with animal cruelty complaints. Part of India's largest animal welfare network.`,
      Labels: ['PFA unit', !line || !pin ? 'needs address' : ''].filter(Boolean).join(', ')
    });
  }
  return out;
}

function run() {
  const r = rows();
  const csv = [HEAD.map(cell).join(',')].concat(r.map((row) => HEAD.map((h) => cell(row[h])).join(','))).join('\r\n') + '\r\n';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, '\ufeff' + csv);
  const missing = r.filter((x) => /needs address/.test(x.Labels)).length;
  console.log(`${r.length} rows to ${path.relative(ROOT, OUT)}; ${missing} need a street address or PIN code before Google will take them.`);
}

module.exports = { rows, HEAD };
if (require.main === module) run();
