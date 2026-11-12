/* People for Animals - where the signature sits on the internship
   certificate, set from the panel.
   ------------------------------------------------------------------------
   Owner, 12 Nov 2026, with the certificate's design and its own position
   controls: "fix the bugs. and update this certificate with controls".

   In Internship certificates, under the + Signature position: Left / right
   and Up / down, each a slider with its number beside it, in the design's
   own pixels and ranges (100 either way across, 50 up or down). The preview
   above follows as they move. Save keeps it for every certificate the site
   draws (lib/certificate-layout.js, in the audit log): this preview, the PDF
   downloaded or emailed from here, the certificate online and the sample
   on the internship page. Reset goes back to the design's own place (26
   to the right). Leaving without saving puts the saved place back.

   admin.html calls PFACertLayout.panel(saved) in the certificates pane, and
   ctDraw keeps the preview's data on its canvas for the redraw here. Kept
   out of admin.html so that page stays under its page-weight ceiling.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFACertLayout) return;
  var esc = A.esc;
  var saved = null;
  var latest = null;   /* what this panel last saved, newer than the pane may hold */

  var style = document.createElement('style');
  style.textContent = [
    '.ct-sig{margin:0}',
    '.ct-sig__body{display:grid;gap:14px;max-width:620px;padding:12px 0 4px}',
    '.ct-sig__row{display:grid;grid-template-columns:110px minmax(0,1fr) 92px;align-items:center;gap:14px}',
    '.ct-sig__row label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.ct-sig__row input[type=range]{width:100%;margin:0;accent-color:var(--ink)}',
    '.ct-sig__num{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}',
    '.ct-sig__num input{width:64px;height:36px;padding:0 8px;border:1px solid var(--line);font:inherit;font-size:14px;background:var(--paper);color:var(--ink)}',
    '.ct-sig__num input:focus{border-color:var(--ink);outline:none}',
    '.ct-sig__acts{display:flex;flex-wrap:wrap;align-items:center;gap:10px}',
    '.ct-sig__acts .press{display:inline-flex;width:auto;align-items:center;min-height:40px;padding:0 20px}',
    '.ct-sig__acts .ghost{min-height:40px}',
    '.ct-sig__acts .say{margin:0;font-size:12px;overflow-wrap:anywhere}',
    '.ct-sig__note{margin:0;font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}',
    '@media (max-width:620px){.ct-sig__row{grid-template-columns:minmax(0,1fr) 92px}.ct-sig__row label{grid-column:1 / -1}}'
  ].join('');
  document.head.appendChild(style);

  function C() { return window.PFACertificate; }
  function range() { var c = C(); return (c && c.SIG_RANGE) || { x: 100, y: 50 }; }
  function home() { var c = C(); return (c && c.SIG_DEFAULT) || { x: 26, y: 0 }; }
  function now() { var c = C(); return c && c.layout ? c.layout() : home(); }

  function row(axis, label, max, value) {
    return '<div class="ct-sig__row"><label for="ctSig' + axis + 'R">' + label + '</label>'
      + '<input id="ctSig' + axis + 'R" type="range" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-sig="' + axis + '" aria-label="' + label + '">'
      + '<span class="ct-sig__num"><input id="ctSig' + axis + 'N" type="number" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-sig="' + axis + '" aria-label="' + label + ', in pixels"> px</span></div>';
  }

  function whoWhen(l) {
    if (!l || !l.updatedAt) return 'Not set yet: the design’s own place.';
    var at = '';
    try { at = new Date(l.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); } catch (e) { at = l.updatedAt; }
    return 'Saved by ' + (l.updatedBy || 'someone') + ', ' + at + '.';
  }

  /* the + Signature position, as the pane is drawn */
  function panel(l) {
    saved = l && Number.isFinite(Number(l.x)) ? { x: Number(l.x), y: Number(l.y), updatedAt: l.updatedAt || '', updatedBy: l.updatedBy || '' } : { x: home().x, y: home().y };
    if (latest && String(latest.updatedAt) >= String(saved.updatedAt || '')) saved = latest;
    var c = C();
    if (c && c.setLayout) c.setLayout(saved);
    var r = range();
    return '<details class="fold ct-sig" id="ctSig"><summary>Signature position</summary><div class="ct-sig__body">'
      + row('x', 'Left / right', r.x, saved.x)
      + row('y', 'Up / down', r.y, saved.y)
      + '<div class="ct-sig__acts"><button class="press" type="button" data-sig-act="save" disabled>Save for every certificate</button>'
      + '<button class="ghost" type="button" data-sig-act="reset">Reset</button>'
      + '<p class="say" data-sig-say role="status" aria-live="polite"></p></div>'
      + '<p class="ct-sig__note" data-sig-when>' + esc(whoWhen(saved)) + ' Moves are in the certificate’s own pixels: right and down are more, left and up are less. The preview follows as you move it.</p>'
      + '</div></details>';
  }

  function redraw() {
    var canvas = document.getElementById('ctCanvas');
    var c = C();
    if (canvas && c && canvas._ctData) c.draw(canvas, canvas._ctData, 2);
  }
  function show(axis, v) {
    var max = range()[axis];
    var n = Math.max(-max, Math.min(max, Math.round(Number(v) || 0)));
    ['R', 'N'].forEach(function (k) { var el = document.getElementById('ctSig' + axis + k); if (el && Number(el.value) !== n) el.value = n; });
    return n;
  }
  function apply() {
    var x = show('x', (document.getElementById('ctSigxN') || {}).value);
    var y = show('y', (document.getElementById('ctSigyN') || {}).value);
    var c = C();
    if (c && c.setLayout) c.setLayout({ x: x, y: y });
    redraw();
    var changed = !saved || x !== saved.x || y !== saved.y;
    var b = document.querySelector('[data-sig-act="save"]');
    if (b) b.disabled = !changed;
    var say = document.querySelector('[data-sig-say]');
    if (say) A.say(say, changed ? 'Not saved yet.' : '', '');
  }

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute || !el.getAttribute('data-sig')) return;
    var axis = el.getAttribute('data-sig');
    var other = document.getElementById('ctSig' + axis + (el.type === 'range' ? 'N' : 'R'));
    if (other) other.value = el.value;
    apply();
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-sig') && el.type === 'number') { show(el.getAttribute('data-sig'), el.value); apply(); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-sig-act]');
    if (!b) return;
    var what = b.getAttribute('data-sig-act');
    var say = document.querySelector('[data-sig-say]');
    if (what === 'reset') {
      show('x', home().x); show('y', home().y);
      apply();
      return;
    }
    if (what === 'save' && !b.disabled) {
      var l = now();
      b.disabled = true;
      A.say(say, 'Saving…', '');
      A.api('/api/admin/certificates', { method: 'POST', body: { action: 'layout', x: l.x, y: l.y } }).then(function (r) {
        saved = r.layout;
        latest = r.layout;
        var when = document.querySelector('[data-sig-when]');
        if (when) when.firstChild.textContent = whoWhen(saved) + ' Moves are in the certificate’s own pixels: right and down are more, left and up are less. The preview follows as you move it.';
        A.say(say, 'Saved. Every certificate the site draws has the signature here from now on.', 'good');
      }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'That could not be saved.', 'bad'); });
    }
  });

  /* leaving the pane without saving: the saved place, so nothing is drawn,
     downloaded or emailed with a position nobody saved */
  function forget() {
    var c = C();
    if (saved && c && c.setLayout) {
      var l = c.layout();
      if (l.x !== saved.x || l.y !== saved.y) c.setLayout(saved);
    }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-tab], [data-pane-tab], .tab') && !e.target.closest('[data-pane="certificates"]')) forget();
  }, true);

  window.PFACertLayout = { panel: panel, forget: forget };
}());
