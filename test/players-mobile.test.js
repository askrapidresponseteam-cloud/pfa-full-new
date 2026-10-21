'use strict';

/* The three players on phones and in full screen (16 Sep 2026).

   theatre.js is stood up on wall.html the way test/wall-theatre.test.js
   does it, with two things that file cannot vary: the media features the
   window claims to have (hover:none for a touch screen) and a browser whose
   only full screen call is the prefixed webkit one, which returns nothing on
   success. The screening room on cinekind.html is driven through a stand-in
   for the YouTube player object, the way the room itself takes hold of it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const THEATRE_JS = read('assets/theatre.js');
const THEATRE_CSS = read('assets/theatre.css');
const WALL = read('wall.html').replace('<script src="assets/theatre.js"></script>', `<script>${THEATRE_JS}</script>`);
const CINEKIND = read('cinekind.html');
const FOUNDER = read('founder.html');

const FILMS = [
  { wall: 'long', title: 'An embed', credit: '', yt: 'BVbpSc_EXlI' },
  { wall: 'long', title: 'First file', credit: '', src: 'https://films.test/one.mp4', poster: 'https://films.test/one.jpg' },
  { wall: 'long', title: 'Second file', credit: '', src: 'https://films.test/two.mp4', poster: 'https://films.test/two.jpg' },
  { wall: 'short', title: 'A short', credit: '', src: 'https://films.test/short.mp4', poster: 'https://films.test/short.jpg' }
];
const instant = (value) => ({
  then(onOk) { const out = onOk ? onOk(value) : value; return out && typeof out.then === 'function' ? out : instant(out); },
  catch() { return this; }
});
const feed = () => instant({ ok: true, json: () => instant({ ok: true, films: FILMS.map((f) => Object.assign({}, f)) }) });

const windows = [];
test.after(() => { windows.forEach((w) => { try { w.close(); } catch (e) {} }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function matchMediaFor(w, truths) {
  w.matchMedia = (q) => ({
    matches: truths.some((t) => q.replace(/\s+/g, '').includes(t)), media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
  });
}

/* A finger on the film. Dispatched on the video itself so the event's target
   is set the way a browser sets it; pointerType is read off the event, and
   jsdom's MouseEvent has no such field, so it is put there. The stage is
   given a width, because a tap's place on it is measured. */
function tap(p) {
  p.$('#thClose').blur();                 /* open() stands focus on Close; a finger has no focus ring to pin the chrome */
  p.$('#thStage').getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450 });
  const up = new p.w.MouseEvent('pointerup', { bubbles: true, clientX: 400, clientY: 225 });
  Object.defineProperty(up, 'pointerType', { value: 'touch' });
  p.video.dispatchEvent(up);
}

/* wall.html with the theatre, on a screen described by `media`. */
function theatre({ media = [] } = {}) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(WALL, {
    runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
    url: 'https://pfa.test/wall.html',
    beforeParse(w) { w.fetch = feed; matchMediaFor(w, media); }
  });
  const w = dom.window;
  windows.push(w);
  const proto = w.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'duration', { configurable: true, get() { return this._d || 0; } });
  Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return this._t || 0; }, set(v) { this._t = v; this.dispatchEvent(new w.Event('timeupdate')); } });
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return this._paused !== false; } });
  Object.defineProperty(proto, 'ended', { configurable: true, get() { return !!this._ended; } });
  Object.defineProperty(proto, 'readyState', { configurable: true, get() { return this._d ? 1 : 0; } });
  Object.defineProperty(proto, 'buffered', { configurable: true, get() { const d = this._d || 0; return { length: d ? 1 : 0, start: () => 0, end: () => d * 0.6 }; } });
  proto.load = function () { this._t = 0; this._d = 0; this._ended = false; this._paused = true; };
  proto.play = function () { this._paused = false; this._ended = false; this.dispatchEvent(new w.Event('play')); this.dispatchEvent(new w.Event('playing')); return Promise.resolve(); };
  proto.pause = function () { this._paused = true; this.dispatchEvent(new w.Event('pause')); };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.closest('[hidden]') ? null : this.parentNode; } });
  /* The bottom block has a height in a browser; jsdom lays nothing out. */
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.id === 'thBottom' ? 180 : 0; } });
  const t = w.PFA_THEATRE;
  assert.ok(t, 'the theatre mounted');
  const video = w.document.getElementById('thVideo');
  const meta = (d) => { video._d = d; video.dispatchEvent(new w.Event('loadedmetadata')); video.dispatchEvent(new w.Event('durationchange')); };
  return { w, d: w.document, video, meta, t, errors, $: (s) => w.document.querySelector(s) };
}

