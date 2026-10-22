'use strict';

/* The objection letters (assets/lab-letters.js). Owner, 22 Oct 2026, with
   three drafts (kept as they were sent in test/fixtures/lab-letters-owner.txt):
   "Randomly select one of the provided email drafts each time, with varied
   subject lines and natural wording so emails don't feel repetitive or
   template-based to the recipient. Preserve the core message and factual
   accuracy, avoid consecutive repeats, and implement and test the selection
   logic." */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const L = require('../assets/lab-letters.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* A seeded generator, so a run that fails can be run again exactly. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The owner's drafts, read from what was sent. */
function ownerDrafts() {
  const text = read('test/fixtures/lab-letters-owner.txt');
  return text.split(/^Email \d+:\s*$/m).slice(1).map((chunk) => {
    const subject = (/^Subject:\s*(.+?)\s*$/m.exec(chunk) || [])[1];
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    const from = lines.indexOf('The Member Secretary, CCSEA') + 1;
    const to = lines.indexOf('Regards,');
    return { subject, paragraphs: lines.slice(from, to) };
  });
}

/* Every letter the module can write, one plan at a time. */
function* everyPlan() {
  for (const draft of L.DRAFTS) {
    const counts = draft.paragraphs.map((alts) => alts.length);
    const parts = counts.map(() => 0);
    for (;;) {
      for (let subject = 0; subject < draft.subjects.length; subject += 1) {
        for (let to = 0; to < L.TO.length; to += 1) {
          for (let sign = 0; sign < L.SIGN.length; sign += 1) yield { draft: draft.id, subject, to, sign, parts: parts.slice() };
        }
      }
      let i = 0;
      while (i < parts.length && parts[i] === counts[i] - 1) { parts[i] = 0; i += 1; }
      if (i === parts.length) break;
      parts[i] += 1;
    }
  }
}

test('the owner\'s three drafts are there word for word: each one\'s first subject and first wording of every paragraph', () => {
  const owner = ownerDrafts();
  assert.equal(owner.length, 3);
  assert.deepEqual(L.DRAFTS.map((d) => d.id), ['oversight', 'sourcing', 'safeguards']);
  owner.forEach((o, n) => {
    const d = L.DRAFTS[n];
    assert.equal(d.subjects[0], o.subject, `${d.id}: the subject as sent`);
    assert.deepEqual(d.paragraphs.map((alts) => alts[0]), o.paragraphs, `${d.id}: every paragraph as sent, in order`);
  });
  /* and rendered with those choices, the letter is the draft, signed */
  const first = L.render({ draft: 'oversight', subject: 0, to: 0, sign: 0, parts: [0, 0, 0, 0, 0, 0] }, { name: 'Asha Rao', city: 'Udupi' });
  assert.equal(first.subject, owner[0].subject);
  assert.equal(first.body, ['To,\nThe Member Secretary, CCSEA'].concat(owner[0].paragraphs, ['Regards,\nAsha Rao\nUdupi']).join('\n\n'));
});

test('every other wording keeps the facts and the demand of the paragraph it stands for', () => {
  /* What a paragraph may not lose: the rule it cites, the Act, who decides,
     what can be bought where, the disease risk, and the demand itself. */
  const FACTS = [/Rule 11\(3\)/, /Rule 21\(2\)/, /Act, 1960/, /PCA Act/, /Institutional Animal Ethics Committees \(IAECs\)/, /mild or moderate/,
    /non-registered establishments or open markets/, /registered breeders or traders/, /zoonotic disease/, /central Committee/, /institutional committees/,
    /before, during or after experiments/, /alternative/, /withdraw/i, /demand/, /traceab/, /quarantine/, /public health/, /care and treatment after experimentation/];
  for (const d of L.DRAFTS) {
    d.paragraphs.forEach((alts, n) => {
      assert.ok(alts.length >= 2, `${d.id} paragraph ${n + 1} has another wording`);
      const kept = FACTS.filter((f) => f.test(alts[0]));
      alts.slice(1).forEach((alt, k) => {
        kept.forEach((f) => assert.match(alt, f, `${d.id} paragraph ${n + 1}, wording ${k + 2}, keeps ${f}`));
        assert.notEqual(alt, alts[0], 'a wording that is the same is not another wording');
      });
    });
    /* every subject names the Rules (or the notification) and objects */
    d.subjects.forEach((s) => {
      assert.match(s, /Draft Animal Experimentation Rules, 2026|G\.S\.R\. 864\(E\)/, s);
      assert.match(s, /object|withdraw|must|untraced|step backwards/i, s);
      assert.ok(s.length <= 100, `short enough for an inbox: ${s}`);
    });
    assert.ok(d.subjects.length >= 5, `${d.id}: five subjects`);
    assert.equal(new Set(d.subjects).size, d.subjects.length, `${d.id}: no subject twice`);
  }
  /* the two rules each draft rests on, as read in the Gazette */
  assert.ok(L.DRAFTS[0].paragraphs.every((alts) => alts.every((a) => !/Rule 21/.test(a))), 'oversight cites 11(3) only');
  assert.ok(L.DRAFTS[1].paragraphs.every((alts) => alts.every((a) => !/Rule 11/.test(a))), 'sourcing cites 21(2) only');
});

test('every letter that can be written reads clean: no long dashes, no gaps, no placeholder left, short enough to open', () => {
  let count = 0;
  let longest = 0;
  for (const p of everyPlan()) {
    const out = L.render(p, { name: 'Asha Rao', city: 'Udupi' });
    count += 1;
    assert.doesNotMatch(out.body + out.subject, /[\u2013\u2014]/, 'no long dashes (the owner\'s rule)');
    assert.doesNotMatch(out.body, /undefined|null|\[object|\n{3,}| {2,}/);
    assert.match(out.body, /^To,\nThe Member Secretary/);
    assert.match(out.body, /\n(Regards|Yours sincerely|Sincerely|Yours faithfully|With regards),\nAsha Rao\nUdupi$/);
    assert.doesNotMatch(out.body, /\[Your/);
    longest = Math.max(longest, encodeURIComponent(out.body.replace(/\n/g, '\r\n')).length + encodeURIComponent(out.subject).length);
  }
  assert.ok(count > 50000, `${count} letters`);
  /* the whole letter rides in the address Gmail and Outlook open */
  assert.ok(longest < 6000, `the longest letter is ${longest} characters as a link`);
  /* no name yet: the places for them say so */
  const blank = L.render(L.plan({ rand: seeded(1) }), {});
  assert.match(blank.body, /\n\[Your full name\]\n\[Your city\]$/);
});

test('never the same draft twice in a row, whatever the random number', () => {
  for (const last of L.DRAFTS.map((d) => d.id)) {
    for (const r of [0, 1e-9, 0.25, 0.3333333, 0.3333334, 0.5, 0.6666666, 0.6666667, 0.75, 0.999999999, 1, 1.5, -0.1]) {
      const p = L.plan({ lastId: last, rand: () => r });
      assert.notEqual(p.draft, last, `last ${last}, rand ${r}`);
      assert.ok(L.DRAFTS.some((d) => d.id === p.draft));
    }
  }
  /* a visitor coming back again and again */
  const rand = seeded(7);
  let last = '';
  for (let i = 0; i < 5000; i += 1) {
    const p = L.plan({ lastId: last, rand });
    assert.notEqual(p.draft, last, `visit ${i}`);
    last = p.draft;
  }
  /* something unknown remembered is no reason to fail */
  assert.ok(L.plan({ lastId: 'gone', rand: seeded(3) }).draft);
  assert.ok(L.plan().draft, 'Math.random by default');
});

test('the choice is fair: each draft about a third of the time, and the other two evenly after one', () => {
  const rand = seeded(42);
  const N = 30000;
  const fresh = { oversight: 0, sourcing: 0, safeguards: 0 };
  for (let i = 0; i < N; i += 1) fresh[L.plan({ rand }).draft] += 1;
  Object.values(fresh).forEach((c) => assert.ok(Math.abs(c / N - 1 / 3) < 0.015, JSON.stringify(fresh)));
  const after = { oversight: 0, sourcing: 0, safeguards: 0 };
  for (let i = 0; i < N; i += 1) after[L.plan({ rand, lastId: 'sourcing' }).draft] += 1;
  assert.equal(after.sourcing, 0);
  assert.ok(Math.abs(after.oversight / N - 0.5) < 0.015 && Math.abs(after.safeguards / N - 0.5) < 0.015, JSON.stringify(after));
  /* the subject, greeting and sign-off are spread over all their choices too */
  const subjects = new Set();
  const bodies = new Set();
  for (let i = 0; i < 3000; i += 1) {
    const out = L.render(L.plan({ rand }), { name: 'A', city: 'B' });
    subjects.add(out.subject);
    bodies.add(out.body);
  }
  assert.equal(subjects.size, L.DRAFTS.reduce((t, d) => t + d.subjects.length, 0), 'every subject turns up');
  assert.ok(bodies.size > 2500, `3000 letters, ${bodies.size} different`);
});

test('the same plan writes the same letter, so it can follow the name and city as they are typed', () => {
  const p = L.plan({ rand: seeded(11) });
  const a = L.render(p, { name: 'Asha', city: 'Udupi' });
  const b = L.render(p, { name: 'Asha Rao', city: 'Udupi' });
  assert.equal(a.subject, b.subject);
  assert.equal(a.body.replace('Asha\n', 'Asha Rao\n'), b.body);
});

/* ---- on the page ----------------------------------------------------------- */

function boot(store) {
  const html = read('lab-animal-rules.html');
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { if (!/Could not parse CSS/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://pfa.test/lab-animal-rules.html', virtualConsole });
  const w = dom.window;
  w.setInterval = () => 0;
  w.Date.now = () => Date.UTC(2026, 9, 22, 10);
  if (store) Object.entries(store).forEach(([k, v]) => w.localStorage.setItem(k, v));
  const opened = [];
  w.open = (url) => { opened.push(url); return null; };
  w.eval(read('assets/field-rules.js'));
  w.eval(read('assets/field-validate.js'));
  w.eval(read('assets/lab-letters.js'));
  w.eval(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')));
  return { w, doc: w.document, errors, opened };
}

test('the page loads the letters before its own script, and chooses one as it opens', () => {
  const html = read('lab-animal-rules.html');
  const at = html.indexOf('<script src="assets/lab-letters.js"></script>');
  assert.ok(at > 0 && at < html.lastIndexOf('<script>'), 'loaded before the page\'s script');
  assert.doesNotMatch(html, /Objections to draft Laboratory Animals Rules/, 'the one fixed letter is gone');
  const { doc, errors, w } = boot();
  assert.deepEqual(errors, []);
  const id = doc.getElementById('labForm').getAttribute('data-letter');
  const draft = L.DRAFTS.find((d) => d.id === id);
  assert.ok(draft, `chose ${id}`);
  assert.ok(draft.subjects.includes(doc.getElementById('labSubject').value), 'the subject is that draft\'s');
  assert.equal(w.localStorage.getItem('pfa:lab-letter:last'), id, 'and remembers it, in this browser only');
  assert.match(doc.getElementById('labLetter').value, /^To,\nThe Member Secretary/);
});

test('a visitor who comes back never gets the same draft twice running', () => {
  let last = '';
  const seen = new Set();
  for (let i = 0; i < 24; i += 1) {
    const { doc, w } = boot(last ? { 'pfa:lab-letter:last': last } : null);
    const id = doc.getElementById('labForm').getAttribute('data-letter');
    assert.notEqual(id, last, `visit ${i + 1}`);
    assert.equal(w.localStorage.getItem('pfa:lab-letter:last'), id);
    seen.add(id);
    last = id;
    w.close();
  }
  assert.equal(seen.size, 3, 'all three turn up');
});

test('with storage refused (a private window), the page still writes and sends a letter', () => {
  const html = read('lab-animal-rules.html');
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://pfa.test/lab-animal-rules.html', virtualConsole });
  const w = dom.window;
  w.setInterval = () => 0;
  w.Date.now = () => Date.UTC(2026, 9, 22, 10);
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('denied'); } });
  const opened = [];
  w.open = (url) => { opened.push(url); return null; };
  w.eval(read('assets/field-rules.js'));
  w.eval(read('assets/field-validate.js'));
  w.eval(read('assets/lab-letters.js'));
  w.eval(html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>')));
  const doc = w.document;
  assert.ok(doc.getElementById('labForm').getAttribute('data-letter'));
  doc.getElementById('labName').value = 'Asha Rao';
  doc.getElementById('labCity').value = 'Udupi';
  doc.getElementById('labCity').dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.querySelector('[data-way="gmail"]').click();
  assert.equal(opened.length, 1);
  const body = new URL(opened[0]).searchParams.get('body');
  assert.match(body, /\r\nAsha Rao\r\nUdupi$/);
});
