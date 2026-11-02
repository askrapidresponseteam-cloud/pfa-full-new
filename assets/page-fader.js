/* The page fader (owner, 2 Nov 2026, with a picture of a mixing-desk fader:
   "use animations to move up and down the page").

   A fader fixed at the right edge of a long page. Its knob and orange fill
   follow where the reader is; drag the knob and the page follows it, click
   the slot or a mark and the page glides there. The marks are the page's
   own sections ([data-fader-label]); one that is hidden (a form not yet
   opened) has no mark. Down on the fader is down the page. The labels show
   when the fader is hovered or focused, so at rest it is only the slot,
   the ticks and the knob.

   Keyboard: it is a slider (Up and Down move 5 percent, Page Up and Page
   Down a quarter, Home and End the ends). A wheel, a touch or a key stops
   a glide at once. With reduced motion the page jumps instead of gliding.
   Hidden on phones and tablets, which have their own scrolling. */
(function () {
  'use strict';
  if (!window.requestAnimationFrame || document.querySelector('.pf-fader')) return;
  var doc = document.documentElement;
  var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var SLOT = 220;
  var glide = 0;

  var css = ''
    + '.pf-fader{position:fixed;right:18px;top:50%;z-index:60;width:46px;height:' + (SLOT + 44) + 'px;transform:translateY(-50%);'
    + 'background:transparent;'
    + 'box-shadow:none;transition:width .3s,opacity .4s;opacity:0;pointer-events:none;outline:none;touch-action:none}'
    + '.pf-fader[data-on="1"]{opacity:1;pointer-events:auto}'
    + '.pf-fader:hover,.pf-fader:focus-visible,.pf-fader[data-drag="1"]{width:176px}'
    + '.pf-fader:focus-visible{outline:2px solid #ff8a1c;outline-offset:4px}'
    + '.pf-fader__slot{position:absolute;right:20px;top:22px;width:6px;height:' + SLOT + 'px;background:#2a2b2d;box-shadow:0 1px 1px rgba(255,255,255,.8),0 -1px 1px rgba(0,0,0,.35) inset;cursor:pointer}'
    + '.pf-fader__fill{position:absolute;left:0;right:0;top:0;height:0;background:#ff8a1c;box-shadow:0 0 6px #ff8a1c,0 0 14px rgba(255,138,28,.6)}'
    + '.pf-fader__ticks{position:absolute;right:34px;top:22px;width:10px;height:' + SLOT + 'px;background:repeating-linear-gradient(180deg,#fff 0 1px,transparent 1px ' + (SLOT / 20) + 'px);pointer-events:none;mix-blend-mode:difference}'
    + '.pf-fader__knob{position:absolute;right:9px;top:22px;width:28px;height:30px;margin-top:-15px;cursor:grab;'
    + 'background:linear-gradient(180deg,#f6f7f8 0,#b9bcbf 22%,#eceeef 48%,#7d8084 50%,#d8dadc 54%,#a9acaf 100%);'
    + 'box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 6px 10px rgba(0,0,0,.35),0 1px 2px rgba(0,0,0,.4)}'
    + '.pf-fader__knob::after{content:"";position:absolute;left:3px;right:3px;top:14px;height:2px;background:#ff8a1c;box-shadow:0 0 6px #ff8a1c}'
    + '.pf-fader[data-drag="1"] .pf-fader__knob{cursor:grabbing}'
    + '.pf-fader__marks{position:absolute;left:0;right:52px;top:22px;height:' + SLOT + 'px;opacity:0;visibility:hidden;pointer-events:none;mix-blend-mode:difference;transition:opacity .25s,visibility .25s}'
    + '.pf-fader:hover .pf-fader__marks,.pf-fader:focus-visible .pf-fader__marks,.pf-fader[data-drag="1"] .pf-fader__marks{opacity:1;visibility:visible;pointer-events:auto}'
    + '.pf-fader__mark{position:absolute;right:0;display:flex;align-items:center;gap:6px;padding:0;margin-top:-9px;height:18px;border:0;background:none;'
    + 'font:600 10px/1 Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#fff;white-space:nowrap;cursor:pointer;text-shadow:none}'
    + '.pf-fader__mark::after{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}'
    + '.pf-fader__mark[data-here="1"]{color:#fff;font-weight:800}'
    + '.pf-fader__mark:hover{color:#fff;text-decoration:underline;text-underline-offset:3px}'
    + '@media (max-width:900px),(pointer:coarse){.pf-fader{display:none}}'
    + '@media print{.pf-fader{display:none}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var box = document.createElement('div');
  box.className = 'pf-fader';
  box.setAttribute('role', 'slider');
  box.setAttribute('tabindex', '0');
  box.setAttribute('aria-label', 'Where you are on this page');
  box.setAttribute('aria-orientation', 'vertical');
  box.setAttribute('aria-valuemin', '0');
  box.setAttribute('aria-valuemax', '100');
  box.innerHTML = '<div class="pf-fader__marks"></div><div class="pf-fader__ticks"></div><div class="pf-fader__slot"><i class="pf-fader__fill"></i></div><div class="pf-fader__knob"></div>';
  document.body.appendChild(box);
  var slot = box.querySelector('.pf-fader__slot');
  var fill = box.querySelector('.pf-fader__fill');
  var knob = box.querySelector('.pf-fader__knob');
  var marksBox = box.querySelector('.pf-fader__marks');
  var marks = [];

  function room() { return Math.max(1, doc.scrollHeight - window.innerHeight); }
  function share() { return Math.min(1, Math.max(0, (window.scrollY || doc.scrollTop) / room())); }

  function draw() {
    var p = share();
    var y = Math.round(p * SLOT);
    knob.style.transform = 'translateY(' + y + 'px)';
    fill.style.height = y + 'px';
    box.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    var here = null;
    marks.forEach(function (m) { if (window.scrollY + window.innerHeight * 0.35 >= m.top) here = m; });
    box.setAttribute('aria-valuetext', Math.round(p * 100) + ' percent' + (here ? ', ' + here.label : ''));
    marks.forEach(function (m) { m.el.setAttribute('data-here', m === here ? '1' : ''); });
    box.setAttribute('data-on', window.scrollY > window.innerHeight * 0.4 || box.getAttribute('data-drag') === '1' ? '1' : '');
  }

  /* the page's sections, where they are now */
  function mapMarks() {
    marksBox.innerHTML = '';
    marks = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-fader-label]'), function (el) {
      if (!el.offsetHeight || el.closest('[hidden]')) return;
      var top = el.getBoundingClientRect().top + window.scrollY;
      var p = Math.min(1, Math.max(0, top / room()));
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pf-fader__mark';
      b.tabIndex = -1;
      b.textContent = el.getAttribute('data-fader-label');
      b.style.top = Math.round(p * SLOT) + 'px';
      marksBox.appendChild(b);
      var m = { el: b, top: top, label: b.textContent, target: el };
      /* the first mark is the top of the page; the others stop just under the fixed header */
      var head = document.querySelector('header.site');
      var to = marks.length ? Math.max(0, top - (head ? head.getBoundingClientRect().bottom : 0)) : 0;
      b.addEventListener('click', function (e) { e.stopPropagation(); glideTo(Math.min(to, room())); });
      marks.push(m);
    });
    draw();
  }

  /* a glide: eased, quicker for short distances, stopped by the reader */
  function stopGlide() { if (glide) cancelAnimationFrame(glide); glide = 0; }
  function jump(y) { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); }
  function glideTo(y) {
    stopGlide();
    var from = window.scrollY;
    var to = Math.min(Math.max(0, y), room());
    var d = to - from;
    if (!d) return;
    if (reduce.matches) return jump(to);
    var ms = Math.min(1100, Math.max(380, Math.abs(d) * 0.35));
    var t0 = 0;
    var step = function (t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / ms);
      var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      jump(from + d * e);
      glide = k < 1 ? requestAnimationFrame(step) : 0;
    };
    glide = requestAnimationFrame(step);
  }
  ['wheel', 'touchstart', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (glide && !(ev === 'keydown' && e.target === box)) stopGlide(); }, { passive: true });
  });

  /* dragging: the page follows the knob, eased a little so it does not judder */
  var want = null;
  var follow = 0;
  function chase() {
    if (want == null) { follow = 0; return; }
    var y = window.scrollY;
    var next = reduce.matches ? want : y + (want - y) * 0.35;
    if (Math.abs(want - next) < 1) next = want;
    jump(next);
    follow = next === want && box.getAttribute('data-drag') !== '1' ? 0 : requestAnimationFrame(chase);
    if (!follow) want = null;
  }
  function atPointer(clientY) {
    var r = slot.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientY - r.top) / SLOT)) * room();
  }
  knob.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    stopGlide();
    box.setAttribute('data-drag', '1');
    knob.setPointerCapture(e.pointerId);
    want = atPointer(e.clientY);
    if (!follow) follow = requestAnimationFrame(chase);
  });
  knob.addEventListener('pointermove', function (e) {
    if (box.getAttribute('data-drag') !== '1') return;
    want = atPointer(e.clientY);
    if (!follow) follow = requestAnimationFrame(chase);
  });
  function drop() { box.setAttribute('data-drag', ''); draw(); }
  knob.addEventListener('pointerup', drop);
  knob.addEventListener('pointercancel', drop);
  slot.addEventListener('click', function (e) { glideTo(atPointer(e.clientY)); });

  box.addEventListener('keydown', function (e) {
    var p = share();
    var to = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = p + 0.05;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = p - 0.05;
    else if (e.key === 'PageDown') to = p + 0.25;
    else if (e.key === 'PageUp') to = p - 0.25;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = 1;
    if (to == null) return;
    e.preventDefault();
    glideTo(Math.min(1, Math.max(0, to)) * room());
  });

  var queued = 0;
  window.addEventListener('scroll', function () { if (!queued) queued = requestAnimationFrame(function () { queued = 0; draw(); }); }, { passive: true });
  var remap = 0;
  function later() { clearTimeout(remap); remap = setTimeout(mapMarks, 150); }
  window.addEventListener('resize', later);
  window.addEventListener('load', mapMarks);
  if (window.ResizeObserver) new ResizeObserver(later).observe(document.body);
  mapMarks();
})();
