'use strict';

/* Video on a phone, and the footer on a phone.

   Owner, 21 Oct 2026: "make the website look perfectly cool on the mobile
   screen as well. IT NEEDS TO BE SUPREME.. THE FOOTER ON THE MOBILE SUCKS.
   SO LONG AND FUCKED UP.. ALSO VIDEOS DONT PLAY PERFECTLY ON MOBILE SCREENS.
   YOU NEED TO MAKE THE MOBILE VIDEO PLAYING EXPERIENCE PERFECTLY LIKE
   NETFLIX". Checked in Chromium at 390 by 844 and 844 by 390 as a touch
   phone; held here. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function reelPage({ phone = true } = {}) {
  const dom = new JSDOM('<!doctype html><body><div class="rbox" id="rbox"><div class="rbox__stage"><div class="rbox__frame" id="rboxFrame"></div></div></div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: phone && /hover:none/.test(q), addEventListener() {}, addListener() {} });
  w.HTMLMediaElement.prototype.play = function () { this._paused = false; return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () { this._paused = true; };
  Object.defineProperty(w.HTMLMediaElement.prototype, 'paused', { get() { return this._paused !== false; }, configurable: true });
  w.eval(read('assets/reels.js'));
  const d = w.document;
  const steps = [];
  let closed = 0;
  w.PFA_REELS.wire({ box: d.getElementById('rbox'), frame: d.getElementById('rboxFrame'), step: (n) => { steps.push(n); return n > 0; }, close: () => { closed += 1; } });
  const put = () => { const v = d.createElement('video'); v.setAttribute('controls', ''); d.getElementById('rboxFrame').appendChild(v); return v; };
  const touch = (y0, y1, x = 200) => {
    const box = d.getElementById('rbox');
    const ev = (type, y) => { const e = new w.Event(type, { bubbles: true }); Object.assign(e, { pointerType: 'touch', clientX: x, clientY: y }); return e; };
    box.dispatchEvent(ev('pointerdown', y0));
    box.dispatchEvent(ev('pointerup', y1));
  };
  return { w, d, put, touch, steps, closed: () => closed, tick: () => new Promise((r) => setTimeout(r, 0)) };
}

test('on a phone a reel becomes a full-screen player: no browser controls, it loops, it starts with sound', async () => {
  const p = reelPage();
  const v = p.put();
  await p.tick();
  assert.ok(p.d.getElementById('rbox').classList.contains('is-reel-phone'));
  assert.equal(v.hasAttribute('controls'), false, 'the browser\'s small controls are gone');
  assert.equal(v.loop, true);
  assert.equal(v.muted, false, 'sound on');
  assert.equal(v.paused, false, 'and it plays');
  assert.ok(p.d.querySelector('.rv-sound') && p.d.querySelector('.rv-prog'), 'Sound and the progress bar are drawn');
});

test('a tap pauses and plays; a swipe up is the next reel, down the one before, down on the first closes', async () => {
  const p = reelPage();
  const v = p.put();
  await p.tick();
  p.touch(400, 400);
  assert.equal(v.paused, true, 'a tap pauses');
  p.touch(400, 402);
  assert.equal(v.paused, false, 'another plays');
  p.touch(600, 300);
  assert.deepEqual(p.steps, [1], 'swipe up: next');
  p.touch(300, 600);
  assert.deepEqual(p.steps, [1, -1], 'swipe down: the one before');
  assert.equal(p.closed(), 1, 'and with none before it, the box closes');
});

test('a wide screen keeps its box exactly as it was', async () => {
  const p = reelPage({ phone: false });
  const v = p.put();
  await p.tick();
  assert.equal(p.d.getElementById('rbox').classList.contains('is-reel-phone'), false);
  assert.equal(v.hasAttribute('controls'), true);
});

test('both reel pages use the one player, step between their own reels, and offer no way out to Instagram', () => {
  for (const f of ['founder.html', 'cinekind.html']) {
    const html = read(f);
    assert.match(html, /<script src="assets\/reels\.js"><\/script>/, `${f} loads the reel player`);
    assert.match(html, /window\.PFA_REELS\.wire\(\{/, `${f} wires its box to it`);
    assert.doesNotMatch(html, /id="rboxOut"/, `${f}: no Open on Instagram link`);
    const box = html.slice(html.indexOf('<div class="rbox" id="rbox"'), html.indexOf('</div>\n</div>', html.indexOf('<div class="rbox" id="rbox"')));
    assert.doesNotMatch(box, /instagram\.com/);
  }
  assert.match(read('assets/theatre.css'), /html \.rbox\.is-reel-phone\{background:#000;/, 'black, edge to edge');
});

test('the theatre on a phone: the film has the screen, the controls float over it and step away while it plays', () => {
  const js = read('assets/theatre.js');
  const css = read('assets/theatre.css');
  assert.match(js, /window\.matchMedia\('\(hover:none\) and \(pointer:coarse\)'\)/);
  assert.match(js, /th\.classList\.toggle\('is-phone', phone\(\)\)/);
  assert.match(js, /hideT = setTimeout\(function\(\)\{ if \(wasOpen && P\.playing\(\)\)\{ pointerZone = false; sync\(\); \} \}, 3000\);/, 'three seconds of playing puts the controls away');
  assert.match(js, /\$\('#thMidPlay'\)\.addEventListener\('click', function\(\)\{ toggle\(\); restSoon\(\); \}\);/);
  assert.match(js, /\$\('#thMidBack'\)\.addEventListener\('click', function\(\)\{ skip\(-SKIP\); restSoon\(\); \}\);/);
  assert.match(js, /if \(phone\(\) && downY !== null && e\.clientY - downY > 90 && Math\.abs\(e\.clientX - downX\) < 70\)\{ downY = null; close\(\); return; \}/, 'a swipe down closes');
  assert.match(js, /if \(film\.src \|\| !ios\)\{\s*muted = false;/, 'a tap opens it with sound, except a YouTube film on an iPhone');
  assert.match(css, /\.theatre\.is-phone \.th-stage\{position:absolute;inset:0;flex:none\}/, 'the film has the whole screen');
  assert.match(css, /\.theatre\.is-phone \.th-bottom\.away\{opacity:0;/, 'the controls really step away on a phone');
  assert.match(css, /\.theatre\.is-phone \.th-strip,\.theatre\.is-phone \.th-rule,\.theatre\.is-phone \.th-foot\{display:none\}/);
  assert.match(css, /\.theatre\.is-phone \.th-row \.r > :not\(#thFull\)\{display:none\}/, 'Full screen stays; the desktop extras go');
});
