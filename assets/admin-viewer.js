/* People for Animals - the panel's file viewer.
   ------------------------------------------------------------------------
   Owner, 11 Nov 2026, of a case's photographs: "not able to view any of
   these within viewer", then "it has to be enterprise grade viewer within
   the portal not like a pdf viewed". Each photograph opened as a link to
   its own data: address in a new tab, which browsers refuse to open, and a
   PDF showed in the browser's own reader. Both now open here, over the
   panel, in one viewer of the panel's own:

     the top bar     the file's name, which of how many, its kind and size;
                     Download and Close
     the stage       a photograph whole, fitted to the screen and never
                     cut; zoomed in, it is dragged to move about it. A PDF is
                     drawn page by page by pdf.js (assets/vendor/pdfjs/, the
                     site's own copy), every page down one column, drawn as
                     it comes near the screen
     the controls    one bar at the foot: zoom out, the zoom, zoom in, Fit,
                     Rotate, and for a PDF the page it is on
     either side     Previous and Next, when there is more than one
     the strip       every file on the case, small, the open one marked;
                     any one opens with a press

   Keys: the arrows for previous and next, + and - to zoom, 0 to fit, R to
   rotate, Escape to close. A swipe on a phone turns to the next; two
   fingers pinch to zoom; Ctrl or Cmd with the wheel zooms. A double press
   on a photograph goes between fitted and actual size.

   Nothing leaves the panel: the files are already in this page.

   PFAViewer.open(items, index)  items: [{ src, type, label, name }], src a
   data: or blob: address. Kept out of admin.html so that page stays under
   its page-weight ceiling.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.PFAViewer) return;

  var STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
  var MIN = 0.05;
  var MAX = 8;

  var I = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    down: '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/>',
    prev: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    next: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    turn: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4.5v4h-4"/>',
    photo: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5"/><circle cx="15.5" cy="9.5" r="1.4"/>',
    doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15h6M9.5 18h4"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[name] + '</svg>';
  }

  var css = [
    '.pv{position:fixed;inset:0;z-index:9000;width:100vw;max-width:none;height:100vh;height:100dvh;max-height:none;margin:0;padding:0;border:0;background:#1b1c1e;color:#e8eaed;display:none;flex-direction:column;font:14px/1.4 "Helvetica Neue",Helvetica,Arial,sans-serif;overscroll-behavior:contain}',
    '.pv[open]{display:flex}',
    '.pv::backdrop{background:#1b1c1e}',
    '.pv *{box-sizing:border-box}',
    '.pv [hidden]{display:none!important}',
    /* the top bar */
    '.pv-top{flex:none;display:flex;align-items:center;gap:14px;min-height:60px;padding:8px 10px 8px 16px;background:#202124;border-bottom:1px solid #2f3033}',
    '.pv-file{flex:1;min-width:0;display:flex;align-items:center;gap:12px}',
    '.pv-file__ic{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:6px;background:#2d2e31;color:#c4c7c5}',
    '.pv-file__t{min-width:0}',
    '.pv-name{display:block;font-size:15px;font-weight:600;color:#fff;overflow-wrap:anywhere;line-height:1.3}',
    '.pv-meta{display:block;margin-top:2px;font-size:12px;color:#9aa0a6;overflow-wrap:anywhere}',
    '.pv-tools{flex:none;display:flex;align-items:center;gap:4px}',
    '.pv-ib{display:inline-grid;place-items:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:#e8eaed;cursor:pointer;text-decoration:none;transition:background .15s}',
    '.pv-ib:hover{background:#35363a}',
    '.pv-ib:focus-visible,.pv-pill button:focus-visible,.pv-nav:focus-visible,.pv-thumb:focus-visible{outline:2px solid #8ab4f8;outline-offset:2px}',
    '.pv-ib[disabled]{opacity:.35;cursor:default;background:transparent}',
    /* the stage */
    '.pv-stage{position:relative;flex:1;min-height:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}',
    '.pv-stage.can-pan{cursor:grab}.pv-stage.is-panning{cursor:grabbing}',
    '.pv-img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;max-height:none;will-change:transform;box-shadow:0 6px 30px rgba(0,0,0,.45);image-rendering:auto;-webkit-user-drag:none}',
    '.pv-pdf{position:absolute;inset:0;overflow:auto;touch-action:pan-x pan-y;padding:24px 0 96px;scrollbar-color:#5f6368 transparent}',
    '.pv-page{position:relative;margin:0 auto 18px;background:#fff;box-shadow:0 6px 24px rgba(0,0,0,.4)}',
    '.pv-page canvas{position:absolute;inset:0;width:100%;height:100%}',
    '.pv-page__n{position:absolute;right:-2px;bottom:-22px;font-size:11px;color:#9aa0a6}',
    '.pv-wait{position:absolute;inset:0;display:grid;place-items:center;color:#9aa0a6;font-size:13px;pointer-events:none}',
    '.pv-spin{width:28px;height:28px;border-radius:50%;border:2.5px solid #3c4043;border-top-color:#8ab4f8;animation:pv-spin .8s linear infinite;margin:0 auto 12px}',
    '@keyframes pv-spin{to{transform:rotate(360deg)}}',
    '.pv-fail{max-width:420px;padding:0 24px;text-align:center;line-height:1.6;color:#c4c7c5}',
    /* previous and next */
    '.pv-nav{position:absolute;top:50%;z-index:3;display:grid;place-items:center;width:48px;height:48px;margin-top:-24px;padding:0;border:0;border-radius:50%;background:rgba(32,33,36,.86);color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.4);transition:background .15s}',
    '.pv-nav:hover{background:#3c4043}',
    '.pv-prev{left:16px}.pv-next{right:16px}',
    /* the controls */
    '.pv-pill{position:absolute;left:50%;bottom:18px;z-index:3;transform:translateX(-50%);display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:rgba(32,33,36,.94);box-shadow:0 4px 18px rgba(0,0,0,.45);white-space:nowrap}',
    '.pv-pill button{display:inline-grid;place-items:center;min-width:36px;height:36px;padding:0 6px;border:0;border-radius:999px;background:transparent;color:#e8eaed;font:inherit;font-size:13px;cursor:pointer}',
    '.pv-pill button:hover{background:#3c4043}',
    '.pv-pill button[disabled]{opacity:.35;cursor:default;background:transparent}',
    '.pv-zoom{min-width:58px!important;font-variant-numeric:tabular-nums}',
    '.pv-sep{width:1px;height:20px;margin:0 6px;background:#4a4c50}',
    '.pv-page-at{padding:0 10px;font-size:13px;color:#c4c7c5;font-variant-numeric:tabular-nums}',
    /* the strip */
    '.pv-strip{flex:none;display:flex;gap:8px;justify-content:center;padding:10px 16px 12px;background:#202124;border-top:1px solid #2f3033;overflow-x:auto;scrollbar-width:thin}',
    '.pv-thumb{flex:none;position:relative;width:64px;height:48px;padding:0;border:2px solid transparent;border-radius:6px;background:#2d2e31;cursor:pointer;overflow:hidden;opacity:.62;transition:opacity .15s,border-color .15s}',
    '.pv-thumb:hover{opacity:1}',
    '.pv-thumb[aria-current="true"]{opacity:1;border-color:#8ab4f8}',
    '.pv-thumb img{display:block;width:100%;height:100%;object-fit:cover}',
    '.pv-thumb span{display:grid;place-items:center;width:100%;height:100%;color:#c4c7c5;font-size:10px;font-weight:700;letter-spacing:.1em}',
    '@media (max-width:640px){.pv-top{min-height:54px;padding:6px 6px 6px 12px;gap:8px}.pv-file__ic{display:none}.pv-name{font-size:14px}.pv-nav{width:40px;height:40px;margin-top:-20px}.pv-prev{left:8px}.pv-next{right:8px}.pv-pill{bottom:12px}.pv-pill button{min-width:34px;height:34px}.pv-zoom{min-width:52px!important}.pv-strip{justify-content:flex-start}.pv-thumb{width:52px;height:40px}}',
    '@media (max-width:380px){.pv-fitbtn{display:none!important}}',
    '@media (prefers-reduced-motion:reduce){.pv-spin{animation:none}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var dlg = document.createElement('dialog');
  dlg.className = 'pv';
  dlg.setAttribute('aria-label', 'File viewer');
  dlg.innerHTML = '<div class="pv-top">'
    + '<div class="pv-file"><span class="pv-file__ic" data-pv-ic></span><span class="pv-file__t"><span class="pv-name" data-pv-name></span><span class="pv-meta" data-pv-meta></span></span></div>'
    + '<div class="pv-tools"><a class="pv-ib" data-pv="save" href="#" download title="Download" aria-label="Download">' + icon('down') + '</a>'
    + '<button class="pv-ib" type="button" data-pv="close" title="Close (Esc)" aria-label="Close">' + icon('close') + '</button></div></div>'
    + '<div class="pv-stage" data-pv-stage>'
    + '<button class="pv-nav pv-prev" type="button" data-pv="prev" title="Previous" aria-label="Previous">' + icon('prev') + '</button>'
    + '<button class="pv-nav pv-next" type="button" data-pv="next" title="Next" aria-label="Next">' + icon('next') + '</button>'
    + '<div class="pv-pill" role="toolbar" aria-label="View">'
    + '<button type="button" data-pv="out" title="Zoom out (-)" aria-label="Zoom out">' + icon('minus') + '</button>'
    + '<button type="button" class="pv-zoom" data-pv="reset" title="Actual size" aria-label="Zoom" data-pv-zoom>100%</button>'
    + '<button type="button" data-pv="in" title="Zoom in (+)" aria-label="Zoom in">' + icon('plus') + '</button>'
    + '<span class="pv-sep" aria-hidden="true"></span>'
    + '<button type="button" class="pv-fitbtn" data-pv="fit" title="Fit to screen (0)" aria-label="Fit to screen">' + icon('fit') + '</button>'
    + '<button type="button" data-pv="rotate" title="Rotate (R)" aria-label="Rotate">' + icon('turn') + '</button>'
    + '<span class="pv-sep" aria-hidden="true" data-pv-pagesep hidden></span><span class="pv-page-at" data-pv-pageat hidden></span>'
    + '</div></div>'
    + '<div class="pv-strip" data-pv-strip role="listbox" aria-label="Files on this case"></div>';
  document.body.appendChild(dlg);

  var $ = function (sel) { return dlg.querySelector(sel); };
  var stage = $('[data-pv-stage]');
  var strip = $('[data-pv-strip]');
  var S = { items: [], i: 0, back: null };
  var view = null;   /* the open file's own view: an image or a PDF */

  /* ---- what a file is ---------------------------------------------------- */
  function typeOf(it) { return String(it.type || (/^data:([^;,]+)/.exec(String(it.src || '')) || [])[1] || ''); }
  function isPdf(it) { return /pdf/i.test(typeOf(it)); }
  function kindWord(it) {
    var t = typeOf(it).toLowerCase();
    if (/pdf/.test(t)) return 'PDF';
    var m = /image\/([a-z0-9.+-]+)/.exec(t);
    return m ? m[1].replace('jpeg', 'JPEG').replace('jpg', 'JPEG').replace('png', 'PNG').replace('webp', 'WebP').replace('heic', 'HEIC').replace('gif', 'GIF') : 'File';
  }
  function bytesOf(it) {
    var s = String(it.src || '');
    var at = s.indexOf(',');
    if (!/^data:[^,]*;base64,/.test(s) || at < 0) return 0;
    var b = s.length - at - 1;
    return Math.floor(b * 3 / 4) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
  }
  function sizeWord(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function nameOf(it, k) {
    if (it.name) return it.name;
    var ext = isPdf(it) ? 'pdf' : (kindWord(it).toLowerCase().replace('jpeg', 'jpg') || 'jpg');
    return (isPdf(it) ? 'document-' : 'photograph-') + (k + 1) + '.' + ext;
  }
  function titleOf(it, k) { return it.label || (isPdf(it) ? 'Document ' : 'Photograph ') + (k + 1); }
  function bytesFrom(src) {
    var parts = String(src).split(',');
    var bin = atob(parts[1] || '');
    var out = new Uint8Array(bin.length);
    for (var n = 0; n < bin.length; n += 1) out[n] = bin.charCodeAt(n);
    return out;
  }

  /* ---- the frame around the file ----------------------------------------- */
  function paintFrame() {
    var it = S.items[S.i];
    var many = S.items.length > 1;
    $('[data-pv-ic]').innerHTML = icon(isPdf(it) ? 'doc' : 'photo');
    $('[data-pv-name]').textContent = titleOf(it, S.i);
    $('[data-pv-meta]').textContent = [many ? (S.i + 1) + ' of ' + S.items.length : '', kindWord(it), sizeWord(bytesOf(it))].filter(Boolean).join(' \u00b7 ');
    var save = $('[data-pv="save"]');
    save.setAttribute('download', nameOf(it, S.i));
    save.href = it.src;
    $('[data-pv="prev"]').hidden = !many;
    $('[data-pv="next"]').hidden = !many;
    strip.hidden = !many;
    [].forEach.call(strip.children, function (b, k) { b.setAttribute('aria-current', String(k === S.i)); b.setAttribute('aria-selected', String(k === S.i)); });
    var on = strip.children[S.i];
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* older */ } }
  }
  function paintStrip() {
    strip.innerHTML = '';
    S.items.forEach(function (it, k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pv-thumb';
      b.setAttribute('role', 'option');
      b.setAttribute('data-pv-go', String(k));
      b.title = titleOf(it, k);
      b.setAttribute('aria-label', titleOf(it, k));
      if (isPdf(it)) { var s = document.createElement('span'); s.textContent = 'PDF'; b.appendChild(s); }
      else { var im = document.createElement('img'); im.alt = ''; im.src = it.src; im.decoding = 'async'; b.appendChild(im); }
      strip.appendChild(b);
    });
  }
  function zoomWord(z) { $('[data-pv-zoom]').textContent = Math.round(z * 100) + '%'; }
  function wait(text) {
    var w = document.createElement('div');
    w.className = 'pv-wait';
    w.innerHTML = '<div><div class="pv-spin"></div>' + text + '</div>';
    return w;
  }
  function failed(text) {
    var w = document.createElement('div');
    w.className = 'pv-wait';
    w.innerHTML = '<p class="pv-fail"></p>';
    w.firstChild.textContent = text;
    return w;
  }
  function clearStage() {
    [].slice.call(stage.children).forEach(function (c) {
      if (!c.classList.contains('pv-nav') && !c.classList.contains('pv-pill')) c.remove();
    });
  }

  /* ---- a photograph ------------------------------------------------------ */
  function imageView(it) {
    var v = { kind: 'image', z: 1, x: 0, y: 0, turn: 0, w: 0, h: 0, el: null, gone: false };
    var img = document.createElement('img');
    img.className = 'pv-img';
    img.alt = titleOf(it, S.i);
    img.draggable = false;
    var spinner = wait('Opening');
    stage.insertBefore(spinner, stage.firstChild);
    v.el = img;

    function box() { return { w: stage.clientWidth, h: stage.clientHeight }; }
    function fitZ() {
      var b = box();
      if (!v.w || !v.h) return 1;
      return Math.min((b.w - 48) / v.w, (b.h - 96) / v.h, 1);
    }
    /* kept on the screen: centred while it fits, never dragged off when it does not */
    function clamp() {
      var b = box();
      var w = v.w * v.z;
      var h = v.h * v.z;
      if (w <= b.w) v.x = (b.w - w) / 2; else v.x = Math.min(0, Math.max(b.w - w, v.x));
      if (h <= b.h) v.y = (b.h - h) / 2; else v.y = Math.min(0, Math.max(b.h - h, v.y));
    }
    function paint() {
      clamp();
      img.style.width = v.w + 'px';
      img.style.height = v.h + 'px';
      img.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')';
      stage.classList.toggle('can-pan', v.w * v.z > box().w + 1 || v.h * v.z > box().h + 1);
      zoomWord(v.z);
      $('[data-pv="out"]').disabled = v.z <= MIN + 1e-6;
      $('[data-pv="in"]').disabled = v.z >= MAX - 1e-6;
    }
    /* zoomed about a point on the screen, which stays under the pointer */
    function zoomTo(z, cx, cy) {
      var b = box();
      if (cx == null) { cx = b.w / 2; cy = b.h / 2; }
      z = Math.min(MAX, Math.max(MIN, z));
      var px = (cx - v.x) / v.z;
      var py = (cy - v.y) / v.z;
      v.z = z;
      v.x = cx - px * z;
      v.y = cy - py * z;
      paint();
    }
    function fit() { v.z = fitZ(); v.x = 0; v.y = 0; clamp(); v.x = (box().w - v.w * v.z) / 2; v.y = (box().h - v.h * v.z) / 2; paint(); }
    function load(src) {
      img.onload = function () {
        if (v.gone) return;
        v.w = img.naturalWidth; v.h = img.naturalHeight;
        if (!img.isConnected) stage.insertBefore(img, stage.firstChild);
        spinner.remove();
        fit();
      };
      img.onerror = function () { spinner.remove(); stage.insertBefore(failed('This photograph could not be shown. Download it to open it on this computer.'), stage.firstChild); };
      img.src = src;
    }
    load(it.src);

    v.zoomIn = function () { zoomTo(STEPS.filter(function (s) { return s > v.z + 1e-3; })[0] || MAX); };
    v.zoomOut = function () { zoomTo(STEPS.filter(function (s) { return s < v.z - 1e-3; }).pop() || MIN); };
    v.fit = fit;
    v.actual = function (cx, cy) { zoomTo(1, cx, cy); };
    v.toggle = function (cx, cy) { if (Math.abs(v.z - fitZ()) < 0.01 && fitZ() < 1) zoomTo(1, cx, cy); else fit(); };
    v.zoomBy = function (k, cx, cy) { zoomTo(v.z * k, cx, cy); };
    v.panBy = function (dx, dy) { v.x += dx; v.y += dy; paint(); };
    v.canPan = function () { return v.w * v.z > box().w + 1 || v.h * v.z > box().h + 1; };
    v.resize = function () { if (v.w) { if (Math.abs(v.z - fitZ()) < 0.02) fit(); else paint(); } };
    v.rotate = function () {
      v.turn = (v.turn + 1) % 4;
      if (!v.turn) { load(it.src); return; }
      turned(it.src, v.turn).then(function (u) { if (!v.gone) load(u); });
    };
    v.destroy = function () { v.gone = true; img.remove(); spinner.remove(); };
    $('[data-pv-pageat]').hidden = true;
    $('[data-pv-pagesep]').hidden = true;
    $('[data-pv="reset"]').disabled = false;
    return v;
  }

  /* turned by redrawing, so the picture lays out at its new shape */
  var turns = {};
  function turned(src, quarter) {
    var key = quarter + ':' + src.length + ':' + src.slice(-48);
    if (turns[key]) return Promise.resolve(turns[key]);
    return new Promise(function (resolve) {
      var pic = new Image();
      pic.onload = function () {
        var c = document.createElement('canvas');
        var side = quarter % 2;
        c.width = side ? pic.naturalHeight : pic.naturalWidth;
        c.height = side ? pic.naturalWidth : pic.naturalHeight;
        var g = c.getContext('2d');
        g.translate(c.width / 2, c.height / 2);
        g.rotate(quarter * Math.PI / 2);
        g.drawImage(pic, -pic.naturalWidth / 2, -pic.naturalHeight / 2);
        turns[key] = c.toDataURL('image/jpeg', 0.92);
        resolve(turns[key]);
      };
      pic.onerror = function () { resolve(src); };
      pic.src = src;
    });
  }

  /* ---- a PDF, drawn by pdf.js -------------------------------------------- */
  /* the folder, from the file the panel's bundle carries (scripts/build-firebase.js) */
  var BASE = new URL('assets/vendor/pdfjs/pdf.min.js', document.baseURI).href.replace(/pdf\.min\.js$/, '');
  var libPromise = null;
  function pdfLib() {
    if (!libPromise) {
      libPromise = import(BASE + 'pdf.min.js').then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
        return pdfjs;
      }, function (e) { libPromise = null; throw e; });
    }
    return libPromise;
  }

  function pdfView(it) {
    var v = { kind: 'pdf', z: 1, turn: 0, doc: null, task: null, pages: [], gone: false, at: 1 };
    var scroller = document.createElement('div');
    scroller.className = 'pv-pdf';
    var spinner = wait('Opening the document');
    stage.insertBefore(scroller, stage.firstChild);
    stage.insertBefore(spinner, stage.firstChild);
    $('[data-pv-pageat]').hidden = false;
    $('[data-pv-pagesep]').hidden = false;
    $('[data-pv-pageat]').textContent = '';
    $('[data-pv="reset"]').disabled = false;
    var base = [];      /* each page's size at scale 1, rotation 0 */
    var redraw = 0;

    function fitScale() {
      if (!base.length) return 1;
      var widest = Math.max.apply(null, base.map(function (b) { return v.turn % 2 ? b.h : b.w; }));
      /* a page as wide as the screen allows, up to a comfortable reading width,
         clear of Previous and Next */
      return Math.max(0.2, Math.min(stage.clientWidth - (stage.clientWidth < 640 ? 32 : 136), 920) / widest);
    }
    function scale() { return fitScale() * v.z; }
    function word() { zoomWord(v.z); $('[data-pv="out"]').disabled = v.z <= 0.25 + 1e-6; $('[data-pv="in"]').disabled = v.z >= 5 - 1e-6; }
    function pageAt() {
      var mid = scroller.scrollTop + scroller.clientHeight / 3;
      var n = 1;
      v.pages.forEach(function (p, k) { if (p.box.offsetTop <= mid) n = k + 1; });
      v.at = n;
      $('[data-pv-pageat]').textContent = 'Page ' + n + ' of ' + v.pages.length;
    }
    /* the frames for every page, at the scale; a page is drawn when near */
    function layout(keep) {
      var s = scale();
      var ratio = keep && scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0;
      v.pages.forEach(function (p, k) {
        var b = base[k];
        var w = (v.turn % 2 ? b.h : b.w) * s;
        var h = (v.turn % 2 ? b.w : b.h) * s;
        p.box.style.width = Math.round(w) + 'px';
        p.box.style.height = Math.round(h) + 'px';
        p.drawnAt = 0;
      });
      if (keep) scroller.scrollTop = ratio * scroller.scrollHeight;
      word();
      clearTimeout(redraw);
      redraw = setTimeout(drawNear, 60);
    }
    function drawNear() {
      if (v.gone) return;
      var top = scroller.scrollTop - scroller.clientHeight;
      var bottom = scroller.scrollTop + scroller.clientHeight * 2;
      v.pages.forEach(function (p) {
        var y = p.box.offsetTop;
        if (y + p.box.offsetHeight >= top && y <= bottom) draw(p);
      });
    }
    function draw(p) {
      var s = scale();
      var key = s.toFixed(3) + ':' + v.turn;
      if (p.drawnAt === key || p.busy === key) return;
      p.busy = key;
      v.doc.getPage(p.n).then(function (page) {
        if (v.gone || p.busy !== key) return null;
        var dpr = Math.min(window.devicePixelRatio || 1, 3);
        var vp = page.getViewport({ scale: s * dpr, rotation: (page.rotate + v.turn * 90) % 360 });
        var c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        if (p.render) { try { p.render.cancel(); } catch (e) { /* done */ } }
        p.render = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
        return p.render.promise.then(function () {
          if (v.gone || p.busy !== key) return;
          if (p.canvas) p.canvas.remove();
          p.canvas = c;
          p.box.insertBefore(c, p.box.firstChild);
          p.drawnAt = key;
          p.busy = '';
        });
      }).catch(function () { p.busy = ''; });
    }

    pdfLib().then(function (pdfjs) {
      if (v.gone) return null;
      v.task = pdfjs.getDocument({ data: bytesFrom(it.src), wasmUrl: BASE + 'wasm/', isEvalSupported: false, enableXfa: false });
      return v.task.promise;
    }).then(function (doc) {
      if (!doc || v.gone) return null;
      v.doc = doc;
      var n = doc.numPages;
      var sizes = [];
      for (var k = 1; k <= n; k += 1) sizes.push(doc.getPage(k).then(function (page) { var vp = page.getViewport({ scale: 1, rotation: page.rotate }); return { w: vp.width, h: vp.height }; }));
      return Promise.all(sizes);
    }).then(function (sizes) {
      if (!sizes || v.gone) return;
      base = sizes;
      sizes.forEach(function (b, k) {
        var box = document.createElement('div');
        box.className = 'pv-page';
        var num = document.createElement('span');
        num.className = 'pv-page__n';
        num.textContent = (k + 1) + ' / ' + sizes.length;
        box.appendChild(num);
        scroller.appendChild(box);
        v.pages.push({ n: k + 1, box: box, canvas: null, drawnAt: 0, busy: '' });
      });
      spinner.remove();
      layout(false);
      pageAt();
      scroller.addEventListener('scroll', function () { pageAt(); clearTimeout(redraw); redraw = setTimeout(drawNear, 50); }, { passive: true });
    }).catch(function () {
      if (v.gone) return;
      spinner.remove();
      $('[data-pv-pageat]').hidden = true;
      $('[data-pv-pagesep]').hidden = true;
      stage.insertBefore(failed('This document could not be shown here. Download it to open it on this computer.'), stage.firstChild);
    });

    var steps = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 5];
    v.zoomIn = function () { v.z = steps.filter(function (s) { return s > v.z + 1e-3; })[0] || 5; layout(true); };
    v.zoomOut = function () { v.z = steps.filter(function (s) { return s < v.z - 1e-3; }).pop() || 0.25; layout(true); };
    v.zoomBy = function (k) { v.z = Math.min(5, Math.max(0.25, v.z * k)); layout(true); };
    v.fit = function () { v.z = 1; layout(true); };
    v.actual = function () { v.z = 1 / fitScale(); layout(true); };
    v.toggle = v.fit;
    v.canPan = function () { return false; };
    v.panBy = function () {};
    v.resize = function () { layout(true); };
    v.rotate = function () { v.turn = (v.turn + 1) % 4; layout(true); };
    v.destroy = function () {
      v.gone = true;
      clearTimeout(redraw);
      v.pages.forEach(function (p) { if (p.render) { try { p.render.cancel(); } catch (e) { /* done */ } } });
      if (v.task) { try { v.task.destroy(); } catch (e) { /* done */ } }
      scroller.remove();
      spinner.remove();
    };
    word();
    return v;
  }

  /* ---- opening, moving, closing ------------------------------------------ */
  function show() {
    if (view) view.destroy();
    clearStage();
    var it = S.items[S.i];
    paintFrame();
    view = isPdf(it) ? pdfView(it) : imageView(it);
  }
  function go(step) {
    if (S.items.length < 2) return;
    S.i = (S.i + step + S.items.length) % S.items.length;
    show();
  }
  function close() { if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); done(); } }
  function done() {
    if (view) { view.destroy(); view = null; }
    clearStage();
    turns = {};
    var back = S.back;
    S = { items: [], i: 0, back: null };
    if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
  }
  dlg.addEventListener('close', done);
  dlg.addEventListener('cancel', function () { /* Escape: the dialog closes itself */ });

  dlg.addEventListener('click', function (e) {
    var go_ = e.target.closest && e.target.closest('[data-pv-go]');
    if (go_) { var k = Number(go_.getAttribute('data-pv-go')); if (k !== S.i) { S.i = k; show(); } return; }
    var b = e.target.closest && e.target.closest('[data-pv]');
    if (!b) return;
    var what = b.getAttribute('data-pv');
    if (what === 'save') return;
    e.preventDefault();
    if (b.disabled || !view) { if (what === 'close') close(); return; }
    if (what === 'close') close();
    else if (what === 'prev') go(-1);
    else if (what === 'next') go(1);
    else if (what === 'in') view.zoomIn();
    else if (what === 'out') view.zoomOut();
    else if (what === 'fit') view.fit();
    else if (what === 'reset') view.actual();
    else if (what === 'rotate') view.rotate();
  });
  dlg.addEventListener('keydown', function (e) {
    if (!view || e.altKey) return;
    var k = e.key;
    var typing = e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
    if (typing) return;
    if (k === 'ArrowLeft' && !(view.kind === 'image' && view.canPan())) { e.preventDefault(); go(-1); }
    else if (k === 'ArrowRight' && !(view.kind === 'image' && view.canPan())) { e.preventDefault(); go(1); }
    else if (k === '+' || k === '=') { e.preventDefault(); view.zoomIn(); }
    else if (k === '-' || k === '_') { e.preventDefault(); view.zoomOut(); }
    else if (k === '0') { e.preventDefault(); view.fit(); }
    else if (k === 'r' || k === 'R') { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); view.rotate(); } }
    else if (view.kind === 'image' && view.canPan() && /^Arrow/.test(k)) {
      e.preventDefault();
      var d = 60;
      view.panBy(k === 'ArrowLeft' ? d : k === 'ArrowRight' ? -d : 0, k === 'ArrowUp' ? d : k === 'ArrowDown' ? -d : 0);
    }
  });

  /* the wheel: Ctrl or Cmd zooms; without, a zoomed photograph moves */
  stage.addEventListener('wheel', function (e) {
    if (!view) return;
    var r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      view.zoomBy(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    } else if (view.kind === 'image') {
      e.preventDefault();
      if (view.canPan()) view.panBy(-e.deltaX, -e.deltaY);
    }
  }, { passive: false });

  /* pointers: drag to move a zoomed photograph, pinch to zoom, swipe to turn */
  var touches = {};
  var drag = null;
  stage.addEventListener('pointerdown', function (e) {
    if (!view || view.kind !== 'image' || e.target.closest('.pv-nav,.pv-pill')) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
    var ids = Object.keys(touches);
    if (ids.length === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, t: Date.now(), moved: false };
    else if (ids.length === 2) {
      var a = touches[ids[0]], b = touches[ids[1]];
      drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag || !touches[e.pointerId] || !view) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(touches);
    var r = stage.getBoundingClientRect();
    if (ids.length === 2 && drag.pinch) {
      var a = touches[ids[0]], b = touches[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 0) view.zoomBy(d / drag.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      drag.pinch = d;
      return;
    }
    if (drag.pinch) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
    if (view.canPan()) { stage.classList.add('is-panning'); view.panBy(dx, dy); }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  function lift(e) {
    if (!touches[e.pointerId]) return;
    delete touches[e.pointerId];
    stage.classList.remove('is-panning');
    if (drag && !drag.pinch && view && !view.canPan() && e.pointerType !== 'mouse') {
      var dx = e.clientX - drag.x0;
      if (Math.abs(dx) > 60 && Date.now() - drag.t < 700) go(dx < 0 ? 1 : -1);
    }
    if (!Object.keys(touches).length) drag = null;
  }
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('dblclick', function (e) {
    if (!view || view.kind !== 'image' || e.target.closest('.pv-nav,.pv-pill')) return;
    var r = stage.getBoundingClientRect();
    view.toggle(e.clientX - r.left, e.clientY - r.top);
  });
  var sized = 0;
  window.addEventListener('resize', function () { if (!dlg.open || !view) return; clearTimeout(sized); sized = setTimeout(function () { if (view) view.resize(); }, 80); });

  function open(items, index) {
    var list = (items || []).filter(function (it) { return it && it.src; });
    if (!list.length) return;
    S = { items: list, i: Math.min(Math.max(Number(index) || 0, 0), list.length - 1), back: document.activeElement };
    paintStrip();
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
    show();
    var c = $('[data-pv="close"]');
    if (c) c.focus({ preventScroll: true });
  }

  window.PFAViewer = { open: open, close: close };
}());
