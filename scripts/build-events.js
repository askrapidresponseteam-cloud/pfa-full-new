#!/usr/bin/env node
/* Writes the events archive into events.html from data/events.json, between
   the two pairs of markers in the page.

     node scripts/build-events.js
     node scripts/build-events.js --check     (fails if events.html is out of date)

   Why written into the page and not fetched: the archive is ordinary HTML the
   moment the page arrives, for a visitor without JavaScript, for search
   engines (every event also goes out as schema.org Event data) and for the
   tests. The output never depends on today's date, so --check gives the same
   answer every day. Which event is coming next, the countdown, and which have
   been held are worked out in the visitor's browser, by the page's own script.

   Adding an event: add an entry to data/events.json and run this. It refuses
   bad data with the entry and the field. DEPLOY.command runs it, and the test
   suite refuses a page that is out of date. HANDBOOK.md section 10. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'events.html');
const DATA = path.join(ROOT, 'data', 'events.json');
const SITE = 'https://peopleforanimalsindia.org';

const START = '<!-- events:start. Written by scripts/build-events.js from data/events.json: edit the data, then run the script. -->';
const END = '<!-- events:end -->';
const NEXT_START = '<!-- events-next:start. Written by scripts/build-events.js. -->';
const NEXT_END = '<!-- events-next:end -->';

/* Each kind has a bar on the page. `choice` is the option it preselects in the
   request form below, so it must stay one of that form's own options. */
