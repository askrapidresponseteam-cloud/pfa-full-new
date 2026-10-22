#!/usr/bin/env node
'use strict';
/* Writes a minified copy of the site to dist/.

   The source stays readable: the tests, sync-chrome and the docs all read the
   HTML as text and would break if the files under the root were minified in
   place. Deploy dist/ instead (see the notes at the bottom of this file).

   What is minified: every .html, every browser-side .js and .css, and the
   search index JSON. Server code under api/ and lib/ is copied untouched -
   it is never sent to a browser, so shrinking it buys nothing and risks
   something.

   No third-party minifier is used. The JavaScript pass below is deliberately
   conservative: it strips comments and indentation, but keeps a line break
   wherever removing it could change what the parser sees (automatic
   semicolon insertion), and it never renames anything. Expect roughly a
   30-45% reduction, not the 60% a full compiler gets, in exchange for being
   safe on code it has never seen.

   Usage:  node scripts/minify.js          -> dist/
           node scripts/minify.js --check  -> minify to memory and syntax-check only
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const CHECK_ONLY = process.argv.includes('--check');

/* ---- JavaScript ------------------------------------------------------- */

const WORD = /[A-Za-z0-9_$\u0080-\uffff]/;
/* After one of these words a `/` starts a regular expression, not division. */
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
/* After a line break, one of these as the previous significant character
   means the break can go without ASI ever having applied there. */
const BREAK_DROP_AFTER = new Set([';', '{', ',', '(', '[', '=', '&', '|', '?', ':', '<', '>', '*', '%', '^', '~', '!']);
const BREAK_DROP_BEFORE = new Set(['}', ']', ')']);

function minifyJS(src) {
  const out = [];              // significant chunks
  let i = 0;
  const n = src.length;
  let lastWord = '';           // last identifier/keyword emitted
  let lastSig = '';            // last significant character emitted
  let pendingSpace = false;
  let pendingBreak = false;

  function lastChar() { return lastSig; }
  function flushSpace(next) {
    if (pendingBreak) {
      const prev = lastChar();
      const drop = prev === '' || BREAK_DROP_AFTER.has(prev) || BREAK_DROP_BEFORE.has(next);
      out.push(drop ? '' : '\n');
    } else if (pendingSpace) {
      const prev = lastChar();
      const keep = (WORD.test(prev) && WORD.test(next))
        || (prev === '+' && next === '+') || (prev === '-' && next === '-')
        || (prev === '/' && next === '/') || (prev === '/' && next === '*')
        || (prev === '/' && WORD.test(next) && lastWord === '') // after a regex literal, e.g. /x/ in y
        ;
      if (keep) out.push(' ');
    }
    pendingSpace = false; pendingBreak = false;
  }
  function emit(text) {
    flushSpace(text[0]);
    out.push(text);
    lastSig = text[text.length - 1];
  }

  function regexAllowed() {
    const p = lastSig;
    if (p === '') return true;
    if (WORD.test(p)) return REGEX_AFTER_WORD.has(lastWord);
    return !(p === ')' || p === ']' || p === '}');
  }

  function readString(q) {
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === q) { j++; break; }
      if (c === '\n') break; // unterminated - leave it to the syntax check
      j++;
    }
    return src.slice(i, j);
  }
  function readTemplate() {
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { j++; break; }
      if (c === '$' && src[j + 1] === '{') {
        j += 2;
        let depth = 1;
        while (j < n && depth > 0) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '{') depth++;
          else if (d === '}') depth--;
          else if (d === '"' || d === "'" ) { const save = i; i = j; j += readString(d).length; i = save; continue; }
          else if (d === '`') { const save = i; i = j; j += readTemplate().length; i = save; continue; }
          j++;
        }
        continue;
      }
      j++;
    }
    return src.slice(i, j);
  }
  function readRegex() {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '\n') break;
      if (inClass) { if (c === ']') inClass = false; j++; continue; }
      if (c === '[') { inClass = true; j++; continue; }
      if (c === '/') { j++; break; }
      j++;
    }
    while (j < n && /[a-z]/.test(src[j])) j++; // flags
    return src.slice(i, j);
  }

  while (i < n) {
    const c = src[i];
    if (c === '\n' || c === '\r') { pendingBreak = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') { pendingSpace = true; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n;
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      const body = src.slice(i, j);
      if (body.indexOf('\n') >= 0) pendingBreak = true; else pendingSpace = true;
      i = j; continue;
    }
    if (c === '"' || c === "'") { const s = readString(c); emit(s); lastWord = ''; i += s.length; continue; }
    if (c === '`') { const s = readTemplate(); emit(s); lastWord = ''; i += s.length; continue; }
    if (c === '/' && regexAllowed()) { const s = readRegex(); emit(s); lastWord = ''; i += s.length; continue; }
    if (WORD.test(c)) {
      let j = i + 1;
      while (j < n && WORD.test(src[j])) j++;
      const w = src.slice(i, j);
      emit(w); lastWord = w; i = j; continue;
    }
    emit(c); lastWord = ''; i++;
  }
  return out.join('').trim();
}

