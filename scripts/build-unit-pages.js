#!/usr/bin/env node
/* A page of its own for every PFA unit: units/<city>.html.

     node scripts/build-unit-pages.js
     node scripts/build-unit-pages.js --check     (fails if a page is out of date)

   Why (owner, 3 Nov 2026: "The laws library and unit pages can rank for
   searches like 'animal cruelty complaint', 'dog bite law India' and 'animal
   ambulance near me'"). Someone in Agra searching for help for a hurt dog is
   answered by a page about Agra, not by a list of eighty cities. units.html
   keeps the list and the map; each unit now also has a short page with its
   phone numbers, email, address, who runs it, the way there, what to do in an
   emergency and the units nearest it, and the structured data search engines
   read (AnimalShelter, with its place on the map).

   Nothing is invented. Every fact is read from the data inside units.html,
   the same data the units page and site search use; a unit with no street
   address on file says so and gives the map link. Change a unit there and
   run this again.

   Also writes assets/unit-pages.json, the list of pages: the sitemap, the
   admin analytics (which pages exist) and the Google Business Profile sheet
   read it. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SC = require('./sync-chrome');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'units');
const SITE = 'https://peopleforanimalsindia.org';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeJson(o) { return JSON.stringify(o).replace(/</g, '\\u003c'); }

/* The units, read the way scripts/build-search-index.js reads them. */
function readUnits() {
  const html = fs.readFileSync(path.join(ROOT, 'units.html'), 'utf8');
  const contacts = {};
  for (const m of html.matchAll(/(\d+):\s*\{ t:\[([^\]]*)\](?:, e:'([^']*)')?(?:, a:'((?:[^'\\]|\\.)*)')?/g)) {
    contacts[m[1]] = { t: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]), e: m[3] || '', a: (m[4] || '').replace(/\\'/g, "'") };
  }
  const notes = {};
  for (const m of html.matchAll(/\{c:'([^']+)', w:'((?:[^'\\]|\\.)*)'\}/g)) notes[m[1]] = m[2].replace(/\\'/g, "'");
  const units = [];
  for (const m of html.matchAll(/\{c:'([^']+)',s:'([^']+)',p:'([^']*)'([^}]*)\}/g)) {
    const rest = m[4];
    const num = (k) => Number((new RegExp(`${k}:(-?[\\d.]+)`).exec(rest) || [])[1]);
    const w = (/w:'((?:[^'\\]|\\.)*)'/.exec(rest) || [])[1];
    const d = String(num('d'));
    const c = contacts[d] || { t: [], e: '', a: '' };
    units.push({ city: m[1], state: m[2], head: m[3], la: num('la'), lo: num('lo'), work: (w || notes[m[1]] || '').replace(/\\'/g, "'"), ref: d, phones: c.t, email: c.e, address: c.a });
  }
  return units;
}

function slugOf(city) {
  return city.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tel(raw) {
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10 && /^[6-9]/.test(d)) return '+91' + d;
  if (d.startsWith('91') && d.length === 12) return '+' + d;
  if (d.startsWith('0')) return '+91' + d.slice(1);
  return d;
}

function km(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.la - a.la) / 2) ** 2 + Math.cos(r(a.la)) * Math.cos(r(b.la)) * Math.sin(r(b.lo - a.lo) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/* The head of every page on the site: the self-hosted Marcellus and its
   measured fallbacks, read from privacy.html so the two can never differ. */
function fontHead() {
  const html = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  const a = html.indexOf('/* latin-ext */');
  const b = html.indexOf(':root{');
  if (a < 0 || b < 0) throw new Error('build-unit-pages: the font block in privacy.html moved');
  return html.slice(a, b).replace(/url\("fonts\//g, 'url("/fonts/').trimEnd();
}

const CSS = `
:root{--paper:#fff;--ink:#111;--muted:#5f5f5f;--line:#e4e2df;--stone:#f5f4f1;--display:Marcellus,'Marcellus Fallback','Marcellus Fallback Times',Georgia,'Times New Roman',serif;--body:'Helvetica Neue',Helvetica,Arial,sans-serif;--ann:34px;--nav:81px;--gutter:max(clamp(16px,4vw,72px),(100% - 1440px) / 2)}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased}
a{color:inherit}
:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.u{padding:calc(var(--ann) + var(--nav) + 48px) var(--gutter) 72px;max-width:1100px}
.u__crumb{margin:0 0 18px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.u__crumb a{text-decoration:none;border-bottom:1px solid currentColor}
.u h1{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(34px,5vw,64px);line-height:1.02;letter-spacing:.01em;margin:0}
.u__lede{margin:18px 0 0;max-width:56ch;font-size:16px;line-height:1.6}
.u__acts{display:flex;flex-wrap:wrap;gap:10px;margin:26px 0 0}
.btn{display:inline-flex;align-items:center;min-height:48px;padding:0 24px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;border:1px solid var(--ink);background:var(--ink);color:#fff}
.btn--light{background:#fff;color:var(--ink)}
.u__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0;margin:44px 0 0;border-top:1px solid var(--line)}
.u__cell{padding:22px 24px 22px 0;border-bottom:1px solid var(--line)}
.u__k{margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.u__v{margin:0;font-size:15px;line-height:1.6;overflow-wrap:anywhere}
.u__v a{text-decoration:none;border-bottom:1px solid var(--line)}
.u h2{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(24px,3vw,36px);line-height:1.1;margin:56px 0 14px}
.u__list{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
.u__list li{padding:16px 0;border-bottom:1px solid var(--line);font-size:15px;line-height:1.6}
.u__list b{display:block;margin:0 0 2px}
.u__near{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.u__near a{display:block;padding:16px;border:1px solid var(--line);text-decoration:none;min-height:44px}
.u__near a:hover{border-color:var(--ink)}
.u__near small{display:block;margin-top:4px;font-size:13px;color:var(--muted)}
details.u__more{margin:12px 0 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
details.u__more summary{cursor:pointer;padding:14px 0;font-size:14px;font-weight:700;min-height:44px}
details.u__more p{margin:0 0 16px;font-size:15px;line-height:1.6}
@media (max-width:700px){.u{padding:calc(var(--ann) + var(--nav) + 28px) 16px 56px}.u__cell{padding-right:0}.btn{width:100%;justify-content:center}}
`;

function pageFor(u, all) {
  const slug = u.slug;
  const url = `${SITE}/units/${slug}`;
  const name = `PFA ${u.city}`;
  const phones = u.phones.filter(Boolean);
  const first = phones[0] ? tel(phones[0]) : '';
  const maps = Number.isFinite(u.la) && Number.isFinite(u.lo) && u.la && u.lo ? `https://www.google.com/maps/search/?api=1&query=${u.la},${u.lo}` : '';
  const near = all.filter((x) => x !== u && Number.isFinite(x.la) && x.la).map((x) => ({ x, d: km(u, x) })).sort((a, b) => a.d - b.d).slice(0, 3);
  const title = `Animal rescue in ${u.city}: PFA ${u.city} unit | People for Animals`;
  const description = `People for Animals in ${u.city}, ${u.state}: ${phones.length ? `call ${phones[0]}` : 'contact the unit'} for an injured, sick or abused animal. Phone, email${u.address ? ', address' : ''} and what to do in an emergency.`;
  const graph = [
    {
      '@context': 'https://schema.org',
      '@type': 'AnimalShelter',
      '@id': `${url}#unit`,
      name: `People for Animals ${u.city}`,
      alternateName: name,
      url,
      parentOrganization: { '@id': `${SITE}/#organisation` },
      ...(first ? { telephone: first } : {}),
      ...(u.email ? { email: u.email } : {}),
      address: { '@type': 'PostalAddress', ...(u.address ? { streetAddress: u.address.split('(')[0].trim().replace(/[.,]\s*$/, '') } : {}), addressLocality: u.city.replace(/\s*\(.*\)$/, ''), addressRegion: u.state, addressCountry: 'IN' },
      ...(maps ? { geo: { '@type': 'GeoCoordinates', latitude: u.la, longitude: u.lo }, hasMap: maps } : {}),
      areaServed: { '@type': 'City', name: u.city.replace(/\s*\(.*\)$/, '') },
      ...(u.head ? { employee: { '@type': 'Person', name: u.head, jobTitle: 'Unit head' } } : {})
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Units', item: `${SITE}/units` },
        { '@type': 'ListItem', position: 3, name: u.city, item: url }
      ]
    }
  ];
  const cell = (k, v) => `<div class="u__cell"><p class="u__k">${esc(k)}</p><p class="u__v">${v}</p></div>`;
  const body = `<main class="u" id="top">
  <p class="u__crumb"><a href="/units.html">All units</a> · ${esc(u.state)}</p>
  <h1>${esc(name)}</h1>
  <p class="u__lede">People for Animals in ${esc(u.city)}, ${esc(u.state)}. For an animal that is hurt, sick, trapped or being treated cruelly in or near ${esc(u.city)}, call the unit first.${u.work ? ' The unit ' + esc(u.work.charAt(0).toLowerCase() + u.work.slice(1)) : ''}</p>
  <div class="u__acts">${phones.length ? `<a class="btn" href="tel:${esc(first)}">Call ${esc(phones[0])}</a>` : ''}<a class="btn btn--light" href="/report.html">Report cruelty</a>${maps ? `<a class="btn btn--light" href="${esc(maps)}" rel="noopener" target="_blank">Open in Google Maps</a>` : ''}</div>
  <div class="u__grid">
    ${cell('Phone', phones.length ? phones.map((p) => `<a href="tel:${esc(tel(p))}">${esc(p)}</a>`).join('<br>') : 'Not on file. <a href="/units.html">Find the nearest unit</a>.')}
    ${u.email ? cell('Email', `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>`) : ''}
    ${cell('Address', u.address ? esc(u.address) : `${esc(u.city)}, ${esc(u.state)}${maps ? `. <a href="${esc(maps)}" rel="noopener" target="_blank">On the map</a>` : ''}`)}
    ${u.head ? cell('Runs the unit', esc(u.head)) : ''}
  </div>
  <h2>In an emergency</h2>
  <ul class="u__list">
    <li><b>An animal is hurt or sick</b>Call the unit on the number above. Keep a safe distance from a frightened animal, and note the exact spot and a landmark.</li>
    <li><b>Someone is being cruel to an animal</b>Cruelty is an offence under the Prevention of Cruelty to Animals Act, 1960 and the Bharatiya Nyaya Sanhita, 2023. <a href="/report.html">Report it to PFA</a>, and see <a href="/laws.html#filing-a-complaint">how to file a police complaint</a> that names the right section.</li>
    <li><b>After a dog bite</b>Wash the wound with soap and running water for 15 minutes and go to a government hospital for anti rabies vaccine the same day. Community dogs may not be beaten, poisoned or moved away: <a href="/laws.html#a27">what the law says after a dog bite</a>.</li>
  </ul>
  ${near.length ? `<h2>Units near ${esc(u.city)}</h2>
  <div class="u__near">${near.map(({ x, d }) => `<a href="/units/${esc(x.slug)}.html"><b>PFA ${esc(x.city)}</b><small>${esc(x.state)}, about ${Math.max(1, Math.round(d))} km away</small></a>`).join('')}</div>` : ''}
  <details class="u__more"><summary>About People for Animals</summary><p>People for Animals is India's largest animal welfare organisation, founded by Maneka Sanjay Gandhi, with units, shelters and hospitals in some eighty cities. Each unit is run locally. <a href="/units.html">See every unit</a> or <a href="/donate.html">support the work</a>.</p></details>
</main>`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<!-- one folder down: the site search and the shared header resolve their
     links from the root, as on every other page -->
<base href="/">
<link rel="preload" href="/fonts/marcellus-latin.woff2" as="font" type="font/woff2" crossorigin>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="People for Animals">
<meta property="og:locale" content="en_IN">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(`${name}: animal rescue in ${u.city}`)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/img/og-default.jpg">
<meta name="twitter:card" content="summary_large_image">
${graph.map((g) => `<script type="application/ld+json">${safeJson(g)}</script>`).join('\n')}
<style>
${fontHead()}
${CSS.trim()}
</style>
</head>
<body>
<header class="site" id="header" data-cursor="dark"></header>
${body}
<footer class="pfa-footer"></footer>
</body>
</html>
`;
  const key = `units/${slug}.html`;
  SC.PAGES[key] = { current: null, group: 'units.html', announce: SC.PAGES['units.html'].announce, root: true };
  return SC.applyChrome(html, key);
}

function build() {
  const units = readUnits().filter((u) => u.state && u.ref);
  const seen = new Set();
  for (const u of units) {
    let s = slugOf(u.city);
    while (seen.has(s)) s += '-' + slugOf(u.state);
    seen.add(s);
    u.slug = s;
  }
  const files = {};
  for (const u of units) files[`${u.slug}.html`] = pageFor(u, units);
  const list = units.map((u) => ({ slug: u.slug, city: u.city, state: u.state, head: u.head, phones: u.phones, email: u.email, address: u.address, la: u.la, lo: u.lo }));
  return { files, list };
}

/* units.html links to every unit's page in plain HTML, folded away under
   one line, so a search engine finds all eighty from the list page and a
   visitor who wants one city's page can open it. Between two markers,
   rewritten whole each run. */
const OPEN = '<!-- unit-pages:start  generated by scripts/build-unit-pages.js - do not edit by hand -->';
const CLOSE = '<!-- unit-pages:end -->';
function listBlock(list) {
  const byState = {};
  list.forEach((u) => { (byState[u.state] = byState[u.state] || []).push(u); });
  const rows = Object.keys(byState).sort().map((st) => `<li><b>${esc(st)}</b> ${byState[st].sort((a, b) => a.city.localeCompare(b.city)).map((u) => `<a href="units/${esc(u.slug)}.html">${esc(u.city)}</a>`).join(', ')}</li>`).join('');
  return `${OPEN}
  <section class="u-pages" id="unit-pages" aria-label="A page for every unit">
    <style>.u-pages{padding:28px var(--gutter);border-top:1px solid var(--line)}.u-pages summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.u-pages ul{margin:12px 0 0;padding:0;list-style:none;columns:2 320px;column-gap:40px}.u-pages li{break-inside:avoid;padding:8px 0;font-size:14px;line-height:1.7}.u-pages b{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#5f5f5f}.u-pages a{text-decoration:none;border-bottom:1px solid var(--line)}</style>
    <details><summary>A page for every unit, by state</summary><ul>${rows}</ul></details>
  </section>
  ${CLOSE}`;
}
function withList(html, list) {
  const block = listBlock(list);
  const a = html.indexOf(OPEN);
  if (a > -1) { const b = html.indexOf(CLOSE, a) + CLOSE.length; return html.slice(0, a) + block + html.slice(b); }
  const at = html.indexOf('  <section class="u-cta" id="setup">');
  if (at < 0) throw new Error('build-unit-pages: units.html has no setup section to sit before');
  return html.slice(0, at) + '  ' + block + '\n\n' + html.slice(at);
}

function run(check) {
  const { files, list } = build();
  const json = JSON.stringify({ note: 'Generated by scripts/build-unit-pages.js from units.html. Do not edit.', units: list }, null, 1) + '\n';
  const stale = [];
  const want = (p, text) => {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (cur === text) return;
    if (check) stale.push(path.relative(ROOT, p));
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  };
  for (const [f, text] of Object.entries(files)) want(path.join(DIR, f), text);
  want(path.join(ROOT, 'assets', 'unit-pages.json'), json);
  const unitsFile = path.join(ROOT, 'units.html');
  want(unitsFile, withList(fs.readFileSync(unitsFile, 'utf8'), list));
  /* a page whose unit is gone goes too */
  if (fs.existsSync(DIR)) {
    for (const f of fs.readdirSync(DIR)) {
      if (f.endsWith('.html') && !files[f]) { if (check) stale.push(`units/${f} (no such unit)`); else fs.unlinkSync(path.join(DIR, f)); }
    }
  }
  if (check) {
    if (stale.length) { console.error('Unit pages out of date, run: node scripts/build-unit-pages.js\n  ' + stale.join('\n  ')); process.exit(1); }
    console.log(`All ${list.length} unit pages are current.`);
    return list;
  }
  console.log(`Wrote ${list.length} unit pages to units/.`);
  return list;
}

module.exports = { readUnits, slugOf, tel, build };

if (require.main === module) run(process.argv.includes('--check'));