const KINDS = {
  awards: { bar: 'Awards', none: 'No awards evening is on the record yet.', choice: 'A CineKind screening', choiceLabel: 'Ask for a CineKind screening' },
  adoption: { bar: 'Adoption drives', none: 'No adoption drive is on the record yet.', choice: 'An adoption drive', choiceLabel: 'Ask for an adoption drive' },
  camp: { bar: 'Camps', none: 'No camp is on the record yet.', choice: 'A sterilisation or vaccination camp', choiceLabel: 'Ask for a camp' },
  openday: { bar: 'Open days', none: 'No open day is on the record yet.', choice: 'Something else', choiceLabel: 'Ask for an open day' },
  talk: { bar: 'Talks', none: 'No talk is on the record yet.', choice: 'A talk or a school session', choiceLabel: 'Ask for a talk' }
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CAPTION_MAX = 24;

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const two = (n) => String(n).padStart(2, '0');

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* A calendar date, fixed in UTC: the same answer on any machine, any day. */
function parseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d;
}
const dmy = (d) => `${two(d.getUTCDate())} ${two(d.getUTCMonth() + 1)} ${d.getUTCFullYear()}`;
const long = (d) => `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

function imageHosts(root) {
  const m = /img-src ([^;"]+)/.exec(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  return m ? m[1].split(/\s+/).filter((t) => /^https:\/\//.test(t)).map((t) => new URL(t).host) : [];
}

function walkStrings(value, visit, key = '') {
  if (typeof value === 'string') visit(value, key);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, visit, `${key}[${i}]`));
  else if (value && typeof value === 'object') Object.keys(value).forEach((k) => walkStrings(value[k], visit, key ? `${key}.${k}` : k));
}

function validate(data, root = ROOT) {
  if (!data || !Array.isArray(data.events)) return ['data/events.json: there must be an "events" list'];
  const problems = [];
  const hosts = imageHosts(root);
  const codes = new Set();
  data.events.forEach((ev, i) => {
    const where = `event ${i + 1}${ev && text(ev.title) ? ` (${ev.title})` : ''}`;
    const say = (what) => problems.push(`${where}: ${what}`);
    if (!ev || typeof ev !== 'object') { say('is not an entry'); return; }
    if (!/^\d{3}$/.test(String(ev.code || ''))) say('code must be three digits, like "003"');
    else if (codes.has(ev.code)) say(`code ${ev.code} is used twice`);
    else codes.add(ev.code);
    if (!Object.prototype.hasOwnProperty.call(KINDS, ev.kind)) say(`kind must be one of ${Object.keys(KINDS).join(', ')}`);
    if (!text(ev.title)) say('title is missing');
    if (!text(ev.city)) say('city is missing');
    if (!parseDate(ev.date)) say('date must be a real date, written YYYY-MM-DD');
    if (ev.note != null && !text(ev.note)) say('note, when given, must say something');
    if (ev.tags != null && (!Array.isArray(ev.tags) || ev.tags.length > 3 || !ev.tags.every(text))) say('tags must be a list of up to three words');
    if (!Array.isArray(ev.photos) || ev.photos.length < 1 || ev.photos.length > 3) say('photos must list one to three photographs');
    (Array.isArray(ev.photos) ? ev.photos : []).forEach((p, j) => image(`photo ${j + 1}`, p, true));
    if (ev.feature != null) image('feature', ev.feature, false);
    if (ev.link != null) {
      if (!ev.link || !text(ev.link.href) || !text(ev.link.label)) say('link needs an href and a label');
      else if (!/^https:\/\//.test(ev.link.href) && !fs.existsSync(path.join(root, ev.link.href.split('#')[0]))) say(`link ${ev.link.href} is not a page on this site`);
    }
    walkStrings(ev, (s, key) => { if (s.includes('\u2014')) say(`${key} contains an em dash, and the site shows none`); });

    function image(label, p, captioned) {
      if (!p || !text(p.src) || !text(p.alt)) { say(`${label} needs a src and an alt`); return; }
      if (captioned && (!text(p.caption) || p.caption.length > CAPTION_MAX)) say(`${label} needs a caption of at most ${CAPTION_MAX} characters: it is written by hand on the card`);
      if (/^https:\/\//.test(p.src)) {
        const host = new URL(p.src).host;
        if (!hosts.includes(host)) say(`${label}: ${host} is not in the img-src of the Content-Security-Policy in vercel.json`);
      } else if (/^[a-z0-9][\w./-]*$/i.test(p.src) && !p.src.includes('..')) {
        if (!fs.existsSync(path.join(root, p.src))) say(`${label}: ${p.src} is not on disk`);
      } else {
        say(`${label}: src must be a path on this site or an https address`);
      }
    }
  });
  return problems;
}

const newestFirst = (events) => events.slice().sort((a, b) =>
  (a.date === b.date ? (a.code < b.code ? 1 : -1) : (a.date < b.date ? 1 : -1)));

const ONERROR = 'onerror="var f=this.closest(\'[data-shot]\');if(f)f.remove()"';

function polaroid(ev, photo) {
  return '<figure class="ev-pola" data-shot>'
    + `<p class="ev-pola__top"><span class="ev-dot">${esc(ev.code)}</span><span class="ev-pola__mark">PFA</span></p>`
    + `<div class="ev-pola__frame"><img src="${esc(photo.src)}" alt="${esc(photo.alt)}" loading="lazy" decoding="async" ${ONERROR}></div>`
    + `<figcaption>${esc(photo.caption)}</figcaption>`
    + '</figure>';
}

function card(ev) {
  const d = parseDate(ev.date);
  const tags = (ev.tags && ev.tags.length ? ev.tags : [KINDS[ev.kind].bar]).map((t) => `<span>${esc(t)}</span>`).join('');
  return [
    `<li class="ev-card" id="event-${esc(ev.code)}" data-code="${esc(ev.code)}" data-kind="${esc(ev.kind)}" data-date="${esc(ev.date)}" style="--n:${ev.photos.length}">`,
    `<h3 class="ev-card__title">${esc(ev.title)} <span class="ev-card__city">${esc(ev.city)}</span></h3>`,
    `<p class="ev-card__meta"><span><span class="ev-no">No. ${esc(ev.code)}</span><time datetime="${esc(ev.date)}"><span aria-hidden="true">${dmy(d)}</span><span class="ev-sr">${esc(long(d))}</span></time></span><span class="ev-card__tags">${tags}</span></p>`,
    ev.note ? `<p class="ev-card__note">${esc(ev.note)}</p>` : '',
    `<div class="ev-polas">${ev.photos.map((p) => polaroid(ev, p)).join('')}</div>`,
    `<p class="ev-card__foot"><span class="ev-state"></span>${ev.link ? `<a class="ev-card__link" href="${esc(ev.link.href)}">${esc(ev.link.label)}</a>` : ''}</p>`,
    '</li>'
  ].filter(Boolean).join('\n');
}

function bar(kind, name, count, pressed) {
  const k = KINDS[kind];
  const about = k ? ` data-none="${esc(k.none)}" data-choice="${esc(k.choice)}" data-choice-label="${esc(k.choiceLabel)}"` : '';
  return `<button class="ev-bar" type="button" data-kind="${kind}" aria-pressed="${pressed}"${about}><span class="ev-bar__name">${esc(name)}</span><span class="ev-bar__n">${count}</span><span class="ev-bar__plus" aria-hidden="true"></span></button>`;
}

function nowBar(ev) {
  if (!ev) return '';
  const d = parseDate(ev.date);
  return `<a class="ev-now" id="evNow" href="#event-${esc(ev.code)}" hidden><span class="ev-now__label">Coming next</span><span class="ev-now__title">${esc(ev.title)}</span><span class="ev-now__where">${esc(ev.city)}</span><span class="ev-now__meta"><span class="ev-no">No. ${esc(ev.code)}</span><time datetime="${esc(ev.date)}">${dmy(d)}</time><span class="ev-now__count"></span></span></a>`;
}

const absolute = (src) => (/^https:\/\//.test(src) ? src : `${SITE}/${src}`);

function jsonLd(events) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Events held or announced by People for Animals',
    itemListElement: events.map((ev, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Event',
        name: ev.title,
        startDate: ev.date,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        location: { '@type': 'Place', name: ev.city, address: { '@type': 'PostalAddress', addressLocality: ev.city, addressCountry: 'IN' } },
        organizer: { '@type': 'Organization', name: 'People for Animals', url: `${SITE}/` },
        image: ev.photos.map((p) => absolute(p.src)),
        ...(ev.note ? { description: ev.note } : {}),
        url: `${SITE}/events#event-${ev.code}`
      }
    }))
  }).replace(/</g, '\\u003c');
}

