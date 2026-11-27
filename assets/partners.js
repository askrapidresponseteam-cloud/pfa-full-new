/* Partners in giving (partners.html; owner, 27 Nov 2026: "what is the best
 * way to share the donors givings. it has to look amazing and stand out").
 *
 * Every partnership written in the panel (lib/partners.js), read from
 * /api/partners: the photograph with both names on it, the gift, the
 * animals it has helped so far, the thanks to the people who gave, the
 * photographs and the timeline. The amount given comes from the server only
 * while it is to be shown, and then takes its place in the row of facts;
 * otherwise the row is one fact shorter and closes up, with nothing said.
 */
(function () {
  'use strict';
  var root = document.querySelector('[data-partners]');
  if (!root) return;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var PFA_LOGO = 'img/logo.png';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }
  function today() {
    var d = new Date(Date.now() + 330 * 60000);
    return d.toISOString().slice(0, 10);
  }
  /* Rosie's Heroes' gift, PFA's gift: the possessive of a name ending in s */
  function whose(name) { return /s$/i.test(String(name)) ? name + '\u2019' : name + '\u2019s'; }
  function paras(t) {
    return String(t || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) { return esc(p).replace(/\n/g, '<br>'); });
  }
  /* "Priyanka Rao, President" -> name and role */
  function person(line) {
    var i = line.indexOf(',');
    return i > 0 ? '<b>' + esc(line.slice(0, i)) + '</b><span>,' + esc(line.slice(i + 1)) + '</span>' : '<b>' + esc(line) + '</b>';
  }

  function render(p, first) {
    var hero = p.photos[0] || {};
    var H = first ? 'h1' : 'h2';
    var facts = [];
    if (p.gift) facts.push(['The gift', p.gift, p.giftName]);
    if (p.unit || p.place) facts.push(['Where it works', p.place || p.unit, p.place && p.unit ? p.unit : '']);
    if (p.givenOn) facts.push([new Date(p.givenOn) > new Date() ? 'Arrives' : 'Arrived', day(p.givenOn), '']);
    if (p.given) facts.push(['Given', p.given, '']);
    var out = [];
    out.push('<article class="pg" id="' + esc(p.id) + '" aria-labelledby="' + esc(p.id) + '-t">');
    out.push('<header class="pg-hero"><img class="pg-hero__img" src="' + esc(hero.src) + '" alt="' + esc(hero.alt || '') + '" fetchpriority="high" decoding="async">'
      + '<div class="pg-hero__shade" aria-hidden="true"></div><div class="pg-hero__in">'
      + '<p class="pg-kicker">Partners in giving</p>'
      + '<div class="pg-lock"><img class="pg-lock__pfa" src="' + PFA_LOGO + '" alt="People for Animals"><span class="pg-lock__x" aria-hidden="true">&amp;</span>'
      + (p.logo ? '<img class="pg-lock__donor" src="' + esc(p.logo) + '" alt="' + esc(p.donor) + '">' : '<span class="pg-lock__name">' + esc(p.donor) + '</span>') + '</div>'
      + '<' + H + ' class="pg-title" id="' + esc(p.id) + '-t">' + esc(p.headline) + '</' + H + '>'
      + '<p class="pg-sub">Given by <b>' + esc(p.donor) + '</b>' + (p.unit ? ' to <b>' + esc(p.unit) + '</b>' : '') + (p.place ? ', ' + esc(p.place) : '') + '</p>'
      + '</div></header>');
    if (facts.length) {
      out.push('<ul class="pg-facts">' + facts.map(function (f) {
        return '<li><span>' + esc(f[0]) + '</span><b>' + esc(f[1]) + '</b>' + (f[2] ? '<small>' + esc(f[2]) + '</small>' : '') + '</li>';
      }).join('') + '</ul>');
    }
    if (p.helped > 0) out.push('<p class="pg-count"><b>' + esc(p.helped) + '</b><span>' + esc(p.countLabel) + ' so far, with ' + esc(whose(p.donor)) + ' gift</span></p>');
    if (p.thanks || p.people.length) {
      out.push('<section class="pg-sec pg-thanks" aria-label="Thank you">'
        + (p.thanks ? '<blockquote class="pg-quote">' + paras(p.thanks).join('<br><br>') + '</blockquote>' : '<div></div>')
        + '<div class="pg-who">' + (p.logo ? '<img src="' + esc(p.logo) + '" alt="" loading="lazy">' : '')
        + (p.donorLine ? '<p>' + esc(p.donorLine) + '</p>' : '')
        + (p.people.length ? '<ul class="pg-people">' + p.people.map(function (l) { return '<li>' + person(l) + '</li>'; }).join('') + '</ul>' : '')
        + (p.link ? '<a class="pg-link" href="' + esc(p.link) + '" target="_blank" rel="noopener">Visit ' + esc(p.donor) + '</a>' : '')
        + '</div></section>');
    }
    var more = p.photos.slice(1);
    if (p.story || more.length) {
      out.push('<section class="pg-sec" aria-labelledby="' + esc(p.id) + '-s"><h3 class="pg-h" id="' + esc(p.id) + '-s">The gift</h3>'
        + paras(p.story).map(function (t) { return '<p class="pg-story">' + t + '</p>'; }).join('')
        + (more.length ? '<ul class="pg-gallery">' + more.map(function (ph, i) {
          return '<li><button type="button" data-pic="' + esc(p.id) + ':' + (i + 1) + '" aria-label="' + esc('See larger: ' + (ph.alt || 'photograph')) + '"><img src="' + esc(ph.src) + '" alt="' + esc(ph.alt || '') + '" loading="lazy" decoding="async"></button></li>';
        }).join('') + '</ul>' : '') + '</section>');
    }
    if (p.timeline.length) {
      var now = today();
      out.push('<section class="pg-sec" aria-labelledby="' + esc(p.id) + '-w"><h3 class="pg-h" id="' + esc(p.id) + '-w">What it has done</h3><ol class="pg-time">'
        + p.timeline.map(function (e) {
          var soon = e.date > now;
          return '<li' + (soon ? ' data-soon' : '') + (e.photo ? ' class="has-photo"' : '') + '><div>'
            + '<p class="pg-time__when"><time datetime="' + esc(e.date) + '">' + esc(day(e.date)) + '</time>'
            + (soon ? '<span class="pg-time__soon">Coming up</span>' : '') + (e.count > 0 ? '<span class="pg-time__n">' + esc(e.count) + ' ' + esc(p.countLabel) + '</span>' : '') + '</p>'
            + '<h4>' + esc(e.title) + '</h4>' + (e.text ? '<p class="pg-time__text">' + esc(e.text) + '</p>' : '') + '</div>'
            + (e.photo ? '<figure><img src="' + esc(e.photo) + '" alt="' + esc(e.photoAlt || '') + '" loading="lazy" decoding="async"></figure>' : '')
            + '</li>';
        }).join('') + '</ol></section>');
    }
    out.push('<div class="pg-cta"><p>Every gift to PFA goes to work for animals, and you see what it does.</p>'
      + '<div class="pg-cta__acts"><a class="is-fill" href="donate.html">Give to PFA</a><a href="csr.html">Partner with us</a></div></div>');
    out.push('</article>');
    return out.join('');
  }

  /* a photograph, larger, and back where it was on close */
  var box = null, back = null;
  function show(src, alt, from) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'pg-box'; box.hidden = true;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photograph');
      box.innerHTML = '<img alt=""><p></p><button type="button">Close</button>';
      document.body.appendChild(box);
      box.addEventListener('click', function (e) { if (e.target === box || e.target.tagName === 'BUTTON') shut(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box && !box.hidden) shut(); });
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

  function paint(list) {
    if (!list.length) return;
    var html = '';
    if (list.length > 1) {
      html += '<nav class="pg-intro" aria-label="Partners"><ul class="pg-index">' + list.map(function (p) {
        return '<li><a href="#' + esc(p.id) + '"><img src="' + esc((p.photos[0] || {}).src) + '" alt=""><span><b>' + esc(p.donor) + '</b><span>' + esc(p.gift || p.headline) + (p.place ? ', ' + esc(p.place) : '') + '</span></span></a></li>';
      }).join('') + '</ul></nav>';
    }
    html += list.map(function (p, i) { return render(p, i === 0); }).join('');
    root.innerHTML = html;
    root.setAttribute('aria-busy', 'false');
    var fallback = document.getElementById('pgFallback');
    if (fallback) fallback.remove();
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pic]');
      if (!b) return;
      var bits = b.getAttribute('data-pic').split(':');
      var p = list.filter(function (x) { return x.id === bits[0]; })[0];
      var ph = p && p.photos[Number(bits[1])];
      if (ph) show(ph.src, ph.alt, b);
    });
    var want = (location.hash || '').slice(1) || new URLSearchParams(location.search).get('p');
    if (want) {
      var el = document.getElementById(want);
      if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 60);
    }
  }

  fetch('/api/partners', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
    paint(d && Array.isArray(d.partners) ? d.partners.filter(function (p) { return p && p.id && p.photos && p.photos.length; }) : []);
  }).catch(function () { /* the page keeps what it was written with */ });
})();
