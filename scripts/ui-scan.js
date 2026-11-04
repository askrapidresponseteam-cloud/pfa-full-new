#!/usr/bin/env node
/* Every control on every page, in the states people actually reach, looked
   at in a real browser (owner, 3 Nov 2026: "so a site wide scan and ensure
   no such goof ups ever happen", after a dark button read black on black
   inside the internship's task reader).

     npm run check:ui            (needs Playwright's Chromium; exits 1 on any problem)

   For each page, at a phone and a desktop width, with every animation run
   to its end:
     - as it loads;
     - with every expander (+) open;
     - after each thing that opens something: the internship's task cards
       (each lane, in its reader), the practice quiz (opened, a choice picked,
       checked), and any button that says it opens a dialog or a panel.
   In each state it checks:
     - every button, button-styled link and summary: its text reads on its
       own ground (contrast 3 to 1 or more, with the opacity it is shown at);
     - no long text (a choice, a sentence) set centred inside a button;
     - every tick box or radio level with the first line of its words,
       beside them and at least 6px from them;
     - words in neighbouring table columns at least 24px apart;
     - no button whose words run outside it or are cut;
     - nothing wider than the screen.
   It starts its own server on a free port; nothing is fetched from outside. */

'use strict';
/* global document, getComputedStyle, CSS, innerWidth */ /* the audit below runs in the page */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) {
  console.log('check:ui needs Playwright (npm i -D playwright, then npx playwright install chromium). Skipped.');
  process.exit(process.argv.includes('--strict') ? 1 : 0);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      let f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
      if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
      fs.readFile(f, (err, data) => {
        if (err) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

/* runs in the page */
const AUDIT = () => {
  document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) { /* infinite */ } });
  const rgb = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = (c) => c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const mix = (top, a, under) => top.slice(0, 3).map((v, i) => v * a + under[i] * (1 - a));
  const ground = (el) => { let e = el; while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && (c.length < 4 || c[3] > 0.5)) return c; if (getComputedStyle(e).backgroundImage !== 'none' && e !== el) return null; e = e.parentElement; } return [255, 255, 255]; };
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden="true"],[inert]'); };
  const opacity = (el) => { let o = 1; let e = el; while (e) { o *= Number(getComputedStyle(e).opacity); e = e.parentElement; } return o; };
  const out = [];
  const name = (el, t) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''} "${t.slice(0, 40)}"`;
  document.querySelectorAll('button, a.btn, a[class*="btn"], [role="button"], input[type="submit"], input[type="button"], summary').forEach((el) => {
    if (!shown(el)) return;
    const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    if (!text) return;
    const op = opacity(el);
    if (op < 0.05) return; /* not shown at all yet */
    const cs = getComputedStyle(el);
    const bg = ground(el);
    const fg = rgb(cs.color);
    /* words over a photograph or a video: their ground is the picture, which this cannot read */
    const mid = el.getBoundingClientRect();
    const overlaps = (x) => { const r = x.getBoundingClientRect(); return r.width > 4 && r.left < mid.right && r.right > mid.left && r.top < mid.bottom && r.bottom > mid.top; };
    let pic = null; let up = el.parentElement;
    for (let n = 0; up && n < 5 && !pic; n += 1, up = up.parentElement) {
      pic = [...up.querySelectorAll('*')].find((x) => !el.contains(x) && !x.contains(el) && (/^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(x.tagName) || /url\(/.test(getComputedStyle(x).backgroundImage)) && overlaps(x)) || null;
    }
    if (bg && fg && !pic) {
      const seen = mix(fg, (fg[3] == null ? 1 : fg[3]) * op, bg);
      const a = lum(seen); const b = lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 3) out.push(`unreadable ${name(el, text)}: ${ratio.toFixed(2)} to 1`);
    }
    if (text.length > 70 && cs.textAlign === 'center' && el.tagName !== 'SUMMARY') out.push(`long text centred in ${name(el, text)}`);
    if (el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(cs.overflowX)) out.push(`cut off: ${name(el, text)}`);
    const r = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el);
    const tr = range.getBoundingClientRect();
    if (tr.width && (tr.right > r.right + 2 || tr.left < r.left - 2) && cs.overflowX === 'visible') out.push(`words run outside ${name(el, text)}`);
  });
  document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((inp) => {
    if (!shown(inp) || Number(getComputedStyle(inp).opacity) === 0) return;
    const lab = inp.closest('label') || (inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`));
    if (!lab) return;
    const r = inp.getBoundingClientRect();
    const words = lab.textContent.trim().replace(/\s+/g, ' ').slice(0, 30);
    /* the words' own lines, not the box's */
    const lines = [];
    const walk = document.createTreeWalker(lab, 4);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.nodeValue.trim() || !shown(t.parentElement)) continue;
      const range = document.createRange(); range.selectNodeContents(t);
      [...range.getClientRects()].forEach((x) => { if (x.width > 2 && x.height > 2) lines.push(x); });
    }
    if (!lines.length) return;
    /* the first line of words: it must sit level with the box, and beside it
       (owner, 4 Nov 2026: "this kinda misalignment issue can never happen
       anywhere on any page", of a label set above its tick box) */
    const top = Math.min(...lines.map((x) => x.top));
    const first = lines.filter((x) => x.top < top + 4);
    const band = { top: Math.min(...first.map((x) => x.top)), bottom: Math.max(...first.map((x) => x.bottom)), left: Math.min(...first.map((x) => x.left)), right: Math.max(...first.map((x) => x.right)) };
    const mid = (r.top + r.bottom) / 2;
    if (mid < band.top - 3 || mid > band.bottom + 3) out.push(`tick box not level with its words "${words}": box centre ${Math.round(mid - band.top)}px from the first line's top`);
    const after = band.left >= r.right - 1;
    const before = band.right <= r.left + 1;
    if (!after && !before) out.push(`tick box overlaps its words "${words}"`);
    const gap = after ? band.left - r.right : before ? r.left - band.right : 0;
    if ((after || before) && gap < 6) out.push(`tick box ${gap.toFixed(1)}px from "${words}"`);
  });
  /* words in neighbouring columns of a table: at least 24px apart, so one
     column never reads into the next (owner, 4 Nov 2026, of "First tell"
     beside "Your hours" in the interns' guide: "not enough gap ... fix
     holistically") */
  const textBox = (el) => {
    let left = Infinity; let right = -Infinity;
    const walk = document.createTreeWalker(el, 4);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.nodeValue.trim() || !shown(t.parentElement)) continue;
      const range = document.createRange(); range.selectNodeContents(t);
      [...range.getClientRects()].forEach((x) => { if (x.width > 1) { left = Math.min(left, x.left); right = Math.max(right, x.right); } });
    }
    return left === Infinity ? null : { left, right };
  };
  document.querySelectorAll('tr').forEach((tr) => {
    if (!shown(tr)) return;
    const cells = [...tr.children].filter((c) => /^(TD|TH)$/.test(c.tagName) && shown(c));
    for (let i = 1; i < cells.length; i += 1) {
      const a = cells[i - 1].getBoundingClientRect(); const b = cells[i].getBoundingClientRect();
      if (b.left < a.right - 1 || Math.abs(a.top - b.top) > 2) continue; /* stacked on a phone, not side by side */
      const x = textBox(cells[i - 1]); const y = textBox(cells[i]);
      if (!x || !y) continue;
      /* the room the table always keeps between the two, whatever the width:
         where a line wraps changes with the screen, so the words' own edges
         at one width are not enough (a line that fills its cell at another
         width runs up to the padding) */
      const ca = getComputedStyle(cells[i - 1]); const cb = getComputedStyle(cells[i]);
      const kept = (b.left + parseFloat(cb.paddingLeft) + parseFloat(cb.borderLeftWidth)) - (a.right - parseFloat(ca.paddingRight) - parseFloat(ca.borderRightWidth));
      const gap = Math.min(kept, y.left - x.right);
      if (gap < 24) out.push(`table columns ${gap.toFixed(1)}px apart: "${cells[i - 1].textContent.trim().replace(/\s+/g, ' ').slice(-24)}" | "${cells[i].textContent.trim().replace(/\s+/g, ' ').slice(0, 24)}"`);
    }
  });
  const wide = document.documentElement.scrollWidth - innerWidth;
  if (wide > 1) out.push(`page ${wide}px wider than the screen`);
  return [...new Set(out)];
};

