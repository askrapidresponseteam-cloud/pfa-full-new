'use strict';

/* The site header, and everything it opens, is never covered by a page's own
   bars (owner, 8 Oct 2026: "cant have these kinda issues. anywhere on the
   site", with a screenshot of the About menu cut in half by the Wall's
   sticky tab bar, which sat at z-index 51 against the header's 50).

   The scale is written once, in assets/chrome.css:
     40        sticky and fixed page bars
     44        floating page buttons
     45        the search overlay
     49        the phone menu
     50        the header and its menus; the phone's tab bar
     60        the announcement bar
     70 and up things that cover the whole page on purpose (toasts, drawers,
               lightboxes, players)
   A page layer from 45 to 69 sits over the header's menus, the phone menu or
   the search box. This reads every stylesheet the public pages use and fails
   on one. Checked in a browser on 8 Oct 2026 too: every page, 1440, 1024 and
   390 wide, every menu open at eight scroll positions. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* The chrome's own layers, which define the scale. */
/* The phone's tab bar (22 Oct 2026) is chrome too: at the foot, at the
   header's own 50, where nothing of the header's ever opens. */
const CHROME = new Map([
  ['.pfa-search', 45], ['.mnav', 49], ['header.site', 50], ['html[data-pfa-tabs] .pfa-tabs', 50], ['.announce', 60]
]);
/* Pages with no site header: the reader and the panel have their own. */
const NO_HEADER = new Set(['read.html', 'admin.html', 'submission-collage.html', 'product.html']);

function sources() {
  const out = [];
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.html') && !NO_HEADER.has(x))) {
    const html = read(f);
    const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    out.push({ file: f, css });
  }
  for (const f of ['assets/chrome.css', 'pfa-search.css', 'assets/theatre.css', 'assets/library.css', 'assets/pfa-theme.css', 'assets/store-control.css']) {
    if (fs.existsSync(path.join(ROOT, f))) out.push({ file: f, css: read(f) });
  }
  return out;
}

function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    const body = m[2];
    const z = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/.exec(body);
    const pos = /(?:^|;)\s*position\s*:\s*(sticky|fixed|absolute|relative)/.exec(body);
    return { selector: m[1].trim().split('\n').pop().trim(), body, z: z ? Number(z[1]) : null, position: pos ? pos[1] : '' };
  }).filter((r) => r.z !== null);
}

test('no page bar sits between the page and the header: sticky and fixed layers are 44 or below, or 70 and up', () => {
  const bad = [];
  for (const { file, css } of sources()) {
    for (const r of rules(css)) {
      if (CHROME.has(r.selector)) continue;
      if (r.position === 'sticky' && r.z > 44) bad.push(`${file}: ${r.selector} is sticky at ${r.z}`);
      if (r.position === 'fixed' && r.z > 44 && r.z < 70) bad.push(`${file}: ${r.selector} is fixed at ${r.z}`);
    }
  }
  assert.deepEqual(bad, [], 'layers that would cover the header, its menus, the phone menu or the search box:\n  ' + bad.join('\n  '));
});

test('a page element above 44 that is not fixed lives inside a section that isolates it', () => {
  /* .arc__nav (achievements) is 300 so its arrows sit over the arc's own
     cards; .arc{isolation:isolate} keeps that 300 inside the arc. Anything
     new in this class must be added here with the container that holds it. */
  const ISOLATED = { 'achievements.html': { '.arc__nav': '.arc' } };
  const bad = [];
  for (const { file, css } of sources()) {
    const all = rules(css);
    for (const r of all) {
      if (CHROME.has(r.selector) || r.position === 'fixed' || r.z <= 44) continue;
      const holder = (ISOLATED[file] || {})[r.selector];
      if (!holder) { bad.push(`${file}: ${r.selector} at ${r.z} (${r.position || 'static'}) with no isolating container named`); continue; }
      const iso = new RegExp(`(^|[\\s,}])${holder.replace('.', '\\.')}\\s*\\{[^}]*isolation\\s*:\\s*isolate`);
      if (!iso.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) bad.push(`${file}: ${holder} no longer sets isolation:isolate, so ${r.selector} at ${r.z} can cover the header`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n  '));
});

test('the chrome itself keeps the scale it documents', () => {
  const css = rules(read('assets/chrome.css'));
  const z = (sel) => (css.find((r) => r.selector === sel) || {}).z;
  assert.equal(z('header.site'), 50);
  assert.equal(z('.mnav'), 49);
  assert.equal(z('.announce'), 60);
  assert.equal(rules(read('pfa-search.css')).find((r) => r.selector === '.pfa-search').z, 45);
  assert.match(read('assets/chrome.css'), /Stacking, for the whole site/, 'the scale is written down where the header is');
});

test("the Wall's tab bar sits under the header and still leaves one line when docked", () => {
  const wall = read('wall.html');
  const subnav = rules(wall).find((r) => r.selector === '.subnav');
  assert.ok(subnav && subnav.position === 'sticky' && subnav.z <= 44, `.subnav at ${subnav && subnav.z}`);
  assert.match(wall, /html\.wall-docked header\.site\{border-bottom-color:transparent/, 'the header drops its border while the bar is docked');
  assert.match(wall, /classList\.toggle\('wall-docked'/, 'and something sets that class');
});

test('jumping to any anchor lands below the header, and below a page bar where the page has one', () => {
  /* 8 Oct 2026: on seven pages a section opened from a link or a search
     result landed up to 179px under the header. */
  const chrome = read('assets/chrome.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(chrome, /:where\(\[id\]\)\{scroll-margin-top:calc\(var\(--ann,34px\) \+ var\(--nav,81px\) \+ \d+px\)\}/,
    'every id clears the announcement and the header');
  assert.match(read('shop.html'), /\.item\[id\]\{scroll-margin-top:calc\(var\(--ann\) \+ var\(--nav\) \+ (\d+)px\)\}/,
    "a product clears the shop's own filter bar too");
  assert.match(read('wall.html'), /section\[id\]\{scroll-margin-top:calc\(var\(--ann\) \+ var\(--nav\) \+ 44px\)\}/,
    "the Wall's sections clear its tab bar");
});
