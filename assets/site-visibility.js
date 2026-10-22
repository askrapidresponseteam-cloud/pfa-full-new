/* What the public site shows (owner, 8 Oct 2026: "Admin should be able to
   show/hide any section or content module ... without code changes. Changes
   should reflect on the public site immediately").

   One file, two lives.

   In a page: scripts/sync-chrome.js copies this file, without its comments,
   into an inline <script id="pfa-vis"> at the very top of the header include,
   so it runs on every page before a single section has been parsed. It reads
   the last state this browser saw (localStorage) and writes one <style> that
   hides what is hidden, so nothing hidden flashes up first and nothing has
   to be measured. assets/chrome.js then asks /api/site-visibility for the
   current state, saves it, and applies it again here, which is how a change
   made in the panel reaches the next page load and the page already open.

   In Node: top-level `this` is module.exports, so the tests require this
   same file and check the very CSS the pages get.

   The state, as the API sends it and as it is kept:
     { version, pages: ['units'], modules: ['laws#part-a'] }
     a page id     the file name without .html
     a module id   the page id, '#', and the id of a section on that page
                   (or the value of a data-module attribute on it)

   Anything malformed is dropped before it is used, so a value from storage or
   from the network can never write its own CSS.

   Hidden is hidden from view, not removed: the markup is still in the page
   source for anyone who reads it. The panel says so. */
