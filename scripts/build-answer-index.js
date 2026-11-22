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
    /* a form's explanations stay (what a field is for, the terms); its
       fields, options and buttons go (22 Nov 2026) */
    .replace(/<(select|textarea|option|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<input\b[^>]*>/gi, ' ')
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    /* the Care Guides list is the guides' data drawn as cards: read from the data instead */
    .replace(/<ol class="ph-list"[\s\S]*?(?=<p class="m-fine ph-fine")/, ' ');
  const out = [];
  let heading = '';
  let section = '';
  let shortItems = [];
  const flushShort = () => {
    if (shortItems.length >= 3) {
      const x = `${heading ? heading.replace(/[.:]+$/, '') + ': ' : ''}${shortItems.join('; ')}.`;
      if (x.length <= 900) out.push({ h: heading, x });
    }
    shortItems = [];
  };
  const re = /<(h[1-4]|summary|dt|p|li|dd|blockquote|tr|figcaption)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    /* a table row: its cells in a line, the first as its label */
    const words = tag === 'tr'
      ? (() => { const cells = [...m[3].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => plain(c[2])).filter(Boolean); return cells.length > 1 ? `${cells[0]}: ${cells.slice(1).join('; ')}` : cells.join(''); })()
      : plain(m[3]);
    if (!words) continue;
    /* a sub-heading ("What helps") is read with the section it is in
       ("Cats: enrichment"), so it says what it is about (22 Nov 2026) */
    if (/^h[1-4]$|^summary$|^dt$/.test(tag)) flushShort();
    if (/^h[1-3]$|^summary$|^dt$/.test(tag)) { section = words.slice(0, 160); heading = section; continue; }
    if (tag === 'h4') { heading = (section && section !== words ? section.slice(0, 110) + ': ' : '') + words.slice(0, 80); continue; }
    /* short list items (a name, an honour, a thing to bring) are read
       together, as the list under their heading (22 Nov 2026) */
    if (tag === 'li' && words.length < 40) { if (words.length >= 3) shortItems.push(words); continue; }
    /* labels, cites, tags and buttons are not answers */
    if (/class="[^"]*\b(cite|cites|label|eyebrow|kicker|meta|tags?|crumbs?|sr-only|visually-hidden)\b/i.test(m[2])) continue;
    if (words.length < 40 || words.length > 700) continue;
    if (!/[a-z]{3}/.test(words) || !/[.!?:)]$|[a-z]$/.test(words)) continue;
    out.push({ h: heading, x: words });
  }
  flushShort();
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
  for (const d of fromData()) docs.push(d);
  return { generatedFrom: 'the public pages and the data they are drawn from (scripts/build-answer-index.js)', passages: docs };
}

/* What some pages draw in the browser from their data, and the membership
   tiers the form offers (22 Nov 2026, owner: "enrich the knowledge base of
   the bot so that it is able to answer each and every answer known to it
   correctly from the website"). Each as the page shows it, under its page. */
function fromData() {
  const out = [];
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (_) { return null; } };
  const day = (iso) => { const d = new Date(String(iso || '') + 'T00:00:00Z'); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
  const rupees = (n) => '\u20b9' + Number(n).toLocaleString('en-IN');
  const add = (t, u, h, x) => { x = decode(String(x || '')).replace(/\s+/g, ' ').trim(); if (x.length >= 30) out.push({ t, u, h: decode(String(h || '')).trim(), x }); };
  /* membership: the tiers, their price and kit (lib/payment.js) */
  try {
    const src = fs.readFileSync(path.join(ROOT, 'lib/payment.js'), 'utf8');
    const block = /const MEMBERSHIP_TIERS = (\{[\s\S]*?\n\});/.exec(src);
    const tiers = block ? Function(`return ${block[1]}`)() : {};
    const names = Object.values(tiers).map((t) => `${t.label.replace(/ membership$/, '')} ${rupees(t.amount)}`);
    if (names.length) add('Get involved', 'get-involved.html#membership', 'Membership fees: how much is each membership', `The memberships and what each costs: ${names.join(', ')}. Every member gets a membership card; the kit depends on the membership.`);
    for (const t of Object.values(tiers)) add('Get involved', 'get-involved.html#membership', `${t.label}: price and kit`, `${t.label} costs ${rupees(t.amount)}.${t.kit.length ? ` It comes with ${t.kit.map((k) => k.replace(/^(A|An|The) /, (m) => m.toLowerCase())).join(', ')}.` : ' It comes with the membership card.'}`);
  } catch (_) { /* the form still says it */ }
  /* events */
  const ev = read('data/events.json');
  for (const e of (ev && ev.events) || []) add('Events', 'events.html', e.title, `${e.title}: ${[day(e.date), e.city].filter(Boolean).join(', ')}. ${e.note || ''}`);
  /* the newsroom */
  const nr = read('data/newsroom.json');
  for (const n of (nr && nr.stories) || []) add('Newsroom', 'newsroom.html', n.title, `${n.dek || n.title}${n.date ? ` (${[day(n.date), n.place].filter(Boolean).join(', ')})` : ''}`);
  /* the library */
  const lib = read('data/library.json');
  /* the short names people use for the Acts ("the PCA Act") */
  const shortName = (t) => (/Prevention of Cruelty to Animals Act/i.test(t) ? ' (the PCA Act)' : /Wild ?life \(?Protection\)? Act/i.test(t) ? ' (the WPA)' : '');
  for (const b of (lib && lib.items) || []) add('Library', 'library.html', b.title + shortName(b.title), `${b.title}${shortName(b.title)}${b.kind ? ` (${b.kind})` : ''}: ${b.blurb || ''}`);
  /* what a company can fund */
  const csr = read('data/csr-projects.json');
  for (const c of (csr && csr.projects) || []) add('CSR', 'csr.html', `${c.name}: what it costs to fund`, `${c.name} costs ${rupees(c.price)} for a company to fund. ${c.pitch || ''}${c.what ? ` What it is: ${c.what}.` : ''}${c.time ? ` For: ${c.time}.` : ''}`);
  /* care guides */
  const mn = read('data/med-notes.json');
  for (const n of (mn && mn.notes) || []) {
    add('Care Guides', `pet-health.html#note=pfa-${n.id}`, n.title, `${n.title}: ${n.summary || ''}${n.credit ? ` Written by ${n.credit}.` : ''}`);
    /* what the guide itself says, as its own points (the PDF is not read here) */
    for (const x of Array.isArray(n.points) ? n.points : []) add('Care Guides', `pet-health.html#note=pfa-${n.id}`, n.title, x);
  }
  return out;
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
