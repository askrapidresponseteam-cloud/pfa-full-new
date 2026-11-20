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
     the shop          GET  /api/shop/pieces (what is on sale), POST it the
                       bag to price it before paying, then a form posted to
                       /api/shop/checkout, which opens CCAvenue's own page,
                       exactly as the shop page's own checkout does
     a question        the site search already on the page (pfa-search.js)
     a person          /api/live-chat (lib/routes/live-chat.js): offered only
                       while someone in the panel is available; this page
                       asks every few seconds for their replies

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
  var liveBar, liveTimer = null, online = false, onlineAt = 0;
  /* monthly giving is offered only while the panel has it on: the choice
     arrives with the rest of what the site shows (assets/site-visibility.js) */
  function monthly() {
    try { var v = window.PFA_VISIBILITY && window.PFA_VISIBILITY.state(); return Boolean(v && v.choices && v.choices['donate#monthly'] === 'on'); } catch (_) { return false; }
  }

  /* The shop page's own bag (assets/shop.js, localStorage 'pfa-shop-bag'):
     a piece added in the chat is in the bag on shop.html, and the other way
     round. The shop page is told at once when the chat changes it. */
  var BAG_KEY = 'pfa-shop-bag';
  var shopBag = {
    get: function () { try { return JSON.parse(localStorage.getItem(BAG_KEY) || '[]') || []; } catch (_) { return []; } },
    set: function (list) {
      try { localStorage.setItem(BAG_KEY, JSON.stringify(list || [])); } catch (_) { /* this visit only */ }
      try { window.dispatchEvent(new CustomEvent('pfa:bag', { detail: { from: 'assistant' } })); } catch (_) { /* old browser */ }
    }
  };

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
    /* while chatting with a person: who with, and the way out */
    liveBar = el('div', 'pfa-asst__live');
    liveBar.hidden = true;
    liveBar.appendChild(el('p', '', ''));
    var endBtn = el('button', '', 'End chat');
    endBtn.type = 'button';
    endBtn.addEventListener('click', function () { say(endBtn.textContent, '#endlive', true); });
    liveBar.appendChild(endBtn);
    box.insertBefore(liveBar, note);

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
    input.addEventListener('input', typing);
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
    if (who === 'me') {
      div.appendChild(el('span', 'pfa-asst__said', m.text));
      /* a message to a person at PFA: Sending, Sent, Seen, or Not sent (tap to send again) */
      if (m.cid) { div.setAttribute('data-cid', m.cid); if (m.n) div.setAttribute('data-n', m.n); div.appendChild(el('span', 'pfa-asst__tick')); tick(div, m.st || 'sending'); }
      logEl.appendChild(div);
      return;
    }
    /* a reply from a person at PFA says who wrote it */
    if (m.from) { div.className += ' pfa-asst__m--staff'; div.appendChild(el('p', 'pfa-asst__from', m.from + ', PFA')); }
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
    if ((m.cards && m.cards.length) || m.look || m.bag) div.className += ' pfa-asst__m--wide';
    if (m.cards && m.cards.length) div.appendChild(shopCards(m.cards));
    if (m.look) div.appendChild(shopLook(m.look));
    if (m.bag) div.appendChild(shopBagView(m.bag, live));
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

  /* the earlier messages' buttons stand down once there is a newer one
     (a bag's own buttons too: only the newest bag is the bag) */
  function retire() {
    Array.prototype.forEach.call(logEl.querySelectorAll('.pfa-asst__chips button, .pfa-asst__bag button'), function (b) { b.disabled = true; });
  }

  /* ---- the shop, drawn in the chat (20 Nov 2026) ---- */
  function rupees(n) { return '\u20b9' + Number(n || 0).toLocaleString('en-IN'); }
  function img(src, alt, cls) {
    var i = el('img', cls);
    i.src = /^(?:https?:|\/)/.test(src) ? src : '/' + src;
    i.alt = alt || '';
    i.loading = 'lazy';
    i.decoding = 'async';
    return i;
  }
  function price(p, was) {
    var w = el('p', 'pfa-asst__price');
    w.appendChild(el('b', '', rupees(p)));
    if (was && was > p) { var s = el('s', '', rupees(was)); s.setAttribute('aria-label', 'was ' + rupees(was)); w.appendChild(s); }
    return w;
  }
  /* one size at a time, as a pair of buttons; the Add button carries it */
  function sizePick(item, onPick) {
    var row = el('div', 'pfa-asst__sizes');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Size');
    var chosen = item.sizes.length === 1 ? item.sizes[0] : '';
    item.sizes.forEach(function (sz) {
      var b = el('button', '', sz);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(sz === chosen));
      b.addEventListener('click', function () {
        chosen = sz;
        Array.prototype.forEach.call(row.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onPick(sz);
      });
      row.appendChild(b);
    });
    onPick(chosen);
    return row;
  }
  function addButton(item) {
    var size = '';
    var wrap = el('div', 'pfa-asst__buy');
    var add = el('button', 'pfa-asst__add', 'Add to bag');
    add.type = 'button';
    var picker = sizePick(item, function (sz) { size = sz; add.textContent = sz ? 'Add, size ' + sz : 'Add to bag'; });
    add.addEventListener('click', function () {
      if (busy) return;
      if (!size) { picker.classList.add('is-ask'); var first = picker.querySelector('button'); if (first) first.focus(); return; }
      picker.classList.remove('is-ask');
      say('Add ' + item.name + ', size ' + size, '@shop:add:' + item.id + ':' + size, true);
    });
    wrap.appendChild(picker);
    wrap.appendChild(add);
    return wrap;
  }
  function shopCards(cards) {
    var row = el('div', 'pfa-asst__cards');
    row.setAttribute('role', 'list');
    cards.forEach(function (c) {
      var card = el('div', 'pfa-asst__card');
      card.setAttribute('role', 'listitem');
      var look = el('button', 'pfa-asst__pic');
      look.type = 'button';
      look.setAttribute('aria-label', 'A closer look at ' + c.name);
      look.appendChild(img(c.image, c.name));
      look.addEventListener('click', function () { if (!busy) say(c.name, '@shop:look:' + c.id, true); });
      card.appendChild(look);
      card.appendChild(el('p', 'pfa-asst__name', c.name));
      card.appendChild(price(c.price, c.was));
      if (c.inBag) card.appendChild(el('p', 'pfa-asst__inbag', c.inBag + ' in your bag'));
      card.appendChild(addButton(c));
      row.appendChild(card);
    });
    return row;
  }
  function shopLook(p) {
    var box = el('div', 'pfa-asst__look');
    var main = img(p.images[0], p.name, 'pfa-asst__lookimg');
    box.appendChild(main);
    if (p.images.length > 1) {
      var thumbs = el('div', 'pfa-asst__thumbs');
      p.images.forEach(function (src, i) {
        var b = el('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Photograph ' + (i + 1) + ' of ' + p.images.length);
        b.setAttribute('aria-current', String(i === 0));
        b.appendChild(img(src, ''));
        b.addEventListener('click', function () {
          main.src = /^(?:https?:|\/)/.test(src) ? src : '/' + src;
          Array.prototype.forEach.call(thumbs.children, function (x) { x.setAttribute('aria-current', String(x === b)); });
        });
        thumbs.appendChild(b);
      });
      box.appendChild(thumbs);
    }
    box.appendChild(el('p', 'pfa-asst__name', p.name));
    if (p.designer) box.appendChild(el('p', 'pfa-asst__by', 'By ' + p.designer));
    box.appendChild(price(p.price, p.was));
    if (p.atDispatch) box.appendChild(el('p', 'pfa-asst__by', 'Colour chosen for you at dispatch, from what is on the shelf.'));
    box.appendChild(addButton(p));
    var page = el('a', 'pfa-asst__more', 'See it on the shop page');
    page.href = '/' + String(p.href || 'shop.html').replace(/^\//, '');
    page.addEventListener('click', function () { store(true); });
    box.appendChild(page);
    return box;
  }
  function shopBagView(b, live) {
    var box = el('div', 'pfa-asst__bag');
    var list = el('ul');
    b.lines.forEach(function (l) {
      var li = el('li');
      li.appendChild(img(l.image, ''));
      var mid = el('div', 'pfa-asst__bagmid');
      mid.appendChild(el('p', 'pfa-asst__name', l.name));
      mid.appendChild(el('p', 'pfa-asst__by', 'Size ' + l.size + (l.atDispatch ? ', colour chosen at dispatch' : '') + ' \u00b7 ' + rupees(l.unit) + ' each'));
      var qty = el('div', 'pfa-asst__qty');
      var minus = el('button', 'pfa-asst__less', '');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'One fewer ' + l.name + ', size ' + l.size);
      var n = el('span', '', String(l.qty));
      n.setAttribute('aria-label', l.qty + ' in the bag');
      var plus = el('button', 'pfa-asst__plus', '');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'One more ' + l.name + ', size ' + l.size);
      plus.disabled = !live || l.qty >= b.maxQty;
      minus.disabled = !live;
      var rm = el('button', 'pfa-asst__rm', 'Remove');
      rm.type = 'button';
      rm.disabled = !live;
      minus.addEventListener('click', function () { if (!busy) say(l.qty > 1 ? 'One fewer ' + l.name : 'Remove ' + l.name, '@shop:qty:' + l.id + ':' + l.size + ':-1', true); });
      plus.addEventListener('click', function () { if (!busy) say('One more ' + l.name, '@shop:qty:' + l.id + ':' + l.size + ':1', true); });
      rm.addEventListener('click', function () { if (!busy) say('Remove ' + l.name + ', size ' + l.size, '@shop:rm:' + l.id + ':' + l.size, true); });
      qty.appendChild(minus); qty.appendChild(n); qty.appendChild(plus); qty.appendChild(rm);
      mid.appendChild(qty);
      li.appendChild(mid);
      li.appendChild(el('b', 'pfa-asst__line', rupees(l.lineTotal)));
      list.appendChild(li);
    });
    box.appendChild(list);
    var dl = el('dl');
    [[b.lines.reduce(function (s2, l) { return s2 + l.qty; }, 0) === 1 ? '1 piece' : b.lines.reduce(function (s2, l) { return s2 + l.qty; }, 0) + ' pieces', rupees(b.subtotal)], [b.deliveryLabel, rupees(b.shipping)], [b.totalLabel, rupees(b.total)]].forEach(function (r, i) {
      var d = el('div', i === 2 ? 'is-total' : '');
      d.appendChild(el('dt', '', r[0]));
      d.appendChild(el('dd', '', r[1]));
      dl.appendChild(d);
    });
    box.appendChild(dl);
    return box;
  }

  function show(o, mine) {
    if (!o) return;
    if (mine) { log.push(o.cid ? { who: 'me', text: mine, cid: o.cid, st: 'sending' } : { who: 'me', text: mine }); }
    retire();
    if (mine) draw({ text: mine, cid: o.cid, st: 'sending' }, 'me', false);
    var before = logEl.children.length;
    (o.messages || []).forEach(function (m, i) {
      log.push({ who: 'pfa', m: m });
      draw(m, 'pfa', i === o.messages.length - 1);
    });
    paintLang(o.lang);
    paintLive();
    clipBtn.hidden = !(o.input && o.input.type === 'photo');
    input.rows = o.input && o.input.type === 'long' ? 3 : 1;
    grow();
    reveal(logEl.children[before]);
    store(true);
    if (o.action) act(o.action);
    if (o.miss) missed(o.miss);
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

  var lastLive = {};
  function paintLive(p) {
    var st = session.state();
    var on = st.phase === 'live' && st.live;
    liveBar.hidden = !on;
    box.querySelector('[data-note]').hidden = Boolean(on);
    if (!on) { stopLive(); lastLive = {}; return; }
    if (p) lastLive = p;
    var hi = st.lang === 'hi';
    var name = st.live.staff;
    var away = name && lastLive.staffOnline === false;
    liveBar.setAttribute('data-s', !name ? 'wait' : away ? 'away' : 'on');
    liveBar.firstChild.textContent = !name
      ? (hi ? 'PFA में किसी का इंतज़ार' : 'Waiting for someone at PFA')
      : away ? (hi ? name + ' अभी ऑफ़लाइन हैं' : name + ' is offline')
        : lastLive.staffTyping ? (hi ? name + ' लिख रहे हैं…' : name + ' is typing…')
          : (hi ? 'PFA से ' + name + ' के साथ चैट' : 'Chatting with ' + name + ' from PFA');
    liveBar.lastChild.textContent = hi ? 'चैट समाप्त करें' : 'End chat';
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
    if (a.type === 'shop-pay') return pay(a, '/api/shop/checkout');
    if (/^live-/.test(a.type)) return liveAct(a);
    waitOn();
    var fail = function () { finish(a.id, { ok: false }); };
    if (a.type === 'shop-pieces') {
      return fetch('/api/shop/pieces', { headers: { Accept: 'application/json' } }).then(json).then(function (r) {
        finish(a.id, r.ok ? Object.assign({ ok: true }, r.p) : { ok: false });
      }).catch(function () { finish(a.id, { ok: false }); });
    }
    if (a.type === 'shop-quote') {
      return fetch('/api/shop/pieces', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: a.items }) })
        .then(json).then(function (r) {
          finish(a.id, r.ok ? Object.assign({ ok: true }, r.p) : { ok: false, message: (r.p && r.p.message) || '' });
        }).catch(function () { finish(a.id, { ok: false }); });
    }
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
        /* only pages that match: when nothing does, the search offers its
           closest guesses, which are not an answer (17 Nov 2026: a name was
           answered with Care Guides) */
        var found = window.PFASearch && a.q ? window.PFASearch.search(a.q, { limit: 5 }) : null;
        if (found && found.via !== 'closest') rows = (found.rows || []).map(function (r) { return { title: r.t, url: r.u, desc: r.d || '' }; });
      } catch (_) { rows = []; }
      /* the site's own words that answer it (16 Nov 2026): its paragraphs,
         as scripts/build-answer-index.js gathers them, read once */
      return Promise.all([siteText(), publicPeople()]).then(function (got) {
        var passage = null;
        var people = [];
        try { passage = FL.passageOf([a.q, a.question].filter(Boolean).join(' '), got[0]); } catch (_) { passage = null; }
        try { people = FL.peopleOf(a.question || a.q, got[1]); } catch (_) { people = []; }
        finish(a.id, { rows: rows, passage: passage, people: people });
      }, function () { finish(a.id, { rows: rows }); });
    }
    waitOff();
  }

  /* ---- a person at PFA, live (lib/routes/live-chat.js) ----
     Fast: every second while the chat is lively, every three when it is
     quiet, every eight when the tab is not in view. Each message shows at
     once with its state (Sending, Sent, Seen), is sent with its own id so a
     second try is the same message, and can be sent again if it failed. The
     other side's typing and whether they are online are on the bar. */
  var liveActive = 0, typedAt = 0, liveInFlight = false;
  function liveOnline() { return online; }
  function checkOnline(force) {
    if (!force && Date.now() - onlineAt < 15000) return;
    onlineAt = Date.now();
    fetch('/api/live-chat', { headers: { Accept: 'application/json' }, cache: 'no-store' }).then(json).then(function (r) { online = Boolean(r.ok && r.p && r.p.online); }).catch(function () { online = false; });
  }
  function post(body, keep) {
    return fetch('/api/live-chat', { method: 'POST', keepalive: Boolean(keep), cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }).then(json);
  }
  var TICK = { sending: ['Sending', ''], sent: ['✓', 'Sent'], seen: ['✓✓', 'Seen'], failed: ['Not sent. Tap to send again', ''] };
  function tick(div, st) {
    var tk = div.querySelector('.pfa-asst__tick');
    if (!tk) return;
    div.setAttribute('data-st', st);
    var w = TICK[st] || TICK.sent;
    tk.textContent = w[0];
    if (w[1]) tk.setAttribute('aria-label', w[1]); else tk.removeAttribute('aria-label');
  }
  /* a message's state, on the page and in what the tab keeps */
  function mark(cid, st, n) {
    var div = logEl.querySelector('[data-cid="' + cid + '"]');
    if (div) { tick(div, st); if (n) div.setAttribute('data-n', n); }
    log.forEach(function (x) { if (x.cid === cid) { x.st = st; if (n) x.n = n; } });
    store(!box.hidden);
  }
  function seenUpTo(n) {
    if (!n) return;
    var changed = false;
    log.forEach(function (x) { if (x.cid && x.n && x.n <= n && x.st === 'sent') { x.st = 'seen'; changed = true; } });
    Array.prototype.forEach.call(logEl.querySelectorAll('[data-cid][data-st="sent"]'), function (d) { if (Number(d.getAttribute('data-n')) <= n) tick(d, 'seen'); });
    if (changed) store(!box.hidden);
  }
  function news(o) {
    if (!o || !o.messages || !o.messages.length) { if (o) store(!box.hidden); paintLive(); return; }
    liveActive = Date.now();
    show(o, null);
    if (box.hidden) {
      var launch = doc.querySelector('.pfa-asst-launch');
      if (launch) launch.setAttribute('data-new', '');
    }
  }
  function sendLive(cid, text) {
    var l = session.state().live || {};
    if (!l.id) return setTimeout(function () { sendLive(cid, text); }, 400);
    liveActive = Date.now();
    mark(cid, 'sending');
    return post({ action: 'send', id: l.id, token: l.token, text: text, cid: cid }).then(function (r) {
      if (r.ok && r.p && r.p.n) { mark(cid, 'sent', r.p.n); soon(); return; }
      if (r.status === 409 || r.status === 404) { mark(cid, 'failed'); news(session.live({ type: 'news', status: 'closed', closedBy: 'gone', messages: [] })); return; }
      mark(cid, 'failed');
    }).catch(function () { mark(cid, 'failed'); });
  }
  function liveAct(a) {
    if (a.type === 'live-start') {
      return post({ action: 'start', text: a.text, cid: a.cid, page: (location.pathname.replace(/^\//, '') || 'index.html').slice(0, 120), lang: session.state().lang }).then(function (r) {
        if (r.status === 201 && r.p.id) {
          if (a.cid) mark(a.cid, 'sent', r.p.n);
          news(session.live({ type: 'started', id: r.p.id, token: r.p.token, seq: r.p.seq }));
          liveActive = Date.now();
          return poll();
        }
        online = false;
        if (a.cid) mark(a.cid, 'failed');
        news(session.live({ type: 'refused' }));
      }).catch(function () { online = false; news(session.live({ type: 'refused' })); });
    }
    if (a.type === 'live-send') return sendLive(a.cid || ('v' + rand().slice(0, 12)), a.text);
    if (a.type === 'live-end') {
      stopLive();
      return post({ action: 'end', id: a.chat, token: a.token }, true).catch(function () { /* left either way */ });
    }
  }
  /* a message that did not go: tap it to send it again, as the same message */
  doc.addEventListener('click', function (e) {
    var d = e.target.closest && e.target.closest('.pfa-asst__m--me[data-st="failed"]');
    if (!d || session.state().phase !== 'live') return;
    var cid = d.getAttribute('data-cid');
    var said = d.querySelector('.pfa-asst__said');
    if (cid && said) sendLive(cid, said.textContent);
  });
  /* they are writing: said at most every three seconds */
  function typing() {
    var st = session && session.state();
    if (!st || st.phase !== 'live' || !st.live || !st.live.id || !input.value.trim()) return;
    if (Date.now() - typedAt < 3000) return;
    typedAt = Date.now();
    liveActive = Date.now();
    post({ action: 'typing', id: st.live.id, token: st.live.token }).catch(function () {});
  }
  function soon() { clearTimeout(liveTimer); liveTimer = setTimeout(poll, 350); }
  function every() {
    if (doc.hidden) return 8000;
    return Date.now() - liveActive < 60000 ? 1000 : 3000;
  }
  function poll() {
    clearTimeout(liveTimer);
    var st = session.state();
    var l = st.live;
    if (st.phase !== 'live' || !l || !l.id) return;
    if (liveInFlight) { liveTimer = setTimeout(poll, 500); return; }
    liveInFlight = true;
    fetch('/api/live-chat?id=' + encodeURIComponent(l.id) + '&token=' + encodeURIComponent(l.token) + '&after=' + (l.seq || 0) + '&seen=' + (l.seq || 0), { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(json).then(function (r) {
        if (r.status === 404) return news(session.live({ type: 'news', status: 'closed', closedBy: 'gone', messages: [] }));
        if (!r.ok) return;
        var p = r.p || {};
        news(session.live(Object.assign({ type: 'news' }, p)));
        seenUpTo(p.staffSeenN);
        paintLive(p);
      }).catch(function () { /* tried again in a moment */ })
      .then(function () {
        liveInFlight = false;
        if (session.state().phase !== 'live') return;
        liveTimer = setTimeout(poll, every());
      });
  }
  function stopLive() { clearTimeout(liveTimer); liveTimer = null; }
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden && session && session.state().phase === 'live') soon(); });

  var siteDocs = null;
  /* What the chat could not answer, counted for the panel's Analytics
     (17 Nov 2026): the words only; the server strips numbers, emails and
     reference numbers before anything is kept (lib/analytics.js). */
  function missed(q) {
    try {
      fetch('/api/analytics', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: location.pathname, q: String(q).slice(0, 200) }) }).catch(function () {});
    } catch (_) { /* never in the visitor's way */ }
  }

  /* The names the site already shows, and only those (17 Nov 2026): who
     wrote each Care Guide as they asked to be credited, whose film is on
     The Wall, who runs each unit. Read once, from the same public answers
     the pages use; no reporter, member, caregiver or donor is ever in it. */
  var peopleList = null;
  function publicPeople() {
    if (peopleList) return peopleList;
    var get = function (url) { return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); };
    peopleList = Promise.all([
      get('/api/med-notes').then(function (d) { return d && Array.isArray(d.notes) ? d : get('/data/med-notes.json').then(function (o) { return { notes: ((o && o.notes) || []).map(function (n) { return Object.assign({}, n, { id: 'pfa-' + n.id }); }) }; }); }),
      get('/api/wall')
    ]).then(function (got) {
      var list = [];
      ((got[0] && got[0].notes) || []).forEach(function (n) {
        var parts = String(n.credit || '').split(',');
        if (parts[0].trim()) list.push({ name: parts[0].trim(), place: parts.slice(1).join(',').trim(), kind: 'guide', title: n.title, href: 'pet-health.html#note=' + encodeURIComponent(n.id) });
      });
      ((got[1] && got[1].films) || []).forEach(function (f) {
        if (f.credit) list.push({ name: f.credit, place: '', kind: 'film', title: f.title, href: 'wall.html#' + (f.wall === 'short' ? 'shortform' : 'longform') });
      });
      (window.PFA_ASSIST_UNITS || []).forEach(function (u) {
        if (u.p) list.push({ name: u.p, place: [u.c, u.s].filter(Boolean).join(', '), kind: 'unit', title: 'PFA ' + u.c, href: u.u });
      });
      return list;
    }).catch(function () { peopleList = null; return []; });
    return peopleList;
  }

  function siteText() {
    if (!siteDocs) {
      siteDocs = fetch('/assets/assistant-answers.json', { headers: { Accept: 'application/json' } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (ix) {
        return ((ix && ix.passages) || []).map(function (p) { return { title: p.t, url: p.u, heading: p.h, text: p.x }; });
      }).catch(function () { siteDocs = null; return []; });
    }
    return siteDocs;
  }

  /* CCAvenue's own page, through the same door the site's buttons use */
  function pay(a, to) {
    var f = doc.createElement('form');
    f.method = 'post';
    f.action = to || '/api/payment/create';
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
    checkOnline(false);
    var launch = doc.querySelector('.pfa-asst-launch');
    if (launch) { launch.setAttribute('aria-expanded', 'true'); launch.removeAttribute('data-new'); }
    if (session.state().phase === 'live') poll();
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
      session = FL.createSession({ state: kept.state, monthly: monthly, live: liveOnline, bag: shopBag });
      log = kept.log || [];
      log.forEach(function (x, i) { draw(x.who === 'me' ? { text: x.text, cid: x.cid, n: x.n, st: x.st === 'sending' ? 'failed' : x.st } : x.m, x.who, i === log.length - 1); });
      /* a payment page opened and came back, or the tab was reloaded mid-send:
         the conversation goes on from the menu, never sending twice */
      if (kept.state.phase === 'waiting') show(session.tap('#menu'), null);
      paintLang(session.state().lang);
      paintLive();
      /* a chat with a person carries on from page to page */
      if (kept.state.phase === 'live') { if (kept.state.live && kept.state.live.id) poll(); else show(session.tap('#endlive'), null); }
      logEl.scrollTop = logEl.scrollHeight;
    } else {
      session = FL.createSession({ lang: lang, monthly: monthly, live: liveOnline, bag: shopBag });
      show(session.start(), null);
    }
  }

  window.PFAAssistant = { open: open, hide: hide, say: function (t) { open(); say(t, null, false); } };
  var kept = load();
  if (kept && kept.open) open();
  /* closed, but someone at PFA may still reply: listen, and mark the button */
  else if (kept && kept.state && kept.state.phase === 'live') start();
  checkOnline(true);
})();
