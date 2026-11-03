'use strict';

/* events.html shipped a form written against class names the page did not
   define - .form, .error, .hint, .btn--full - so it rendered as a raw browser
   form. The wiring tests all passed, because they checked that the form sent
   data, not that it looked like part of the site.

   This checks the other half: every class used in the markup of a page exists
   in that page's own stylesheet. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const ROOT = path.join(__dirname, '..');
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

/* Classes that carry no styling by design. */
const EXEMPT = new Set([
  'current', 'is-bad', 'is-open', 'show', 'on', 'hidden', 'active', 'done',
  'pfa-slot', 'pfa-slot-frame', 'pfa-slot-empty',       // set up by script
  'pfa-footer__col'   // a grid child; its layout comes from .pfa-footer__links
]);

/* Only tokens that are valid CSS identifiers. Pages build markup by string
   concatenation - class="item' + (q ? ' has' : '') + '" - and taking every
   space-separated fragment turned quotes, brackets and operators into
   "undefined classes". */
const IDENTIFIER = /^-?[_a-zA-Z][\w-]*$/;

function classesUsed(html) {
  const body = html.replace(/<style[\s\S]*?<\/style>/g, '');
  const used = new Set();
  for (const m of body.matchAll(/\sclass="([^"]+)"/g)) {
    m[1].split(/\s+/).filter((c) => IDENTIFIER.test(c)).forEach((c) => used.add(c));
  }
  return used;
}

/* A page's own <style> blocks plus any local stylesheet it links -
   search.html styles .is-prompt in pfa-search.css, not inline. */
function classesDefined(html) {
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  for (const m of html.matchAll(/<link[^>]+href="([^":?]+\.css)(?:\?[^"]*)?"/g)) {
    const file = path.join(ROOT, m[1]);
    if (fs.existsSync(file)) css += '\n' + fs.readFileSync(file, 'utf8');
  }
  const defined = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  return defined;
}

test('sanity: the check finds classes at all', () => {
  const html = fs.readFileSync(path.join(ROOT, 'quiz.html'), 'utf8');
  assert.ok(classesUsed(html).size > 15, 'markup classes were found');
  assert.ok(classesDefined(html).size > 40, 'stylesheet classes were found');
});

test('no page uses a class it never defines', () => {
  const problems = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const defined = classesDefined(html);
    const missing = [...classesUsed(html)]
      .filter((c) => !defined.has(c))
      .filter((c) => !EXEMPT.has(c))

    if (missing.length) problems.push(`${page}: ${missing.join(', ')}`);
  }
  assert.deepEqual(problems, [], `markup styled by nothing:\n  ${problems.join('\n  ')}`);
});

test('the check is real: removing a rule fails it', () => {
  /* Guards the guard, after three tests this session passed while checking
     nothing. */
  const html = fs.readFileSync(path.join(ROOT, 'events.html'), 'utf8');
  const stripped = html.replace(/\.form\{[^}]*\}/g, '');
  const defined = classesDefined(stripped);
  assert.ok(classesUsed(html).has('form'), 'events.html does use .form');
  assert.equal(defined.has('form'), false, 'and the detector must notice when its rule is gone');
});