(function (root) {
  'use strict';

  var KEY = 'pfa:visibility';
  /* Never hidden, whatever the state says; the server refuses them too and
     says why (LOCKED in lib/site-visibility.js). 1: the page. 2: the page and
     every part of it. */
  var LOCKED = { index: 1, track: 2, search: 2 };
  var NOTICE = 'This page is not available right now.';
  var HOME = 'Go to the home page';
  /* The three things this adds to a page, made here and found again by id. */
  var CSS_ID = 'pfa-vis-css';
  var ROBOTS_ID = 'pfa-vis-robots';
  var GONE_ID = 'pfa-gone';
  var PAGE = /^[a-z0-9][a-z0-9-]*$/;
  var PART = /^[A-Za-z][A-Za-z0-9_-]*$/;
  var applied = { version: 0, pages: [], modules: [] };
  var title = null;

  function pagesOf(state) {
    return (state && Array.isArray(state.pages) ? state.pages : []).filter(function (p) {
      return typeof p === 'string' && PAGE.test(p) && !LOCKED[p];
    });
  }
  function modulesOf(state) {
    return (state && Array.isArray(state.modules) ? state.modules : []).filter(function (m) {
      var at = typeof m === 'string' ? m.indexOf('#') : -1;
      return at > 0 && PAGE.test(m.slice(0, at)) && PART.test(m.slice(at + 1)) && LOCKED[m.slice(0, at)] !== 2;
    });
  }
  function clean(state) {
    return { version: Number(state && state.version) || 0, pages: pagesOf(state), modules: modulesOf(state) };
  }

  /* 'laws.html', '/laws', '/laws.html?q=x#a1', 'https://site/laws' -> 'laws'.
     The root, and an address that is only a fragment, are the home page. */
  function pageOf(url) {
    var p = String(url == null ? '' : url).split('#')[0].split('?')[0];
    p = p.slice(p.lastIndexOf('/') + 1).replace(/\.html$/, '');
    try { p = decodeURIComponent(p); } catch (e) {}
    return p || 'index';
  }

  /* Every way this site writes a link to one page: relative, from the root,
     absolute, each with or without a fragment or a query. */
  function linksTo(page) {
    var f = page + '.html';
    return ['a[href="' + f + '"]', 'a[href^="' + f + '#"]', 'a[href^="' + f + '?"]',
      'a[href$="/' + f + '"]', 'a[href*="/' + f + '#"]', 'a[href*="/' + f + '?"]'];
  }

  /* Pure. The state and the page being shown in; the CSS out, and whether
     this page itself is hidden. Each rule stands alone, because a browser
     that cannot read one selector drops the whole rule it is in: the plain
     link list comes first and needs nothing newer than attribute selectors,
     and the :has() tidying after it is a bonus where it is understood. */
  function plan(state, page) {
    var s = clean(state);
    var here = String(page || 'index');
    var gone = s.pages.indexOf(here) > -1;
    var links = [];
    var own = [];
    var css = '';
    s.pages.forEach(function (p) { links = links.concat(linksTo(p)); });
    s.modules.forEach(function (m) {
      var at = m.indexOf('#');
      var p = m.slice(0, at);
      var id = m.slice(at + 1);
      links.push('a[href$="' + p + '.html#' + id + '"]');
      if (p === here) {
        own.push('[id="' + id + '"]', '[data-module="' + id + '"]');
        /* Not the page's own entry in the menus, which says #top on it. */
        links.push('a[href="#' + id + '"]:not([aria-current])');
      }
    });
    /* On a hidden page, its own entry in the menus says #top, not its name. */
    if (gone) links.push('a[aria-current="page"]');
    if (own.length) css += own.join(',') + '{display:none!important}';
    if (links.length) {
      var list = links.join(',');
      css += list + '{display:none!important}';
      /* A section's own button in the header (Our Work, Learn) also leads to
         its first page. It stays, so the rest of its menu can still be
         opened; assets/chrome.js points it at the first item still shown. */
      css += links.map(function (l) { return '.navitem>' + l; }).join(',') + '{display:revert!important;pointer-events:none;cursor:default}';
      /* A list item whose only content is the link goes with it, and so does
         a menu, a phone-menu group or a footer column left with no link. */
      css += 'li:has(>:is(' + list + '):only-child){display:none!important}';
      css += '.navitem:not(:has(.menu>a:not(' + list + '))){display:none!important}';
      /* The phone menu keeps its rows in cards (.mnav__list, 22 Oct 2026),
         so a group is looked into, not just at its children: written for
         the old flat list, this hid every group the moment anything at all
         was hidden, and the phone menu opened empty. A card left with no
         row goes, and so does the caption over it. */
      css += '.mnav__group:not(:has(a:not(' + list + '))){display:none!important}';
      css += '.mnav__list:not(:has(>a:not(' + list + '))){display:none!important}';
      css += '.pfa-footer__col:not(:has(li>a:not(' + list + '))){display:none!important}';
      css += '.menu-label:has(+a:is(' + list + ')),.menu-label:has(+a:is(' + list + '))~.menu-sep,.mnav__sub:has(+a:is(' + list + ')),.mnav__sub:has(+.mnav__list:not(:has(>a:not(' + list + ')))){display:none!important}';
    }
    if (gone) {
      /* Everything the page itself brought, gone; the bar, the header, the
         phone's tab bar, the menus, search and the footer stay, so there is
         a way on. */
      css += 'body>:not(.announce):not(header):not(.pfa-tabs):not(.pfa-footer):not(.mnav):not(.cursor-layer):not(.pfa-search):not(#pfa-gone){display:none!important}'
        + '#pfa-gone{display:block!important;box-sizing:border-box;min-height:62vh;padding:calc(var(--ann,34px) + var(--nav,81px) + 72px) var(--gutter,20px) 96px;text-align:center;color:var(--ink,#111);background:#fff}'
        + '#pfa-gone h1{font-family:var(--display,Georgia,serif);font-weight:400;font-size:clamp(28px,4vw,44px);line-height:1.15;margin:0 0 20px}'
        + '#pfa-gone p{margin:0;font-size:16px}'
        + '#pfa-gone a{color:inherit;text-decoration:underline;text-underline-offset:4px}';
    }
    return { css: css, gone: gone };
  }

  /* Is this address hidden? A page, a section, or (with the registry's
     anchors, { page: { innerId: sectionId } }) anything inside a section.
     Site search asks this of every row it would show. */
  function blocked(url, state, anchors) {
    var s = clean(state || applied);
    var u = String(url == null ? '' : url);
    var page = pageOf(u);
    if (s.pages.indexOf(page) > -1) return true;
    var at = u.indexOf('#');
    if (at < 0 || !s.modules.length) return false;
    var hash = u.slice(at + 1);
    var part = (anchors && anchors[page] && anchors[page][hash]) || hash;
    return s.modules.indexOf(page + '#' + part) > -1;
  }

  function read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      return raw ? clean(JSON.parse(raw)) : null;
    } catch (e) { return null; }
  }
  function save(state) {
    try { root.localStorage.setItem(KEY, JSON.stringify(clean(state))); } catch (e) {}
  }

  function drop(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }

  /* Writes the plan into the page: the one <style>, and on a hidden page a
     polite notice with the way home, noindex, and its own title. Safe to call
     again with a new state; it undoes what no longer applies. */
  function apply(state) {
    var d = root.document;
    if (!d || !d.head) return null;
    applied = clean(state);
    var p = plan(applied, pageOf(root.location && root.location.pathname));
    var tag = d.getElementById(CSS_ID);
    if (!tag && p.css) {
      tag = d.createElement('style');
      tag.setAttribute('id', CSS_ID);
      d.head.appendChild(tag);
    }
    if (tag) tag.textContent = p.css;
    var robots = d.getElementById(ROBOTS_ID);
    var box = d.getElementById(GONE_ID);
    if (p.gone) {
      if (!robots) {
        robots = d.createElement('meta');
        robots.setAttribute('id', ROBOTS_ID);
        robots.setAttribute('name', 'robots');
        robots.setAttribute('content', 'noindex');
        d.head.appendChild(robots);
      }
      if (!box && d.body) {
        box = d.createElement('div');
        box.setAttribute('id', GONE_ID);
        var h = d.createElement('h1');
        h.textContent = NOTICE;
        var line = d.createElement('p');
        var home = d.createElement('a');
        home.setAttribute('href', '/');
        home.textContent = HOME;
        line.appendChild(home);
        box.appendChild(h);
        box.appendChild(line);
        d.body.insertBefore(box, d.body.firstChild);
      }
      if (title === null) title = d.title;
      d.title = 'Not available right now · People for Animals';
    } else {
      drop(robots);
      drop(box);
      if (title !== null) { d.title = title; title = null; }
    }
    return p;
  }

  root.PFA_VISIBILITY = {
    KEY: KEY, LOCKED: LOCKED, NOTICE: NOTICE,
    clean: clean, pageOf: pageOf, plan: plan, blocked: blocked,
    read: read, save: save, apply: apply,
    state: function () { return applied; }
  };
  /* Whatever happens here, the page it sits at the top of must still load. */
  try {
    if (root.document && root.document.head) apply(read());
  } catch (e) {}
}(this));