function clientData(events) {
  return JSON.stringify({
    events: events.map((ev) => {
      const d = parseDate(ev.date);
      return { code: ev.code, kind: ev.kind, title: ev.title, city: ev.city, date: ev.date, dmy: dmy(d), long: long(d), note: ev.note || '', link: ev.link || null, feature: ev.feature || null };
    })
  }).replace(/</g, '\\u003c');
}

function nextBlock(ev) {
  if (!ev) {
    return [
      '<article class="ev-next" id="evNext" aria-labelledby="evNextTitle">',
      '<p class="ev-next__label">Nothing announced yet</p>',
      '<h2 class="ev-next__title" id="evNextTitle">The next event could be in your area.</h2>',
      '<p class="ev-next__note">Ask for one with the form, and a named person at PFA will come back to you.</p>',
      '</article>'
    ].join('\n');
  }
  const d = parseDate(ev.date);
  return [
    '<article class="ev-next" id="evNext" aria-labelledby="evNextTitle">',
    '<p class="ev-next__label">Latest on the record</p>',
    `<h2 class="ev-next__title" id="evNextTitle">${esc(ev.title)}</h2>`,
    `<p class="ev-next__where"><span class="ev-next__city">${esc(ev.city)}</span> <time datetime="${esc(ev.date)}">${esc(long(d))}</time></p>`,
    ev.note ? `<p class="ev-next__note">${esc(ev.note)}</p>` : '<p class="ev-next__note" hidden></p>',
    ev.link ? `<a class="ev-next__link" href="${esc(ev.link.href)}">${esc(ev.link.label)}</a>` : '<a class="ev-next__link" href="#request" hidden></a>',
    ev.feature ? `<figure class="ev-next__photo" data-shot><img src="${esc(ev.feature.src)}" alt="${esc(ev.feature.alt)}" loading="lazy" decoding="async" ${ONERROR}></figure>` : '',
    '</article>'
  ].filter(Boolean).join('\n');
}

