'use strict';

/* Ready replies everywhere a reply is written (owner, 5 Nov 2026: "option to
   ask standard reply also should be there? everywhere."): one list, the
   record's own kind first and then the ones that fit anything; in the
   record drawer every section opens, on The Wall's cards, and a Reply on
   each register line. A blank in square brackets is never sent. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function load() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const window = { PFAAdmin: { $: () => null, esc, say() {} } };
  const document = { createElement: () => ({}), head: { appendChild() {} } };
  vm.runInNewContext(read('assets/admin-replies.js'), { window, document });
  return window.PFAReplies;
}

test('one list: the record\'s own replies first, then the ones that fit anything', () => {
  const R = load();
  const cg = R.list('PFA-CG-2026-00001').map((x) => x[1]);
  assert.equal(cg[0], 'Card approved, being printed');
  assert.ok(cg.includes('Ask for more detail') && cg.includes('Done, closing it'));
  const mem = R.list('PFA-MEM-2026-00004').map((x) => x[1]);
  assert.equal(mem[0], 'Welcome, card on its way');
  assert.ok(R.list('PFA-SHP-2026-00001').some((x) => x[1] === 'Order being packed'));
  assert.ok(R.list('PFA-S-2026-00001').some((x) => x[1] === 'Ask for a YouTube or Vimeo link'));
  /* a kind with none of its own still has the general ones */
  assert.equal(R.list('PFA-POD-2026-00001').map((x) => x[0]).join(), 'got,more,call,done');
  assert.match(R.options('PFA-CG-2026-00001'), /^<option value="">Start from a ready reply…<\/option><option value="cgprint">/);
  assert.equal(R.pick('PFA-CG-2026-00001', 'cgaddr')[1], 'Confirm the postal address');
  assert.equal(R.pick('PFA-MEM-2026-00001', 'cgaddr'), null);
});

test('every ready reply is plain, with no greeting or sign-off, and each blank is one the panel holds back', () => {
  const R = load();
  const kinds = ['PFA-CG', 'PFA-MEM', 'PFA-SHP', 'PFA-DON', 'PFA-S', 'PFA-V', 'PFA-J', 'PFA-VI', 'PFA-VP', 'PFA-CR', 'PFA-A', 'PFA-EV', 'PFA-CSR', 'PFA-U', 'PFA-PRV', 'PFA-Q'];
  for (const k of kinds) {
    const keys = new Set();
    for (const [key, label, text] of R.list(k + '-2026-00001')) {
      assert.ok(!keys.has(key), `${k}: ${key} once`); keys.add(key);
      assert.ok(label.length <= 40, label);
      assert.doesNotMatch(text + label, /[\u2013\u2014]|care[t]aker/i);
      assert.doesNotMatch(text, /^(Dear|Hi|Hello)\b|Regards|Warm wishes/);
      for (const b of text.match(/\[[^\]]*\]/g) || []) assert.ok(R.blanks.test(b), `${k}: ${b} is held back`);
    }
  }
  assert.ok(R.blanks.test('we need: [what is needed].'));
  assert.ok(!R.blanks.test('nothing left to fill'));
});

test('in every reply box: the record drawer, The Wall, and a Reply on each register line', () => {
  const admin = read('admin.html');
  assert.match(admin, /<script src="assets\/admin-replies\.js"><\/script>\n<script src="assets\/admin-wall\.js"><\/script>/);
  assert.match(read('scripts/build-firebase.js'), /'assets\/admin-replies\.js'/);
  const js = read('assets/admin-replies.js');
  assert.match(js, /start\.id = 'caseStart'/);
  assert.match(js, /insertBefore\(start, text\)/);
  /* held before Send reaches the panel's own handler */
  assert.match(js, /closest\('#caseSend'\)[\s\S]*BLANKS\.test\(text\.value\)[\s\S]*stopPropagation\(\)[\s\S]*\}, true\);/);
  assert.match(js, /window\.confirm\('Replace what is written with this ready reply\?'\)/);
  const wall = read('assets/admin-wall.js');
  assert.match(wall, /var R = window\.PFAReplies;/);
  assert.match(wall, /R\.blanks\.test\(text\)/);
  const reg = read('assets/admin-registers.js');
  assert.match(reg, /r\.email \? '<button type="button" class="rg-row" data-open-case="' \+ esc\(r\.id\) \+ '" data-reply-case>Reply<\/button>'/);
  assert.ok(fs.statSync(path.join(ROOT, 'admin.html')).size < 409600);
});
