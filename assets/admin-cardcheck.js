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
     Revoke       a card issued and online can be revoked here (owner, 17
                  Nov 2026: "there should be option to revoke as well",
                  "for both membership and colony caregiver"): its page then
                  says it is no longer valid. Issue it again brings it back.
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
    '.ccx__life{padding-top:16px;border-top:1px solid var(--line)}.ccx__life:empty{display:none}',
    '.ccx__life button{min-height:56px;padding:0 24px;font-size:16px;width:auto;margin:0}',
    '.ccx__revoke{color:#b42318;border-color:#b42318}',
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
    '@media (max-width:860px){.ccx__one{grid-template-columns:minmax(0,1fr)}.ccx__bar h2{font-size:21px;flex:1 1 0;min-width:0}.ccx__shut{order:2}.ccx__views{order:3;flex:1 1 100%}.ccx__views button{flex:1 1 50%}}',
    /* Members and Caregivers read alike (17 Nov 2026: "why is the members
       section so diff from colony caregiver"): the same four parts, each
       opening with the register's own control, the register's buttons, and
       on a phone each line of a list stands as a card, nothing off screen */
    '.mq-bar{display:flex;flex-wrap:wrap;width:max-content;max-width:100%;margin:0 0 14px}',
    ':is([data-pane="apply"],[data-pane="cards"],[data-pane="membership"],[data-pane="verify"],[data-pane="caregivers"],.rg) :is(.ghost,.press){display:inline-flex;align-items:center;justify-content:center;width:auto;height:auto;min-height:38px;padding:0 14px;font-size:13px;letter-spacing:0;text-transform:none}',
    '.main[data-sub] .pane[data-pane="caregivers"]::before{content:"Every card"!important;display:block;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:0 0 16px}',
    '[data-pane="verify"] .tools input{flex:0 1 440px}',
    '.ccx :is(.ghost,.press){text-transform:none;letter-spacing:0}',
    '.mq-bar b{display:inline-flex;align-items:center;min-height:38px;padding:0 12px;background:var(--ink);color:var(--paper);font-size:12px;font-weight:400}',
    '@media (max-width:760px){.mq-bar{width:100%}.mq-bar button{flex:1 1 auto}}',
    '@media (max-width:760px){[data-pane="membership"] :is(table,tbody,tr,td){display:block}[data-pane="membership"] thead{display:none}[data-pane="membership"] tr{position:relative;padding:12px 12px 12px 48px;border-bottom:1px solid var(--line)}[data-pane="membership"] td{padding:3px 0;border:0}[data-pane="membership"] td.mq-pick{position:absolute;left:12px;top:12px}[data-pane="membership"] .mq-do{text-align:left;white-space:normal;padding-top:10px}[data-pane="membership"] .mq-slots,[data-pane="membership"] .mq-courier{justify-content:flex-start}[data-pane="membership"] .wrap{overflow:visible}}'
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
      /* a caregiver's card carries the photograph sent with the application */
      var face = S.kind !== 'caregiver' ? Promise.resolve('') : A.api('/api/admin/attachment?reference=' + encodeURIComponent(item.ref) + '&n=1').then(function (a) {
        var b64 = a && (a.data || a.bytes);
        return b64 ? 'data:' + (a.contentType || 'image/jpeg') + ';base64,' + b64 : '';
      }).catch(function () { return ''; });
      return face.then(function (photo) { d.photo = photo; S.cache[key] = d; return d; });
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
    var notYet = !item.issued;
    var blocked = notYet && S.kind === 'caregiver' && !item.ready;
    body.innerHTML = '<p class="ccx__count">Card <b>' + (S.at + 1) + '</b> of ' + S.items.length + '</p>'
      + '<div class="ccx__one"><div class="ccx__card"><div class="dc" data-ccx-card><div class="ccx__wait">Drawing the card…</div></div><p class="ccx__tip">This is the card as its holder sees it. Tap it to see the back.</p></div>'
      + '<form class="ccx__fix" novalidate>'
      + '<p class="ccx__now" data-ccx-now>' + nowLine(item) + '</p>'
      + '<label>Name on the card<input name="name" autocomplete="off" maxlength="60" value="' + esc(item.name || '') + '"></label>'
      + '<label>District<input name="district" autocomplete="off" maxlength="60" value="' + esc(item.district || '') + '"' + (notYet ? ' readonly' : '') + '></label>'
      + '<label>State<input name="state" autocomplete="off" maxlength="40" value="' + esc(item.state || '') + '"' + (notYet ? ' readonly' : '') + '></label>'
      /* a caregiver's checks, as To do shows them: red stops the card */
      + (notYet && item.checks ? '<ul class="checks">' + item.checks.map(function (c) { return '<li data-l="' + esc(c.level) + '">' + esc(c.text) + '</li>'; }).join('') + '</ul>' : '')
      + '<p class="ccx__say" data-ccx-say role="status" aria-live="polite"></p>'
      + '<div class="ccx__go">'
      + (blocked ? '<button type="button" class="press" data-ccx="case">Open the application</button>'
        : notYet ? '<button type="button" class="press" data-ccx="issue">Issue this card</button>' : '<button type="submit" class="press" data-ccx="save">Next card</button>')
      + (S.at > 0 ? '<button type="button" class="ghost" data-ccx="prev">Previous</button>' : '')
      + (notYet && S.at < S.items.length - 1 ? '<button type="button" class="ghost" data-ccx="next">Skip to the next</button>' : '')
      + '</div><div class="ccx__life" data-ccx-life></div></form></div>';
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
      if (d.online) { item.online = d.online.standing !== 'withdrawn'; item.revoked = d.online.standing === 'withdrawn'; item.revokedOn = d.online.withdrawnOn || ''; }
      life(item);
      livePreview();
    }).catch(function (e) { box.innerHTML = '<div class="ccx__wait">' + esc((e && e.message) || 'The card could not be drawn just now.') + '</div>'; });
    var first = body.querySelector('input[name="name"]');
    if (first) first.focus({ preventScroll: true });
  }
  function nowLine(item) {
    if (!item.issued && S.kind === 'caregiver' && !item.ready) return 'Not issued yet. Fix what is in red first.';
    if (!item.issued) return 'Not issued yet. Check the name' + (S.kind === 'caregiver' ? ' and the photograph' : '') + ', then press Issue this card.';
    if (item.revoked) return 'Revoked' + (item.revokedOn ? ' on ' + longDay(item.revokedOn) : '') + '. Its page says it is no longer valid.';
    return item.online ? 'Issued and online. A correction shows on it at once.' : 'Issued, not online.';
  }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function longDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  /* Revoke, or Issue it again, under the boxes */
  function life(item) {
    var slot = root.querySelector('[data-ccx-life]');
    var line = root.querySelector('[data-ccx-now]');
    if (line) line.textContent = nowLine(item);
    if (!slot) return;
    if (!item.issued) { slot.innerHTML = ''; return; }
    slot.innerHTML = item.online
      ? '<button type="button" class="ghost ccx__revoke" data-ccx="revoke">Revoke this card</button>'
      : '<button type="button" class="ghost" data-ccx="restore">' + (item.revoked ? 'Issue it again' : 'Put it online') + '</button>';
  }
  function revoke() {
    var item = S.items[S.at];
    var body = root.querySelector('[data-ccx-body]');
    var d = body && body._data;
    if (!item || !d || !d.online || !d.online.id || S.busy) return;
    if (!window.confirm('Revoke the card of ' + (item.name || 'this holder') + '?\n\nIts page will say it is no longer valid' + (S.kind === 'caregiver' ? ', and its photograph is no longer shown' : '') + '. You can issue it again later.')) return;
    S.busy = true;
    say('Revoking…');
    A.api('/api/admin/digital-cards', { method: 'POST', body: { action: 'withdraw', kind: K[S.kind].api, id: d.online.id } }).then(function (r) {
      d.online = r.digital || Object.assign({}, d.online, { standing: 'withdrawn' });
      item.online = false; item.revoked = true; item.revokedOn = (r.digital && r.digital.withdrawnOn) || '';
      if (S.changed) S.changed(item);
      S.busy = false;
      life(item);
      livePreview();
      say('Revoked. Its page now says it is no longer valid.', 'good');
    }, function (e) { S.busy = false; say((e && e.message) || 'That could not be revoked just now.', 'bad'); });
  }
  function restore() {
    var item = S.items[S.at];
    var body = root.querySelector('[data-ccx-body]');
    var d = body && body._data;
    if (!item || S.busy) return;
    S.busy = true;
    say('Putting it online…');
    A.api('/api/admin/digital-cards', { method: 'POST', body: { action: 'issue', kind: K[S.kind].api, ref: item.ref, email: false } }).then(function (r) {
      if (d) d.online = r.digital;
      item.online = true; item.revoked = false;
      if (S.changed) S.changed(item);
      S.busy = false;
      life(item);
      livePreview();
      say('It is online again and valid.', 'good');
    }, function (e) { S.busy = false; say((e && e.message) || 'That could not be done just now.', 'bad'); });
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
    var it = S.items[S.at] || {};
    draw(box, Object.assign({}, d.card, { name: t.name || ' ', district: t.district, state: t.state, standing: it.revoked ? 'withdrawn' : 'valid', valid: !it.revoked }), it.revoked ? '' : d.photo);
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
    issueCall(item, t.name).then(function (d) {
      item.issued = true; item.online = Boolean(d.digital); item.name = t.name;
      if (d.card && d.card.cardId) item.number = d.card.cardId;
      delete S.cache[S.kind + ':' + item.ref];
      if (S.changed) S.changed(item, d);
      S.busy = false;
      var line = 'Issued' + (d.digital ? ' and online' : '') + (d.emailed ? '; the ' + (S.kind === 'member' ? 'member' : 'caregiver') + ' was emailed.' : '.');
      if (S.at < S.items.length - 1) { move(1); say(line + ' Here is the next card.', 'good'); } else { one(); say(line, 'good'); }
    }, function (e) { S.busy = false; say((e && e.message) || 'The card could not be issued just now.', 'bad'); });
  }

  /* Issue a card: a membership by its own route, a caregiver's by deciding
     the application (lib/routes/admin/case.js approve, as To do does); the
     caregiver's card is then known by its card number */
  function issueCall(item, name) {
    if (S.kind === 'member') return A.api('/api/admin/membership', { method: 'POST', body: { action: 'issue', reference: item.ref, printName: name } });
    return A.api('/api/admin/case', { method: 'POST', body: { reference: item.ref, action: 'approve', printName: name } }).then(function (d) {
      d.card = { cardId: d.cardId };
      delete S.cache[S.kind + ':' + item.ref];
      item.ref = d.cardId;
      return d;
    });
  }
  function waitingOf() { return S.items.filter(function (x) { return !x.issued && (S.kind === 'member' || x.ready); }); }

  /* ---- all at once ---- */
  function all() {
    var body = root.querySelector('[data-ccx-body]');
    var waiting = waitingOf();
    body.innerHTML = '<div class="ccx__all-head"><p>Every card, as its holder sees it. Press <b>Change</b> under any card to correct it.</p>'
      + (waiting.length ? '<button type="button" class="press" data-ccx="issue-all">Issue the ' + waiting.length + (waiting.length === 1 ? ' card' : ' cards') + ' not issued yet</button>' : '') + '</div>'
      + '<p class="ccx__say" data-ccx-say role="status" aria-live="polite"></p>'
      + '<ul class="ccx__grid">' + S.items.map(function (x, i) {
        return '<li><div class="dc" data-ccx-tile="' + i + '"><div class="ccx__wait">Drawing…</div></div>'
          + '<div class="ccx__who"><span><b>' + esc(x.name || '') + '</b><small>' + esc(!x.issued ? (S.kind === 'caregiver' && !x.ready ? 'Not issued yet: fix it first' : 'Not issued yet') : x.revoked ? 'Revoked' : x.online ? 'Online' : 'Issued') + '</small></span>'
          + '<button type="button" class="ghost" data-ccx-change="' + i + '">Change</button></div></li>';
      }).join('') + '</ul>';
    /* drawn one after another, so a long list does not ask for every
       photograph at once */
    var i = 0;
    (function next() {
      if (S.view !== 'all' || i >= S.items.length) return;
      var n = i; i += 1;
      var tile = body.querySelector('[data-ccx-tile="' + n + '"]');
      dataOf(S.items[n]).then(function (d) {
        var gone = S.items[n].revoked || (d.online && d.online.standing === 'withdrawn');
        return tile ? draw(tile, Object.assign({}, d.card, { standing: gone ? 'withdrawn' : 'valid', valid: !gone }), gone ? '' : d.photo) : null;
      }).catch(function () { if (tile) tile.innerHTML = '<div class="ccx__wait">Not drawn</div>'; }).then(next);
    }());
  }
  function issueAll(b) {
    var list = waitingOf();
    if (!list.length || S.busy) return;
    var noun = S.kind === 'member' ? 'membership card' : 'colony caregiver card';
    if (!window.confirm('Issue ' + list.length + ' ' + noun + (list.length === 1 ? '' : 's') + ' now, with the names as they are shown?\n\nEach is put online at its own address, and everyone with an email address is emailed.')) return;
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
      issueCall(item, item.name).then(function (d) {
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
    if (what === 'case') { var ref = (S.items[S.at] || {}).ref; close(); if (ref && A.showCase) A.showCase(ref); return; }
    if (what === 'revoke') return revoke();
    if (what === 'restore') return restore();
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

  /* Photos and cards (admin.html mqRow): Revoke card and Issue it again on
     a membership's line, kept here so admin.html stays under its ceiling */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pane="membership"] [data-mq-life]');
    if (!b) return;
    var what = b.getAttribute('data-mq-life');
    var name = b.getAttribute('data-name') || b.getAttribute('data-ref');
    var line = document.querySelector('[data-pane="membership"] [data-mq-say]');
    var tell = function (text, tone) { if (line) A.say(line, text, tone); };
    if (what === 'revoke') {
      if (!b.getAttribute('data-id')) return;
      if (!window.confirm('Revoke the membership card of ' + name + '?\n\nIts page will say it is no longer valid. You can issue it again later.')) return;
    }
    b.disabled = true;
    var body = what === 'revoke' ? { action: 'withdraw', kind: 'member', id: b.getAttribute('data-id') } : { action: 'issue', kind: 'member', ref: b.getAttribute('data-ref'), email: false };
    A.api('/api/admin/digital-cards', { method: 'POST', body: body }).then(function () {
      var done = what === 'revoke' ? name + '\u2019s card is revoked. Its page now says it is no longer valid.' : name + '\u2019s card is online and valid again.';
      if (A.refresh) A.refresh();
      setTimeout(function () { tell(done, 'good'); }, 600);
    }, function (err) { b.disabled = false; tell((err && err.message) || 'That could not be done just now.', 'bad'); });
  });

  window.PFACardCheck = { open: open, close: close, inPlaceOf: inPlaceOf, onClose: function (f) { S.closed = f; } };
})();
