/* PFA site chrome: the one script behind the announcement bar and header.

   Responsibilities, in order:
     1. Measure. --ann and --nav are the real heights of the announcement bar
        and the fixed header. Pages position their first section from them, so
        they are measured, never assumed, and re-measured on resize and once
        fonts have loaded (the nav wraps on a narrow window; a swapped font
        changes the header height by a pixel or two).
     2. Close. The announcement's close button hides the bar and remembers the
        choice for the rest of the session, keyed on the bar's text - so the
        same message does not come back on the next page, while a different
        message (CineKind) still shows.

   Pages that used to carry their own copy of this measured the same way; the
   copies had drifted (index.html read `.pfa-ann`, others read `#announce`,
   and no page remembered a close). This replaces all of them. */
(function () {
  'use strict';

  /* A line of items with dots between them that never wraps onto a dot:
     the items as spans in .dots (assets/chrome.css), which draws the dots.
     Empty items are left out. Pages call it where they used to join text
     with " · " (owner, 9 Oct 2026: "ensure no such lapses exist"). */
  window.PFADots = function (el, items) {
    if (!el) return;
    el.classList.add('dots');
    el.textContent = '';
    (items || []).forEach(function (t) {
      if (t == null || !String(t).trim()) return;
      var span = document.createElement('span');
      span.textContent = String(t);
      el.appendChild(span);
    });
  };

  /* Right-click is switched off site-wide. This only removes the context
     menu; it does not stop anyone saving an image or reading the source. */
  document.addEventListener('contextmenu', function (event) { event.preventDefault(); }, true);

  var root = document.documentElement;
  var CLOSED_KEY = 'pfa:announce:closed';

  function bar() { return document.getElementById('announce'); }
  function header() { return document.getElementById('header') || document.querySelector('header.site'); }

  /* Closing the bar closes it on this page only. It used to be remembered
     for the session, keyed on the bar's text, which meant one close on the
     home page silently removed it from every page carrying the same line
     until the tab was shut. Any old memory is cleared so nobody is stuck. */
  try { sessionStorage.removeItem(CLOSED_KEY); } catch (_) {}

  /* A measurement of zero is not a measurement. This runs before layout has
     settled on some loads, and an inline --nav:0px outranks the page's :root
     fallback, which put the fixed header at top:0 underneath the fixed
     announcement bar and cut the top off the mark and the Donate button. A
     height is published only once it is real; until then the page's own
     :root values hold. A bar that is genuinely closed is the one legitimate
     zero, so it is written from the closed state rather than from a
     measurement. */
  function measure() {
    var ann = bar();
    var head = header();
    /* a page may also stand the bar down with a stylesheet rule (Get
       Involved does while a form journey is open), so the computed display
       counts as closed too */
    var open = ann && !ann.hidden && ann.style.display !== 'none' && getComputedStyle(ann).display !== 'none';
    if (!ann || !open) root.style.setProperty('--ann', '0px');
    else if (ann.offsetHeight) root.style.setProperty('--ann', ann.offsetHeight + 'px');
    if (head && head.offsetHeight) root.style.setProperty('--nav', head.offsetHeight + 'px');
  }

  function closeBar() {
    var ann = bar();
    if (!ann) return;
    ann.hidden = true;
    ann.style.display = 'none';
    measure();
  }

  function initAnnouncement() {
    var ann = bar();
    if (!ann) return;
    var close = document.getElementById('annClose') || ann.querySelector('button');
    if (close) close.addEventListener('click', closeBar);
  }


  /* ---------- the menu on a phone or tablet ----------
     Below 900px the four sections stand down and the header's menu button
     opens a panel listing them. The panel is built here from the desktop
     menus, so it always lists exactly what they list, in the same order,
     with the page you are on underlined. It is appended to <body>, not the
     header: the header's backdrop blur makes it the containing block for
     anything fixed inside it, which would clip the panel to the header's
     own 81px.

     Open: the page under it stops scrolling, focus moves to the first link,
     and the header goes back to paper if a dark section had turned it
     clear. Closed by the button, Escape, choosing a link, or the window
     growing past 900px.

     On a page with the phone's tab bar (22 Oct 2026), its Menu tab is what
     opens it, and the stylesheet draws it as an app's list screen: each run
     of links is a .mnav__list, a card of rows, so a section's captions
     ("Join the tribe") sit between cards rather than inside one. */
  function initMobileNav() {
    var head = header();
    var burger = head && head.querySelector('.burger');
    var links = head && head.querySelector('.navlinks');
    if (!burger || !links) return;
    var tab = document.querySelector('.pfa-tabs [data-tab="menu"]');
    var openers = [burger].concat(tab ? [tab] : []);
    var btn = burger;

    var panel = document.createElement('nav');
    panel.className = 'mnav';
    panel.id = 'mnav';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Menu');
    [].forEach.call(links.querySelectorAll('.navitem'), function (item) {
      var top = item.querySelector(':scope > a');
      var menu = item.querySelector('.menu');
      if (!top || !menu) return;
      var group = document.createElement('div');
      group.className = 'mnav__group';
      var label = document.createElement('p');
      label.className = 'mnav__head';
      label.textContent = top.textContent.trim();
      group.appendChild(label);
      var list = null;
      [].forEach.call(menu.children, function (child) {
        if (child.tagName === 'A') {
          if (!list) { list = document.createElement('div'); list.className = 'mnav__list'; group.appendChild(list); }
          var a = document.createElement('a');
          a.href = child.getAttribute('href');
          a.textContent = child.textContent.trim();
          if (child.classList.contains('current')) { a.className = 'current'; a.setAttribute('aria-current', 'page'); }
          list.appendChild(a);
        } else if (child.classList.contains('menu-label')) {
          var sub = document.createElement('p');
          sub.className = 'mnav__sub';
          sub.textContent = child.textContent.trim();
          group.appendChild(sub);
          list = null;
        } else if (child.classList.contains('menu-sep')) {
          list = null;
        }
      });
      panel.appendChild(group);
    });
    document.body.appendChild(panel);

    var hadDark = false;
    var timer = 0;
    /* Back closes the menu, as a phone's Back closes a screen in an app
       (22 Oct 2026): opening it adds a step to the history, Back takes it
       away, and a row chosen in it replaces that step, so Back from the page
       it opened comes here, not here with the menu open. */
    var pushed = false;
    function expanded(on) {
      openers.forEach(function (o) { o.setAttribute('aria-expanded', on ? 'true' : 'false'); });
      burger.setAttribute('aria-label', on ? 'Close the menu' : 'Open the menu');
    }
    function open(from) {
      if (!panel.hidden) return;
      btn = from || burger;
      measure();
      hadDark = root.classList.contains('header-on-dark');
      root.classList.remove('header-on-dark');
      root.classList.add('mnav-open');
      panel.hidden = false;
      window.clearTimeout(timer);
      window.requestAnimationFrame(function () { panel.classList.add('is-open'); });
      expanded(true);
      /* Focus goes to the panel itself, not to its first row (owner,
         23 Oct 2026, a screenshot of a black line under "Units: find help
         near you": "why that black line below units ... seems like a bug").
         A row given focus by the script wore the site's focus outline, and
         the card it sits in cut that outline down to one line under it. Tab
         still goes to the first row from here. */
      if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
      try { panel.focus({ preventScroll: true }); } catch (_) { panel.focus(); }
      if (window.history && history.pushState && !(history.state && history.state.pfaMenu)) {
        try { history.pushState({ pfaMenu: 1 }, ''); pushed = true; } catch (_) { pushed = false; }
      }
    }
    function close(returnFocus, fromHistory) {
      if (panel.hidden) return;
      panel.classList.remove('is-open');
      root.classList.remove('mnav-open');
      if (hadDark) root.classList.add('header-on-dark');
      expanded(false);
      timer = window.setTimeout(function () { panel.hidden = true; }, 260);
      if (pushed) {
        pushed = false;
        if (fromHistory !== true && history.state && history.state.pfaMenu) history.back();
      }
      if (returnFocus) btn.focus({ preventScroll: true });
    }
    openers.forEach(function (o) {
      o.addEventListener('click', function () { if (panel.hidden) open(o); else close(true); });
    });
    panel.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var step = pushed && history.state && history.state.pfaMenu;
      var plain = !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && a.target !== '_blank';
      var page = (a.getAttribute('href') || '').charAt(0) !== '#';
      if (step && plain && page) {
        /* the menu's step becomes the page chosen */
        e.preventDefault();
        pushed = false;
        close(false, true);
        location.replace(a.href);
        return;
      }
      if (step && plain) {
        /* this page's own entry (#top): the step becomes that place on it */
        e.preventDefault();
        pushed = false;
        close(false, true);
        var id = (a.getAttribute('href') || '').slice(1);
        try { history.replaceState(null, '', '#' + id); } catch (_) {}
        var to = id && document.getElementById(id);
        if (to) to.scrollIntoView(); else window.scrollTo(0, 0);
        return;
      }
      close(false);
    });
    window.addEventListener('popstate', function () { if (!panel.hidden) close(false, true); });
    document.addEventListener('keydown', function (e) {
      if (panel.hidden) return;
      if (e.key === 'Escape') { close(true); return; }
      if (e.key !== 'Tab') return;
      var stops = [btn].concat([].slice.call(panel.querySelectorAll('a')));
      var i = stops.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); stops[stops.length - 1].focus(); }
      else if (!e.shiftKey && i === stops.length - 1) { e.preventDefault(); stops[0].focus(); }
    });
    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 901px)');
      var onWide = function () { if (wide.matches) close(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide); else if (wide.addListener) wide.addListener(onWide);
    }
    /* Back from a page reached through the menu, the menu is shut. */
    window.addEventListener('pageshow', function () { close(false, true); });
  }

  /* ---------- the tab bar steps aside for the keyboard ----------
     On a phone a bar pinned to the foot rides up on the keyboard and covers
     the field being typed in. While a field has focus, <html> carries
     pfa-typing and the stylesheet slides the tab bar away (only where there
     is one, and only at phone widths). */
  function isField(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return !/^(checkbox|radio|button|submit|reset|range|file|color|hidden|image)$/i.test(el.type || '');
  }
  function initTyping() {
    if (!document.querySelector('.pfa-tabs')) return;
    document.addEventListener('focusin', function (e) { if (isField(e.target)) root.classList.add('pfa-typing'); });
    document.addEventListener('focusout', function () {
      window.setTimeout(function () { if (!isField(document.activeElement)) root.classList.remove('pfa-typing'); }, 0);
    });
  }


  /* ---------- what is painted under the pointer ----------
     The chevron switches: bone on a dark surface, ink on a light one. This
     decides which, and it is the only thing on the site that decides it, so
     no page, section, overlay or component added later has an opinion to
     drift from.

     Three answers came before it and all three are recorded here so none is
     tried again. Fourteen per-page copies, each with a hand-written list of
     "dark" selectors: the lists drifted and any surface not on a page's list
     - the Wall's black video frames - got ink smeared across black. Then one
     sampler, but it read only on mouseover, so a surface that changed under a
     still hand (a button inverting on hover) left the chevron black on black.
     Then a difference blend, which recoloured itself every frame but
     recoloured the letters under it too, and read as though it were behind
     the text.

     So: read what is actually painted at the point, read it again on a
     heartbeat rather than only when something is hovered, and paint the
     answer instead of blending it. Every layer at the point is composited in
     paint order, from the top down until something opaque stops the walk:

       data-cursor="light" / "dark"  an element's explicit answer, and the way
                                     to teach this about a surface it cannot
                                     see (light = draw the light chevron, i.e.
                                     the surface is dark). Ends the walk.
       <img> <video> <canvas>        the pixels themselves, averaged over the
                                     chevron's own footprint, read through
                                     object-fit and object-position.
       background-image              a gradient's stops averaged; a picture's
                                     own average, read once and remembered.
       background-color              through the element's opacity.

     Anything it cannot read - another origin's film, another site in a frame
     - is treated as clear and the walk carries on beneath it, which lands on
     the surface the page put there (the theatre's black stage, a card's white
     face). And the chevron it colours is still ink over a wider casing, so a
     reading that is late, impossible or simply wrong costs some contrast and
     never the pointer itself. */
  var surface = (function () {
    var pad = null, ctx = null;
    var tainted = new WeakSet();      /* media that taints the scratch canvas */
    var pictures = Object.create(null);   /* background-image url -> average */

    function channel(v) { var n = parseFloat(v); if (isNaN(n)) return 0; return /%$/.test(v) ? n * 2.55 : n; }
    function opacityOf(v) { var n = parseFloat(v); if (isNaN(n)) return 1; return /%$/.test(v) ? n / 100 : n; }

    /* Computed colours come back as rgb()/rgba(); the rest is for values a
       page sets by hand and for the wide-gamut form newer engines emit. */
    function colour(s) {
      if (!s) return null;
      var m = /rgba?\(([^)]*)\)/i.exec(s), p, h;
      if (m) {
        p = m[1].split(/[\s,/]+/);
        p = p.filter(function (t) { return t !== ''; });
        if (p.length < 3) return null;
        return [channel(p[0]), channel(p[1]), channel(p[2]), p.length > 3 ? opacityOf(p[3]) : 1];
      }
      m = /^\s*#([0-9a-f]{3,8})\s*$/i.exec(s);
      if (m) {
        h = m[1];
        if (h.length === 3 || h.length === 4) h = h.replace(/./g, function (c) { return c + c; });
        if (h.length !== 6 && h.length !== 8) return null;
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16),
          h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
      m = /color\(\s*[a-z0-9-]+([^)]*)\)/i.exec(s);
      if (m) {
        p = m[1].split(/[\s/]+/);
        p = p.filter(function (t) { return t !== ''; });
        if (p.length < 3) return null;
        return [parseFloat(p[0]) * 255, parseFloat(p[1]) * 255, parseFloat(p[2]) * 255,
          p.length > 3 ? opacityOf(p[3]) : 1];
      }
      return null;
    }

    function toLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    function luminance(c) { return 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]); }

    /* Three by three, not one by one: a single pixel is a coin toss on a
       grainy photograph, and the browser does the averaging in drawImage. */
    function scratch() {
      if (pad) return ctx;
      pad = document.createElement('canvas');
      pad.width = 3; pad.height = 3;
      try { ctx = pad.getContext('2d', { willReadFrequently: true }); } catch (e) { ctx = null; }
      return ctx;
    }
    function average(data) {
      var i, a, sum = 0, r = 0, g = 0, b = 0;
      for (i = 0; i < data.length; i += 4) {
        a = data[i + 3] / 255;
        sum += a; r += data[i] * a; g += data[i + 1] * a; b += data[i + 2] * a;
      }
      /* Nothing but hole: whatever is under it is what shows. */
      if (!sum) return null;
      return [r / sum, g / sum, b / sum, sum / (data.length / 4)];
    }
    /* One component of object-position, against the slack in that axis. */
    function offset(token, slack) {
      if (!token || token === 'center') return slack / 2;
      if (token === 'left' || token === 'top') return 0;
      if (token === 'right' || token === 'bottom') return slack;
      if (/%$/.test(token)) return slack * parseFloat(token) / 100;
      var n = parseFloat(token);
      return isNaN(n) ? slack / 2 : n;
    }
    function pixels(el, x, y) {
      if (tainted.has(el)) return null;
      var c = scratch();
      if (!c) return null;
      var tag = el.tagName, nw, nh;
      if (tag === 'IMG') { if (!el.complete) return null; nw = el.naturalWidth; nh = el.naturalHeight; }
      else if (tag === 'VIDEO') { if (el.readyState < 2) return null; nw = el.videoWidth; nh = el.videoHeight; }
      else { nw = el.width; nh = el.height; }
      if (!nw || !nh) return null;
      var box = el.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      var cs = getComputedStyle(el), fit = cs.objectFit || 'fill', k = 0;
      if (fit === 'contain') k = Math.min(box.width / nw, box.height / nh);
      else if (fit === 'cover') k = Math.max(box.width / nw, box.height / nh);
      else if (fit === 'none') k = 1;
      else if (fit === 'scale-down') k = Math.min(1, Math.min(box.width / nw, box.height / nh));
      var w = k ? nw * k : box.width, h = k ? nh * k : box.height;
      var pos = String(cs.objectPosition || '50% 50%').split(/\s+/);
      var left = box.left + offset(pos[0], box.width - w);
      var top = box.top + offset(pos.length > 1 ? pos[1] : '50%', box.height - h);
      /* Off the picture itself - the letterbox of object-fit:contain, the
         part of the box a cover crop never reaches - and what shows there is
         the element's own background, so this layer says nothing. */
      if (x < left || x >= left + w || y < top || y >= top + h) return null;
      var kx = nw / w, ky = nh / h;
      var spanX = Math.max(1, 24 * kx), spanY = Math.max(1, 24 * ky);
      var sx = Math.max(0, Math.min(nw - spanX, (x - left) * kx - spanX / 2));
      var sy = Math.max(0, Math.min(nh - spanY, (y - top) * ky - spanY / 2));
      var data;
      try {
        c.clearRect(0, 0, 3, 3);
        c.drawImage(el, sx, sy, Math.min(spanX, nw - sx), Math.min(spanY, nh - sy), 0, 0, 3, 3);
        data = c.getImageData(0, 0, 3, 3).data;
      } catch (e) {
        /* Another origin's picture or film taints the canvas for good, so it
           is asked once and never again; a frame that is merely not ready yet
           is asked again next time. */
        if (!e || e.name === 'SecurityError') tainted.add(el);
        return null;
      }
      return average(data);
    }
    /* A picture set in CSS is read whole and remembered. Where in it the
       pointer stands would mean unpicking background-size, -position and
       -repeat, and whether the surface is dark almost never turns on that.
       The file is already decoded for the page, so this costs no request. */
    function picture(url) {
      if (url in pictures) return pictures[url];
      pictures[url] = null;
      var img = new Image();
      img.onload = function () {
        var c = scratch();
        if (!c) return;
        try {
          c.clearRect(0, 0, 3, 3);
          c.drawImage(img, 0, 0, 3, 3);
          pictures[url] = average(c.getImageData(0, 0, 3, 3).data);
        } catch (e) {}
      };
      img.src = url;
      return null;
    }
    function backdrop(cs) {
      var img = cs.backgroundImage;
      if (!img || img === 'none') return null;
      if (/gradient\(/i.test(img)) {
        /* Every stop, averaged. A scrim fading from clear to black is half a
           black scrim, which is right to within the width of the casing. */
        var stops = img.match(/rgba?\([^)]*\)/gi), i, c, r = 0, g = 0, b = 0, a = 0, n = 0;
        if (!stops) return null;
        for (i = 0; i < stops.length; i++) {
          c = colour(stops[i]);
          if (!c) continue;
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; n++;
        }
        if (!n || !a) return null;
        return [r / a, g / a, b / a, a / n];
      }
      var m = /url\(\s*["']?([^"')]+)/i.exec(img);
      return m ? picture(m[1]) : null;
    }

    /* What one element paints at the point, topmost first. */
    function layersOf(el, x, y, out) {
      if (!el || el.nodeType !== 1 || !el.tagName) return false;
      var cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      var op = parseFloat(cs.opacity);
      if (isNaN(op)) op = 1;
      if (op <= 0) return false;

      var hint = el.getAttribute ? el.getAttribute('data-cursor') : null;
      if (hint === 'light') { out.push([0, 0, 0, 1]); return true; }
      if (hint === 'dark') { out.push([255, 255, 255, 1]); return true; }

      var tag = el.tagName, c;
      if (tag === 'IMG' || tag === 'VIDEO' || tag === 'CANVAS') {
        c = pixels(el, x, y);
        if (c) out.push([c[0], c[1], c[2], c[3] * op]);
      }
      /* The shapes inside an <svg> are icons and letters, not surfaces: what
         the chevron stands on is whatever is behind them. The <svg> itself
         can carry a background and is read like any other element. */
      if (el.ownerSVGElement) return false;
      c = backdrop(cs);
      if (c) out.push([c[0], c[1], c[2], c[3] * op]);
      c = colour(cs.backgroundColor);
      if (c && c[3] > 0) out.push([c[0], c[1], c[2], c[3] * op]);
      return false;
    }

    /* Hit testing cannot see a layer that takes no pointer events, and that
       is exactly what darkens this site's hero photographs: a child at
       inset:0 with pointer-events:none. Missing them is how a white chevron
       would end up on a hero that reads black to everyone looking at it. So
       each hit's own covering children are collected too, in front of it. */
    function scrims(el, x, y, depth, out, mine) {
      var kids = el.children, i, k, box, cs;
      if (!kids || !kids.length || kids.length > 48) return;
      for (i = kids.length - 1; i >= 0; i--) {
        k = kids[i];
        if (k === mine || !k.getBoundingClientRect) continue;
        box = k.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
        cs = getComputedStyle(k);
        /* Anything that does take pointer events was already offered by
           elementsFromPoint, in its right place in the stack. */
        if (cs.pointerEvents !== 'none' || cs.visibility === 'hidden') continue;
        if (depth > 0) scrims(k, x, y, depth - 1, out, mine);
        out.push(k);
      }
    }

    function at(x, y, mine) {
      if (!document.elementsFromPoint) return null;
      var hits = document.elementsFromPoint(x, y);
      if (!hits || !hits.length) return null;
      var stack = [], clear = 1, i, j, m, over, layers, a;
      for (i = 0; i < hits.length && clear > 0.004; i++) {
        over = [];
        scrims(hits[i], x, y, 1, over, mine);
        over.push(hits[i]);
        for (j = 0; j < over.length && clear > 0.004; j++) {
          layers = [];
          layersOf(over[j], x, y, layers);
          for (m = 0; m < layers.length && clear > 0.004; m++) {
            stack.push(layers[m]);
            clear *= 1 - Math.min(1, Math.max(0, layers[m][3]));
          }
        }
      }
      /* Nothing opaque the whole way down: what shows through is the canvas,
         and no page here paints it anything but white. */
      stack.push([255, 255, 255, 1]);
      var out = [stack[stack.length - 1][0], stack[stack.length - 1][1], stack[stack.length - 1][2]];
      for (i = stack.length - 2; i >= 0; i--) {
        a = Math.min(1, Math.max(0, stack[i][3]));
        out[0] = stack[i][0] * a + out[0] * (1 - a);
        out[1] = stack[i][1] * a + out[1] * (1 - a);
        out[2] = stack[i][2] * a + out[2] * (1 - a);
      }
      return out;
    }

    return {
      at: at,
      luminance: luminance,
      /* Which stroke reads better is not a matter of taste: white wins below
         about 0.18 and black above it, where the two contrast ratios cross.
         The margin either side is so that a grainy photograph, or a hand
         resting exactly on the join between two panels, does not flicker the
         pair back and forth. */
      isDark: function (l, was) { return l < (was ? 0.21 : 0.15); }
    };
  })();

  /* ---------- hand-drawn cursor ---------- */
  function initCursor() {
    if (!window.matchMedia) return;
    /* Only a device with a hovering pointer has a cursor to replace. Reduced
       motion no longer falls back to the system arrow: the chevron is drawn
       once and held still - no jitter, no press animation - so the page keeps
       one cursor everywhere without asking anyone to watch it move. */
    if (!matchMedia('(hover: hover)').matches) return;
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.querySelector('.cursor-layer')) return;

    document.documentElement.classList.add('pfa-cursor');
    var layer = document.createElement('div');
    layer.className = 'cursor-layer';
    layer.setAttribute('aria-hidden', 'true');
    /* The chevron is one stroke over a wider casing of the opposite colour -
       the way every operating system has drawn its pointer for forty years,
       and for the same reason. The pair swaps with the surface: ink on a
       light one, bone on a dark one, so the chevron reads black on white and
       white on black exactly as asked. The casing is what makes that safe to
       automate. It is the state the reading did not choose, one thin ring of
       it, and it is why a reading that comes a frame late, or cannot be taken
       at all, costs a little contrast and never the pointer.
       Painted, never blended: a difference blend recoloured the letters
       underneath and read as though it were behind them. */
    layer.innerHTML = '<svg id="cursorSvg" width="40" height="40" viewBox="0 0 40 40">' +
      '<path id="cursorCase" d="" fill="none" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '<path id="cursorPath" d="" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    document.body.appendChild(layer);
    var svg = layer.firstChild, casePath = svg.firstChild, path = svg.lastChild;

    var cx = -100, cy = -100, vis = false, down = false, raf = 0;
    function draw() {
      var j = 3.4, n = function () { return (Math.random() - 0.5) * 2 * j; };
      var pts = [[30 + n(), 4 + n()], [8 + n() * 0.6, 20 + n() * 0.5], [30 + n(), 36 + n()]];
      var th = 38 * Math.PI / 180, cos = Math.cos(th), sin = Math.sin(th), tip = pts[1];
      var d = 'M' + pts.map(function (p) {
        var dx = p[0] - tip[0], dy = p[1] - tip[1];
        return (dx * cos - dy * sin).toFixed(1) + ' ' + (dx * sin + dy * cos).toFixed(1);
      }).join('L');
      path.setAttribute('d', d);
      casePath.setAttribute('d', d);
    }

    /* Ink on a light surface, bone on a dark one. The light state is the
       stylesheet's own - no inline colour at all - so if this never runs, or
       runs and can read nothing, the chevron is exactly what assets/chrome.css
       draws rather than something half-applied. */
    var onDark = false, read = 0;
    function recolour() {
      read = Date.now();
      var rgb = surface.at(cx, cy, layer);
      if (!rgb) return;
      var dark = surface.isDark(surface.luminance(rgb), onDark);
      if (dark === onDark) return;
      onDark = dark;
      if (dark) {
        svg.style.setProperty('--cursor-ink', '#f2f0ec');
        svg.style.setProperty('--cursor-case', 'var(--deep,#0a0a0a)');
      } else {
        svg.style.removeProperty('--cursor-ink');
        svg.style.removeProperty('--cursor-case');
      }
    }
    /* Thirty-odd readings a second while the hand moves is far more than the
       eye needs and far less than the pointer's own frame rate: a gaming
       mouse reports moves faster than the screen refreshes, and a hit test
       per report would be paid on every one of them. */
    function reread() { if (vis && Date.now() - read >= 32) recolour(); }

    /* The top layer outranks every z-index there is: a modal <dialog> and
       its backdrop paint above this layer no matter the number on it, so the
       chevron was underneath the tracker's panel - invisible on the white, a
       ghost through the backdrop - while cursor:none still hid the real one.
       While any modal is open the chevron stands down and the stylesheet's
       :has rule hands the system pointer back. Checked on the same beats as
       the colour, so a dialog opened under a still hand is caught within a
       twelfth of a second too. */
    /* The chevron joins the top layer itself. A manual popover paints there
       - above modal dialogs - without taking focus, trapping anything or
       dimming the page, so the drawn cursor holds over the tracker's panel
       the same as everywhere else; standing it down for the system pointer
       was tried (v1.256) and rejected in about four hours flat. The top
       layer stacks by order of arrival, so when a dialog opens later it
       lands above the chevron: on the beat that notices, the layer steps
       out and back in, which moves it to the top again. Costs one
       hide/show per dialog opening, nothing per frame. Browsers without
       popovers keep v1.256's answer: the chevron stands down under a modal
       and the stylesheet's fallback rule hands the system pointer back. */
    var floats = typeof layer.showPopover === 'function';
    if (floats) {
      layer.setAttribute('popover', 'manual');
      try { layer.showPopover(); } catch (e) { floats = false; layer.removeAttribute('popover'); }
    }
    var modals = 0;
    function standDown() {
      var n = document.querySelectorAll('dialog[open]').length;
      if (n !== modals) {
        modals = n;
        if (floats) {
          if (n) { try { layer.hidePopover(); layer.showPopover(); } catch (e) {} }
        } else {
          svg.style.visibility = n ? 'hidden' : '';
        }
      }
      return !floats && n > 0;
    }
    function place() {
      raf = 0;
      svg.style.transform = 'translate(' + cx + 'px,' + cy + 'px) scale(' + (down && !still ? 0.82 : 1) + ')';
      if (!standDown()) reread();
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(place); }

    draw();
    /* The jitter redraws only while the chevron is on screen and the tab is
       front: a background tab does no work at all. */
    if (!still) setInterval(function () { if (vis && !document.hidden) draw(); }, 130);
    /* The surface is read again on a heartbeat, not only when the pointer
       moves, because the surface moves too: a button inverting on hover, a
       drawer sliding open, a carousel advancing, a film playing, a section
       animating in on scroll. Reading only on hover is precisely how the
       first sampler came to sit black on black under a still hand. A
       reading is a hit test and a handful of style reads; at twelve a
       second, held to the front tab, it does not show up in a profile.
       This one runs whether or not motion is reduced: the chevron may be
       held still, but the page underneath it need not be. */
    setInterval(function () { if (vis && !document.hidden && !standDown()) recolour(); }, 80);
    /* A scroll changes everything under a hand that has not moved at all. */
    window.addEventListener('scroll', reread, { passive: true, capture: true });

    function hide() { vis = false; svg.style.opacity = '0'; }
    function show() { if (!vis) { vis = true; svg.style.opacity = '1'; } }

    /* Arriving on a page, the pointer sits still where the last click was,
       and no pointermove comes until the hand moves: without this, that is a
       moment with no cursor at all - the system one is off, the chevron has
       not been placed. The last known position is kept for the tab and the
       chevron is stood there at once. */
    try {
      var seed = JSON.parse(sessionStorage.getItem('pfa:cursor') || 'null');
      if (seed && seed.x >= 0 && seed.y >= 0 && seed.x <= innerWidth && seed.y <= innerHeight) {
        cx = seed.x; cy = seed.y; vis = true; svg.style.opacity = '1';
        schedule();
      }
    } catch (e) {}
    window.addEventListener('pagehide', function () {
      try { sessionStorage.setItem('pfa:cursor', JSON.stringify({ x: Math.round(cx), y: Math.round(cy) })); } catch (e) {}
    });
    window.addEventListener('pointermove', function (e) {
      /* A finger or pen on a touchscreen laptop is not a hovering pointer:
         no chevron under a fingertip, and no stale one left where it tapped. */
      if (e.pointerType && e.pointerType !== 'mouse') { hide(); return; }
      cx = e.clientX; cy = e.clientY;
      show();
      schedule();
    }, { passive: true });
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') { hide(); return; }
      down = true; schedule();
    });
    window.addEventListener('pointerup', function () { down = false; schedule(); });
    /* A drag the browser takes over (or an OS gesture) never sends pointerup;
       without this the chevron stays shrunken. */
    window.addEventListener('pointercancel', function () { down = false; schedule(); });
    /* An iframe's inside belongs to another document: no events arrive while
       the pointer is in there, and the frame draws its own system cursor. The
       chevron steps aside instead of freezing at the edge next to it, and the
       next pointermove back in this document stands it up again. */
    window.addEventListener('pointerout', function (e) {
      var to = e.relatedTarget;
      if (to && to.tagName === 'IFRAME') hide();
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', hide);
    /* Focus moving into an embed or away from the window: same story. */
    window.addEventListener('blur', hide);
    /* Full screen renders only the fullscreened element: a layer left in
       <body> disappears while cursor:none still holds, and the theatre's F
       key would cost the visitor the pointer. The layer follows the
       fullscreen element in, and comes home when it exits. A media element
       cannot host children that render, so native video full screen keeps
       its own UA cursor and the layer stays put. */
    function rehost() {
      var h = document.fullscreenElement || document.webkitFullscreenElement || document.body;
      if (!h || /^(VIDEO|AUDIO|IFRAME|OBJECT|EMBED)$/.test(h.tagName)) h = document.body;
      if (layer.parentNode !== h) {
        h.appendChild(layer);
        /* Moving a popover in the DOM closes it; step back into the top layer. */
        if (floats) { try { layer.hidePopover(); } catch (e) {} try { layer.showPopover(); } catch (e) {} }
        schedule();
      }
    }
    document.addEventListener('fullscreenchange', rehost);
    document.addEventListener('webkitfullscreenchange', rehost);

    /* A theatre can rest the chevron while a film has the screen and the
       hand is still - the way every player hides the pointer - and wake it
       on the next movement. Movement always wins: pointermove shows it. */
    function rest(on) {
      if (on) { svg.style.opacity = '0'; }
      else if (vis) { svg.style.opacity = '1'; }
    }

    return {
      /* A page that repaints under a still pointer need not call this - the
         heartbeat catches it within a twelfth of a second - but a page that
         knows the exact moment can have the answer in the same frame. */
      recolour: function () { if (vis) { recolour(); schedule(); } },
      rest: rest
    };
  }
  var cursorApi = initCursor() || {};
  var recolourCursor = cursorApi.recolour || function () {};

  initAnnouncement();
  initMobileNav();
  initTyping();
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(function () {});

  /* A page that adds or removes something from the header (a cart count going
     from 0 to 1 changes nothing in height, but a wrapped nav does) can ask for
     a re-measure without reaching into this file. */
  window.PFA_CHROME = { measure: measure, closeAnnouncement: closeBar, recolourCursor: recolourCursor, restCursor: cursorApi.rest || function () {} };
})();

