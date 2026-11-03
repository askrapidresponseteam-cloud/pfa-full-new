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
  { page: path.join(ROOT, 'academy.html'), out: path.join(ROOT, 'media', 'academy-films') }
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

async function main() {
  for (const target of PAGES) await one(target.page, target.out);
}

module.exports = { filmsFromPage, forPage, PAGES };

if (require.main === module) {
  main().catch((error) => {
    console.error('fetch-founder-films failed:', error.message);
    process.exitCode = 1;
  });
}
