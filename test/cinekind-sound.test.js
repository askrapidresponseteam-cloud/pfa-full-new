'use strict';

/* CineKind's sound belongs to its opening picture.

   Owner, 24 Oct 2026: "The sound on/off button should appear only while
   this image is displayed. Once the user enters Cinekind, the sound should
   gradually fade out, and the button should disappear as well."

   Entering is pressing Enter, or scrolling the picture mostly out of view
   (under 40% of the screen; back over 60%). The page's own script is run
   here with a stand-in for the browser's audio and for the observer that
   watches the picture; it was also driven in Chromium at 1440 and 390 wide,
   by Enter and by scrolling. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'cinekind.html'), 'utf8');
const SCRIPT = /<script id="cinekind-experience">([\s\S]*?)<\/script>/.exec(HTML)[1];

function boot() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://pfa.test/cinekind.html', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  const gain = { value: 0, calls: [] };
  ['cancelScheduledValues', 'setValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime'].forEach((name) => {
    gain[name] = (...a) => { gain.calls.push([name, ...a]); if (name === 'setTargetAtTime' || name === 'linearRampToValueAtTime') gain.value = a[0]; };
  });
  const audio = { suspended: 0, resumed: 0, currentTime: 10 };
  const node = () => ({ connect() {}, start() {}, frequency: { value: 0 }, detune: { value: 0 }, gain: { value: 0 }, Q: { value: 0 }, threshold: { value: 0 }, ratio: { value: 0 }, delayTime: { value: 0 }, type: '' });
  w.AudioContext = function () {
    return Object.assign(this, {
      get currentTime() { return audio.currentTime; }, sampleRate: 8000, destination: {},
      createGain: () => Object.assign(node(), { gain }), createDynamicsCompressor: node, createDelay: node, createOscillator: node, createBiquadFilter: node,
      createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }), createBufferSource: node,
      resume: async () => { audio.resumed += 1; }, suspend: async () => { audio.suspended += 1; }
    });
  };
  const watchers = [];
  w.IntersectionObserver = function (fn) { this.observe = (el) => watchers.push({ fn, el }); this.unobserve = () => {}; };
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  w.requestAnimationFrame = () => 0;
  w.cancelAnimationFrame = () => {};
  w.eval(SCRIPT);
  const doc = w.document;
  const button = doc.getElementById('ckSound');
  /* the picture filling `seen` of a 900px screen */
  const picture = (seen) => {
    Object.defineProperty(w, 'innerHeight', { value: 900, configurable: true });
    const bottom = Math.round(900 * seen);
    for (const o of watchers.filter((x) => x.el.id === 'marquee')) o.fn([{ boundingClientRect: { top: bottom - 1575, bottom, height: 1575 } }]);
  };
  return { w, doc, button, gain, audio, picture, close: () => w.close() };
}

const tick = () => new Promise((r) => setImmediate(r));

test('pressing Enter fades the sound out slowly, switches it off, and the button goes', async () => {
  const p = boot();
  try {
    assert.ok(!p.button.classList.contains('is-away'), 'there on the picture');
    p.button.click();
    for (let i = 0; i < 5; i += 1) await tick();
    assert.equal(p.button.getAttribute('aria-pressed'), 'true', 'sound on');
    p.gain.calls.length = 0;
    p.doc.querySelector('.marquee__door').click();
    assert.ok(p.button.classList.contains('is-away'), 'the button goes');
    assert.equal(p.button.getAttribute('aria-hidden'), 'true');
    assert.equal(p.button.tabIndex, -1, 'and is out of the keyboard\'s way');
    assert.equal(p.button.getAttribute('aria-pressed'), 'false', 'the sound is switched off');
    assert.equal(p.doc.getElementById('ckSoundText').textContent, 'Sound off');
    const ramp = p.gain.calls.find((c) => c[0] === 'linearRampToValueAtTime');
    assert.ok(ramp, 'faded, not cut');
    assert.equal(ramp[1], 0);
    assert.equal(ramp[2] - p.audio.currentTime, 2.5, 'over two and a half seconds');
    /* something else on the page asking for silence does not cut the fade short */
    p.doc.dispatchEvent(new p.w.Event('visibilitychange'));
    await tick();
    assert.ok(!p.gain.calls.some((c) => c[0] === 'setTargetAtTime'), 'the slow fade is left to finish');
  } finally { p.close(); }
});

test('scrolling the picture out of view does the same; back at the picture the button returns, reading Sound off', async () => {
  const p = boot();
  try {
    p.button.click();
    for (let i = 0; i < 5; i += 1) await tick();
    p.picture(0.75);
    assert.ok(!p.button.classList.contains('is-away'), 'three quarters of the screen is still the picture');
    p.picture(0.3);
    assert.ok(p.button.classList.contains('is-away'), 'under 40%: entered');
    assert.equal(p.button.getAttribute('aria-pressed'), 'false');
    p.picture(0.5);
    assert.ok(p.button.classList.contains('is-away'), 'no flicker in between');
    p.picture(0.9);
    assert.ok(!p.button.classList.contains('is-away'), 'back');
    assert.equal(p.button.getAttribute('aria-hidden'), null);
    assert.equal(p.button.hasAttribute('tabindex'), false);
    assert.equal(p.doc.getElementById('ckSoundText').textContent, 'Sound off', 'one press turns it on again');
  } finally { p.close(); }
});

test('entering with the sound never turned on just takes the button away', async () => {
  const p = boot();
  try {
    p.doc.querySelector('.marquee__door').click();
    assert.ok(p.button.classList.contains('is-away'));
    assert.equal(p.gain.calls.length, 0, 'no sound was ever made');
  } finally { p.close(); }
});

test('the button fades away rather than vanishing, and is not there to be pressed', () => {
  assert.match(HTML, /\.ck-sound\.is-away\{opacity:0;transform:translateY\(10px\);visibility:hidden;pointer-events:none;transition:opacity \.6s ease,transform \.6s ease,visibility 0s linear \.6s\}/);
  assert.match(HTML, /\.ck-sound\{[^}]*transition:background \.3s,box-shadow \.3s,opacity \.6s ease,transform \.6s ease,visibility 0s linear 0s\}/);
});

/* The nomination room opens over the picture; on a phone the button sat on
   its Send button (seen in Chromium at 390 wide, 24 Oct 2026). */
test('the button stands aside while the nomination room is open', () => {
  assert.match(HTML, /html\.nom-open \.ck-sound\{display:none\}/);
  assert.match(HTML, /room\.hidden = false;\s*document\.documentElement\.style\.overflow = 'hidden';\s*document\.documentElement\.classList\.add\('nom-open'\);/);
  assert.match(HTML, /room\.hidden = true;\s*document\.documentElement\.style\.overflow = '';\s*document\.documentElement\.classList\.remove\('nom-open'\);/);
});
