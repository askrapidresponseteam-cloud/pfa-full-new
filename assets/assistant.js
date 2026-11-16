/* People for Animals - the site's assistant, on every page.
   ------------------------------------------------------------------------
   Owner, 15 Nov 2026: "build an assistant ... it should allow to do anything
   and everything on the site ... understand query in hindi, english ...
   summarise, confirm, get receipt ... should not cost to operate ... should
   not depend on any API". The zero-cost guided assistant, in English and
   Hindi (Hinglish understood).

   The window and its wiring. What is understood is assets/assistant-nlu.js;
   what is asked and when is assets/assistant-flows.js; the units it offers
   are assets/assistant-units.js. Everything runs in the browser. What it
   sends goes to the site's own server only, the same routes the forms use:

     a form            POST /api/pfa-submissions (the same checks as the page)
     a donation or a   a form posted to /api/payment/create, which opens
     membership        CCAvenue's own page, exactly as the site's buttons do
     a status          GET  /api/pfa-submissions?reference=&contact=
     a receipt         POST /api/assistant/receipt (sent again to the email
                       on the payment, never shown here)
     a PIN code        GET  /api/location-lookup?pin=
     a question        the site search already on the page (pfa-search.js)

   The conversation is kept for this tab only (sessionStorage), so it
   carries on from page to page and is gone when the tab is closed.
   Photographs are never kept there: they go with the report or not at all.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  if (window.PFAAssistant) return;
  var FL = window.PFA_ASSIST_FLOWS;
  var N = window.PFA_ASSIST_NLU;
  if (!FL || !N) return;

  var KEY = 'pfa.assist.v1';
  var MAX_LOG = 60;
  var doc = document;
  var session = null;
  var log = [];
  var box, logEl, input, sendBtn, clipBtn, fileIn, langBtns;
  var busy = false;
  /* monthly giving is offered only while the panel has it on: the choice
     arrives with the rest of what the site shows (assets/site-visibility.js) */
  function monthly() {
    try { var v = window.PFA_VISIBILITY && window.PFA_VISIBILITY.state(); return Boolean(v && v.choices && v.choices['donate#monthly'] === 'on'); } catch (_) { return false; }
  }

  function store(open) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ state: session.state(), log: log.slice(-MAX_LOG), open: open })); } catch (_) { /* storage off or full */ }
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  }

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var ICON_CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

  /* ---- the window ---- */
  function build() {
    box = el('div', 'pfa-asst');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', 'PFA assistant');
    box.hidden = true;
    var head = el('div', 'pfa-asst__head');
    head.appendChild(el('p', 'pfa-asst__t', 'PFA assistant'));
    var close = el('button', 'pfa-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', hide);
    head.appendChild(close);
    var tools = el('div', 'pfa-asst__tools');
    var lang = el('div', 'pfa-asst__lang');
    lang.setAttribute('role', 'group');
    lang.setAttribute('aria-label', 'Language');
    langBtns = [['en', 'English'], ['hi', 'हिंदी']].map(function (p) {
      var b = el('button', '', p[1]);
      b.type = 'button';
      b.setAttribute('data-lang', p[0]);
      b.addEventListener('click', function () { show(session.setLang(p[0]), null); });
      lang.appendChild(b);
      return b;
    });
    tools.appendChild(lang);
    var fresh = el('button', 'pfa-asst__new', 'Start over');
    fresh.type = 'button';
    fresh.addEventListener('click', function () { log = []; logEl.innerHTML = ''; show(session.tap('#menu'), null); });
    tools.appendChild(fresh);
    head.appendChild(tools);
    box.appendChild(head);

    logEl = el('div', 'pfa-asst__log');
    logEl.setAttribute('aria-live', 'polite');
    box.appendChild(logEl);

    var note = el('p', 'pfa-asst__note', 'Nothing is sent until you confirm it. If an animal is in danger, call 112.');
    note.setAttribute('data-note', '');
    box.appendChild(note);

    var bar = el('form', 'pfa-asst__bar');
    bar.setAttribute('novalidate', '');
    clipBtn = el('button', 'pfa-asst__clip');
    clipBtn.type = 'button';
    clipBtn.hidden = true;
    clipBtn.setAttribute('aria-label', 'Attach photographs');
    clipBtn.innerHTML = ICON_CLIP;
    fileIn = el('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/jpeg,image/png,image/webp';
    fileIn.multiple = true;
    fileIn.hidden = true;
    clipBtn.addEventListener('click', function () { fileIn.click(); });
    fileIn.addEventListener('change', attach);
    input = el('textarea');
    input.rows = 1;
    input.setAttribute('aria-label', 'Your message');
    input.placeholder = 'Type here, in English or Hindi';
    input.addEventListener('input', grow);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });
    sendBtn = el('button', 'pfa-asst__send', 'Send');
    sendBtn.type = 'submit';
    bar.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    bar.appendChild(clipBtn);
    bar.appendChild(fileIn);
    bar.appendChild(input);
    bar.appendChild(sendBtn);
    box.appendChild(bar);
    doc.body.appendChild(box);
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) hide(); });
  }

  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(140, input.scrollHeight + 2) + 'px';
  }

  /* ---- drawing messages ---- */
  function draw(m, who, live) {
    var div = el('div', 'pfa-asst__m pfa-asst__m--' + who);
    if (who === 'me') { div.textContent = m.text; logEl.appendChild(div); return; }
    String(m.text || '').split('\n').forEach(function (line) { if (line) div.appendChild(el('p', '', line)); });
    if (m.list && m.list.length) {
      var dl = el('dl');
      m.list.forEach(function (r) { dl.appendChild(el('dt', '', r[0])); dl.appendChild(el('dd', '', r[1])); });
      div.appendChild(dl);
    }
    if (m.links && m.links.length) {
      var links = el('div', 'pfa-asst__links');
      m.links.forEach(function (l) {
        var a = el('a', '', l.label);
        /* from any page, the unit pages in their folder included */
        a.href = /^(?:https?:|tel:|mailto:|\/)/.test(l.href) ? l.href : '/' + l.href;
        if (/^https?:/.test(l.href) && l.href.indexOf(location.host) < 0) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.addEventListener('click', function () { store(true); });
        links.appendChild(a);
      });
      div.appendChild(links);
    }
    if (live && m.chips && m.chips.length) {
      var chips = el('div', 'pfa-asst__chips');
      m.chips.forEach(function (c) {
        var b = el('button', '', c.label);
        b.type = 'button';
        if (c.on) b.setAttribute('aria-pressed', 'true');
        b.addEventListener('click', function () {
          if (busy) return;
          var multi = /^[^#@]/.test(c.value) && m.chips.some(function (x) { return x.value === '#done'; });
          if (!multi) Array.prototype.forEach.call(chips.querySelectorAll('button'), function (x) { x.disabled = true; });
          say(c.label, c.value, true);
        });
        chips.appendChild(b);
      });
      div.appendChild(chips);
    }
    logEl.appendChild(div);
  }

  /* the earlier messages' buttons stand down once there is a newer one */
  function retire() {
    Array.prototype.forEach.call(logEl.querySelectorAll('.pfa-asst__chips button'), function (b) { b.disabled = true; });
  }

  function show(o, mine) {
    if (!o) return;
    if (mine) { log.push({ who: 'me', text: mine }); }
    retire();
    if (mine) draw({ text: mine }, 'me', false);
    var before = logEl.children.length;
    (o.messages || []).forEach(function (m, i) {
      log.push({ who: 'pfa', m: m });
      draw(m, 'pfa', i === o.messages.length - 1);
    });
    paintLang(o.lang);
    clipBtn.hidden = !(o.input && o.input.type === 'photo');
    input.rows = o.input && o.input.type === 'long' ? 3 : 1;
    grow();
    reveal(logEl.children[before]);
    store(true);
    if (o.action) act(o.action);
  }

  /* The reply is read from its start. A reply taller than the window (the
     summary before sending or paying, with the terms and the button under
     it) opens at its first line, not at its last, so the details are seen
     before the button; a short one simply comes to the bottom. */
  function reveal(first) {
    var bottom = logEl.scrollHeight;
    if (!first) { logEl.scrollTop = bottom; return; }
    var top = logEl.scrollTop + first.getBoundingClientRect().top - logEl.getBoundingClientRect().top - 12;
    logEl.scrollTop = bottom - top > logEl.clientHeight ? top : bottom;
  }

  function paintLang(l) {
    langBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === l)); });
    input.placeholder = l === 'hi' ? 'यहाँ लिखें, हिंदी या अंग्रेज़ी में' : 'Type here, in English or Hindi';
    sendBtn.textContent = l === 'hi' ? 'भेजें' : 'Send';
    var note = box.querySelector('[data-note]');
    if (note) note.textContent = l === 'hi' ? 'आपकी पुष्टि के बिना कुछ नहीं भेजा जाता। अगर कोई जानवर खतरे में है, तो 112 पर कॉल करें।' : 'Nothing is sent until you confirm it. If an animal is in danger, call 112.';
  }

  function say(text, value, tapped) {
    if (busy) return;
    var o = tapped ? session.tap(value) : session.hear(text);
    show(o, text);
  }

  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    say(text, null, false);
  }

  /* ---- photographs: shrunk here, as the report page does, to under 950 KB ---- */
  function shrink(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600;
        var w = img.naturalWidth, h = img.naturalHeight;
        var k = Math.min(1, max / Math.max(w, h));
        var c = doc.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var q = 0.82, out = c.toDataURL('image/jpeg', q);
        while (out.length * 0.75 > 900 * 1024 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function attach() {
    var files = Array.prototype.slice.call(fileIn.files || [], 0, 3);
    fileIn.value = '';
    if (!files.length) return;
    Promise.all(files.map(shrink)).then(function (list) {
      list = list.filter(Boolean);
      if (!list.length) return;
      show(session.addPhotos(list), list.length + (list.length === 1 ? ' photograph' : ' photographs'));
    });
  }

  /* ---- doing what the conversation asked for ---- */
  function waitOn() {
    busy = true;
    sendBtn.disabled = true;
    var w = el('div', 'pfa-asst__wait', session.state().lang === 'hi' ? 'एक पल…' : 'One moment…');
    w.setAttribute('data-wait', '');
    logEl.appendChild(w);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function waitOff() {
    busy = false;
    sendBtn.disabled = false;
    Array.prototype.forEach.call(logEl.querySelectorAll('[data-wait]'), function (w) { w.remove(); });
  }
  function finish(id, result) {
    waitOff();
    show(session.done(id, result), null);
  }
  function json(r) { return r.json().catch(function () { return {}; }).then(function (p) { return { ok: r.ok, status: r.status, p: p }; }); }
  function rand() {
    var b = new Uint8Array(12);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (var i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function pinPlace(pin) {
    return fetch('/api/location-lookup?pin=' + encodeURIComponent(pin), { headers: { Accept: 'application/json' } }).then(json);
  }

  function act(a) {
    if (a.type === 'pay') return pay(a);
    waitOn();
    var fail = function () { finish(a.id, { ok: false }); };
    if (a.type === 'pin') {
      return pinPlace(a.pin).then(function (r) {
        if (r.status === 404 || r.status === 400) return finish(a.id, { bad: true });
        if (!r.ok) return finish(a.id, {});
        var p = r.p;
        var places = [p.city].concat(p.near || [], p.areas || []).filter(Boolean).filter(function (x, i, all) { return all.indexOf(x) === i; });
        finish(a.id, { state: p.state, districts: (p.districts && p.districts.length ? p.districts : [p.district]).filter(Boolean), places: places });
      }).catch(function () { finish(a.id, {}); });
    }
    if (a.type === 'submit') {
      var body = { kind: a.kind, data: a.data, page: (location.pathname.replace(/^\//, '') || 'index.html').slice(0, 120), clientRequestId: 'assistant-' + rand() };
      if (a.photos && a.photos.length) body.photos = a.photos;
      return fetch('/api/pfa-submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(json).then(function (r) {
          var p = r.p || {};
          if (r.ok && p.reference) {
            var n = p.confirmation || {};
            return finish(a.id, { ok: true, reference: p.reference, started: Boolean(p.started), mail: n.state || '', to: n.to || a.data.email || '' });
          }
          finish(a.id, { ok: false, fields: p.fields || [], message: p.error || p.message || '' });
        }).catch(fail);
    }
    if (a.type === 'track') {
      return fetch('/api/pfa-submissions?reference=' + encodeURIComponent(a.reference) + '&contact=' + encodeURIComponent(a.contact), { headers: { Accept: 'application/json' } })
        .then(json).then(function (r) {
          var p = r.p || {};
          finish(a.id, r.ok && p.found !== false ? Object.assign({ ok: true }, p) : { ok: false, message: p.error || p.message || '' });
        }).catch(fail);
    }
    if (a.type === 'receipt') {
      return fetch('/api/assistant/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: a.email, mobile: a.mobile }) })
        .then(json).then(function (r) { finish(a.id, { ok: r.ok, message: (r.p || {}).message || '' }); }).catch(fail);
    }
    if (a.type === 'verify') {
      var cert = /^PFA-(INT|VOL|PAR|REC|DNR)-/.test(a.number);
      return fetch(cert ? '/api/verify-certificate?n=' + encodeURIComponent(a.number) : '/api/verify-card?id=' + encodeURIComponent(a.number), { headers: { Accept: 'application/json' } })
        .then(json).then(function (r) {
          var p = r.p || {};
          finish(a.id, Object.assign({}, p, { notFound: p.code === 'NOT_FOUND' || p.found === false && !r.ok }));
        }).catch(fail);
    }
    if (a.type === 'nearby') {
      var units = window.PFA_ASSIST_UNITS || [];
      var place = String(a.place || '');
      if (/^[1-9]\d{5}$/.test(place)) {
        return pinPlace(place).then(function (r) {
          var p = r.ok ? r.p : {};
          finish(a.id, { units: FL.unitsNear(units, p), place: p.district ? place + ' (' + p.district + ')' : place });
        }).catch(function () { finish(a.id, { units: [], place: place }); });
      }
      return setTimeout(function () { finish(a.id, { units: FL.unitsNear(units, { text: place }), place: place }); }, 0);
    }
    if (a.type === 'search') {
      var rows = [];
      try {
        if (window.PFASearch && a.q) rows = (window.PFASearch.search(a.q, { limit: 5 }).rows || []).map(function (r) { return { title: r.t, url: r.u, desc: r.d || '' }; });
      } catch (_) { rows = []; }
      /* the site's own words that answer it (16 Nov 2026): its paragraphs,
         as scripts/build-answer-index.js gathers them, read once */
      return siteText().then(function (docs) {
        var passage = null;
        try { passage = FL.passageOf([a.q, a.question].filter(Boolean).join(' '), docs); } catch (_) { passage = null; }
        finish(a.id, { rows: rows, passage: passage });
      }, function () { finish(a.id, { rows: rows }); });
    }
    waitOff();
  }

  var siteDocs = null;
  function siteText() {
    if (!siteDocs) {
      siteDocs = fetch('/assets/assistant-answers.json', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (ix) {
        return ((ix && ix.passages) || []).map(function (p) { return { title: p.t, url: p.u, heading: p.h, text: p.x }; });
      }).catch(function () { siteDocs = null; return []; });
    }
    return siteDocs;
  }

  /* CCAvenue's own page, through the same door the site's buttons use */
  function pay(a) {
    var f = doc.createElement('form');
    f.method = 'post';
    f.action = '/api/payment/create';
    f.hidden = true;
    var fields = Object.assign({}, a.fields, { client_ref: 'assistant-' + rand() });
    Object.keys(fields).forEach(function (k) {
      if (fields[k] == null || fields[k] === '') return;
      var i = doc.createElement('input');
      i.type = 'hidden'; i.name = k; i.value = String(fields[k]);
      f.appendChild(i);
    });
    doc.body.appendChild(f);
    store(false);
    waitOn();
    setTimeout(function () { f.submit(); }, 400);
  }

  /* ---- open and close ---- */
  function open() {
    if (!box) start();
    box.hidden = false;
    var launch = doc.querySelector('.pfa-asst-launch');
    if (launch) launch.setAttribute('aria-expanded', 'true');
    store(true);
    setTimeout(function () { input.focus({ preventScroll: true }); }, 30);
  }
  function hide() {
    box.hidden = true;
    var launch = doc.querySelector('.pfa-asst-launch');
    if (launch) { launch.setAttribute('aria-expanded', 'false'); launch.focus(); }
    store(false);
  }

  function start() {
    build();
    var kept = load();
    var lang = (doc.documentElement.getAttribute('lang') || '').indexOf('hi') === 0 ? 'hi' : 'en';
    if (kept && kept.state) {
      session = FL.createSession({ state: kept.state, monthly: monthly });
      log = kept.log || [];
      log.forEach(function (x, i) { draw(x.who === 'me' ? { text: x.text } : x.m, x.who, i === log.length - 1); });
      /* a payment page opened and came back, or the tab was reloaded mid-send:
         the conversation goes on from the menu, never sending twice */
      if (kept.state.phase === 'waiting') show(session.tap('#menu'), null);
      paintLang(session.state().lang);
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      session = FL.createSession({ lang: lang, monthly: monthly });
      show(session.start(), null);
    }
  }

  window.PFAAssistant = { open: open, hide: hide, say: function (t) { open(); say(t, null, false); } };
  var kept = load();
  if (kept && kept.open) open();
})();
