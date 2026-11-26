/* PFA Live on live.html (26 Nov 2026): the show, the question on air, the
 * comments, and the forms to comment and to ask.
 *
 * Asks /api/live (lib/routes/live.js) every four seconds while the show is
 * on and the tab is open, every twenty while it is not; the answer is
 * cached at the edge for three seconds, so a full house costs the server
 * the same as one viewer.
 *
 * The picture:
 *   mux      our own player: a <video> fed by hls.js (Safari plays the
 *            stream as it is), at whatever quality the connection carries,
 *            with play, sound, back to live and full screen
 *   youtube  YouTube's player, in its privacy-enhanced frame
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-live]');
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var ICON = {
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z"/></svg>',
    on: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 5c1.2 1.6 1.2 4.4 0 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    off: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 6l4 4M15 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    full: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h5v2H3v3H1zM10 1h5v5h-2V3h-3zM1 10h2v3h3v2H1zM13 10h2v5h-5v-2h3z"/></svg>'
  };

  /* who is posting: a random number this browser keeps, never a person */
  var cid = '';
  try { cid = localStorage.getItem('pfa:live:cid') || ''; } catch (e) { /* private mode */ }
  if (!/^[a-f0-9]{32}$/.test(cid)) {
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    cid = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    try { localStorage.setItem('pfa:live:cid', cid); } catch (e) { /* kept for this visit only */ }
  }
  var savedName = '';
  try { savedName = localStorage.getItem('pfa:live:name') || ''; } catch (e) { /* none */ }
  if (savedName) { $('lvNameC').value = savedName; $('lvNameQ').value = savedName; }

  var S = { show: null, key: '', seen: {}, mine: [], timer: null, hls: null };

  /* ---------- the picture ---------- */
  function card(big, small, clock) {
    var c = $('lvCard');
    if (!c) {
      c = document.createElement('div'); c.className = 'lv-card'; c.id = 'lvCard';
      $('lvPlayer').appendChild(c);
    }
    c.innerHTML = '<p class="lv-card__big"></p>' + (clock ? '<p class="lv-card__clock" id="lvClock"></p>' : '') + '<p class="lv-card__small"></p>';
    c.querySelector('.lv-card__big').textContent = big;
    c.querySelector('.lv-card__small').textContent = small;
    c.hidden = false;
  }
  function clearPlayer() {
    if (S.hls) { try { S.hls.destroy(); } catch (e) { /* gone */ } S.hls = null; }
    var p = $('lvPlayer');
    Array.prototype.slice.call(p.children).forEach(function (n) { if (n.id !== 'lvCard') p.removeChild(n); });
  }
  function withHls(cb) {
    if (window.Hls) return cb(window.Hls);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'; s.async = true;
    s.onload = function () { cb(window.Hls || null); }; s.onerror = function () { cb(null); };
    document.head.appendChild(s);
  }

  function youtube(id) {
    clearPlayer();
    var f = document.createElement('iframe');
    var embed = 'https://www.youtube-nocookie.com/embed/';   /* frame-src */
    f.src = embed + id + '?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1';
    f.title = S.show.title; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.setAttribute('allowfullscreen', '');
    $('lvPlayer').appendChild(f);
    $('lvCard').hidden = true;
  }

  function ours(playbackId) {
    clearPlayer();
    var p = $('lvPlayer');
    var v = document.createElement('video');
    v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true;
    v.poster = 'https://image.mux.com/' + playbackId + '/thumbnail.webp?width=1280';
    p.appendChild(v);
    var bar = document.createElement('div'); bar.className = 'lv-bar';
    bar.innerHTML = '<button type="button" class="lv-btn" data-a="play" aria-label="Pause">' + ICON.pause + '</button>'
      + '<button type="button" class="lv-btn" data-a="sound" aria-label="Sound on">' + ICON.off + '</button>'
      + '<button type="button" class="lv-btn lv-btn--live" data-a="edge">Live</button><span class="lv-grow"></span>'
      + '<button type="button" class="lv-btn" data-a="full" aria-label="Full screen">' + ICON.full + '</button>';
    p.appendChild(bar);
    var tap = document.createElement('button'); tap.type = 'button'; tap.className = 'lv-tap'; tap.innerHTML = ICON.on + 'Tap for sound';
    p.appendChild(tap);
    $('lvCard').hidden = true;

    var url = 'https://stream.mux.com/' + playbackId + '.m3u8';
    var retry = null;
    function start() {
      if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; v.play().catch(function () {}); return; }
      withHls(function (Hls) {
        if (!Hls || !Hls.isSupported()) { card('This browser cannot play the show', 'Open this page in Chrome, Safari or Firefox.'); return; }
        S.hls = new Hls({ lowLatencyMode: true, capLevelToPlayerSize: true, liveSyncDurationCount: 3 });
        S.hls.loadSource(url); S.hls.attachMedia(v);
        S.hls.on(Hls.Events.MANIFEST_PARSED, function () { v.play().catch(function () {}); });
        S.hls.on(Hls.Events.ERROR, function (e, d) {
          if (!d.fatal) return;
          /* the stream not started yet, or a blip: try again in a moment */
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR) { S.hls.recoverMediaError(); return; }
          clearTimeout(retry); retry = setTimeout(function () { if (S.hls) { S.hls.loadSource(url); } }, 5000);
        });
      });
    }
    start();
    function paint() {
      var pb = bar.querySelector('[data-a="play"]'), sb = bar.querySelector('[data-a="sound"]');
      pb.innerHTML = v.paused ? ICON.play : ICON.pause; pb.setAttribute('aria-label', v.paused ? 'Play' : 'Pause');
      sb.innerHTML = v.muted ? ICON.off : ICON.on; sb.setAttribute('aria-label', v.muted ? 'Sound on' : 'Sound off');
      tap.hidden = !v.muted;
    }
    function behind() {
      var e = bar.querySelector('[data-a="edge"]');
      var end = v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
      if (end && end - v.currentTime > 12) e.setAttribute('data-behind', ''); else e.removeAttribute('data-behind');
    }
    ['play', 'pause', 'volumechange'].forEach(function (t) { v.addEventListener(t, paint); });
    v.addEventListener('timeupdate', behind);
    paint();
    tap.addEventListener('click', function () { v.muted = false; v.play().catch(function () {}); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'play') { if (v.paused) v.play().catch(function () {}); else v.pause(); }
      else if (a === 'sound') { v.muted = !v.muted; if (!v.muted) v.play().catch(function () {}); }
      else if (a === 'edge') { var end = v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0; if (end) v.currentTime = Math.max(0, end - 2); v.play().catch(function () {}); }
      else if (a === 'full') {
        var el = p;
        if (document.fullscreenElement) document.exitFullscreen();
        else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
        else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
      }
    });
    /* the bar steps out of the way while the show plays untouched */
    var quiet = null;
    function wake() { p.classList.remove('is-quiet'); clearTimeout(quiet); quiet = setTimeout(function () { if (!v.paused) p.classList.add('is-quiet'); }, 3000); }
    p.addEventListener('pointermove', wake); p.addEventListener('pointerdown', wake); p.addEventListener('focusin', wake); wake();
  }

  /* ---------- the page around it ---------- */
  function when(iso) {
    var t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  }
  var tick = null;
  function countdown(iso) {
    clearInterval(tick);
    var t = Date.parse(iso);
    if (!t) return;
    function draw() {
      var el = $('lvClock'); if (!el) return;
      var s = Math.max(0, Math.round((t - Date.now()) / 1000));
      var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
      el.textContent = s ? (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm ' + (d ? '' : x + 's') : 'Starting';
    }
    draw(); tick = setInterval(draw, 1000);
  }

  function paintShow(show) {
    var key = show.status + '|' + show.source + '|' + show.playbackId + '|' + show.youtubeId;
    $('lvTitle').textContent = show.title || 'PFA Live';
    document.title = (show.title || 'PFA Live') + ' | People for Animals';
    var pill = { off: 'Off air', soon: 'Coming up', live: 'Live now', ended: 'Ended' }[show.status] || 'Off air';
    var line = show.status === 'live' ? 'On air now. Comment, or send a question for the team to put on air.'
      : show.status === 'soon' ? (show.startsAt ? when(show.startsAt) + '. ' : '') + 'Send a question now.'
      : show.status === 'ended' ? 'Thank you for watching. The recording goes up in the Newsroom.'
      : 'The next show is announced on the home page.';
    $('lvState').innerHTML = '<span class="lv-pill" data-s="' + show.status + '">' + pill + '</span><span></span>';
    $('lvState').lastChild.textContent = line;
    var ab = $('lvAbout'); ab.textContent = show.about || ''; ab.hidden = !show.about;
    var open = show.status === 'live';
    $('lvFormC').hidden = !open;
    $('lvEmpty').textContent = open ? 'No comments yet. Be the first.' : show.status === 'soon' ? 'Comments open when the show starts. You can send a question now.' : 'Comments show here while the show is on.';
    var asks = (show.status === 'live' || show.status === 'soon') && show.questions !== false;
    $('lvTextQ').disabled = !asks; $('lvFormQ').querySelector('button').disabled = !asks;
    $('lvTextQ').placeholder = asks ? 'Your question' : 'Opens before the next show';
    /* before the show, asking is the one thing to do: that tab first, once */
    if (!S.tabbed) { S.tabbed = true; if (show.status === 'soon' && asks) tab('q'); }
    if (key === S.key) return;
    S.key = key;
    clearInterval(tick);
    if (show.status === 'live' && show.source === 'mux' && show.playbackId) ours(show.playbackId);
    else if (show.status === 'live' && show.source === 'youtube' && show.youtubeId) youtube(show.youtubeId);
    else {
      clearPlayer();
      if (show.status === 'soon') { card('Starting soon', show.startsAt ? when(show.startsAt) : 'Stay on this page; the show starts here.', !!show.startsAt); countdown(show.startsAt); }
      else if (show.status === 'ended') card('The show has ended', 'The recording goes up in the Newsroom soon.');
      else card('No show on just now', 'When PFA goes live, it plays here, with comments and questions.');
    }
  }

  function paintSpot(sp) {
    var el = $('lvSpot');
    if (!sp || !sp.text) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = '<span class="lv-spot__k"></span><p class="lv-spot__q"></p>';
    el.firstChild.innerHTML = '<span class="lv-spot__on">On air</span><span></span>';
    el.firstChild.lastChild.textContent = (sp.type === 'question' ? 'A question from ' : 'From ') + sp.name;
    el.lastChild.textContent = sp.text;
    el.hidden = false;
  }

  function paintComments(list) {
    var feed = $('lvFeed');
    var atEnd = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    list.forEach(function (c) {
      if (S.seen[c.id]) return;
      S.seen[c.id] = 1;
      var mine = S.mine.indexOf(c.id);
      if (mine >= 0) { var old = feed.querySelector('[data-id="' + c.id + '"]'); if (old) old.remove(); }
      var li = document.createElement('li'); li.setAttribute('data-id', c.id);
      if (c.pfa) li.setAttribute('data-pfa', '');
      var b = document.createElement('b'); b.textContent = c.name; li.appendChild(b);
      li.appendChild(document.createTextNode(c.text));
      feed.appendChild(li);
    });
    while (feed.children.length > 150) feed.removeChild(feed.firstChild);
    $('lvEmpty').hidden = feed.children.length > 0;
    if (atEnd) feed.scrollTop = feed.scrollHeight;
  }

  function poll() {
    clearTimeout(S.timer);
    fetch('/api/live', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.show) return;
      S.show = d.show;
      if (S.session && d.show.session && S.session !== d.show.session) { $('lvFeed').textContent = ''; S.seen = {}; }
      S.session = d.show.session;
      paintShow(d.show);
      paintSpot(d.spotlight);
      paintComments(d.comments || []);
    }).catch(function () { /* the next poll */ }).then(function () {
      var live = S.show && S.show.status === 'live';
      S.timer = setTimeout(poll, document.hidden ? 30000 : live ? 4000 : 20000);
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  /* ---------- tabs ---------- */
  function tab(which) {
    var q = which === 'q';
    $('lvTabC').setAttribute('aria-selected', q ? 'false' : 'true');
    $('lvTabQ').setAttribute('aria-selected', q ? 'true' : 'false');
    $('lvPaneC').hidden = q; $('lvPaneQ').hidden = !q;
  }
  $('lvTabC').addEventListener('click', function () { tab('c'); });
  $('lvTabQ').addEventListener('click', function () { tab('q'); });
  if (/#ask\b/.test(location.hash)) tab('q');

  /* ---------- posting ---------- */
  function send(type, form, nameEl, textEl, sayEl) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameEl.value.trim(), text = textEl.value.trim(), say = $(sayEl);
      if (name.length < 2) { say.textContent = 'Add your name.'; nameEl.focus(); return; }
      if (text.length < 2) { say.textContent = type === 'question' ? 'Type your question.' : 'Type a comment.'; textEl.focus(); return; }
      try { localStorage.setItem('pfa:live:name', name); } catch (x) { /* none */ }
      $('lvNameC').value = name; $('lvNameQ').value = name;
      var btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      fetch('/api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: type, name: name, text: text, cid: cid }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) {
          if (!r.ok) { say.textContent = (r.j && r.j.message) || 'That did not go through. Try again.'; return; }
          textEl.value = '';
          if (type === 'question') { say.textContent = 'Sent. The team will see it.'; return; }
          say.textContent = '';
          /* your own comment, at once, until the next answer carries it */
          if (r.j.shown) {
            S.mine.push(r.j.id);
            var li = document.createElement('li'); li.setAttribute('data-id', r.j.id); li.setAttribute('data-mine', '');
            var b = document.createElement('b'); b.textContent = name; li.appendChild(b); li.appendChild(document.createTextNode(text));
            $('lvFeed').appendChild(li); $('lvEmpty').hidden = true; $('lvFeed').scrollTop = $('lvFeed').scrollHeight;
          } else say.textContent = 'Sent. It shows once the team has seen it.';
        })
        .catch(function () { say.textContent = 'That did not go through. Check the connection and try again.'; })
        .then(function () { setTimeout(function () { btn.disabled = false; }, 2000); });
    });
  }
  send('comment', document.getElementById('lvFormC'), $('lvNameC'), $('lvTextC'), 'lvSayC');
  send('question', document.getElementById('lvFormQ'), $('lvNameQ'), $('lvTextQ'), 'lvSayQ');

  poll();
})();
