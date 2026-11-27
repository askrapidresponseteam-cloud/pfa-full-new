/* "From PFA": news and notices PFA puts out, written in the panel's Updates
 * section (owner, 26 Nov 2026: "find a best place to display new
 * news/notifications ... it should have a cool video player as well").
 *
 * Two places; a page whose request fails looks exactly as before (the bell
 * stays a plain link to the Newsroom's updates):
 *   [data-updates="bell"]   the bell at the top of the home page: a red
 *                           count of what is new, and under it the latest
 *                           updates, with PFA Live first while a show is on
 *                           or about to start
 *   [data-updates="feed"]   the Newsroom, under its masthead: every update,
 *                           three at first and the rest under + More updates
 *
 * Films play in the site's own player (assets/theatre.js, the wall's, the
 * founder page's and CineKind's), loaded only when one is pressed. An
 * Instagram post opens in Instagram's own frame, since nothing outside it
 * can drive what plays inside. Reads /api/updates (lib/routes/updates.js).
 */
(function () {
  'use strict';
  var bell = document.querySelector('[data-updates="bell"]');
  var feed = document.querySelector('[data-updates="feed"]');
  if (!bell && !feed) return;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FRESH_DAYS = 14;
  /* a film's stream (media-src) and Instagram's frame (frame-src), both named in the policy */
  var MUX_STREAM = 'https://stream.mux.com/';
  var INSTAGRAM = 'https://www.instagram.com/';
  var FACEBOOK = 'https://www.facebook.com/plugins/video.php?href=';
  /* Facebook's own script, for its player's controls (script-src) */
  var FB_SDK = 'https://connect.facebook.net/en_US/sdk.js';
  var FIRST = 3;
  var SEEN_KEY = 'pfa:updates:seen';
  var PLAY = '<svg viewBox="0 0 12 14" aria-hidden="true"><path fill="currentColor" d="M0 0l12 7-12 7z"/></svg>';
  var ARROW = '<svg viewBox="0 0 12 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M1 6h9M6.5 2.5L10 6 6.5 9.5"/></svg>';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function seen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') || []; } catch (e) { return []; } }
  function markSeen(id) {
    try { var s = seen(); if (s.indexOf(id) < 0) { s.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-60))); } } catch (e) { /* private mode */ }
  }
  function fresh(u) {
    var t = Date.parse(u.date || '');
    return t && (Date.now() - t) < FRESH_DAYS * 864e5 && seen().indexOf(u.id) < 0;
  }

  /* ---------- what each update's film is ---------- */
  function playable(u) { var m = u.media; return !!(m && (m.kind === 'youtube' || m.kind === 'vimeo' || m.kind === 'file' || m.kind === 'mux')); }
  /* An update put on the site before every update had to carry a picture
     (27 Nov 2026: "there cannot be any place where a photo is needed and it
     isnt there") is shown with PFA's own photograph rather than an empty
     frame. */
  var COVER = 'img/og-default.jpg';
  /* a picture that cannot be had gives way to PFA's own, and only then to nothing */
  var SWAP = "if(!this.dataset.fb){this.dataset.fb=1;this.src='" + COVER + "'}else{this.remove()}";
  function cover(u) { return poster(u) || COVER; }
  function poster(u) {
    var m = u.media || {};
    if (u.photo) return u.photo;
    if (m.kind === 'youtube') return 'https://i.ytimg.com/vi/' + m.id + '/hqdefault.jpg';
    if (m.kind === 'mux') return 'https://image.mux.com/' + m.id + '/thumbnail.webp?time=8&width=960';
    return '';
  }
  function film(u) {
    var m = u.media || {}, f = { wall: 'long', title: u.title, credit: 'People for Animals · ' + day(u.date) };
    if (m.kind === 'youtube') f.yt = m.id;
    else if (m.kind === 'vimeo') f.vimeo = m.id;
    else if (m.kind === 'file') f.src = m.url;
    else if (m.kind === 'mux') f.src = MUX_STREAM + m.id + '.m3u8';
    var p = poster(u); if (p) f.poster = p;
    return f;
  }
  /* played in the platform's own frame, on this page (26 Nov 2026, of
     Facebook: "they should start playing natively") */
  function framed(u) { var m = u.media; return !!(m && (m.kind === 'instagram' || m.kind === 'facebook')); }
  function watchWord(u) {
    var m = u.media || {};
    if (m.kind === 'instagram') return m.reel ? 'Watch the reel' : 'See the post';
    if (m.kind === 'facebook') return m.reel ? 'Watch the reel' : 'Watch the film';
    return playable(u) ? 'Watch the film' : 'Read more';
  }

  /* ---------- the player, fetched on the first press ---------- */
  var LIST = [], T = null, waiting = null;
  function withTheatre(cb) {
    if (T) return cb(T);
    if (waiting) { waiting.push(cb); return; }
    waiting = [cb];
    function ready() {
      var go = window.PFA_THEATRE && window.PFA_THEATRE.mount;
      T = go ? window.PFA_THEATRE.mount({
        films: LIST.filter(playable).map(film), progKey: 'pfa:updates:progress',
        name: 'From PFA', credit: 'People for Animals · From PFA',
        foot: feed ? [] : [{ href: 'newsroom.html#from-pfa', text: 'All updates' }]
      }) : null;
      var q = waiting; waiting = null;
      q.forEach(function (f) { f(T); });
    }
    if (window.PFA_THEATRE && window.PFA_THEATRE.mount) return ready();
    if (!document.querySelector('link[href^="assets/theatre.css"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/theatre.css'; document.head.appendChild(l);
    }
    var s = document.createElement('script'); s.src = 'assets/theatre.js'; s.async = true;
    s.onload = ready; s.onerror = ready;
    document.head.appendChild(s);
  }
  function play(u, from) {
    markSeen(u.id);
    var m = u.media || {};
    if (framed(u)) return insta(u, from);
    if (!playable(u)) return;
    var i = LIST.filter(playable).indexOf(u);
    withTheatre(function (t) {
      if (t) { t.open(i, 'long'); return; }
      /* no player (the script did not load): the film where it lives */
      var link = m.kind === 'youtube' ? 'https://www.youtube.com/watch?v=' + m.id : m.kind === 'vimeo' ? 'https://vimeo.com/' + m.id : m.kind === 'file' ? m.url : '';
      if (link) window.open(link, '_blank', 'noopener');
    });
  }

  /* ---------- Instagram, in its own frame ---------- */
  var ig = null, igBack = null;
  function insta(u, from) {
    var m = u.media || {};
    var fb = m.kind === 'facebook';
    if (fb ? !/^https:\/\/(www\.facebook\.com|fb\.watch)\//.test(m.url || '') : !/^[\w-]{5,40}$/.test(m.id || '')) return;
    if (!ig) {
      ig = document.createElement('div');
      ig.className = 'upd-ig'; ig.hidden = true;
      ig.setAttribute('role', 'dialog'); ig.setAttribute('aria-modal', 'true'); ig.setAttribute('aria-label', 'Instagram post');
      ig.innerHTML = '<div class="upd-ig__bar"><span class="upd-ig__ttl"></span><button type="button" class="upd-ig__x">Close</button></div><div class="upd-ig__frame"></div>';
      document.body.appendChild(ig);
      ig.querySelector('.upd-ig__x').addEventListener('click', shutInsta);
      ig.addEventListener('click', function (e) { if (e.target === ig) shutInsta(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ig && !ig.hidden) shutInsta(); });
    }
    igBack = from || null;
    ig.querySelector('.upd-ig__ttl').textContent = u.title;
    ig.setAttribute('aria-label', fb ? 'Facebook film' : 'Instagram post');
    /* a Facebook film that is not a reel is wide; a reel or a post is tall */
    ig.classList.toggle('upd-ig--wide', fb && !m.reel);
    ig.classList.toggle('upd-ig--fb', fb);
    var box = ig.querySelector('.upd-ig__frame'); box.textContent = '';
    ig.style.removeProperty('--fbw');
    if (fb) {
      /* as large as the screen allows, at the film's own shape */
      var room = Math.max(200, window.innerHeight - 110);
      var w = Math.round(m.reel ? Math.min(400, window.innerWidth - 24, room * 9 / 16) : Math.min(960, window.innerWidth - 24, room * 16 / 9));
      ig.style.setProperty('--fbw', w + 'px');
      ig.hidden = false;
      playFb(m, u, box, w);
    } else {
      var f = document.createElement('iframe');
      f.src = INSTAGRAM + (m.reel ? 'reel' : 'p') + '/' + m.id + '/embed';
      f.setAttribute('scrolling', 'no');
      f.title = u.title; f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen'); f.setAttribute('allowfullscreen', '');
      box.appendChild(f);
    }
    ig.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    ig.querySelector('.upd-ig__x').focus();
  }
  /* ---------- a Facebook film, playing with its sound on ----------
     Owner, 27 Nov 2026: "when this video is played, by default can you
     unmute.. right now one has to manually unmute". Facebook's player starts
     every film it plays by itself without sound, whatever the address asks.
     Its own script (the Embedded Video Player API) can turn the sound on once
     the player is ready; the press that opened the film is what lets a
     browser play it aloud, and the player's frame is let play sound
     (allow="autoplay"). If Facebook's script cannot be had, the film plays
     as before, and its sound is a press away. */
  var fbLoad = null, fbWant = null, fbN = 0;
  function withFb() {
    if (window.FB && window.FB.XFBML && fbLoad) return fbLoad;
    if (fbLoad) return fbLoad;
    fbLoad = new Promise(function (ok, no) {
      var done = false;
      var prev = window.fbAsyncInit;
      window.fbAsyncInit = function () {
        try {
          window.FB.init({ xfbml: false, version: 'v21.0' });
          window.FB.Event.subscribe('xfbml.ready', function (msg) {
            if (!msg || msg.type !== 'video' || !fbWant || msg.id !== fbWant.id) return;
            var p = msg.instance; fbWant.player = p;
            try { p.unmute(); if (p.setVolume) p.setVolume(1); p.play(); } catch (e) { /* the player's own button */ }
          });
        } catch (e) { /* below */ }
        if (typeof prev === 'function') { try { prev(); } catch (e) { /* not ours */ } }
        done = true;
        if (window.FB && window.FB.XFBML) ok(window.FB); else { fbLoad = null; no(); }
      };
      var sc = document.createElement('script');
      sc.async = true; sc.defer = true; sc.crossOrigin = 'anonymous';
      sc.onerror = function () { if (!done) { done = true; fbLoad = null; no(); } };
      sc.src = FB_SDK;
      document.head.appendChild(sc);
      setTimeout(function () { if (!done) { done = true; fbLoad = null; no(); } }, 6000);
    });
    return fbLoad;
  }
  /* The player's frame, as Facebook makes it, is let play sound: given
     allow="autoplay" the moment it appears, before it has begun. */
  function letPlaySound(box) {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function () {
      [].forEach.call(box.querySelectorAll('iframe'), function (f) {
        if (f.getAttribute('data-sound')) return;
        f.setAttribute('data-sound', '1');
        var allow = f.getAttribute('allow') || '';
        if (/autoplay/.test(allow)) return;
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen; web-share' + (allow ? '; ' + allow : ''));
        f.setAttribute('allowfullscreen', '');
        var src = f.getAttribute('src');
        if (src) f.setAttribute('src', src);
      });
    });
    mo.observe(box, { childList: true, subtree: true });
    setTimeout(function () { mo.disconnect(); }, 15000);
  }
  function fbFrame(m, title, w) {
    var f = document.createElement('iframe');
    f.src = FACEBOOK + encodeURIComponent(m.url) + '&show_text=false&autoplay=1&mute=0&allowfullscreen=1&width=' + w;
    f.setAttribute('scrolling', 'no');
    f.title = title; f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen'); f.setAttribute('allowfullscreen', '');
    f.className = 'upd-ig__own';
    return f;
  }
  function playFb(m, u, box, w) {
    var id = 'updfb' + (++fbN);
    fbWant = { id: id };
    box.innerHTML = '<div class="fb-video" id="' + id + '" data-href="' + esc(m.url) + '" data-width="' + w + '" data-show-text="false" data-allowfullscreen="true" data-autoplay="true"></div>';
    letPlaySound(box);
    withFb().then(function (FB) {
      if (!fbWant || fbWant.id !== id || ig.hidden) return;
      FB.XFBML.parse(box);
    }).catch(function () {
      if (!fbWant || fbWant.id !== id || ig.hidden) return;
      box.textContent = ''; box.appendChild(fbFrame(m, u.title, w));
    });
  }

  function shutInsta() {
    if (!ig || ig.hidden) return;
    if (fbWant && fbWant.player) { try { fbWant.player.pause(); } catch (e) { /* gone */ } }
    fbWant = null;
    ig.hidden = true; ig.querySelector('.upd-ig__frame').textContent = '';
    document.documentElement.style.overflow = '';
    if (igBack && igBack.focus) try { igBack.focus({ preventScroll: true }); } catch (e) { igBack.focus(); }
  }

  /* ---------- the bell at the top ----------
     Owner, 26 Nov 2026, of the line that sat under Join now: "this cannot be
     below the join button. have it on top like facebook". The bell in the
     header carries a red count of what is new (PFA Live about to start or
     on, and updates not yet seen); pressing it opens the list under it.
     Opening clears the count; a row stays marked until it is opened. A film
     or a reel plays right here; anything else opens in the Newsroom. With
     no script the bell is a plain link to the Newsroom's updates. */
  var NOTICED_KEY = 'pfa:updates:noticed';
  var BELL_MAX = 6;
  var box = null, BELL = { list: [], live: null };
  function noticed() { try { return JSON.parse(localStorage.getItem(NOTICED_KEY) || '[]') || []; } catch (e) { return []; } }
  function notice(ids) {
    try { var n = noticed(); ids.forEach(function (id) { if (n.indexOf(id) < 0) n.push(id); }); localStorage.setItem(NOTICED_KEY, JSON.stringify(n.slice(-80))); } catch (e) { /* private mode */ }
  }
  function liveOn(live) { return !!(live && (live.status === 'live' || live.status === 'soon')); }
  function liveKey(live) { return 'live:' + (live.status === 'live' ? 'on:' : '') + (live.startsAt || live.title || ''); }
  function newIds() {
    var ids = [];
    if (liveOn(BELL.live)) ids.push(liveKey(BELL.live));
    BELL.list.slice(0, BELL_MAX).forEach(function (u) { if (fresh(u)) ids.push(u.id); });
    return ids;
  }
  function paintCount() {
    if (!bell) return;
    var n = noticed();
    var count = newIds().filter(function (id) { return n.indexOf(id) < 0; }).length;
    var c = bell.querySelector('.pfa-bell__count');
    if (!c) { c = document.createElement('span'); c.className = 'pfa-bell__count'; c.setAttribute('aria-hidden', 'true'); bell.appendChild(c); }
    c.textContent = count > 9 ? '9+' : String(count);
    c.hidden = !count;
    bell.setAttribute('aria-label', count ? 'Updates from PFA, ' + count + ' new' : 'Updates from PFA');
  }
  function bellRows() {
    var html = '', live = BELL.live;
    if (liveOn(live)) {
      var on = live.status === 'live', when = '';
      if (!on && live.startsAt) {
        var t = new Date(live.startsAt);
        if (!isNaN(t)) when = t.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      }
      html += '<li><a class="pfa-bell__row is-new" href="live.html">' +
        '<span class="pfa-bell__tag"' + (on ? ' data-live' : '') + '>' + (on ? '<span class="pfa-new__dot" aria-hidden="true"></span>Live now' : 'Live soon') + '</span>' +
        '<span class="pfa-bell__text"><span class="pfa-bell__title">' + esc(live.title) + '</span>' +
        '<span class="pfa-bell__meta">' + (on ? 'Watch, comment and ask a question' : (when ? esc(when) + ' · ' : '') + 'Send a question now') + '</span></span>' +
        '<span class="pfa-bell__go' + (on ? ' pfa-bell__go--play' : '') + '" aria-hidden="true">' + (on ? PLAY : ARROW) + '</span></a></li>';
    }
    BELL.list.slice(0, BELL_MAX).forEach(function (u, i) {
      var go = playable(u) || framed(u), p = cover(u);
      html += '<li><a class="pfa-bell__row' + (fresh(u) ? ' is-new' : '') + '" href="newsroom.html#u-' + esc(u.id) + '" data-i="' + i + '">' +
        /* the picture, over the kind's word: a picture that fails leaves the word */
        (p ? '<span class="pfa-bell__pic"><span>' + esc(u.kindLabel || 'News') + '</span><img src="' + esc(p) + '" alt="" loading="lazy" decoding="async" onerror="' + SWAP + '"></span>'
          : '<span class="pfa-bell__tag">' + esc(u.kindLabel || 'News') + '</span>') +
        '<span class="pfa-bell__text"><span class="pfa-bell__title">' + esc(u.title) + '</span>' +
        '<span class="pfa-bell__meta">' + (u.date ? esc(day(u.date)) + ' · ' : '') + esc(watchWord(u)) + '</span></span>' +
        '<span class="pfa-bell__go' + (go ? ' pfa-bell__go--play' : '') + '" aria-hidden="true">' + (go ? PLAY : ARROW) + '</span></a></li>';
    });
    return html;
  }
  function placeBox() {
    if (!box) return;
    var r = bell.getBoundingClientRect();
    var top = Math.max(8, Math.round(r.bottom + 8));
    var tabs = document.querySelector('.pfa-tabs');
    var below = tabs && tabs.getBoundingClientRect().height && getComputedStyle(tabs).display !== 'none' ? tabs.getBoundingClientRect().height : 0;
    box.style.top = top + 'px';
    box.style.maxHeight = Math.max(220, window.innerHeight - top - below - 12) + 'px';
  }
  function openBell() {
    if (!box) {
      box = document.createElement('div');
      box.className = 'pfa-bell'; box.id = 'pfaBell'; box.hidden = true;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Updates from PFA');
      document.body.appendChild(box);
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-bell-x]')) { shutBell(true); return; }
        var row = e.target.closest('[data-i]');
        if (!row || e.metaKey || e.ctrlKey || e.shiftKey) return;
        var u = BELL.list[+row.getAttribute('data-i')];
        markSeen(u.id);
        if (playable(u) || framed(u)) { e.preventDefault(); shutBell(false); play(u, bell); }
      });
      document.addEventListener('click', function (e) {
        if (box && !box.hidden && !box.contains(e.target) && !bell.contains(e.target)) shutBell(false);
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box && !box.hidden) shutBell(true); });
      window.addEventListener('resize', placeBox);
    }
    var rows = bellRows();
    box.innerHTML = '<div class="pfa-bell__head"><p class="pfa-bell__name">Updates</p><button type="button" class="pfa-bell__x" data-bell-x>Close</button></div>' +
      (rows ? '<ol class="pfa-bell__list">' + rows + '</ol>' : '<p class="pfa-bell__none">Nothing new just now.</p>') +
      '<a class="pfa-bell__all" href="newsroom.html#from-pfa">See all in the Newsroom</a>';
    box.hidden = false;
    placeBox();
    bell.setAttribute('aria-expanded', 'true');
    notice(newIds());
    paintCount();
    var first = box.querySelector('.pfa-bell__row') || box.querySelector('.pfa-bell__x');
    if (first) first.focus({ preventScroll: true });
  }
  function shutBell(back) {
    if (!box || box.hidden) return;
    box.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
    if (back) bell.focus();
  }
  function paintBell(list, live) {
    if (!bell) return;
    BELL.list = list; BELL.live = live;
    paintCount();
  }
  if (bell) {
    bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false');
    bell.setAttribute('aria-controls', 'pfaBell');
    bell.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      if (box && !box.hidden) shutBell(false); else openBell();
    });
  }

  /* ---------- the Newsroom feed ---------- */
  function paras(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; });
  }
  function card(u, i) {
    var m = u.media || {}, p = poster(u), media = '';
    var kindWord = m.kind === 'instagram' ? (m.reel ? 'Instagram reel' : 'Instagram post') : m.kind === 'facebook' ? (m.reel ? 'Facebook reel' : 'Facebook film') : m.kind === 'vimeo' ? 'Vimeo film' : 'Film';
    if (m.kind === 'facebook' && /^https:\/\/(www\.facebook\.com|fb\.watch)\//.test(m.url || '')) {
      /* Facebook's own player, in the card, at the film's real shape (owner,
         26 Nov 2026: "facebook video dimension should match the actual"): a
         reel stands nine by sixteen, a wide film sixteen by nine. It shows
         the film's own first frame and plays right there when pressed. */
      media = '<div class="upd__media upd__media--still upd__media--fb' + (m.reel ? ' upd__media--tall' : '') + '">' +
        '<iframe data-fb="' + esc(FACEBOOK + encodeURIComponent(m.url) + '&show_text=false&allowfullscreen=1') + '"' +
        ' title="' + esc(kindWord + ': ' + u.title) + '" loading="lazy" scrolling="no" allow="autoplay; encrypted-media; picture-in-picture; fullscreen; web-share" allowfullscreen></iframe></div>';
    } else if (playable(u) || framed(u)) {
      var still = p ? '<img src="' + esc(p) + '" alt="" loading="lazy" decoding="async" onerror="' + SWAP + '">'
        : m.kind !== 'file' ? '<img src="' + COVER + '" alt="" loading="lazy" decoding="async">'
        : m.kind === 'file' ? '<video src="' + esc(m.url) + '#t=1" muted playsinline preload="metadata" aria-hidden="true"></video>'
        : '<span class="upd__type" aria-hidden="true">' + esc(kindWord) + '</span>';
      media = '<button type="button" class="upd__media" data-play="' + i + '" aria-label="' + esc(watchWord(u) + ': ' + u.title) + '">' + still +
        '<span class="upd__play"><span class="upd__chip">' + PLAY + '</span>' + esc(watchWord(u)) + '</span></button>';
    } else if (u.photo) {
      media = '<figure class="upd__media upd__media--still" style="margin:0"><img src="' + esc(u.photo) + '" alt="' + esc(u.photoAlt || '') + '" loading="lazy" decoding="async"></figure>';
    } else {
      media = '<figure class="upd__media upd__media--still" style="margin:0"><img src="' + COVER + '" alt="" loading="lazy" decoding="async"></figure>';
    }
    var ps = paras(u.body);
    var body = ps.length ? '<div class="upd__body">' + ps[0] + (ps.length > 1 ? '<div class="upd__rest" id="upd-rest-' + i + '" hidden>' + ps.slice(1).join('') + '</div>' : '') + '</div>' : '';
    var acts = '';
    if (ps.length > 1) acts += '<button type="button" class="upd__more" aria-expanded="false" aria-controls="upd-rest-' + i + '"><span class="upd__plus" aria-hidden="true">+</span>Read more</button>';
    if (u.link) {
      var ext = /^https?:/.test(u.link);
      acts += '<a class="upd__link" href="' + esc(u.link) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(u.linkLabel || (ext ? 'Read the full story' : 'Find out more')) + '</a>';
    }
    return '<li class="upd__item" id="u-' + esc(u.id) + '"' + (i >= FIRST ? ' data-later hidden' : '') + '>' + media +
      '<p class="upd__meta"><span class="upd__tag" data-kind="' + esc(u.kind) + '">' + esc(u.kindLabel) + '</span><time datetime="' + esc(u.date) + '">' + esc(day(u.date)) + '</time></p>' +
      '<h3 class="upd__name">' + esc(u.title) + '</h3>' + body +
      (acts ? '<div class="upd__acts">' + acts + '</div>' : '') + '</li>';
  }
  /* Facebook draws its player at the width and height it is told, so each
     frame is told its own, once it has its place on the page; a frame still
     hidden under + More is told when it is shown */
  function sizeFb() {
    if (!feed) return;
    [].forEach.call(feed.querySelectorAll('iframe[data-fb]'), function (f) {
      var w = Math.round(f.clientWidth), h = Math.round(f.clientHeight);
      if (!w || !h || f.getAttribute('src')) return;
      f.src = f.getAttribute('data-fb') + '&width=' + w + '&height=' + h;
    });
  }
  function paintFeed(list) {
    if (!feed || !list.length) return;
    var more = list.length - FIRST;
    feed.innerHTML = '<div class="upd__head"><h2 class="upd__title" id="from-pfa-title">From PFA</h2>' +
      '<p class="upd__count">' + list.length + (list.length === 1 ? ' update' : ' updates') + '</p></div>' +
      '<ol class="upd__list" data-n="' + Math.min(list.length, 3) + '">' + list.map(card).join('') + '</ol>' +
      (more > 0 ? '<div class="upd__all"><button type="button" class="upd__more" data-all aria-expanded="false"><span class="upd__plus" aria-hidden="true">+</span>' + more + ' more ' + (more === 1 ? 'update' : 'updates') + '</button></div>' : '');
    feed.setAttribute('aria-labelledby', 'from-pfa-title');
    feed.hidden = false;
    sizeFb();
    var nav = document.querySelector('.nr-desks');
    if (nav && !nav.querySelector('a[href="#from-pfa"]')) {
      var a = document.createElement('a'); a.href = '#from-pfa'; a.textContent = 'From PFA';
      nav.insertBefore(a, nav.firstChild);
    }
    feed.addEventListener('click', function (e) {
      var b = e.target.closest('[data-play]');
      if (b) { play(list[+b.getAttribute('data-play')], b); return; }
      var all = e.target.closest('[data-all]');
      if (all) {
        feed.querySelectorAll('[data-later]').forEach(function (li) { li.hidden = false; });
        sizeFb();
        all.parentNode.hidden = true;
        var next = feed.querySelectorAll('.upd__item')[FIRST];
        var focus = next && next.querySelector('button, a');
        if (focus) focus.focus();
        return;
      }
      var m = e.target.closest('.upd__more[aria-controls]');
      if (m) {
        var rest = document.getElementById(m.getAttribute('aria-controls'));
        var open = m.getAttribute('aria-expanded') !== 'true';
        if (rest) rest.hidden = !open;
        m.setAttribute('aria-expanded', open ? 'true' : 'false');
        m.innerHTML = '<span class="upd__plus" aria-hidden="true">' + '+' + '</span>' + (open ? 'Show less' : 'Read more');
      }
    });
    list.forEach(function (u) { markSeen(u.id); });
    /* arrived from the bell: that update, shown and marked */
    var h = /^#u-([\w-]+)$/.exec(location.hash || '');
    if (h) {
      var li = document.getElementById('u-' + h[1]);
      if (li) {
        li.hidden = false; li.classList.add('is-target'); sizeFb();
        var r = li.querySelector('.upd__rest'); if (r) { r.hidden = false; var mb = li.querySelector('.upd__more[aria-controls]'); if (mb) { mb.setAttribute('aria-expanded', 'true'); mb.innerHTML = '<span class="upd__plus" aria-hidden="true">+</span>Show less'; } }
        setTimeout(function () { try { li.scrollIntoView({ block: 'start' }); } catch (e) { li.scrollIntoView(); } }, 60);
      }
    }
  }

  var api = '/api/updates';
  fetch(api, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d) return;
    LIST = Array.isArray(d.updates) ? d.updates.filter(function (u) { return u && u.id && u.title; }) : [];
    paintBell(LIST, d.live || null);
    paintFeed(LIST);
  }).catch(function () { /* the page stays as it was */ });

  window.PFA_UPDATES = { play: function (id) { var u = LIST.filter(function (x) { return x.id === id; })[0]; if (u) play(u); } };
})();