/* ------------------------------------------------------------ the theatre */

test('the theatre carries its own toast, inside the dialog, and that is where its messages go', () => {
  /* The pages' #toast sits at z-index 75 and the theatre at 90, and in full
     screen only the fullscreened element is rendered at all. "Started with
     sound off. Tap Sound to turn it on", the one line a phone visitor most
     needs, was painted where it could not be seen; the academy page has no
     #toast to paint on to begin with. */
  const p = theatre();
  const toast = p.$('#thToast');
  assert.ok(toast, 'the theatre has a toast of its own');
  assert.ok(p.$('#theatre').contains(toast), 'and it is inside the dialog, so it paints above it and survives full screen');
  assert.match(THEATRE_CSS, /\.th-toast\{[^}]*z-index:\s*7/, 'above the help sheet, the highest layer in the theatre');

  const list = p.t.list();
  const i = list.findIndex((it) => it.src);
  p.t.open(i, 'long');
  p.meta(300);
  p.$('#thSound').click();
  p.video.play = function () {
    if (!this.muted) return Promise.reject(new p.w.DOMException('blocked', 'NotAllowedError'));
    this._paused = false; this.dispatchEvent(new p.w.Event('play')); return Promise.resolve();
  };
  p.t.load(i);
  p.meta(300);
  return wait(10).then(() => {
    assert.match(toast.textContent, /sound off/i, 'the refusal is reported on the theatre\'s own toast');
    assert.equal(toast.hidden, false);
    assert.ok(toast.classList.contains('show'));
    assert.equal(p.d.getElementById('toast').textContent, '', 'and no longer on the page\'s, which nobody could see');
  });
});

test('a start position deferred to metadata belongs to the film that asked for it', () => {
  /* Two presses of Next on a slow connection: the first film never gets
     metadata before the second is loaded. Its once-listener then fired on
     the second film's metadata and seeked that film to the first film's
     saved position. */
  const p = theatre();
  const list = p.t.list();
  const first = list.findIndex((it) => it.src);
  const second = list.findIndex((it, k) => it.src && k > first);
  /* the first file has a remembered position; the second does not */
  const prog = {}; prog[p.t.keyOf(list[first])] = { t: 120, d: 300, at: Date.now() };
  p.w.localStorage.setItem('pfa:wall:progress', JSON.stringify(prog));

  p.t.open(first, 'long');                 /* no metadata yet: the seek waits */
  p.t.load(second);                        /* and the visitor has moved on */
  p.meta(300);                             /* metadata arrives - for the second film */
  assert.equal(p.t.current(), second);
  assert.equal(p.video.currentTime, 0, 'the second film must start at its own beginning, not at 2:00 of the first');
});

