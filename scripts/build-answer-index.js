#!/usr/bin/env node
/* Builds assets/assistant-answers.json: the site's own words, a paragraph at
   a time, for the chat to answer an open question with (owner, 16 Nov 2026,
   of answering open questions by searching the site's own pages: "yes").

   Every public page (the same pages site search reads), cut into the
   paragraphs, list items and answers a visitor reads, each with the heading
   or question it sits under. The chat finds the paragraph that answers a
   question best and gives it word for word, with its page; it never writes
   an answer of its own (owner, 15 Nov 2026: "always answer from site
   database. not google or anywhere else").

     node scripts/build-answer-index.js           write it
     node scripts/build-answer-index.js --check   fail if it is out of date

   Run with build:search, after a page changes. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SEARCH = require('./build-search-index.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'assistant-answers.json');

const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', middot: '·', hellip: '…', rupee: '₹', times: '×', mdash: '-', ndash: '-', minus: '-' };
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : ' '))
    .replace(/[‐-―−]/g, '-');
}
function plain(html) {
  return decode(String(html).replace(/<button\b[\s\S]*?<\/button>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/* the paragraphs a visitor reads, in order, each under its heading */
function passages(html) {
  const body = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<form\b[\s\S]*?<\/form>/gi, ' ')
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const out = [];
  let heading = '';
  const re = /<(h[1-4]|summary|dt|p|li|dd|blockquote)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    const words = plain(m[3]);
    if (!words) continue;
    if (/^h[1-4]$|^summary$|^dt$/.test(tag)) { heading = words.slice(0, 160); continue; }
    /* labels, cites, tags and buttons are not answers */
    if (/class="[^"]*\b(cite|cites|label|eyebrow|kicker|meta|tags?|crumbs?|sr-only|visually-hidden)\b/i.test(m[2])) continue;
    if (words.length < 40 || words.length > 700) continue;
    if (!/[a-z]{3}/.test(words) || !/[.!?:)]$|[a-z]$/.test(words)) continue;
    out.push({ h: heading, x: words });
  }
  return out;
}

function build() {
  const docs = [];
  for (const file of SEARCH.publicPages()) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (/<meta name="robots" content="noindex/i.test(html)) continue;
    const title = plain((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || file).replace(/\s*\|\s*People for Animals\s*$/i, '');
    const seen = new Set();
    for (const p of passages(html)) {
      if (seen.has(p.x)) continue;
      seen.add(p.x);
      docs.push({ t: file === 'index.html' ? 'Home' : title, u: file, h: p.h, x: p.x });
    }
  }
  return { generatedFrom: 'the public pages (scripts/build-answer-index.js)', passages: docs };
}

function json(data) { return JSON.stringify(data) + '\n'; }

if (require.main === module) {
  const next = json(build());
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (now !== next) { console.error('assets/assistant-answers.json is out of date: run node scripts/build-answer-index.js'); process.exit(1); }
    console.log('assets/assistant-answers.json is current.');
  } else {
    fs.writeFileSync(OUT, next);
    console.log(`Wrote assets/assistant-answers.json: ${JSON.parse(next).passages.length} passages.`);
  }
}

module.exports = { build, passages, OUT };
