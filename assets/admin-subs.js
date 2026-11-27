/* The panel's Submissions list, as tiles (owner, 26 Nov 2026: "make these
   tiles. and when something is unread- have that unread notification type
   thingie..").

   One tile a form: the reference, when it came, its kind, who sent it, its
   status and who has it. A form nobody in the office has opened yet, or
   whose sender wrote back after it was last opened, is unread, as a
   notification is: a tinted tile, a red dot by the name and a New mark,
   counted at the top. Opening it (anyone, on any computer) reads it for
   everyone; the server keeps when (lib/routes/admin/case.js lastOpenedAt,
   lib/routes/admin/records.js unreadOf).

   Over the list, one tile a kind of form ("make these tiles- for
   segments"): how many are Waiting, a red count of the unread, and
   pressing one shows only that kind, pressing it again every kind. Counted
   by the server (lib/routes/admin/records.js segmentsOf).

   admin.html's submissions(reset) calls PFASubs.load(reset); the filters,
   Load more and the case drawer stay where they are. Text wraps, never cut. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var cursor = null;

  var style = document.createElement('style');
  style.textContent = [
    '.st-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:12px}',
    '.st{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px 18px 18px;border:1px solid var(--line);background:var(--paper);transition:border-color .2s,box-shadow .2s}',
    '.st:hover{border-color:var(--ink);box-shadow:0 6px 18px rgba(0,0,0,.06)}',
    '.st:focus-within{border-color:var(--ink)}',
    '.st__top{display:flex;align-items:baseline;justify-content:space-between;gap:10px}',
    '.st__top .rowopen{font-size:15px;overflow-wrap:anywhere}',
    /* the whole tile opens the form: the reference is the one control */
    '.st__top .rowopen::after{content:"";position:absolute;inset:0}',
    '.st__top .rowopen:focus-visible{outline:none}',
    '.st__top .rowopen:focus-visible::after{outline:2px solid var(--ink);outline-offset:-2px}',
    '.st__when{flex:none;font-size:12px;color:var(--muted);white-space:nowrap}',
    '.st__kind{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-size:14px;line-height:1.4}',
    '.st__from{margin:0;font-size:14px;line-height:1.45;overflow-wrap:anywhere}',
    '.st__from b{display:block;font-weight:600}',
    '.st__from span{display:block;color:var(--muted);font-size:13px}',
    '.st__flags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:auto;padding-top:4px}',
    '.st__with{font-size:12px;color:var(--muted);overflow-wrap:anywhere}',
    /* unread: as a notification is marked */
    '.st.is-unread{background:#fff5f2;border-color:#f3c9bd}',
    '.st.is-unread:hover{border-color:#ff3b18}',
    '.st.is-unread .st__from b{font-weight:800}',
    '.st.is-unread .st__from b::before{content:"";display:inline-block;width:8px;height:8px;margin:0 8px 2px 0;border-radius:50%;background:#ff3b18;vertical-align:middle}',
    '.flag[data-s="unread"]{border-color:#ff3b18;background:#ff3b18;color:#fff;font-weight:700}',
    '.st-empty{grid-column:1 / -1}',
    /* the same person's form for the same thing, sent before or since */
    '.st__tie{position:relative;z-index:1;margin:0;font-size:12.5px;line-height:1.45;color:#a3361b;overflow-wrap:anywhere}',
    '.st__tie button{padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px;cursor:pointer}',
    '.st__tie button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}',
    '.st-count{display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:3px 9px;border-radius:11px;background:#ff3b18;color:#fff;font-size:11px;font-weight:700;letter-spacing:.04em;line-height:1.4}',
    '.st-count[hidden]{display:none}',
    /* the segments: one tile a kind of form, with a red count of the unread,
       as a notification count is; pressing one shows only that kind */
    '.sg-grid{list-style:none;margin:0 0 16px;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));grid-auto-rows:1fr;gap:10px}',
    /* every tile the size of the tallest (27 Nov 2026: "can the tiles be of the same dimensions all of them") */
    '.sg-grid > li{display:flex;min-width:0}',
    '.sg--more{min-height:0;justify-content:center;padding:14px;border-style:dashed;color:var(--muted)}',
    '.sg--more:hover{color:var(--ink)}',
    '.sg{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;width:100%;height:100%;min-height:78px;box-sizing:border-box;padding:14px 44px 14px 14px;border:1px solid var(--line);background:var(--paper);color:var(--ink);font:inherit;text-align:left;cursor:pointer;transition:border-color .2s,box-shadow .2s,background .2s}',
    '.sg:hover{border-color:var(--ink);box-shadow:0 6px 18px rgba(0,0,0,.06)}',
    '.sg:focus-visible{outline:2px solid var(--ink);outline-offset:2px}',
    '.sg[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:#fff}',
    '.sg[aria-pressed="true"] .sg__sub{color:rgba(255,255,255,.72)}',
    '.sg__name{font-size:14px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}',
    '.sg__sub{font-size:12px;line-height:1.4;color:var(--muted)}',
    '.sg__count{position:absolute;top:10px;right:10px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#ff3b18;color:#fff;font-size:11.5px;font-weight:700;line-height:22px;text-align:center}',
    '.sg__count[hidden]{display:none}',
    '.sg.has-unread{border-color:#f3c9bd;background:#fff5f2}',
    '.sg.has-unread[aria-pressed="true"]{background:var(--ink);border-color:var(--ink)}',
    /* the tiles are the kind filter; the list of kinds is kept only for them */
    '.sg-on #subKind{display:none}'
  ].join('\n');
  document.head.appendChild(style);

  function when(value) {
    if (!value) return '-';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function contactOf(fields) {
    var f = fields || {};
    var name = '', email = '', mobile = '';
    Object.keys(f).forEach(function (k) {
      var v = String(f[k] == null ? '' : f[k]).trim();
      if (!v) return;
      if (!name && /^(name|full ?name|your name|contact name)$/i.test(k)) name = v;
      if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) email = v;
      if (!mobile && /^[+ ]?[\d ]{10,14}$/.test(v) && /\d{10}/.test(v.replace(/\D/g, ''))) mobile = v;
    });
    return { name: name, email: email, mobile: mobile };
  }
  var STATUS_WORDS = { 'new': 'Waiting', 'in-progress': 'In progress', handled: 'Handled', spam: 'Spam' };
  function flag(status, label) {
    return '<span class="flag" data-s="' + esc(status) + '">' + esc(label || STATUS_WORDS[status] || status) + '</span>';
  }
  function wrote(r) {
    return r && r.awaitingReply ? ' <span class="flag" data-s="wrote" title="' + esc('Wrote back ' + when(r.lastInboundAt || r.lastReplyAt)) + '">Wrote back</span>' : '';
  }

  /* "Why are there two applications for the same person?" (27 Nov 2026):
     the same person's form for the same thing, tied by the server
     (lib/repeat-forms.js), each a press away */
  function ties(r) {
    var go = function (ref) { return '<button type="button" data-open-case="' + esc(ref) + '">' + esc(ref) + '</button>'; };
    var out = '';
    if (r.repeatOf) out += '<p class="st__tie">Same person, same application, sent before as ' + go(r.repeatOf) + '</p>';
    var again = r.repeats || [];
    if (again.length) out += '<p class="st__tie">Sent again by the same person as ' + again.map(go).join(', ') + '</p>';
    return out;
  }
  function tile(r) {
    var c = contactOf(r.fields);
    var who = c.name || c.email || c.mobile || 'Someone';
    var photos = r.attachments ? ' <span class="flag">' + (r.kind === 'PFA-CG' && r.attachments >= 2 ? 'photo + proof' : r.attachments + (r.attachments === 1 ? ' photo' : ' photos')) + '</span>' : '';
    return '<li class="st' + (r.unread ? ' is-unread' : '') + '" data-ref="' + esc(r.reference) + '" data-kind="' + esc(r.kind) + '">'
      + '<div class="st__top"><button class="rowopen" type="button" data-open-case="' + esc(r.reference) + '" aria-label="'
      + esc('Open ' + r.reference + ', ' + (r.kindLabel || r.kind) + ' from ' + who + (r.unread ? ', unread' : '')) + '">' + esc(r.reference) + '</button>'
      + '<span class="st__when">' + esc(when(r.createdAt)) + '</span></div>'
      + '<p class="st__kind">' + esc(r.kindLabel || r.kind) + photos + '</p>'
      + '<p class="st__from"><b>' + esc(c.name || '-') + '</b>' + (c.email || c.mobile ? '<span>' + esc(c.email || c.mobile) + '</span>' : '') + '</p>'
      + '<div class="st__flags">' + (r.unread ? '<span class="flag" data-s="unread">New</span> ' : '') + flag(r.status, r.statusLabel) + wrote(r)
      + (r.assignedTo ? '<span class="st__with">With ' + esc(r.assignedTo) + '</span>' : '') + '</div>'
      + ties(r)
      + '</li>';
  }

  /* ---- the segments ---- */
  var SEG = [];
  var allKinds = false;
  function segBox() {
    var box = $('#subSegs');
    if (box) return box;
    var tools = document.querySelector('.pane[data-pane="submissions"] .subtools');
    if (!tools) return null;
    box = document.createElement('ol');
    box.className = 'sg-grid'; box.id = 'subSegs';
    box.setAttribute('aria-label', 'Kinds of form');
    tools.parentNode.insertBefore(box, tools);
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-seg-more]')) { allKinds = !allKinds; paintSegs(); return; }
      var b = e.target.closest('[data-seg]');
      if (!b) return;
      var sel = $('#subKind');
      var k = b.getAttribute('data-seg');
      sel.value = sel.value === k ? '' : k;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return box;
  }
  function paintSegs() {
    var box = segBox();
    if (!box || !SEG.length) return;
    var on = $('#subKind').value;
    var all = SEG.reduce(function (n, g) { return n + g.unread; }, 0);
    var waitingAll = SEG.reduce(function (n, g) { return n + g.waiting; }, 0);
    function one(key, name, waiting, unread) {
      var label = name + ', ' + (waiting ? waiting + ' waiting' : 'nothing waiting') + (unread ? ', ' + unread + ' unread' : '');
      return '<li><button type="button" class="sg' + (unread ? ' has-unread' : '') + '" data-seg="' + esc(key) + '" aria-pressed="' + (on === key ? 'true' : 'false') + '" aria-label="' + esc(label) + '">'
        + '<span class="sg__name">' + esc(name) + '</span>'
        + '<span class="sg__sub">' + esc(waiting ? waiting + ' waiting' : 'Nothing waiting') + '</span>'
        + '<span class="sg__count" aria-hidden="true"' + (unread ? '' : ' hidden') + '>' + esc(unread > 99 ? '99+' : String(unread)) + '</span></button></li>';
    }
    /* what has something in it comes first, the unread before the rest;
       the kinds with nothing in them wait under + More kinds */
    var busy = SEG.filter(function (g) { return g.unread || g.waiting || g.kind === on; })
      .sort(function (a, b) { return (b.unread - a.unread) || (b.waiting - a.waiting); });
    var quiet = SEG.filter(function (g) { return busy.indexOf(g) < 0; });
    var shown = busy.concat(allKinds ? quiet : []);
    box.innerHTML = one('', 'Every kind', waitingAll, all) + shown.map(function (g) { return one(g.kind, g.label || g.kind, g.waiting, g.unread); }).join('')
      + (quiet.length ? '<li><button type="button" class="sg sg--more" data-seg-more aria-expanded="' + (allKinds ? 'true' : 'false') + '">'
        + '<span class="sg__name">' + esc(allKinds ? 'Fewer kinds' : '+ ' + quiet.length + ' more ' + (quiet.length === 1 ? 'kind' : 'kinds')) + '</span></button></li>' : '');
    document.querySelector('.pane[data-pane="submissions"]').classList.add('sg-on');
  }
  function loadSegs() {
    A.api('/api/admin/records?type=segments').then(function (d) {
      SEG = (d && d.segments) || [];
      /* the list of kinds knows every kind the tiles do */
      var sel = $('#subKind');
      SEG.forEach(function (g) {
        if (![].some.call(sel.options, function (o) { return o.value === g.kind; })) {
          var o = document.createElement('option'); o.value = g.kind; o.textContent = g.label || g.kind; sel.appendChild(o);
        }
      });
      paintSegs();
    }).catch(function () { /* the list of kinds stays as it was */ });
  }

  function counted() {
    var body = $('#subRows');
    var n = body ? body.querySelectorAll('.st.is-unread').length : 0;
    var shown = body ? body.querySelectorAll('.st').length : 0;
    var note = $('#paneNote');
    if (!note) return;
    note.innerHTML = shown ? esc(shown + ' shown') + '<span class="st-count"' + (n ? '' : ' hidden') + '>' + esc(n + ' unread') + '</span>' : '';
  }

  function load(reset) {
    var body = $('#subRows');
    if (!body) return;
    body.className = 'st-grid';
    if (reset) { cursor = null; body.innerHTML = '<li class="st-empty loading">Reading…</li>'; loadSegs(); }
    paintSegs();
    var q = $('#subQ').value.trim();
    var url = '/api/admin/records?type=submissions&limit=25';
    if (q) { url += '&q=' + encodeURIComponent(q); } else {
      if ($('#subKind').value) url += '&kind=' + encodeURIComponent($('#subKind').value);
      if ($('#subStatus').value) url += '&status=' + encodeURIComponent($('#subStatus').value);
      if (cursor) url += '&cursor=' + encodeURIComponent(cursor);
    }
    A.api(url).then(function (data) {
      var rows = data.rows || [];
      if (reset) body.innerHTML = '';
      if (!rows.length && reset) {
        body.innerHTML = '<li class="st-empty"><div class="empty"><b>Nothing here yet</b>'
          + esc(data.message || 'When someone sends a form on the site, it lands here.') + '</div></li>';
      }
      body.insertAdjacentHTML('beforeend', rows.map(tile).join(''));
      cursor = data.cursor || null;
      $('#subMore').hidden = !cursor || Boolean(q);
      counted();
    }).catch(function (e) {
      body.innerHTML = '<li class="st-empty"><div class="empty"><b>Nothing to show</b>'
        + esc(e.denied ? 'Your account does not carry Submissions.' : e.message) + '</div></li>';
    });
  }

  /* opened here: read at once, without waiting for the list to be read again */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('#subRows [data-open-case]') : null;
    var t = b && !b.closest('.st__tie') && b.closest('.st');
    if (!t || !t.classList.contains('is-unread')) return;
    t.classList.remove('is-unread');
    var mark = t.querySelector('.flag[data-s="unread"]');
    if (mark) mark.remove();
    counted();
    /* and one fewer on its kind's tile */
    var g = SEG.filter(function (x) { return x.kind === t.getAttribute('data-kind'); })[0];
    if (g && g.unread > 0) { g.unread -= 1; paintSegs(); }
  }, true);

  /* back on Submissions from another section: the count is said again */
  var pane = document.querySelector('.pane[data-pane="submissions"]');
  if (pane && window.MutationObserver) new MutationObserver(function () {
    if (pane.getAttribute('data-live') && $('#subRows .st')) counted();
  }).observe(pane, { attributes: true, attributeFilter: ['data-live'] });

  window.PFASubs = { load: load, tile: tile, segments: function () { return SEG; } };
})();
