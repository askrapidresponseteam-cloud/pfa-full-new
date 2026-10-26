'use strict';

/* The panel and the API have to agree, and the way they stop agreeing is
   quietly: a query parameter the server never reads, a field the renderer
   wants under another name, a helper the panel calls that the renderer does
   not export. None of those show up as an error - the screen just comes back
   empty, or the card prints a hole.

   So these read admin.html as text and check the contract from both ends. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const script = panel.slice(panel.indexOf('<script>\n/* The panel.'));

/* Every /api/... string the panel builds, with its query stripped. */
function routesCalled() {
  return [...script.matchAll(/['"](\/api\/[a-z0-9/-]+)/gi)].map((m) => m[1]);
}

/* The query keys the panel appends for one route. */
function paramsFor(fragment) {
  const keys = new Set();
  for (const line of script.split('\n')) {
    if (!line.includes(fragment)) continue;
    for (const m of line.matchAll(/[?&]([a-z_]+)=/gi)) keys.add(m[1]);
  }
  return keys;
}

test('every route the panel calls is mounted', () => {
  const registered = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8');
  const unmounted = [...new Set(routesCalled())].filter((route) => {
    const key = route.replace(/^\/api\//, '');
    return !registered.includes(`'${key}'`);
  });
  assert.deepEqual(unmounted, [], `the panel calls routes nothing serves: ${unmounted.join(', ')}`);
});

test('the panel filters the registers with parameters the records route reads', () => {
  const records = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'admin', 'records.js'), 'utf8');
  const used = paramsFor('/api/admin/records');
  assert.ok(used.size > 0, 'the panel should be filtering something');
  const ignored = [...used].filter((key) => !new RegExp(`query\\.${key}\\b`).test(records));
  assert.deepEqual(ignored, [], `the server never reads these, so the filter would do nothing: ${ignored.join(', ')}`);
});

test('the payment outcomes the panel offers are ones the server can translate', () => {
  const records = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'admin', 'records.js'), 'utf8');
  const vocabulary = records.slice(records.indexOf('const PAYMENT_STATUSES'), records.indexOf('const PAYMENT_STATUSES') + 300);
  const select = panel.slice(panel.indexOf('id="payStatus"'), panel.indexOf('</select>', panel.indexOf('id="payStatus"')));
  const offered = [...select.matchAll(/value="([a-z-]+)"/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(offered.length >= 3, 'the outcome filter should offer several');
  const unknown = offered.filter((value) => !vocabulary.includes(`${value}:`));
  assert.deepEqual(unknown, [], `these are not names the server knows: ${unknown.join(', ')}`);
});

test('the panel asks for donations by purpose, which is what the filter is called', () => {
  assert.match(script, /type=payments&purpose=donate/, 'donations are payments filtered by purpose');
});

test('the case drawer only sends actions the case route accepts', () => {
  const route = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'admin', 'case.js'), 'utf8');
  const sent = [...new Set([...script.matchAll(/action: '([a-z-]+)'/g)].map((m) => m[1]))];
  const caseActions = sent.filter((a) => ['reply', 'note', 'assign', 'status'].includes(a));
  assert.equal(caseActions.length, 4, 'all four actions are wired');
  for (const action of caseActions) {
    assert.ok(route.includes(`action === '${action}'`), `case.js has no branch for ${action}`);
  }
});

test('the people page sends actions the people route accepts', () => {
  const route = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'admin', 'people.js'), 'utf8');
  for (const action of ['set', 'remove', 'reset']) {
    assert.match(script, new RegExp(`action: '${action}'`), `the panel never offers ${action}`);
    assert.ok(route.includes(`action === '${action}'`), `people.js has no branch for ${action}`);
  }
});

test('the panel calls only renderer helpers that the renderer exports', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'assets', 'caregiver-card.js'), 'utf8');
  const exported = new Set(
    [...renderer.slice(renderer.indexOf('window.PFACaregiverCard = {')).matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])
  );
  const called = [...new Set([...script.matchAll(/\bC\.(\w+)\(/g)].map((m) => m[1]))];
  assert.ok(called.length >= 5, `expected the panel to use the renderer, found ${called.length} calls`);
  const missing = called.filter((name) => !exported.has(name));
  assert.deepEqual(missing, [], `the panel calls helpers the renderer does not expose: ${missing.join(', ')}`);
});

