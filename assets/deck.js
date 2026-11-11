/* The deck: a stack of cards, one at a time (assets/deck.css).

   Every card has a resting place in both views, written as CSS variables
   and reached through one transition on the card's transform, so turning
   the deck, opening a card and laying every card out are the same move at
   different sizes. Next card turns the deck; Show me (or the card itself)
   opens it into a panel holding the card's .card__more; the switch at the
   foot lays every card out at once.

   Mounted on every section.deck on the page (the Academy, the remote
   internship). Inside it: .deck__stage, .deck__cards > .card, .deck__next,
   .deck__show, .deck__panel with .deck__close and [data-deck-pill],
   [data-deck-title], [data-deck-body], [data-deck-art], and the view switch
   [data-deck-one], [data-deck-all]. data-deck-row keeps the laid-out view
   to one row; data-deck-start="row" opens that way on a wide screen.
   Opening a card fires "deck:open" on the
   section, with the card and the panel, for a page that has more to do in
   it (the internship draws its certificate there). */
(function (root) {
  'use strict';

  function mount(deck) {
    var q = function (sel) { return deck.querySelector(sel); };
    var stage = q('.deck__stage');
    var cards = [].slice.call(deck.querySelectorAll('.deck__cards > .card'));
    if (!stage || !cards.length || deck.__deck) return null;
    deck.__deck = true;
    var panel = q('.deck__panel'), pPill = q('[data-deck-pill]'), pTitle = q('[data-deck-title]'), pBody = q('[data-deck-body]'), pArt = q('[data-deck-art]');
    var nextBtn = q('.deck__next'), showBtn = q('.deck__show'), closeBtn = q('.deck__close'), oneBtn = q('[data-deck-one]'), allBtn = q('[data-deck-all]');
    var i = 0, grid = false, opened = null;
    /* a size as the page set it: a plain length, or a calc() or clamp() of
       the screen's height, measured on a hidden probe so either reads true */
    var probe = document.createElement('i');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:0;left:0;top:0';
    deck.appendChild(probe);
    function len(expr) { probe.style.width = expr; return probe.getBoundingClientRect().width; }
    /* the height of everything in the section but the cards: its padding,
       its heading and its view switch */
    function besideStage() {
      var cs = getComputedStyle(deck), h = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      [].forEach.call(deck.children, function (el) {
        if (el === stage || el === probe || el.classList.contains('deck__panel')) return;
        var es = getComputedStyle(el);
        if (es.position === 'absolute' || es.position === 'fixed' || es.display === 'none') return;
        h += el.offsetHeight + parseFloat(es.marginTop) + parseFloat(es.marginBottom);
      });
      return h + parseFloat(getComputedStyle(stage).marginTop);
    }
    function px(name) {
      probe.style.width = 'var(' + name + ')';
      return probe.getBoundingClientRect().width || parseFloat(getComputedStyle(deck).getPropertyValue(name)) || 0;
    }
    function put(c, x, y, r, s, off, z) {
      c.style.setProperty('--x', x + 'px'); c.style.setProperty('--y', y + 'px');
      c.style.setProperty('--r', r + 'deg'); c.style.setProperty('--s', String(s));
      if (off) c.setAttribute('data-off', ''); else c.removeAttribute('data-off');
      c.style.zIndex = String(z);
    }
    function layout() {
      var cw = px('--cw'), ch = px('--ch');
      if (!grid) {
        stage.style.height = '';
        cards.forEach(function (c, k) {
          var d = k - i, side = d % 2 ? 1 : -1;
          if (d < 0) put(c, -cw * 1.6, 40, -22, 0.9, true, 0);
          /* the stack: each card behind sits a little down and to the side,
             turned a hair the other way from the one in front of it */
          else if (d < 4) put(c, side * d * 5, d * 9, side * d * 2.2, 1 - d * 0.03, false, 20 - d);
          else put(c, 0, 36, 0, 0.88, true, 0);
          c.tabIndex = d === 0 ? 0 : -1;
        });
      } else {
        var gw = px('--gw'), gap = px('--gap');
        var W = stage.clientWidth;
        var cols = Math.min(cards.length, Math.max(2, Math.floor((W + gap) / (gw + gap))));
        /* data-deck-row, on a screen wide enough: every card shown at once,
           as large as both the width and the height of one screen allow
           (never larger than the card itself), in as many rows as gives the
           largest card, so the whole set is seen without scrolling (the
           internship's tasks, then its process) */
        if (deck.hasAttribute('data-deck-row') && W >= 600) {
          var room = len('calc(100svh - var(--ann,34px) - var(--nav,81px) - var(--tabbar,0px))') - besideStage() - 40;
          var best = 0, bestCols = cols;
          for (var n = cards.length; n >= 2; n -= 1) {
            var r = Math.ceil(cards.length / n);
            var g = Math.min(cw, (W - gap * (n - 1)) / n, ((room - gap * (r - 1)) / r) * cw / ch);
            if (g > best + 0.5) { best = g; bestCols = n; }
          }
          if (best >= 110) { gw = best; cols = bestCols; }
        }
        /* never wider than the stage: on a narrow screen the cards shrink to
           fit their columns rather than run off its edges */
        gw = Math.min(gw, (W - gap * (cols - 1)) / cols);
        var s = gw / cw, gh = ch * s;
        var rows = Math.ceil(cards.length / cols);
        var H = rows * gh + (rows - 1) * gap + 40;
        stage.style.height = H + 'px';
        cards.forEach(function (c, k) {
          var col = k % cols, row = Math.floor(k / cols);
          put(c, (col - (cols - 1) / 2) * (gw + gap), row * (gh + gap) + gh / 2 - H / 2 + 20, 0, s, false, 10);
          c.tabIndex = 0;
        });
      }
      if (nextBtn) nextBtn.textContent = i === cards.length - 1 ? (nextBtn.getAttribute('data-again') || 'Start again') : (nextBtn.getAttribute('data-label') || 'Next card');
    }
    function show(k) { i = (k + cards.length) % cards.length; layout(); cards[i].focus({ preventScroll: true }); }
    function fit() {
      var inner = panel.querySelector('.deck__panel-in');
      if (!inner || panel.hidden) return;
      var z = 1;
      inner.style.zoom = '';
      panel.classList.remove('is-dense');
      /* on a wide screen, a card that does not fit first gives its words the
         whole width (lists in two columns, the photograph left on the card's
         face), and is scaled only if it still does not fit */
      if (panel.scrollHeight > panel.clientHeight + 1 && root.innerWidth > 860) {
        var h0 = panel.scrollHeight;
        panel.classList.add('is-dense');
        /* kept only when it makes the card shorter */
        if (panel.scrollHeight >= h0) panel.classList.remove('is-dense');
      }
      while (panel.scrollHeight > panel.clientHeight + 1 && z > 0.55) {
        z = Math.round((z - 0.03) * 100) / 100;
        inner.style.zoom = String(z);
      }
    }
    function open(c) {
      opened = c;
      if (pPill) pPill.textContent = c.getAttribute('data-pill') || '';
      if (pTitle) pTitle.textContent = c.getAttribute('data-title') || '';
      var more = c.querySelector('.card__more'), art = c.querySelector('.card__art');
      if (pBody) pBody.innerHTML = more ? more.innerHTML : '';
      if (pArt) pArt.innerHTML = art ? art.innerHTML : '';
      panel.hidden = false;
      /* the card opens whole on the screen: when it holds more than the
         screen has room for, what is inside is scaled down a little until it
         fits, so nothing is cut and nothing scrolls */
      opened = c; fit(); setTimeout(fit, 120); setTimeout(fit, 500);
      try { deck.dispatchEvent(new CustomEvent('deck:open', { detail: { card: c, panel: panel, index: cards.indexOf(c) } })); } catch (_) { /* old browsers: the panel still opens */ }
      /* a frame later, so the panel's first painted size is the card's and
         the transition has somewhere to go from */
      requestAnimationFrame(function () { requestAnimationFrame(function () { deck.classList.add('is-open'); if (closeBtn) closeBtn.focus({ preventScroll: true }); }); });
    }
    function close() {
      if (!opened) return;
      deck.classList.remove('is-open');
      var was = opened; opened = null;
      setTimeout(function () { if (!opened) panel.hidden = true; }, 450);
      was.focus({ preventScroll: true });
    }
    function view(all) {
      grid = !!all;
      deck.classList.toggle('is-grid', grid);
      if (oneBtn) oneBtn.setAttribute('aria-pressed', String(!grid));
      if (allBtn) allBtn.setAttribute('aria-pressed', String(grid));
      close(); layout();
    }
    cards.forEach(function (c, k) {
      c.addEventListener('click', function () {
        if (grid) { i = k; open(c); return; }
        if (k === i) open(c); else if (k > i) show(k);
      });
    });
    if (nextBtn) nextBtn.addEventListener('click', function () { show(i + 1); });
    if (showBtn) showBtn.addEventListener('click', function () { open(cards[i]); });
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (oneBtn) oneBtn.addEventListener('click', function () { view(false); });
    if (allBtn) allBtn.addEventListener('click', function () { view(true); });
    /* a link inside the panel leads elsewhere on the page: the panel closes
       so the page can go there rather than stay under a card */
    panel.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a[href^="#"]')) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && opened) { close(); return; }
      if (!deck.contains(document.activeElement) || opened || grid) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
    });
    /* a line opened inside the card (an elective under its plus) makes it
       taller: fitted again */
    panel.addEventListener('toggle', function () { setTimeout(fit, 30); }, true);
    document.addEventListener('click', function (e) {
      if (!opened || panel.contains(e.target) || (e.target.closest && e.target.closest('.deck__cards > .card, .deck__show'))) return;
      close();
    });
    var t = null;
    root.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { layout(); fit(); }, 120); });
    /* data-deck-start="row": opens laid out, on a screen wide enough for
       the row; a phone keeps the one-card stack */
    if (deck.getAttribute('data-deck-start') === 'row' && stage.clientWidth >= 760) view(true); else layout();
    return { show: show, open: function (k) { show(k); open(cards[i]); }, close: close, view: view };
  }

  function mountAll() { [].forEach.call(document.querySelectorAll('section.deck'), mount); }
  root.PFADeck = { mount: mount, mountAll: mountAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll); else mountAll();
}(window));
