'use strict';

/* The panel's side: the Website section (owner, 8 Oct 2026: a simple
   Visible / Hidden toggle for every page and section of the public site), and
   the case drawer's act(), which must hold the button that asked until the
   answer comes, send a request id with a reply (CONTRACT 3), redraw from the
   case in the answer, and empty the reply box once a reply has gone.

   admin.html is read as text, and the case drawer's functions are taken out
   of it and run against stand-ins, so what is tested is the code the panel
   runs. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const script = panel.slice(panel.indexOf('<script>\n/* The panel.'));

/* One function's source, by name, its braces counted. */
function grab(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start > -1, `admin.html has no function ${name}`);
  let depth = 0;
  for (let i = script.indexOf('{', start); i < script.length; i += 1) {
    if (script[i] === '{') depth += 1;
    if (script[i] === '}') { depth -= 1; if (!depth) return script.slice(start, i + 1) + '\n'; }
  }
  throw new Error(`unbalanced ${name}`);
}

/* ---- the Website section ------------------------------------------------- */

test('the rail has a Website section, gated by the Website module, and it reads and writes /api/admin/site', () => {
  const tabs = [...panel.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  /* Old site members (26 Oct 2026) sits after the seven, in a group of its own */
  assert.deepEqual(tabs, ['overview', 'submissions', 'volunteers', 'payments', 'caregivers', 'website', 'people', 'oldmembers']);
  assert.match(script, /website:\s*\{ title: 'Website',\s*module: 'website',\s*needs: 'website' \}/);
  assert.match(panel, /<div class="pane" data-pane="website"/);
  assert.match(script, /if \(tab === 'website'\) return website\(\);/);
  assert.match(grab('website'), /api\('\/api\/admin\/site'\)/);
  assert.match(grab('setVisible'), /api\('\/api\/admin\/site', \{ method: 'POST', body: \{ kind: kind, id: id, visible: visible \} \}\)/);
  assert.match(grab('showEverything'), /body: \{ changes: changes \}/);
  const M = require('../lib/admin-modules.js');
  assert.ok(M.MODULE_KEYS.includes('website'));
});

test('each page and section is drawn with a Visible / Hidden toggle; a locked page says why; a save says it is live', () => {
  const toggle = grab('siteToggle');
  assert.match(toggle, />Visible<\/button>/);
  assert.match(toggle, />Hidden<\/button>/);
  assert.match(toggle, /aria-pressed="' \+ String\(!hidden\)/);
  assert.match(toggle, /if \(locked\) return '<span class="flag">Always shown<\/span>'/);
  const paint = grab('paintSite');
  assert.match(paint, /\(p\.locked \? '<span class="detail">' \+ esc\(p\.locked\)/, 'the reason a page is locked is shown');
  assert.match(paint, /siteToggle\('module', m\.key, m\.label, partOff, p\.partsLocked\)/, 'sections nested under their page');
  assert.match(paint, /site\.groups/, 'grouped as the site’s menus group them');
  assert.match(paint, /siteMark\('page:' \+ p\.id\)/, 'who changed each one last');
  assert.match(paint, /siteLast\(st\)/, 'and the last change of all');
  assert.match(paint, /still in the page\\u2019s source/, 'the panel says hidden is not removed');
  assert.match(grab('setVisible'), /'Saved\. Live on the site within a few seconds\.'/);
  /* the dashboard's module tags stay exactly five (test/admin-access.test.js) */
  assert.equal((panel.match(/data-module="/g) || []).length, 5);
});

test('the Website section draws from an answer the route really gives', () => {
  /* paintSite, siteToggle, siteMark and siteLast against a real GET's shape. */
  const nodes = {};
  const pane = { innerHTML: '', querySelector: () => null };
  const ctx = {
    site: null, SHOWN: { visible: 'Visible', hidden: 'Hidden' },
    $: (sel) => (sel === '[data-pane="website"]' ? pane : (nodes[sel] = nodes[sel] || { textContent: '' })),
    esc: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    when: (v) => (v ? 'today' : '-'), on: () => {}, showEverything: () => {}, say: (node, text) => { node.textContent = text; }, String, Boolean, Object
  };
  vm.createContext(ctx);
  vm.runInContext(grab('siteMark') + grab('siteToggle') + grab('siteLast') + grab('paintSite'), ctx);
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'site-modules.json'), 'utf8'));
  const V = require('../lib/site-visibility.js');
  ctx.site = {
    groups: reg.groups,
    pages: reg.pages.map((p) => ({ id: p.id, file: p.file, title: p.title, group: p.group, menu: p.menu, locked: V.lockOf('page', p.id),
      partsLocked: Boolean(V.LOCKED[p.id] && V.LOCKED[p.id].parts), modules: p.modules.map((m) => ({ id: m.id, key: `${p.id}#${m.id}`, label: m.label })) })),
    state: { version: 2, hidden: { pages: { units: true }, modules: { 'laws#part-a': true } },
      marks: { 'page:units': { visible: false, by: 'asha@pfa.test', at: '2026-10-08T09:00:00.000Z' } },
      updatedAt: '2026-10-08T09:00:00.000Z', updatedBy: { email: 'asha@pfa.test', name: 'Asha' },
      last: [{ kind: 'page', id: 'units', label: 'Units (units.html)', from: 'visible', to: 'hidden' }] }
  };
  vm.runInContext('paintSite()', ctx);
  const html = pane.innerHTML;
  assert.match(html, /<p class="lab">Our Work<\/p>/);
  assert.match(html, /data-vis="page" data-id="units" data-to="0" aria-pressed="true">Hidden/, 'units shows as hidden');
  assert.match(html, /data-vis="module" data-id="laws#part-a" data-to="0" aria-pressed="true">Hidden/);
  assert.match(html, /data-vis="module" data-id="laws#part-b" data-to="1" aria-pressed="true">Visible/);
  assert.match(html, /Hidden with its page\./, 'a page’s sections say so while the page is hidden');
  assert.match(html, /Hidden by asha@pfa\.test/);
  assert.match(html, /Last change: Units \(units\.html\), Visible to Hidden, by Asha, today\./);
  assert.ok(html.includes(ctx.esc(V.LOCKED.track.reason)), 'track says why it is always shown');
  assert.ok(!/data-vis="page" data-id="(index|track|search)"/.test(html), 'and has no toggle');
  assert.match(html, /id="siteAll">Show everything again/);
  assert.equal(nodes['#paneNote'].textContent, '2 things hidden');
});

/* ---- the case drawer's act() -------------------------------------------- */

function drawer() {
  const els = {
    '#caseText': { value: '' }, '#caseSay': { textContent: '' },
    '#caseSend': { disabled: false }, '#caseStatus': { disabled: false, value: '' }, '#caseAssign': { disabled: false }, '#caseWall': { disabled: false }
  };
  const calls = [];
  const said = [];
  const drawn = [];
  let answer = null;
  const ctx = {
    $: (sel) => els[sel],
    say: (node, text, tone) => { said.push([text, tone || '']); },
    api: (url, opts) => {
      calls.push({ url, body: JSON.parse(JSON.stringify(opts.body)), sendDisabled: els['#caseSend'].disabled, statusDisabled: els['#caseStatus'].disabled });
      return new Promise((resolve, reject) => { answer = { resolve, reject }; });
    },
    /* the real drawCase empties the reply box when it draws */
    drawCase: (c) => { drawn.push(c); els['#caseText'].value = ''; },
    fill: () => {}, overview: () => {}, can: () => false, current: 'submissions',
    openCase: { reference: 'PFA-C-2026-00042' }, caseMode: 'reply',
    window: { crypto: require('node:crypto').webcrypto }, Uint8Array, Array, Math, String, JSON, Promise
  };
  vm.createContext(ctx);
  vm.runInContext(grab('requestId') + grab('act') + grab('sendCase'), ctx);
  const settle = () => new Promise((r) => setImmediate(r));
  return { els, calls, said, drawn, ctx, settle, answer: () => answer };
}

test('Send is held down while the reply is in flight, carries a fresh request id each press, and redraws from the answer', async () => {
  const d = drawer();
  d.els['#caseText'].value = 'Thank you. A volunteer is on the way.';
  d.ctx.sendCase();
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].url, '/api/admin/case');
  assert.equal(d.calls[0].body.action, 'reply');
  assert.equal(d.calls[0].sendDisabled, true, 'the button is held before the request leaves');
  assert.match(d.calls[0].body.requestId, /^r-[0-9a-f]{32}$/);
  assert.ok(d.calls[0].body.requestId.length <= 80, 'within the 80 characters the server takes');
  assert.equal(d.els['#caseSend'].disabled, true, 'and stays held while it is in flight');
  const theCase = { reference: 'PFA-C-2026-00042', status: 'in-progress' };
  d.answer().resolve({ ok: true, case: theCase });
  await d.settle();
  assert.deepEqual(d.drawn, [theCase], 'the drawer is drawn from the case in the answer');
  assert.equal(d.els['#caseSend'].disabled, false, 'free again once the answer is in');
  assert.equal(d.els['#caseText'].value, '', 'the reply box is empty after a reply went');
  assert.deepEqual(d.said[d.said.length - 1], ['Reply sent.', 'good']);

  /* the next press is a new reply, with a new id */
  d.els['#caseText'].value = 'And one more thing.';
  d.ctx.sendCase();
  assert.notEqual(d.calls[1].body.requestId, d.calls[0].body.requestId);
  /* an answer without the case (before engineer 2's change) still empties the box */
  d.answer().resolve({ ok: true });
  await d.settle();
  assert.equal(d.els['#caseText'].value, '');
  assert.equal(d.drawn.length, 1);
});

test('a repeat the server recognised is said plainly, and a failure frees the button and keeps the text', async () => {
  const d = drawer();
  d.els['#caseText'].value = 'Draft that must not be lost.';
  d.ctx.sendCase();
  d.answer().resolve({ ok: true, duplicate: true, case: { reference: 'PFA-C-2026-00042' } });
  await d.settle();
  assert.match(d.said[d.said.length - 1][0], /already gone; it was not sent again/);

  d.els['#caseText'].value = 'Draft that must not be lost.';
  d.ctx.sendCase();
  d.answer().reject(new Error('That could not be sent.'));
  await d.settle();
  assert.equal(d.els['#caseSend'].disabled, false);
  assert.equal(d.els['#caseText'].value, 'Draft that must not be lost.');
  assert.deepEqual(d.said[d.said.length - 1], ['That could not be sent.', 'bad']);
});

test('a note has no request id; a status move holds its own list and keeps what is being typed', async () => {
  const d = drawer();
  d.ctx.caseMode = 'note';
  d.els['#caseText'].value = 'Called the reporter.';
  d.ctx.sendCase();
  assert.equal(d.calls[0].body.action, 'note');
  assert.equal(d.calls[0].body.requestId, undefined, 'only a reply carries one');
  d.answer().resolve({ ok: true, case: { reference: 'PFA-C-2026-00042' } });
  await d.settle();
  assert.equal(d.els['#caseText'].value, '', 'a note that went is cleared too');

  d.els['#caseText'].value = 'A reply half written';
  d.ctx.act({ reference: 'PFA-C-2026-00042', action: 'status', status: 'handled' }, 'Moved.', d.els['#caseStatus']);
  assert.equal(d.calls[1].statusDisabled, true, 'the Move to list is held');
  d.answer().resolve({ ok: true, case: { reference: 'PFA-C-2026-00042', status: 'handled' } });
  await d.settle();
  assert.equal(d.els['#caseStatus'].disabled, false);
  assert.equal(d.els['#caseText'].value, 'A reply half written', 'a status move does not throw away a draft');
  /* every caller passes what asked */
  assert.match(script, /action: 'assign', to: \$\('#caseAssign'\)\.value \}, 'Assigned\.', \$\('#caseAssign'\)\)/);
  assert.match(script, /: \(on \? 'Taken off the wall\.' : 'On the wall\.'\), \$\('#caseWall'\)\)/);
  assert.match(script, /action: 'status', status: \$\('#caseStatus'\)\.value \}, 'Moved\.', \$\('#caseStatus'\)\)/);
});