test('a card is built from the fields the renderer reads, not the ones the register returns', () => {
  /* The register says issuedAt and keeps the PIN apart from the street; the
     card reads issuedOn and takes the address as lines. Getting this wrong
     prints a ghost date and a ghost address rather than failing. */
  const builder = script.slice(script.indexOf('function cardData('), script.indexOf('function cardsPane('));
  assert.match(builder, /issuedOn: row\.issuedAt/, 'the issue date must be translated');
  assert.match(builder, /row\.address, row\.pin/, 'the PIN belongs on the address');

  const fields = fs.readFileSync(path.join(ROOT, 'assets', 'card-fields.js'), 'utf8');
  const caregiver = fields.slice(fields.indexOf('function caregiver('), fields.indexOf('function caregiver(') + 2000);
  for (const key of ['cardId', 'name', 'address', 'mobile', 'email', 'issuedOn']) {
    assert.ok(builder.includes(`${key}:`), `cardData never supplies ${key}`);
    assert.ok(caregiver.includes(`data.${key}`), `card-fields does not read ${key}`);
  }
});

test('a preview is hydrated, so the photograph and the signature are drawn', () => {
  /* draw() neither completes the fields nor loads the images; hydrate() does
     both. A preview built straight from a register row shows neither. */
  assert.match(script, /C\.hydrate\(cardData\(row\)\)[\s\S]{0,200}C\.draw\(canvas, side, full/,
    'the preview must hydrate before it draws');
});

test('every section in the rail is one the module list knows', () => {
  const M = require('../lib/admin-modules.js');
  const known = new Set(M.MODULE_KEYS.concat(M.SUPER_ONLY));
  const tabs = [...panel.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  /* The rail was simplified to seven sections on 31 Aug 2026: Donations
     folded into Payments & donations, Issue and Verify into Colony cards,
     the Audit log into People & audit. Every folded section still has its
     pane, its registry entry and its module gate - a tab now opens a stack.
     Store orders left with the shop, so the rail is six. Website (what the
     public site shows) joined on 8 Oct 2026, so it is seven again. */
  /* Old site members joined on 26 Oct 2026, in a group of its own below
     the rest, marked "Kept apart". Membership cards joined the same day,
     after Colony cards. */
  assert.deepEqual(tabs, ['overview', 'submissions', 'volunteers', 'payments', 'caregivers', 'membership', 'website', 'people', 'oldmembers'],
    'the rail is the eight sections, in order, then the one kept apart');
  /* Applications to decide joined Colony cards, first, on 24 Oct 2026 */
  const stacks = /caregivers:[^}]*panes: \['apply', 'caregivers', 'verify', 'cards'\]/.test(script)
    && /payments:[^}]*panes: \['payments', 'donations'\]/.test(script)
    && /people:[^}]*panes: \['people', 'audit'\]/.test(script);
  assert.ok(stacks, 'each merged tab names the panes it stacks');
  assert.match(script, /HOMES = \{ donations: 'payments', cards: 'caregivers', verify: 'caregivers', apply: 'caregivers', audit: 'people' \}/,
    'old section names still land on the section that holds them');
  const registry = script.slice(script.indexOf('var TABS = {'), script.indexOf('function can(module)'));
  for (const tab of tabs) {
    assert.ok(new RegExp(`\\b${tab}:\\s*\\{`).test(registry), `${tab} is in the rail but not in the tab registry`);
    const spec = new RegExp(`\\b${tab}:\\s*\\{[^}]*needs: '([a-z]+)'`).exec(registry);
    assert.ok(spec, `${tab} does not say which module the API enforces`);
    assert.ok(known.has(spec[1]), `${tab} needs '${spec[1]}', which is not a module`);
  }
});

test('no preset hands out a module that no longer exists', () => {
  const M = require('../lib/admin-modules.js');
  const dead = [];
  M.PRESETS.forEach((preset) => {
    preset.modules.forEach((key) => { if (!M.MODULE_KEYS.includes(key)) dead.push(`${preset.key}: ${key}`); });
  });
  assert.deepEqual(dead, [], `presets naming removed modules: ${dead.join(', ')}`);
});

test('the audit collection is named in the database rules and is never client-written', () => {
  const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/adminAudit\/\{id\}\s*\{\s*allow read: if isAdmin\(\); allow write: if false; \}/);
});

test('Mark as printed and Mark as posted show the result: the card moves on a step, the message stays, every card is viewable', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /var cardFilter = 'unprinted'/, 'the sheet defaults to what is still to print');
  assert.match(html, /CARD_STEPS = \[\['unprinted', 'To print'\], \['unposted', 'To post'\], \['current', 'All current'\]\]/, 'to print, to post, and every card');
  assert.match(html, /cardsPane\(true\)/, 'the repaint after marking keeps the status line');
  assert.match(html, /'marked as posted\.' : 'marked as printed\.'/);
  assert.match(html, /data-printed="1"/, 'printed cards read as printed');
  const route = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes', 'admin', 'cards.js'), 'utf8');
  assert.match(route, /if \(filter === 'unprinted'\) return !printed;/);
  assert.match(route, /if \(filter === 'unposted'\) return printed && !row\.postedAt;/);
});
