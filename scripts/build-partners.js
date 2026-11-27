#!/usr/bin/env node
/* Writes the first partnership (lib/partners.js ROSIES) into partners-in-giving.html,
   between the two markers, with the same render() the page uses
   (assets/partners.js), so a browser without script and a search engine see
   the page as it looks, and the panel's own copy replaces it unchanged in
   shape once it is read.

     node scripts/build-partners.js
     node scripts/build-partners.js --check   (fails if the page is out of date) */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/partners');
const { render } = require('../assets/partners.js');

const PAGE = path.join(__dirname, '..', 'partners-in-giving.html');
const START = '<!-- partners:start. Written by scripts/build-partners.js from lib/partners.js: do not edit by hand. -->';
const END = '<!-- partners:end -->';
/* a fixed day, so the page does not change by the calendar */
const AS_OF = '2026-11-27';

function build(page) {
  const a = page.indexOf(START), b = page.indexOf(END);
  if (a < 0 || b < a) throw new Error('partners-in-giving.html has lost its partners markers');
  return page.slice(0, a + START.length) + '\n' + render(P.publicOf(P.ROSIES), true, AS_OF) + '\n' + page.slice(b);
}

if (require.main === module) {
  const page = fs.readFileSync(PAGE, 'utf8');
  const out = build(page);
  if (process.argv.includes('--check')) {
    if (out !== page) { console.error('partners-in-giving.html is out of date. Run: node scripts/build-partners.js'); process.exit(1); }
    console.log('partners-in-giving.html carries the first partnership as written.');
  } else {
    if (out !== page) fs.writeFileSync(PAGE, out);
    console.log('partners-in-giving.html: the first partnership written.');
  }
}
module.exports = { build, START, END, AS_OF };
