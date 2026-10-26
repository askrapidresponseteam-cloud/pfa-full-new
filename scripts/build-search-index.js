#!/usr/bin/env node
/* Builds assets/search-index.json and sitemap.xml from the public pages.

   search.html reads the index if it exists and otherwise crawls the site in
   the visitor's browser, page by page, before it can answer. Shipping the
   index makes the first search instant; the sitemap is what search engines
   ask for. Both are derived, so run this after adding or renaming a page:

     node scripts/build-search-index.js

   A test checks that every public page is in both. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://peopleforanimalsindia.org';
/* Pages that are part of a flow, not destinations, or are not for the public. */
/* submission-collage.html is finished but deliberately unlinked: it belongs to a
   newsroom story that does not exist yet. Indexing it would surface it in site
   search before that story is written. Delete it from this list on the day the
   story goes up. */
/* read.html is the library's reader: one page for every document, chosen by ?r=, so it is never a result on its own.
   Each document the library lists is, at read.html?r=<document> (25 Oct 2026), from the library's own links. */
const EXCLUDE = new Set(['admin.html', '404.html', 'search.html', 'patron-card-preview.html', 'caregiver-card.html', 'animal.html', 'winner.html', 'submission-collage.html', 'member-photo.html', 'read.html']);

/* Not the same idea as EXCLUDE. search.html is public, it just is not a
   destination worth indexing. These must never reach a visitor
   by any route: not the sitemap, not site search, not the popular-searches
   list. The panel is behind a Firebase admin claim, but a signed-out stranger
   should not be handed its address by the search box either.

   The crawled search-index.json in the repo root predates this rule and had
   four admin.html rows in it, which is how the panel was turning up in search.
   pfa-search.js and lib/routes/search-popular.js keep a copy of this pattern
   because one is browser code and the other is a lambda; test/admin-not-
   discoverable.test.js asserts all three still agree. */
const PRIVATE = /^\/?(admin\b|api\/)/i;
function isPrivatePath(url) {
  return PRIVATE.test(String(url == null ? '' : url).trim());
}

/* Entities, decoded, so a title reads "Get Involved" and a fee reads
   "\u20b9500" in the search box rather than "&#183;" and "&#8377;". Dashes
   of every width become a plain hyphen: the site uses none (owner's rule),
   and the index must not bring them back. */
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '\u2019', lsquo: '\u2018',
  rdquo: '\u201d', ldquo: '\u201c', middot: '\u00b7', hellip: '\u2026', rarr: '\u2192', larr: '\u2190',
  times: '\u00d7', rupee: '\u20b9', copy: '\u00a9', mdash: '-', ndash: '-', minus: '-' };