/* ---------- what the site shows ----------------------------------------
   Owner, 8 Oct 2026: every page and section can be shown or hidden from the
   panel, with no code change. The inline script at the top of the header
   (assets/site-visibility.js, put there by scripts/sync-chrome.js) has
   already hidden what this browser last knew to be hidden, before anything
   painted. This asks for the current answer, keeps it for the next page and
   applies it to this one, so a change in the panel reaches a page that is
   already open as well as the next one.

   /api/site-visibility is cached for ten seconds at the edge, so a change is
   live within about that. When no answer comes (offline, a page opened from
   the disk, a server that cannot read the setting) the last one stands: a
   blip never brings hidden sections back for a moment and then takes them
   away again. */
(function () {
  'use strict';
  var V = window.PFA_VISIBILITY;
  if (!V) return;

  /* A section's own button in the header (Our Work, Learn...) opens its menu
     and also leads to its first page. While that page is hidden the button
     leads to the first item in its menu still shown, so the rest of the menu
     stays one click away; it goes back to its own page when that returns. */
  function retarget(state) {
    [].forEach.call(document.querySelectorAll('header.site .navitem'), function (item) {
      var top = item.querySelector(':scope > a');
      if (!top) return;
      if (!top.hasAttribute('data-home')) top.setAttribute('data-home', top.getAttribute('href') || '');
      var home = top.getAttribute('data-home');
      var next = home;
      if (V.blocked(home, state)) {
        [].some.call(item.querySelectorAll('.menu > a'), function (a) {
          var href = a.getAttribute('href') || '';
          if (!href || href.charAt(0) === '#' || V.blocked(href, state)) return false;
          next = href;
          return true;
        });
      }
      if (top.getAttribute('href') !== next) top.setAttribute('href', next);
    });
  }

  function take(data) {
    if (!data || data.unavailable || !Array.isArray(data.pages) || !Array.isArray(data.modules)) return;
    V.save(data);
    V.apply(data);
    retarget(V.state());
    measureAgain();
    try { window.dispatchEvent(new CustomEvent('pfa:visibility', { detail: V.state() })); } catch (e) {}
  }

  /* A menu or a page that changed under the header can change its height. */
  function measureAgain() {
    if (window.PFA_CHROME && window.PFA_CHROME.measure) window.PFA_CHROME.measure();
  }

  function ask() {
    if (!window.fetch) return;
    fetch('/api/site-visibility', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(take)
      .catch(function () { /* the last answer stands */ });
  }

  retarget(V.state());
  ask();
  /* Back to a page the browser kept in memory: the answer may have moved. */
  window.addEventListener('pageshow', function (event) { if (event.persisted) ask(); });
})();

/* ---------- visit tally ------------------------------------------------
   A real number from /api/visits. One visit per browser session, not per page
   view, so reading six pages counts once: that is what "visits" means and it is
   what keeps the write count inside Firestore's free allowance.

   Nothing is shown until the server answers. If it never does, the block stays
   hidden rather than displaying a zero or a number we made up. */
(function () {
  'use strict';
  /* This file is loaded in the header, long before the footer markup exists, so
     the counter has to wait for the document rather than look for itself now. */
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  ready(function () {
  var wrap = document.getElementById('pfaTally');
  var odo = document.getElementById('pfaTallyOdo');
  if (!wrap || !odo || !window.fetch) return;

  var KEY = 'pfa_visit_counted';
  var shown = null;

  /* Plain digits, no thousands comma (owner, 24 Oct 2026: "visit counter
     has a comma and some white band. fix that. comma isnt necessary"). The
     comma sat in its own narrow cell without the wheels' shading, which is
     the white band the owner saw; an odometer has only wheels. */
  function group(n) { return String(Math.floor(n)); }

  function build(text) {
    odo.innerHTML = '';
    text.split('').forEach(function () {
      var cell = document.createElement('span');
      cell.className = 'pfa-tally__d';
      var strip = document.createElement('span');
      strip.className = 'pfa-tally__strip';
      for (var d = 0; d <= 9; d += 1) {
        var one = document.createElement('span');
        one.textContent = String(d);
        strip.appendChild(one);
      }
      cell.appendChild(strip);
      odo.appendChild(cell);
    });
  }

  function roll(text, animate) {
    var cells = odo.querySelectorAll('.pfa-tally__d');
    var digits = text.split('');
    cells.forEach(function (cell, i) {
      var strip = cell.querySelector('.pfa-tally__strip');
      var d = Number(digits[i] || 0);
      /* each wheel is 1.9em tall (.pfa-tally__d in chrome.css), so digit n
         sits at -n * 1.9em */
      var move = function () { strip.style.transform = 'translateY(' + (-d * 1.9) + 'em)'; };
      if (!animate) { strip.style.transition = 'none'; move(); strip.offsetHeight; strip.style.transition = ''; return; }
      /* stagger from the right so the number settles like a real odometer */
      setTimeout(move, (cells.length - i - 1) * 55);
    });
  }

  function show(total) {
    if (typeof total !== 'number' || !isFinite(total) || total < 0) return;
    var text = group(total);
    var first = shown === null;
    if (first || text.length !== odo.querySelectorAll('.pfa-tally__d').length) build(text);
    wrap.hidden = false;
    if (first) {
      /* start every wheel at 0 and let it climb to the real figure once */
      roll(text.replace(/\d/g, '0'), false);
      setTimeout(function () { roll(text, true); }, 90);
    } else {
      roll(text, true);
      var cells = odo.querySelectorAll('.pfa-tally__d');
      var last = cells[cells.length - 1];
      if (last) { last.classList.add('is-hot'); setTimeout(function () { last.classList.remove('is-hot'); }, 1400); }
    }
    shown = total;
  }

  var counted;
  try { counted = window.sessionStorage.getItem(KEY) === '1'; } catch (e) { counted = false; }

  fetch('/api/visits', { method: counted ? 'GET' : 'POST', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (p) {
      if (!p || typeof p.total !== 'number') return;
      try { window.sessionStorage.setItem(KEY, '1'); } catch (e) {}
      show(p.total);
    })
    .catch(function () { /* stay hidden */ });
  });
})();

/* Rows that scroll sideways: filters, tabs, shelf chips.
   ------------------------------------------------------------------------
   On a phone these rows are wider than the screen and scroll sideways with
   no scrollbar, so the last chip was simply cut off at the edge ("ESSENTIA")
   and read as a layout fault (owner, 7 Oct 2026: "not fully within the
   boundaries of the screen ... optimise this across"). Each such row now
   fades out at whichever edge has more beyond it, and stops fading once that
   end is reached. Found by what it does, not by name: any short element
   that scrolls sideways and is wider inside than out. The fade is
   chrome.css's [data-more-left] / [data-more-right]. */
(function () {
  'use strict';
  var rows = [];

  function mark(el) {
    var more = el.scrollWidth - el.clientWidth > 2;
    var left = more && el.scrollLeft > 2;
    var right = more && el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    if (left) el.setAttribute('data-more-left', ''); else el.removeAttribute('data-more-left');
    if (right) el.setAttribute('data-more-right', ''); else el.removeAttribute('data-more-right');
  }

  function scan() {
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (rows.indexOf(el) !== -1) { mark(el); continue; }
      if (el.clientHeight === 0 || el.clientHeight > 100 || el.scrollWidth <= el.clientWidth + 2) continue;
      var ox = window.getComputedStyle(el).overflowX;
      if (ox !== 'auto' && ox !== 'scroll') continue;
      rows.push(el);
      el.addEventListener('scroll', (function (row) { return function () { mark(row); }; }(el)), { passive: true });
      mark(el);
    }
  }

  var later = 0;
  function soon() {
    if (later && typeof window.clearTimeout === 'function') window.clearTimeout(later);
    later = window.setTimeout(scan, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', soon);
  else soon();
  window.addEventListener('load', soon);
  window.addEventListener('resize', soon);
})();

/* ---------- a form opens when it is asked for --------------------------
   Owner, 9 Oct 2026, of a microsite's Register button with the form already
   on the screen under it: "open step 1 after another, else register button
   has no meaning/purpose. be sensible. you need to think like apple/google.
   across the whole site". And, the same minute: "always have a link to
   contact when at such stages".

   A section marked data-flow holds a form. It stays closed until something
   asks for it: a link to its id, or an address that names it (so site search
   and links from other pages land straight in it). Then it is the page: the
   rest of main, the announcement and the footer step aside, and a bar over
   it carries the way back to the page and a way to reach PFA, which the
   footer it hides would otherwise have been. The browser's Back closes it.
   Closing keeps what was typed, so opening it again carries on.

   The class that closes the forms is set here, while the header is being
   read and before the page's body is, so a form is never seen and then
   hidden. Without this script nothing is closed and the links scroll to the
   forms, as they always did. ---------------------------------------------- */
(function () {
  'use strict';
  var root = document.documentElement;
  /* a real browser only: an address, a history and a page to mark */
  if (!root || !root.classList || !window.location || !window.history || !window.history.pushState) return;
  root.classList.add('pfa-flows');

  var HELP = 'ask.html';
  var current = null;   /* the open flow */
  var opener = null;    /* the link that opened it, to return to */

  function bare(p) { return String(p || '').replace(/\.html$/, '').replace(/\/index$/, '/'); }
  function idOf(hash) { return decodeURIComponent(String(hash || '').replace(/^#/, '').split(/[&?=]/)[0] || ''); }
  function flowById(id) {
    var el = id && document.getElementById(id);
    return el && el.hasAttribute('data-flow') ? el : null;
  }
  /* The id a link points at on this page, or '' if it goes anywhere else. */
  function hereId(a) {
    var href = a.getAttribute('href') || '';
    if (href.charAt(0) === '#') return idOf(href);
    if (href.indexOf('#') === -1 || a.target === '_blank') return '';
    if (bare(a.pathname) !== bare(location.pathname) || a.host !== location.host) return '';
    return idOf(a.hash);
  }

  function label(flow) {
    return flow.getAttribute('data-flow-back') || String(document.title || '').split(' | ')[0] || 'Back';
  }
  /* The bar opens main, on the page's own gutter, whatever the flow sits in. */
  function bar(flow) {
    var main = flow.closest('main') || document.body;
    var have = main.querySelectorAll(':scope > .pfa-flow-bar');
    for (var i = 0; i < have.length; i++) if (have[i].getAttribute('data-for') === flow.id) return have[i];
    var b = document.createElement('div');
    b.className = 'pfa-flow-bar';
    b.setAttribute('data-for', flow.id);
    var back = document.createElement('a');
    back.className = 'pfa-flow-bar__back';
    back.href = location.pathname + location.search;
    back.setAttribute('data-flow-close', '');
    back.innerHTML = '<span aria-hidden="true">←</span> ';
    back.appendChild(document.createTextNode(label(flow)));
    var help = document.createElement('a');
    help.className = 'pfa-flow-bar__help';
    help.href = HELP;
    help.target = '_blank';
    help.rel = 'noopener';
    help.innerHTML = '<span class="pfa-flow-bar__q">Need help? </span><b>Contact PFA</b>';
    help.setAttribute('aria-label', 'Need help? Contact PFA (opens in a new tab, so nothing here is lost)');
    b.appendChild(back);
    b.appendChild(help);
    main.insertBefore(b, main.firstChild);
    return b;
  }

  /* Everything in main beside the flow's own line of ancestors steps aside;
     the ancestors are marked so a page can let a grid fall to one column. */
  function aside(flow, on) {
    var main = flow.closest('main') || document.body;
    var marked = main.querySelectorAll('.pfa-flow-off, .pfa-flow-path');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('pfa-flow-off', 'pfa-flow-path');
    if (!on) return;
    var b = bar(flow);
    for (var el = flow; el && el !== main; el = el.parentElement) {
      if (el !== flow) el.classList.add('pfa-flow-path');
      var kids = el.parentElement ? el.parentElement.children : [];
      for (var k = 0; k < kids.length; k++) {
        var sib = kids[k];
        if (sib === el || sib === b || /^(SCRIPT|STYLE|TEMPLATE|DIALOG)$/.test(sib.tagName)) continue;
        if (sib.classList.contains('pfa-flow-bar')) continue;
        sib.classList.add('pfa-flow-off');
      }
    }
  }
  function remeasure() {
    if (window.PFA_CHROME && window.PFA_CHROME.measure) window.PFA_CHROME.measure();
  }
  function tell(flow, name) {
    try { flow.dispatchEvent(new CustomEvent(name, { bubbles: true })); } catch (_) {}
  }

  function show(flow) {
    if (current === flow) return;
    if (current) hide(true);
    current = flow;
    flow.classList.add('is-flow');
    bar(flow).classList.add('is-on');
    aside(flow, true);
    document.body.classList.add('in-flow');
    remeasure();
    window.scrollTo(0, 0);
    var head = flow.querySelector('h1, h2, h3');
    if (head) {
      if (!head.hasAttribute('tabindex')) head.setAttribute('tabindex', '-1');
      try { head.focus({ preventScroll: true }); } catch (_) {}
    }
    tell(flow, 'pfa:flow-open');
  }
  function hide(quiet) {
    var flow = current;
    if (!flow) return;
    current = null;
    flow.classList.remove('is-flow');
    bar(flow).classList.remove('is-on');
    aside(flow, false);
    document.body.classList.remove('in-flow');
    remeasure();
    if (!quiet) {
      var back = opener && document.body.contains(opener) && !flow.contains(opener) ? opener : null;
      if (back) back.scrollIntoView({ block: 'center' });
      else window.scrollTo(0, 0);
    }
    opener = null;
    tell(flow, 'pfa:flow-close');
  }

  /* Open by id: the address gains it, so Back closes and a copied link opens. */
  function open(id, from) {
    var flow = flowById(id);
    if (!flow) return false;
    opener = from || opener;
    if (idOf(location.hash) !== id) history.pushState({ pfaFlow: id }, '', '#' + id);
    show(flow);
    return true;
  }
  function close() {
    if (!current) return;
    if (history.state && history.state.pfaFlow) { history.back(); return; }
    history.replaceState(null, '', location.pathname + location.search);
    hide(false);
  }
  function sync() {
    var flow = flowById(idOf(location.hash));
    if (flow) show(flow);
    else hide(false);
  }

  window.PFAFlow = { open: open, close: close, isOpen: function () { return !!current; } };

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    if (a.hasAttribute('data-flow-close')) { e.preventDefault(); close(); return; }
    var id = hereId(a);
    if (!id) return;
    if (flowById(id)) { e.preventDefault(); open(id, a); return; }
    /* a link to another part of this page, from inside a flow: the page
       comes back first, so there is somewhere to go */
    if (current && document.getElementById(id)) hide(true);
  }, true);
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  ready(function () {
    var flow = flowById(idOf(location.hash));
    if (flow && !current) show(flow);
  });
})();

/* ---------- a long form, one step at a time ------------------------------
   The same owner's note: "show things one after another in stages like you
   have for application.. dont bombard people". A form marked data-steps is
   written as .pfa-step blocks, each with data-step="its name", followed by a
   .pfa-steps__nav holding Back, Continue and the form's own submit button.
   One block shows at a time; Continue checks the block on screen (required,
   an email, an Indian mobile, a link) in the markup the pages already use
   (.field.is-bad shows the field's own .error), and a page with a rule of
   its own listens for pfa:step-check and cancels it. The page's own submit
   handler still checks everything; if it flags a field in an earlier step,
   that step comes back. Without this script every block shows, as a plain
   form. ---------------------------------------------------------------- */
(function () {
  'use strict';
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  var MOBILE = /^[6-9]\d{9}$/;
  var LINK = /^https?:\/\/[^\s/]+\.[^\s]+/;

  function boxOf(el) { return el.closest('.field') || el.closest('.consent') || el.closest('label'); }

  function wire(form) {
    if (form.getAttribute('data-steps-wired')) return;
    form.setAttribute('data-steps-wired', '1');
    var steps = [].slice.call(form.querySelectorAll('.pfa-step'));
    if (steps.length < 2) return;
    var tabs = [].slice.call(form.querySelectorAll('.pfa-steps__tabs li'));
    var bar = form.querySelector('.pfa-steps__bar span');
    var back = form.querySelector('[data-step-back]');
    var next = form.querySelector('[data-step-next]');
    var send = form.querySelector('.pfa-steps__nav [type="submit"]');
    var count = form.querySelector('[data-step-count]');
    var at = 0;

    function paint(focus) {
      steps.forEach(function (s, i) { s.classList.toggle('is-current', i === at); });
      tabs.forEach(function (t, i) { t.classList.toggle('is-current', i === at); t.classList.toggle('is-done', i < at); });
      if (bar) bar.style.width = Math.round(((at + 1) / steps.length) * 100) + '%';
      var last = at === steps.length - 1;
      if (back) back.hidden = at === 0;
      if (next) next.hidden = last;
      if (send) send.hidden = !last;
      if (count) count.textContent = 'Step ' + (at + 1) + ' of ' + steps.length;
      if (!focus) return;
      if (form.getBoundingClientRect().top < 90) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
      var f = steps[at].querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea');
      if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} }
    }
    function check(step) {
      var first = null;
      [].forEach.call(step.querySelectorAll('input, select, textarea'), function (el) {
        if (el.disabled || el.type === 'hidden' || el.closest('[hidden]')) return;
        var v = String(el.value || '').trim(), bad = false;
        if (el.type === 'checkbox') bad = el.required && !el.checked;
        else if (el.required && !v) bad = true;
        else if (v && el.type === 'email') bad = !EMAIL.test(v);
        else if (v && el.type === 'tel') bad = !MOBILE.test(v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''));
        else if (v && el.type === 'url') bad = !LINK.test(v);
        var box = boxOf(el);
        if (box) box.classList.toggle('is-bad', bad);
        if (bad && !first) first = el;
      });
      var ev;
      try { ev = new CustomEvent('pfa:step-check', { cancelable: true, detail: { step: step, index: steps.indexOf(step) } }); } catch (_) { ev = null; }
      if (ev && !form.dispatchEvent(ev) && !first) first = step.querySelector('.is-bad input, .is-bad select, .is-bad textarea') || step;
      return first;
    }
    function go(n, focus) { at = Math.max(0, Math.min(steps.length - 1, n)); paint(focus); }

    if (next) next.addEventListener('click', function () {
      var bad = check(steps[at]);
      if (bad) { if (bad.focus) bad.focus(); return; }
      go(at + 1, true);
    });
    if (back) back.addEventListener('click', function () { go(at - 1, true); });
    /* Enter in a box moves on, as Continue does; it never sends from an early step */
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || at === steps.length - 1) return;
      var t = e.target;
      if (!t || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'A') return;
      e.preventDefault();
      if (next) next.click();
    }, true);
    form.addEventListener('input', function (e) { var box = e.target && boxOf(e.target); if (box) box.classList.remove('is-bad'); });
    form.addEventListener('change', function (e) { var box = e.target && boxOf(e.target); if (box && e.target.type === 'checkbox') box.classList.remove('is-bad'); });
    /* the page checks the whole form on sending: a fault in an earlier step brings that step back */
    form.addEventListener('submit', function () {
      setTimeout(function () {
        var bad = form.querySelector('.is-bad');
        if (!bad) return;
        for (var i = 0; i < steps.length; i++) {
          if (steps[i].contains(bad)) {
            if (i !== at) go(i, false);
            var f = bad.querySelector('input, select, textarea');
            if (f) { try { f.focus(); } catch (_) {} }
            return;
          }
        }
      }, 0);
    });
    paint(false);
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  ready(function () { [].forEach.call(document.querySelectorAll('form[data-steps]'), wire); });
})();