test('on a touch screen the caption keeps its place above the controls that never step away', () => {
  /* theatre.css keeps the bottom block in place under hover:none so the
     controls are always reachable; only the top bar hides. The caption is
     offset by the block's height, and zeroing that offset while the block
     stood put the caption underneath the controls on every phone. */
  assert.match(THEATRE_CSS, /@media \(hover:none\)\{\.th-bottom\.away\{transform:none/, 'the premise: on touch the block does not leave');
  const p = theatre({ media: ['hover:none'] });
  const i = p.t.list().findIndex((it) => it.src);
  p.t.open(i, 'long');
  p.meta(300);
  const th = p.$('#theatre');
  assert.equal(th.style.getPropertyValue('--th-bottom'), '180px', 'measured while the chrome is up');
  /* a tap on the film while it plays: the top bar goes, the block stays */
  tap(p);
  return wait(400).then(() => {
    assert.ok(p.$('#thBottom').classList.contains('away'), 'the theatre thinks the block is away');
    assert.equal(th.style.getPropertyValue('--th-bottom'), '180px', 'but on this screen it is not, and the caption offset has to say so');
  });
});

test('the same tap on a screen with a pointer does clear the offset', () => {
  const p = theatre({ media: [] });
  const i = p.t.list().findIndex((it) => it.src);
  p.t.open(i, 'long');
  p.meta(300);
  tap(p);
  return wait(400).then(() => {
    assert.ok(p.$('#thBottom').classList.contains('away'));
    assert.equal(p.$('#theatre').style.getPropertyValue('--th-bottom'), '0px');
  });
});

test('a prefixed webkit full screen call that returns nothing is an attempt, not a refusal', async () => {
  /* Old Safari: webkitRequestFullscreen returns undefined and reports
     through webkitfullscreenchange. The chain read undefined as a
     refusal, so one press asked the theatre, then the document, then the
     video element in turn, and the film ended up in the native player. */
  const p = theatre();
  const i = p.t.list().findIndex((it) => it.src);
  p.t.open(i, 'long');
  p.meta(300);
  const w = p.w, asked = [];
  let fsEl = null;
  Object.defineProperty(w.document, 'webkitFullscreenElement', { configurable: true, get() { return fsEl; } });
  delete w.Element.prototype.requestFullscreen;
  w.Element.prototype.webkitRequestFullscreen = function () {
    asked.push(this.id || this.tagName.toLowerCase());
    fsEl = this;
    setTimeout(() => w.document.dispatchEvent(new w.Event('webkitfullscreenchange')), 5);
    /* returns undefined, the way the prefixed call does */
  };
  w.document.webkitExitFullscreen = function () { fsEl = null; setTimeout(() => w.document.dispatchEvent(new w.Event('webkitfullscreenchange')), 5); };

  p.$('#thFull').click();
  await wait(60);
  assert.deepEqual(asked, ['theatre'], 'the theatre was asked once and the chain stopped there');
  assert.equal(p.$('#thFull').getAttribute('aria-pressed'), 'true');

  p.$('#thFull').click();
  await wait(60);
  assert.equal(fsEl, null, 'the second press leaves');
  assert.deepEqual(asked, ['theatre'], 'without asking again');
});

test('a prefixed call the browser refuses still falls through to the next step', async () => {
  const p = theatre();
  const i = p.t.list().findIndex((it) => it.src);
  p.t.open(i, 'long');
  p.meta(300);
  const w = p.w, asked = [];
  delete w.Element.prototype.requestFullscreen;
  w.Element.prototype.webkitRequestFullscreen = function () {
    asked.push(this.id || this.tagName.toLowerCase());
    if (this.id === 'theatre') setTimeout(() => w.document.dispatchEvent(new w.Event('webkitfullscreenerror')), 5);
  };
  p.$('#thFull').click();
  await wait(60);
  assert.deepEqual(asked, ['theatre', 'html'], 'a refusal on the element moves on to the document');
});

test('the stage refuses the browser its gestures, so a double tap is the theatre\'s and a drag does not scroll the page behind', () => {
  assert.match(THEATRE_CSS, /\.th-stage\{[^}]*touch-action:none/);
});

/* ----------------------------------------- CineKind's PR film, in the theatre */

test('the PR film on CineKind plays in the shared theatre, not a room of its own', () => {
  /* owner, 21 Oct 2026: "every video that streams from YT on the website
     should play like this. across the website". Its own room (a looped
     takeover with three buttons) is gone; the theatre's phone mode, full
     screen and controls are what it gets, like every other film. */
  assert.doesNotMatch(CINEKIND, /id="cineScreen"|\.screen\{|function screen\(\)/);
  assert.match(CINEKIND, /<script src="assets\/theatre\.js"><\/script>/);
  assert.match(CINEKIND, /yt: 'GgrFF97F8_s'/);
});

test('the reel frame is capped by the stage it sits in, not the viewport, so a phone held sideways does not squash it', () => {
  assert.match(FOUNDER, /\.rbox__stage\{container-type:size\}/);
  assert.match(FOUNDER, /\.rbox__frame\{max-width:min\(460px,56\.25cqh\)\}/);
  assert.doesNotMatch(FOUNDER, /width:min\(100%,calc\(\(100% - 0px\)\)\)/, 'the expression that said nothing is gone');
  assert.match(FOUNDER, /body\.theatre-lock \.vtile__apps\{display:none\}/, 'the founder page names the class the theatre actually sets');
  assert.doesNotMatch(FOUNDER, /body\.th-open/, 'th-open was never set by anything');
});
