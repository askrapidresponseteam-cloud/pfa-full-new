/* The Wall: every film sent from wall.html, to watch and put on the wall
   (owner, 4 Nov 2026: "admin panel does not have section to review wall
   submissions!").

   Waiting first: films not yet decided. Each card shows the film's picture
   (YouTube) or its platform, who it is credited to, which wall it was sent
   for and when, and whether it can play on the wall at all: the wall plays
   YouTube and Vimeo only (lib/routes/wall.js), so an Instagram or Facebook
   post is marked, and cannot be put on (the server refuses it too). Put on
   the wall and Take off the wall use the case action the submission's own
   page uses (lib/routes/admin/case.js, action 'wall'); Not for the wall
   marks it handled, so it leaves Waiting. Reply writes to the sender from
   the card itself (owner, 4 Nov 2026: "admin should be able to reply to wall
   submissions from the same space"): the same reply the submission's own
   page sends, in its email thread, kept on the case, never sent twice for
   one press. Open shows the whole submission and the conversation.

   admin.html calls PFAWall.pane() for the tab 'wall'. The pane itself is
   made here, so the panel page stays within its size. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var W = { rows: [], view: 'waiting', wall: '', loading: false, said: '', open: {}, drafts: {}, req: {}, notes: {} };
  var DONE = /^(handled|closed|rejected|spam|removed|declined)$/;

  var main = document.querySelector('[data-pane="submissions"]');
  if (main && !document.querySelector('[data-pane="wall"]')) {
    var node = document.createElement('div');
    node.className = 'pane';
    node.setAttribute('data-pane', 'wall');
    node.setAttribute('role', 'region');
    node.setAttribute('aria-label', 'The Wall');
    main.parentNode.insertBefore(node, main.nextSibling);
  }

  var style = document.createElement('style');
  style.textContent = '.wl-line{margin:0 0 12px;font-size:14px}.wl-tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 16px}'
    + '.wl-seg{display:inline-flex;border:1px solid var(--line)}.wl-seg button{height:38px;padding:0 14px;border:0;border-right:1px solid var(--line);background:none;font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}.wl-seg button:last-child{border-right:0}.wl-seg button[aria-pressed="true"]{background:var(--ink);color:var(--paper,#fff)}'
    + '.wl-seg button{white-space:nowrap}@media (max-width:560px){.wl-seg{display:grid;grid-template-columns:1fr 1fr;width:100%}.wl-seg button{border-bottom:1px solid var(--line)}.wl-seg button:nth-child(2n){border-right:0}.wl-seg button:nth-last-child(-n+2){border-bottom:0}}'
    + '.wl-tools select{height:38px;padding:0 11px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink)}'
    + '.wl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px;align-items:start}'
    + '.wl-card{border:1px solid var(--line);display:flex;flex-direction:column;background:var(--paper,#fff)}'
    + '.wl-pic{position:relative;aspect-ratio:16/9;background:#111;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;letter-spacing:.08em;text-transform:uppercase;overflow:hidden}'
    + '.wl-pic img{width:100%;height:100%;object-fit:cover;display:block}'
    + '.wl-tag{position:absolute;left:10px;top:10px;padding:4px 8px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:#fff;color:#111}'
    + '.wl-tag[data-on="1"]{background:#1f6b3a;color:#fff}'
    + '.wl-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px;flex:1}'
    + '.wl-body h4{margin:0;font-family:var(--display);font-weight:400;font-size:19px;line-height:1.25;overflow-wrap:anywhere}'
    + '.wl-meta{margin:0;font-size:13px;line-height:1.5;color:var(--muted)}.wl-note{margin:2px 0 0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}'
    + '.wl-warn{margin:4px 0 0;font-size:13px;line-height:1.5;color:#a3251f}'
    + '.wl-acts{display:flex;flex-wrap:wrap;gap:10px;margin-top:auto;padding-top:12px}.wl-acts .press,.wl-acts .ghost{width:auto;margin:0;min-height:38px;padding:0 14px;font-size:11px}'
    + '.wl-acts a.ghost{text-decoration:none;color:var(--ink)}'
    + '.wl-reply{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;display:grid;gap:10px}.wl-reply label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.wl-reply textarea{width:100%;min-height:120px;padding:10px 12px;border:1px solid var(--line);font:inherit;font-size:14px;line-height:1.5;resize:vertical;background:var(--paper,#fff);color:var(--ink)}.wl-reply select{height:38px;padding:0 10px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink);max-width:100%}.wl-reply .wl-to{margin:0;font-size:13px;color:var(--muted);overflow-wrap:anywhere}.wl-rsay{margin:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}.wl-rsay:empty{display:none}.wl-rsay[data-tone="good"]{color:#1f6b3a}.wl-rsay[data-tone="bad"]{color:#a3251f}'
    + '.wl-say{margin:0 0 12px;font-size:13px}.wl-say:empty{display:none}.wl-say[data-tone="good"]{color:#1f6b3a}.wl-say[data-tone="bad"]{color:#a3251f}';
  document.head.appendChild(style);

  /* what the wall can play: the same rule as lib/routes/wall.js playable() */
  function source(url) {
    var u;
    try { u = new URL(url); } catch (_) { return { kind: 'link', play: false }; }
    var host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') { var id = u.pathname.slice(1).split('/')[0]; return { kind: 'YouTube', play: Boolean(id), yt: id }; }
    if (host === 'youtube.com' || /\.youtube\.com$/.test(host)) {
      var v = u.searchParams.get('v') || ((/\/(embed|shorts|live)\/([\w-]+)/.exec(u.pathname) || [])[2]);
      return { kind: 'YouTube', play: Boolean(v), yt: v || '' };
    }
    if (host === 'vimeo.com' || /\.vimeo\.com$/.test(host)) return { kind: 'Vimeo', play: /\/\d+/.test(u.pathname) };
    if (/(^|\.)instagram\.com$/.test(host)) return { kind: 'Instagram', play: false };
    if (/(^|\.)facebook\.com$/.test(host) || host === 'fb.watch') return { kind: 'Facebook', play: false };
    return { kind: 'link', play: false };
  }
  function onWall(r) { return Boolean(r.onWall); }
  function waiting(r) { return !onWall(r) && !DONE.test(r.status || ''); }
  function wallOf(r) { return /short/i.test(String((r.fields || {}).wall || '')) ? 'short' : 'long'; }
  function day(v) { var d = new Date(v || ''); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }

  function readAll(cursor, out) {
    return A.api('/api/admin/records?type=submissions&kind=PFA-S&limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
      out = out.concat(d.rows || []);
      return d.cursor && out.length < 600 ? readAll(d.cursor, out) : out;
    });
  }

  function shown() {
    return W.rows.filter(function (r) {
      if (r.status === 'removed') return false;
      if (W.wall && wallOf(r) !== W.wall) return false;
      if (W.view === 'waiting') return waiting(r);
      if (W.view === 'on') return onWall(r);
      if (W.view === 'not') return !onWall(r) && !waiting(r);
      return true;
    });
  }

  /* ready starts for a reply, edited before it goes: the film ones and the
     ones that fit anything, from the one list (assets/admin-replies.js) */
  var R = window.PFAReplies;
  function newRequestId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return 'wall-' + Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function replyBox(r) {
    var f = r.fields || {};
    if (!f.email) return '<div class="wl-reply"><p class="wl-to">No email was given' + (f.mobile ? '. Call ' + esc(f.mobile) + ' and add a note on the submission.' : ' with this film.') + '</p></div>';
    var note = W.notes[r.reference] || {};
    return '<div class="wl-reply">'
      + '<p class="wl-to">To ' + esc(f.email) + '. They can answer, and their answer comes to the submission.</p>'
      + (R ? '<select data-wl-start aria-label="Start from a ready reply">' + R.options(r.reference) + '</select>' : '')
      + '<label for="wlr-' + esc(r.reference) + '">Your reply</label>'
      + '<textarea id="wlr-' + esc(r.reference) + '" data-wl-text maxlength="4000" placeholder="Write to ' + esc(f.name || 'the sender') + '">' + esc(W.drafts[r.reference] || '') + '</textarea>'
      + '<div class="wl-acts" style="padding-top:0"><button class="press" type="button" data-wl-send>Send reply</button><button class="ghost" type="button" data-wl-reply>Cancel</button></div>'
      + '<p class="wl-rsay" role="status" aria-live="polite"' + (note.tone ? ' data-tone="' + note.tone + '"' : '') + '>' + esc(note.text || '') + '</p>'
      + '</div>';
  }

  function card(r) {
    var f = r.fields || {};
    var s = source(f.url);
    var on = onWall(r);
    var pic = s.yt ? '<img src="https://i.ytimg.com/vi/' + encodeURIComponent(s.yt) + '/hqdefault.jpg" alt="" loading="lazy">' : '<span>' + esc(s.kind) + '</span>';
    var status = r.awaitingReply ? 'Wrote back' : on ? 'On the wall' : waiting(r) ? 'Waiting' : 'Not for the wall';
    var replies = Number(r.replyCount) || 0;
    return '<article class="wl-card" data-wl="' + esc(r.reference) + '">'
      + '<div class="wl-pic">' + pic + '<span class="wl-tag" data-on="' + (on ? 1 : 0) + '">' + esc(status) + '</span></div>'
      + '<div class="wl-body"><h4>' + esc(f.title || f.name || r.reference) + '</h4>'
      + '<p class="wl-meta">' + esc([f.name ? 'Credit: ' + f.name : '', wallOf(r) === 'short' ? 'Short wall, under a minute' : 'Long wall, over three minutes', day(r.createdAt), s.kind].filter(Boolean).join(' · ')) + '</p>'
      + (f.note ? '<p class="wl-note">' + esc(f.note) + '</p>' : '')
      + (replies || r.awaitingReply ? '<p class="wl-meta">' + esc([replies ? replies + (replies === 1 ? ' reply sent' : ' replies sent') : '', r.awaitingReply ? 'they wrote back: Open to read it' : ''].filter(Boolean).join(' \u00b7 ')) + '</p>' : '')
      + (s.play ? '' : '<p class="wl-warn">' + esc(s.kind === 'link' ? 'This link cannot play on the wall.' : s.kind + ' posts cannot play on the wall. Ask the sender for a YouTube or Vimeo link.') + '</p>')
      + '<div class="wl-acts">'
      + (f.url ? '<a class="ghost" href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">Watch</a>' : '')
      + (on ? '<button class="ghost" type="button" data-wl-put="0">Take off the wall</button>'
        : (s.play ? '<button class="press" type="button" data-wl-put="1">Put on the wall</button>' : ''))
      + (!on && waiting(r) ? '<button class="ghost" type="button" data-wl-no>Not for the wall</button>' : '')
      + '<button class="ghost" type="button" data-wl-reply aria-expanded="' + Boolean(W.open[r.reference]) + '">Reply</button>'
      + '<button class="ghost" type="button" data-open-case="' + esc(r.reference) + '">Open</button>'
      + '</div>' + (W.open[r.reference] ? replyBox(r) : '') + '</div></article>';
  }

  function paint() {
    var node = $('[data-pane="wall"]');
    if (!node) return;
    var all = W.rows.filter(function (r) { return r.status !== 'removed'; });
    var n = { waiting: all.filter(waiting).length, on: all.filter(onWall).length };
    n.not = all.length - n.waiting - n.on;
    var rows = shown();
    var seg = [['waiting', 'Waiting ' + n.waiting], ['on', 'On the wall ' + n.on], ['not', 'Not for the wall ' + n.not], ['all', 'All ' + all.length]];
    node.innerHTML = '<p class="wl-line"><b>' + all.length + (all.length === 1 ? ' film sent' : ' films sent') + '</b> from The Wall page. Watch each one; put the good ones on the wall.</p>'
      + '<div class="wl-tools"><div class="wl-seg" role="group" aria-label="Show">' + seg.map(function (x) { return '<button type="button" data-wl-view="' + x[0] + '" aria-pressed="' + (W.view === x[0]) + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>'
      + '<select data-wl-wall aria-label="Which wall"><option value="">Both walls</option><option value="long"' + (W.wall === 'long' ? ' selected' : '') + '>Long wall</option><option value="short"' + (W.wall === 'short' ? ' selected' : '') + '>Short wall</option></select></div>'
      + '<p class="wl-say" data-wl-say role="status" aria-live="polite"></p>'
      + (rows.length ? '<div class="wl-grid">' + rows.map(card).join('') + '</div>'
        : '<div class="empty"><b>' + (W.view === 'waiting' ? 'Nothing waiting' : 'Nothing here') + '</b>' + (W.view === 'waiting' ? 'Every film sent has been looked at.' : 'Choose another view.') + '</div>');
    if (W.said) { var s = node.querySelector('[data-wl-say]'); s.textContent = W.said; s.setAttribute('data-tone', W.tone || 'good'); }
    var pip = document.getElementById('pipWall');
    if (pip) { pip.textContent = n.waiting; pip.hidden = !n.waiting; }
  }

  function pane() {
    var node = $('[data-pane="wall"]');
    if (!node || W.loading) return;
    W.loading = true;
    node.innerHTML = '<div class="loading">Reading the films…</div>';
    readAll('', []).then(function (rows) { W.rows = rows; W.loading = false; paint(); }).catch(function (e) {
      W.loading = false;
      node.innerHTML = '<div class="empty"><b>Nothing to show</b>' + esc(e.message) + '</div>';
    });
  }

  function rowOf(ref) { return W.rows.filter(function (r) { return r.reference === ref; })[0]; }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-pane="wall"] [data-wl-view], [data-pane="wall"] [data-wl-put], [data-pane="wall"] [data-wl-no], [data-pane="wall"] [data-wl-reply], [data-pane="wall"] [data-wl-send]');
    if (!t) return;
    if (t.hasAttribute('data-wl-view')) { W.view = t.getAttribute('data-wl-view'); W.said = ''; paint(); return; }
    var ref = t.closest('[data-wl]').getAttribute('data-wl');
    var r = rowOf(ref);
    if (!r) return;
    if (t.hasAttribute('data-wl-reply')) {
      W.open[ref] = !W.open[ref];
      if (W.open[ref] && !W.req[ref]) W.req[ref] = newRequestId();
      paint();
      var box = W.open[ref] && document.getElementById('wlr-' + ref);
      if (box) box.focus();
      return;
    }
    if (t.hasAttribute('data-wl-send')) {
      var text = String(W.drafts[ref] || '').trim();
      if (!text) { W.notes[ref] = { text: 'Write the reply first.', tone: 'bad' }; paint(); return; }
      if (R && R.blanks.test(text)) { W.notes[ref] = { text: 'Fill in the part in square brackets first.', tone: 'bad' }; paint(); return; }
      t.disabled = true;
      W.notes[ref] = { text: 'Sending\u2026' };
      var el = t.closest('.wl-reply').querySelector('.wl-rsay'); el.textContent = 'Sending\u2026'; el.removeAttribute('data-tone');
      A.api('/api/admin/case', { method: 'POST', body: { reference: ref, action: 'reply', text: text, requestId: W.req[ref] || (W.req[ref] = newRequestId()) } }).then(function (d) {
        /* a second press answered after the first went: nothing more to say */
        if (d && d.duplicate) { if (W.open[ref]) { W.notes[ref] = { text: d.message, tone: 'good' }; paint(); } return; }
        r.replyCount = (Number(r.replyCount) || 0) + 1;
        r.awaitingReply = false;
        if (d && d.status) r.status = d.status;
        W.drafts[ref] = ''; W.req[ref] = ''; W.open[ref] = false; W.notes[ref] = {};
        W.said = 'Reply sent to ' + ((d && d.to) || (r.fields || {}).email) + '.'; W.tone = 'good';
        paint();
      }).catch(function (err) {
        /* kept, so it can be sent again with the same request: never twice */
        W.notes[ref] = { text: err.message || 'The reply did not go. Try again.', tone: 'bad' };
        paint();
      });
      return;
    }
    t.disabled = true;
    var body = t.hasAttribute('data-wl-no')
      ? { reference: ref, action: 'status', status: 'handled', note: 'Not for the wall' }
      : { reference: ref, action: 'wall', published: t.getAttribute('data-wl-put') === '1' };
    A.api('/api/admin/case', { method: 'POST', body: body }).then(function (d) {
      if (body.action === 'wall') { r.onWall = body.published; W.said = body.published ? 'On the wall: ' + ((r.fields || {}).title || (r.fields || {}).name || ref) + '. It shows there within a minute.' : 'Taken off the wall.'; }
      else { r.status = (d && d.status) || 'handled'; W.said = 'Marked not for the wall.'; }
      W.tone = 'good';
      paint();
    }).catch(function (err) {
      W.said = err.message || 'That did not go through.'; W.tone = 'bad';
      paint();
    });
  });
  document.addEventListener('change', function (e) {
    if (!e.target || !e.target.hasAttribute) return;
    if (e.target.hasAttribute('data-wl-wall')) { W.wall = e.target.value; paint(); return; }
    if (e.target.hasAttribute('data-wl-start')) {
      var ref = e.target.closest('[data-wl]').getAttribute('data-wl');
      var pick = R && R.pick(ref, e.target.value);
      if (!pick) return;
      W.drafts[ref] = pick[2];
      var box = document.getElementById('wlr-' + ref);
      if (box) { box.value = pick[2]; box.focus(); R.toBlank(box); }
      e.target.value = '';
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-wl-text')) W.drafts[e.target.closest('[data-wl]').getAttribute('data-wl')] = e.target.value;
  });

  /* the count of films waiting shows on the rail, once signed in */
  function count() { readAll('', []).then(function (rows) { W.rows = rows; var w = rows.filter(function (r) { return r.status !== 'removed' && waiting(r); }).length; var pip = document.getElementById('pipWall'); if (pip) { pip.textContent = w; pip.hidden = !w; } }).catch(function () {}); }
  var app = document.getElementById('app');
  if (app) {
    var done = false;
    new MutationObserver(function () { if (!done && !app.hidden) { done = true; count(); } }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  }

  window.PFAWall = { pane: pane, source: source };
})();
