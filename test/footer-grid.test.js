'use strict';

/* The footer.

   8 Oct 2026 (owner: "this can be better. alignment and look wise"): set on
   one grid. 9 Oct 2026 (owner: "footer looking nasty"): it had become a
   table, a hairline under every label, six equal columns that folded the
   address into three lines, and a gutter of its own (clamp(20px,5vw,84px))
   that sat 14px inside the page's and the header's at 1440.

   Now it stands on the page's gutter: the office (a little wider) and five
   link groups, each opened by the pop tick the page titles carry and a
   label, with no rules between them; the legal line closes it with the
   privacy policy. The same day it lost the bar that carried the name large
   with Report cruelty and Donate (owner, under a form: "pfa on top and again
   below.. looks confusing"): the header is where the name and the calls live. These hold the
   structure; the widths were measured in a browser from 1920 to 320: one
   gutter with the header at every width, no sideways scroll, no link
   wrapped above 375 wide, the social links on one line wherever the office
   is its own column at desktop width. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const FOOTER = fs.readFileSync(path.join(ROOT, 'assets', 'chrome-footer.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.css'), 'utf8');
const doc = new JSDOM(FOOTER).window.document;
const rule = (sel) => {
  const m = CSS.match(new RegExp(`(?:^|\\n|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

test('the name and the calls live in the header, not again at the foot', () => {
  assert.equal(doc.querySelector('.pfa-footer__bar, .pfa-footer__mark, .pfa-footer__acts, .pfa-footer__btn, img'), null, 'no second brand block');
  assert.equal(doc.querySelector('.pfa-footer').firstElementChild.className, 'pfa-footer__grid', 'the directory opens the footer');
  assert.doesNotMatch(CSS, /\.pfa-footer__(bar|mark|acts|btn|bird)\b/, 'no styles left for it');
  /* every link is a plain line in a list: no button to compete with the page above it */
  for (const a of doc.querySelectorAll('.pfa-footer a')) assert.ok(a.closest('ul, address, .pfa-footer__social, .pfa-footer__base'), `${a.textContent} stands outside the directory`);
  assert.equal(doc.querySelector('.pfa-footer [class*="btn"]'), null);
});

test('five groups in the header\'s order, then the office, each a heading and what it opens', () => {
  const cells = [...doc.querySelectorAll('.pfa-footer__grid > *')];
  assert.deepEqual(cells.map((c) => c.querySelector('.pfa-footer__label').textContent),
    ['Our Work', 'Learn', 'Get Involved', 'Give and partner', 'About', 'Registered office']);
  for (const c of cells) assert.equal(c.firstElementChild.className, 'pfa-footer__label', 'the heading comes first');
  /* the office is not a link group: the visibility rules hide a .pfa-footer__col left with no link */
  const office = cells[cells.length - 1];
  assert.equal(office.className, 'pfa-footer__office');
  assert.ok(office.querySelector('address#contact.pfa-footer__where'));
  /* the slim line under the headings: social media and the counter, then the legal line */
  const base = doc.querySelector('.pfa-footer__base');
  assert.ok(base.querySelector('#pfaTally[hidden] #pfaTallyOdo[aria-label="Visit counter"]'));
  assert.deepEqual([...base.querySelectorAll('.pfa-footer__social a')].map((a) => a.textContent), ['Instagram', 'Facebook', 'X', 'YouTube']);
  assert.equal(doc.querySelectorAll('.pfa-footer__social').length, 1, 'once');
  const group = (label) => [...doc.querySelector(`nav[aria-label="${label}"]`).querySelectorAll('a')].map((a) => a.textContent);
  assert.deepEqual(group('Get Involved'), ['Volunteer', 'Become a member', 'Colony caregiver card', 'PFA Campus', 'The Wall', 'Events', 'CineKind']);
  assert.deepEqual(group('Give and partner'), ['Donate', 'Make a gift', 'Plan a campaign', 'Leave a legacy', 'CSR partnerships', 'Shop']);
  assert.deepEqual(group('About'), ['Founder', 'Animal Care Centre', 'Careers', 'Contact']);
  assert.deepEqual([...doc.querySelectorAll('.pfa-footer__base p')].map((p) => p.textContent),
    ['People for Animals © 2026', 'Registered charity · All donations tax-deductible', 'Privacy policy']);
  assert.ok(doc.querySelector('.pfa-footer__base a[href="privacy.html"]'));
});

