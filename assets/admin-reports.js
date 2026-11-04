/* A period and an emailed report on five sections of the panel: Volunteers,
   Interns, Shop orders, Job applicants and the Colony card register (owner,
   4 Nov 2026: "these also should have date and range filters and option to
   send the report to those email; anushkapfacampus@gmail.com").

   A bar at the top of each section: the period (all time, today, the last 7
   or 30 days, this month, last month, or two dates), Download CSV and Email
   this report. With a period chosen, the section shows that period's lines,
   read from /api/admin/section-report; with all time, the section as it
   always was. The email goes only to the addresses the server offers (the
   shop's only where money goes) and carries the CSV.

   The sections draw themselves and often redraw: the bar is put back at the
   top whenever a redraw takes it away, with what was chosen kept. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var esc = A.esc;

  /* pane -> the server's name for the section */
  var PANES = {
    volunteers: 'volunteers',
    employees: 'jobs',
    interns: 'interns',
    shop: 'shop',
    cgsheet: 'caregivers'
  };
  var NOUN = { volunteers: ['volunteer', 'volunteers'], jobs: ['applicant', 'applicants'], interns: ['intern', 'interns'], shop: ['order', 'orders'], caregivers: ['application', 'applications'] };
  var OPENS = { volunteers: true, jobs: true, caregivers: true };
  var SHOW = 500;
  var state = {};

  var style = document.createElement('style');
  style.textContent = '.sr{margin:0 0 16px}.sr-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.sr-bar select,.sr-bar input{height:38px;padding:0 11px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:13px;color:var(--ink)}.sr-bar select:focus,.sr-bar input:focus{border-color:var(--ink);outline:none}'
    + '.sr-range{display:inline-flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px}.sr-range[hidden]{display:none}.sr-bar .ghost{margin:0}'
    + '.sr-box{border:1px solid var(--line);padding:14px 16px;margin:12px 0 0;background:var(--paper)}.sr-box p{margin:0 0 10px;font-size:13px;line-height:1.5}'
    + '.sr-box label{display:flex;gap:10px;align-items:flex-start;padding:6px 0;font-size:13px;cursor:pointer}.sr-box label input{margin:2px 0 0;flex:0 0 auto}.sr-box label small{display:block;color:var(--muted);font-size:12px}.sr-box label.is-off{opacity:.6;cursor:default}'
    + '.sr-acts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;align-items:center}.sr-acts .press,.sr-acts .ghost{width:auto;margin:0;min-height:38px;padding:0 18px}'
    + '.sr-say{font-size:13px;line-height:1.5;margin:10px 0 0;overflow-wrap:anywhere}.sr-say:empty{display:none}.sr-say[data-tone="bad"]{color:#a3251f}.sr-say[data-tone="good"]{color:#1f6b3a}'
    + '.sr-out{margin:14px 0 0}.sr-out[hidden]{display:none}.sr-line{margin:0 0 10px;font-size:14px}.sr-out td{font-size:13px;vertical-align:top}.sr-out td:first-child{white-space:nowrap}.sr-more{font-size:12px;color:var(--muted);margin:8px 0 0}'
    + '.pane.sr-on>:not(.sr){display:none!important}';
  document.head.appendChild(style);

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* the period chosen, as days: { from, to } or {} for all time */
  function range(s) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var back = function (n) { return new Date(today.getFullYear(), today.getMonth(), today.getDate() - n); };
    switch (s.when) {
      case 'today': return { from: iso(today), to: iso(today) };
      case '7': return { from: iso(back(6)), to: iso(today) };
      case '30': return { from: iso(back(29)), to: iso(today) };
      case 'month': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
      case 'last': return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
      case 'range': return { from: s.from || '', to: s.to || '' };
      default: return {};
    }
  }
  function query(kind, r, extra) {
    return '/api/admin/section-report?kind=' + kind + (r.from ? '&from=' + r.from : '') + (r.to ? '&to=' + r.to : '') + (extra || '');
  }

  function bar(pane, kind) {
    var s = state[pane] || (state[pane] = { when: '', from: '', to: '', open: false, people: null, data: null });
    var node = document.createElement('div');
    node.className = 'sr';
    node.setAttribute('data-sr', pane);
    node.innerHTML = '<div class="sr-bar">'
      + '<select data-sr-when aria-label="Period">'
      + [['', 'All time'], ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['month', 'This month'], ['last', 'Last month'], ['range', 'Choose dates']].map(function (o) {
        return '<option value="' + o[0] + '"' + (s.when === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>'
      + '<span class="sr-range" data-sr-range' + (s.when === 'range' ? '' : ' hidden') + '><input type="date" data-sr-from aria-label="From" value="' + esc(s.from) + '"><span>to</span><input type="date" data-sr-to aria-label="To" value="' + esc(s.to) + '"></span>'
      + '<button class="ghost" type="button" data-sr-act="csv">Download CSV</button>'
      + '<button class="ghost" type="button" data-sr-act="mail" aria-expanded="false">Email this report</button>'
      + '</div>'
      + '<div class="sr-box" data-sr-box hidden></div>'
      + '<p class="sr-say" data-sr-say role="status" aria-live="polite"></p>'
      + '<div class="sr-out" data-sr-out hidden></div>';
    node.setAttribute('data-kind', kind);
    return node;
  }

  function nodeOf(pane) { return document.querySelector('[data-pane="' + pane + '"]'); }
  function barOf(pane) { var p = nodeOf(pane); return p && p.querySelector(':scope > .sr'); }
  function say(pane, text, tone) {
    var b = barOf(pane); if (!b) return;
    var s = b.querySelector('[data-sr-say]');
    s.textContent = text || '';
    if (tone) s.setAttribute('data-tone', tone); else s.removeAttribute('data-tone');
  }

  /* keep the bar at the top of each section, whatever redraws it */
  function mount(pane) {
    var p = nodeOf(pane);
    if (!p) return;
    var b = state[pane] && state[pane].node;
    if (!b) { b = bar(pane, PANES[pane]); state[pane].node = b; }
    if (b.parentNode !== p || p.firstElementChild !== b) p.insertBefore(b, p.firstChild);
    p.classList.toggle('sr-on', Boolean(state[pane].when));
  }

  function paint(pane) {
    var s = state[pane]; var b = s.node; var kind = PANES[pane];
    var out = b.querySelector('[data-sr-out]');
    nodeOf(pane).classList.toggle('sr-on', Boolean(s.when));
    if (!s.when) { out.hidden = true; out.innerHTML = ''; return; }
    out.hidden = false;
    var d = s.data;
    if (!d) { out.innerHTML = '<p class="loading">Reading…</p>'; return; }
    var n = NOUN[kind] || ['line', 'lines'];
    var rows = d.rows.slice(0, SHOW);
    out.innerHTML = '<p class="sr-line"><b>' + d.count + ' ' + (d.count === 1 ? n[0] : n[1]) + '</b> · ' + esc(d.period) + (d.total != null ? ' · INR ' + Number(d.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '') + '</p>'
      + '<div class="wrap"><table><thead><tr>' + d.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function (r) {
        return '<tr>' + r.cells.map(function (c, i) {
          if (i === 0 && OPENS[kind]) return '<td><button class="rowopen" type="button" data-open-case="' + esc(c) + '">' + esc(c) + '</button></td>';
          return '<td>' + esc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + d.columns.length + '"><div class="empty"><b>Nothing in this period</b>Choose a longer period.</div></td></tr>')
      + '</tbody></table></div>'
      + (d.count > rows.length ? '<p class="sr-more">The first ' + rows.length + ' are shown; the CSV has all ' + d.count + '.</p>' : '');
  }

  function load(pane) {
    var s = state[pane]; var kind = PANES[pane];
    var r = range(s);
    if (s.when === 'range' && !(r.from && r.to)) { s.data = null; paint(pane); say(pane, 'Choose both dates.', ''); return; }
    say(pane, '');
    s.data = null; paint(pane);
    s.ask = (s.ask || 0) + 1;
    var ask = s.ask;
    if (!s.when) return;
    A.api(query(kind, r)).then(function (d) {
      if (ask !== s.ask) return;
      s.data = d; if (!s.people) s.people = d.recipients || [];
      paint(pane);
      if (s.open) box(pane);
    }).catch(function (e) { if (ask === s.ask) { s.node.querySelector('[data-sr-out]').innerHTML = ''; say(pane, e.message, 'bad'); } });
  }

  function label(s) {
    var r = range(s);
    if (!s.when) return 'all time';
    if (s.when === 'range') return r.from && r.to ? r.from + ' to ' + r.to : 'the dates chosen';
    var sel = s.node.querySelector('[data-sr-when]');
    return sel.options[sel.selectedIndex].textContent.toLowerCase();
  }

  function box(pane) {
    var s = state[pane]; var b = s.node.querySelector('[data-sr-box]');
    var kind = PANES[pane];
    var kept = Array.prototype.filter.call(b.querySelectorAll('input[type=checkbox]'), function (i) { return i.checked && !i.disabled; }).map(function (i) { return i.value; });
    var form = (s.people || []).filter(function (x) { return x.cc && x.cc.length; })[0];
    b.innerHTML = '<p><b>Email the report for ' + esc(label(s)) + '.</b> ' + (kind === 'shop'
      ? 'Shop orders carry money, so they go only to the payments inboxes, or to the forms inbox with the payments inboxes copied.'
      : 'Every line in the period, with the full list attached as a CSV.') + '</p>'
      + (s.people ? s.people.map(function (x) {
        return '<label data-sr-role="' + esc(x.role) + '"><input type="checkbox" value="' + esc(x.address) + '"' + (kept.indexOf(x.address) !== -1 ? ' checked' : '') + '><span>' + esc(x.address)
          + '<small>' + esc(x.role) + (x.cc && x.cc.length ? '; the payments inboxes are copied' : '') + '</small></span></label>';
      }).join('') : '<p class="loading">Reading who it can go to…</p>')
      + '<div class="sr-acts"><button class="press" type="button" data-sr-act="send">Send the report</button><button class="ghost" type="button" data-sr-act="close">Cancel</button></div>';
    b.setAttribute('data-form', form ? form.address : '');
    sync(b);
  }

  /* the forms inbox carries the payments inboxes in copy (shop orders): ticked with it */
  function sync(b) {
    var form = b.getAttribute('data-form');
    if (!form) return;
    var on = Array.prototype.some.call(b.querySelectorAll('input[type=checkbox]'), function (i) { return i.value === form && i.checked; });
    Array.prototype.forEach.call(b.querySelectorAll('label[data-sr-role="Payments inbox"]'), function (l) {
      var i = l.querySelector('input');
      if (on) { i.checked = true; i.disabled = true; l.classList.add('is-off'); } else if (i.disabled) { i.checked = false; i.disabled = false; l.classList.remove('is-off'); }
    });
  }

  function toggleBox(pane) {
    var s = state[pane]; var b = s.node.querySelector('[data-sr-box]');
    var btn = s.node.querySelector('[data-sr-act="mail"]');
    s.open = b.hidden;
    b.hidden = !s.open;
    btn.setAttribute('aria-expanded', String(s.open));
    if (!s.open) return;
    box(pane);
    if (s.people) return;
    A.api(query(PANES[pane], {}, '&recipients=1')).then(function (d) { s.people = d.recipients || []; if (s.open) box(pane); }).catch(function (e) { say(pane, e.message, 'bad'); });
  }

  function send(pane, btn) {
    var s = state[pane]; var b = s.node.querySelector('[data-sr-box]');
    var to = Array.prototype.filter.call(b.querySelectorAll('input[type=checkbox]'), function (i) { return i.checked && !i.disabled; }).map(function (i) { return i.value; });
    if (!to.length) { say(pane, 'Tick who the report goes to.', 'bad'); return; }
    var r = range(s);
    if (s.when === 'range' && !(r.from && r.to)) { say(pane, 'Choose both dates first.', 'bad'); return; }
    btn.disabled = true;
    say(pane, 'Making the report and sending it…', '');
    A.api(query(PANES[pane], {}), { method: 'POST', body: { from: r.from || '', to: r.to || '', recipients: to } }).then(function (d) {
      var x = d.result || {};
      var went = (x.emails || []).map(function (e) { return e.to + (e.cc && e.cc.length ? ' (copied to ' + e.cc.join(', ') + ')' : '') + (e.state === 'sent' ? '' : ', going out shortly'); });
      say(pane, 'Sent: ' + x.label + ', ' + x.period + ', ' + x.count + ' ' + (x.count === 1 ? 'line' : 'lines') + '. To ' + went.join('; ') + '.', 'good');
      btn.disabled = false;
      b.hidden = true; s.open = false; s.node.querySelector('[data-sr-act="mail"]').setAttribute('aria-expanded', 'false');
    }).catch(function (e) { say(pane, e.message, 'bad'); btn.disabled = false; });
  }

  function csv(pane, btn) {
    var s = state[pane]; var r = range(s);
    if (s.when === 'range' && !(r.from && r.to)) { say(pane, 'Choose both dates first.', 'bad'); return; }
    btn.disabled = true;
    A.token().then(function (id) {
      return fetch(query(PANES[pane], r, '&format=csv'), { headers: { Authorization: 'Bearer ' + id } });
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'The CSV could not be made.'); });
      var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'pfa-report.csv';
      return res.blob().then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      });
    }).then(function () { btn.disabled = false; }, function (e) { btn.disabled = false; say(pane, e.message, 'bad'); });
  }

  function paneOf(el) { var b = el.closest && el.closest('.sr[data-sr]'); return b ? b.getAttribute('data-sr') : ''; }

  document.addEventListener('change', function (e) {
    var pane = paneOf(e.target);
    if (!pane) return;
    var s = state[pane];
    if (e.target.hasAttribute('data-sr-when')) {
      s.when = e.target.value;
      s.node.querySelector('[data-sr-range]').hidden = s.when !== 'range';
      load(pane);
      if (s.open) box(pane);
    } else if (e.target.hasAttribute('data-sr-from') || e.target.hasAttribute('data-sr-to')) {
      s[e.target.hasAttribute('data-sr-from') ? 'from' : 'to'] = e.target.value;
      if (s.from && s.to) load(pane);
      if (s.open) box(pane);
    } else if (e.target.type === 'checkbox') {
      sync(s.node.querySelector('[data-sr-box]'));
    }
  });
  document.addEventListener('click', function (e) {
    var act = e.target.closest && e.target.closest('.sr [data-sr-act]');
    if (!act) return;
    var pane = paneOf(act);
    var what = act.getAttribute('data-sr-act');
    if (what === 'mail') toggleBox(pane);
    else if (what === 'close') toggleBox(pane);
    else if (what === 'send') send(pane, act);
    else if (what === 'csv') csv(pane, act);
  });

  Object.keys(PANES).forEach(function (pane) {
    var p = nodeOf(pane);
    if (!p) return;
    state[pane] = { when: '', from: '', to: '', open: false, people: null, data: null };
    mount(pane);
    new MutationObserver(function () { if (p.firstElementChild !== state[pane].node) mount(pane); }).observe(p, { childList: true });
  });
})();
