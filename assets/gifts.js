/* The Seasonal gifts page (gifts.html).

   The page as written is the page with no season on: the year-round gifts.
   This asks /api/gifts which season is on today (lib/gift-seasons.js) and,
   if one is, puts in its name, headline and line, its offers and its
   collections, above the year-round gifts. With none on, it says which
   season comes next. If the answer cannot be had, the page stays as written.

   Everything from the server is set as text, never as markup; a link or a
   picture is used only if it is one of the site's own or an https address,
   which the server has already checked. */
(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function day(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] : '';
  }
  function rupees(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function safe(url, picture) {
    var u = String(url || '');
    if (/^https:\/\//i.test(u)) return u;
    if (picture) return /^(img|media)\/[A-Za-z0-9/_.-]+$/.test(u) && u.indexOf('..') === -1 ? u : '';
    return /^[a-z0-9][a-z0-9-]*\.html([#?][A-Za-z0-9_=&%#?-]*)?$/.test(u) ? u : '';
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== '') n.textContent = text;
    return n;
  }
  function $(id) { return document.getElementById(id); }

  function card(item) {
    var li = el('li');
    var href = safe(item.href, false) || 'shop.html';
    var a = el('a', 'gf-card');
    a.href = href;
    if (/^https:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    var pic = safe(item.image, true);
    var box = el('span', pic ? 'gf-card__img' : 'gf-card__img gf-card__img--word');
    if (pic) {
      var img = el('img');
      img.src = pic; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      box.appendChild(img);
    } else {
      box.appendChild(el('span', '', item.title));
    }
    a.appendChild(box);
    if (item.by) a.appendChild(el('p', 'gf-card__by', item.by));
    a.appendChild(el('h4', '', item.title));
    if (item.text) a.appendChild(el('p', 'gf-card__text', item.text));
    if (item.type === 'piece' && item.price) {
      var p = el('p', 'gf-card__price');
      p.appendChild(el('b', '', rupees(item.price)));
      if (item.listPrice) p.appendChild(el('s', '', rupees(item.listPrice)));
      a.appendChild(p);
    } else if (item.price) {
      var q = el('p', 'gf-card__price');
      q.appendChild(el('b', '', item.price));
      a.appendChild(q);
    }
    a.appendChild(el('span', 'gf-card__go', item.type === 'piece' ? 'See it in the shop' : 'Give this'));
    li.appendChild(a);
    return li;
  }

  function season(s) {
    var label = s.name + ' ' + s.year;
    $('gfKicker').textContent = label;
    $('gfTitle').textContent = s.headline;
    if (s.intro) $('gfLede').textContent = s.intro;
    var when = $('gfWhen');
    when.textContent = '';
    when.appendChild(document.createTextNode(label + ' gifts, '));
    when.appendChild(el('b', '', day(s.startDate) + ' to ' + day(s.endDate)));
    when.hidden = false;
    document.title = label + ' gifts | People for Animals';

    var offers = s.offers || [];
    if (offers.length) {
      var ul = $('gfOffers');
      ul.textContent = '';
      offers.forEach(function (o) {
        var li = el('li', 'gf-offer');
        li.appendChild(el('h3', '', o.title));
        if (o.detail) li.appendChild(el('p', '', o.detail));
        if (o.until) li.appendChild(el('p', 'gf-until', 'Until ' + day(o.until)));
        ul.appendChild(li);
      });
      $('gfOffersKicker').textContent = label;
      $('offers').hidden = false;
    }

    var cols = s.collections || [];
    if (cols.length) {
      var box = $('gfCols');
      box.textContent = '';
      cols.forEach(function (c) {
        var wrap = el('div', 'gf-col');
        var head = el('div', 'gf-col__head');
        head.appendChild(el('h3', '', c.title));
        if (c.blurb) head.appendChild(el('p', '', c.blurb));
        wrap.appendChild(head);
        var grid = el('ul', 'gf-grid');
        (c.items || []).forEach(function (it) { grid.appendChild(card(it)); });
        wrap.appendChild(grid);
        box.appendChild(wrap);
      });
      $('gfColKicker').textContent = label;
      $('gfColTitle').textContent = 'Gifts for ' + s.name + '.';
      $('collections').hidden = false;
      $('gfGo').setAttribute('href', '#collections');
    }
  }

  function upcoming(n) {
    var when = $('gfWhen');
    when.textContent = '';
    when.appendChild(document.createTextNode('Next: ' + n.name + ' ' + n.year + ' gifts, from '));
    when.appendChild(el('b', '', day(n.startDate)));
    when.hidden = false;
  }

  if (!window.fetch) return;
  fetch('/api/gifts', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.ok) return;
      if (data.season && data.season.headline) season(data.season);
      else if (data.next) upcoming(data.next);
    })
    .catch(function () { /* the page as written: the year-round gifts */ });
})();
