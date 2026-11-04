/* The interns' two-page guide, read before applying (owner, 4 Nov 2026:
   "one should read this before starting right. have a proper viewer of the
   guide and show it mandatorily, i understand chck box, and then allow to
   apply").

   The guide's own pages (intern-guide.html, its .gd-page articles) are shown
   in a viewer over internship.html: one copy of the words, so the page, the
   PDF and the viewer never disagree. The application (#apply) stays locked
   behind a short note until the guide has been read to its end and "I have
   read the guide" ticked; then Continue opens the form. The tick is
   remembered in this browser, and the application carries it
   (guide: "Read and understood"), which the server requires
   (lib/submission-fields.js PFA-VI).

   Opened by any [data-guide-open] button, and by itself when the apply form
   is opened before the guide was read. Without this script nothing is
   locked. */
(function () {
  'use strict';
  var KEY = 'pfa.internGuideRead';
  var SRC = 'intern-guide.html';
  var PDF = 'media/intern/PFA-intern-quick-start-guide.pdf';
  var apply = document.getElementById('apply');
  var read = false;
  try { read = window.localStorage.getItem(KEY) === '1'; } catch (_) { read = false; }

  var dlg = null; var body = null; var tick = null; var go = null; var note = null;
  var loaded = false; var reachedEnd = false; var mode = 'read';

  function css() {
    if (document.getElementById('igCss')) return;
    var l = document.createElement('link');
    l.id = 'igCss'; l.rel = 'stylesheet'; l.href = 'assets/intern-guide.css';
    document.head.appendChild(l);
    var s = document.createElement('style');
    s.textContent = '.ig{--ink:#111;--paper:#fff;--line:#e4e2df;--muted:#6a6a6a;padding:0;border:0;width:min(880px,calc(100vw - 32px));max-width:none;height:min(920px,calc(100dvh - 32px));max-height:none;background:#fff;color:#111;font-family:var(--body,Helvetica,Arial,sans-serif)}'
      + '.ig[open]{display:flex;flex-direction:column}.ig::backdrop{background:rgba(10,10,10,.72)}'
      + '.ig__head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid #e4e2df}'
      + '.ig__k{margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6a6a6a}'
      + '.ig__h{margin:0;font-family:var(--display);font-weight:400;font-size:24px;line-height:1.15;color:#111}'
      + '.ig__x{flex:none;min-height:44px;padding:0 16px;border:1px solid #111;background:#fff;color:#111;font:inherit;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}'
      + '.ig__body{flex:1 1 auto;overflow:auto;padding:0 24px 28px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}'
      + '.ig__body .gd{padding-top:24px;gap:40px}.ig__body .gd-page{max-width:none}.ig__body ol,.ig__body ul{list-style:none;padding:0}.ig__body .gd-weeks{margin-left:0}'
      + '.ig__wait{margin:24px 0;font-size:16px;color:#6a6a6a}'
      + '.ig__foot{flex:none;padding:14px 24px 18px;border-top:1px solid #e4e2df;background:#fff}'
      + '.ig__tick{display:flex;align-items:center;gap:12px;margin:0;font-size:16px;line-height:1.45;color:#111;cursor:pointer}'
      + '.ig__tick input{flex:none;width:22px;height:22px;margin:0;accent-color:#111;cursor:pointer}.ig__tick input:disabled{cursor:not-allowed}.ig__tick input:disabled + span{color:#6a6a6a}'
      + '.ig__note{margin:6px 0 0 34px;font-size:13px;line-height:1.45;color:#6a6a6a}.ig__note:empty{display:none}'
      + '.ig__acts{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;margin:14px 0 0}'
      + '.ig__go{min-height:48px;padding:0 26px;border:1px solid #111;background:#111;color:#fff;font:inherit;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}'
      + '.ig__go:disabled{background:#d9d7d3;border-color:#d9d7d3;color:#3d3d3d;cursor:not-allowed}'
      + '.ig__pdf{font-size:14px;color:#111;text-decoration:underline;text-underline-offset:3px}'
      + '@media (max-width:640px){.ig{width:100vw;height:100dvh;margin:0;max-height:100dvh}.ig__head{padding:12px 16px}.ig__h{font-size:20px}.ig__body{padding:0 16px 24px}.ig__foot{padding:12px 16px calc(14px + env(safe-area-inset-bottom))}.ig__acts{gap:10px 16px}.ig__go{flex:1 1 100%}}';
    document.head.appendChild(s);
  }

  function build() {
    if (dlg) return;
    css();
    dlg = document.createElement('dialog');
    dlg.className = 'ig';
    dlg.id = 'igView';
    dlg.setAttribute('aria-labelledby', 'igTitle');
    dlg.innerHTML = '<div class="ig__head"><div><p class="ig__k" id="igKicker">Before you apply</p><h2 class="ig__h" id="igTitle">The two-page guide</h2></div>'
      + '<button type="button" class="ig__x" data-guide-close>Close</button></div>'
      + '<div class="ig__body" tabindex="0" aria-label="The guide"><div class="gd" data-guide-body><p class="ig__wait">Opening the guide&#8230;</p></div></div>'
      + '<div class="ig__foot"><label class="ig__tick"><input type="checkbox" id="igOk" disabled> <span>I have read the guide and understand what the eight weeks ask of me.</span></label>'
      + '<p class="ig__note" id="igNote" aria-live="polite">Read to the end of the guide to tick this.</p>'
      + '<div class="ig__acts"><button type="button" class="ig__go" id="igGo" disabled>Continue to apply</button><a class="ig__pdf" href="' + PDF + '" download>Download the PDF</a></div></div>';
    document.body.appendChild(dlg);
    body = dlg.querySelector('.ig__body');
    tick = dlg.querySelector('#igOk');
    go = dlg.querySelector('#igGo');
    note = dlg.querySelector('#igNote');
    body.addEventListener('scroll', atEnd, { passive: true });
    tick.addEventListener('change', function () { go.disabled = !tick.checked; });
    go.addEventListener('click', accept);
    dlg.addEventListener('click', function (e) { if (e.target.closest('[data-guide-close]')) dlg.close(); });
  }

  function load() {
    if (loaded) return Promise.resolve();
    var box = dlg.querySelector('[data-guide-body]');
    return fetch(SRC, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('not found');
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var pages = doc.querySelectorAll('.gd-page');
      if (!pages.length) throw new Error('empty');
      box.innerHTML = '';
      Array.prototype.forEach.call(pages, function (p) { box.appendChild(document.importNode(p, true)); });
      /* links inside open beside the application, so nothing typed is lost */
      Array.prototype.forEach.call(box.querySelectorAll('a[href]'), function (a) { a.target = '_blank'; a.rel = 'noopener'; });
      loaded = true;
      requestAnimationFrame(atEnd);
    }).catch(function () {
      /* the guide could not be fetched: its page, in a new tab, still counts */
      box.innerHTML = '<p class="ig__wait">The guide did not open here. <a class="gd-a" href="' + SRC + '" target="_blank" rel="noopener" data-guide-tab>Open it in a new tab</a>, read it, then come back and tick below.</p>';
      var tab = box.querySelector('[data-guide-tab]');
      tab.addEventListener('click', function () { reachedEnd = true; allowTick(); });
    });
  }

  function allowTick() {
    tick.disabled = false;
    note.textContent = '';
  }

  /* the tick waits until the guide has been read to its end */
  function atEnd() {
    if (reachedEnd || !loaded) return;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 48) { reachedEnd = true; allowTick(); }
  }

  function open(why) {
    build();
    mode = why === 'apply' ? 'apply' : 'read';
    dlg.querySelector('#igKicker').textContent = mode === 'apply' || !read ? 'Before you apply' : 'Internship';
    go.textContent = 'Continue to apply';
    if (read) { reachedEnd = true; tick.checked = true; allowTick(); go.disabled = false; }
    if (!dlg.open) { try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); } }
    body.scrollTop = 0;
    load();
    (read ? go : body).focus();
  }

  function unlock() {
    if (apply) apply.classList.remove('ig-locked');
  }

  function accept() {
    if (!tick.checked) return;
    read = true;
    try { window.localStorage.setItem(KEY, '1'); } catch (_) { /* remembered for this visit */ }
    unlock();
    dlg.close();
    /* into the application: open it if it is not open yet */
    var flowOpen = apply && !apply.classList.contains('pfa-flow-off') && location.hash === '#apply';
    if (!flowOpen) {
      var a = document.createElement('a');
      a.href = '#apply';
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(function () { var first = document.getElementById('name'); if (first) first.focus(); }, 120);
  }

  /* the application waits for the guide */
  if (apply && !read) {
    apply.classList.add('ig-locked');
    css();
    apply.addEventListener('pfa:flow-open', function () { if (!read) open('apply'); });
    if (location.hash === '#apply') setTimeout(function () { if (!read) open('apply'); }, 300);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-guide-open]');
    if (!b) return;
    e.preventDefault();
    open(b.getAttribute('data-guide-open') || 'read');
  });

  window.PFAInternGuide = { ok: function () { return read; }, open: open };
})();
