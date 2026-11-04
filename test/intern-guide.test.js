'use strict';

/* The interns' two-page guide (owner, 4 Nov 2026: "for interns- have a
   quick guide on how to get started. 2 pages. what to do each week , how to
   submit. it has to be understood by any and all age people. whether or not
   tech savvy. ensure login works perfectly"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../lib/internship');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('intern-guide.html');
const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
const words = main.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('two pages: getting in, then the eight weeks and sending work', () => {
  assert.equal((main.match(/<article class="gd-page"/g) || []).length, 2);
  assert.match(words, /Page 1 of 2 Getting in/);
  assert.match(words, /Page 2 of 2 Your eight weeks/);
  assert.match(html, /\.gd-page \+ \.gd-page\{break-before:page/);
});

test('every week of the standard plan is on page two, in order', () => {
  const rows = [...main.matchAll(/<tr><td>([^<]+)<\/td>/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['1', '2', '3', '4', '5 and 6', '6', '7', '8']);
  assert.equal(I.DEFAULT_TASKS.length, 8);
  for (const t of I.DEFAULT_TASKS) assert.ok(t.week >= 1 && t.week <= 8);
});

test('getting in says what the portal and the email really say', () => {
  for (const said of ['Your PFA internship access', 'Get my access key', 'I have written down my Intern ID and access key', 'Open my dashboard', 'Sign in', 'Send proof', 'Sent, with PFA', 'Send the revision']) {
    assert.ok(words.includes(said), said);
  }
  const portal = read('intern.html');
  for (const said of ['Open my dashboard', 'I have written down my Intern ID and access key', 'Sign in']) assert.ok(portal.includes(said), said);
  assert.match(read('lib/caregiver-mail.js'), /label: 'Get my access key'/);
  assert.match(words, /five wrong tries in a row, the ID rests for 15 minutes/);
  assert.equal(I.LOCK.after, 5);
  assert.equal(I.LOCK.baseMs, 15 * 60000);
  assert.match(words, /within 7 days/);
  assert.equal(I.LIMITS.onboardDays, 7);
  assert.match(words, /up to 3 MB each/);
  assert.equal(I.LIMITS.fileBytes, 3 * 1024 * 1024);
});

test('plain words: short sentences, no long dashes', () => {
  assert.doesNotMatch(main, /[–—]/);
  const blocks = [...main.matchAll(/<(p|li|dd|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  const sentences = blocks.flatMap((b) => b.split(/(?<=[.?!])\s+/)).filter((x) => x.length > 3);
  assert.ok(sentences.length > 30);
  const long = sentences.filter((x) => x.split(' ').length > 30);
  assert.deepEqual(long, [], 'a sentence over 30 words');
});

test('found from the portal, the internship page and the welcome email; the PDF is two pages', () => {
  assert.match(read('intern.html'), /href="intern-guide\.html"[^>]*>two-page guide/);
  assert.match(read('intern.html'), /<a class="linkish" href="intern-guide\.html">The two-page guide<\/a>/);
  assert.match(read('internship.html'), /href="intern-guide\.html">The two-page guide/);
  assert.match(main, /href="media\/intern\/PFA-intern-quick-start-guide\.pdf" download/);
  const pdf = fs.readFileSync(path.join(ROOT, 'media/intern/PFA-intern-quick-start-guide.pdf'));
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 2);
  assert.ok(pdf.length < 400 * 1024);
});

test('the portal takes the Intern ID and key however they are typed, and can show the key', () => {
  assert.equal(I.internIdOf(' pfa-in-k7m2qx '), 'PFA-IN-K7M2QX');
  assert.equal(I.internIdOf('k7m2qx'), 'PFA-IN-K7M2QX');
  assert.equal(I.internIdOf('PFA IN K7M2QX'), 'PFA-IN-K7M2QX');
  assert.equal(I.keyOf('1234 567-890'), '1234567890');
  const portal = read('intern.html');
  assert.match(portal, /id="ipShow"/);
  assert.match(portal, /\$\('#ipKey'\)\.type = this\.checked \? 'text' : 'password'/);
  assert.match(portal, /addEventListener\('hashchange'/);
});
