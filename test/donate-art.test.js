'use strict';

/* The picture under the word on donate.html.

   The panel was a heading, a screen of nothing, and one sentence pinned to
   the floor. The ring goes in the nothing. What these check is the part of
   that which is easy to undo by accident: the order of the three children,
   the description, and the height cap that keeps the sentence on screen. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'img', 'donate-dog.webp');
const html = fs.readFileSync(path.join(ROOT, 'donate.html'), 'utf8');

/* The owner's own donate page (31 Oct 2026, "update donate as well.."): the
   life ring gave way to a dog, photographed twice, who smiles when thanked. */

test('the panel shows the picture between the word and the sentence about the gift', () => {
  const side = /<div class="give__side">([\s\S]*?)<div class="give__form">/.exec(html);
  assert.ok(side, 'the donate panel is where it was');
  const order = [...side[1].matchAll(/id="sideHead"|class="ring dog-scene"|id="sideGive"/g)].map((m) => m[0]);
  assert.deepEqual(order, ['id="sideHead"', 'class="ring dog-scene"', 'id="sideGive"'],
    'heading, then picture, then what the gift buys');
});

test('the dog is described, and reserves its space before it arrives', () => {
  const tag = /<div class="dog-portrait" role="img" aria-label="([^"]{12,})">/.exec(html);
  assert.ok(tag, 'a described picture');
  assert.match(html, /\.dog-portrait\{position:relative;height:min\(46vh,540px\);width:auto;max-width:100%;aspect-ratio:425\/640;/, 'its shape known before the file loads, its height capped so the sentence stays on screen');
  assert.match(html, /--dog-photo:url\("img\/donate-dog\.webp"\)/);
  assert.ok(!/data:image\//.test(html), 'no photograph pasted into the page');
});

test('the file is really there, and both halves are the dog whole', () => {
  const bytes = fs.readFileSync(ART);
  assert.equal(bytes.slice(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.slice(8, 12).toString('ascii'), 'WEBP');
  assert.ok(bytes.length > 20 * 1024 && bytes.length < 400 * 1024, `${Math.round(bytes.length / 1024)}KB`);
  const size = webpSize(bytes);
  assert.ok(Math.abs(size[0] / 2 / size[1] - 425 / 640) < 0.01, 'each half is the shape of the frame, so nothing of it is cut');
  assert.ok(!fs.existsSync(path.join(ROOT, 'img', 'donate-lifering.webp')), 'the ring is retired');
});

/* Canvas size out of the RIFF header. */
function webpSize(bytes) {
  const kind = bytes.slice(12, 16).toString('ascii');
  if (kind === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (kind === 'VP8L') { const b = bytes.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >>> 14) & 0x3fff)]; }
  if (kind === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  return null;
}

test('the money rings are gone, from the page and from the folder', () => {
  assert.ok(!html.includes('donate-lifebuoy'));
  assert.ok(!/showRing|stageRing/.test(html));
  assert.ok(!fs.existsSync(path.join(ROOT, 'img', 'donate-lifebuoy.webp')));
});

test('the thank-you is shown only when asked, and never claims a gift that was not made', () => {
  assert.match(html, /<button type="button" id="previewSmile">Preview thank-you <svg/, 'a drawn arrow, never a typed one');
  assert.match(html, /\.dog-portrait\{height:clamp\(150px,44vw,240px\)\}/, 'small on a phone, beside the word');
  assert.match(html, /Animation preview only\. No donation has been made\./);
  assert.match(html, /window\.PFADonationCelebration=Object\.freeze\(\{show:\(\)=>show\(\),reset\}\);/);
  assert.match(html, /\.give\.is-grateful \.give__side\{background:#eae9db\}/);
});

test('choosing dollars and back keeps the same dog', async () => {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', virtualConsole: new VirtualConsole(), url: 'https://pfa.test/donate.html',
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      w.scrollTo = () => {};
      w.fetch = () => new Promise(() => {});
    }
  });
  const doc = dom.window.document;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  try {
    doc.querySelector('[data-gcur="USD"]').click();
    await settle();
    doc.querySelector('[data-gcur="INR"]').click();
    await settle();
    assert.equal(doc.querySelectorAll('.dog-portrait .dog-photo').length, 2);
    doc.getElementById('previewSmile').click();
    assert.ok(doc.querySelector('.give').classList.contains('is-grateful'), 'the preview shows the smile');
    doc.getElementById('previewSmile').click();
    assert.ok(!doc.querySelector('.give').classList.contains('is-grateful'), 'and goes back');
  } finally {
    dom.window.close();
  }
});
