#!/usr/bin/env node
'use strict';

/* Bring the founder page's YouTube stills and titles onto PFA's own server.
   ------------------------------------------------------------------------
   The Watch grid was type-only for a documented reason: Instagram and
   Facebook will not hand a still to a third-party page without their script
   or an app token, and their CDN links are signed and expire. YouTube is the
   exception. It publishes a still for every film at a plain, unsigned
   address, and a title at an oEmbed endpoint that needs no key.

   That makes a thumbnail possible. It does not make hot-linking a good idea,
   for the same three reasons the CineKind photographs were brought local:

     1. It spends someone else's bandwidth on every page view.
     2. It sets a third-party request on a page whose whole promise is that
        nothing third-party loads until play is pressed. A still fetched from
        i.ytimg.com breaks that promise before the visitor has done anything.
     3. It breaks silently. The tile's poster is laid in only once the file
        has decoded, so a still that stops resolving does not show a broken
        image: it simply stops appearing, and nobody notices.

   So this downloads them once, into media/founder-films/, where the page
   already points.

     npm run media:founder              fetch stills and report the titles
     npm run media:founder -- --rewrite fetch, and write the titles into the page

   The titles are fetched rather than typed. These are eight films of a named
   person, and a title invented here would be a caption asserting something
   about a real recording. YouTube is asked what each one is called.

   Run it with a network connection. Re-running is safe: a still already on
   disk is left alone unless --force is given.
*/

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
/* Two pages carry YouTube films now, each with its own folder of stills, and
   both are fetched by one run. A second script would be a second place for the
   host list and the retry to drift apart. */
const PAGES = [
  { page: path.join(ROOT, 'founder.html'), out: path.join(ROOT, 'media', 'founder-films') },
  { page: path.join(ROOT, 'academy.html'), out: path.join(ROOT, 'media', 'academy-films') },
  /* Maneka's Picks (9 Nov 2026): its films are written in the academy's shape. */
  { page: path.join(ROOT, 'manekas-picks.html'), out: path.join(ROOT, 'media', 'picks-films') }
];

const args = process.argv.slice(2);
const REWRITE = args.includes('--rewrite');
const FORCE = args.includes('--force');

/* The ids come from the page, so this script and the grid cannot disagree
   about which films exist. Add a film to founder.html and run this again. */
