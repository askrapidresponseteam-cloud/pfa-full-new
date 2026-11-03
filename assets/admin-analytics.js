/* Analytics in the panel (owner, 3 Nov 2026: "admin to get analytics of
   how many visited which page..and whatever other analytics that is
   actually useful").

   One screen, read top down: the period; four numbers (visits, page views,
   pages per visit, what people sent in); visits by day; the pages people
   open; then, folded under expanders, where visits come from, phone or
   computer, the states, the hours, campaign links, what was sent in, and
   pages where a script failed. Everything is a count: no person is ever
   named here (lib/analytics.js). admin.html calls PFAAnalytics.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var ST = { days: 30, from: '', to: '', data: null, loading: false };

  var style = document.createElement('style');
  style.textContent = '.an-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px}'
    + '.an-tools button{min-height:36px;padding:0 14px;border:1px solid #e4e2df;background:#fff;font:inherit;font-size:13px;cursor:pointer}'
    + '.an-tools button[aria-pressed="true"]{border-color:#111;background:#111;color:#fff}'
    + '.an-tools input{height:36px;padding:0 8px;border:1px solid #e4e2df;font:inherit;font-size:13px}.an-tools input:focus{outline:none;border-color:#111}'
    + '.an-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;border-top:1px solid #e4e2df;border-left:1px solid #e4e2df;margin:0 0 22px}'
    + '.an-kpi{padding:14px 16px;border-right:1px solid #e4e2df;border-bottom:1px solid #e4e2df}.an-kpi b{display:block;font-size:28px;font-weight:400;line-height:1.1;font-variant-numeric:tabular-nums}.an-kpi span{font-size:12px;color:#5f5f5f}'
    + '.an-h{margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5f5f5f}'
    + '.an-chart{position:relative}.an-chart svg{display:block;width:100%;height:auto}.an-chart rect.b{fill:#111}.an-chart rect.b:hover,.an-chart rect.b:focus{fill:#5f5f5f;outline:none}.an-chart rect.hit{fill:transparent}'
    + '.an-axis{display:flex;justify-content:space-between;font-size:11px;color:#5f5f5f;margin:4px 0 0}'
    + '.an-tip{position:absolute;pointer-events:none;background:#111;color:#fff;font-size:12px;line-height:1.4;padding:6px 8px;white-space:nowrap;transform:translate(-50%,-100%);margin-top:-6px}'
    + '.an-rows{margin:0;padding:0;list-style:none;font-size:13px}.an-rows>li{display:grid;grid-template-columns:minmax(0,1fr) minmax(80px,40%) 64px;gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid #eee}'
    + '.an-rows .an-l{overflow-wrap:anywhere}.an-rows .an-n{text-align:right;font-variant-numeric:tabular-nums}'
    + '.an-tr{height:14px;background:#f0efec;border-radius:0 4px 4px 0}.an-fill{height:14px;background:#111;border-radius:0 4px 4px 0;min-width:4px}'
    + '.an-more{border-top:1px solid #e4e2df;margin:0}.an-more:last-of-type{border-bottom:1px solid #e4e2df}.an-more>summary{cursor:pointer;padding:12px 0;font-size:14px;font-weight:700;min-height:44px;display:flex;align-items:center;gap:8px}'
    + '.an-more>summary small{font-weight:400;color:#5f5f5f}.an-more>div{padding:0 0 14px}'
    + '.an-note{font-size:12px;color:#5f5f5f;margin:12px 0 0;line-height:1.5}.an-err{font-size:13px;line-height:1.5;overflow-wrap:anywhere}';
  document.head.appendChild(style);

  function n(v) { return Number(v || 0).toLocaleString('en-IN'); }
  function dayLabel(d) { var t = new Date(d + 'T00:00:00Z'); return isNaN(t) ? d : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

  function rows(list, empty) {
    if (!list || !list.length) return '<p class="an-note">' + esc(empty || 'Nothing yet.') + '</p>';
    var max = list.reduce(function (m, r) { return Math.max(m, r.n); }, 0) || 1;
    return '<ul class="an-rows">' + list.map(function (r) {
      return '<li><span class="an-l">' + esc(r.label || r.key) + '</span><div class="an-tr" aria-hidden="true"><div class="an-fill" style="width:' + Math.max(1, Math.round((r.n / max) * 100)) + '%"></div></div><span class="an-n">' + n(r.n) + '</span></li>';
    }).join('') + '</ul>';
  }

  /* bars, one per day (or hour), with a hover and focus label; one hue */
  function bars(values, labels, word) {
    var w = 720; var h = 140; var count = values.length || 1;
    var max = Math.max.apply(null, values.concat([1]));
    var step = w / count; var gap = count > 60 ? 1 : 2; var bw = Math.max(1, step - gap);
    var out = '<svg viewBox="0 0 ' + w + ' ' + (h + 2) + '" role="img" aria-label="' + esc(word) + ' by ' + (labels.length === 24 ? 'hour' : 'day') + '">';
    out += '<line x1="0" y1="' + h + '" x2="' + w + '" y2="' + h + '" stroke="#e4e2df"/>';
    values.forEach(function (v, i) {
      var bh = v ? Math.max(2, Math.round((v / max) * (h - 8))) : 0;
      var x = i * step;
      var tip = labels[i] + ': ' + n(v) + ' ' + word;
      if (bh) out += '<rect class="b" tabindex="0" data-tip="' + esc(tip) + '" x="' + x.toFixed(1) + '" y="' + (h - bh) + '" width="' + bw.toFixed(1) + '" height="' + bh + '" rx="' + Math.min(4, bw / 2).toFixed(1) + '"/>';
      out += '<rect class="hit" data-tip="' + esc(tip) + '" x="' + x.toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + h + '"/>';
    });
    out += '</svg>';
    return '<div class="an-chart" data-an-chart>' + out + '<div class="an-axis"><span>' + esc(labels[0] || '') + '</span><span>' + esc(labels[labels.length - 1] || '') + '</span></div></div>';
  }

  function more(title, sub, body, open) {
    return '<details class="an-more"' + (open ? ' open' : '') + '><summary>' + esc(title) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</summary><div>' + body + '</div></details>';
  }

  function paint() {
    var node = $('[data-pane="analytics"]');
    if (!node) return;
    var d = ST.data;
    var tools = '<div class="an-tools" role="group" aria-label="Period">'
      + [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']].map(function (p) { return '<button type="button" data-an-days="' + p[0] + '" aria-pressed="' + (!ST.from && ST.days === p[0]) + '">' + p[1] + '</button>'; }).join('')
      + '<label>From <input type="date" data-an-from value="' + esc(ST.from) + '"></label><label>to <input type="date" data-an-to value="' + esc(ST.to) + '"></label></div>';
    if (!d) { node.innerHTML = tools + '<div class="loading">Reading the numbers…</div>'; return; }
    var actions = (d.actions || []).reduce(function (s, a) { return s + a.n; }, 0);
    var kpis = '<div class="an-kpis">'
      + '<div class="an-kpi"><b>' + n(d.visits) + '</b><span>Visits</span></div>'
      + '<div class="an-kpi"><b>' + n(d.views) + '</b><span>Pages opened</span></div>'
      + '<div class="an-kpi"><b>' + (d.perVisit || 0) + '</b><span>Pages per visit</span></div>'
      + '<div class="an-kpi"><b>' + (d.actions ? n(actions) : '-') + '</b><span>Forms, payments and orders sent in</span></div>'
      + '</div>';
    var series = d.series || [];
    var head = '<p class="an-note" style="margin:0 0 12px">' + esc(dayLabel(d.from)) + ' to ' + esc(dayLabel(d.to)) + ', India time.' + (d.started ? '' : ' Counting began with this update, so the first numbers appear once people open pages.') + '</p>';
    var sources = (d.sources || []);
    var html = tools + head + kpis
      + '<p class="an-h">Visits by day</p>' + bars(series.map(function (s) { return s.visits; }), series.map(function (s) { return dayLabel(s.day); }), 'visits')
      + '<p class="an-h">The pages people open</p>' + rows((d.pages || []).slice(0, 15), 'No pages opened in these days yet.')
      + more('Where visits come from', sources[0] ? 'most from ' + sources[0].label : '', rows(sources) + '<p class="an-note">Typed or bookmarked includes links opened from WhatsApp and email apps, which do not say where they came from. Add ?utm_source=whatsapp&amp;utm_campaign=name to a link you share and it is counted by name.</p>')
      + more('The page a visit begins on', '', rows(d.entries))
      + more('All pages', (d.pages || []).length + ' pages', rows(d.pages))
      + more('Phone or computer', '', rows(d.devices))
      + more('States', (d.regions || [])[0] ? 'most from ' + d.regions[0].label : '', rows(d.regions, 'Shown once the site runs on Vercel, which says the state a visit came from.') + ((d.countries || []).length ? '<p class="an-h">Countries</p>' + rows(d.countries) : ''))
      + more('Hours of the day', 'India time, when to post', bars(d.hours || [], (d.hours || []).map(function (_, h) { return (h < 10 ? '0' : '') + h + ':00'; }), 'pages opened'))
      + more('Campaign links', (d.campaigns || []).length ? (d.campaigns.length + (d.campaigns.length === 1 ? ' campaign' : ' campaigns')) : '', rows(d.campaigns, 'No links with utm_campaign opened in these days.'))
      + more('What was sent in', d.actions ? n(actions) + ' in these days' : '', d.actions ? rows((d.actions || []).map(function (a) { return { label: a.label, n: a.n }; }), 'Nothing arrived in these days.') + (d.actionsCapped ? '<p class="an-note">The first 5,000 only.</p>' : '') : '<p class="an-note">This account cannot read the submissions, so this part is hidden.</p>')
      + more('Pages where a script failed', d.errors ? n(d.errors) + ' times' : 'none', (d.errors ? rows(d.errorPages) + (d.errorMessages || []).map(function (e) { return '<p class="an-err"><b>' + esc(e.page) + '</b> (' + n(e.n) + '): ' + esc(e.message) + '</p>'; }).join('') : '<p class="an-note">No failed scripts in these days.</p>'))
      + '<p class="an-note">Counts only: no cookies and nothing about who anyone is. A visit is one browser session; browsers that ask not to be tracked are not counted.</p>';
    node.innerHTML = html;
  }

  function load() {
    var node = $('[data-pane="analytics"]');
    if (!node || ST.loading) return;
    ST.loading = true; ST.data = null; paint();
    var q = ST.from && ST.to ? 'from=' + encodeURIComponent(ST.from) + '&to=' + encodeURIComponent(ST.to) : 'days=' + ST.days;
    A.api('/api/admin/analytics?' + q).then(function (d) { ST.loading = false; ST.data = d; paint(); }).catch(function (e) {
      ST.loading = false;
      node.innerHTML = '<div class="empty"><b>Nothing to show</b>' + esc(e.message) + '</div>';
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-an-days]');
    if (!b) return;
    ST.days = Number(b.getAttribute('data-an-days')); ST.from = ''; ST.to = '';
    load();
  });
  document.addEventListener('change', function (e) {
    if (!e.target.matches || !e.target.matches('[data-an-from],[data-an-to]')) return;
    var f = $('[data-an-from]'); var t = $('[data-an-to]');
    if (f && t && f.value && t.value) { ST.from = f.value; ST.to = t.value; load(); }
  });
  /* the hover and focus label on the bars */
  function tip(e) {
    var chart = e.target.closest && e.target.closest('[data-an-chart]');
    var old = document.querySelector('.an-tip');
    if (!chart || !e.target.getAttribute('data-tip')) { if (old && (!chart || e.type === 'focusout')) old.remove(); return; }
    if (!old) { old = document.createElement('div'); old.className = 'an-tip'; old.setAttribute('role', 'status'); }
    chart.appendChild(old);
    old.textContent = e.target.getAttribute('data-tip');
    var r = e.target.getBoundingClientRect(); var c = chart.getBoundingClientRect();
    var x = Math.min(Math.max(r.left + r.width / 2 - c.left, 60), c.width - 60);
    old.style.left = x + 'px'; old.style.top = Math.max(0, r.top - c.top) + 'px';
  }
  document.addEventListener('mouseover', tip);
  document.addEventListener('focusin', tip);
  document.addEventListener('focusout', tip);

  window.PFAAnalytics = { pane: load };
})();