function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : ' '))
    .replace(/[\u2010-\u2015\u2212]/g, '-');
}
function text(html) {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
/* A meta tag's content, in either quote: an apostrophe inside a double-
   quoted description ("India's") used to end it there ("Object to India"). */
function meta(html, name) {
  const tag = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*>`, 'i').exec(html);
  if (!tag) return '';
  const m = /\bcontent="([^"]*)"/i.exec(tag[0]) || /\bcontent='([^']*)'/i.exec(tag[0]);
  return m ? decode(m[1]) : '';
}
/* Script and style first: units.html builds its cards in script strings
   that contain <h2>, and the crawl was indexing the code itself
   ("' + esc(st) + '") as the units page's keywords. */
function headings(html) {
  return [...html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ').matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => text(m[1])).filter(Boolean).slice(0, 130);
  /* 130, not 20: achievements.html alone carries a hundred and three h3
     entry titles, and a record a visitor cannot search is not on offer. */
}

/* The words of a stretch of text, once each, for the engine to find a row
   by anything it says, not only its title (owner, 25 Oct 2026: "ensure the
   search is truly google grade. any and all related works should be
   lookable/findable"). Lower case, in first-seen order, without the little
   words, and without the words the row already carries in its title, its
   description or its keywords, so the index grows by what is new. */
const BODY_STOP = new Set(('a an the and or of to in on at by for from with as is are was were be been being it its this that these those '
  + 'he she they them his her their we our us you your i me my not no so if then than but also can could will would should may might must '
  + 'has have had do does did done which who whom whose what when where why how all any each every some such more most other into over '
  + 'under about after before up out only own same very just one two three four five there here').split(' '));
function bodyWords(textValue, already, cap) {
  const seen = new Set();
  const skip = new Set(String(already || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const out = [];
  for (const w of String(textValue || '').toLowerCase().replace(/[\u2019']/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 3 || BODY_STOP.has(w) || skip.has(w) || seen.has(w) || /^\d{1,2}$/.test(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= (cap || 400)) break;
  }
  return out.join(' ');
}

/* A result's description reads like a sentence and stops at a word: the
   paragraphs under a heading, not the tags, cites, numbers and buttons
   around them ("...sensitised in 12 State" ran on into the next record's
   number, "049"), cut at a space with an ellipsis when it is long. */
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1);
  const at = cut.lastIndexOf(' ');
  return (at > n * 0.6 ? cut.slice(0, at) : t.slice(0, n)).replace(/[\s,;:(\u00b7-]+$/, '') + '\u2026';
}
function prose(html) {
  const paras = [...String(html).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    .filter((m) => !/class="[^"]*\b(cite|cites|label|eyebrow|kicker|meta|tags?|note__label|[a-z]+__(m|meta|tags?|cat|c|foot|acts?|actions|cta))\b/i.test(m[1]))
    .map((m) => text(m[2].replace(/<button\b[\s\S]*?<\/button>/gi, ' '))).filter(Boolean);
  return paras.join(' ');
}

function publicPages() {
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !EXCLUDE.has(f)).sort();
}

function build() {
  const pages = publicPages().map((file) => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || file;
    return {
      url: file === 'index.html' ? '/' : '/' + file,
      title: text(title),
      description: meta(html, 'description'),
      headings: headings(html),
      body: text(html).slice(0, 12000)
    };
  });
  /* ---- the rows layer: what the search engine actually eats ----------
     pages above is the coarse, per-page view the tests and sitemap use.
     rows is the fine view, in pfa-search.js's own row shape, so the engine
     can answer with the exact thing rather than the page it lives on:
     one row per public page, one per anchored h2/h3 with the text under
     it, and one per unit, built from the data inside units.html because
     the units never exist as HTML at all. */
  const GROUP = {
    'laws.html': 'Laws', 'academy.html': 'Explore', 'achievements.html': 'About',
    'someone.html': 'Explore', 'cinekind.html': 'Explore', 'events.html': 'Places',
    'newsroom.html': 'Explore', 'wall.html': 'Explore', 'get-involved.html': 'Do something',
    'donate.html': 'Do something', 'shop.html': 'Do something', 'report.html': 'Do something', 'track.html': 'Do something',
    'ask.html': 'Do something', 'founder.html': 'About', 'careers.html': 'About',
    'quiz.html': 'Explore', 'units.html': 'Places', 'index.html': 'Explore'
  };
  const rows = [];
  for (const file of publicPages()) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, ' ');
    /* The page's own name, without the site name after a bar or a dot.
       The home page is "Home": its title is written for search engines. */
    const title = file === 'index.html' ? 'Home' : text((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || file)
      .replace(/\s*[|\u00b7]\s*People for Animals\s*$/i, '');
    const group = GROUP[file] || 'Explore';
    const pageDesc = clip(meta(html, 'description'), 220);
    const pageKeys = headings(html).join(' ').slice(0, 1200);
    rows.push({
      t: title, s: 'Pages', y: 'page', u: file === 'index.html' ? 'index.html' : file,
      d: pageDesc,
      k: pageKeys,
      b: bodyWords(text(stripped.replace(/<form\b[\s\S]*?<\/form>/gi, ' ')), title + ' ' + pageDesc + ' ' + pageKeys, 500)
    });
    /* Anchored sections: walk the page once, remembering the last id seen,
       and give every h2/h3 that can be reached by an anchor its own row. */
    let lastId = '';
    let lastUsed = false;
    /* h2 and h3 carry the sections; laws.html carries two hundred questions
       as <summary> spans instead, each under its own anchor, and a question
       nobody can search is a question nobody asked. Both count as marks.

       What counts as an anchor (8 Oct 2026). It used to be the last id seen,
       of anything, and that sent "Who you are." to careers.html#zoneErr, a
       hidden error line, and "Pay and join." to an input box. An anchor is
       now an id on a block a reader can land on: a section, an article, a
       div, a heading, a list item, a details block or a figure; never a
       control, never an error or empty-state line, never something hidden,
       and never the thank-you pane that only exists after paying.

       Form steps are not destinations. A heading inside a <form> ("Send
       it.", "Where the card goes.") is a step of filling it in, and the
       form itself is reached from its own row and the curated actions. */
    const BLOCK = /^(section|article|div|main|aside|details|summary|figure|li|h[1-6]|header|fieldset|dl|dt|table|ol|ul)$/i;
    /* Ranges no row may come from: every form, and every block that is
       hidden or only shown after a step (an error, an empty state, the
       "done" pane), found by balancing its own tag. */
    const off = [...stripped.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((f) => [f.index, f.index + f[0].length]);
    for (const b of stripped.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
      const cls = (/\bclass="([^"]*)"/.exec(b[2]) || [])[1] || '';
      if (!/(^|\s)hidden(\s|=|$)/.test(b[2]) && !/(^|\s)(err|error|empty|done)(\s|$)/.test(cls)) continue;
      const tag = b[1].toLowerCase();
      const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
      re.lastIndex = b.index + b[0].length;
      let depth = 1, end = stripped.length, t;
      while (depth && (t = re.exec(stripped)) !== null) { depth += t[1] ? -1 : 1; if (!depth) end = re.lastIndex; }
      off.push([b.index, end]);
    }
    const inForm = (at) => off.some(([a, b]) => at >= a && at < b);
    /* A heading that is a link is an item of its own: a document in the
       library, a story in the newsroom, a product. It gets a row of its own,
       landing where its link goes when that is on this site (read.html?r=,
       cinekind.html#...), or on its section here when the link leads away
       (a newspaper's story is reached from the card that names it). Its
       words are the blurb that follows it. */
    const items = [];
    const linkedItem = (at, inner, end) => {
      const a = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(inner || '');
      if (!a || inForm(at)) return false;
      const head = text(inner);
      if (!head || head.length < 3) return false;
      const href = a[1];
      const away = /^(https?:|mailto:|tel:)/i.test(href);
      const own = !away && !href.startsWith('#') ? href : (href.startsWith('#') ? file + href : '');
      const after = stripped.slice(end, end + 1600);
      const blurb = text((/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(after) || [])[1] || '');
      items.push({ head, own, lastId, blurb, at, more: text(after.split(/<h[1-4]\b/i)[0]) });
      return true;
    };
    const walker = /<([a-z][a-z0-9]*)\b([^>]*?)\sid="([^"]+)"([^>]*)>|<h([23])[^>]*>([\s\S]*?)<\/h\5>|<span class="qa__q">([^<]+)<\/span>/gi;
    const marks = [];
    let m;
    while ((m = walker.exec(stripped)) !== null) {
      if (m[3]) {
        const attrs = (m[2] || '') + ' ' + (m[4] || '');
        const cls = (/\bclass="([^"]*)"/.exec(attrs) || [])[1] || '';
        const hidden = /(^|\s)hidden(\s|=|$)/.test(attrs);
        const flowOnly = /(^|\s)(err|error|empty|done)(\s|$)/.test(cls);
        const heading = /^h[23]$/i.test(m[1]);
        if (heading) {
          /* A heading with its own id: the block around it is the better
             landing (a product card, a shelf) when that block has not been
             claimed by an earlier heading; otherwise the heading itself. */
          const close = stripped.indexOf('</' + m[1], walker.lastIndex);
          if (close > -1 && linkedItem(m.index, stripped.slice(walker.lastIndex, close), close)) { walker.lastIndex = close; continue; }
          if (close > -1 && !inForm(m.index)) {
            const id = lastId && !lastUsed ? lastId : m[3];
            marks.push({ id, head: text(stripped.slice(walker.lastIndex, close)), at: close });
            if (id === lastId) lastUsed = true;
            walker.lastIndex = close;
          }
          continue;
        }
        if (BLOCK.test(m[1]) && !hidden && !flowOnly && !inForm(m.index)) { lastId = m[3]; lastUsed = false; }
        continue;
      }
      if (inForm(m.index)) continue;
      if (m[6] !== undefined && linkedItem(m.index, m[6], walker.lastIndex)) continue;
      marks.push({ id: lastId, head: text(m[6] || m[7] || ''), at: walker.lastIndex });
      lastUsed = true;
    }
    const taken = new Set();
    marks.forEach((mark, i) => {
      if (!mark.id || !mark.head || mark.head.length < 3) return;
      /* One row per anchor: the mark nearest its id is what the anchor
         actually lands on; later marks under the same id would ship the
         same link twice under different names. */
      if (taken.has(mark.id)) return;
      taken.add(mark.id);
      const until = i + 1 < marks.length ? marks[i + 1].at : stripped.length;
      const part = stripped.slice(mark.at, until).replace(/<form\b[\s\S]*?<\/form>/gi, ' ');
      const whole = text(part);
      const said = prose(part);
      const snippet = clip(said.length >= 40 ? said : whole, 220);
      rows.push({
        t: mark.head.slice(0, 120), s: group, y: file === 'laws.html' ? 'law' : 'article',
        u: file + '#' + mark.id, p: title + ' \u203a ' + mark.head.slice(0, 60),
        d: snippet, k: '',
        b: bodyWords(whole, mark.head + ' ' + snippet, 300)
      });
    });
    for (const it of items) {
      const u = it.own || (it.lastId ? file + '#' + it.lastId : file);
      rows.push({
        t: it.head.slice(0, 120), s: group, y: 'article', u,
        p: title + ' \u203a ' + it.head.slice(0, 60),
        d: clip(it.blurb, 220), k: '',
        b: bodyWords(it.more, it.head + ' ' + it.blurb, 120)
      });
    }
  }
  /* Units: the list is data inside units.html, so search reads the data.
     The old names people actually type ride along as keywords. */
  /* Keyed by the city exactly as units.html spells it. Gurugram and
     Bhubaneswar were keyed by spellings the data does not use, so they never
     applied. Big cities with no unit of their own (Delhi, Chennai, Kolkata,
     Hyderabad, Pune) are answered in pfa-search.js by distance instead. */
  const ALIAS = {
    Calicut: 'kozhikode', Thiruvananthapuram: 'trivandrum', Mumbai: 'bombay',
    Bangalore: 'bengaluru', 'Gurgaon / Sadhana': 'gurugram gurgaon', Bhubaneshwar: 'bhubaneswar',
    Mysore: 'mysuru', Hubli: 'hubballi dharwad', Trichy: 'tiruchirappalli tiruchi', Kollam: 'quilon',
    Thrissur: 'trichur', 'Rohilkhand / Bareilly': 'bareilly', 'Nagpur (Vidarbha)': 'nagpur vidarbha',
    'Durg Bhilai': 'durg bhilai', Vasco: 'vasco da gama', Sriganganagar: 'ganganagar',
    'Pali Marwar': 'pali', Kumbakonam: 'kumbakonam', Secunderabad: 'secunderabad'
  };
  const unitsHtml = fs.readFileSync(path.join(ROOT, 'units.html'), 'utf8');
  const contacts = {};
  for (const cm of unitsHtml.matchAll(/(\d+):\s*\{ t:\[([^\]]*)\](?:, e:'([^']*)')?(?:, a:'([^']*)')?/g)) {
    contacts[cm[1]] = {
      t: [...cm[2].matchAll(/'([^']+)'/g)].map((x) => x[1]),
      e: cm[3] || '', a: cm[4] || ''
    };
  }
  let unitCount = 0;
  for (const um of unitsHtml.matchAll(/\{c:'([^']+)',s:'([^']+)',p:'([^']*)'[^}]*?d:(\d+)[^}]*\}/g)) {
    const [whole, city, state, head, ref] = um;
    /* where it is, so a search for a city with no unit of its own can be
       answered with the nearest ones */
    const la = Number((/la:(-?[\d.]+)/.exec(whole) || [])[1]);
    const lo = Number((/lo:(-?[\d.]+)/.exec(whole) || [])[1]);
    const c = contacts[ref] || { t: [], e: '', a: '' };
    const bits = [state];
    if (head) bits.push('Head: ' + head);
    if (c.t.length) bits.push(c.t.slice(0, 3).join(', '));
    if (c.e) bits.push(c.e);
    rows.push({
      t: 'PFA ' + city + ' unit', s: 'Places', y: 'place',
      u: 'units.html?q=' + encodeURIComponent(city),
      p: 'Units \u203a ' + city,
      d: bits.join(' \u00b7 ').slice(0, 230),
      k: (city + ' ' + state + ' ' + (ALIAS[city] || '') + ' ' + head + ' unit hospital shelter rescue centre contact phone email helpline').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300),
      /* the street address on its own: pfa-search.js weighs it lightly, so
         a locality finds its unit without "road" finding all eighty */
      ...(c.a ? { a: c.a.replace(/\s+/g, ' ').slice(0, 300) } : {}),
      ...(Number.isFinite(la) && Number.isFinite(lo) && la && lo ? { g: [la, lo] } : {})
    });
    unitCount += 1;
  }
  /* Things a page holds as small items, without a heading of their own,
     that people search for by name (25 Oct 2026). */
  const page = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  /* CineKind: every honour, by who received it and what it is called, on
     its own place in the roll of honour. */
  const cine = page('cinekind.html');
  for (const hm of cine.matchAll(/<li\b[^>]*\bid="(h(\d\d)-\d+)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const award = text((/class="(?:t|rt__t)">([\s\S]*?)<\/span>/.exec(hm[3]) || [])[1] || '');
    const who = text((/class="(?:w|rt__w)">([\s\S]*?)<\/span>/.exec(hm[3]) || [])[1] || '');
    const work = text((/class="rt__s">([\s\S]*?)<\/span>/.exec(hm[3]) || [])[1] || '');
    if (!award || !who) continue;
    const year = '20' + hm[2];
    rows.push({
      t: who + ', ' + award, s: 'Explore', y: 'article', u: 'cinekind.html#' + hm[1],
      p: 'CineKind \u203a ' + year,
      d: `CineKind ${year}: ${award}${work ? ', for ' + work : ''}.`,
      k: (who + ' ' + award + ' ' + work + ' cinekind ' + year + ' honour award film').toLowerCase()
    });
  }
  /* Membership: each tier, by its name and what it costs. */
  const gi = page('get-involved.html');
  for (const tm of gi.matchAll(/<label class="tier">([\s\S]*?)<\/label>/g)) {
    const name = text((/class="tier__name">([\s\S]*?)<\/span>/.exec(tm[1]) || [])[1] || '');
    const amt = text((/class="tier__amt">([\s\S]*?)<\/span>/.exec(tm[1]) || [])[1] || '');
    if (!name) continue;
    rows.push({
      t: name + ' membership', s: 'Do something', y: 'article', u: 'get-involved.html#membership',
      p: 'Get involved \u203a Membership',
      d: `${name} membership of People for Animals${amt ? ', ' + amt : ''}.`,
      k: (name + ' membership member join tier fee ' + amt).toLowerCase()
    });
  }
  /* Events: each kind of event, which happens where someone asks for one. */
  const ev = page('events.html');
  const evAsk = text((/<p>(A drive or a camp happens[\s\S]*?)<\/p>/.exec(ev) || [])[1] || '');
  for (const bm of ev.matchAll(/<button class="ev-bar"[^>]*data-kind="([a-z]+)"[^>]*data-none="([^"]*)"[^>]*data-choice-label="([^"]*)"[^>]*>[\s\S]*?class="ev-bar__name">([^<]+)</g)) {
    rows.push({
      t: decode(bm[3]), s: 'Places', y: 'article', u: 'events.html#request',
      p: 'Events \u203a ' + decode(bm[4]),
      d: clip(decode(bm[2]) + ' ' + evAsk, 220),
      k: (decode(bm[4]) + ' ' + bm[1] + ' event ask request organise').toLowerCase()
    });
  }
  /* One row per place and name: a heading met twice (as a section and as a
     link) keeps its first row, with the words of both. */
  const byKey = new Map();
  for (const r of rows.splice(0)) {
    const key = r.u + '|' + r.t.toLowerCase();
    const had = byKey.get(key);
    if (!had) { byKey.set(key, r); continue; }
    if (r.b) had.b = bodyWords((had.b || '') + ' ' + r.b, had.t + ' ' + had.d, 500);
  }
  rows.push(...byKey.values());
  console.log(`rows layer: ${rows.length} rows (${unitCount} units).`);
  /* One index, one path. The client fetches 'search-index.json' relative to
     the page, and every page lives at the root, so the index lives at the
     root. A copy in assets/ once drifted apart from this file and the search
     box quietly served a stale crawl for days; the agreement test now pins
     the two paths together. The .js twin is the file:// fallback: fetch is
     dead on the file scheme, a script tag is not, so a double-clicked page
     still searches everything. */
  const payload = JSON.stringify({ generatedAt: new Date().toISOString(), pages, rows }, null, 0);
  fs.writeFileSync(path.join(ROOT, 'search-index.json'), payload);
  fs.writeFileSync(path.join(ROOT, 'search-index.js'), 'window.__PFA_SEARCH_INDEX = ' + payload + ';\n');
  const stale = path.join(ROOT, 'assets', 'search-index.json');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
  const today = new Date().toISOString().slice(0, 10);
  /* vercel.json sets cleanUrls:true, so /laws.html is a 308 to /laws. A sitemap
     full of redirecting URLs makes every entry a hop, so the extension comes
     off here to match the canonical scripts/build-seo.js writes. p.url keeps
     its extension: search.html and the popular-searches API key off it. */
  const loc = (p) => (p.url === '/' ? '/' : p.url.replace(/\.html$/, ''));
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map((p) => `  <url><loc>${SITE}${loc(p)}</loc><lastmod>${today}</lastmod></url>`).join('\n') + '\n</urlset>\n';
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);
  return pages;
}

module.exports = { build, publicPages, EXCLUDE, PRIVATE, isPrivatePath };

if (require.main === module) {
  const pages = build();
  console.log(`Indexed ${pages.length} pages into search-index.json (+ .js twin) and sitemap.xml.`);
}
