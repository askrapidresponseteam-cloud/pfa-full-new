/* The remote internship's cards (owner, 1 Nov 2026: the field-notes cards,
   "process should be explained 1st and then only if clicks continue. show
   the tasks - mandatory and optional ones. separate lanes for both";
   "nothing should clip anything or overlap/overlay anything").

   How it works comes first: four steps side by side (on a phone, one at a
   time, turned by the arrows or a sideways swipe). Continue shows the tasks
   in two lanes, the five mandatory and the seven optional. A card opens in
   the same place, in place of the steps or the lanes, never over anything,
   and whole: when it holds more than one screen has room for, its
   photograph is left out first, then what is inside is scaled down a
   little until it fits, so nothing is cut and nothing scrolls ("all the
   cards should open without scroll. each one"). Opening a card fires
   "vc:open" on the document, with the card and the reader, for the page to
   draw the certificate in it. */
(function (root) {
  'use strict';
  var doc = root.document;
  var section = doc.getElementById('collection');
  var reader = doc.getElementById('vcReader');
  if (!section || !reader) return;
  var $ = function (s, r) { return (r || section).querySelector(s); };
  var gallery = $('.vc-gal');
  var steps = [].slice.call(section.querySelectorAll('.vc-sl'));
  var process = $('[data-vc-process]'), tasks = $('[data-vc-tasks]');
  var prev = $('[data-vc-prev]'), next = $('[data-vc-next]'), count = $('[data-vc-count]');
  var eyebrow = $('[data-vc-eyebrow]'), title = $('[data-vc-title]');
  var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var view = 'process';
  /* focus moves with the view only for someone using the keyboard: after a
     tap or a click no ring is drawn round the first card or the close */
  var kb = false;
  doc.addEventListener('keydown', function () { kb = true; }, true);
  doc.addEventListener('pointerdown', function () { kb = false; }, true);
  var moveTo = function (el) { if (el && kb) el.focus({ preventScroll: true }); };

  /* ---- how it works ---- */
  var active = 0;
  function go(n) {
    active = Math.max(0, Math.min(steps.length - 1, n));
    if (count) count.textContent = pad(active + 1) + ' / ' + pad(steps.length);
    if (prev) prev.disabled = active === 0;
    if (next) next.disabled = active === steps.length - 1;
    steps.forEach(function (c, i) {
      if (i === active) c.setAttribute('aria-current', 'step'); else c.removeAttribute('aria-current');
    });
  }
  steps.forEach(function (c) { c.addEventListener('click', function () { if (!swiped) open(c); }); });
  if (prev) prev.addEventListener('click', function () { go(active - 1); });
  if (next) next.addEventListener('click', function () { go(active + 1); });
  /* a sideways swipe on a phone turns the steps; up and down is the page's */
  var start = null, swiped = false;
  gallery.addEventListener('pointerdown', function (e) { start = { x: e.clientX, y: e.clientY }; swiped = false; });
  gallery.addEventListener('pointerup', function (e) {
    if (!start) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped = true;
      go(active + (dx < 0 ? 1 : -1));
      root.setTimeout(function () { swiped = false; }, 0);
    }
  });
  gallery.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(active + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(active - 1); }
  });

  /* ---- how it works, then the tasks ---- */
  var heads = {
    process: ['How the internship works', 'Eight weeks. Real work. A kinder town.'],
    tasks: ['Your eight-week plan', 'Five for everyone. Three of your choosing.']
  };
  function toTop() {
    var top = section.getBoundingClientRect().top;
    var bar = parseFloat(root.getComputedStyle(section).scrollMarginTop) || 0;
    if (Math.abs(top - bar) > 2) section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  function show(which) {
    view = which;
    var t = which === 'tasks';
    process.hidden = t;
    tasks.hidden = !t;
    if (eyebrow) eyebrow.textContent = heads[which][0];
    if (title) title.textContent = heads[which][1];
    if (headBack) headBack.hidden = !t;
    if (proof) proof.hidden = t;
    toTop();
    var first = t ? tasks.querySelector('.vc-tk') : steps[active];
    moveTo(first);
  }
  var cont = $('[data-vc-continue]'), headBack = $('.vc__acts [data-vc-back]'), proof = $('[data-vc-proof]');
  if (cont) cont.addEventListener('click', function () { show('tasks'); });
  [].forEach.call(section.querySelectorAll('[data-vc-back]'), function (b) { b.addEventListener('click', function () { show('process'); }); });
  [].forEach.call(section.querySelectorAll('.vc-tk'), function (c) {
    c.addEventListener('click', function () { open(c); });
  });

  /* ---- a card, opened in place ---- */
  var rPill = reader.querySelector('[data-rd-pill]'), rTitle = reader.querySelector('[data-rd-title]');
  var rBody = reader.querySelector('[data-rd-body]'), rArt = reader.querySelector('[data-rd-art]');
  var rIn = reader.querySelector('.vc-rd__in'), opened = null;
  function fit() {
    if (reader.hidden) return;
    rIn.style.zoom = '';
    reader.classList.remove('is-noart');
    var over = function () { return reader.scrollHeight > reader.clientHeight + 1; };
    if (over() && rArt.firstChild) reader.classList.add('is-noart');
    var z = 1;
    while (over() && z > 0.55) {
      z = Math.round((z - 0.03) * 100) / 100;
      rIn.style.zoom = String(z);
    }
  }
  function open(c) {
    opened = c;
    var more = c.querySelector('.vc-more');
    /* the certificate's card shows the certificate itself, not a photograph */
    var pic = more && more.querySelector('.vi-cert') ? null : c.querySelector('.vc-sl__ph img, .vc-tk__ph img, .vc-art img');
    rPill.textContent = c.getAttribute('data-pill') || '';
    rTitle.textContent = c.getAttribute('data-title') || '';
    rBody.innerHTML = more ? more.innerHTML : '';
    rArt.innerHTML = '';
    if (pic) {
      var im = pic.cloneNode(true);
      im.removeAttribute('loading');
      im.setAttribute('sizes', '(max-width:760px) 92vw, 440px');
      rArt.appendChild(im);
      if (!im.complete) im.addEventListener('load', fit);
    }
    section.classList.add('is-reading');
    reader.hidden = false;
    toTop();
    fit();
    root.setTimeout(fit, 120);
    root.setTimeout(fit, 500);
    var shut = reader.querySelector('[data-rd-close]');
    moveTo(shut);
    try { doc.dispatchEvent(new root.CustomEvent('vc:open', { detail: { card: c, panel: reader } })); } catch (_) { /* old browsers: the card still opens */ }
  }
  function close() {
    if (reader.hidden) return;
    reader.hidden = true;
    section.classList.remove('is-reading');
    rBody.innerHTML = '';
    moveTo(opened);
    opened = null;
  }
  reader.querySelector('[data-rd-close]').addEventListener('click', close);
  /* a link to a part of this page closes the card, so the page can go there */
  reader.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a[href^="#"]')) close(); });
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !reader.hidden) close(); });
  var t = null;
  root.addEventListener('resize', function () { root.clearTimeout(t); t = root.setTimeout(fit, 120); });

  go(0);
  root.PFAInternshipCards = { go: go, open: open, close: close, show: show, view: function () { return view; } };
}(window));
