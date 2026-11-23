/* Live chat: answering visitors on the site's chat, from the panel
   (owner, 16 Nov 2026: "build a chat UI for admin side, where people can
   answer questions- when online", then "make chat work super fast ...
   enterprise grade. like whatsapp grade", "the admin user who is on chat
   should get the chat in diff color when the chat comes in when offline. so
   that it can be picked up when the admin user goes online next", "how will
   chat be handled when multiple users are there in admin who handle chat",
   "edge cases everything").

   Available is a switch, kept in this browser and the same in every tab of
   it. While it is on and the panel is open, the panel tells the server so
   every 20 seconds (lib/live-chat.js); the site offers a chat only while
   someone is. Close the panel, sign out, or switch it off, and within 75
   seconds the site stops offering one and a visitor already chatting with you
   is told you have gone offline.

   Several people answer together:
   - a waiting chat is everyone's: the first to reply or press Take has it,
     and it shows under their name for the rest;
   - one someone else has is read only, with Take over (the visitor is told
     who is answering now);
   - what a visitor writes while nobody who could answer is online is marked:
     the chat is first in the list, in amber, until someone answers it.

   Fast: the open chat is read every second while it is lively, the list every
   three seconds. A reply shows the moment Send is pressed, with Sending, Sent
   and Seen under it, and is sent with its own id, so trying again never sends
   it twice. The visitor's typing, and whether they are still on the page,
   are shown. A new chat, or a new message in a chat of yours, sounds a short
   tone, shows on the rail and in the tab's title, and, if you allow it, as a
   desktop notification.

   admin.html calls PFALiveChat.pane() for the tab 'livechat' and
   PFALiveChat.watch() once signed in. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var KEY = 'pfa.livechat.available';
  var URL_ = '/api/admin/live-chat';
  var BEAT_MS = 20000;
  var L = {
    on: false, me: null, online: [], chats: [], closed: [], view: 'current', open: '', chat: null,
    drafts: {}, pending: {}, known: {}, firstList: true, allowed: true, said: '', activeAt: 0, typedAt: 0, listBusy: false, chatBusy: false
  };
  var beatT = null, listT = null, chatT = null;
  var baseTitle = document.title;

  var main = document.querySelector('[data-pane="submissions"]');
  if (main && !document.querySelector('[data-pane="livechat"]')) {
    var node = document.createElement('div');
    node.className = 'pane';
    node.setAttribute('data-pane', 'livechat');
    node.setAttribute('role', 'region');
    node.setAttribute('aria-label', 'Live chat');
    main.parentNode.insertBefore(node, main.nextSibling);
  }

  var style = document.createElement('style');
  style.textContent = '.lc-top{display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:0 0 18px;padding:14px 16px;border:1px solid var(--line)}'
    + '.lc-switch{display:inline-flex;align-items:center;gap:10px;min-height:40px;padding:0 16px 0 12px;border:1px solid var(--ink);background:#fff;color:var(--ink);font:inherit;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;white-space:nowrap}'
    + '.lc-switch i{position:relative;width:34px;height:20px;border-radius:10px;background:#c9c6c1;flex:none;transition:background .15s}.lc-switch i::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}'
    + '.lc-switch[aria-pressed="true"] i{background:#1f7a3f}.lc-switch[aria-pressed="true"] i::after{left:17px}'
    + '.lc-state{flex:1 1 280px;margin:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}.lc-state b{font-weight:700}.lc-state span{color:var(--muted)}'
    + '.lc-alerts{flex:none;padding:0;border:0;background:none;font:inherit;font-size:12px;color:var(--muted);text-decoration:underline;text-underline-offset:3px;cursor:pointer}'
    + '.lc-say{margin:0 0 12px;font-size:13px}.lc-say:empty{display:none}.lc-say[data-tone="bad"]{color:#a3251f}.lc-say[data-tone="good"]{color:#1f6b3a}'
    + '.lc-grid{display:grid;grid-template-columns:minmax(260px,350px) minmax(0,1fr);gap:18px;align-items:start}'
    + '.lc-list{border:1px solid var(--line);min-width:0}.lc-seg{display:flex;border-bottom:1px solid var(--line)}.lc-seg button{flex:1;height:40px;border:0;border-right:1px solid var(--line);background:none;font:inherit;font-size:13px;cursor:pointer;color:var(--ink);white-space:nowrap}.lc-seg button:last-child{border-right:0}.lc-seg button[aria-pressed="true"]{background:var(--ink);color:#fff}'
    + '.lc-group{margin:0;padding:10px 14px 6px;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);background:#fbfaf9}'
    + '.lc-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;width:100%;padding:12px 14px;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;font:inherit;color:var(--ink);cursor:pointer}.lc-item:last-child{border-bottom:0}'
    + '.lc-item[aria-current="true"]{background:#f4f3f1;box-shadow:inset 0 0 0 2px var(--ink)}'
    /* written while nobody was there: amber until answered */
    + '.lc-item[data-away]{background:#fdf6e9}.lc-item[data-away][aria-current="true"]{background:#f9eed8}'
    + '@media (hover:hover){.lc-item:hover{background:#f8f7f5}.lc-item[data-away]:hover{background:#faf0dc}}'
    + '.lc-q{grid-column:1;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0;font-size:14px;line-height:1.45;overflow-wrap:anywhere}'
    + '.lc-item[data-unread] .lc-q{font-weight:700}'
    + '.lc-when{grid-column:2;grid-row:1;font-size:11px;color:var(--muted);white-space:nowrap}'
    + '.lc-meta{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:0;font-size:12px;line-height:1.4;color:var(--muted)}'
    + '.lc-badge{display:inline-grid;place-items:center;min-width:20px;height:18px;padding:0 6px;background:var(--deep,#0a0a0a);color:#fff;font-size:10px;font-weight:700}'
    + '.lc-tag{display:inline-block;padding:2px 7px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor}.lc-tag[data-s="waiting"]{color:#a3251f}.lc-tag[data-s="open"]{color:#1f6b3a}.lc-tag[data-s="closed"]{color:var(--muted)}.lc-tag[data-s="away"]{color:#8a5a12}'
    + '.lc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#c9c6c1;flex:none}.lc-dot[data-on]{background:#1f7a3f}'
    + '.lc-empty{margin:0;padding:22px 16px;font-size:14px;line-height:1.5;color:var(--muted)}'
    + '.lc-chat{border:1px solid var(--line);display:flex;flex-direction:column;min-width:0;min-height:460px}'
    + '.lc-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 16px;border-bottom:1px solid var(--line)}.lc-head h3{margin:0;flex:1 1 200px;font-family:var(--display);font-weight:400;font-size:20px;line-height:1.25}.lc-head .ghost,.lc-head .press{flex:none;width:auto;margin:0;min-height:36px;padding:0 14px}'
    + '.lc-sub{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin:0;font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}'
    + '.lc-back{display:none}'
    + '.lc-log{flex:1 1 auto;max-height:56vh;min-height:260px;overflow-y:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fbfaf9}'
    + '.lc-m{max-width:78%;font-size:14px;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}.lc-m small{display:block;margin:0 0 3px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:normal}'
    + '.lc-m a{color:inherit;text-decoration:underline;text-underline-offset:2px}'
    + '.lc-m--visitor{align-self:flex-start;padding:10px 12px;background:#fff;border:1px solid var(--line)}'
    + '.lc-m--visitor[data-away]{background:#fdf6e9;border-color:#ecd3a5}'
    + '.lc-m--staff{align-self:flex-end;padding:10px 12px;background:var(--ink);color:#fff}.lc-m--staff small{color:#cfcfcf}'
    + '.lc-m--staff[data-other]{background:#3a3a3a}'
    + '.lc-m .lc-st{display:block;margin-top:4px;font-size:11px;color:#cfcfcf;text-align:right;white-space:normal}.lc-m[data-st="seen"] .lc-st{color:#9fe0b4}.lc-m[data-st="failed"]{background:#7a1610;cursor:pointer}'
    + '.lc-m--system{align-self:center;max-width:100%;font-size:12px;color:var(--muted);text-align:center;white-space:normal}'
    + '.lc-awayline{align-self:center;margin:4px 0;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a5a12}'
    + '.lc-typing{min-height:20px;margin:0;padding:0 16px 6px;font-size:12px;color:var(--muted);background:#fbfaf9}'
    + '.lc-form{display:flex;gap:10px;align-items:flex-end;padding:12px 16px;border-top:1px solid var(--line)}.lc-form textarea{flex:1;min-width:0;min-height:44px;max-height:160px;padding:10px 12px;border:1px solid var(--line);font:inherit;font-size:15px;line-height:1.45;resize:none;background:#fff;color:var(--ink)}.lc-form textarea:focus{outline:none;border-color:var(--ink)}.lc-form .press{width:auto;flex:none;min-height:44px;padding:0 20px;margin:0}'
    + '.lc-count{flex-basis:100%;margin:-4px 0 0;font-size:11px;color:var(--muted);text-align:right}.lc-count:empty{display:none}'
    + '.lc-ro{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:0;padding:14px 16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}.lc-ro .press,.lc-ro .ghost{width:auto;margin:0;min-height:38px;padding:0 16px}'
    + '@media (max-width:900px){.lc-grid{grid-template-columns:minmax(0,1fr)}.lc-grid[data-open="1"] .lc-list{display:none}.lc-grid:not([data-open="1"]) .lc-chat{display:none}.lc-back{display:inline-flex}.lc-log{max-height:none;min-height:320px}.lc-m{max-width:90%}}';
  document.head.appendChild(style);

  function pane() { return document.querySelector('[data-pane="livechat"]'); }
  function remembered() { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } }
  function remember(on) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (_) { /* storage off */ } }
  function ago(iso) {
    var ms = Date.now() - Date.parse(iso || '');
    if (!isFinite(ms)) return '';
    if (ms < 45000) return 'now';
    var m = Math.round(ms / 60000);
    if (m < 60) return m + ' min';
    var h = Math.round(m / 60);
    if (h < 24) return h + ' h';
    return A.dayOf ? A.dayOf(iso) : String(iso).slice(0, 10);
  }
  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var ist = new Date(d.getTime() + 330 * 60000);
    var h = ist.getUTCHours(), mm = ('0' + ist.getUTCMinutes()).slice(-2);
    return (h % 12 || 12) + ':' + mm + (h < 12 ? ' am' : ' pm');
  }
  /* text with its web addresses as links, nothing else */
  function linked(text) {
    return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>'; });
  }
  function cidOf() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function shown() { var p = pane(); return Boolean(p && p.getAttribute('data-live') === '1' && !($('#app') || {}).hidden); }

  /* ---- available, and the server told so ---- */
  function beat() {
    clearTimeout(beatT);
    if (!L.on) return;
    A.api(URL_, { method: 'POST', body: { action: 'presence', available: true } })
      .catch(function (e) { if (e && e.denied) { L.allowed = false; L.on = false; } })
      .then(function () { if (L.on) beatT = setTimeout(beat, BEAT_MS); });
  }
  function setOn(on, quiet) {
    L.on = on;
    if (!quiet) remember(on);
    A.api(URL_, { method: 'POST', body: { action: 'presence', available: on } }).catch(function () { /* the next beat says it again */ });
    clearTimeout(beatT);
    if (on) { beatT = setTimeout(beat, BEAT_MS); unlockSound(); }
    loop(true);
    draw(false);
  }
  /* one switch for every tab of this browser */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var on = e.newValue === '1';
    if (on !== L.on) { L.on = on; clearTimeout(beatT); if (on) beatT = setTimeout(beat, 1000); loop(true); draw(false); }
  });
  /* going away: closing the tab, reloading, signing out */
  function away() {
    if (!L.on) return;
    A.token().then(function (t) {
      try { fetch(URL_, { method: 'POST', keepalive: true, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'presence', available: false }) }); } catch (_) { /* it lapses in 75 seconds */ }
    }).catch(function () {});
  }
  window.addEventListener('pagehide', function () { if (!otherTabsOn()) away(); });
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#signout')) { away(); remember(false); } }, true);
  /* another tab of this panel still open and available keeps you available */
  var TAB_ID = Math.random().toString(36).slice(2);
  function otherTabsOn() {
    try {
      var tabs = JSON.parse(localStorage.getItem('pfa.livechat.tabs') || '{}');
      return Object.keys(tabs).some(function (k) { return k !== TAB_ID && Date.now() - tabs[k] < 30000; });
    } catch (_) { return false; }
  }
  function tabAlive(gone) {
    try {
      var tabs = JSON.parse(localStorage.getItem('pfa.livechat.tabs') || '{}');
      if (gone) delete tabs[TAB_ID]; else tabs[TAB_ID] = Date.now();
      Object.keys(tabs).forEach(function (k) { if (Date.now() - tabs[k] > 60000) delete tabs[k]; });
      localStorage.setItem('pfa.livechat.tabs', JSON.stringify(tabs));
    } catch (_) { /* storage off */ }
  }
  window.addEventListener('pagehide', function () { tabAlive(true); });

  /* ---- telling you: a tone, the tab's title, and a desktop notice if allowed ---- */
  var audio = null;
  function unlockSound() {
    try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (_) { audio = null; }
  }
  function tone() {
    try {
      if (!audio || audio.state !== 'running') return;
      [0, 0.18].forEach(function (at, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = i ? 880 : 660;
        g.gain.setValueAtTime(0.0001, audio.currentTime + at);
        g.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + 0.16);
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + at); o.stop(audio.currentTime + at + 0.17);
      });
    } catch (_) { /* no sound; the rail still shows it */ }
  }
  document.addEventListener('pointerdown', function () { if (L.on) unlockSound(); }, { passive: true });
  function notify(title, body, id) {
    tone();
    try {
      if (!window.Notification || Notification.permission !== 'granted' || (document.hasFocus() && shown())) return;
      var n = new Notification(title, { body: body, tag: 'pfa-chat-' + id });
      n.onclick = function () { window.focus(); A.show('livechat'); openChat(id); n.close(); };
    } catch (_) { /* not where notices are allowed */ }
  }
  function alertsLabel() {
    if (!window.Notification) return '';
    return Notification.permission === 'granted' ? 'Desktop alerts are on' : Notification.permission === 'denied' ? 'Desktop alerts are blocked in this browser' : 'Turn on desktop alerts';
  }

  /* ---- the list: every 3 seconds while available ---- */
  function loop(now) {
    clearTimeout(listT);
    if (!L.allowed) return undefined;
    if (now) return list().then(function () { loop(false); });
    var wait = L.on ? (document.hidden ? 6000 : 3000) : shown() ? 15000 : 0;
    if (!wait) return undefined;
    listT = setTimeout(function () { list().then(function () { loop(false); }); }, wait);
    return undefined;
  }
  function list() {
    if (L.listBusy) return Promise.resolve();
    L.listBusy = true;
    if (L.on) tabAlive(false);
    return A.api(URL_ + (L.view === 'closed' ? '?closed=1' : '')).then(function (d) {
      L.listBusy = false;
      L.me = d.me; L.online = d.online || [];
      var chats = d.chats || [];
      /* what is new since the last look: a chat waiting, or something written in one of mine or while away */
      chats.forEach(function (c) {
        var was = L.known[c.id];
        var key = c.status + ':' + c.unanswered + ':' + c.away;
        if (!L.firstList && was !== key) {
          if (!was && c.status === 'waiting') notify('A visitor is waiting on the live chat', c.first, c.id);
          else if (was && c.unanswered > Number(String(was).split(':')[1] || 0) && (c.mine || c.status === 'waiting' || c.away)) notify(c.mine ? 'A new message in your chat' : 'A new message on the live chat', c.last, c.id);
        }
        L.known[c.id] = key;
      });
      L.firstList = false;
      L.chats = chats;
      if (L.view === 'closed') L.closed = d.closed || [];
      pip();
      if (!shown()) return;
      /* on a wide screen, the first chat opens by itself rather than an empty half */
      if (!L.open && L.view === 'current' && L.chats.length && window.matchMedia && window.matchMedia('(min-width: 901px)').matches) { openChat(L.chats[0].id); return; }
      draw(false);
    }).catch(function (e) {
      L.listBusy = false;
      if (e && e.denied) { L.allowed = false; L.on = false; clearTimeout(beatT); }
      if (shown()) { L.said = (e && e.message) || 'The chats could not be read.'; draw(false); }
    });
  }
  function needsMe(c) { return c.away || c.status === 'waiting' || (c.mine && c.unread) || (c.takenBy && !c.ownerOnline && c.awaiting); }
  function pip() {
    var n = L.chats.filter(needsMe).length;
    var p = $('#pipLive');
    if (p) { p.textContent = String(n); p.hidden = !n; }
    document.title = n ? '(' + n + ') Live chat | ' + baseTitle.replace(/^\(\d+\) Live chat \| /, '') : baseTitle;
  }

  /* ---- one chat: every second while it is lively ---- */
  function openChat(id) {
    if (L.open !== id) { L.open = id; L.chat = null; }
    draw();
    readChat(true);
  }
  function every() {
    if (document.hidden) return 6000;
    return Date.now() - L.activeAt < 60000 ? 1000 : 2500;
  }
  function readChat(scrollDown) {
    clearTimeout(chatT);
    if (!L.open || L.chatBusy) { if (L.open) chatT = setTimeout(function () { readChat(false); }, 500); return; }
    var id = L.open;
    var seen = L.chat && L.chat.id === id && !document.hidden && shown() ? L.chat.seq : 0;
    L.chatBusy = true;
    A.api(URL_ + '?id=' + encodeURIComponent(id) + '&seen=' + seen).then(function (d) {
      L.chatBusy = false;
      if (L.open !== id) return;
      var was = L.chat;
      L.chat = d.chat;
      if (!was || was.seq !== d.chat.seq) L.activeAt = Date.now();
      drawChat(Boolean(scrollDown) || !was || was.seq !== d.chat.seq);
    }).catch(function (e) { L.chatBusy = false; L.said = (e && e.message) || 'That chat could not be read.'; draw(false); })
      .then(function () { if (L.open === id && shown() && L.chat && L.chat.status !== 'closed') chatT = setTimeout(function () { readChat(false); }, every()); });
  }

  function post(body) { return A.api(URL_, { method: 'POST', body: body }); }
  function sendReply(text, force, cid) {
    var id = L.open;
    var c = cid || cidOf();
    L.pending[c] = { id: id, text: text, st: 'sending', at: new Date().toISOString() };
    L.activeAt = Date.now();
    drawChat(true);
    return post({ action: 'send', id: id, text: text, cid: c, force: Boolean(force) }).then(function (d) {
      delete L.pending[c];
      L.drafts[id] = '';
      if (L.open === id) { L.chat = d.chat; drawChat(true); }
      list();
    }).catch(function (e) {
      /* someone else has it now, or it ended: the words stay in the box */
      if (e && /^(TAKEN|CLOSED|FULL)$/.test(e.code || '')) { delete L.pending[c]; L.drafts[id] = text; }
      else if (L.pending[c]) L.pending[c].st = 'failed';
      say((e && e.message) || 'That did not go. Tap it to send again.', 'bad');
      drawChat(true);
      readChat(false);
    });
  }
  function act(action, more) {
    var id = L.open;
    return post(Object.assign({ action: action, id: id }, more || {})).then(function (d) {
      if (L.open === id && d.chat) { L.chat = d.chat; drawChat(true); }
      list();
    }).catch(function (e) { say((e && e.message) || 'That did not go. Try again.', 'bad'); });
  }
  function say(text, tone) { var s = pane() && pane().querySelector('[data-lc-csay]'); if (s) A.say(s, text, tone); }

  /* ---- drawing ---- */
  function stateLine() {
    var me = L.me && L.me.uid;
    var others = L.online.filter(function (s) { return s.uid !== me; }).map(function (s) { return s.name; });
    if (L.on) return '<b>You are available.</b> <span>Visitors who ask for a person, or whose question the site cannot answer, can chat with you.' + (others.length ? ' Also available: ' + esc(others.join(', ')) + '.' : '') + '</span>';
    return '<b>You are not available.</b> <span>' + (others.length ? 'Available now: ' + esc(others.join(', ')) + '.' : 'No one is available, so the site asks visitors to send their question to the help desk, and no new chat can start.') + '</span>';
  }
  function item(c) {
    var who = c.status === 'closed'
      ? 'Ended ' + ago(c.closedAt) + (c.closedBy === 'left' ? (c.unanswered ? ', left unanswered' : ', visitor left') : c.closedBy === 'visitor' ? ', by the visitor' : '')
      : c.status === 'waiting' ? 'Waiting for someone' : c.mine ? 'Yours' : 'With ' + esc((c.takenBy || {}).name || '') + (c.ownerOnline ? '' : ', offline');
    return '<button type="button" class="lc-item" data-lc-open="' + esc(c.id) + '"' + (c.id === L.open ? ' aria-current="true"' : '') + (c.away ? ' data-away' : '') + (c.unread ? ' data-unread' : '') + '>'
      + '<p class="lc-q">' + esc(c.lastFrom === 'visitor' || !c.last ? c.last || c.first : c.first) + '</p>'
      + '<span class="lc-when">' + esc(ago(c.lastAt || c.updatedAt)) + '</span>'
      + '<p class="lc-meta">' + (c.status !== 'closed' ? '<span class="lc-dot"' + (c.visitorHere ? ' data-on' : '') + ' title="' + (c.visitorHere ? 'The visitor is on the page' : 'The visitor is away') + '"></span>' : '')
      + (c.away ? '<span class="lc-tag" data-s="away">Came in while away</span>' : '<span class="lc-tag" data-s="' + esc(c.status) + '">' + (c.status === 'waiting' ? 'Waiting' : c.status === 'open' ? 'In progress' : 'Ended') + '</span>')
      + '<span>' + who + '</span>' + (c.unread ? '<span class="lc-badge" aria-label="' + c.unread + ' unread">' + c.unread + '</span>' : '') + '</p></button>';
  }
  function groups(rows) {
    if (L.view === 'closed') return rows.map(item).join('');
    var need = rows.filter(function (c) { return c.away || c.status === 'waiting' || (c.takenBy && !c.mine && !c.ownerOnline && c.awaiting); });
    var mine = rows.filter(function (c) { return need.indexOf(c) < 0 && c.mine; });
    var rest = rows.filter(function (c) { return need.indexOf(c) < 0 && !c.mine; });
    var g = function (title, list) { return list.length ? '<p class="lc-group">' + title + '</p>' + list.map(item).join('') : ''; };
    return g('Needs someone', need) + g('Yours', mine) + g('With others', rest);
  }
  function empty() {
    if (L.view === 'closed') return '<p class="lc-empty">No chats ended in the last 30 days.</p>';
    return '<p class="lc-empty">' + (L.on ? 'No one is chatting just now. A new chat sounds a short tone and shows on the rail.' : 'Switch on Available for chat to take chats from the site.') + '</p>';
  }
  /* draw(false) is the refresh: only the line, the counts and the list
     change, so a reply being written and a chat being read stay put */
  function draw(full) {
    var p = pane();
    if (!p) return;
    var rows = L.view === 'closed' ? L.closed : L.chats;
    if (full === false && p.querySelector('.lc-grid')) {
      var sw = p.querySelector('[data-lc-switch]'); if (sw) sw.setAttribute('aria-pressed', String(L.on));
      var st = p.querySelector('.lc-state'); if (st) st.innerHTML = stateLine();
      var cur = p.querySelector('[data-lc-view="current"]'); if (cur) cur.textContent = 'Current (' + L.chats.length + ')';
      var lb = p.querySelector('[data-lc-items]'); if (lb) lb.innerHTML = rows.length ? groups(rows) : empty();
      if (L.said) { A.say(p.querySelector('[data-lc-say]'), L.said, 'bad'); L.said = ''; }
      if (L.open && L.chat) paintHead();
      return;
    }
    var al = alertsLabel();
    p.innerHTML = '<div class="lc-top"><button type="button" class="lc-switch" data-lc-switch aria-pressed="' + L.on + '"><i aria-hidden="true"></i>Available for chat</button>'
      + '<p class="lc-state" role="status" aria-live="polite">' + stateLine() + '</p>'
      + (al ? '<button type="button" class="lc-alerts" data-lc-alerts>' + esc(al) + '</button>' : '') + '</div>'
      + '<p class="lc-say" data-lc-say role="status">' + esc(L.said) + '</p>'
      + '<div class="lc-grid"' + (L.open ? ' data-open="1"' : '') + '>'
      + '<div class="lc-list"><div class="lc-seg" role="group" aria-label="Which chats"><button type="button" data-lc-view="current" aria-pressed="' + (L.view === 'current') + '">Current (' + L.chats.length + ')</button><button type="button" data-lc-view="closed" aria-pressed="' + (L.view === 'closed') + '">Ended, 30 days</button></div>'
      + '<div data-lc-items>' + (rows.length ? groups(rows) : empty()) + '</div></div>'
      + '<div class="lc-chat" data-lc-chat></div></div>';
    L.said = '';
    drawChat(true);
    /* Teach the chat, under the chats (assets/admin-chat-learn.js) */
    if (window.PFAChatLearn) window.PFAChatLearn.mount(p);
  }

  function canWrite(c) { return c.status !== 'closed' && (!c.takenBy || c.mine); }
  function subLine(c) {
    var here = c.status === 'closed' ? '' : c.visitorHere ? '<span><span class="lc-dot" data-on></span> The visitor is on the page</span>' : '<span><span class="lc-dot"></span> The visitor is away' + (c.lastVisitorAt ? ', last seen ' + esc(clock(c.lastVisitorAt)) : '') + '</span>';
    var owner = c.status === 'waiting' ? 'Nobody has it yet: replying takes it.' : c.takenBy ? (c.mine ? 'Yours.' : 'With ' + esc(c.takenBy.name) + (c.ownerOnline ? '.' : ', who is offline.')) : '';
    return '<span>Started ' + esc(clock(c.createdAt)) + (c.page ? ' on <a href="/' + esc(c.page) + '" target="_blank" rel="noopener">' + esc(c.page) + '</a>' : '') + (c.lang === 'hi' ? ', in Hindi' : '') + '</span>' + here + (owner ? '<span>' + owner + '</span>' : '');
  }
  function paintHead() {
    var box = pane() && pane().querySelector('[data-lc-chat]');
    if (!box || !L.chat) return;
    var sb = box.querySelector('.lc-sub'); if (sb) sb.innerHTML = subLine(L.chat);
    var tp = box.querySelector('[data-lc-typing]'); if (tp) tp.textContent = L.chat.visitorTyping ? 'The visitor is typing…' : '';
  }
  function msgsHtml(c) {
    var out = [];
    var awayShown = false;
    (c.messages || []).forEach(function (m) {
      if (m.from !== 'visitor') awayShown = false;
      if (m.from === 'system') { out.push('<p class="lc-m lc-m--system">' + esc(m.text) + ' ' + esc(clock(m.at)) + '</p>'); return; }
      if (m.from === 'visitor') {
        if (m.away && awayShown !== (m.awayOf || true)) { out.push('<p class="lc-awayline">' + (m.awayOf ? 'Written while ' + esc(m.awayOf) + ' was offline' : 'Written while nobody was online') + '</p>'); awayShown = true; }
        if (!m.away) awayShown = false;
        else awayShown = m.awayOf || true;
        out.push('<div class="lc-m lc-m--visitor"' + (m.away ? ' data-away' : '') + '><small>Visitor, ' + esc(clock(m.at)) + '</small>' + linked(m.text) + '</div>');
        return;
      }
      var mineMsg = L.me && m.uid === L.me.uid;
      var st = m.n <= Number(c.visitorSeenN || 0) ? 'seen' : 'sent';
      out.push('<div class="lc-m lc-m--staff" data-st="' + st + '"' + (mineMsg || !m.uid ? '' : ' data-other') + '><small>' + esc(m.name || 'PFA') + ', ' + esc(clock(m.at)) + '</small>' + linked(m.text)
        + '<span class="lc-st">' + (st === 'seen' ? '✓✓ Seen' : '✓ Sent') + '</span></div>');
    });
    Object.keys(L.pending).forEach(function (k) {
      var p = L.pending[k];
      if (p.id !== c.id) return;
      out.push('<div class="lc-m lc-m--staff" data-st="' + p.st + '" data-cid="' + esc(k) + '"><small>' + esc((L.me && L.me.name) || 'You') + ', ' + esc(clock(p.at)) + '</small>' + linked(p.text)
        + '<span class="lc-st">' + (p.st === 'failed' ? 'Not sent. Tap to send again' : 'Sending') + '</span></div>');
    });
    return out.join('');
  }
  function drawChat(scrollDown) {
    var p = pane();
    var box = p && p.querySelector('[data-lc-chat]');
    if (!box) return;
    var c = L.chat;
    if (!L.open) { box.innerHTML = '<p class="lc-empty">Choose a chat to read it and reply.</p>'; return; }
    if (!c) { box.innerHTML = '<p class="lc-empty">Opening the chat.</p>'; return; }
    var log = box.querySelector('.lc-log');
    var nearBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    var ta = box.querySelector('textarea');
    if (ta && box.getAttribute('data-for') === c.id) L.drafts[c.id] = ta.value;
    var typing = ta && document.activeElement === ta;
    var writable = canWrite(c);
    var title = c.status === 'closed' ? 'Ended chat' : c.status === 'waiting' ? 'Waiting for a reply' : c.mine ? 'Your chat' : 'With ' + c.takenBy.name;
    var acts = '';
    if (c.status === 'waiting') acts += '<button type="button" class="press" data-lc-take>Take</button>';
    acts += '<button type="button" class="ghost" data-lc-copy>Copy transcript</button>';
    if (c.status !== 'closed' && (c.mine || !c.takenBy)) acts += '<button type="button" class="ghost" data-lc-close>End chat</button>';
    var foot = writable
      ? '<p class="lc-typing" data-lc-typing aria-live="polite">' + (c.visitorTyping ? 'The visitor is typing…' : '') + '</p>'
        + '<form class="lc-form" data-lc-form novalidate><textarea rows="2" maxlength="1000" placeholder="Write a reply" aria-label="Your reply"></textarea><button class="press" type="submit">Send</button><p class="lc-count" data-lc-count></p></form><p class="lc-say" data-lc-csay role="status" style="padding:0 16px"></p>'
      : c.status === 'closed'
        ? '<p class="lc-ro">This chat has ended. The visitor can start a new one from the site.</p>'
        : '<p class="lc-ro"><span>' + esc(c.takenBy.name) + (c.ownerOnline ? ' is answering this chat.' : ' had this chat and is offline now.') + '</span><button type="button" class="' + (c.ownerOnline ? 'ghost' : 'press') + '" data-lc-take="force">Take over</button></p><p class="lc-say" data-lc-csay role="status" style="padding:0 16px"></p>';
    var shape = String(writable) + c.status + (c.takenBy ? c.takenBy.uid + c.ownerOnline : '');
    if (box.getAttribute('data-for') === c.id && log && box.getAttribute('data-w') === shape) {
      /* the same chat: only the messages, the line under the title and the buttons move */
      log.innerHTML = msgsHtml(c);
      if (scrollDown || nearBottom) log.scrollTop = log.scrollHeight;
      var h3 = box.querySelector('.lc-head h3'); if (h3) h3.textContent = title;
      var ab = box.querySelector('[data-lc-acts]'); if (ab) ab.innerHTML = acts;
      paintHead();
      return;
    }
    box.setAttribute('data-for', c.id);
    box.setAttribute('data-w', shape);
    box.innerHTML = '<div class="lc-head"><button type="button" class="ghost lc-back" data-lc-back>Back to chats</button><h3>' + esc(title) + '</h3><span data-lc-acts style="display:contents">' + acts + '</span>'
      + '<p class="lc-sub">' + subLine(c) + '</p></div>'
      + '<div class="lc-log" aria-live="polite">' + msgsHtml(c) + '</div>' + foot;
    var t2 = box.querySelector('textarea');
    if (t2) { t2.value = L.drafts[c.id] || ''; if (typing) t2.focus(); }
    var log2 = box.querySelector('.lc-log');
    log2.scrollTop = log2.scrollHeight;
  }

  function transcript(c) {
    return ['PFA live chat ' + c.id + (c.page ? ', from ' + c.page : ''), ''].concat((c.messages || []).map(function (m) {
      return clock(m.at) + '  ' + (m.from === 'visitor' ? 'Visitor' : m.from === 'staff' ? (m.name || 'PFA') + ', PFA' : '*') + ': ' + m.text;
    })).join('\n');
  }

  /* ---- what can be pressed ---- */
  document.addEventListener('click', function (e) {
    var p = pane();
    if (!p || !e.target.closest || !p.contains(e.target)) return;
    if (e.target.closest('[data-lc-switch]')) return setOn(!L.on);
    if (e.target.closest('[data-lc-alerts]')) {
      if (window.Notification && Notification.permission === 'default') Notification.requestPermission().then(function () { draw(); });
      return undefined;
    }
    var v = e.target.closest('[data-lc-view]');
    if (v) { L.view = v.getAttribute('data-lc-view'); draw(); return list(); }
    var o = e.target.closest('[data-lc-open]');
    if (o) return openChat(o.getAttribute('data-lc-open'));
    if (e.target.closest('[data-lc-back]')) { L.open = ''; L.chat = null; clearTimeout(chatT); return draw(); }
    var tk = e.target.closest('[data-lc-take]');
    if (tk) return act('take', { force: tk.getAttribute('data-lc-take') === 'force' });
    if (e.target.closest('[data-lc-close]')) return act('close');
    if (e.target.closest('[data-lc-copy]') && L.chat) {
      var text = transcript(L.chat);
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'))).then(function () { say('Transcript copied.', 'good'); }, function () { say('The transcript could not be copied here.', 'bad'); });
      return undefined;
    }
    /* a reply that did not go: tap it to send it again, as the same reply */
    var f = e.target.closest('.lc-m[data-st="failed"][data-cid]');
    if (f) { var k = f.getAttribute('data-cid'); var pd = L.pending[k]; if (pd) { pd.st = 'sending'; sendReply(pd.text, false, k); } }
    return undefined;
  });
  function send(form) {
    var ta = form.querySelector('textarea');
    var text = ta.value.trim();
    if (!text || !L.chat) return;
    ta.value = '';
    L.drafts[L.open] = '';
    counter(form);
    sendReply(text, false);
    ta.focus();
  }
  function counter(form) {
    var ta = form.querySelector('textarea'); var c = form.querySelector('[data-lc-count]');
    if (c) c.textContent = ta.value.length > 850 ? (1000 - ta.value.length) + ' characters left' : '';
  }
  document.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('[data-lc-form]');
    if (!f) return;
    e.preventDefault();
    send(f);
  });
  document.addEventListener('keydown', function (e) {
    var f = e.target && e.target.closest && e.target.closest('[data-lc-form]');
    if (!f || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    send(f);
  });
  /* you are writing: the visitor sees it, said at most every three seconds */
  document.addEventListener('input', function (e) {
    var f = e.target && e.target.closest && e.target.closest('[data-lc-form]');
    if (!f) return;
    counter(f);
    if (L.open) L.drafts[L.open] = e.target.value;
    L.activeAt = Date.now();
    if (!e.target.value.trim() || Date.now() - L.typedAt < 3000 || !L.chat || !L.chat.mine) return;
    L.typedAt = Date.now();
    post({ action: 'typing', id: L.open }).catch(function () {});
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { loop(true); if (L.open && shown()) readChat(false); } });

  /* Teach the chat (assets/admin-chat-learn.js, 23 Nov 2026), loaded with
     this file so admin.html stays under its page-weight ceiling */
  if (!document.querySelector('script[data-pfa-chat-learn]')) {
    var cl = document.createElement('script');
    cl.src = 'assets/admin-chat-learn.js';
    cl.setAttribute('data-pfa-chat-learn', '');
    document.head.appendChild(cl);
  }

  window.PFALiveChat = {
    pane: function () {
      draw();
      list().then(function () { loop(false); if (L.open) readChat(false); });
    },
    watch: function () {
      L.firstList = true;
      if (remembered()) { L.on = true; beatT = setTimeout(beat, 0); tabAlive(false); }
      loop(true);
    }
  };
})();