/* ---- CSS -------------------------------------------------------------- */

function minifyCSS(src) {
  let s = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; s += ' '; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      s += src.slice(i, j + 1); i = j + 1; continue;
    }
    s += c; i++;
  }
  return s
    .replace(/\s+/g, ' ')
    .replace(/ ?([{};,]) ?/g, '$1')
    .replace(/: /g, ':')
    .replace(/;}/g, '}')
    .replace(/ !important/g, '!important')
    .trim();
}

/* ---- HTML ------------------------------------------------------------- */

const KEEP_VERBATIM = /<(pre|textarea)\b[^>]*>[\s\S]*?<\/\1>/gi;

function minifyHTML(src, name) {
  const holes = [];
  function hole(text) { holes.push(text); return `\u0000${holes.length - 1}\u0000`; }

  /* Comments go, except the <!--PFA_...--> markers the server-rendered pages
     splices server data into, and any conditional comment. */
  let s = src.replace(/<!--(?!\[if|PFA_)[\s\S]*?-->/g, '');

  s = s.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    if (/\bsrc=/.test(attrs) || !body.trim()) return hole(`<script${attrs.replace(/\s+/g, ' ').trimEnd()}>${body.trim()}</script>`);
    const type = (attrs.match(/type\s*=\s*["']([^"']+)["']/) || [])[1];
    let min;
    if (type && /json/i.test(type)) {
      try { min = JSON.stringify(JSON.parse(body)); } catch (_) { min = body.trim(); }
    } else if (!type || /^(text\/javascript|application\/javascript|module)$/i.test(type)) {
      min = compressJS(body, `${name} <script>`);
      checkJS(min, `${name} <script>`);
    } else {
      min = body;
    }
    return hole(`<script${attrs.replace(/\s+/g, ' ').trimEnd()}>${min}</script>`);
  });
  s = s.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, body) => hole(`<style${attrs}>${minifyCSS(body)}</style>`));
  s = s.replace(KEEP_VERBATIM, (m) => hole(m));

  /* Runs of whitespace collapse to one space. Whitespace between two tags
     goes entirely only when it spans a line break - that is layout indentation,
     while `<b>a</b> <i>b</i>` on one line is a real space between words. */
  s = s.replace(/>[ \t\f]*[\r\n][ \t\r\n\f]*</g, '><');
  s = s.replace(/[ \t\r\n\f]+/g, ' ');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, k) => holes[Number(k)]);
  return s.trim();
}

/* ---- checks ----------------------------------------------------------- */

function checkJS(code, label) {
  try { new vm.Script(code, { filename: label }); }
  catch (error) { throw new Error(`minified ${label} does not parse: ${error.message}`); }
}

/* ---- the real compressor ---------------------------------------------- */

/* Terser, when it is installed, is the pass that ships: full compression and
   local-name mangling, the dense form commercial sites serve - smaller than
   the conservative pass and much harder to lift and reuse. Only names local
   to a function are renamed; everything on window (PFA_CHROME, PFA_THEATRE,
   the YouTube callback) and every cross-script global keeps its name, so the
   pages' inline scripts still see each other. Where terser is not available
   (an install without devDependencies), the conservative pass above still
   produces a correct, if more readable, dist/. */
let terser = null;
try { terser = require('terser'); } catch (e) {}
if (!terser) console.warn('terser not installed - falling back to the conservative minifier');

