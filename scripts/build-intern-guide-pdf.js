#!/usr/bin/env node
'use strict';

/* The interns' two-page guide as a PDF (owner, 4 Nov 2026: "for interns-
   have a quick guide on how to get started. 2 pages"): intern-guide.html,
   printed to A4 by a browser, into media/intern/PFA-intern-quick-start-guide.pdf.

   Run by hand after the guide's words change (npm run build:intern-guide);
   it needs Playwright, which the site's own build does not, so the PDF is
   kept in the repository. It refuses to write a guide that is not exactly
   two pages. */

const fs = require('fs');
const http = require('http');
const path = require('path');

/* global document */
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'media', 'intern', 'PFA-intern-quick-start-guide.pdf');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    return fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const { chromium } = require('playwright');
  const server = await serve();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/intern-guide.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pages !== 2) throw new Error(`The guide printed to ${pages} pages, not 2. Shorten it or tighten the print styles.`);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, pdf);
    console.log(`Wrote ${path.relative(ROOT, OUT)}: 2 pages, ${Math.round(pdf.length / 1024)} KB.`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
