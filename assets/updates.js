/* "From PFA": news and notices PFA puts out, written in the panel's Updates
 * section (owner, 26 Nov 2026: "find a best place to display new
 * news/notifications ... it should have a cool video player as well").
 *
 * Two holders, both empty and hidden in the page until there is something
 * to put in them, so a page whose request fails looks exactly as before:
 *   [data-updates="strip"]  home page, under the hero's buttons: the latest
 *                           update, marked New until it is opened, or PFA
 *                           Live while a show is on or about to start
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
  var strip = document.querySelector('[data-updates="strip"]');
  var feed = document.querySelector('[data-updates="feed"]');
  if (!strip && !feed) return;

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FRESH_DAYS = 14;
  /* a film's stream (media-src) and Instagram's frame (frame-src), both named in the policy */
  var MUX_STREAM = 'https://stream.mux.com/';
  var INSTAGRAM = 'https://www.instagram.com/';
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
  function watchWord(u) {
    var m = u.media || {};
    if (m.kind === 'instagram') return m.reel ? 'Watch the reel' : 'See the post';
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
    if (m.kind === 'instagram') return insta(u, from);
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
    if (!/^[\w-]{5,40}$/.test(m.id || '')) return;
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
    var f = document.createElement('iframe');
    f.src = INSTAGRAM + (m.reel ? 'reel' : 'p') + '/' + m.id + '/embed';
    f.title = u.title; f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture'); f.setAttribute('allowfullscreen', '');
    var box = ig.querySelector('.upd-ig__frame'); box.textContent = ''; box.appendChild(f);
    ig.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    ig.querySelector('.upd-ig__x').focus();
  }
  function shutInsta() {
    if (!ig || ig.hidden) return;
    ig.hidden = true; ig.querySelector('.upd-ig__frame').textContent = '';
    document.documentElement.style.overflow = '';
    if (igBack && igBack.focus) try { igBack.focus({ preventScroll: true }); } catch (e) { igBack.focus(); }
  }

  /* ---------- the home strip ---------- */
  function paintStrip(list, live) {
    if (!strip) return;
    var html = '';
    if (live && (live.status === 'live' || live.status === 'soon')) {
      var on = live.status === 'live';
      var when = '';
      if (!on && live.startsAt) {
        var t = new Date(live.startsAt);
        if (!isNaN(t)) when = t.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      }
      html = '<a class="pfa-new__row" href="live.html">' +
        '<span class="pfa-new__tag"' + (on ? ' data-live' : '') + '>' + (on ? '<span class="pfa-new__dot" aria-hidden="true"></span>Live now' : 'Live soon') + '</span>' +
        '<span class="pfa-new__text"><span class="pfa-new__title">' + esc(live.title) + '</span>' +
        '<span class="pfa-new__meta">' + (on ? 'Watch, comment and ask a question' : (when ? esc(when) + ' · ' : '') + 'Send a question now') + '</span></span>' +
        '<span class="pfa-new__go' + (on ? ' pfa-new__go--play' : '') + '" aria-hidden="true">' + (on ? PLAY : ARROW) + '</span></a>';
    } else if (list.length) {
      var u = list[0];
      var isNew = fresh(u);
      var canPlay = playable(u);
      html = '<a class="pfa-new__row" href="newsroom.html#u-' + esc(u.id) + '" data-id="' + esc(u.id) + '">' +
        '<span class="pfa-new__tag">' + (isNew ? 'New' : 'Latest') + '</span>' +
        '<span class="pfa-new__text"><span class="pfa-new__title">' + esc(u.title) + '</span>' +
        '<span class="pfa-new__meta">' + esc(day(u.date)) + ' · ' + esc(watchWord(u)) + '</span></span>' +
        '<span class="pfa-new__go' + (canPlay ? ' pfa-new__go--play' : '') + '" aria-hidden="true">' + (canPlay ? PLAY : ARROW) + '</span></a>';
    }
    if (!html) return;
    strip.innerHTML = html;
    strip.hidden = false;
    var row = strip.querySelector('[data-id]');
    if (row) row.addEventListener('click', function (e) {
      var u = list[0];
      markSeen(u.id);
      /* a film plays right here; anything else opens in the Newsroom */
      if (playable(u) && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); play(u, row); }
    });
  }

  /* ---------- the Newsroom feed ---------- */
  function paras(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; });
  }
  function card(u, i) {
    var m = u.media || {}, p = poster(u), media = '';
    var kindWord = m.kind === 'instagram' ? (m.reel ? 'Instagram reel' : 'Instagram post') : m.kind === 'vimeo' ? 'Vimeo film' : 'Film';
    if (playable(u) || m.kind === 'instagram') {
      var still = p ? '<img src="' + esc(p) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">'
        : m.kind === 'file' ? '<video src="' + esc(m.url) + '#t=1" muted playsinline preload="metadata" aria-hidden="true"></video>'
        : '<span class="upd__type" aria-hidden="true">' + esc(kindWord) + '</span>';
      media = '<button type="button" class="upd__media" data-play="' + i + '" aria-label="' + esc(watchWord(u) + ': ' + u.title) + '">' + still +
        '<span class="upd__play"><span class="upd__chip">' + PLAY + '</span>' + esc(watchWord(u)) + '</span></button>';
    } else if (u.photo) {
      media = '<figure class="upd__media upd__media--still" style="margin:0"><img src="' + esc(u.photo) + '" alt="' + esc(u.photoAlt || '') + '" loading="lazy" decoding="async"></figure>';
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
  function paintFeed(list) {
    if (!feed || !list.length) return;
    var more = list.length - FIRST;
    feed.innerHTML = '<div class="upd__head"><h2 class="upd__title" id="from-pfa-title">From PFA</h2>' +
      '<p class="upd__count">' + list.length + (list.length === 1 ? ' update' : ' updates') + '</p></div>' +
      '<ol class="upd__list">' + list.map(card).join('') + '</ol>' +
      (more > 0 ? '<div class="upd__all"><button type="button" class="upd__more" data-all aria-expanded="false"><span class="upd__plus" aria-hidden="true">+</span>' + more + ' more ' + (more === 1 ? 'update' : 'updates') + '</button></div>' : '');
    feed.setAttribute('aria-labelledby', 'from-pfa-title');
    feed.hidden = false;
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
    /* arrived from the home strip: that update, shown and marked */
    var h = /^#u-([\w-]+)$/.exec(location.hash || '');
    if (h) {
      var li = document.getElementById('u-' + h[1]);
      if (li) {
        li.hidden = false; li.classList.add('is-target');
        var r = li.querySelector('.upd__rest'); if (r) { r.hidden = false; var mb = li.querySelector('.upd__more[aria-controls]'); if (mb) { mb.setAttribute('aria-expanded', 'true'); mb.innerHTML = '<span class="upd__plus" aria-hidden="true">+</span>Show less'; } }
        setTimeout(function () { try { li.scrollIntoView({ block: 'start' }); } catch (e) { li.scrollIntoView(); } }, 60);
      }
    }
  }

  var api = '/api/updates';
  fetch(api, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    if (!d) return;
    LIST = Array.isArray(d.updates) ? d.updates.filter(function (u) { return u && u.id && u.title; }) : [];
    paintStrip(LIST, d.live || null);
    paintFeed(LIST);
  }).catch(function () { /* the page stays as it was */ });

  window.PFA_UPDATES = { play: function (id) { var u = LIST.filter(function (x) { return x.id === id; })[0]; if (u) play(u); } };
})();
