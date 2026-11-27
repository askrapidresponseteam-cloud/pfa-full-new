'use strict';

/* The events page, 16 Nov 2026 (owner): the request "clearly explains that
   every event organiser will receive a digitally verifiable certificate, and
   participants will receive certificates of participation", that "Maneka
   Gandhi will join the event live online to speak with the organisers", with
   "a clear Request an Event call to action"; and beside it, not on a page of
   its own ("dont have too many pages"), three podcasts a year with Maneka
   Gandhi: at least 60 days ahead, approved by the PFA team, one paragraph in
   the applicant's own words and no AI, priority for 10,000 followers or more
   on YouTube, Instagram or Facebook, and every event applied for online
   through the official website only. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const F = require('../lib/submission-fields');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const form0 = (doc) => doc.getElementById('podForm');
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

test('the request says what an event comes with, and asks for it in those words', () => {
  const doc = new JSDOM(read('events.html')).window.document;
  const req = doc.getElementById('request');
  const head = text(req.querySelector('.band__head'));
  assert.match(head, /Request an\s?Event/);
  assert.match(head, /Maneka Gandhi joins live/);
  assert.match(head, /online, live, to speak with the organisers/);
  assert.match(head, /certificate for every organiser/i);
  assert.match(head, /Digitally verifiable/);
  assert.match(head, /certificate of participation for each participant/);
  assert.match(head, /through this website only/);
  /* a clear call to action, at the top of the page and where events are listed */
  const ctas = [...doc.querySelectorAll('a[href="#request"]')].map(text);
  assert.ok(ctas.filter((t) => t === 'Request an Event').length >= 2, ctas.join(' | '));
  assert.ok(doc.querySelector('.ev-head .ev-head__acts a[href="#request"]'), 'at the top');
  assert.equal(text(doc.getElementById('evSend')), 'Request the event');
});

test('the podcast is on the events page, closed until asked for, with every rule the owner set', () => {
  const doc = new JSDOM(read('events.html')).window.document;
  const pod = doc.getElementById('podcast');
  assert.ok(pod && pod.hasAttribute('data-flow'), 'opens when asked for, like the request');
  assert.ok(doc.querySelector('.ev-head a[href="#podcast"]'), 'and is asked for from the top of the page');
  const head = text(pod.querySelector('.band__head'));
  assert.match(head, /Three a\s?year/);
  assert.match(head, /each on animal welfare and the concerns animals face/);
  assert.match(head, /On animal welfare/);
  assert.ok(form0(doc).querySelector('#podConcern[required]'), 'the applicant says which animal welfare concern');
  assert.match(head, /at least 60 days/);
  assert.match(head, /PFA team approves/);
  assert.match(head, /one paragraph, in your own words/i);
  assert.match(head, /do not use AI/);
  assert.match(head, /at least 10000 followers on YouTube, Instagram or Facebook/);
  assert.match(head, /purely for how far it spreads/);
  assert.match(head, /apply online through this website only/i);
  const form = pod.querySelector('form#podForm');
  assert.deepEqual([...form.querySelectorAll('.pfa-step')].map((s) => s.getAttribute('data-step')), ['The podcast', 'Your reach', 'You']);
  assert.ok(form.querySelector('#podPitch[minlength="250"][maxlength="1500"]'));
  assert.ok(form.querySelector('#podDate[type="date"][required]'));
  assert.ok(form.querySelector('fieldset[data-address][data-kind="PFA-POD"]'));
  assert.ok(form.querySelector('#podOwn[required]'), 'they confirm the paragraph is their own');
  /* not a page of its own */
  assert.ok(!fs.existsSync(path.join(ROOT, 'podcast.html')));
  assert.match(read('index.html'), />Events and podcasts</, 'the menu says where it is');
});

test('the server holds the 60 days, the paragraph and the follower count, whatever the page sent', () => {
  const day = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
  const base = {
    concern: 'Street and community animals',
    topic: 'Street dogs and their feeders',
    pitch: 'A conversation with feeders from our town about how a colony of street dogs is sterilised, vaccinated and kept, and what changed in our lane once the neighbours were told the law. We want people who see a dog as a nuisance to hear it from those who look after them every night.',
    wantedDate: day(75), platform: 'YouTube', profile: 'https://www.youtube.com/@feeders', followers: '12k',
    name: 'Asha Rao', mobile: '9876543210', email: 'asha@example.com', ownWords: 'Yes',
    address: 'House 14, Barakhamba Road, Connaught Place', pincode: '110001', city: 'New Delhi', state: 'Delhi', district: 'New Delhi'
  };
  assert.deepEqual(F.validate('PFA-POD', base).errors, []);
  const soon = F.validate('PFA-POD', Object.assign({}, base, { wantedDate: day(30) })).errors;
  assert.equal(soon[0].field, 'wantedDate');
  assert.match(soon[0].message, /at least 60 days/);
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { wantedDate: 'next month' })).errors[0].field, 'wantedDate');
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { pitch: 'Short.' })).errors[0].field, 'pitch');
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { pitch: 'word '.repeat(400) })).errors[0].field, 'pitch');
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { followers: 'lots' })).errors[0].field, 'followers');
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { platform: 'Twitter' })).errors[0].field, 'platform');
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { concern: 'Cricket' })).errors[0].field, 'concern', 'only animal welfare');
  assert.equal(F.validate('PFA-POD', Object.assign({}, base, { concern: '' })).errors[0].field, 'concern');
  assert.equal(F.followersOf('1.2M'), 1200000);
  assert.equal(F.followersOf('25,000'), 25000);
});