/* The footer on a phone: each link group is one row that opens when tapped
   (owner, 21 Oct 2026: "THE FOOTER ON THE MOBILE SUCKS. SO LONG"). The
   styles are in assets/chrome.css, under .is-folding, which is added here so
   a page whose script does not run keeps every group open. Wide screens are
   untouched: the rows are only buttons while the phone layout is showing. */
(function () {
  'use strict';
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  ready(function () {
    var foot = document.querySelector('.pfa-footer');
    if (!foot || !window.matchMedia) return;
    var phone = window.matchMedia('(max-width:719px)');
    var cols = [].slice.call(foot.querySelectorAll('.pfa-footer__col'));
    function wire(col, i) {
      var label = col.querySelector('.pfa-footer__label');
      var list = col.querySelector('ul');
      if (!label || !list) return;
      if (!list.id) list.id = 'pfaFootList' + i;
      label.addEventListener('click', function () {
        if (!phone.matches) return;
        var open = !col.classList.contains('is-open');
        col.classList.toggle('is-open', open);
        label.setAttribute('aria-expanded', String(open));
      });
      label.addEventListener('keydown', function (e) {
        if (!phone.matches || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        label.click();
      });
    }
    function apply() {
      var on = phone.matches;
      foot.classList.toggle('is-folding', on);
      cols.forEach(function (col) {
        var label = col.querySelector('.pfa-footer__label');
        var list = col.querySelector('ul');
        if (!label || !list) return;
        if (on) {
          label.setAttribute('role', 'button');
          label.setAttribute('tabindex', '0');
          label.setAttribute('aria-controls', list.id);
          label.setAttribute('aria-expanded', String(col.classList.contains('is-open')));
        } else {
          ['role', 'tabindex', 'aria-controls', 'aria-expanded'].forEach(function (a) { label.removeAttribute(a); });
        }
      });
    }
    cols.forEach(wire);
    apply();
    if (phone.addEventListener) phone.addEventListener('change', apply); else if (phone.addListener) phone.addListener(apply);
  });
})();

/* ---------- what ends on a date ------------------------------------------
   The bell beside Shop opens an appeal that closes on a date (22 Oct 2026,
   the lab animal rules, until the end of 5 November). Anything in the page
   carrying data-until is taken away once that moment has passed, so an
   appeal that has closed is not still being rung for the day after, and
   nothing has to be shipped on the day. A date that cannot be read leaves
   the element where it is. */
(function () {
  'use strict';
  function sweep() {
    var now = Date.now();
    [].forEach.call(document.querySelectorAll('[data-until]'), function (el) {
      var at = Date.parse(el.getAttribute('data-until'));
      if (!isNaN(at) && now >= at && el.parentNode) el.parentNode.removeChild(el);
    });
  }
  sweep();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sweep, { once: true });
})();
