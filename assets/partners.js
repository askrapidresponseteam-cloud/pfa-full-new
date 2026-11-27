/* Partners in giving (partners.html; owner, 27 Nov 2026: "what is the best
 * way to share the donors givings. it has to look amazing and stand out";
 * then, of the first cut: "the white bg logo thing looks yuck to the core..
 * plan and do the page better. it has to be world class").
 *
 * The page is dressed in the gift's own livery. Rosie's Heroes' ambulance is
 * painted white with a red wave over a sky-blue one and a saffron stripe, so
 * the page is white with that wave drawn across the foot of its opening, the
 * two logos standing on the white as they do on the ambulance's doors, never
 * in a box over the photograph.
 *
 * Every partnership written in the panel (lib/partners.js), read from
 * /api/partners. The amount given comes from the server only while it is to
 * be shown, and then takes its place among the facts; otherwise the facts
 * are one fewer and close up, with nothing said. render() is also run by
 * scripts/build-partners.js, which writes the first partnership into the page
 * for a browser without script and for search engines.
 */
(function (root) {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var PFA_LOGO = 'img/logo.png';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function parts(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? { d: Number(m[3]), m: MONTHS[Number(m[2]) - 1], y: m[1] } : null; }
  function day(iso) { var p = parts(iso); return p ? p.d + ' ' + p.m + ' ' + p.y : ''; }
  function paras(t) {
    return String(t || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return esc(p).replace(/\n/g, '<br>'); });
  }
  /* Rosie's Heroes' gift, PFA's gift: the possessive of a name ending in s */
  function whose(name) { return /s$/i.test(String(name)) ? name + '’' : name + '’s'; }
  /* "Priyanka Rao, President" -> name and role */
  function person(line) {
    var i = line.indexOf(',');
    return i > 0 ? '<b>' + esc(line.slice(0, i)) + '</b><span>' + esc(line.slice(i + 1).trim()) + '</span>' : '<b>' + esc(line) + '</b>';
  }

  /* the livery: a red wave over a sky-blue one, a saffron line under them */
  var WAVE = '<svg class="pg-wave" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
    + '<path class="pg-wave__blue" pathLength="1" d="M-10 62 C 240 20 470 92 730 54 S 1200 12 1450 46"/>'
    + '<path class="pg-wave__red" pathLength="1" d="M-10 40 C 250 -2 480 70 740 32 S 1210 -8 1450 24"/>'
    + '<path class="pg-wave__saffron" pathLength="1" d="M-10 84 L 1450 84"/></svg>';

  function render(p, first, today) {
    var hero = p.photos[0] || {};
    var H = first ? 'h1' : 'h2';
    var id = esc(p.id);
    var facts = [];
    if (p.gift) facts.push(['The gift', p.gift, p.giftName]);
    if (p.unit || p.place) facts.push(['Where it works', p.place || p.unit, p.place && p.unit ? p.unit : '']);
    if (p.givenOn) facts.push([p.givenOn > today ? 'Arrives' : 'Arrived', day(p.givenOn), '']);
    if (p.given) facts.push(['Given', p.given, '']);
    var out = [];
    out.push('<article class="pg" id="' + id + '" aria-labelledby="' + id + '-t">');

    /* the opening: words and both names on the white, the photograph beside
       them, the livery across the foot of both */
    out.push('<header class="pg-open"><div class="pg-open__words">'
      + '<p class="pg-with"><span class="pg-with__lead">A gift from</span>'
      + (p.logo ? '<img class="pg-with__donor" src="' + esc(p.logo) + '" alt="' + esc(p.donor) + '" width="190" height="134">' : '<span class="pg-with__name">' + esc(p.donor) + '</span>')
      + '<span class="pg-with__lead">to</span><img class="pg-with__pfa" src="' + PFA_LOGO + '" alt="People for Animals" width="160" height="55"></p>'
      + '<' + H + ' class="pg-title" id="' + id + '-t">' + esc(p.headline) + '</' + H + '>'
      + '<p class="pg-sub">' + esc(p.donor) + (p.unit ? ' gave ' + esc(p.unit) + ' ' + esc(lower(p.gift) || 'a gift') : '') + (p.giftName ? ', now known on its streets as ' + esc(p.giftName) : '') + '.</p>'
      + '</div><figure class="pg-open__photo"><img src="' + esc(hero.src) + '" alt="' + esc(hero.alt || '') + '" fetchpriority="high" decoding="async"></figure>'
      + WAVE + '</header>');

    if (facts.length) {
      out.push('<dl class="pg-facts" data-n="' + facts.length + '">' + facts.map(function (f) {
        return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + (f[2] ? '<small>' + esc(f[2]) + '</small>' : '') + '</dd></div>';
      }).join('') + '</dl>');
    }
    if (p.helped > 0) {
      out.push('<p class="pg-count"><b>' + esc(p.helped) + '</b><span>' + esc(p.countLabel) + ' so far, with ' + esc(whose(p.donor)) + ' gift</span></p>');
    }

    /* the thanks, as a letter: to the people by name */
    if (p.thanks || p.people.length) {
      out.push('<div role="region" class="pg-thanks" aria-labelledby="' + id + '-k"><div class="pg-thanks__in">'
        + '<h2 class="pg-thanks__to" id="' + id + '-k">To ' + esc(p.donor) + '</h2>'
        + (p.thanks ? '<div class="pg-letter">' + paras(p.thanks).map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div>' : '')
        + '<div class="pg-thanks__who">'
        + (p.people.length ? '<ul class="pg-people">' + p.people.map(function (l) { return '<li>' + person(l) + '</li>'; }).join('') + '</ul>' : '')
        + (p.donorLine ? '<p class="pg-thanks__about">' + esc(p.donorLine) + '</p>' : '')
        + (p.letter ? '<a class="pg-thanks__letter" href="' + esc(p.letter) + '">Read our letter of thanks</a>' : '')
        + (p.link ? '<a class="pg-thanks__link" href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.donor) + ' on the web</a>' : '')
        + '</div></div></div>');
    }

    /* the gift: its story, and the photographs, one large and the rest beside it */
    var more = p.photos.slice(1);
    if (p.story || more.length) {
      out.push('<div role="region" class="pg-gift" aria-labelledby="' + id + '-s"><div class="pg-gift__text">'
        + '<h2 class="pg-h" id="' + id + '-s">' + esc(p.giftName || 'The gift') + '</h2>'
        + paras(p.story).map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div>'
        + (more.length ? '<ul class="pg-photos" data-n="' + Math.min(more.length, 3) + '">' + more.map(function (ph, i) {
          return '<li><button type="button" data-pic="' + id + ':' + (i + 1) + '" aria-label="' + esc('See larger: ' + (ph.alt || 'photograph')) + '"><img src="' + esc(ph.src) + '" alt="' + esc(ph.alt || '') + '" loading="lazy" decoding="async"></button></li>';
        }).join('') + '</ul>' : '') + '</div>');
    }

    /* what it has done: the dates down the side, oldest first */
    if (p.timeline.length) {
      out.push('<div role="region" class="pg-log" aria-labelledby="' + id + '-w"><h2 class="pg-h" id="' + id + '-w">What it has done</h2><ol class="pg-log__list">'
        + p.timeline.map(function (e) {
          var soon = e.date > today, d = parts(e.date) || { d: '', m: '', y: '' };
          return '<li' + (soon ? ' data-soon' : '') + '>'
            + '<time class="pg-log__when" datetime="' + esc(e.date) + '"><b>' + esc(d.d) + '</b> ' + esc(d.m) + ' <span>' + esc(d.y) + '</span></time>'
            + '<div class="pg-log__what">' + (soon ? '<p class="pg-log__soon">Coming up</p>' : '')
            + '<h3>' + esc(e.title) + '</h3>' + (e.text ? '<p>' + esc(e.text) + '</p>' : '')
            + (e.count > 0 ? '<p class="pg-log__n"><b>' + esc(e.count) + '</b> ' + esc(p.countLabel) + '</p>' : '')
            + (e.photo ? '<img src="' + esc(e.photo) + '" alt="' + esc(e.photoAlt || '') + '" loading="lazy" decoding="async">' : '')
            + '</div></li>';
        }).join('') + '</ol></div>');
    }

    out.push('<aside class="pg-next" aria-label="Give to PFA"><p>' + esc(whose(p.donor)) + ' gift is at work every day in ' + esc((p.place || '').split(',')[0] || 'India') + '. Yours can be next.</p>'
      + '<p class="pg-next__acts"><a class="pg-next__give" href="donate.html">Give to PFA</a><a class="pg-next__partner" href="csr.html">Partner with PFA</a></p></aside>');
    out.push('</article>');
    return out.join('');
  }
  function lower(s) { s = String(s || ''); return s ? s.charAt(0).toLowerCase() + s.slice(1) : ''; }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { render: render }; return; }

  /* ---- in the browser ---- */
  var holder = document.querySelector('[data-partners]');
  if (!holder) return;
  function todayInIndia() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }

  var box = null, back = null;
  function show(src, alt, from) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'pg-box'; box.hidden = true;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photograph');
      box.innerHTML = '<img alt=""><p></p><button type="button">Close</button>';
      document.body.appendChild(box);
      box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'BUTTON') shut(); });
      document.addEventListener('keydown', function (e) {
        if (!box || box.hidden) return;
        if (e.key === 'Escape') shut();
        /* the one control inside keeps the focus: Tab never reaches the page behind */
        else if (e.key === 'Tab') { e.preventDefault(); box.querySelector('button').focus(); }
      });
    }
    back = from;
    box.querySelector('img').src = src; box.querySelector('img').alt = alt || '';
    box.querySelector('p').textContent = alt || '';
    box.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    box.querySelector('button').focus();
  }
  function shut() {
    box.hidden = true;
    document.documentElement.style.overflow = '';
    if (back) back.focus({ preventScroll: true });
  }

  var LIST = [];
  holder.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pic]');
    if (!b) return;
    var bits = b.getAttribute('data-pic').split(':');
    var p = LIST.filter(function (x) { return x.id === bits[0]; })[0];
    var ph = p && p.photos[Number(bits[1])];
    if (ph) show(ph.src, ph.alt, b);
  });

  /* none on the site (all taken off, or drafts): not the partnership the page
     was written with, which may be the one just taken off (review of 27 Nov
     2026) */
  function none() {
    holder.innerHTML = '<div class="pg-none"><h1 class="pg-title">Partners in giving</h1>'
      + '<p>The gifts that keep PFA\u2019s rescues going, and what each one does, are shown here as they are given.</p>'
      + '<p class="pg-next__acts"><a class="pg-next__give" href="donate.html">Give to PFA</a><a class="pg-none__partner" href="csr.html">Partner with PFA</a></p></div>';
    holder.setAttribute('aria-busy', 'false');
  }
  function paint(list) {
    if (!list.length) return none();
    LIST = list;
    var today = todayInIndia();
    var html = '';
    if (list.length > 1) {
      html += '<nav class="pg-index" aria-label="Partners"><ul>' + list.map(function (p) {
        return '<li><a href="#' + esc(p.id) + '"><img src="' + esc((p.photos[0] || {}).src) + '" alt=""><span><b>' + esc(p.donor) + '</b>' + esc(p.gift || p.headline) + (p.place ? ', ' + esc(p.place) : '') + '</span></a></li>';
      }).join('') + '</ul></nav>';
    }
    html += list.map(function (p, i) { return render(p, i === 0, today); }).join('');
    holder.innerHTML = html;
    holder.setAttribute('aria-busy', 'false');
    var want = (location.hash || '').slice(1) || new URLSearchParams(location.search).get('p');
    var el = want && document.getElementById(want);
    if (el && el !== holder.firstElementChild) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 60);
  }

  fetch('/api/partners', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    /* only a list the server says it read; anything else keeps the page */
    if (!d || d.ok !== true || !Array.isArray(d.partners)) return;
    paint(d.partners.filter(function (p) { return p && p.id && p.photos && p.photos.length; }));
  }).catch(function () { /* the page keeps what it was written with */ });
})(this);
