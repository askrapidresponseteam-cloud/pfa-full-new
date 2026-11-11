'use strict';

/* People, each counted once, and where they are (owner, 11 Nov 2026: "look
   at the count. why is there discrepancy. i need it to be accurate. also
   see if you can tell it was opened from which state. like same person
   opened cannot count as unique"; the footer to show unique visitors). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const A = require('../lib/analytics');
const G = require('../lib/ip-geo');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-11-11T06:30:00Z');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

test('the state and country of an address, from the bundled database, approximate and never kept', () => {
  assert.equal(G.lookup('8.8.8.8').country, 'US');
  const ka = G.lookup('1.186.0.1');
  assert.equal(ka.country, 'IN');
  assert.match(ka.region, /^[A-Z]{2}$/);
  assert.equal(G.lookup('2409:4071:2000::1').country, 'IN', 'IPv6, as Jio and Airtel phones mostly are');
  assert.equal(G.lookup('::ffff:8.8.8.8').country, 'US', 'an IPv4 address written as IPv6');
  assert.deepEqual(G.lookup('10.0.0.1'), { country: '', region: '' });
  assert.deepEqual(G.lookup('not an address'), { country: '', region: '' });
  assert.match(G.source(), /^DB-IP IP to City Lite/);
  /* a header the host sets wins over the database */
  assert.deepEqual(A.placeOf({ 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'TN' }, '8.8.8.8'), { country: 'IN', region: 'TN' });
  assert.deepEqual(A.placeOf({ 'x-appengine-country': 'IN', 'x-appengine-region': 'ka' }, ''), { country: 'IN', region: 'KA' });
  assert.deepEqual(A.placeOf({}, '8.8.8.8'), { country: 'US', region: '' });
  /* the route passes the address in and writes no address anywhere */
  const route = read('lib/routes/analytics.js');
  assert.match(route, /A\.readHit\(await bodyOf\(request\), request\.headers \|\| \{\}, nowMs, \{ ip \}\)/);
  const writes = A.writesFor(A.readHit({ p: '/', n: 1 }, { 'user-agent': UA }, NOW, { ip: '1.186.0.1' }), (n) => n);
  assert.ok(!JSON.stringify(writes).includes('1.186'), 'no address in what is written');
});

test('a visit says when this browser was last here; a first visit, or nonsense, is new', () => {
  assert.equal(A.previousOf('', NOW), 'new');
  assert.equal(A.previousOf('2026-11-03', NOW), '2026-11-03');
  assert.equal(A.previousOf('2026-11-12', NOW), 'new', 'a day to come is not a day');
  assert.equal(A.previousOf('2024-01-01', NOW), 'old');
  assert.equal(A.previousOf('<script>', NOW), 'new');
  const hit = A.readHit({ p: '/laws.html', n: 1, lv: '2026-11-03' }, { 'user-agent': UA, 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'KA' }, NOW);
  assert.equal(hit.previous, '2026-11-03');
  assert.deepEqual(A.writesFor(hit, (n) => n).main.u, { '2026-11-03|KA': 1 });
  const later = A.readHit({ p: '/laws.html', n: 0, lv: '2026-11-03' }, { 'user-agent': UA }, NOW);
  assert.equal(A.writesFor(later, (n) => n).main.u, undefined, 'only a visit\'s first page counts a person');
});

test('in any period, each person once: a returning person is not counted again, the same day or another', () => {
  const days = A.daysBetween('2026-11-09', '2026-11-11');
  const docs = [
    /* the 9th: three new people, one back from October */
    { visits: 4, views: 9, u: { 'new|KA': 2, 'new|*US': 1, '2026-10-20|DL': 1 } },
    /* the 10th: two of the 9th's back (counted already), one new */
    { visits: 3, views: 5, u: { '2026-11-09|KA': 2, 'new|TN': 1 } },
    /* the 11th: one back the same day, one from a year before, one unplaced */
    { visits: 3, views: 4, u: { '2026-11-11|TN': 1, 'old|KA': 1, 'new|': 1 } }
  ];
  const s = A.summarise(days, docs);
  assert.equal(s.visits, 10);
  assert.equal(s.people, 7, '2 + 1 + 1 on the 9th, 1 on the 10th, 1 old and 1 unplaced on the 11th');
  assert.equal(s.newPeople, 5);
  assert.deepEqual(s.peopleStates.map((x) => [x.key, x.n]), [['KA', 3], ['DL', 1], ['TN', 1]]);
  assert.deepEqual(s.peopleAbroad.map((x) => [x.label, x.n]), [['US', 1]]);
  assert.equal(s.peopleUnknown, 1);
  assert.equal(s.peopleFrom, '2026-11-09');
  /* the 10th alone: the two back from the 9th are people in that day */
  const one = A.summarise(['2026-11-10'], [docs[1]]);
  assert.equal(one.people, 3);
});

test('the footer and the panel are one count of people', () => {
  assert.match(read('lib/routes/visits.js'), /const DOC = 'counters\/uniques';/);
  assert.doesNotMatch(read('lib/routes/visits.js'), /increment/, 'the footer adds nothing itself');
  const route = read('lib/routes/analytics.js');
  assert.match(route, /if \(hit\.visit && hit\.previous === 'new'\) jobs\.push\(db\.doc\(PEOPLE\)\.set\(\{ total: inc\(1\)/);
  const chrome = read('assets/chrome.js');
  assert.match(chrome, /window\.localStorage\.getItem\('pfa_last_visit'\)/);
  assert.match(chrome, /lv: last/);
  assert.match(chrome, /fetch\('\/api\/visits', \{ method: 'GET'/);
  assert.doesNotMatch(chrome, /method: counted \? 'GET' : 'POST'/);
  const panel = read('assets/admin-analytics.js');
  assert.match(panel, /<span>Unique visitors/);
  assert.match(panel, /Where visitors are, by state/);
  assert.match(panel, /<a href="https:\/\/db-ip\.com" target="_blank" rel="noopener">IP Geolocation by DB-IP<\/a>/, 'the licence\'s attribution, where the results are shown');
  assert.match(read('privacy.html'), /your browser keeps the date of your last visit, on your own device/);
});
