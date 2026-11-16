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
    '.dg .ct-sig__row{grid-template-columns:110px minmax(0,1fr) 170px}',
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
  var sigSaved = { caregiver: { x: 0, y: 0, s: 100 }, member: { x: 0, y: 0, s: 100 } };
  var SIZE = { min: 60, max: 160 };
  function sizeOf(v) { var n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(SIZE.min, Math.min(SIZE.max, n)) : 100; }
  var sigNow = { caregiver: null, member: null };
  fetch('/api/certificate-layout', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (l) {
    if (!l || !l.cards) return;
    Object.keys(SIG).forEach(function (kind) {
      var c = l.cards[SIG[kind]];
      if (c) sigSaved[kind] = { x: Number(c.x) || 0, y: Number(c.y) || 0, s: sizeOf(c.s) };
    });
  }).catch(function () { /* the card's own place */ });
  function at(kind) { return sigNow[kind] || sigSaved[kind]; }
  function sigRow(kind, axis, label, max, value, pre) {
    var id = (pre || 'dgs') + kind + axis;
    return '<div class="ct-sig__row"><label for="' + id + 'R">' + label + '</label>'
      + '<input id="' + id + 'R" type="range" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-dgsig="' + kind + '" data-axis="' + axis + '" aria-label="' + label + '">'
      + '<span class="ct-sig__num"><input id="' + id + 'N" type="number" min="' + (-max) + '" max="' + max + '" step="1" value="' + value + '" data-dgsig="' + kind + '" data-axis="' + axis + '" aria-label="' + label + ', in tenths of a millimetre"> tenths of a mm</span></div>';
  }
  /* pre 'dgs' in a card studio, with the card drawn inside; 'dgr' under a
     register's Preview card, which is the card it moves */
  function sigFold(kind, pre) {
    pre = pre || 'dgs';
    var l = at(kind);
    var changed = l.x !== sigSaved[kind].x || l.y !== sigSaved[kind].y || (l.s || 100) !== sigSaved[kind].s;
    return '<details class="fold ct-sig" data-dgsig-fold="' + kind + '"' + (pre === 'dgs' ? '' : ' data-dgsig-here') + '><summary>' + (pre === 'dgs' ? 'Signature position online' : 'Signature size and position') + '</summary><div class="ct-sig__body">'
      + (pre === 'dgs' ? '<div class="dg__peek" data-dg-peek="' + kind + '"></div>' : '')
      + sigRow(kind, 'x', 'Left / right', RANGE.x, l.x, pre)
      + sigRow(kind, 'y', 'Up / down', RANGE.y, l.y, pre)
      + '<div class="ct-sig__row"><label for="' + pre + kind + 'sR">Size</label>'
      + '<input id="' + pre + kind + 'sR" type="range" min="' + SIZE.min + '" max="' + SIZE.max + '" step="1" value="' + (l.s || 100) + '" data-dgsig="' + kind + '" data-axis="s" aria-label="Size">'
      + '<span class="ct-sig__num"><input id="' + pre + kind + 'sN" type="number" min="' + SIZE.min + '" max="' + SIZE.max + '" step="1" value="' + (l.s || 100) + '" data-dgsig="' + kind + '" data-axis="s" aria-label="Size, in per cent"> %</span></div>'
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
    var n = axis === 's' ? sizeOf(v) : Math.max(-max, Math.min(max, Math.round(Number(v) || 0)));
    Array.prototype.forEach.call(document.querySelectorAll('[data-dgsig="' + kind + '"][data-axis="' + axis + '"]'), function (el) { if (Number(el.value) !== n) el.value = n; });
    return n;
  }
  /* the card drawn with the signature where it is now: in the studio, and
     under a register's Preview card */
  function sigPaint(kind) {
    var l = at(kind);
    Array.prototype.forEach.call(document.querySelectorAll('[data-dg-peek="' + kind + '"], .rg-dc[data-dgr-kind="' + kind + '"] .rg-dc__card > .dc'), function (box) {
      box.style.setProperty('--sx', String(l.x)); box.style.setProperty('--sy', String(l.y)); box.style.setProperty('--ss', String((l.s || 100) / 100));
      if (typeof box._pfaFit === 'function') box._pfaFit();
    });
  }
  function sigApply(kind, axis, v) {
    var l = Object.assign({}, at(kind));
    if (axis) l[axis] = sigShow(kind, axis, v);
    sigNow[kind] = { x: l.x, y: l.y, s: l.s || 100 };
    sigPaint(kind);
    var changed = l.x !== sigSaved[kind].x || l.y !== sigSaved[kind].y || (l.s || 100) !== sigSaved[kind].s;
    Array.prototype.forEach.call(document.querySelectorAll('[data-dgsig-act="save"][data-kind="' + kind + '"]'), function (b) { b.disabled = !changed; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-dgsig-say="' + kind + '"]'), function (say) { A.say(say, changed ? 'Not saved yet.' : '', ''); });
  }
  document.addEventListener('toggle', function (e) {
    var f = e.target;
    if (f && f.getAttribute && f.getAttribute('data-dgsig-fold') && f.open && !f.hasAttribute('data-dgsig-here')) peek(f.getAttribute('data-dgsig-fold'));
  }, true);
  document.addEventListener('input', function (e) {
    var el = e.target;
    var kind = el && el.getAttribute && el.getAttribute('data-dgsig');
    if (!kind) return;
    sigApply(kind, el.getAttribute('data-axis'), el.value);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dgsig-act]');
    if (!b) return;
    var kind = b.getAttribute('data-kind');
    var say = b.parentNode.querySelector('[data-dgsig-say]');
    if (b.getAttribute('data-dgsig-act') === 'reset') { sigNow[kind] = { x: 0, y: 0, s: 100 }; ['x', 'y', 's'].forEach(function (k) { sigShow(kind, k, sigNow[kind][k]); }); sigApply(kind); return; }
    if (b.disabled) return;
    var l = at(kind);
    b.disabled = true;
    A.say(say, 'Saving\u2026', '');
    A.api('/api/admin/card-signature', { method: 'POST', body: { card: SIG[kind], x: l.x, y: l.y, s: l.s || 100 } }).then(function (r) {
      sigSaved[kind] = { x: r.layout.x, y: r.layout.y, s: sizeOf(r.layout.s) };
      sigNow[kind] = null;
      sigApply(kind);
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
      /* the member's approved photograph when there is one (16 Nov 2026);
         a caregiver card always has one */
      var photo = jpeg(card.photo);
      if (!photo && kind !== 'member') { A.say(say, 'The card has no photograph on screen, so it is not issued online. Add the photograph first.', 'bad'); return; }
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

  /* ---- from the registers (owner, 16 Nov 2026: "why no option preview
     and issue digital card?") ----------------------------------------------
     Under Open on a line of the Members or Caregivers register, Digital
     card: whether the card is online, Preview card (front and back, with
     the photograph kept on the server, nothing saved), and Issue digital
     card, which gives it its address and emails the holder the link; once
     online, Open and Copy link. Withdrawing stays in the card studio. */
  var regNow = {};
  var regLook = {};
  function regKey(kind, ref) { return kind + ':' + ref; }
  function regLine(kind, ref) {
    var d = regNow[regKey(kind, ref)];
    if (d === undefined) return 'Checking whether it is online…';
    if (!d) return 'Not online yet. Issuing gives the card its own address and emails the holder the link.';
    if (d.standing === 'withdrawn') return 'Withdrawn online' + (d.withdrawnOn ? ' on ' + esc(day(d.withdrawnOn)) : '') + '. Issue it again to bring it back.';
    return 'Online at <a href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">' + esc(String(d.url).replace(/^https?:\/\//, '')) + '</a>' + (d.standing === 'expired' ? ' (expired)' : '') + '.';
  }
  function regActs(kind, ref) {
    var d = regNow[regKey(kind, ref)];
    var live = d && d.standing !== 'withdrawn';
    return '<button class="ghost" type="button" data-dgr="preview">Preview card</button>'
      + '<button class="press" type="button" data-dgr="issue"' + (d === undefined ? ' disabled' : '') + '>' + (live ? 'Update and email again' : 'Issue digital card') + '</button>'
      + (live ? '<a class="ghost" href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">Open</a><button class="ghost" type="button" data-dgr="copy">Copy link</button>' : '');
  }
  /* what a register line carries: kind is 'membership' or 'caregiver', the
     card's reference the membership's or the colony caregiver card's number */
  function regSlot(regKind, r) {
    var kind = regKind === 'membership' ? 'member' : 'caregiver';
    var ref = kind === 'member' ? r.id : r.cardId;
    var head = '<h4>Digital card</h4>';
    if (!r.cardId) {
      return '<div class="rg-dc">' + head + '<p class="dg__now">' + (kind === 'member'
        ? 'No card on the register yet. Approve the photograph in Photos and cards first; the card is then online and its link emailed.'
        : 'No card yet. Approve the application in To decide first; the card is then online and its link emailed.') + '</p></div>';
    }
    return '<div class="rg-dc" data-dgr-kind="' + kind + '" data-dgr-ref="' + esc(ref) + '">' + head
      + '<p class="dg__now" data-dgr-line>' + regLine(kind, ref) + '</p>'
      + '<div class="dg__acts" data-dgr-acts>' + regActs(kind, ref) + '</div>'
      + '<p class="say" data-dgr-say role="status" aria-live="polite"></p>'
      + '<div class="rg-dc__peek" data-dgr-peek hidden></div></div>';
  }
  function regPaint(kind, ref) {
    Array.prototype.forEach.call(document.querySelectorAll('.rg-dc[data-dgr-kind="' + kind + '"]'), function (box) {
      if (box.getAttribute('data-dgr-ref') !== ref) return;
      box.querySelector('[data-dgr-line]').innerHTML = regLine(kind, ref);
      box.querySelector('[data-dgr-acts]').innerHTML = regActs(kind, ref);
    });
  }
  function regStatus(kind, ref, again) {
    var key = regKey(kind, ref);
    if (regLook[key] && !again) return regLook[key];
    regLook[key] = A.api('/api/admin/digital-cards?kind=' + kind + '&ref=' + encodeURIComponent(ref)).then(function (r) {
      regNow[key] = r.digital || null;
      regPaint(kind, ref);
    }).catch(function () { regLook[key] = null; regNow[key] = null; regPaint(kind, ref); });
    return regLook[key];
  }
  /* each Digital card in sight asks once whether its card is online */
  function regFill(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.rg-dc[data-dgr-kind]'), function (box) {
      var tr = box.closest('tr');
      if (tr && tr.hidden) return;
      regStatus(box.getAttribute('data-dgr-kind'), box.getAttribute('data-dgr-ref'));
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest && t.closest('[data-rg="open"]')) { setTimeout(function () { regFill(); }, 0); return; }
    var b = t.closest && t.closest('[data-dgr]');
    if (!b) return;
    var box = b.closest('.rg-dc');
    var kind = box.getAttribute('data-dgr-kind');
    var ref = box.getAttribute('data-dgr-ref');
    var say = box.querySelector('[data-dgr-say]');
    var peekBox = box.querySelector('[data-dgr-peek]');
    var what = b.getAttribute('data-dgr');
    if (what === 'copy') {
      var d = regNow[regKey(kind, ref)];
      if (!d) return;
      var ok = function () { A.say(say, 'Link copied.', 'good'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(d.url).then(ok, function () { window.prompt('Copy this link', d.url); });
      else window.prompt('Copy this link', d.url);
      return;
    }
    if (what === 'hide') { peekBox.hidden = true; peekBox.innerHTML = ''; return; }
    if (what === 'flip') {
      var cardBox = peekBox.querySelector('.rg-dc__card');
      var stage = cardBox && cardBox.querySelector('.dc__stage');
      if (stage) stage.click();
      return;
    }
    if (what === 'preview') {
      b.disabled = true;
      A.say(say, 'Drawing the card…', '');
      Promise.all([needCard(), A.api('/api/admin/digital-cards?kind=' + kind + '&ref=' + encodeURIComponent(ref) + '&preview=1')]).then(function (both) {
        var D = both[0];
        var p = both[1];
        b.disabled = false;
        regNow[regKey(kind, ref)] = p.online || null;
        regPaint(kind, ref);
        peekBox.hidden = false;
        var note = (p.online ? 'As it is online now.' : 'Preview only, not online yet. Once issued, the QR code on the back opens this card\u2019s own address.')
          + (p.photo ? '' : kind === 'member' ? ' No approved photograph, so it is shown without one.' : ' No photograph was found with the application.');
        peekBox.innerHTML = '<p class="rg-dc__note">' + note + '</p><div class="rg-dc__card"><div class="dc" data-kind="' + kind + '"></div></div>'
          + '<div class="rg-dc__bar"><button class="ghost" type="button" data-dgr="flip">See the back</button><button class="ghost" type="button" data-dgr="hide">Hide preview</button></div>'
          + sigFold(kind, 'dgr' + ref.replace(/[^A-Za-z0-9]/g, ''));
        var data = Object.assign({}, p.card, p.online ? { url: p.online.url, id: p.online.id } : { url: p.card.url || 'https://peopleforanimalsindia.org/card' }, { sig: at(kind) });
        D.render(peekBox.querySelector('.rg-dc__card > div'), data, { root: '', photo: p.photo || '', controls: false });
        sigPaint(kind);
        A.say(say, '', '');
      }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'The card could not be drawn just now.', 'bad'); });
      return;
    }
    if (what === 'issue') {
      b.disabled = true;
      A.say(say, 'Issuing…', '');
      A.api('/api/admin/digital-cards', { method: 'POST', body: { action: 'issue', kind: kind, ref: ref, email: true } }).then(function (r) {
        regNow[regKey(kind, ref)] = r.digital;
        regPaint(kind, ref);
        A.say(say, r.emailed ? 'Online, and the link was emailed to ' + r.to + '.' : 'Online. ' + (r.mailNote || 'The link was not emailed.'), 'good');
        if (!peekBox.hidden) peekBox.hidden = true;
      }).catch(function (err) { b.disabled = false; A.say(say, (err && err.message) || 'That could not be issued.', 'bad'); });
    }
  });
  if (window.MutationObserver) new MutationObserver(function (list) {
    list.forEach(function (m) {
      var box = m.target;
      var peek = box.parentNode && box.parentNode.classList && box.parentNode.classList.contains('rg-dc__card') ? box.closest('.rg-dc__peek') : null;
      var flip = peek && peek.querySelector('[data-dgr="flip"]');
      if (flip) flip.textContent = box.getAttribute('data-side') === 'back' ? 'See the front' : 'See the back';
    });
  }).observe(document.body, { attributes: true, attributeFilter: ['data-side'], subtree: true });
  var regStyle = document.createElement('style');
  regStyle.textContent = '.rg-dc{grid-column:1 / -1;display:grid;gap:8px;padding:12px 0 0;border-top:1px solid var(--line);margin-top:4px}'
    + '.rg-dc h4{margin:0}'
    + '.rg-dc .dg__acts .ghost,.rg-dc .dg__acts .press{min-height:40px}'
    + '.rg-dc .say:empty{display:none}'
    + '.rg-dc .dg__acts a.ghost{text-decoration:none;display:inline-flex;align-items:center}'
    + '.rg-dc__peek{display:grid;gap:12px;max-width:576px;margin-top:6px;padding:16px;border:1px solid var(--line);background:#fff}'
    + '.rg-dc__peek[hidden]{display:none}'
    + '.rg-dc__card{width:100%;margin-bottom:6px}'
    + '.rg-dc__card .dc{margin:0;max-width:none}'
    + '.rg-dc__card .dc__noprint{display:none}'
    + '.rg-dc__bar{display:flex;flex-wrap:wrap;gap:8px}'
    + '.rg-dc__bar .ghost{min-height:40px}'
    + '.rg-dc__peek .ct-sig{margin:0}'
    + '.rg-dc .ct-sig__row{grid-template-columns:96px minmax(0,1fr) 150px}'
    + '.rg-dc .ct-sig__num{white-space:nowrap}'
    + '@media (max-width:560px){.rg-dc .ct-sig__row{grid-template-columns:minmax(0,1fr) auto}.rg-dc .ct-sig__row label{grid-column:1 / -1}}'
    + '.rg-dc__note{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}'
    + '@media (max-width:560px){.rg-dc__peek{padding:12px}}';
  document.head.appendChild(regStyle);

  window.PFADigitalCards = { look: look, regSlot: regSlot, regFill: regFill };
}());
