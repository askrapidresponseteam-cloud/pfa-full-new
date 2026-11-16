/* Live chat: answering visitors on the site's chat, from the panel
   (owner, 16 Nov 2026: "build a chat UI for admin side, where people can
   answer questions- when online.. i.e. if one asks for a person. and if the
   answer is not available in the site data", and "live chat works for main
   site user, only if someone from admin panel is online. else, ask the main
   site user to send a query").

   Available is a switch, kept in this browser. While it is on and the panel
   is open, the panel tells the server so every 25 seconds
   (/api/admin/live-chat, lib/live-chat.js); the site offers a chat only
   while someone is. Close the panel, sign out, or switch it off, and within
   75 seconds the site goes back to offering the help desk.

   While available, the panel looks for chats every 5 seconds wherever you
   are in it: the rail shows how many are waiting on a reply, the tab's
   title says so, and a new chat sounds a short tone. Replying to a waiting
   chat takes it; the visitor sees your first name, never your email.

   admin.html calls PFALiveChat.pane() for the tab 'livechat' and
   PFALiveChat.watch() once signed in. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var KEY = 'pfa.livechat.available';
  var BEAT_MS = 25000;
  var LIST_MS = 5000;
  var CHAT_MS = 3000;
  var L = { on: false, me: null, online: [], chats: [], closed: [], view: 'current', open: '', chat: null, drafts: {}, seen: {}, firstList: true, allowed: true, sending: false, said: '' };
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
    + '.lc-say{margin:0 0 12px;font-size:13px}.lc-say:empty{display:none}.lc-say[data-tone="bad"]{color:#a3251f}.lc-say[data-tone="good"]{color:#1f6b3a}'
    + '.lc-grid{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:18px;align-items:start}'
    + '.lc-list{border:1px solid var(--line);min-width:0}.lc-seg{display:flex;border-bottom:1px solid var(--line)}.lc-seg button{flex:1;height:40px;border:0;border-right:1px solid var(--line);background:none;font:inherit;font-size:13px;cursor:pointer;color:var(--ink);white-space:nowrap}.lc-seg button:last-child{border-right:0}.lc-seg button[aria-pressed="true"]{background:var(--ink);color:#fff}'
    + '.lc-item{display:block;width:100%;padding:12px 14px;border:0;border-bottom:1px solid var(--line);background:#fff;text-align:left;font:inherit;color:var(--ink);cursor:pointer}.lc-item:last-child{border-bottom:0}.lc-item[aria-current="true"]{background:#f4f3f1;box-shadow:inset 3px 0 0 var(--ink)}'
    + '@media (hover:hover){.lc-item:hover{background:#f8f7f5}}'
    + '.lc-q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0 0 6px;font-size:14px;line-height:1.45;overflow-wrap:anywhere}'
    + '.lc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin:0;font-size:12px;line-height:1.4;color:var(--muted)}'
    + '.lc-tag{display:inline-block;padding:2px 7px;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor}.lc-tag[data-s="waiting"]{color:#a3251f}.lc-tag[data-s="open"]{color:#1f6b3a}.lc-tag[data-s="closed"]{color:var(--muted)}'
    + '.lc-dot{width:8px;height:8px;border-radius:50%;background:#a3251f;flex:none}'
    + '.lc-empty{margin:0;padding:22px 16px;font-size:14px;line-height:1.5;color:var(--muted)}'
    + '.lc-chat{border:1px solid var(--line);display:flex;flex-direction:column;min-width:0;min-height:460px}'
    + '.lc-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;padding:12px 16px;border-bottom:1px solid var(--line)}.lc-head h3{margin:0;flex:1 1 200px;font-family:var(--display);font-weight:400;font-size:20px;line-height:1.25}.lc-head .ghost{flex:none}'
    + '.lc-sub{flex-basis:100%;margin:0;font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}'
    + '.lc-back{display:none}.lc-grid[data-none="1"]{grid-template-columns:minmax(0,1fr)}.lc-grid[data-none="1"] .lc-chat{display:none}'
    + '.lc-log{flex:1 1 auto;max-height:56vh;min-height:240px;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;background:#fbfaf9}'
    + '.lc-m{max-width:82%;font-size:14px;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}.lc-m small{display:block;margin:0 0 3px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:normal}'
    + '.lc-m--visitor{align-self:flex-start;padding:10px 12px;background:#fff;border:1px solid var(--line)}'
    + '.lc-m--staff{align-self:flex-end;padding:10px 12px;background:var(--ink);color:#fff}.lc-m--staff small{color:#cfcfcf}'
    + '.lc-m--system{align-self:center;max-width:100%;font-size:12px;color:var(--muted);text-align:center}'
    + '.lc-form{display:flex;gap:10px;align-items:flex-end;padding:12px 16px;border-top:1px solid var(--line)}.lc-form textarea{flex:1;min-width:0;min-height:44px;max-height:160px;padding:10px 12px;border:1px solid var(--line);font:inherit;font-size:15px;line-height:1.45;resize:vertical;background:#fff;color:var(--ink)}.lc-form textarea:focus{outline:none;border-color:var(--ink)}.lc-form .press{width:auto;flex:none;min-height:44px;padding:0 20px}'
    + '.lc-ended{margin:0;padding:14px 16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}'
    + '@media (max-width:900px){.lc-grid{grid-template-columns:minmax(0,1fr)}.lc-grid[data-open="1"] .lc-list{display:none}.lc-grid:not([data-open="1"]) .lc-chat{display:none}.lc-back{display:inline-flex}.lc-log{max-height:none;min-height:300px}.lc-m{max-width:90%}}';
  document.head.appendChild(style);

  function pane() { return document.querySelector('[data-pane="livechat"]'); }
  function remembered() { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } }
  function remember(on) { try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (_) { /* storage off */ } }
  function ago(iso) {
    var ms = Date.now() - Date.parse(iso || '');
    if (!isFinite(ms)) return '';
    if (ms < 60000) return 'just now';
    var m = Math.round(ms / 60000);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return A.dayOf ? A.dayOf(iso) : String(iso).slice(0, 10);
  }
  function clock(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var ist = new Date(d.getTime() + 330 * 60000);
    var h = ist.getUTCHours(), mm = ('0' + ist.getUTCMinutes()).slice(-2);
    return (h % 12 || 12) + ':' + mm + (h < 12 ? ' am' : ' pm');
  }
  function pageLink(page) {
    if (!page) return '';
    return 'on <a href="/' + esc(page) + '" target="_blank" rel="noopener">' + esc(page) + '</a>';
  }

  /* ---- available, and the server told so ---- */
  function beat() {
    clearTimeout(beatT);
    if (!L.on) return;
    var app = $('#app');
    if (app && app.hidden) { beatT = setTimeout(beat, BEAT_MS); return; }
    A.api('/api/admin/live-chat', { method: 'POST', body: { action: 'presence', available: true } })
      .catch(function (e) { if (e && e.denied) { L.allowed = false; L.on = false; } })
      .then(function () { if (L.on) beatT = setTimeout(beat, BEAT_MS); });
  }
  function setOn(on) {
    L.on = on;
    remember(on);
    A.api('/api/admin/live-chat', { method: 'POST', body: { action: 'presence', available: on } }).catch(function () { /* the next beat says it again */ });
    if (on) { beatT = setTimeout(beat, BEAT_MS); unlockSound(); } else clearTimeout(beatT);
    loop(true);
    draw(false);
  }
  /* going away: closing the tab, reloading, signing out */
  function away() {
    if (!L.on) return;
    A.token().then(function (t) {
      try { fetch('/api/admin/live-chat', { method: 'POST', keepalive: true, headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'presence', available: false }) }); } catch (_) { /* gone either way: it lapses in 75 seconds */ }
    }).catch(function () {});
  }
  window.addEventListener('pagehide', away);
  document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('#signout')) { away(); remember(false); } }, true);

  /* ---- a short tone for a new chat ---- */
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
    } catch (_) { /* no sound, the rail still shows it */ }
  }
  document.addEventListener('pointerdown', function once() { if (L.on) unlockSound(); }, { passive: true });

  /* ---- the list, every 5 seconds while available ---- */
  function shown() { var p = pane(); return Boolean(p && p.getAttribute('data-live') === '1' && !($('#app') || {}).hidden); }
  function loop(now) {
    clearTimeout(listT);
    if (!L.allowed) return;
    if (now) return list().then(function () { loop(false); });
    var wait = L.on ? LIST_MS : shown() ? 20000 : 0;
    if (!wait) return undefined;
    listT = setTimeout(function () { list().then(function () { loop(false); }); }, wait);
    return undefined;
  }
  function list() {
    return A.api('/api/admin/live-chat' + (L.view === 'closed' ? '?closed=1' : '')).then(function (d) {
      L.me = d.me; L.online = d.online || [];
      var fresh = (d.chats || []).filter(function (c) { return c.status === 'waiting' && !L.seen[c.id]; });
      (d.chats || []).forEach(function (c) { L.seen[c.id] = true; });
      if (fresh.length && !L.firstList) tone();
      L.firstList = false;
      L.chats = d.chats || [];
      if (L.view === 'closed') L.closed = d.closed || [];
      pip();
      /* on a wide screen, the first chat opens by itself rather than an empty half */
      if (shown() && !L.open && L.view === 'current' && L.chats.length && window.matchMedia && window.matchMedia('(min-width: 901px)').matches) { L.open = L.chats[0].id; draw(); readChat(true); return; }
      if (shown()) draw(false);
    }).catch(function (e) {
      if (e && e.denied) { L.allowed = false; L.on = false; clearTimeout(beatT); }
      if (shown()) { L.said = (e && e.message) || 'The chats could not be read.'; draw(); }
    });
  }
  function pip() {
    var n = L.chats.filter(function (c) { return c.awaiting; }).length;
    var p = $('#pipLive');
    if (p) { p.textContent = String(n); p.hidden = !n; }
    document.title = n ? '(' + n + ') Live chat waiting | ' + baseTitle.replace(/^\(\d+\) Live chat waiting \| /, '') : baseTitle;
  }

  /* ---- one chat, every 3 seconds while it is open on screen ---- */
  function openChat(id) {
    L.open = id;
    L.chat = null;
    draw();
    readChat(true);
  }
  function readChat(scrollDown) {
    clearTimeout(chatT);
    if (!L.open) return;
    var id = L.open;
    A.api('/api/admin/live-chat?id=' + encodeURIComponent(id)).then(function (d) {
      if (L.open !== id) return;
      var grew = !L.chat || (d.chat && d.chat.seq !== L.chat.seq);
      L.chat = d.chat;
      if (grew) drawChat(Boolean(scrollDown));
    }).catch(function (e) { L.said = (e && e.message) || 'That chat could not be read.'; draw(false); })
      .then(function () { if (L.open === id && shown() && L.chat && L.chat.status !== 'closed') chatT = setTimeout(function () { readChat(false); }, CHAT_MS); });
  }
  function act(action, more) {
    if (L.sending) return Promise.resolve();
    L.sending = true;
    var id = L.open;
    return A.api('/api/admin/live-chat', { method: 'POST', body: Object.assign({ action: action, id: id }, more || {}) }).then(function (d) {
      L.sending = false;
      if (L.open === id) {
        L.chat = d.chat;
        if (action === 'send') { L.drafts[id] = ''; var t0 = pane() && pane().querySelector('[data-lc-form] textarea'); if (t0) t0.value = ''; }
        drawChat(true);
      }
      list();
    }).catch(function (e) {
      L.sending = false;
      var say = pane() && pane().querySelector('[data-lc-csay]');
      if (say) A.say(say, (e && e.message) || 'That did not go. Try again.', 'bad');
    });
  }

  /* ---- drawing ---- */
  function stateLine() {
    var others = L.online.filter(function (n) { return !(L.me && L.on && n === L.me.name); });
    if (L.on) return '<b>You are available.</b> <span>Visitors who ask for a person, or whose question the site cannot answer, can chat with you.' + (others.length ? ' Also available: ' + esc(others.join(', ')) + '.' : '') + '</span>';
    return '<b>You are not available.</b> <span>' + (L.online.length ? 'Available now: ' + esc(L.online.join(', ')) + '.' : 'No one is available, so the site asks visitors to send their question to the help desk.') + '</span>';
  }
  function item(c) {
    var who = c.status === 'waiting' ? 'Started ' + ago(c.createdAt) : c.status === 'open' ? 'With ' + esc((c.takenBy || {}).name || '') + ', ' + ago(c.updatedAt) : 'Ended ' + ago(c.closedAt) + (c.closedBy === 'left' ? ', visitor left' : c.closedBy === 'visitor' ? ', by the visitor' : '');
    return '<button type="button" class="lc-item" data-lc-open="' + esc(c.id) + '"' + (c.id === L.open ? ' aria-current="true"' : '') + '>'
      + '<p class="lc-q">' + esc(c.first || c.last || '') + '</p>'
      + '<p class="lc-meta">' + (c.awaiting ? '<span class="lc-dot" aria-label="Waiting on a reply"></span>' : '')
      + '<span class="lc-tag" data-s="' + esc(c.status) + '">' + (c.status === 'waiting' ? 'Waiting' : c.status === 'open' ? 'In progress' : 'Ended') + '</span>'
      + '<span>' + who + '</span></p></button>';
  }
  /* draw(false) is the 5-second refresh: only the line, the counts and the
     list change, so a reply being written and a chat being read stay put */
  function draw(full) {
    var p = pane();
    if (!p) return;
    var rows = L.view === 'closed' ? L.closed : L.chats;
    if (full === false && p.querySelector('.lc-grid')) {
      var sw = p.querySelector('[data-lc-switch]'); if (sw) sw.setAttribute('aria-pressed', String(L.on));
      var st = p.querySelector('.lc-state'); if (st) st.innerHTML = stateLine();
      var cur = p.querySelector('[data-lc-view="current"]'); if (cur) cur.textContent = 'Current (' + L.chats.length + ')';
      var lb = p.querySelector('[data-lc-items]'); if (lb) lb.innerHTML = rows.length ? rows.map(item).join('') : empty();
      var gr = p.querySelector('.lc-grid'); if (gr && !L.open) { if (rows.length) gr.removeAttribute('data-none'); else gr.setAttribute('data-none', '1'); }
      if (L.said) { A.say(p.querySelector('[data-lc-say]'), L.said, 'bad'); L.said = ''; }
      return;
    }
    p.innerHTML = '<div class="lc-top"><button type="button" class="lc-switch" data-lc-switch aria-pressed="' + L.on + '"><i aria-hidden="true"></i>Available for chat</button>'
      + '<p class="lc-state" role="status" aria-live="polite">' + stateLine() + '</p></div>'
      + '<p class="lc-say" data-lc-say role="status">' + esc(L.said) + '</p>'
      + '<div class="lc-grid"' + (L.open ? ' data-open="1"' : rows.length ? '' : ' data-none="1"') + '>'
      + '<div class="lc-list"><div class="lc-seg" role="group" aria-label="Which chats"><button type="button" data-lc-view="current" aria-pressed="' + (L.view === 'current') + '">Current (' + L.chats.length + ')</button><button type="button" data-lc-view="closed" aria-pressed="' + (L.view === 'closed') + '">Ended, 30 days</button></div>'
      + '<div data-lc-items>' + (rows.length ? rows.map(item).join('') : empty()) + '</div></div>'
      + '<div class="lc-chat" data-lc-chat></div></div>';
    L.said = '';
    drawChat(true);
  }
  function empty() {
    if (L.view === 'closed') return '<p class="lc-empty">No chats ended in the last 30 days.</p>';
    return '<p class="lc-empty">' + (L.on ? 'No one is chatting just now. A new chat sounds a short tone and shows on the rail.' : 'Switch on Available for chat to take chats from the site.') + '</p>';
  }
  function drawChat(scrollDown) {
    var p = pane();
    var box = p && p.querySelector('[data-lc-chat]');
    if (!box) return;
    var c = L.chat;
    if (!L.open) { box.innerHTML = '<p class="lc-empty">Choose a chat to read it and reply.</p>'; return; }
    if (!c) { box.innerHTML = '<p class="lc-empty">Opening the chat.</p>'; return; }
    var log = box.querySelector('.lc-log');
    var nearBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    var ta = box.querySelector('textarea');
    if (ta) L.drafts[c.id] = ta.value;
    var typing = ta && document.activeElement === ta;
    var sub = 'Started ' + esc(clock(c.createdAt)) + ' ' + pageLink(c.page) + (c.lang === 'hi' ? ', in Hindi' : '')
      + (c.status === 'waiting' ? '. No one has taken it yet: replying takes it.' : c.takenBy ? '. With ' + esc(c.takenBy.name) + '.' : '.');
    var msgs = (c.messages || []).map(function (m) {
      if (m.from === 'system') return '<p class="lc-m lc-m--system">' + esc(m.text) + ' ' + esc(clock(m.at)) + '</p>';
      var label = m.from === 'staff' ? esc(m.name || 'PFA') + ', ' + esc(clock(m.at)) : 'Visitor, ' + esc(clock(m.at));
      return '<div class="lc-m lc-m--' + esc(m.from) + '"><small>' + label + '</small>' + esc(m.text) + '</div>';
    }).join('');
    var head = '<div class="lc-head"><button type="button" class="ghost lc-back" data-lc-back>Back to chats</button><h3>' + (c.status === 'closed' ? 'Ended chat' : c.status === 'waiting' ? 'Waiting for a reply' : 'In progress') + '</h3>'
      + (c.status !== 'closed' ? '<button type="button" class="ghost" data-lc-close>End chat</button>' : '')
      + '<p class="lc-sub">' + sub + '</p></div>';
    var foot = c.status === 'closed'
      ? '<p class="lc-ended">This chat has ended. The visitor can start a new one from the site.</p>'
      : '<form class="lc-form" data-lc-form novalidate><textarea id="lcReply" rows="2" aria-label="Your reply" maxlength="1000" placeholder="Write a reply"></textarea><button class="press" type="submit">Send</button></form><p class="lc-say" data-lc-csay role="status" style="padding:0 16px"></p>';
    if (typing && log && box.getAttribute('data-for') === c.id) {
      log.innerHTML = msgs;
      if (nearBottom) log.scrollTop = log.scrollHeight;
      var h3 = box.querySelector('.lc-head h3'); if (h3) h3.textContent = c.status === 'waiting' ? 'Waiting for a reply' : 'In progress';
      var sb = box.querySelector('.lc-sub'); if (sb) sb.innerHTML = sub;
      return;
    }
    box.setAttribute('data-for', c.id);
    box.innerHTML = head + '<div class="lc-log" aria-live="polite">' + msgs + '</div>' + foot;
    var t2 = box.querySelector('textarea');
    if (t2) t2.value = L.drafts[c.id] || '';
    var log2 = box.querySelector('.lc-log');
    if (scrollDown || nearBottom) log2.scrollTop = log2.scrollHeight;
  }

  /* ---- what can be pressed ---- */
  document.addEventListener('click', function (e) {
    var p = pane();
    if (!p || !e.target.closest || !p.contains(e.target)) return;
    if (e.target.closest('[data-lc-switch]')) return setOn(!L.on);
    var v = e.target.closest('[data-lc-view]');
    if (v) { L.view = v.getAttribute('data-lc-view'); draw(); return list(); }
    var o = e.target.closest('[data-lc-open]');
    if (o) return openChat(o.getAttribute('data-lc-open'));
    if (e.target.closest('[data-lc-back]')) { L.open = ''; L.chat = null; clearTimeout(chatT); return draw(); }
    if (e.target.closest('[data-lc-close]')) return act('close');
    return undefined;
  });
  function send(form) {
    var ta = form.querySelector('textarea');
    var text = ta.value.trim();
    if (!text) return;
    L.drafts[L.open] = text;
    act('send', { text: text }).then(function () { var t = pane() && pane().querySelector('[data-lc-form] textarea'); if (t && L.chat && L.chat.status !== 'closed') t.focus(); });
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

  window.PFALiveChat = {
    pane: function () {
      draw();
      list().then(function () { loop(false); if (L.open) readChat(false); });
    },
    watch: function () {
      L.firstList = true;
      loop(true);
      if (remembered()) { L.on = true; beatT = setTimeout(beat, 0); }
    }
  };
})();
