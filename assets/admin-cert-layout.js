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
    '.ct-sig__row{display:grid;grid-template-columns:110px minmax(0,1fr) auto;align-items:center;gap:8px 14px}',
    '.ct-sig__nudge{grid-column:2 / -1;display:flex;flex-wrap:wrap;gap:6px}',
    '.ct-sig__nudge button{min-width:52px;min-height:44px;padding:0 10px;border:1px solid var(--line);background:var(--paper);color:var(--ink);font:inherit;font-size:13px;cursor:pointer;touch-action:manipulation;user-select:none}',
    '.ct-sig__nudge button:hover{border-color:var(--ink)}',
    '.ct-sig__nudge button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}',
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
    '@media (max-width:620px){.ct-sig__row{grid-template-columns:minmax(0,1fr) auto}.ct-sig__row label,.ct-sig__nudge{grid-column:1 / -1}}'
  ].join('');
  document.head.appendChild(style);

  function C() { return window.PFACertificate; }
  function range() { var c = C(); return (c && c.SIG_RANGE) || { x: 1120, y: 792 }; }
  function home() { var c = C(); var h = (c && c.SIG_DEFAULT) || { x: 26, y: 0 }; return { x: h.x, y: h.y, s: h.s || 100 }; }
  /* the signature's size (owner, 15 Nov 2026: "there should be option to
     adjust the size of the sign as well not just position"), in per cent */
  var SIZE = { min: 20, max: 300 };
  function sizeRow(id, data, value, extra) {
    return '<div class="ct-sig__row"><label for="' + id + 'R">Size</label>'
      + '<input id="' + id + 'R" type="range" min="' + SIZE.min + '" max="' + SIZE.max + '" step="1" value="' + value + '" ' + data + ' aria-label="Size">'
      + '<span class="ct-sig__num"><input id="' + id + 'N" type="number" min="' + SIZE.min + '" max="' + SIZE.max + '" step="1" value="' + value + '" ' + data + ' aria-label="Size, in per cent"> %</span></div>';
  }
  function sizeOf(v) { var n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(SIZE.min, Math.min(SIZE.max, n)) : 100; }
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

  /* fine steps beside every slider, wherever a Signature position is drawn
     (owner, 27 Nov 2026: "there should be more/unlimited adjustment in terms
     of left/right, up down etc.. wherever this feature is"). The range is
     now the whole page or card, so the slider moves far and fast; these
     move it by 1 or 10, and repeat while held. They set the row's number
     box and say so, as typing in it does, so each studio's own code moves
     the signature and offers Save. */
  var STEPS = {
    x: [[-10, 'Left 10', 'Left 10'], [-1, 'Left 1', 'Left 1'], [1, 'Right 1', 'Right 1'], [10, 'Right 10', 'Right 10']],
    y: [[-10, 'Up 10', 'Up 10'], [-1, 'Up 1', 'Up 1'], [1, 'Down 1', 'Down 1'], [10, 'Down 10', 'Down 10']],
    s: [[-10, '-10%', 'Smaller by 10 per cent'], [-1, '-1%', 'Smaller by 1 per cent'], [1, '+1%', 'Larger by 1 per cent'], [10, '+10%', 'Larger by 10 per cent']]
  };
  function axisOf(num) { return num.getAttribute('data-sig') || num.getAttribute('data-axis') || ''; }
  function addNudges(rootEl) {
    Array.prototype.forEach.call((rootEl || document).querySelectorAll('.ct-sig__row'), function (row) {
      if (row.querySelector('.ct-sig__nudge')) return;
      var num = row.querySelector('input[type=number]');
      var steps = num && STEPS[axisOf(num)];
      if (!steps) return;
      var box = document.createElement('div');
      box.className = 'ct-sig__nudge';
      box.innerHTML = steps.map(function (s) { return '<button type="button" data-nudge="' + s[0] + '" aria-label="' + s[2] + '">' + s[1] + '</button>'; }).join('');
      row.appendChild(box);
    });
  }
  function nudge(btn) {
    var num = btn.closest('.ct-sig__row').querySelector('input[type=number]');
    if (!num) return;
    var lo = Number(num.min), hi = Number(num.max);
    var v = (Number(num.value) || 0) + Number(btn.getAttribute('data-nudge'));
    if (Number.isFinite(lo) && num.min !== '') v = Math.max(lo, v);
    if (Number.isFinite(hi) && num.max !== '') v = Math.min(hi, v);
    num.value = String(v);
    num.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var held = null;
  function letGo() { if (held) { clearTimeout(held.t); clearInterval(held.i); held = null; } }
  document.addEventListener('pointerdown', function (e) {
    var b = e.target.closest && e.target.closest('[data-nudge]');
    if (!b || e.button) return;
    e.preventDefault();
    letGo();
    nudge(b);
    held = { t: setTimeout(function () { if (held) held.i = setInterval(function () { nudge(b); }, 70); }, 380) };
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(function (ev) { document.addEventListener(ev, letGo, true); });
  document.addEventListener('keydown', function (e) {
    var b = e.target.closest && e.target.closest('[data-nudge]');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nudge(b); }
  });
  new MutationObserver(function () { addNudges(); }).observe(document.body || document.documentElement, { childList: true, subtree: true });

  /* the + Signature position, as the pane is drawn */
  function panel(l) {
    saved = l && Number.isFinite(Number(l.x)) ? { x: Number(l.x), y: Number(l.y), s: sizeOf(l.s), updatedAt: l.updatedAt || '', updatedBy: l.updatedBy || '' } : { x: home().x, y: home().y, s: 100 };
    if (latest && String(latest.updatedAt) >= String(saved.updatedAt || '')) saved = latest;
    var c = C();
    if (c && c.setLayout) c.setLayout(saved);
    var r = range();
    return '<details class="fold ct-sig" id="ctSig"><summary>Signature position</summary><div class="ct-sig__body">'
      + row('x', 'Left / right', r.x, saved.x)
      + row('y', 'Up / down', r.y, saved.y)
      + sizeRow('ctSigs', 'data-sig="s"', saved.s)
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
    var n = axis === 's' ? sizeOf(v) : Math.max(-max, Math.min(max, Math.round(Number(v) || 0)));
    ['R', 'N'].forEach(function (k) { var el = document.getElementById('ctSig' + axis + k); if (el && Number(el.value) !== n) el.value = n; });
    return n;
  }
  function apply() {
    var x = show('x', (document.getElementById('ctSigxN') || {}).value);
    var y = show('y', (document.getElementById('ctSigyN') || {}).value);
    var sz = show('s', (document.getElementById('ctSigsN') || {}).value);
    var c = C();
    if (c && c.setLayout) c.setLayout({ x: x, y: y, s: sz });
    redraw();
    var changed = !saved || x !== saved.x || y !== saved.y || sz !== (saved.s || 100);
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
      show('x', home().x); show('y', home().y); show('s', 100);
      apply();
      return;
    }
    if (what === 'save' && !b.disabled) {
      var l = now();
      b.disabled = true;
      A.say(say, 'Saving…', '');
      A.api('/api/admin/certificates', { method: 'POST', body: { action: 'layout', x: l.x, y: l.y, s: l.s || 100 } }).then(function (r) {
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
      if (l.x !== saved.x || l.y !== saved.y || (l.s || 100) !== (saved.s || 100)) c.setLayout(saved);
    }
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-tab], [data-pane-tab], .tab') && !e.target.closest('[data-pane="certificates"]')) forget();
  }, true);

  /* ---- the cards' signature (owner, 15 Nov 2026: "Add Maneka Gandhi's
     signature to caregiver and membership cards using the same logic as the
     internship certificate") ---------------------------------------------
     The same + Signature position, in each card studio: Left / right and Up
     / down in the card's tenths of a millimetre (60 either way across, 30 up
     or down), the faces on screen following as they move, Save for every
     card (POST /api/admin/card-signature, in the audit log) and Reset to the
     card's own place. Leaving without saving puts the saved place back. */
  var CARDS = {
    caregiver: { mod: function () { return window.PFACaregiverCard; }, name: 'colony caregiver card' },
    member: { mod: function () { return window.PFAMemberCard; }, name: 'membership card' }
  };
  var cardSaved = { caregiver: { x: 0, y: 0, s: 100 }, member: { x: 0, y: 0, s: 100 } };
  function cardRange(card) { var m = CARDS[card].mod(); return (m && m.SIG_RANGE) || { x: 860, y: 540 }; }
  function cardRow(card, axis, label, max, value) {
    var id = 'cs' + card + axis;
    return '<div class="ct-sig__row"><label for="' + id + 'R">' + label + '</label>'
      + '<input id="' + id + 'R" type="range" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-csig="' + card + '" data-axis="' + axis + '" aria-label="' + label + '">'
      + '<span class="ct-sig__num"><input id="' + id + 'N" type="number" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-csig="' + card + '" data-axis="' + axis + '" aria-label="' + label + ', in tenths of a millimetre"> tenths of a mm</span></div>';
  }
  function cardFold(card) {
    var r = cardRange(card);
    var l = cardSaved[card];
    return '<details class="fold ct-sig" data-csig-fold="' + card + '"><summary>Signature position</summary><div class="ct-sig__body">'
      + cardRow(card, 'x', 'Left / right', r.x, l.x)
      + cardRow(card, 'y', 'Up / down', r.y, l.y)
      + sizeRow('cs' + card + 's', 'data-csig="' + card + '" data-axis="s"', l.s || 100)
      + '<div class="ct-sig__acts"><button class="press" type="button" data-csig-act="save" data-card="' + card + '" disabled>Save for every card</button>'
      + '<button class="ghost" type="button" data-csig-act="reset" data-card="' + card + '">Reset</button>'
      + '<p class="say" data-csig-say="' + card + '" role="status" aria-live="polite"></p></div>'
      + '<p class="ct-sig__note">Smt. Maneka Sanjay Gandhi\u2019s signature on every ' + esc(CARDS[card].name) + ', drawn above the line. Right and down are more, left and up are less; the card above follows as you move it.</p>'
      + '</div></details>';
  }
  function cardShow(card, axis, v) {
    var max = cardRange(card)[axis];
    var n = axis === 's' ? sizeOf(v) : Math.max(-max, Math.min(max, Math.round(Number(v) || 0)));
    ['R', 'N'].forEach(function (k) { var el = document.getElementById('cs' + card + axis + k); if (el && Number(el.value) !== n) el.value = n; });
    return n;
  }
  function cardApply(card) {
    var x = cardShow(card, 'x', (document.getElementById('cs' + card + 'xN') || {}).value);
    var y = cardShow(card, 'y', (document.getElementById('cs' + card + 'yN') || {}).value);
    var sz = cardShow(card, 's', (document.getElementById('cs' + card + 'sN') || {}).value);
    var m = CARDS[card].mod();
    if (m && m.setSignature) { m.setSignature({ x: x, y: y, s: sz }); if (m.redraw) m.redraw(); }
    var changed = x !== cardSaved[card].x || y !== cardSaved[card].y || sz !== (cardSaved[card].s || 100);
    var b = document.querySelector('[data-csig-act="save"][data-card="' + card + '"]');
    if (b) b.disabled = !changed;
    var say = document.querySelector('[data-csig-say="' + card + '"]');
    if (say) A.say(say, changed ? 'Not saved yet.' : '', '');
  }
  function cardsFill() {
    Object.keys(CARDS).forEach(function (card) {
      var slot = document.querySelector('[data-sig-card="' + card + '"]');
      if (slot) slot.innerHTML = cardFold(card);
    });
  }
  cardsFill();
  fetch('/api/certificate-layout', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
    if (!l || !l.cards) return;
    Object.keys(CARDS).forEach(function (card) {
      if (!l.cards[card]) return;
      cardSaved[card] = { x: Number(l.cards[card].x) || 0, y: Number(l.cards[card].y) || 0, s: sizeOf(l.cards[card].s) };
      cardShow(card, 'x', cardSaved[card].x); cardShow(card, 'y', cardSaved[card].y); cardShow(card, 's', cardSaved[card].s);
    });
  }).catch(function () { /* the cards' own place */ });
  document.addEventListener('input', function (e) {
    var el = e.target;
    var card = el && el.getAttribute && el.getAttribute('data-csig');
    if (!card) return;
    var other = document.getElementById('cs' + card + el.getAttribute('data-axis') + (el.type === 'range' ? 'N' : 'R'));
    if (other) other.value = el.value;
    cardApply(card);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-csig-act]');
    if (!b) return;
    var card = b.getAttribute('data-card');
    var say = document.querySelector('[data-csig-say="' + card + '"]');
    if (b.getAttribute('data-csig-act') === 'reset') { cardShow(card, 'x', 0); cardShow(card, 'y', 0); cardShow(card, 's', 100); cardApply(card); return; }
    if (b.disabled) return;
    var x = Number((document.getElementById('cs' + card + 'xN') || {}).value) || 0;
    var y = Number((document.getElementById('cs' + card + 'yN') || {}).value) || 0;
    var sz = sizeOf((document.getElementById('cs' + card + 'sN') || {}).value);
    b.disabled = true;
    A.say(say, 'Saving\u2026', '');
    A.api('/api/admin/card-signature', { method: 'POST', body: { card: card, x: x, y: y, s: sz } }).then(function (r) {
      cardSaved[card] = { x: r.layout.x, y: r.layout.y, s: sizeOf(r.layout.s) };
      A.say(say, 'Saved. Every ' + CARDS[card].name + ' drawn, printed or saved has the signature here from now on.', 'good');
    }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'That could not be saved.', 'bad'); });
  });
  /* a studio closed without saving: the saved place back */
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#cardViewShut, #memberViewShut')) return;
    Object.keys(CARDS).forEach(function (card) {
      var m = CARDS[card].mod();
      if (!m || !m.signatureAt) return;
      var now = m.signatureAt();
      if (now.x !== cardSaved[card].x || now.y !== cardSaved[card].y || (now.s || 100) !== (cardSaved[card].s || 100)) {
        m.setSignature(cardSaved[card]);
        cardShow(card, 'x', cardSaved[card].x); cardShow(card, 'y', cardSaved[card].y); cardShow(card, 's', cardSaved[card].s);
        var b = document.querySelector('[data-csig-act="save"][data-card="' + card + '"]'); if (b) b.disabled = true;
        var say = document.querySelector('[data-csig-say="' + card + '"]'); if (say) A.say(say, '', '');
        if (m.redraw) m.redraw();
      }
    });
  }, true);

  window.PFACertLayout = { panel: panel, forget: forget, cardFold: cardFold, sizeRow: sizeRow };
}());