test('one gutter with the header and the page, one gap, labels without rules', () => {
  /* the page's own token, which the header uses; the fallback is the same formula */
  assert.match(rule('.pfa-footer'), /--ff-gutter:var\(--gutter,max\(clamp\(16px,4vw,72px\),\(100% - 1440px\) \/ 2\)\)/);
  assert.match(CSS, /header\.site\{[^}]*padding:0 var\(--gutter\)/);
  assert.match(rule('.pfa-footer__grid'), /grid-template-columns:repeat\(5,minmax\(0,1fr\)\) minmax\(0,1\.6fr\)/);
  assert.match(rule('.pfa-footer__grid'), /gap:36px var\(--ff-gap\)/);
  assert.doesNotMatch(rule('.pfa-footer__label'), /border/, 'no hairline under each label');
  assert.match(rule('.pfa-footer__label'), /white-space:nowrap/);
  /* no short red rule above each label: a dash-shaped mark reads as a long
     dash, which the owner's standing rule forbids anywhere on the site */
  assert.doesNotMatch(CSS, /\.pfa-footer__label::before\{/, 'no dash above the footer labels');
  /* the office's lines sit on the links' lines */
  assert.match(rule('.pfa-footer ul'), /font-size:13\.5px;line-height:1\.45/);
  assert.match(rule('.pfa-footer__where'), /font-style:normal;font-size:13\.5px;line-height:1\.45/);
  assert.match(rule('.pfa-footer ul a'), /padding:5px 0/);
  assert.match(rule('.pfa-footer__where div'), /padding:5px 0/);
});

test('three columns below 1440; on a phone one column, each group a row that opens', () => {
  /* owner, 21 Oct 2026: "THE FOOTER ON THE MOBILE SUCKS. SO LONG" */
  const at = (w) => (CSS.match(new RegExp(`@media \\(max-width:${w}px\\)\\{([\\s\\S]*?)\\n\\}`)) || [])[1] || '';
  assert.match(at(1439), /\.pfa-footer__grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  const phone = at(719);
  assert.match(phone, /\.pfa-footer__grid\{grid-template-columns:1fr;gap:0\}/);
  assert.match(phone, /\.pfa-footer\.is-folding \.pfa-footer__col ul\{display:none\}/, 'a group is closed until tapped');
  assert.match(phone, /\.pfa-footer\.is-folding \.pfa-footer__col\.is-open ul\{display:block;/);
  assert.match(phone, /\.pfa-footer ul a\{padding:7px 0\}/, 'finger-sized rows');
  assert.doesNotMatch(phone, /::after\{[^}]*height:1\.5px;[^}]*\}/, 'no lone minus sign: the mark is a plus that turns into a cross');
  const JS = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.js'), 'utf8');
  assert.match(JS, /foot\.classList\.add\('is-folding'\)/, 'folding only where the script can open the groups');
  assert.match(JS, /label\.setAttribute\('aria-expanded', String\(open\)\)/, 'and a screen reader hears open and closed');
});

test('the counter is one framed instrument, and the script turns the wheels by the height the stylesheet gives them', () => {
  assert.match(rule('.pfa-tally__odo'), /border:1px solid rgba\(17,17,17,\.2\);border-radius:3px/);
  assert.doesNotMatch(rule('.pfa-tally__d'), /border:|background:/, 'no box per digit');
  const h = rule('.pfa-tally__d').match(/height:([\d.]+)em/)[1];
  assert.match(CSS, new RegExp(`\\.pfa-tally__strip span\\{[^}]*height:${h.replace('.', '\\.')}em`));
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.js'), 'utf8');
  assert.match(js, new RegExp(`translateY\\(' \\+ \\(-d \\* ${h.replace('.', '\\.')}\\) \\+ 'em\\)'`));
});

/* Owner, 24 Oct 2026: "visit counter has a comma and some white band. fix
   that. comma isnt necessary". The comma had a narrow cell of its own,
   without the wheels' shading, which showed as a white band. */
test('the counter shows plain digits: no comma and no comma cell', () => {
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.js'), 'utf8');
  const tally = js.slice(js.indexOf('visit tally'), js.indexOf('Rows that scroll sideways'));
  assert.doesNotMatch(tally, /pfa-tally__sep|','/, 'no separator is built');
  assert.doesNotMatch(CSS, /pfa-tally__sep/, 'and none is styled');
  const group = new Function(`${/function group\(n\) \{[^\n]*\}/.exec(tally)[0]}; return group;`)();
  assert.equal(group(1170), '1170');
  assert.equal(group(1234567), '1234567');
});

test('every page the footer links to exists', () => {
  for (const a of doc.querySelectorAll('.pfa-footer a[href]')) {
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:|tel:)/.test(href)) continue;
    const file = href.split(/[?#]/)[0];
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${href} (${a.textContent}) points at a page that is not there`);
  }
});

/* Owner, 25 Oct 2026: "make footer cleaner.. like expand only if need be..
   right now .. just a load of things". */
test('on every screen the footer is folded: the headings, and one group open at a time when asked', () => {
  /* wide screens: the headings in one row, the open group's links in a line under it */
  assert.match(CSS, /\.pfa-footer\.is-folding \.pfa-footer__grid\{display:flex;flex-wrap:wrap;/);
  assert.match(CSS, /\.pfa-footer\.is-folding \.pfa-footer__col,\.pfa-footer\.is-folding \.pfa-footer__office\{display:contents\}/);
  assert.match(CSS, /\.pfa-footer\.is-folding \.pfa-footer__col ul,\.pfa-footer\.is-folding \.pfa-footer__where\{order:2;flex:0 0 100%;display:none\}/, 'closed until asked');
  assert.match(CSS, /\.pfa-footer\.is-folding \.pfa-footer__label\[aria-expanded="true"\]::after\{transform:rotate\(45deg\)\}/, 'a plus that turns into a cross');
  /* the script: every heading a button for the group it opens, and opening one closes the rest */
  const JS = fs.readFileSync(path.join(ROOT, 'assets', 'chrome.js'), 'utf8');
  const fold = JS.slice(JS.indexOf('The footer, folded'), JS.indexOf('what ends on a date'));
  assert.match(fold, /querySelectorAll\('\.pfa-footer__col, \.pfa-footer__office'\)/, 'the office folds too');
  assert.match(fold, /groups\.forEach\(function \(other\) \{ if \(other !== group\) set\(other, false\); \}\)/, 'one open at a time');
  assert.match(fold, /label\.setAttribute\('role', 'button'\)/);
  assert.match(fold, /label\.setAttribute\('aria-controls', list\.id\)/);
  assert.doesNotMatch(fold, /matchMedia/, 'on every screen, not only a phone');
  /* and in a browser: headings only, then one group */
  const dom = new JSDOM(`<!doctype html><body>${FOOTER}</body>`, { runScripts: 'outside-only' });
  dom.window.eval(fold.slice(fold.indexOf('(function () {'), fold.lastIndexOf('})();') + 5));
  const d = dom.window.document;
  if (d.readyState === 'loading') d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.ok(d.querySelector('.pfa-footer').classList.contains('is-folding'));
  const labels = [...d.querySelectorAll('.pfa-footer__label')];
  assert.ok(labels.every((l) => l.getAttribute('aria-expanded') === 'false'), 'everything closed to start');
  labels[2].click();
  assert.deepEqual(labels.filter((l) => l.getAttribute('aria-expanded') === 'true').map((l) => l.textContent), ['Get Involved']);
  labels[5].click();
  assert.deepEqual(labels.filter((l) => l.getAttribute('aria-expanded') === 'true').map((l) => l.textContent), ['Registered office'], 'opening one closes the other');
  labels[5].click();
  assert.ok(labels.every((l) => l.getAttribute('aria-expanded') === 'false'), 'and a second press closes it');
});
