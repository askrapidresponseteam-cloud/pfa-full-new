/* The panel's PFA Live section: the monthly live show (owner, 26 Nov 2026,
   the plan agreed that night: our own player, comments moderated, a Q&A
   desk, the recording posted as an update, YouTube as the backup).

   In the order a show is run:
     1  The show        title, a line about it, when it starts, where the
                        picture comes from (our player through Mux, or a
                        YouTube Live link), and the comment rules
     2  Stream set-up   under +, once: the address and key for OBS, and
                        YouTube as the backup
     3  On air          Announce, Go live, End, then Post the recording
     4  The desk        questions to put on air or mark answered, comments
                        to hide, people to stop, and a reply as PFA
   Refreshes itself every five seconds while a show is announced or on.
   Reads and writes /api/admin/live (lib/routes/admin/live.js).
   admin.html calls PFALiveShow.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var URL_ = '/api/admin/live';

  var style = document.createElement('style');
  style.textContent = [
    '.lx{display:grid;gap:18px;max-width:1100px}',
    '.lx-box{display:grid;gap:14px;padding:18px;border:1px solid var(--line)}',
    '.lx-box[hidden]{display:none}',
    '.lx-box h4{margin:0;font-size:12px;letter-spacing:.14em;text-transform:uppercase}',
    '.lx-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px 14px}',
    '.lx-f{display:grid;gap:7px;min-width:0}',
    '.lx-f>span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.lx-f input[type=text],.lx-f input[type=url],.lx-f input[type=datetime-local],.lx-f input[type=password],.lx-f textarea{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:14px;color:var(--ink);border-radius:0}',
    '.lx-f textarea{min-height:70px;resize:vertical;line-height:1.5;field-sizing:content}',
    '.lx-f input:focus,.lx-f textarea:focus{outline:none;border-color:var(--ink)}',
    '.lx-radio{display:flex;flex-wrap:wrap;gap:10px 22px;font-size:14px}',
    '.lx-radio label,.lx-check{display:inline-flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.45;cursor:pointer}',
    '.lx-radio input,.lx-check input{width:18px;height:18px;margin:1px 0 0;flex:none}',
    '.lx-hint{margin:0;font-size:12.5px;line-height:1.55;color:var(--muted)}',
    '.lx-btns{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.lx-btns .press{width:auto;display:inline-flex;align-items:center;min-height:40px;padding:0 20px}',
    '.lx-plus{display:inline-flex;align-items:center;gap:8px;width:max-content;padding:0;border:0;background:none;font:inherit;font-size:12px;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;color:var(--ink)}',
    '.lx-plus i{font-style:normal;font-size:16px;line-height:1;display:inline-block;transition:transform .2s}',
    '.lx-plus[aria-expanded="true"] i{transform:rotate(45deg)}',
    '.lx-key{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center}',
    '.lx-key code{display:block;padding:10px 12px;border:1px solid var(--line);font-size:13px;overflow-wrap:anywhere;background:#faf9f7}',
    '.lx-state{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}',
    '.lx-pill{display:inline-block;padding:5px 9px 4px;font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;border:1px solid var(--line)}',
    '.lx-pill[data-s="live"]{background:#c4161c;border-color:#c4161c;color:#fff}',
    '.lx-pill[data-s="soon"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}',
    '.lx-desk{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:16px}',
    '.lx-col{display:grid;gap:10px;align-content:start;min-width:0}',
    '.lx-col h4{display:flex;justify-content:space-between;gap:8px}',
    '.lx-list{display:grid;gap:8px;max-height:560px;overflow-y:auto;padding-right:4px}',
    '.lx-msg{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line)}',
    '.lx-msg[data-s="hidden"]{opacity:.55}',
    '.lx-msg[data-on]{border-color:#c4161c;outline:1px solid #c4161c}',
    '.lx-msg p{margin:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}',
    '.lx-msg small{display:flex;flex-wrap:wrap;gap:6px 10px;font-size:11.5px;color:var(--muted)}',
    '.lx-msg .ghost{height:30px;padding:0 10px;font-size:10px}',
    '.lx-spot{padding:12px 14px;border:1px solid #c4161c;background:#f4f2ee;display:grid;gap:8px}',
    '.lx-spot p{margin:0;font-size:15px;line-height:1.5;font-weight:600;overflow-wrap:anywhere}',
    '.lx-reply{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}',
    '.lx-reply input{padding:10px 12px;border:1px solid var(--line);font:inherit;font-size:14px;min-width:0}',
    '.lx-reply .press{width:auto;padding:0 16px}',
    '.lx-err{margin:0;color:#a3251f;font-size:13px;line-height:1.5}',
    '.lx-err:empty{display:none}',
    '.lx-ok{margin:0;font-size:13px;line-height:1.5}',
    '.lx-ok:empty{display:none}'
  ].join('');
  document.head.appendChild(style);

  var S = { d: null, timer: null, open: {}, note: '', error: '', showKey: false };
  var PILL = { off: 'Off the site', soon: 'Announced', live: 'Live now', ended: 'Ended' };
  function node() { return $('[data-pane="live"]'); }
  function api(body) { return A.api(URL_, body ? { method: 'POST', body: body } : undefined); }
  function time(ms) { var t = new Date(ms); return isNaN(t) ? '' : t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function shown() { var n = node(); return n && !n.hidden && n.offsetParent !== null; }

  function pane() {
    var n = node();
    if (!n) return;
    if (!S.d) n.innerHTML = '<div class="loading">Reading the live show…</div>';
    load();
  }
  function load() {
    clearTimeout(S.timer);
    return api().then(function (d) {
      S.d = d; paint();
      var st = d.show.status;
      if (st === 'live' || st === 'soon') S.timer = setTimeout(function () { if (shown() && !busyTyping()) load(); else if (shown()) S.timer = setTimeout(load, 5000); }, 5000);
    }).catch(function (e) { var n = node(); if (n && !S.d) A.fail(n, e); });
  }
  /* a refresh never wipes what someone is typing */
  function busyTyping() { var a = document.activeElement; var n = node(); return !!(a && n && n.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value); }

  function radio(name, value, label, on, off) { return '<label><input type="radio" name="' + name + '" value="' + value + '"' + (on ? ' checked' : '') + (off ? ' disabled' : '') + '>' + esc(label) + '</label>'; }
  function plus(id, label) { var o = !!S.open[id]; return '<button class="lx-plus" type="button" data-lx="toggle" aria-controls="' + id + '" aria-expanded="' + o + '"><i aria-hidden="true">+</i>' + esc(label) + '</button>'; }

  function paint() {
    var n = node(), d = S.d;
    if (!n || !d) return;
    var s = d.show, m = d.mux, out = ['<div class="lx">'];
    /* where things stand, and the one next step */
    out.push('<div class="lx-box"><div class="lx-state"><span class="lx-pill" data-s="' + esc(s.status) + '">' + esc(PILL[s.status] || 'Off the site') + '</span>'
      + '<b style="font-size:16px;overflow-wrap:anywhere">' + esc(s.title || 'No show set up yet') + '</b>'
      + (s.status === 'live' ? '<a href="' + (/(\.web\.app|\.firebaseapp\.com)$/.test(location.hostname) ? 'https://peopleforanimalsindia.org/' : '/') + 'live.html" target="_blank" rel="noopener" class="lx-hint">Open the page</a>' : '') + '</div>'
      + '<div class="lx-btns">'
      + (s.title && s.status !== 'live' && s.status !== 'soon' ? '<button class="ghost" type="button" data-lx="status" data-s="soon">Announce on the home page</button>' : '')
      + (s.title && s.status !== 'live' ? '<button class="press" type="button" data-lx="status" data-s="live">Go live</button>' : '')
      + (s.status === 'live' ? '<button class="press" type="button" data-lx="status" data-s="ended">End the show</button>' : '')
      + (s.status === 'ended' && !s.posted ? '<button class="press" type="button" data-lx="post">Post the recording to the Newsroom</button>' : '')
      + (s.status === 'ended' && s.posted ? '<span class="lx-hint">The recording is posted in Updates.</span>' : '')
      + (s.status === 'soon' || s.status === 'ended' ? '<button class="ghost" type="button" data-lx="status" data-s="off">Take off the site</button>' : '')
      + '</div>'
      + (s.status === 'live' && s.source === 'mux' ? '<p class="lx-hint">Start streaming from OBS first, then press Go live. The page shows the picture as soon as it arrives.</p>' : '')
      + '<p class="lx-ok" role="status">' + esc(S.note) + '</p><p class="lx-err" role="alert">' + esc(S.error) + '</p></div>');

    /* 1 the show */
    var src = s.source || (m.ready ? 'mux' : 'youtube');
    out.push(plus('lxShow', s.title ? 'The show’s details' : 'Set up the show'));
    out.push('<div class="lx-box" id="lxShow"' + (S.open.lxShow || !s.title ? '' : ' hidden') + '>'
      + '<div class="lx-row"><label class="lx-f"><span>Title</span><input type="text" id="lxTitle" maxlength="80" value="' + esc(s.title) + '" placeholder="Maneka ki Baat"></label>'
      + '<label class="lx-f"><span>Starts at</span><input type="datetime-local" id="lxStarts" value="' + esc(s.startsAt) + '"></label></div>'
      + '<label class="lx-f"><span>A line about it</span><textarea id="lxAbout" maxlength="300" placeholder="What this month’s show is about">' + esc(s.about) + '</textarea></label>'
      + '<div class="lx-f"><span>Picture</span><div class="lx-radio">' + radio('lxSrc', 'mux', 'Our own player (Mux)', src === 'mux', !m.ready) + radio('lxSrc', 'youtube', 'YouTube Live link', src === 'youtube') + '</div>'
      + (m.ready ? '' : '<p class="lx-hint">Our own player needs the Mux keys on the server. Until then, use a YouTube Live link.</p>') + '</div>'
      + '<label class="lx-f" id="lxYtWrap"' + (src === 'youtube' ? '' : ' hidden') + '><span>YouTube Live link</span><input type="url" id="lxYt" value="' + (s.youtubeId ? 'https://youtu.be/' + esc(s.youtubeId) : '') + '" placeholder="https://youtube.com/live/…"></label>'
      + '<label class="lx-check"><input type="checkbox" id="lxQs"' + (s.questions ? ' checked' : '') + '><span>Take questions from viewers</span></label>'
      + '<label class="lx-check"><input type="checkbox" id="lxHold"' + (s.approveFirst ? ' checked' : '') + '><span>Hold every comment until someone here shows it</span></label>'
      + '<p class="lx-hint">Comments with bad words are always held. Questions always come here first.</p>'
      + '<div class="lx-btns"><button class="press" type="button" data-lx="setup">Save the show</button></div></div>');

    /* 2 stream set-up */
    out.push(plus('lxMux', 'Stream set-up for our own player'));
    var keyLine = m.streamKey ? (S.showKey ? esc(m.streamKey) : '••••••••••••') : '';
    out.push('<div class="lx-box" id="lxMux"' + (S.open.lxMux ? '' : ' hidden') + '>'
      + (!m.ready ? '<p class="lx-hint">Add the Mux keys to the server first: they go in with the next deploy command, as PFA_SET_MUX_TOKEN_ID and PFA_SET_MUX_TOKEN_SECRET. Mux charges per minute; a 30 minute show a month costs about ₹100.</p>'
        : !m.streamId ? '<p class="lx-hint">Made once, used every month: one address and key for OBS.</p><div class="lx-btns"><button class="press" type="button" data-lx="mux">Make the stream</button></div>'
        : '<p class="lx-hint">In OBS: Settings, Stream, Service: Custom. Keep the key private: anyone with it can broadcast on this page.</p>'
          + '<div class="lx-f"><span>Server</span><div class="lx-key"><code>' + esc(m.server) + '</code><button class="ghost" type="button" data-lx="copy" data-v="' + esc(m.server) + '">Copy</button><span></span></div></div>'
          + '<div class="lx-f"><span>Stream key</span><div class="lx-key"><code>' + keyLine + '</code><button class="ghost" type="button" data-lx="copy" data-v="' + esc(m.streamKey) + '">Copy</button><button class="ghost" type="button" data-lx="showkey">' + (S.showKey ? 'Hide' : 'Show') + '</button></div></div>'
          + '<p class="lx-hint">' + (m.simulcast ? 'YouTube is set as the backup: the show goes out there too.' : 'YouTube as the backup: in YouTube Studio, Go live, Stream, copy its stream URL and key here.') + '</p>'
          + (m.simulcast ? '' : '<div class="lx-row"><label class="lx-f"><span>YouTube stream URL</span><input type="text" id="lxYtServer" placeholder="rtmp://a.rtmp.youtube.com/live2"></label>'
            + '<label class="lx-f"><span>YouTube stream key</span><input type="password" id="lxYtKey" autocomplete="off"></label></div>'
            + '<div class="lx-btns"><button class="ghost" type="button" data-lx="mux" data-yt="1">Add YouTube as the backup</button></div>'))
      + '</div>');

    /* 4 the desk */
    if (s.session && (s.status === 'live' || s.status === 'soon' || s.status === 'ended')) {
      var qs = d.messages.filter(function (x) { return x.type === 'question' && x.status !== 'hidden'; });
      var cs = d.messages.filter(function (x) { return x.type === 'comment'; });
      var on = s.spotlight && s.spotlight.id;
      out.push('<div class="lx-box"><h4>The desk</h4>');
      if (s.spotlight) out.push('<div class="lx-spot"><span class="lx-hint">On air, under the picture: ' + esc(s.spotlight.name) + '</span><p>' + esc(s.spotlight.text) + '</p><div class="lx-btns"><button class="ghost" type="button" data-lx="mod" data-a="clear">Take off air</button></div></div>');
      out.push('<div class="lx-desk"><div class="lx-col"><h4><span>Questions</span><span class="lx-hint">' + qs.filter(function (x) { return !x.answered; }).length + ' open</span></h4><div class="lx-list">');
      if (!qs.length) out.push('<p class="lx-hint">Questions from viewers come here.</p>');
      qs.sort(function (a, b) { return (a.answered ? 1 : 0) - (b.answered ? 1 : 0) || a.at - b.at; }).forEach(function (x) {
        out.push('<div class="lx-msg"' + (on === x.id ? ' data-on' : '') + '><p>' + esc(x.text) + '</p><small><b>' + esc(x.name) + '</b><span>' + time(x.at) + '</span>' + (x.answered ? '<span>Answered</span>' : '') + '</small>'
          + '<div class="lx-btns">' + (on === x.id ? '' : '<button class="ghost" type="button" data-lx="mod" data-a="spotlight" data-id="' + esc(x.id) + '">Put on air</button>')
          + '<button class="ghost" type="button" data-lx="mod" data-a="answered" data-id="' + esc(x.id) + '">' + (x.answered ? 'Not answered' : 'Answered') + '</button>'
          + '<button class="ghost" type="button" data-lx="mod" data-a="hide" data-id="' + esc(x.id) + '">Hide</button>'
          + '<button class="ghost danger" type="button" data-lx="mod" data-a="block" data-id="' + esc(x.id) + '">Stop this person</button></div></div>');
      });
      out.push('</div></div><div class="lx-col"><h4><span>Comments</span><span class="lx-hint">' + cs.filter(function (x) { return x.status === 'held'; }).length + ' held</span></h4>'
        + '<div class="lx-reply"><input type="text" id="lxReply" maxlength="280" placeholder="Post a comment as PFA" aria-label="Post a comment as PFA"><button class="press" type="button" data-lx="mod" data-a="reply">Post</button></div><div class="lx-list">');
      if (!cs.length) out.push('<p class="lx-hint">Comments come here as they are posted.</p>');
      cs.forEach(function (x) {
        out.push('<div class="lx-msg" data-s="' + esc(x.status) + '"><p>' + esc(x.text) + '</p><small><b>' + esc(x.name) + '</b><span>' + time(x.at) + '</span>'
          + (x.status === 'held' ? '<span>Held' + (x.held ? ': a word in it' : '') + '</span>' : x.status === 'hidden' ? '<span>Hidden</span>' : '') + '</small>'
          + (x.pfa ? '' : '<div class="lx-btns">' + (x.status === 'shown' ? '<button class="ghost" type="button" data-lx="mod" data-a="hide" data-id="' + esc(x.id) + '">Hide</button>' : '<button class="ghost" type="button" data-lx="mod" data-a="show" data-id="' + esc(x.id) + '">Show</button>')
            + '<button class="ghost" type="button" data-lx="mod" data-a="spotlight" data-id="' + esc(x.id) + '">Put on air</button>'
            + '<button class="ghost danger" type="button" data-lx="mod" data-a="block" data-id="' + esc(x.id) + '">Stop this person</button></div>') + '</div>');
      });
      out.push('</div></div></div></div>');
    }
    out.push('</div>');
    var keep = document.activeElement && document.activeElement.id;
    n.innerHTML = out.join('');
    if (keep && document.getElementById(keep)) try { document.getElementById(keep).focus(); } catch (e) { /* fine */ }
  }

  function act(body, ok) {
    S.error = ''; S.note = '';
    return api(body).then(function (r) { S.note = ok ? ok(r) : ''; return load(); })
      .catch(function (e) { S.error = (e && e.message) || 'That did not go through.'; paint(); });
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  document.addEventListener('change', function (e) {
    if (!node() || !node().contains(e.target)) return;
    if (e.target.name === 'lxSrc') { var w = document.getElementById('lxYtWrap'); if (w) w.hidden = e.target.value !== 'youtube'; }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-lx]');
    if (!b || !node() || !node().contains(b)) return;
    var a = b.getAttribute('data-lx');
    if (a === 'toggle') {
      var id = b.getAttribute('aria-controls'), box = document.getElementById(id), o = b.getAttribute('aria-expanded') !== 'true';
      S.open[id] = o; if (box) box.hidden = !o; b.setAttribute('aria-expanded', o ? 'true' : 'false');
    } else if (a === 'setup') {
      var srcEl = document.querySelector('input[name=lxSrc]:checked');
      act({ action: 'setup', title: val('lxTitle'), about: val('lxAbout'), startsAt: val('lxStarts'), source: srcEl ? srcEl.value : 'youtube',
        youtube: val('lxYt'), questions: document.getElementById('lxQs').checked, approveFirst: document.getElementById('lxHold').checked },
        function () { S.open.lxShow = false; return 'The show is saved.'; });
    } else if (a === 'mux') {
      b.disabled = true;
      act(b.getAttribute('data-yt') ? { action: 'mux', ytServer: val('lxYtServer').trim(), ytKey: val('lxYtKey').trim() } : { action: 'mux' },
        function (r) { return r.simulcast ? 'The stream is ready, with YouTube as the backup.' : 'The stream is ready.'; });
    } else if (a === 'status') {
      var st = b.getAttribute('data-s');
      if (st === 'ended' && !confirm('End the show for everyone watching?')) return;
      if (st === 'live' && !confirm('Go live now? The home page says Live now and comments open.')) return;
      b.disabled = true;
      act({ action: 'status', status: st }, function () { return { soon: 'Announced on the home page.', live: 'You are live.', ended: 'The show has ended.', off: 'Taken off the site.' }[st]; });
    } else if (a === 'post') {
      b.disabled = true;
      act({ action: 'post' }, function () { return 'The recording is in the Newsroom and on the home page.'; });
    } else if (a === 'mod') {
      var what = b.getAttribute('data-a');
      if (what === 'block' && !confirm('Stop this person posting, and hide everything they posted in this show?')) return;
      var body = { action: 'moderate', act: what, id: b.getAttribute('data-id') };
      if (what === 'reply') { body.text = val('lxReply'); if (!body.text.trim()) return; }
      b.disabled = true;
      act(body, function () { return what === 'block' ? 'Stopped. Their messages are hidden.' : ''; });
    } else if (a === 'copy') {
      var v = b.getAttribute('data-v');
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); });
    } else if (a === 'showkey') { S.showKey = !S.showKey; paint(); }
  });

  window.PFALiveShow = { pane: pane };
})();
