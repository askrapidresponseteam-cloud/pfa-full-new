/* People for Animals - a card issued online, from its card studio.
   ------------------------------------------------------------------------
   Owner, 15 Nov 2026: "Add an option to issue digital caregiver and
   membership cards with front and back views and a flip feature premium
   style ... Each should have a unique peopleforanimals.org URL, like the
   internship certificate".

   In each card studio (the colony caregiver card's and the membership
   card's), under the faces, one row: whether the card is online, and Issue
   online (or Update online), which gives the card its own address
   (card?id=...), keeps the photograph as the studio drew it, and emails
   the holder the link; then Open, Copy link and Withdraw. Only a card on
   the register is issued online, never an application. The server is
   lib/routes/admin/digital-cards.js; the page is card.html. Kept out of
   admin.html so that page stays under its page-weight ceiling.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFADigitalCards) return;
  var esc = A.esc;

  var style = document.createElement('style');
  style.textContent = [
    '.dg{margin:16px 0 0;padding:14px 16px;border:1px solid var(--line);display:grid;gap:10px}',
    '.dg[hidden]{display:none}',
    '.dg__h{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px}',
    '.dg__h b{font-size:12px;letter-spacing:.14em;text-transform:uppercase}',
    '.dg__now{margin:0;font-size:13px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}',
    '.dg__now a{color:var(--ink);text-decoration:underline;text-underline-offset:3px}',
    '.dg__acts{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.dg__acts .press{display:inline-flex;width:auto;align-items:center;min-height:40px;padding:0 18px}',
    '.dg__acts .ghost{min-height:40px}',
    '.dg__acts .say{margin:0;font-size:12px;overflow-wrap:anywhere}',
    '.dg__peek{max-width:520px}',
    '.dc.dg__peek{margin:0}',
    '.dg .ct-sig__row{grid-template-columns:110px minmax(0,1fr) auto}',
    '.dg .ct-sig__num{white-space:nowrap}',
    '@media (max-width:560px){.dg .ct-sig__row{grid-template-columns:minmax(0,1fr) auto}.dg .ct-sig__row label{grid-column:1 / -1}}'
  ].join('');
  document.head.appendChild(style);

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }

  var STUDIO = {
    caregiver: { box: 'cardView', canvas: 'canvas[data-view="front"]' },
    member: { box: 'memberView', canvas: 'canvas[data-face="front"]' }
  };
  var now = { caregiver: null, member: null };

  /* the card on screen: its reference, and the photograph as drawn on it */
  function current(kind) {
    var box = document.getElementById(STUDIO[kind].box);
    if (!box || box.hidden) return null;
    var canvas = box.querySelector(STUDIO[kind].canvas);
    if (kind === 'caregiver') {
      if (box.getAttribute('data-mode') !== 'issued') return null;
      var cg = canvas && canvas._pfaCard ? canvas._pfaCard[1] : null;
      return cg && cg.cardId ? { ref: String(cg.cardId), photo: cg.photoImage || null } : null;
    }
    var ref = box.getAttribute('data-ref');
    var m = canvas && canvas._pfaMember ? canvas._pfaMember : null;
    var printable = box.querySelector('[data-mv="print"]');
    if (!ref || !printable || printable.hidden) return null;
    return { ref: ref, photo: m && m[2] ? m[2].photo || null : null };
  }

  /* the photograph, at most 600 by 800, as a JPEG */
  function jpeg(image) {
    if (!image || !image.width) return '';
    var k = Math.min(1, 600 / image.width, 800 / image.height);
    var c = document.createElement('canvas');
    c.width = Math.round(image.width * k);
    c.height = Math.round(image.height * k);
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(image, 0, 0, c.width, c.height);
    try { return c.toDataURL('image/jpeg', 0.9); } catch (e) { return ''; }
  }

  function paint(kind, said) {
    var slot = document.querySelector('[data-digital="' + kind + '"]');
    if (!slot) return;
    var card = current(kind);
    if (!card) { slot.innerHTML = ''; return; }
    var d = now[kind];
    var line = !d ? 'Not online yet. Issue it online to give it its own address and email the holder the link.'
      : d.standing === 'withdrawn' ? 'Withdrawn online' + (d.withdrawnOn ? ' on ' + esc(day(d.withdrawnOn)) : '') + '. Issue it online again to bring it back.'
      : 'Online at <a href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">' + esc(String(d.url).replace(/^https?:\/\//, '')) + '</a>' + (d.standing === 'expired' ? ' (expired)' : '') + '.';
    var live = d && d.standing !== 'withdrawn';
    var was = slot.querySelector('[data-dgsig-fold]');
    var wasOpen = Boolean(was && was.open);
    slot.innerHTML = '<div class="dg"><div class="dg__h"><b>Card online</b></div>'
      + '<p class="dg__now">' + line + '</p>'
      + '<div class="dg__acts"><button class="press" type="button" data-dg="issue" data-kind="' + kind + '">' + (live ? 'Update online and email' : 'Issue online and email') + '</button>'
      + (live ? '<a class="ghost" href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">Open</a><button class="ghost" type="button" data-dg="copy" data-kind="' + kind + '">Copy link</button><button class="ghost" type="button" data-dg="withdraw" data-kind="' + kind + '">Withdraw</button>' : '')
      + '<p class="say" data-dg-say="' + kind + '" role="status" aria-live="polite"></p></div>'
      + sigFold(kind) + '</div>';
    if (said) A.say(slot.querySelector('[data-dg-say]'), said.text, said.tone);
    var fold = slot.querySelector('[data-dgsig-fold]');
    if (fold && wasOpen) fold.open = true;
  }

  /* ---- the signature on the card online (owner, 15 Nov 2026: "give
     option to adjust the sign position") ---------------------------------
     + Signature position under Card online: Left / right and Up / down in
     tenths of a millimetre of a bank card's width, the card online drawn
     above them and following as they move, Save for every card online
     (POST /api/admin/card-signature, in the audit log, read by card.html
     through /api/digital-card) and Reset. Kept apart from the printed
     card's, whose layout is not the same. */
  var SIG = { caregiver: 'caregiverOnline', member: 'memberOnline' };
  var RANGE = { x: 60, y: 30 };
  var sigSaved = { caregiver: { x: 0, y: 0 }, member: { x: 0, y: 0 } };
  var sigNow = { caregiver: null, member: null };
  fetch('/api/certificate-layout', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
    if (!l || !l.cards) return;
    Object.keys(SIG).forEach(function (kind) {
      var c = l.cards[SIG[kind]];
      if (c) sigSaved[kind] = { x: Number(c.x) || 0, y: Number(c.y) || 0 };
    });
  }).catch(function () { /* the card's own place */ });
  function at(kind) { return sigNow[kind] || sigSaved[kind]; }
  function sigRow(kind, axis, label, max, value) {
    var id = 'dgs' + kind + axis;
    return '<div class="ct-sig__row"><label for="' + id + 'R">' + label + '</label>'
      + '<input id="' + id + 'R" type="range" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-dgsig="' + kind + '" data-axis="' + axis + '" aria-label="' + label + '">'
      + '<span class="ct-sig__num"><input id="' + id + 'N" type="number" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-dgsig="' + kind + '" data-axis="' + axis + '" aria-label="' + label + ', in tenths of a millimetre"> tenths of a mm</span></div>';
  }
  function sigFold(kind) {
    var l = at(kind);
    var changed = l.x !== sigSaved[kind].x || l.y !== sigSaved[kind].y;
    return '<details class="fold ct-sig" data-dgsig-fold="' + kind + '"><summary>Signature position online</summary><div class="ct-sig__body">'
      + '<div class="dg__peek" data-dg-peek="' + kind + '"></div>'
      + sigRow(kind, 'x', 'Left / right', RANGE.x, l.x)
      + sigRow(kind, 'y', 'Up / down', RANGE.y, l.y)
      + '<div class="ct-sig__acts"><button class="press" type="button" data-dgsig-act="save" data-kind="' + kind + '"' + (changed ? '' : ' disabled') + '>Save for every card online</button>'
      + '<button class="ghost" type="button" data-dgsig-act="reset" data-kind="' + kind + '">Reset</button>'
      + '<p class="say" data-dgsig-say="' + kind + '" role="status" aria-live="polite"></p></div>'
      + '<p class="ct-sig__note">Smt. Maneka Sanjay Gandhi\u2019s signature on every ' + (kind === 'member' ? 'membership card' : 'colony caregiver card') + ' online, the card above following as you move it. Right and down are more, left and up are less. The printed card keeps its own.</p>'
      + '</div></details>';
  }

  /* the card online, drawn here with this card's own details */
  var loading = null;
  function needCard() {
    if (window.PFADigitalCard) return Promise.resolve(window.PFADigitalCard);
    if (loading) return loading;
    loading = new Promise(function (ok, no) {
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'assets/digital-card.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = 'assets/digital-card.js';
      js.onload = function () { if (window.PFADigitalCard) ok(window.PFADigitalCard); else no(new Error('card')); };
      js.onerror = function () { loading = null; no(new Error('card')); };
      document.head.appendChild(js);
    });
    return loading;
  }
  function peek(kind) {
    var box = document.querySelector('[data-dg-peek="' + kind + '"]');
    var card = current(kind);
    if (!box || !card) return;
    needCard().then(function (D) {
      var d = now[kind];
      var data = d ? Object.assign({}, d) : { kind: kind, standing: 'valid', valid: true, name: 'Name of the holder', number: card.ref, district: 'District', state: 'State', tier: kind === 'member' ? 'Membership' : '', validUntil: '' };
      data.standing = 'valid';
      data.valid = true;
      data.url = data.url || 'https://peopleforanimalsindia.org/card';
      data.sig = at(kind);
      if (!box._photo) box._photo = jpeg(card.photo);
      D.render(box, data, { root: '', photo: box._photo, controls: false });
      box.classList.add('dg__peek');
    }).catch(function () { box.textContent = 'The card could not be drawn here just now.'; });
  }
  function sigShow(kind, axis, v) {
    var max = RANGE[axis];
    var n = Math.max(-max, Math.min(max, Math.round(Number(v) || 0)));
    ['R', 'N'].forEach(function (k) { var el = document.getElementById('dgs' + kind + axis + k); if (el && Number(el.value) !== n) el.value = n; });
    return n;
  }
  function sigApply(kind) {
    var x = sigShow(kind, 'x', (document.getElementById('dgs' + kind + 'xN') || {}).value);
    var y = sigShow(kind, 'y', (document.getElementById('dgs' + kind + 'yN') || {}).value);
    sigNow[kind] = { x: x, y: y };
    var box = document.querySelector('[data-dg-peek="' + kind + '"]');
    if (box) { box.style.setProperty('--sx', String(x)); box.style.setProperty('--sy', String(y)); }
    var changed = x !== sigSaved[kind].x || y !== sigSaved[kind].y;
    var b = document.querySelector('[data-dgsig-act="save"][data-kind="' + kind + '"]');
    if (b) b.disabled = !changed;
    var say = document.querySelector('[data-dgsig-say="' + kind + '"]');
    if (say) A.say(say, changed ? 'Not saved yet.' : '', '');
  }
  document.addEventListener('toggle', function (e) {
    var f = e.target;
    if (f && f.getAttribute && f.getAttribute('data-dgsig-fold') && f.open) peek(f.getAttribute('data-dgsig-fold'));
  }, true);
  document.addEventListener('input', function (e) {
    var el = e.target;
    var kind = el && el.getAttribute && el.getAttribute('data-dgsig');
    if (!kind) return;
    var other = document.getElementById('dgs' + kind + el.getAttribute('data-axis') + (el.type === 'range' ? 'N' : 'R'));
    if (other) other.value = el.value;
    sigApply(kind);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dgsig-act]');
    if (!b) return;
    var kind = b.getAttribute('data-kind');
    var say = document.querySelector('[data-dgsig-say="' + kind + '"]');
    if (b.getAttribute('data-dgsig-act') === 'reset') { sigShow(kind, 'x', 0); sigShow(kind, 'y', 0); sigApply(kind); return; }
    if (b.disabled) return;
    var l = at(kind);
    b.disabled = true;
    A.say(say, 'Saving\u2026', '');
    A.api('/api/admin/card-signature', { method: 'POST', body: { card: SIG[kind], x: l.x, y: l.y } }).then(function (r) {
      sigSaved[kind] = { x: r.layout.x, y: r.layout.y };
      sigNow[kind] = null;
      A.say(say, 'Saved. Every ' + (kind === 'member' ? 'membership card' : 'colony caregiver card') + ' online shows the signature here from now on.', 'good');
    }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'That could not be saved.', 'bad'); });
  });
  /* a studio closed without saving: the saved place back */
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('#cardViewShut, #memberViewShut')) return;
    sigNow.caregiver = null;
    sigNow.member = null;
  }, true);

  function look(kind) {
    var card = current(kind);
    now[kind] = null;
    paint(kind);
    if (!card) return;
    A.api('/api/admin/digital-cards?kind=' + kind + '&ref=' + encodeURIComponent(card.ref)).then(function (r) {
      var still = current(kind);
      if (!still || still.ref !== card.ref) return;
      now[kind] = r.digital || null;
      paint(kind);
    }).catch(function () { /* the studio stands without it */ });
  }

  /* a studio opened, or drawn again with its photograph: look again */
  Object.keys(STUDIO).forEach(function (kind) {
    var box = document.getElementById(STUDIO[kind].box);
    if (!box || !window.MutationObserver) return;
    var timer = null;
    var again = function () { clearTimeout(timer); timer = setTimeout(function () { look(kind); }, 250); };
    new MutationObserver(again).observe(box, { attributes: true, attributeFilter: ['hidden', 'data-mode', 'data-ref'] });
    var issuedFlags = box.querySelectorAll('[data-issued], [data-mv]');
    Array.prototype.forEach.call(issuedFlags, function (el) { new MutationObserver(again).observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dg]');
    if (!b) return;
    var kind = b.getAttribute('data-kind');
    var what = b.getAttribute('data-dg');
    var card = current(kind);
    var say = document.querySelector('[data-dg-say="' + kind + '"]');
    if (!card) return;
    if (what === 'copy' && now[kind]) {
      var url = now[kind].url;
      var done = function () { A.say(say, 'Link copied.', 'good'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link', url); });
      else window.prompt('Copy this link', url);
      return;
    }
    if (what === 'issue') {
      var photo = jpeg(card.photo);
      if (!photo) { A.say(say, 'The card has no photograph on screen, so it is not issued online. Add the photograph first.', 'bad'); return; }
      b.disabled = true;
      A.say(say, 'Issuing…', '');
      A.api('/api/admin/digital-cards', { method: 'POST', body: { action: 'issue', kind: kind, ref: card.ref, photo: photo, email: true } }).then(function (r) {
        now[kind] = r.digital;
        paint(kind, { text: r.emailed ? 'Online, and the link was emailed to ' + r.to + '.' : 'Online. ' + (r.mailNote || 'The link was not emailed.'), tone: 'good' });
      }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'That could not be issued.', 'bad'); });
      return;
    }
    if (what === 'withdraw' && now[kind]) {
      if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Withdraw it: press again'; return; }
      b.disabled = true;
      A.api('/api/admin/digital-cards', { method: 'POST', body: { action: 'withdraw', kind: kind, id: now[kind].id } }).then(function (r) {
        now[kind] = r.digital;
        paint(kind, { text: 'Withdrawn. The address now says the card is no longer valid.', tone: 'good' });
      }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'That could not be withdrawn.', 'bad'); });
    }
  });

  window.PFADigitalCards = { look: look };
}());