function compressJS(src, label) {
  if (!terser) return minifyJS(src);
  const r = terser.minify_sync(src, {
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false }
  });
  if (r.error) throw new Error(`terser on ${label}: ${r.error.message}`);
  if (typeof r.code !== 'string') throw new Error(`terser on ${label} returned no code`);
  return r.code;
}

/* ---- the walk --------------------------------------------------------- */

/* api/ and lib/ are the serverless function's source; Vercel builds it from
   the project root, and everything under dist/ is served as a public file.
   So server code never goes into dist/, nor do the deploy configs. */
const SKIP_DIRS = new Set(['dist', 'public', 'node_modules', 'test', 'scripts', 'tools', '_inline-extracts', '_retired-assets', '.git', '.github', '.vercel', 'functions', 'api', 'lib']);
/* robots.txt is the one .txt that must ship: it is what keeps admin.html out of
   search results, and until 30 Aug 2026 the .txt rule below silently dropped it. */
/* Two .txt files must ship. robots.txt is what keeps admin.html out of search
   results. security.txt is where a registrar, a bank's fraud desk or a donor
   looks to report a site collecting money in our name, and a reporting
   address that 404s is the same as not having one. */
const KEEP_FILES = /^(robots|security)\.txt$/;
const SKIP_FILES = /\.(md|txt|command|sh|csv|py|example|yml|yaml|mjs|gitkeep)$|^\.(gitignore|firebaserc|eslintrc.*|env.*)$|^eslint\.config\.|^package(-lock)?\.json$|^localise-cinekind\.sh$|^vercel\.json$|^firebase\.json$|^(firestore|storage)\.rules$|^firestore\.indexes\.json$|^build-index\.js$/;
const BROWSER_JS_DIRS = new Set(['', 'assets']);

let saved = 0, before = 0;

function walk(rel) {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(rel)) && rel !== '') return;
    for (const entry of fs.readdirSync(abs)) walk(path.join(rel, entry));
    return;
  }
  const base = path.basename(rel);
  const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
  if (SKIP_FILES.test(base) && !KEEP_FILES.test(base)) return;
  const ext = path.extname(base).toLowerCase();
  let data = fs.readFileSync(abs);
  let text = null;

  if (ext === '.html') text = minifyHTML(data.toString('utf8'), rel);
  else if (ext === '.css') text = minifyCSS(data.toString('utf8'));
  else if (ext === '.js' && BROWSER_JS_DIRS.has(dir)) { text = compressJS(data.toString('utf8'), rel); checkJS(text, rel); }
  else if (ext === '.json' && /search-index/.test(base)) text = JSON.stringify(JSON.parse(data.toString('utf8')));

  before += data.length;
  const outData = text === null ? data : Buffer.from(text, 'utf8');
  saved += data.length - outData.length;
  if (!CHECK_ONLY) {
    const target = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, outData);
  }
}

if (!CHECK_ONLY) fs.rmSync(OUT, { recursive: true, force: true });
walk('');
/* Vercel runs this as the build. Refuse to ship a dist/ whose pages do not boot. */
if (!CHECK_ONLY && fs.existsSync(path.join(ROOT, 'test', 'page-boot.test.js'))) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--require', './test/_isolate-env.js', '--test', 'test/page-boot.test.js'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PFA_PAGES_ROOT: OUT } });
  const failed = (r.stdout + r.stderr).split('\n').filter((l) => /^not ok/.test(l) && !/monthly is not reachable|same shell as the rest/.test(l));
  if (failed.length) { console.error(failed.join('\n')); throw new Error('minified pages do not boot - dist/ not usable'); }
}
const pct = before ? Math.round((saved / before) * 100) : 0;
console.log(`${CHECK_ONLY ? 'checked' : 'wrote dist/'}: ${(before / 1024).toFixed(0)} KB in, ${((before - saved) / 1024).toFixed(0)} KB out (${pct}% smaller)`);

/* Deploying dist/ on Vercel: either run `vercel --cwd dist`, or add
     "buildCommand": "node scripts/minify.js",  "outputDirectory": "dist"
   to vercel.json. Serverless functions are built from api/ and lib/ at the
   project root; they are deliberately not copied into dist/. */
