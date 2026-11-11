/* The PFA reader: read.html?r=<slug>.

   Opens one document from window.PFA_LIBRARY as it was published: its own
   PDF, from resources/, drawn page by page by assets/reader-pdf.js. Nothing
   is retyped or reflowed; what is on the screen is the document.

     pages    the PDF, turned like a book (one page, or two side by side on
              a wide screen) or scrolled down one long column
     drive    the site does not hold the PDF yet: Google Drive's viewer,
              inside the same quiet frame, with Download going to Drive

   Contents come from the document's index (media/library/<slug>.json,
   written by scripts/build-library.js: its headings and the page each is
   on), or else from the PDF's own bookmarks. The place is a page. It is
   saved in this browser only (localStorage, pfa:library:v1), which is also
   what library.html reads for Continue reading. Settings are kept apart
   (pfa:library:settings) because they belong to the reader, not to the
   document. */
(function () {
  'use strict';

  var LIB = window.PFA_LIBRARY || { shelves: [], items: [] };
  var PROGRESS_KEY = 'pfa:library:v1';
  var SETTINGS_KEY = 'pfa:library:settings';
  var ZOOMS = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5];
  var FIT = 4;
  var PAPER = { light: '#faf8f4', sepia: '#f4ecda', dark: '#161514' };

  var root = document.documentElement;
  var body = document.body;
  function $(id) { return document.getElementById(id); }
  var stage = $('rdStage');
  var book = $('rdPages');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function phone() { return window.innerWidth < 720; }
  function wide() { return window.innerWidth >= 1024; }

  /* ---------------------------------------------------------------------
     storage: every read and write may fail (private windows, blocked
     storage), and the reader must work the same without it
     --------------------------------------------------------------------- */
  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(key);
      var v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function defaultLayout() { return phone() ? 'scroll' : 'paged'; }
  var settings = (function () {
    var s = readJSON(SETTINGS_KEY, {});
    var theme = s.theme === 'light' || s.theme === 'sepia' || s.theme === 'dark' ? s.theme : '';
    if (!theme) theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var zoom = Number(s.zoom);
    return {
      theme: theme,
      zoom: s.zoom === undefined || !isFinite(zoom) ? FIT : clamp(Math.round(zoom), 0, ZOOMS.length - 1),
      layout: s.layout === 'paged' || s.layout === 'scroll' ? s.layout : defaultLayout(),
      spread: Number(s.spread) === 2 ? 2 : 1,
      hinted: !!s.hinted
    };
  }());
  function saveSettings() {
    writeJSON(SETTINGS_KEY, { theme: settings.theme, zoom: settings.zoom, layout: settings.layout, spread: settings.spread, hinted: settings.hinted });
  }

  function loadProgress() {
    var p = readJSON(PROGRESS_KEY, null);
    if (!p || typeof p.items !== 'object' || !p.items) p = { last: null, items: {} };
    return p;
  }

  /* ---------------------------------------------------------------------
     the document
     --------------------------------------------------------------------- */
  var slug = new URLSearchParams(location.search).get('r') || '';
  var item = null;
  for (var n = 0; n < LIB.items.length; n++) if (LIB.items[n].slug === slug) item = LIB.items[n];
  var shelf = null;
  if (item) for (var m = 0; m < LIB.shelves.length; m++) if (LIB.shelves[m].id === item.shelf) shelf = LIB.shelves[m];
  var downloadHref = item ? (item.file || 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(item.drive)) : 'library.html';

  var mode = 'loading';    // loading, pages, drive, missing
  var pdf = null;          // the page engine, once the document is open
  var page = 1;            // the first page on the screen
  var lastPage = 1;        // the last page on the screen (two in a spread)
  var total = item && item.pages ? item.pages : 0;
  var spreadUsed = 1;
  var toc = [];            // [{t, l, p}]
  var returnPos = null;    // where the reader was before jumping to a search result
  var hits = [];
  var panel = null;        // { el, trigger }
  var saveTimer = 0;

  /* two pages side by side only when asked, turning pages, and wide enough */
  function spreadNow() { return settings.layout === 'paged' && settings.spread === 2 && wide() ? 2 : 1; }

  /* the section a page is in: of the entries on the latest page at or
     before it, the first (a chapter, rather than its last subsection) */
  function sectionAt(p) {
    var at = -1;
    for (var k = 0; k < toc.length; k++) if (toc[k].p <= p && (at < 0 || toc[k].p > toc[at].p)) at = k;
    return at;
  }

  /* ---------------------------------------------------------------------
     the chrome: shown on arrival, gone once reading starts, back on a tap
     in the middle, a move to the top or bottom edge, or Escape
     --------------------------------------------------------------------- */
  var hideTimer = 0;
  var scrubbing = false;
  function chromeOn() { return body.classList.contains('rd-chrome'); }
  function showChrome(stay) {
    body.classList.add('rd-chrome');
    clearTimeout(hideTimer);
    if (!stay) hideTimer = setTimeout(hideChrome, 3600);
  }
  /* The bar and the dock no longer step aside (owner, 8 Oct 2026: a page
     open and no way back). These stay as the places that used to hide
     them, so every caller keeps working; the chrome is simply always on. */
  function hideChrome() {
    clearTimeout(hideTimer);
    body.classList.add('rd-chrome');
  }
  function toggleChrome() { showChrome(true); }

  document.addEventListener('mousemove', function (event) {
    if (panel || mode !== 'pages') return;
    var y = event.clientY;
    if (y < 64 || y > window.innerHeight - 70) { if (!chromeOn()) showChrome(); }
  }, { passive: true });

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $('rdToast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, ms || 3200);
  }
  function note(msg) {
    var old = document.querySelector('.rd-note');
    if (old) old.parentNode.removeChild(old);
    var box = document.createElement('div');
    box.className = 'rd-note';
    box.setAttribute('role', 'status');
    var p = document.createElement('span');
    p.textContent = msg;
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '\u00D7';
    x.addEventListener('click', function () { box.parentNode.removeChild(box); });
    box.appendChild(p);
    box.appendChild(x);
    body.appendChild(box);
  }
  function loading(on) { $('rdProgress').hidden = !on; }

  /* ---------------------------------------------------------------------
     settings
     --------------------------------------------------------------------- */
  function pressed(key, value) {
    var btns = document.querySelectorAll('[data-k="' + key + '"]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(btns[i].getAttribute('data-v') === String(value)));
  }
  function setFill(input) {
    var min = Number(input.min) || 0;
    var max = Number(input.max) || 100;
    input.style.setProperty('--fill', ((Number(input.value) - min) / (max - min || 1)) * 100 + '%');
  }

  function paintSettings() {
    root.setAttribute('data-theme', settings.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', PAPER[settings.theme] || PAPER.light);
    body.setAttribute('data-layout', settings.layout);
    ['theme', 'layout', 'spread'].forEach(function (k) { pressed(k, settings[k]); });
    var size = $('rdSize');
    size.value = String(settings.zoom);
    setFill(size);
    $('rdSizeOut').textContent = settings.zoom === FIT ? 'Fit' : Math.round(ZOOMS[settings.zoom] * 100) + '%';
    $('rdSizeDown').disabled = settings.zoom <= 0;
    $('rdSizeUp').disabled = settings.zoom >= ZOOMS.length - 1;
    document.querySelector('#rdAa .rd-cols-two').hidden = settings.layout !== 'paged';
  }

  /* draw the pages again for the current zoom, layout and spread */
  function redraw() {
    if (!pdf) return;
    spreadUsed = spreadNow();
    pdf.configure({ zoom: ZOOMS[settings.zoom], layout: settings.layout, spread: spreadUsed });
  }

  function change(key, value) {
    if (key === 'spread') value = Number(value) === 2 ? 2 : 1;
    if (settings[key] === value) return;
    settings[key] = value;
    saveSettings();
    paintSettings();
    redraw();
  }

  function nudgeZoom(step) {
    var z = clamp(settings.zoom + step, 0, ZOOMS.length - 1);
    if (z === settings.zoom) return;
    settings.zoom = z;
    saveSettings();
    paintSettings();
    redraw();
  }

  /* ---------------------------------------------------------------------
     where the reader is
     --------------------------------------------------------------------- */
  function fraction() {
    if (!total) return 0;
    if (lastPage >= total) return 1;
    return total > 1 ? (page - 1) / (total - 1) : 1;
  }
  function pageLabel() {
    if (!total) return 'Page ' + page;
    if (lastPage > page) return 'Pages ' + page + '-' + lastPage + ' of ' + total;
    return 'Page ' + page + ' of ' + total;
  }

  function paintWhere() {
    var f = fraction();
    var pct = Math.round(f * 100);
    var label = pageLabel();
    var k = sectionAt(page);
    $('rdWhere').textContent = label;
    $('rdPct').textContent = pct + '%';
    $('rdFootPct').textContent = label + ' \u00B7 ' + pct + '%';
    $('rdFootLeft').textContent = k >= 0 ? toc[k].t : '';
    if (!scrubbing) { $('rdScrub').value = String(Math.round(f * 1000)); setFill($('rdScrub')); }
    $('rdTocWhere').textContent = label + ' \u00B7 ' + (pct >= 100 ? 'Finished' : pct + '% read');
    $('rdTocBar').style.width = Math.max(pct, 1) + '%';
    if (panel && panel.el.id === 'rdToc') markToc();
  }

  function save() {
    if (!item || returnPos || (mode !== 'pages' && mode !== 'drive')) return;
    var all = loadProgress();
    var entry = all.items[slug] || {};
    entry.at = Date.now();
    entry.mode = mode;
    delete entry.i;
    delete entry.c;
    if (mode === 'pages' && total) {
      entry.pdfPage = page;
      entry.page = page;
      entry.pages = total;
      entry.pct = Math.round(fraction() * 1000) / 1000;
      entry.done = lastPage >= total;
    }
    all.items[slug] = entry;
    all.last = slug;
    writeJSON(PROGRESS_KEY, all);
  }

  /* the scrubber: drag to anywhere, see where you will land first */
  (function () {
    var scrub = $('rdScrub');
    var wrap = $('rdScrubWrap');
    var tip = $('rdScrubTip');
    function target() { return clamp(Math.round(Number(scrub.value) / 1000 * (total - 1)) + 1, 1, total || 1); }
    scrub.addEventListener('input', function () {
      scrubbing = true;
      wrap.classList.add('is-dragging');
      setFill(scrub);
      if (mode !== 'pages') return;
      var p = target();
      var k = sectionAt(p);
      tip.textContent = 'Page ' + p + (k >= 0 ? ' \u00B7 ' + toc[k].t : '');
      var w = scrub.getBoundingClientRect().width;
      tip.style.left = clamp(Number(scrub.value) / 1000 * w, 60, w - 60) + 'px';
      showChrome(true);
    });
    scrub.addEventListener('change', function () {
      scrubbing = false;
      wrap.classList.remove('is-dragging');
      if (mode === 'pages' && pdf) pdf.goToPage(target());
      showChrome();
    });
  }());

  /* ---------------------------------------------------------------------
     turning: taps and clicks at the edges, keys, the wheel and the swipe
     --------------------------------------------------------------------- */
  function paged() { return mode === 'pages' && pdf && settings.layout === 'paged'; }

  function turn(dir) {
    if (!pdf) return;
    var moved = dir > 0 ? pdf.next() : pdf.prev();
    if (!moved) {
      if (dir > 0) toast('That is the last page. Back to the library from the bar above.');
      return;
    }
    if (!settings.hinted) { settings.hinted = true; saveSettings(); }
    if (chromeOn() && !panel) hideChrome();
  }

  var swiped = 0;
  stage.addEventListener('click', function (event) {
    if (Date.now() - swiped < 400) return;
    var t = event.target;
    if (t.closest && t.closest('a, button, input')) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    if (panel) { closePanel(); return; }
    if (paged() && !pdf.overflowing()) {
      var x = event.clientX / window.innerWidth;
      if (x < 0.26) { turn(-1); return; }
      if (x > 0.74) { turn(1); return; }
    }
    toggleChrome();
  });
  $('rdPrev').addEventListener('click', function () { turn(-1); });
  $('rdNext').addEventListener('click', function () { turn(1); });

  document.addEventListener('keydown', function (event) {
    var k = event.key;
    var typing = event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && event.target.type !== 'range';
    if ((event.ctrlKey || event.metaKey) && (k === 'f' || k === 'F') && mode === 'pages') {
      event.preventDefault();
      openFind();
      return;
    }
    if (k === 'Escape') {
      if (panel) { closePanel(); event.preventDefault(); return; }
      if (returnPos) { goBack(); return; }
      toggleChrome();
      return;
    }
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (panel && panel.el.id !== 'rdAa') return;
    if (event.target && event.target.type === 'range') return;
    if (mode !== 'pages' || !pdf) return;
    if (k === '/') { event.preventDefault(); openFind(); return; }
    if (k === '+' || k === '=') { nudgeZoom(1); return; }
    if (k === '-' || k === '_') { nudgeZoom(-1); return; }
    if (k === 'Home') { event.preventDefault(); pdf.goToPage(1); return; }
    if (k === 'End') { event.preventDefault(); pdf.goToPage(total); return; }
    var turnsAll = paged() && !pdf.overflowing();
    if (k === 'ArrowRight' || (turnsAll && (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !event.shiftKey)))) { event.preventDefault(); turn(1); }
    else if (k === 'ArrowLeft' || (turnsAll && (k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && event.shiftKey)))) { event.preventDefault(); turn(-1); }
  });

  /* the wheel turns the page while the page fits the screen; a page made
     larger than the screen scrolls instead */
  var wheelAcc = 0;
  var wheelAt = 0;
  var turnedAt = 0;
  stage.addEventListener('wheel', function (event) {
    if (!paged() || event.ctrlKey || pdf.overflowing()) return;
    event.preventDefault();
    var now = Date.now();
    if (now - wheelAt > 240) wheelAcc = 0;
    wheelAt = now;
    if (now - turnedAt < 420) return;
    wheelAcc += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(wheelAcc) < 50) return;
    turnedAt = now;
    turn(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0;
  }, { passive: false });

  (function () {
    var x0 = 0;
    var y0 = 0;
    var t0 = 0;
    var dragging = false;
    var leafEl = null;
    stage.addEventListener('touchstart', function (event) {
      t0 = 0;
      if (!paged() || event.touches.length !== 1 || pdf.overflowing()) return;
      x0 = event.touches[0].clientX;
      y0 = event.touches[0].clientY;
      t0 = Date.now();
      dragging = false;
      leafEl = book.querySelector('.rd-leaf');
    }, { passive: true });
    stage.addEventListener('touchmove', function (event) {
      if (!t0) return;
      if (event.touches.length !== 1) { t0 = 0; return; }
      var dx = event.touches[0].clientX - x0;
      var dy = event.touches[0].clientY - y0;
      if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) dragging = true;
      if (!dragging) return;
      event.preventDefault();
      if (leafEl) leafEl.style.transform = 'translateX(' + Math.round(dx * 0.35) + 'px)';
    }, { passive: false });
    stage.addEventListener('touchend', function (event) {
      if (!t0) return;
      var dx = (event.changedTouches[0] ? event.changedTouches[0].clientX : x0) - x0;
      var fast = Date.now() - t0 < 280 && Math.abs(dx) > 30;
      t0 = 0;
      if (leafEl) leafEl.style.transform = '';
      if (!dragging) return;
      dragging = false;
      swiped = Date.now();
      if (dx < -60 || (fast && dx < 0)) turn(1);
      else if (dx > 60 || (fast && dx > 0)) turn(-1);
    });
  }());

  window.addEventListener('resize', (function () {
    var t = 0;
    return function () {
      clearTimeout(t);
      t = setTimeout(function () {
        paintSettings();
        if (pdf && spreadNow() !== spreadUsed) redraw();
      }, 200);
    };
  }()));

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('pagehide', save);
  /* Right-click is off site-wide (assets/chrome.js); the reader keeps the
     rule, except in the search box, where pasting a phrase is the point. */
  document.addEventListener('contextmenu', function (event) {
    if (event.target && /^(INPUT|TEXTAREA)$/.test(event.target.tagName)) return;
    event.preventDefault();
  }, true);

  /* ---------------------------------------------------------------------
     panels
     --------------------------------------------------------------------- */
  function focusables(el) {
    return Array.prototype.filter.call(el.querySelectorAll('button, a[href], input, [tabindex="0"]'), function (x) {
      return !x.disabled && x.offsetParent !== null;
    });
  }
  function openPanel(el, trigger, focusEl) {
    if (panel && panel.el === el) { closePanel(); return; }
    closePanel(true);
    el.hidden = false;
    var scrim = $('rdScrim');
    var modal = el.id !== 'rdAa' || phone();
    if (modal) { scrim.hidden = false; requestAnimationFrame(function () { scrim.classList.add('is-on'); }); }
    requestAnimationFrame(function () { el.classList.add('is-on'); });
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    panel = { el: el, trigger: trigger };
    showChrome(true);
    setTimeout(function () { (focusEl || focusables(el)[0] || el).focus({ preventScroll: true }); }, 60);
  }
  function closePanel(quick) {
    if (!panel) return;
    var el = panel.el;
    var trigger = panel.trigger;
    panel = null;
    el.classList.remove('is-on');
    var scrim = $('rdScrim');
    scrim.classList.remove('is-on');
    setTimeout(function () { if (!el.classList.contains('is-on')) el.hidden = true; if (!panel) scrim.hidden = true; }, quick ? 0 : 320);
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (!quick) trigger.focus({ preventScroll: true });
    }
    if (!quick) hideTimer = setTimeout(hideChrome, 2400);
  }
  $('rdScrim').addEventListener('click', function () { closePanel(); });
  document.addEventListener('mousedown', function (event) {
    if (!panel || panel.el.id !== 'rdAa') return;
    if (panel.el.contains(event.target) || $('rdAaBtn').contains(event.target)) return;
    closePanel();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab' || !panel || panel.el.id === 'rdAa') return;
    var f = focusables(panel.el);
    if (!f.length) return;
    if (event.shiftKey && document.activeElement === f[0]) { event.preventDefault(); f[f.length - 1].focus(); }
    else if (!event.shiftKey && document.activeElement === f[f.length - 1]) { event.preventDefault(); f[0].focus(); }
  });

  function openToc() {
    buildToc();
    openPanel($('rdToc'), $('rdTocBtn'), document.querySelector('#rdTocList .is-here button'));
  }
  $('rdAaBtn').addEventListener('click', function () { openPanel($('rdAa'), $('rdAaBtn')); });
  $('rdAaClose').addEventListener('click', function () { closePanel(); });
  $('rdTocBtn').addEventListener('click', openToc);
  $('rdTocClose').addEventListener('click', function () { closePanel(); });
  $('rdFindBtn').addEventListener('click', function () { openFind(); });
  $('rdFindClose').addEventListener('click', function () { closePanel(); });

  $('rdAa').addEventListener('click', function (event) {
    var b = event.target.closest('[data-k]');
    if (!b || b.disabled) return;
    change(b.getAttribute('data-k'), b.getAttribute('data-v'));
  });
  $('rdSize').addEventListener('input', function () { nudgeZoom(Number($('rdSize').value) - settings.zoom); });
  $('rdSizeDown').addEventListener('click', function () { nudgeZoom(-1); });
  $('rdSizeUp').addEventListener('click', function () { nudgeZoom(1); });
  $('rdReset').addEventListener('click', function () {
    settings.zoom = FIT;
    settings.layout = defaultLayout();
    settings.spread = 1;
    saveSettings();
    paintSettings();
    redraw();
  });

  /* ---- contents ---- */
  function buildToc() {
    var list = $('rdTocList');
    list.innerHTML = '';
    if (!toc.length) {
      var li = document.createElement('li');
      li.className = 'rd-toc__empty';
      li.textContent = mode === 'drive'
        ? 'Contents are not available in this view.'
        : 'This document has no contents list to show. Use the slider at the foot of the page, or search, to move through it.';
      list.appendChild(li);
      return;
    }
    toc.forEach(function (t, k) {
      var li = document.createElement('li');
      if (t.l > 1) li.className = 'is-l' + t.l;
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-k', String(k));
      var a = document.createElement('span');
      a.textContent = t.t;
      var p = document.createElement('span');
      p.textContent = String(t.p);
      b.appendChild(a);
      b.appendChild(p);
      li.appendChild(b);
      list.appendChild(li);
    });
    markToc();
  }
  function markToc() {
    var items = document.querySelectorAll('#rdTocList li');
    var here = sectionAt(page);
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('is-here', j === here);
  }
  $('rdTocList').addEventListener('click', function (event) {
    var b = event.target.closest('button[data-k]');
    if (!b) return;
    var t = toc[Number(b.getAttribute('data-k'))];
    closePanel();
    if (t && pdf) pdf.goToPage(t.p);
  });
  $('rdTocStart').addEventListener('click', function () {
    closePanel();
    if (pdf) pdf.goToPage(1);
  });

  /* entries with a page in the document; the first at the top level, and
     none more than one level below the one before it */
  function cleanToc(list) {
    var out = [];
    var prev = 0;
    (Array.isArray(list) ? list : []).forEach(function (t) {
      var title = t && typeof t.t === 'string' ? t.t.replace(/\s+/g, ' ').trim() : '';
      var p = t ? Math.round(Number(t.p)) : 0;
      if (!title || p < 1 || (total && p > total)) return;
      var l = clamp(Math.min(Number(t.l) || 1, prev + 1), 1, 3);
      out.push({ t: title, l: l, p: p });
      prev = l;
    });
    return out;
  }

  function loadToc() {
    var fromIndex = item.index
      ? fetch(item.index, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (ix) { return ix && ix.toc; })
        .catch(function () { return null; })
      : Promise.resolve(null);
    fromIndex.then(function (list) {
      list = cleanToc(list);
      if (list.length || !pdf) return list;
      return pdf.outline().then(cleanToc);
    }).then(function (list) {
      toc = list;
      paintWhere();
      if (panel && panel.el.id === 'rdToc') buildToc();
    });
  }

  /* ---------------------------------------------------------------------
     search: every occurrence, with the page it is on; choosing one goes
     there, marks it where it is printed, and offers the way back
     --------------------------------------------------------------------- */
  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
  }
  function query() { return norm($('rdFindInput').value).replace(/\s+/g, ' ').trim(); }
  function openFind() {
    if (mode !== 'pages') return;
    openPanel($('rdFind'), $('rdFindBtn'), $('rdFindInput'));
    var input = $('rdFindInput');
    setTimeout(function () { input.select(); }, 80);
  }

  var findTimer = 0;
  var shown = 0;
  $('rdFindInput').addEventListener('input', function () {
    clearTimeout(findTimer);
    findTimer = setTimeout(runSearch, 220);
  });
  $('rdFindInput').addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    clearTimeout(findTimer);
    runSearch().then(function () {
      var first = document.querySelector('#rdFindList button[data-n]');
      if (first) first.focus();
    });
  });

  var lastQuery = '';
  var running = null;
  function runSearch() {
    var q = query();
    if (q === lastQuery && running) return running;
    lastQuery = q;
    var list = $('rdFindList');
    var count = $('rdFindCount');
    list.innerHTML = '';
    hits = [];
    $('rdFindTips').hidden = q.length >= 2;
    if (q.length < 2 || !pdf) { count.textContent = ''; running = null; return Promise.resolve(); }
    count.textContent = 'Searching\u2026';
    running = pdf.search(q).then(function (res) {
      if (query() !== q) return;
      hits = res;
      paintHits(q);
    });
    return running;
  }

  function snippet(source, start, len) {
    var a = Math.max(0, start - 70);
    var b = Math.min(source.length, start + len + 110);
    if (a > 0) { var sp = source.indexOf(' ', a); if (sp > -1 && sp < start) a = sp + 1; }
    if (b < source.length) { var sp2 = source.lastIndexOf(' ', b); if (sp2 > start + len) b = sp2; }
    return (a > 0 ? '\u2026' : '') + esc(source.slice(a, start)) + '<mark>' + esc(source.slice(start, start + len)) + '</mark>' + esc(source.slice(start + len, b)) + (b < source.length ? '\u2026' : '');
  }

  function paintHits(q) {
    var count = $('rdFindCount');
    shown = 0;
    $('rdFindList').innerHTML = '';
    if (!hits.length) { count.textContent = 'Not found in this document.'; return; }
    count.textContent = (hits.length >= 1000 ? 'More than 1,000' : hits.length) + (hits.length === 1 ? ' result' : ' results') + ' for \u201C' + q + '\u201D';
    moreHits();
  }

  function moreHits() {
    var list = $('rdFindList');
    var old = list.querySelector('.rd-find__more');
    if (old) list.removeChild(old.parentNode);
    var end = Math.min(hits.length, shown + 60);
    var frag = document.createDocumentFragment();
    for (var i = shown; i < end; i++) {
      var h = hits[i];
      var k = sectionAt(h.page);
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-n', String(i));
      b.innerHTML = '<span class="rd-find__where">' + esc('Page ' + h.page + (k >= 0 ? ' \u00B7 ' + toc[k].t : '')) + '</span>' +
        '<span class="rd-find__snip">' + snippet(h.text, h.start, h.len) + '</span>';
      li.appendChild(b);
      frag.appendChild(li);
    }
    list.appendChild(frag);
    shown = end;
    if (shown < hits.length) {
      var li2 = document.createElement('li');
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'rd-pill rd-find__more';
      more.textContent = 'Show more results (' + (hits.length - shown) + ' left)';
      li2.appendChild(more);
      list.appendChild(li2);
    }
  }

  $('rdFindList').addEventListener('click', function (event) {
    if (event.target.closest('.rd-find__more')) { moreHits(); return; }
    var b = event.target.closest('button[data-n]');
    if (!b) return;
    var on = document.querySelector('#rdFindList button.is-on');
    if (on) on.classList.remove('is-on');
    b.classList.add('is-on');
    jumpToHit(Number(b.getAttribute('data-n')));
  });

  function jumpToHit(i) {
    var h = hits[i];
    if (!h || !pdf) return;
    if (!returnPos) returnPos = { page: page };
    closePanel(true);
    pdf.jump(h);
    paintReturn();
    hideChrome();
  }

  function paintReturn() {
    var box = $('rdReturn');
    if (!returnPos) { box.hidden = true; return; }
    $('rdReturnText').textContent = 'Back to page ' + returnPos.page;
    box.hidden = false;
  }

  function goBack() {
    var back = returnPos;
    returnPos = null;
    paintReturn();
    if (pdf) pdf.clearHits();
    if (back && pdf) pdf.goToPage(back.page);
    save();
  }
  $('rdReturnGo').addEventListener('click', goBack);
  $('rdReturnStay').addEventListener('click', function () {
    returnPos = null;
    paintReturn();
    if (pdf) pdf.clearHits();
    save();
  });

  /* ---------------------------------------------------------------------
     opening the document
     --------------------------------------------------------------------- */
  function setMode(next) {
    mode = next;
    body.setAttribute('data-mode', next);
    $('rdTocBtn').disabled = next !== 'pages';
    $('rdFindBtn').disabled = next !== 'pages';
    $('rdAaBtn').disabled = next === 'drive' || next === 'missing';
    book.hidden = next === 'drive';
  }

  function loadEngine() {
    if (window.PFA_READER_PDF) return Promise.resolve(window.PFA_READER_PDF);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'assets/reader-pdf.js';
      s.onload = function () { if (window.PFA_READER_PDF) resolve(window.PFA_READER_PDF); else reject(new Error('engine')); };
      s.onerror = function () { reject(new Error('engine')); };
      document.head.appendChild(s);
    });
  }

  /* While pdf.js and the first page arrive, the cover the library showed. */
  function waiting() {
    if (!item.cover) return;
    var img = document.createElement('img');
    img.className = 'rd-wait';
    img.src = item.cover;
    img.alt = '';
    if (item.coverW && item.coverH) { img.width = item.coverW; img.height = item.coverH; }
    book.appendChild(img);
  }

  function hint() {
    if (settings.hinted || settings.layout !== 'paged') return;
    var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
    toast(touch ? 'Tap near either edge, or swipe, to turn the page.' : 'Turn the page with the arrow keys, a click near either edge, or the wheel.', 5200);
  }

  /* ?debug=1: what the reader did, on the screen, for a phone where it
     does not work (owner, 7 Oct 2026: books blank on a phone, drawn
     everywhere else). Nothing is sent anywhere; it is only shown. */
  var debugBox = null;
  var bootAt = Date.now();
  function log(msg) {
    if (!/[?&]debug=1\b/.test(location.search)) return;
    if (!debugBox) {
      debugBox = document.createElement('pre');
      debugBox.className = 'rd-debug';
      debugBox.setAttribute('aria-live', 'polite');
      document.body.appendChild(debugBox);
      debugBox.textContent = navigator.userAgent + '\n' + 'screen ' + window.innerWidth + 'x' + window.innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x, theme ' + settings.theme + ', layout ' + settings.layout + '\n';
      window.addEventListener('error', function (e) { log('error: ' + (e.message || e.type) + ' ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || '')); }, true);
      window.addEventListener('unhandledrejection', function (e) { var r = e.reason; log('rejection: ' + ((r && (r.message || r.name)) || r)); });
    }
    debugBox.textContent += ((Date.now() - bootAt) / 1000).toFixed(1) + 's ' + msg + '\n';
  }

  /* No page on screen after twenty seconds: say so, and offer the two ways
     that do not depend on drawing here, the PDF itself and Google's viewer. */
  var anyDrawn = false;
  var stuckTimer = 0;
  function watch() {
    clearTimeout(stuckTimer);
    stuckTimer = setTimeout(function () {
      if (anyDrawn || mode === 'drive' || mode === 'missing') return;
      log('no page drawn after 20s');
      var old = document.querySelector('.rd-note');
      if (old) old.parentNode.removeChild(old);
      var box = document.createElement('div');
      box.className = 'rd-note rd-note--stuck';
      box.setAttribute('role', 'status');
      box.innerHTML = '<span>This book is taking long to appear on this device.</span>' +
        '<a class="rd-pill" href="' + esc(item.read || item.file) + '" target="_blank" rel="noopener">Open the PDF</a>' +
        /* PFA's own documents (the fireworks guide) have no Drive original */
        (item.drive ? '<button type="button" class="rd-pill" data-drive>Google\u2019s viewer</button>' : '');
      if (item.drive) box.querySelector('[data-drive]').addEventListener('click', function () { box.parentNode.removeChild(box); openDrive(); });
      body.appendChild(box);
      showChrome(true);
    }, 20000);
  }

  function openPages(startPage) {
    setMode('loading');
    loading(true);
    waiting();
    watch();
    log('opening ' + (item.read || item.file));
    return loadEngine().then(function (engine) {
      spreadUsed = spreadNow();
      /* the reading copy when there is one (photographs sized for a
         screen, first page first); Download stays the original. The copies
         are made on GitHub after a push (.github/workflows/reading-copies.yml),
         so for a few minutes after a deploy one may not exist yet: then the
         original opens instead, as it always did. */
      function from(url) {
        return engine.open({
        url: url,
        container: book,
        startPage: startPage,
        zoom: ZOOMS[settings.zoom],
        layout: settings.layout,
        spread: spreadUsed,
        onPage: function (p, t, last) {
          page = p;
          total = t;
          lastPage = Math.max(p, last || p);
          paintWhere();
          clearTimeout(saveTimer);
          saveTimer = setTimeout(save, 400);
        },
        onScroll: function () { if (chromeOn() && !panel && !scrubbing) hideChrome(); },
        onDrawn: function (n) {
          if (!anyDrawn) log('first page on screen: page ' + n);
          anyDrawn = true;
          var stuck = document.querySelector('.rd-note--stuck');
          if (stuck) stuck.parentNode.removeChild(stuck);
        },
        log: log
        });
      }
      if (!item.read) return from(item.file);
      return from(item.read).catch(function (error) {
        log('reading copy failed (' + ((error && error.message) || error) + '), opening the original');
        book.innerHTML = '';
        return from(item.file);
      });
    }).then(function (api) {
      pdf = api;
      total = api.total;
      setMode('pages');
      loading(false);
      paintWhere();
      showChrome();
      loadToc();
      hint();
    }).catch(function (error) {
      log('could not open: ' + ((error && error.message) || error));
      loading(false);
      book.innerHTML = '';
      if (item.drive) openDrive('This document could not be drawn here, so it is shown in Google Drive\u2019s viewer.');
      else window.location.replace(item.file);
    });
  }

  function openDrive(why) {
    if (pdf) { pdf.destroy(); pdf = null; }
    setMode('drive');
    /* Written as markup so the security test reads it as what it is, a frame
       (drive.google.com is in the policy's frame-src). */
    var holder = document.createElement('div');
    holder.innerHTML = '<iframe class="rd-drive" src="https://drive.google.com/file/d/' + encodeURIComponent(item.drive) + '/preview" title="' +
      esc(item.title) + ', the original document" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>';
    var frameEl = holder.firstChild;
    loading(true);
    frameEl.addEventListener('load', function () { loading(false); });
    setTimeout(function () { loading(false); }, 8000);
    body.appendChild(frameEl);
    showChrome(true);
    note(why || 'This document is not on this site yet, so it opens in Google Drive\u2019s viewer. Download keeps a copy.');
    save();
  }

  function notFound() {
    setMode('missing');
    $('rdDl').hidden = true;
    loading(false);
    book.innerHTML = '<div class="rd-missing"><p class="rd-missing__kind">PFA Library</p>' +
      '<p class="rd-missing__title">This document is not on the shelves</p>' +
      '<p class="rd-missing__text">The link may be old or mistyped. Every document in the library is listed on its shelves.</p>' +
      '<a class="rd-pill" href="library.html">Back to the library</a></div>';
    showChrome(true);
  }

  /* Back: to the page of this site the reader came from (the shelves, a law,
     a search result), at the same scroll, and it says so; otherwise to the
     library. Opened from outside the site, or in a new tab, it is "Library". */
  var cameFrom = (function () {
    var ref = document.referrer || '';
    if (!ref || ref.indexOf(location.origin) !== 0) return '';
    var where = ref.slice(location.origin.length);
    if (/^\/read(\.html)?([?#]|$)/.test(where)) return '';
    return history.length > 1 ? where : '';
  }());
  if (cameFrom && !/^\/library(\.html)?([?#]|$)/.test(cameFrom)) {
    $('rdBack').querySelector('span').textContent = 'Back';
    $('rdBack').setAttribute('aria-label', 'Back to the page you came from');
  }
  $('rdBack').addEventListener('click', function (event) {
    if (!cameFrom) return;
    event.preventDefault();
    save();
    history.back();
  });

  function start() {
    paintSettings();
    if (!item) { notFound(); return; }
    document.title = item.title + ' | PFA Library';
    $('rdTitle').textContent = item.title;
    $('rdTocTitle').textContent = item.title;
    $('rdTocKind').textContent = item.kind || (shelf ? shelf.name : 'PFA Library');
    if (item.lang) book.setAttribute('lang', item.lang);
    [$('rdDl'), $('rdTocDl')].forEach(function (a) {
      a.href = downloadHref;
      if (item.file) a.setAttribute('download', item.name || item.slug + '.pdf');
      else { a.target = '_blank'; a.rel = 'noopener'; }
    });
    var saved = loadProgress().items[slug] || null;
    var at = saved ? Number(saved.pdfPage || saved.page) || 1 : 1;
    if (item.file) openPages(clamp(at, 1, total || at));
    else openDrive();
  }

  start();
}());
