'use strict';

/* Where a person is on the People directory's Map (owner, 18 Nov 2026: "can
   you give map view"): their PIN code's place, or the middle of their
   district when the PIN is not known. From lib/pin-places.json.gz, built by
   scripts/build-pin-places.js out of India Post's own directory; nothing is
   looked up anywhere else, and no address leaves the server for it. */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, 'pin-places.json.gz');
let data = null;

function load() {
  if (!data) {
    try { data = JSON.parse(zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8')); } catch (error) {
      console.error('PIN places not read; the map has no one on it', error && error.message);
      data = { pins: {}, districts: {} };
    }
  }
  return data;
}

/* { at: [lat, lng], by: 'pin' | 'district' } or null */
function placeOf(p) {
  const d = load();
  const pin = String((p && p.pin) || '').replace(/\D/g, '');
  if (/^[1-9]\d{5}$/.test(pin) && d.pins[pin]) return { at: d.pins[pin], by: 'pin' };
  const k = `${(p && p.state) || ''}|${(p && p.district) || ''}`;
  if (d.districts[k]) return { at: d.districts[k], by: 'district' };
  return null;
}

module.exports = { placeOf, _reset: () => { data = null; } };