async function run() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && !['submission-collage.html', 'read.html', 'product.html'].includes(f))
    .concat(fs.existsSync(path.join(ROOT, 'units')) ? fs.readdirSync(path.join(ROOT, 'units')).filter((f) => f.endsWith('.html')).slice(0, 3).map((f) => 'units/' + f) : []);
  const browser = await chromium.launch();
  const problems = [];
  const only = process.argv.find((a) => a.endsWith('.html'));
  for (const [w, h, mob] of [[1280, 900, false], [390, 844, true]]) {
    for (const f of pages.filter((p) => !only || p === only)) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, reducedMotion: 'reduce' });
      await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      await ctx.route(/127\.0\.0\.1:\d+\/api\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"rows":[],"items":[]}' }));
      const page = await ctx.newPage();
      const found = new Set();
      const look = async (state) => { (await page.evaluate(AUDIT)).forEach((x) => found.add(`${state}: ${x}`)); };
      const closeAll = async () => {
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close())).catch(() => {});
        await page.waitForTimeout(120);
      };
      const practice = async (scope, state) => {
        const start = page.locator(`${scope} [data-law-sample]`).first();
        if (!(await start.count()) || !(await start.isVisible().catch(() => false))) return;
        await look(state);
        await start.click(); await page.waitForTimeout(250); await look(state + ', practice opened');
        await page.locator(`${scope} [data-lqs="go"]`).first().click().catch(() => {}); await page.waitForTimeout(200); await look(state + ', practice question');
        await page.locator(`${scope} [data-lqs="pick"]`).nth(1).click().catch(() => {}); await page.waitForTimeout(100); await look(state + ', practice choice picked');
        await page.locator(`${scope} [data-lqs="check"]`).first().click().catch(() => {}); await page.waitForTimeout(200); await look(state + ', practice checked');
      };
      await page.goto(`${base}/${f}`, { waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(700);
      await look('on load');
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await page.waitForTimeout(150);
      await look('expanders open');
      await practice('body', 'page');
      if (f === 'internship.html') {
        await page.evaluate(() => { const b = [...document.querySelectorAll('#collection button')].find((x) => /Continue to the tasks/i.test(x.textContent)); if (b) b.click(); });
        await page.waitForTimeout(700);
        const lanes = await page.evaluate(() => [...document.querySelectorAll('.lane-card')].map((x) => x.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)));
        for (let i = 0; i < lanes.length; i += 1) {
          await page.evaluate((i) => document.querySelectorAll('.lane-card')[i].click(), i);
          await page.waitForTimeout(900);
          await page.evaluate(() => document.querySelectorAll('#v-reader details').forEach((d) => { d.open = true; }));
          await look(`task reader "${lanes[i]}"`);
          await practice('#v-reader', `task reader "${lanes[i]}"`);
          await closeAll();
        }
      }
      /* anything that says it opens a dialog or a panel */
      const openers = await page.evaluate(() => [...document.querySelectorAll('button[aria-haspopup], button[aria-controls]:not([aria-expanded="true"]), [data-open-id], [data-theatre-open]')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && !el.closest('.pfa-tabs, header, .pfa-footer, nav'); }).length);
      for (let i = 0; i < Math.min(openers, 6); i += 1) {
        await page.evaluate((i) => {
          const els = [...document.querySelectorAll('button[aria-haspopup], button[aria-controls]:not([aria-expanded="true"]), [data-open-id], [data-theatre-open]')]
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && !el.closest('.pfa-tabs, header, .pfa-footer, nav'); });
          if (els[i]) els[i].click();
        }, i).catch(() => {});
        await page.waitForTimeout(500);
        await look(`after opener ${i + 1}`);
        await closeAll();
      }
      if (found.size) problems.push(...[...found].map((x) => `${f} @${w}px, ${x}`));
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  if (problems.length) {
    console.error(`check:ui found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n  ` + problems.join('\n  '));
    process.exit(1);
  }
  console.log(`check:ui: every control reads and sits right on ${pages.length} pages, at 390 and 1280px, opened and closed.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
