#!/usr/bin/env node
/* Every stylesheet and script a page loads carries a fingerprint of the file
   as it ships (?v=<first ten of its sha256>), so a deploy can never pair a
   new page with an old style or script still held by a browser.

   Why (owner, 27 Nov 2026, of The Wall's "Share your video" drawn as an
   empty black box: "buttons cannot be black like this, anywhere. fix"):
   pages are served fresh (max-age=0) but assets/ may be kept an hour and
   then served stale for a day while the browser refreshes it. The new page
   asked for PFA's own buttons; the browser still held the old the-wall.css,
   which had no rule for them, so the button's words took the page's ink, on
   ink. chrome.css, chrome.js and the chat's files were already stamped; now
   every page's own files are too.

   Run on the copy that goes live (scripts/build-firebase.js runs it on site/),
   or on a folder:  node scripts/stamp-assets.js <dir>   */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REF = /(\b(?:href|src)=")(\/?)((?:\.\.\/)*(?:assets\/[\w./-]+|pfa-search|search-index)\.(?:css|js))(?:\?v=[a-f0-9]+)?(")/g;

function fingerprint(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

function pagesIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/* one page's HTML, stamped; a reference to a file that is not there is left as it is */
function stampHtml(html, pageFile, root) {
  const seen = new Map();
  return html.replace(REF, (all, attr, slash, ref, close) => {
    const file = slash ? path.join(root, ref) : path.resolve(path.dirname(pageFile), ref);
    if (!fs.existsSync(file)) return all;
    if (!seen.has(file)) seen.set(file, fingerprint(file));
    return `${attr}${slash}${ref}?v=${seen.get(file)}${close}`;
  });
}

function stampTree(root) {
  let pages = 0;
  let refs = 0;
  for (const page of pagesIn(root)) {
    const html = fs.readFileSync(page, 'utf8');
    const next = stampHtml(html, page, root);
    if (next !== html) {
      fs.writeFileSync(page, next);
      pages += 1;
      refs += (next.match(/\?v=[a-f0-9]{10}"/g) || []).length;
    }
  }
  return { pages, refs };
}

module.exports = { stampHtml, stampTree, fingerprint, REF };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'site'));
  const r = stampTree(dir);
  console.log(`stamped ${r.refs} stylesheet and script references on ${r.pages} pages in ${path.relative(process.cwd(), dir) || '.'}`);
}
