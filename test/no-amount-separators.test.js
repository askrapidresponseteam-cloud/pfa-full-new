'use strict';

/* No thousands separators in any amount the site, an email, a receipt, a
   letter or the admin panel shows (owner: "no commas in numbers"; review of
   27 Nov 2026 found them in the emails, receipts, letters and reports the
   server writes, through toLocaleString). Comments may quote what a person
   types ("Rs 1,500"); what is shown may not. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AMOUNT = /(₹|\\u20b9|INR |Rs\.? ?|US\$)\s?\d{1,3}(,\d{2,3})+/;

function files() {
  const out = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, f);
      const st = fs.statSync(path.join(ROOT, rel));
      if (st.isDirectory()) { if (!/^(vendor|node_modules)$/.test(f)) walk(rel); continue; }
      if (/\.(js|html)$/.test(f)) out.push(rel);
    }
  };
  for (const f of fs.readdirSync(ROOT)) if (/\.html$/.test(f)) out.push(f);
  walk('assets'); walk('lib'); walk('api');
  return out;
}
/* comments are where a typed form is quoted; they are not shown */
const shown = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

test('no amount anywhere is written with a thousands separator', () => {
  const found = [];
  for (const f of files()) {
    const m = AMOUNT.exec(shown(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    if (m) found.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(found, []);
});

test('no number is formatted with grouping: toLocaleString and Intl.NumberFormat say useGrouping false, or are not used for numbers', () => {
  const found = [];
  for (const f of files()) {
    const text = shown(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const m of text.matchAll(/\.toLocaleString\(([^)]*)\)|Intl\.NumberFormat\(([^)]*)\)/g)) {
      const args = m[1] || m[2] || '';
      /* dates and times say so in their options */
      if (/day|month|year|hour|minute|weekday|timeZone/.test(args)) continue;
      if (/Date\([^()]*(\([^()]*\))?[^()]*\)\s*$/.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
      if (/useGrouping:\s*false/.test(args)) continue;
      found.push(`${f}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(found, []);
});
