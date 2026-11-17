/* People for Animals - Check the cards.
   ------------------------------------------------------------------------
   Owner, 17 Nov 2026: "there should be an easy way to preview and correct
   both caregiver and membership cards. easy way to do it in 1 go and also
   to do 1 by 1.. work on the UX. keep it super simple. people of age 70
   should be able to do it easily", and of the colony caregiver card, "where
   is the new style colony caregiver card. still see the old style!".

   One screen over the register, for either kind of card, drawn in the new
   style: the card exactly as its holder sees it online.

     One by one   the card large, and under it three boxes in large type:
                  Name on the card, District, State. The card changes as
                  you type. Save and go to the next card, or Next card when
                  nothing changed; Previous to go back. A membership with no
                  card yet has Issue this card instead, with the name typed.
     All at once  every card at once, each with its name and a Change
                  button that opens it one by one; for memberships, Issue
                  every card not yet issued.

   Corrections go to lib/routes/admin/digital-cards.js (action correct): the
   card the register keeps, so the printed card and the card online read
   the same, and a card already online is brought up to date at once.

   PFACardCheck.open({ kind: 'member' | 'caregiver', items, start, changed })
   items: [{ ref, issued, online, name, number, district, state, tier }]
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFACardCheck) return;
  var esc = A.esc;

  var style = document.createElement('style');
  style.textContent = [
    '.ccx{position:fixed;inset:0;z-index:90;background:var(--paper,#fff);display:flex;flex-direction:column;overflow:hidden}',
    '.ccx[hidden]{display:none}',
    '.ccx__bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px 20px;padding:16px clamp(16px,3vw,40px);border-bottom:1px solid var(--line)}',
    '.ccx__bar h2{margin:0;font-family:var(--display,Marcellus,serif);font-weight:400;font-size:26px;flex:1 1 auto}',
    '.ccx__views{display:flex;gap:0;border:1px solid var(--ink)}',
    '.ccx__views button{min-height:52px;padding:0 22px;border:0;background:transparent;font:inherit;font-size:16px;font-weight:600;cursor:pointer;color:var(--ink)}',
    '.ccx__views button[aria-pressed="true"]{background:var(--ink);color:#fff}',
    '.ccx__shut{min-height:52px;padding:0 24px;font-size:16px}',
    '.ccx__body{flex:1 1 auto;overflow:auto;padding:clamp(16px,3vw,40px)}',
    '.ccx__count{margin:0 0 16px;font-size:18px;color:var(--muted)}.ccx__count b{color:var(--ink)}',
    '.ccx__one{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:28px 44px;align-items:start;max-width:1200px}',
    '.ccx__card .dc{max-width:560px}',
    '.ccx__tip{margin:10px 0 0;font-size:15px;color:var(--muted)}',
    '.ccx__fix{display:grid;gap:18px}',
    '.ccx__now{margin:0;padding:12px 16px;border:1px solid var(--line);font-size:17px;line-height:1.5}',
    '.ccx__fix label{display:grid;gap:8px;font-size:17px;font-weight:600;color:var(--ink)}',
    '.ccx__fix input{height:56px;padding:0 16px;border:1px solid var(--ink);border-radius:0;font:inherit;font-size:20px;font-weight:400;color:var(--ink);background:#fff;min-width:0}',
    '.ccx__fix input:focus-visible{outline:3px solid var(--ink);outline-offset:2px}',
    '.ccx__fix input[readonly]{border-color:var(--line);background:var(--paper,#fafafa);color:var(--muted)}',
    '.ccx__say{margin:0;min-height:24px;font-size:17px;line-height:1.5;overflow-wrap:anywhere}.ccx__say[data-tone="bad"]{color:#b42318}.ccx__say[data-tone="good"]{color:#1f6b3a}',
    '.ccx__go{display:flex;flex-wrap:wrap;gap:12px}',
    '.ccx__go button{min-height:60px;padding:0 26px;font-size:17px;width:auto;margin:0}',
    '.ccx__go .press{flex:1 1 260px}',
    '.ccx__all-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 20px;margin:0 0 20px}',
    '.ccx__all-head p{margin:0;font-size:17px;line-height:1.5;max-width:60ch}',
    '.ccx__all-head button{min-height:56px;padding:0 24px;font-size:16px;width:auto;margin:0}',
    '.ccx__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:28px 24px;margin:0;padding:0;list-style:none}',
    '.ccx__grid li{display:grid;gap:10px;align-content:start}',
    '.ccx__grid .dc{max-width:none}',
    '.ccx__grid .dc__noprint{display:none}',
    '.ccx__who{display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '.ccx__who b{font-size:17px;overflow-wrap:anywhere}.ccx__who small{display:block;font-size:14px;color:var(--muted);font-weight:400}',
    '.ccx__who button{min-height:48px;padding:0 20px;font-size:16px;width:auto;margin:0;flex:none}',
    '.ccx__wait{display:grid;place-items:center;aspect-ratio:85.6/54;border:1px dashed var(--line);color:var(--muted);font-size:15px}',
    '@media (max-width:860px){.ccx__one{grid-template-columns:minmax(0,1fr)}.ccx__bar h2{font-size:21px;flex:1 1 0;min-width:0}.ccx__shut{order:2}.ccx__views{order:3;flex:1 1 100%}.ccx__views button{flex:1 1 50%}}'
  ].join('');
  document.head.appendChild(style);

  /* the new-style card's own files, loaded once */
  var loading = null;
  function needCard() {
    if (window.PFADigitalCard) return Promise.resolve(window.PFADigitalCard);
    if (loading) return loading;
    loading = new Promise(function (ok, no) {
      if (!document.querySelector('link[href^="assets/digital-card.css"]')) {
        var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/digital-card.css'; document.head.appendChild(css);
      }
      var js = document.createElement('script');
      js.src = 'assets/digital-card.js';
      js.onload = function () { if (window.PFADigitalCard) ok(window.PFADigitalCard); else no(new Error('card')); };
      js.onerror = function () { loading = null; no(new Error('card')); };
      document.head.appendChild(js);
    });
    return loading;
  }

  var K = { member: { title: 'Membership cards', api: 'member' }, caregiver: { title: 'Colony caregiver cards', api: 'caregiver' } };
  var S = { kind: 'member', items: [], at: 0, view: 'one', changed: null, cache: {}, busy: false };
  var root = null;

  function shell() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'ccx';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'ccxTitle');
    root.innerHTML = '<div class="ccx__bar"><h2 id="ccxTitle">Check the cards</h2>'
      + '<div class="ccx__views" role="group" aria-label="How to look at them"><button type="button" data-ccx-view="one" aria-pressed="true">One by one</button><button type="button" data-ccx-view="all" aria-pressed="false">All at once</button></div>'
      + '<button type="button" class="ghost ccx__shut" data-ccx="close">Close</button></div>'
      + '<div class="ccx__body" data-ccx-body></div>';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('submit', function (e) { e.preventDefault(); saveAndNext(); });
    root.addEventListener('input', function (e) { if (e.target && e.target.closest('.ccx__fix')) livePreview(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root && !root.hidden) close(); });
    return root;
  }

  /* what is on the card now: from the server for a card that exists (it
     carries the name as printed and the photograph), from the register for
     a membership not issued yet */
  function dataOf(item) {
    var key = S.kind + ':' + item.ref;
    if (S.cache[key]) return Promise.resolve(S.cache[key]);
    if (!item.issued) {
      var d = { card: { kind: S.kind, name: item.name, number: item.number, district: item.district, state: item.state, tier: item.tier, validUntil: '', lifetime: false, standing: 'valid', valid: true, url: '' }, photo: '' };
      S.cache[key] = d;
      return Promise.resolve(d);
    }
    return A.api('/api/admin/digital-cards?kind=' + K[S.kind].api + '&ref=' + encodeURIComponent(item.ref) + '&preview=1').then(function (r) {
      var c = Object.assign({}, r.card || {}, { kind: S.kind, standing: 'valid', valid: true });
      var out = { card: c, photo: r.photo || '', online: r.online || null };
      S.cache[key] = out;
      return out;
    });
  }
  function draw(box, card, photo) {
    return needCard().then(function (D) {
      D.render(box, card, { root: '', photo: photo || '', controls: false });
    });
  }

  /* ---- one by one ---- */
  function one() {
    var body = root.querySelector('[data-ccx-body]');
    var item = S.items[S.at];
    if (!item) { body.innerHTML = '<p class="ccx__count">There are no cards to check here yet.</p>'; return; }
    var member = S.kind === 'member';
    var notYet = member && !item.issued;
    body.innerHTML = '<p class="ccx__count">Card <b>' + (S.at + 1) + '</b> of ' + S.items.length + '</p>'
      + '<div class="ccx__one"><div class="ccx__card"><div class="dc" data-ccx-card><div class="ccx__wait">Drawing the card…</div></div><p class="ccx__tip">This is the card as its holder sees it. Tap it to see the back.</p></div>'
      + '<form class="ccx__fix" novalidate>'
      + '<p class="ccx__now">' + (notYet ? 'Not issued yet. Check the name, then press Issue this card.' : item.online ? 'Issued and online. A correction shows on it at once.' : 'Issued.') + '</p>'
      + '<label>Name on the card<input name="name" autocomplete="off" maxlength="60" value="' + esc(item.name || '') + '"></label>'
      + '<label>District<input name="district" autocomplete="off" maxlength="60" value="' + esc(item.district || '') + '"' + (notYet ? ' readonly' : '') + '></label>'
      + '<label>State<input name="state" autocomplete="off" maxlength="40" value="' + esc(item.state || '') + '"' + (notYet ? ' readonly' : '') + '></label>'
      + '<p class="ccx__say" data-ccx-say role="status" aria-live="polite"></p>'
      + '<div class="ccx__go">'
      + (notYet ? '<button type="button" class="press" data-ccx="issue">Issue this card</button>' : '<button type="submit" class="press" data-ccx="save">Next card</button>')
      + (S.at > 0 ? '<button type="button" class="ghost" data-ccx="prev">Previous</button>' : '')
      + (notYet && S.at < S.items.length - 1 ? '<button type="button" class="ghost" data-ccx="next">Skip to the next</button>' : '')
      + '</div></form></div>';
    var box = body.querySelector('[data-ccx-card]');
    dataOf(item).then(function (d) {
      if (S.items[S.at] !== item || S.view !== 'one') return;
      /* the boxes start from what the card carries */
      var f = body.querySelector('.ccx__fix');
      if (d.card && d.card.name && f) {
        item.name = d.card.name; item.district = d.card.district || item.district; item.state = d.card.state || item.state;
        f.name.value = item.name; f.district.value = item.district || ''; f.state.value = item.state || '';
      }
      body._data = d;
      livePreview();
    }).catch(function (e) { box.innerHTML = '<div class="ccx__wait">' + esc((e && e.message) || 'The card could not be drawn just now.') + '</div>'; });
    var first = body.querySelector('input[name="name"]');
    if (first) first.focus({ preventScroll: true });
  }
  function typed() {
    var f = root.querySelector('.ccx__fix');
    return f ? { name: f.name.value.replace(/\s+/g, ' ').trim(), district: f.district.value.replace(/\s+/g, ' ').trim(), state: f.state.value.replace(/\s+/g, ' ').trim() } : null;
  }
  function dirty() {
    var t = typed(); var item = S.items[S.at];
    return Boolean(t && item && (t.name !== (item.name || '') || t.district !== (item.district || '') || t.state !== (item.state || '')));
  }
  function livePreview() {
    var body = root.querySelector('[data-ccx-body]');
    var d = body && body._data;
    var box = body && body.querySelector('[data-ccx-card]');
    var t = typed();
    if (!d || !box || !t) return;
    draw(box, Object.assign({}, d.card, { name: t.name || ' ', district: t.district, state: t.state }), d.photo);
    var go = root.querySelector('[data-ccx="save"]');
    if (go) go.textContent = dirty() ? 'Save and go to the next card' : (S.at < S.items.length - 1 ? 'Next card' : 'Done');
  }
  function say(text, tone) {
    var s = root.querySelector('[data-ccx-say]');
    if (!s) return;
    s.textContent = text || '';
    if (tone) s.setAttribute('data-tone', tone); else s.removeAttribute('data-tone');
  }
  function move(by) {
    S.at = Math.max(0, Math.min(S.items.length - 1, S.at + by));
    one();
  }
  function saveAndNext() {
    if (S.busy) return;
    var item = S.items[S.at];
    if (!item) return;
    if (!dirty()) { if (S.at < S.items.length - 1) move(1); else close(); return; }
    var t = typed();
    if (!t.name) { say('Type the name to print on the card.', 'bad'); return; }
    S.busy = true;
    say('Saving…');
    A.api('/api/admin/digital-cards', { method: 'POST', body: { action: 'correct', kind: K[S.kind].api, ref: item.ref, name: t.name, district: t.district, state: t.state } }).then(function (r) {
      item.name = t.name; item.district = t.district; item.state = t.state;
      delete S.cache[S.kind + ':' + item.ref];
      if (S.changed) S.changed(item);
      S.busy = false;
      if (r.note) { say('Saved. ' + r.note, 'good'); return; }
      if (S.at < S.items.length - 1) { move(1); say('Saved. Here is the next card.', 'good'); } else { one(); say('Saved. That was the last card.', 'good'); }
    }, function (e) { S.busy = false; say((e && e.message) || 'That could not be saved just now.', 'bad'); });
  }
  function issueNow() {
    if (S.busy) return;
    var item = S.items[S.at];
    var t = typed();
    if (!item || !t) return;
    if (!t.name) { say('Type the name to print on the card.', 'bad'); return; }
    S.busy = true;
    say('Issuing the card…');
    A.api('/api/admin/membership', { method: 'POST', body: { action: 'issue', reference: item.ref, printName: t.name } }).then(function (d) {
      item.issued = true; item.online = Boolean(d.digital); item.name = t.name;
      if (d.card && d.card.cardId) item.number = d.card.cardId;
      delete S.cache[S.kind + ':' + item.ref];
      if (S.changed) S.changed(item, d);
      S.busy = false;
      var line = 'Issued' + (d.digital ? ' and online' : '') + (d.emailed ? '; the member was emailed the link.' : '.');
      if (S.at < S.items.length - 1) { move(1); say(line + ' Here is the next card.', 'good'); } else { one(); say(line, 'good'); }
    }, function (e) { S.busy = false; say((e && e.message) || 'The card could not be issued just now.', 'bad'); });
  }

  /* ---- all at once ---- */
  function all() {
    var body = root.querySelector('[data-ccx-body]');
    var waiting = S.items.filter(function (x) { return S.kind === 'member' && !x.issued; });
    body.innerHTML = '<div class="ccx__all-head"><p>Every card, as its holder sees it. Press <b>Change</b> under any card to correct it.</p>'
      + (waiting.length ? '<button type="button" class="press" data-ccx="issue-all">Issue the ' + waiting.length + (waiting.length === 1 ? ' card' : ' cards') + ' not issued yet</button>' : '') + '</div>'
      + '<p class="ccx__say" data-ccx-say role="status" aria-live="polite"></p>'
      + '<ul class="ccx__grid">' + S.items.map(function (x, i) {
        return '<li><div class="dc" data-ccx-tile="' + i + '"><div class="ccx__wait">Drawing…</div></div>'
          + '<div class="ccx__who"><span><b>' + esc(x.name || '') + '</b><small>' + esc(S.kind === 'member' && !x.issued ? 'Not issued yet' : x.online ? 'Online' : 'Issued') + '</small></span>'
          + '<button type="button" class="ghost" data-ccx-change="' + i + '">Change</button></div></li>';
      }).join('') + '</ul>';
    /* drawn one after another, so a long list does not ask for every
       photograph at once */
    var i = 0;
    (function next() {
      if (S.view !== 'all' || i >= S.items.length) return;
      var n = i; i += 1;
      var tile = body.querySelector('[data-ccx-tile="' + n + '"]');
      dataOf(S.items[n]).then(function (d) { return tile ? draw(tile, d.card, d.photo) : null; }).catch(function () { if (tile) tile.innerHTML = '<div class="ccx__wait">Not drawn</div>'; }).then(next);
    }());
  }
  function issueAll(b) {
    var list = S.items.filter(function (x) { return S.kind === 'member' && !x.issued; });
    if (!list.length || S.busy) return;
    if (!window.confirm('Issue ' + list.length + (list.length === 1 ? ' membership card' : ' membership cards') + ' now, with the names as they are shown?\n\nEach is put online at its own address, and every member with an email address is emailed their link.')) return;
    S.busy = true; b.disabled = true;
    var done = 0; var failed = [];
    (function next(k) {
      if (k >= list.length) {
        S.busy = false;
        all();
        say(done + (done === 1 ? ' card' : ' cards') + ' issued.' + (failed.length ? ' Not issued: ' + failed.join(', ') + '.' : ''), failed.length ? 'bad' : 'good');
        return;
      }
      var item = list[k];
      say('Issuing ' + (k + 1) + ' of ' + list.length + ': ' + (item.name || item.ref) + '…');
      A.api('/api/admin/membership', { method: 'POST', body: { action: 'issue', reference: item.ref, printName: item.name } }).then(function (d) {
        item.issued = true; item.online = Boolean(d.digital);
        if (d.card && d.card.cardId) item.number = d.card.cardId;
        delete S.cache[S.kind + ':' + item.ref];
        if (S.changed) S.changed(item, d);
        done += 1;
      }, function (e) { failed.push((item.name || item.ref) + ' (' + ((e && e.message) || 'failed') + ')'); }).then(function () { next(k + 1); });
    }(0));
  }

  function paint() {
    root.querySelector('#ccxTitle').textContent = 'Check the cards: ' + K[S.kind].title.toLowerCase();
    Array.prototype.forEach.call(root.querySelectorAll('[data-ccx-view]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-ccx-view') === S.view)); });
    if (S.view === 'all') all(); else one();
  }
  function onClick(e) {
    var b = e.target.closest && e.target.closest('[data-ccx],[data-ccx-view],[data-ccx-change]');
    if (!b) return;
    if (b.hasAttribute('data-ccx-view')) { S.view = b.getAttribute('data-ccx-view'); paint(); return; }
    if (b.hasAttribute('data-ccx-change')) { S.at = Number(b.getAttribute('data-ccx-change')) || 0; S.view = 'one'; paint(); return; }
    var what = b.getAttribute('data-ccx');
    if (what === 'close') return close();
    if (what === 'prev') return move(-1);
    if (what === 'next') return move(1);
    if (what === 'issue') return issueNow();
    if (what === 'issue-all') return issueAll(b);
  }

  var opener = null;
  function open(o) {
    shell();
    S.kind = o.kind === 'caregiver' ? 'caregiver' : 'member';
    S.items = (o.items || []).slice();
    S.at = Math.max(0, Math.min(S.items.length - 1, Number(o.start) || 0));
    S.view = o.view === 'all' ? 'all' : 'one';
    S.changed = o.changed || null;
    opener = document.activeElement;
    root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    paint();
  }
  function close() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.style.overflow = '';
    if (S.closed) S.closed();
    if (opener && opener.focus) { try { opener.focus(); } catch (_) {} }
  }

  /* The new-style card in place of a drawing of the old one (the To decide
     queue and a case's own preview): put beside the canvas, the canvas
     hidden. data: { kind, name, number, district, state, validUntil, photo } */
  function inPlaceOf(canvas, data) {
    if (!canvas || !canvas.parentNode) return Promise.resolve();
    var box = canvas.nextElementSibling && canvas.nextElementSibling.classList.contains('ccx-new') ? canvas.nextElementSibling : null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'dc ccx-new';
      canvas.parentNode.insertBefore(box, canvas.nextSibling);
    }
    canvas.hidden = true;
    canvas.style.display = 'none';
    var card = Object.assign({ standing: 'valid', valid: true, url: '' }, data, { photo: undefined });
    return draw(box, card, data.photo || '');
  }

  window.PFACardCheck = { open: open, close: close, inPlaceOf: inPlaceOf, onClose: function (f) { S.closed = f; } };
})();
