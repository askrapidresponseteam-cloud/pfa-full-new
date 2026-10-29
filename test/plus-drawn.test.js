'use strict';

/* Owner, 28 Oct 2026, of the panel's "+" boxes: "+mark isnt perfectly
   centered. fix it. across admin and end user site it the issue exists. any
   and all such alignment issues". A typed + sits where the font puts it, a
   pixel or so off the middle of its box, and a box turned 45 degrees to make
   an x becomes a diamond. Every + on the panel and the site is drawn: two 1px
   bars in a box of odd size, so both land on whole pixels at the centre. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'public', 'functions', 'dist', '_inline-extracts', '.git']);
function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) files(f, out);
    else if (/\.(html|css)$/.test(e.name)) out.push(f);
  }
  return out;
}

test('no + or x mark is typed into a box anywhere: they are drawn', () => {
  const typed = [];
  for (const f of files(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    if (/content:\s*(["'])(\+|\\0*2b|×|\\0*d7|✕|\\0*2715)\1/i.test(src)) typed.push(path.relative(ROOT, f));
  }
  assert.deepEqual(typed, []);
});

test('the panel\'s + boxes are drawn on whole pixels, and open they are an x drawn in place, not a diamond', () => {
  const html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  for (const [sel, open, box, bar] of [
    ['.pend__list summary::before', '.pend__list[open] summary::before', 21, 9],
    ['button.parts::before', 'button.parts[aria-expanded="true"]::before', 19, 9],
    ['details.fold > summary::before', 'details.fold[open] > summary::before', 23, 11],
    ['.ap details summary::before', '.ap details[open] summary::before', 19, 9]
  ]) {
    const rule = html.slice(html.indexOf(sel + '{'), html.indexOf('}', html.indexOf(sel + '{')));
    assert.match(rule, new RegExp(`width:${box}px;height:${box}px;border:1px solid`), sel);
    assert.ok((box - 2 - bar) % 2 === 0 && (box - 2 - 1) % 2 === 0, `${sel}: the bars land on whole pixels`);
    assert.ok(rule.includes(`center/${bar}px 1px no-repeat,linear-gradient(currentColor,currentColor) center/1px ${bar}px no-repeat`), sel);
    const openRule = html.slice(html.indexOf(open + '{'), html.indexOf('}', html.indexOf(open + '{')));
    assert.ok(openRule.includes(`linear-gradient(45deg,`) && openRule.includes(`linear-gradient(-45deg,`) && openRule.includes(`center/${bar}px ${bar}px no-repeat`) && !/rotate/.test(openRule), `${open}: an x drawn about the centre, never a turned box`);
  }
});