function filmsFromPage(html) {
  const out = [];
  /* founder.html: { src:'youtube', id:'...', ..., title:'...' }
     academy.html: { wall:'...', title:'...', credit:'...', yt:'...' }
     One shape each, and neither is worth a second script. */
  const a = /\{\s*src:'youtube',\s*id:'([^']+)'[\s\S]*?title:'([^']*)'/g;
  let m;
  while ((m = a.exec(html))) out.push({ id: m[1], title: m[2] });
  const b = /title:'((?:[^'\\]|\\.)*)'[^}]*?yt:'([^']+)'/g;
  while ((m = b.exec(html))) out.push({ id: m[2], title: m[1] });
  return out;
}

/* maxres does not exist for every film; hq always does. Asking for the best
   and settling is one request more only when the best is absent. */
const SIZES = ['maxresdefault', 'hqdefault'];

async function grabStill(id) {
  for (const size of SIZES) {
    const url = `https://i.ytimg.com/vi/${id}/${size}.jpg`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    /* YouTube answers a missing maxres with a small grey placeholder rather
       than a 404, so the bytes are the only honest test. */
    if (buf.length < 8000) continue;
    return { buf, size };
  }
  return null;
}

/* Title and channel together. The channel matters as much: a film credited
   to the wrong person is a worse error than a film with no credit, and these
   are other people's work. oEmbed returns both and neither should be typed
   here by anyone. */
async function grabMeta(id) {
  const url = 'https://www.youtube.com/oembed?format=json&url='
    + encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return {
    title: typeof data.title === 'string' ? data.title.trim() : '',
    by: typeof data.author_name === 'string' ? data.author_name.trim() : ''
  };
}

/* Written into a JS string literal in a page that has its own house rules,
   so three things are settled here rather than left to whatever YouTube
   returns.

   The backslash and the apostrophe would end the literal early.

   The dashes are the repo's rule, enforced by test/no-em-dash.test.js: no
   page shows an em dash to a visitor. A YouTube title carrying one would
   turn the whole suite red on the next build, long after anyone remembered
   running this. A hyphen reads the same and passes.

   Curly quotes are left as they arrive: the page is UTF-8 and the rest of
   its copy uses them. */
function forPage(title) {
  return String(title)
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

async function one(PAGE, OUT) {
  const html = fs.readFileSync(PAGE, 'utf8');
  const films = filmsFromPage(html);
  if (!films.length) {
    console.log(`No YouTube films in ${path.basename(PAGE)}.`);
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\n${films.length} films in ${path.basename(PAGE)}.\n`);

  const titles = new Map();
  const channels = new Map();
  let got = 0; let kept = 0; let failed = 0;

  for (const film of films) {
    const dest = path.join(OUT, `${film.id}.jpg`);
    const have = fs.existsSync(dest);

    let note;
    if (have && !FORCE) { kept += 1; note = 'still already here'; }
    else {
      try {
        const still = await grabStill(film.id);
        if (still) { fs.writeFileSync(dest, still.buf); got += 1; note = `${still.size}, ${Math.round(still.buf.length / 1024)}KB`; }
        else { failed += 1; note = 'NO STILL'; }
      } catch (error) { failed += 1; note = `failed: ${error.message}`; }
    }

    let title = film.title;
    if (!title) {
      try { var meta = await grabMeta(film.id); title = (meta && meta.title) || '';
             if (meta && meta.by) channels.set(film.id, meta.by); } catch { title = ''; }
      if (title) titles.set(film.id, title);
    }
    console.log(`  ${film.id}  ${note.padEnd(22)} ${title || '(no title)'}`);
  }

  console.log(`\n  ${got} fetched, ${kept} already here, ${failed} missing.`);

  if (!titles.size) {
    console.log('\n  No titles to write.\n');
  } else if (!REWRITE) {
    console.log('\n  Run again with --rewrite to write those titles into founder.html.\n');
  } else {
    let out = html;
    let written = 0;
    for (const [id, title] of titles) {
      /* Only the empty title belonging to this id: a title someone has
         already edited by hand is theirs, and is not overwritten. */
      const re = new RegExp(`(src:'youtube',\\s*id:'${id}'[\\s\\S]*?title:')('\\s*,)`);
      if (re.test(out)) { out = out.replace(re, `$1${forPage(title)}$2`); written += 1; }
      /* academy.html: title and credit sit together and both come from here. */
      const academy = new RegExp(`(title:')('\\s*,\\s*credit:')('[^}]*yt:'${id}')`);
      if (academy.test(out)) {
        out = out.replace(academy, `$1${forPage(title)}$2${forPage(channels.get(id) || '')}$3`);
        written += 1;
      }
    }
    fs.writeFileSync(PAGE, out);
    console.log(`\n  ${written} titles written into ${path.basename(PAGE)}.\n`);
  }

  if (failed) {
    console.log('  A film with no still keeps its tile: the poster layer is only');
    console.log('  laid in once a file decodes, so the tile stays type-only.\n');
  }
}

/* The books on Maneka's Picks (owner, 10 Nov 2026: "book photo, actual cover
   needs to be there", then "add orange dogs - book"). Each cover is the one
   Amazon.in shows for the book, saved once beside the portrait and served
   from this site. image is the cover's own address on Amazon's image host,
   read from the product page on 10 Nov 2026 (with no size in it, Amazon
   sends the original); link is the page the Buy on Amazon button opens,
   read again for its largest image if the address ever stops answering.
   Best effort, like the stills: if neither answers, the lettered cover stays
   until a later run, or until a cover is saved at that path by hand. */
const BOOKS = [
  { title: 'Animals', out: path.join(ROOT, 'media', 'picks', 'animals-raghu-rai-cover.jpg'),
    image: 'https://m.media-amazon.com/images/I/61dsNajr5FL.jpg', link: 'https://www.amazon.in/Animals-Raghu-Rai/dp/9373070878?th=1' },
  { title: 'Orange Dogs', out: path.join(ROOT, 'media', 'picks', 'orange-dogs-cover.jpg'),
    image: 'https://m.media-amazon.com/images/I/61kNcVt0D5L.jpg', link: 'https://www.amazon.in/dp/9334516496' },
  /* Tender Paws (owner, 13 Nov 2026: "need to add this book to maneka's
     picks page"). Not on Amazon; sold from its own site, tenderpaws.nz. Its
     cover is the one the owner sent, kept in the repository, so there is
     nothing to fetch. */
  { title: 'Tender Paws', out: path.join(ROOT, 'media', 'picks', 'tender-paws-cover.jpg'), kept: true }
];
const BOOK = BOOKS[0];
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function coverFromAmazon(html) {
  const pick = [
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+?\.jpg)"/,
    /data-old-hires="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+?\.jpg)"/,
    /"large":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+?\.jpg)"/,
    /id="(?:landingImage|imgBlkFront|ebooksImgBlkFront)"[^>]*?src="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+?\.jpg)"/,
    /<meta[^>]+property="og:image"[^>]+content="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+?\.jpg)"/
  ];
  for (const re of pick) {
    const m = re.exec(html);
    /* the size suffix (._SX300_ and the like) asks for a smaller copy; without it Amazon sends the original */
    if (m) return m[1].replace(/\._[^/]*_\.jpg$/, '.jpg');
  }
  return null;
}

async function grabImage(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER } });
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    return buf && buf.length >= 5000 ? buf : null;
  } catch { return null; }
}

async function bookCover(book) {
  if (book.kept) { console.log(`\n  ${book.title}: cover kept in the repository${fs.existsSync(book.out) ? '' : ', but missing: save it at ' + path.relative(ROOT, book.out)}.`); return; }
  if (fs.existsSync(book.out) && !FORCE) { console.log(`\n  ${book.title}: cover already here.`); return; }
  let buf = await grabImage(book.image);
  let from = book.image;
  if (!buf) {
    try {
      const res = await fetch(book.link, { headers: { 'user-agent': BROWSER, 'accept-language': 'en-IN,en;q=0.9', accept: 'text/html' } });
      const url = res.ok ? coverFromAmazon(await res.text()) : null;
      if (url) { buf = await grabImage(url); from = url; }
    } catch { /* the lettered cover stays */ }
  }
  if (!buf) { console.log(`\n  ${book.title}: the cover did not arrive this time; the lettered cover stays.`); return; }
  fs.mkdirSync(path.dirname(book.out), { recursive: true });
  fs.writeFileSync(book.out, buf);
  console.log(`\n  ${book.title}: cover saved, ${Math.round(buf.length / 1024)}KB, from ${from}`);
}

async function main() {
  for (const target of PAGES) await one(target.page, target.out);
  for (const book of BOOKS) await bookCover(book);
}

module.exports = { filmsFromPage, forPage, PAGES, BOOK, BOOKS, coverFromAmazon };

if (require.main === module) {
  main().catch((error) => {
    console.error('fetch-founder-films failed:', error.message);
    process.exitCode = 1;
  });
}
