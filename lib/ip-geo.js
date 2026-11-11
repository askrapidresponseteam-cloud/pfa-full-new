'use strict';

/* The country, and in India the state, a network address is in (owner,
   11 Nov 2026: "see if you can tell it was opened from which state").

   On Vercel the host says so in a header. On Firebase (Cloud Run) no header
   does, so lib/analytics.js asks here: lib/ip-geo.bin.gz, built by
   scripts/build-ip-geo.py from DB-IP's free IP to City Lite database
   (CC BY 4.0; the panel's Analytics links to DB-IP.com, as the licence
   asks). The address is looked up and let go: it is never written anywhere.

   Approximate, as every such database is: a mobile network often places
   its users where its gateway is, so a phone in Udupi may read as
   Karnataka's capital's state or a neighbouring one. It is a fair picture
   of where visits come from, not a fact about any one of them.

   lookup('49.37.1.1')  ->  { country: 'IN', region: 'KA' }
   lookup('8.8.8.8')    ->  { country: 'US', region: '' }
   lookup('10.0.0.1')   ->  { country: '', region: '' }   (nothing known) */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const FILE = path.join(__dirname, 'ip-geo.bin.gz');
let DATA = null;
let FAILED = false;

function load() {
  if (DATA || FAILED) return DATA;
  try {
    const buf = zlib.gunzipSync(fs.readFileSync(FILE));
    if (buf.subarray(0, 8).toString('latin1') !== 'PFAGEO1\n') throw new Error('not an ip-geo file');
    let at = 8;
    const text = () => { const n = buf.readUInt32LE(at); at += 4; const s = buf.subarray(at, at + n).toString('utf8'); at += n; return s; };
    const source = text();
    const codes = text().split('\n');
    const part = (wide) => {
      const n = buf.readUInt32LE(at); at += 4;
      const size = wide ? 8 : 4;
      const starts = wide ? new BigUint64Array(n) : new Uint32Array(n);
      for (let i = 0; i < n; i += 1) starts[i] = wide ? buf.readBigUInt64LE(at + i * size) : buf.readUInt32LE(at + i * size);
      at += n * size;
      const cs = new Uint16Array(n);
      for (let i = 0; i < n; i += 1) cs[i] = buf.readUInt16LE(at + i * 2);
      at += n * 2;
      return { starts, cs };
    };
    const v4 = part(false);
    const v6 = part(true);
    DATA = { source, codes, v4, v6 };
  } catch (error) {
    FAILED = true;
    console.warn('ip-geo: not available', error && error.message);
  }
  return DATA;
}

/* the last start at or below n */
function find(starts, n) {
  let lo = 0;
  let hi = starts.length - 1;
  if (hi < 0 || n < starts[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= n) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function v4Number(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

/* the first 64 bits of an IPv6 address, as a BigInt */
function v6Network(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(':')) return null;
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const n = v4Number(tail[1]);
    if (n == null) return null;
    s = s.slice(0, -tail[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16));
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = left.concat(Array(Math.max(0, fill)).fill('0'), right);
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n);
}

const NONE = Object.freeze({ country: '', region: '' });

function lookup(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return NONE;
  const d = load();
  if (!d) return NONE;
  let code = 0;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(raw);
  const n4 = v4Number(mapped ? mapped[1] : raw);
  if (n4 != null) {
    const i = find(d.v4.starts, n4);
    if (i >= 0) code = d.v4.cs[i];
  } else {
    const n6 = v6Network(raw);
    if (n6 == null) return NONE;
    const i = find(d.v6.starts, n6);
    if (i >= 0) code = d.v6.cs[i];
  }
  const place = d.codes[code] || '';
  if (!place) return NONE;
  const [country, region] = place.split('-');
  return { country, region: region || '' };
}

function source() { const d = load(); return d ? d.source : ''; }

module.exports = { lookup, source, _v6Network: v6Network };