function between(html, start, end, content, label) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`events.html has lost its ${label} markers; put them back where the archive goes`);
  return `${html.slice(0, a + start.length)}\n${content}\n${html.slice(b)}`;
}

function render(page, data) {
  const events = newestFirst(data.events);
  const counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, events.filter((ev) => ev.kind === k).length]));
  const newest = events[0];
  const archive = [
    '<section class="ev" id="events" aria-labelledby="evTitle">',
    '<div class="ev-head" id="top">',
    '<div class="ev-head__text">',
    /* the title block every page opens with (10 Oct 2026): eyebrow, tick, title */
    '<p class="eyebrow pfa-kicker">Get involved</p>',
    '<h1 class="pfa-title ev-title" id="evTitle">Events</h1>',
    '<p class="ev-lede">Every awards evening, drive, camp and open day PFA has held or announced, newest first.</p>',
    '</div>',
    '<div class="ev-tally">',
    `<p class="ev-count"><b>${events.length}</b> on the record</p>`,
    /* drawn chevrons, not typed ones: a font's chevron sits off the middle of its square (23 Oct 2026) */
    '<div class="ev-nav" hidden><button type="button" data-step="-1" aria-controls="evScroll" aria-label="Newer events"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M15 6l-6 6 6 6"/></svg></button><button type="button" data-step="1" aria-controls="evScroll" aria-label="Older events"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block"><path d="M9 6l6 6-6 6"/></svg></button></div>',
    '</div>',
    '</div>',
    '<div class="ev-scroll" id="evScroll" role="region" aria-label="Events, newest first" tabindex="0">',
    '<ol class="ev-strip">',
    events.map(card).join('\n'),
    '</ol>',
    '<div class="ev-empty" id="evEmpty" hidden>',
    '<h3 class="ev-empty__title">Nothing of this kind is on the record yet.</h3>',
    '<p>They happen where someone local asks for one and can help make it possible.</p>',
    '<a class="ev-btn" href="#request" data-ask="">Ask for one</a>',
    '</div>',
    '<div class="ev-ask">',
    '<h3 class="ev-ask__title">Your area could be next.</h3>',
    '<p>A drive or a camp happens where someone local asks for one: a ground, a hall, a residents association, a school.</p>',
    '<a class="ev-btn" href="#request">Ask for an event</a>',
    '</div>',
    '</div>',
    '<div class="ev-bars" role="group" aria-label="Show one kind of event">',
    [bar('all', 'Every event', events.length, true)].concat(Object.keys(KINDS).map((k) => bar(k, KINDS[k].bar, counts[k], false))).join('\n'),
    '</div>',
    '<p class="ev-sr" aria-live="polite"></p>',
    nowBar(newest),
    `<script type="application/ld+json">${jsonLd(events)}</script>`,
    `<script type="application/json" id="evData">${clientData(events)}</script>`,
    '</section>'
  ].filter((line) => line !== '').join('\n');
  return between(between(page, START, END, archive, 'events'), NEXT_START, NEXT_END, nextBlock(newest), 'events-next');
}

function main() {
  const check = process.argv.includes('--check');
  let data;
  try { data = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (error) {
    console.error(`data/events.json could not be read as JSON: ${error.message}`);
    process.exit(1);
  }
  const problems = validate(data);
  if (problems.length) {
    console.error(`data/events.json has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const page = fs.readFileSync(PAGE, 'utf8');
  const out = render(page, data);
  if (check) {
    if (out !== page) { console.error('events.html is out of date with data/events.json. Run: node scripts/build-events.js'); process.exit(1); }
    console.log(`events.html carries all ${data.events.length} events.`);
    return;
  }
  if (out !== page) fs.writeFileSync(PAGE, out);
  console.log(`events.html: ${data.events.length} event${data.events.length === 1 ? '' : 's'} written, newest first.`);
}

if (require.main === module) main();

module.exports = { KINDS, validate, render, parseDate, newestFirst };
