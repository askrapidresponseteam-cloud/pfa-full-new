'use strict';

/* Behaviour, A to Z (v1.556). Owner, 11 Nov 2026: "can you take all of it",
   then "everything to be covered but copyright proof". Every behaviour topic
   in Pike and Horwitz's Canine and Feline Behavior (Wiley, 2026), in plain
   words, one expander each, with the pages to check. This pins what makes it
   trustworthy: each topic names its pages, nothing names a medicine, the
   source is linked, and the page is reachable like every other. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'behaviour.html'), 'utf8');
const doc = new JSDOM(html).window.document;

test('every topic is an expander with its lead showing, and says where to check it', () => {
  const cards = [...doc.querySelectorAll('details.bz')];
  assert.ok(cards.length >= 70, `only ${cards.length} topics`);
  const ids = new Set();
  for (const c of cards) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id ${c.id}`);
    ids.add(c.id);
    assert.ok(['dog', 'cat', 'both'].includes(c.getAttribute('data-sp')), `${c.id}: species`);
    assert.ok(c.querySelector('summary .bz__t') && c.querySelector('summary .bz__l').textContent.length > 40, `${c.id}: title and lead`);
    assert.match(c.querySelector('.bz__pg').textContent, /^Where to check\. Pike and Horwitz \(2026\), pp?\. \d/, `${c.id}: no pages`);
    assert.ok(c.querySelectorAll('.bz__b ul').length === 2, `${c.id}: what is known and what helps`);
  }
  const count = doc.querySelector('.bz-lede').textContent.match(/(\d+) topics/);
  assert.equal(Number(count[1]), cards.length, 'the lede counts the topics');
});

test('no medicine or dose is named: those are a vet\'s decision', () => {
  const text = doc.querySelector('main').textContent.toLowerCase();
  for (const drug of ['fluoxetine', 'clomipramine', 'trazodone', 'gabapentin', 'selegiline', 'alprazolam', 'clonidine', 'sertraline', 'mg/kg']) {
    assert.ok(!text.includes(drug), `names ${drug}`);
  }
  assert.match(text, /medicines for behaviour are a vet.s decision/);
});

test('the source is named and linked, and internal links land', () => {
  const src = doc.getElementById('sources').textContent;
  assert.match(src, /Pike and Debra F\. Horwitz/);
  assert.match(src, /ISBN 9781394204915/);
  assert.ok(doc.querySelector('#sources a[href="https://www.wiley.com/go/pike/behavior"]'));
  for (const a of doc.querySelectorAll('main a[href^="#"]')) {
    const id = a.getAttribute('href').slice(1);
    if (id) assert.ok(doc.getElementById(id), `#${id} is not on the page`);
  }
  for (const a of doc.querySelectorAll('main a[href^="academy.html#"]')) {
    const id = a.getAttribute('href').split('#')[1];
    assert.match(fs.readFileSync(path.join(ROOT, 'academy.html'), 'utf8'), new RegExp(`id="${id}"`), `academy has no #${id}`);
  }
  assert.doesNotMatch(html, /[–—]/, 'no long dashes');
});

test('it is in the Learn menu, the footer and the Academy', () => {
  assert.match(html, /data-nav="behaviour\.html" class="current" aria-current="page">Behaviour, A to Z</);
  assert.match(fs.readFileSync(path.join(ROOT, 'assets', 'chrome-footer.html'), 'utf8'), /href="behaviour\.html">Behaviour, A to Z</);
  assert.match(fs.readFileSync(path.join(ROOT, 'academy.html'), 'utf8'), /href="behaviour\.html">Behaviour, A to Z</);
  assert.ok(fs.readFileSync(path.join(ROOT, 'search-index.json'), 'utf8').includes('behaviour.html'));
});
