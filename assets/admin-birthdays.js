/* Birthdays in the panel (owner, 11 Nov 2026: "have this in the admin
   panel. and also have a section for birthday's today", "admin should have
   birthday reminder stuff").

   One page, top down: whose birthday it is today, each with their card to
   download, their wish to copy, how to reach them, and whether their card
   has been emailed; then the next 30 days, folded; then the card itself,
   for any name.

   The card is emailed by itself between 8 and 9 in the morning, India time,
   on the day (owner, 17 Nov 2026: "automatically trigger the birthday
   greetings between 6-7 A.M on that special day"; lib/birthday-greetings.js).
   Each of today's rows says where theirs stands, and Email the card sends it
   now when the morning was missed. Whoever gave no email is said so, to be
   sent the card on WhatsApp. The reminder is
   admin.html's: the count on the rail and a notice on every page while
   today's birthdays are unopened (PFABirthdays.watch).

   From /api/admin/birthdays (lib/routes/admin/birthdays.js), the People
   directory's own module: whoever cannot see the directory sees none of
   this. The card is drawn by assets/birthday-card.js. admin.html calls
   PFABirthdays.pane(). */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var B = { data: null, name: '', busy: false, f: { period: 'all', from: '', to: '', state: '', how: '', q: '' }, sentOpen: false, sentAsk: 0, sentTimer: 0 };

  var style = document.createElement('style');
  style.textContent = [
    '.bd-line{margin:0 0 14px;font-size:13px;line-height:1.5;color:var(--muted)}.bd-line b{color:var(--ink)}',
    '.bd-h{margin:22px 0 10px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}',
    '.bd-list{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}',
    '.bd-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 20px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}',
    '.bd-who{min-width:0}.bd-who b{display:block;font-size:15px;overflow-wrap:anywhere}',
    '.bd-who .detail{display:block;margin-top:4px;font-size:12px;color:var(--muted);overflow-wrap:anywhere}',
    '.bd-who a{color:inherit}',
    '.bd-sent{display:block;margin-top:6px;font-size:12px;line-height:1.5;color:var(--ink)}.bd-sent[data-tone="wait"]{color:var(--muted)}.bd-sent[data-tone="bad"]{color:#b42318}',
    '.bd-acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}',
    '.bd-acts button{width:auto;margin:0;min-height:36px;padding:0 14px;font-size:12px}',
    '.bd-when{display:inline-block;min-width:96px;font-variant-numeric:tabular-nums}',
    '.bd-empty{margin:0;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:14px;line-height:1.5}',
    '.bd-more{border-bottom:1px solid var(--line);margin:18px 0 0}.bd-more>summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;font-size:14px;font-weight:700}',
    '.bd-more>summary::-webkit-details-marker{display:none}.bd-more>summary::after{content:"";flex:none;width:12px;height:12px;background:linear-gradient(var(--ink),var(--ink)) center/12px 2px no-repeat,linear-gradient(var(--ink),var(--ink)) center/2px 12px no-repeat}',
    '.bd-more[open]>summary::after{background:linear-gradient(var(--ink),var(--ink)) center/12px 2px no-repeat}',
    '.bd-more>summary small{font-weight:400;color:var(--muted)}',
    '.bd-card{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:20px 28px;align-items:start}',
    '.bd-card canvas{display:block;width:100%;height:auto;background:#151313;border:1px solid var(--line)}',
    '.bd-form{display:grid;gap:10px;align-content:start}',
    '.bd-form label{display:grid;gap:6px;font-size:12px;color:var(--muted)}',
    '.bd-form input{height:42px;padding:0 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:14px;color:var(--ink);border-radius:0;min-width:0}',
    '.bd-form input:focus-visible{outline:none;border-color:var(--ink)}',
    '.bd-form .bd-acts{justify-content:flex-start}',
    '.bd-say{min-height:18px;margin:0;font-size:12px;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.bd-say[data-tone="bad"]{color:#b42318}',
    /* the cards sent, and their filters (21 Nov 2026) */
    '.bd-filters{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin:6px 0 14px}',
    '.bd-filters label{display:grid;gap:6px;font-size:12px;color:var(--muted);min-width:0}',
    '.bd-filters select,.bd-filters input{height:42px;padding:0 10px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:14px;color:var(--ink);border-radius:0;min-width:0;width:100%}',
    '.bd-filters label[hidden]{display:none}',
    '.bd-sentbar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px 16px;margin:0 0 10px}.bd-sentbar .bd-line{margin:0}',
    '.bd-sentbar button{width:auto;margin:0;min-height:36px;padding:0 14px;font-size:12px}',
    '.bd-table{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 16px}',
    '.bd-table th,.bd-table td{padding:10px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}',
    '.bd-table th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}',
    '.bd-table td[data-state="failed"]{color:#b42318}.bd-table td[data-state="waiting"]{color:var(--muted)}',
    '@media (max-width:760px){.bd-table thead{display:none}.bd-table tr{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid var(--line)}.bd-table td{border:0;padding:0}.bd-table td[data-label]:not(:empty)::before{content:attr(data-label);color:var(--muted)}}',
    '@media (max-width:760px){.bd-row{grid-template-columns:minmax(0,1fr)}.bd-acts{justify-content:flex-start}.bd-card{grid-template-columns:minmax(0,1fr)}.bd-card canvas{max-width:360px}}'
  ].join('');
  document.head.appendChild(style);

  function node() { return $('[data-pane="birthdays"]'); }
  function dayWords(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '';
  }
  function first(name) { return String(name || '').replace(/^(dr|mr|mrs|ms|shri|smt|sri)\.?\s+/i, '').split(' ')[0] || 'friend'; }
  function wish(p) {
    return 'Dear ' + first(p.name) + ', a very happy birthday from all of us at People for Animals. The world is kinder because of you. Wishing you joy, today and always. Warm regards, Maneka Sanjay Gandhi';
  }
  function phone(m) { return m ? m.slice(0, 5) + ' ' + m.slice(5) : ''; }
  function clock(iso) {
    var t = Date.parse(iso || '');
    if (!isFinite(t)) return '';
    var d = new Date(t + 330 * 60000);
    var h = d.getUTCHours(); var m = d.getUTCMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? ' am' : ' pm');
  }
  /* where today's emailed card stands: [words, tone, can it be sent now] */
  function sent(p) {
    var g = p.greeting || {};
    var past = B.data && B.data.greetings && B.data.greetings.past;
    var on = !(B.data && B.data.greetings && B.data.greetings.on === false);
    if (g.state === 'no-email') return ['No email address: send the card on WhatsApp.', 'wait', false];
    if (g.state === 'sent') return ['Card emailed' + (clock(g.at) ? ' at ' + clock(g.at) : '') + '.', '', false];
    if (g.state === 'queued') return ['Card emailing: waiting for the mail server, it is tried again every ten minutes.', 'wait', false];
    if (g.state === 'failed') return ['The card could not be emailed: the mail server refused it. Download it and send it by hand.', 'bad', false];
    if (!on) return ['Not emailed: the morning email is switched off on this server.', 'wait', true];
    return past ? ['Not emailed this morning.', 'bad', true] : ['The card is emailed by itself ' + window_() + '.', 'wait', true];
  }
  /* the hour the server sends at (lib/birthday-greetings.js, 8 since 21 Nov
     2026), so the panel never says one hour and the server keeps another */
  function window_() {
    var h = Number(B.data && B.data.greetings && B.data.greetings.hour);
    if (!(h >= 0 && h <= 23)) h = 8;
    var say = function (x) { x = x % 24; return (x % 12 || 12) + (x < 12 ? ' am' : ' pm'); };
    return 'between ' + say(h).replace(/ (am|pm)$/, (h % 24 < 12) === ((h + 1) % 24 < 12) ? '' : ' $1') + ' and ' + say(h + 1);
  }

  function row(p, today) {
    var how = [p.turns > 0 ? 'Turns ' + p.turns : '', (p.categories || []).join(', '), [p.district, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' \u00b7 ');
    var state = today ? sent(p) : null;
    var reach = [p.mobile ? '<a href="tel:+91' + esc(p.mobile) + '">' + esc(phone(p.mobile)) + '</a>' : '', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : ''].filter(Boolean).join(' \u00b7 ');
    return '<li class="bd-row" data-bd-id="' + esc(p.id) + '"><div class="bd-who">'
      + (today ? '' : '<span class="detail bd-when">' + esc(dayWords(p.day)) + (p.inDays === 1 ? ', tomorrow' : ', in ' + p.inDays + ' days') + '</span>')
      + '<b>' + esc(p.name || 'No name given') + '</b>'
      + (how ? '<span class="detail">' + esc(how) + '</span>' : '')
      + (reach ? '<span class="detail">' + reach + '</span>' : '')
      + (state ? '<span class="bd-sent" role="status"' + (state[1] ? ' data-tone="' + state[1] + '"' : '') + '>' + esc(state[0]) + '</span>' : '')
      + (!today && !p.email ? '<span class="detail">No email address, so the card is not emailed on the day.</span>' : '') + '</div>'
      + '<div class="bd-acts">' + (state && state[2] ? '<button class="press" type="button" data-bd="email">Email the card</button>' : '')
      + '<button class="ghost" type="button" data-bd="show">See card</button><button class="' + (state && state[2] ? 'ghost' : 'press') + '" type="button" data-bd="download">Download card</button><button class="ghost" type="button" data-bd="wish">Copy wish</button></div></li>';
  }

  function paint() {
    var n = node();
    if (!n) return;
    var d = B.data;
    var today = d.people || [];
    var soon = d.upcoming || [];
    var out = [];
    out.push('<p class="bd-line"><b>' + (today.length ? today.length + (today.length === 1 ? ' birthday today' : ' birthdays today') : 'No birthdays today') + '</b>, ' + esc(dayWords(d.today)) + '. '
      + (d.withDate || 0) + (d.withDate === 1 ? ' person has' : ' people have') + ' given a date of birth, on the donation, membership or internship forms. Each is emailed their card by itself ' + window_() + ' on the day.</p>');
    out.push('<p class="bd-h">Today</p>');
    if (today.length) out.push('<ul class="bd-list">' + today.map(function (p) { return row(p, true); }).join('') + '</ul>');
    else out.push('<p class="bd-empty">' + (soon[0] ? 'The next is ' + esc(soon[0].name || 'someone') + '&rsquo;s, on ' + esc(dayWords(soon[0].day)) + '.' : 'No birthdays in the next ' + (d.ahead || 30) + ' days.') + '</p>');
    out.push('<details class="bd-more"' + (!today.length && soon.length ? ' open' : '') + '><summary><span>Coming up <small>' + soon.length + ' in the next ' + (d.ahead || 30) + ' days</small></span></summary>'
      + (soon.length ? '<ul class="bd-list">' + soon.map(function (p) { return row(p, false); }).join('') + '</ul>' : '<p class="bd-empty">None in the next ' + (d.ahead || 30) + ' days.</p>') + '</details>');
    /* every card emailed, kept (owner, 21 Nov 2026: "also maintain the list of to who it has been sent. and have standard filters") */
    out.push('<details class="bd-more" id="bdSentFold"' + (B.sentOpen ? ' open' : '') + '><summary><span>Sent <small>every card emailed, newest first</small></span></summary>' + sentFilters() + '<div data-bd-sentbox></div></details>');
    out.push('<p class="bd-h" id="bdCardHead">The card</p>'
      + '<div class="bd-card"><canvas id="bdCanvas" role="img" aria-label="Birthday card"></canvas>'
      + '<div class="bd-form"><label for="bdName">Name on the card<input id="bdName" maxlength="200" autocomplete="off" value="' + esc(B.name) + '"></label>'
      + '<div class="bd-acts"><button class="ghost" type="button" data-bd="redraw">Show it</button><button class="press" type="button" data-bd="save">Download PNG</button></div>'
      + '<p class="bd-say" id="bdSay" role="status" aria-live="polite"></p>'
      + '<p class="bd-line">The template&rsquo;s dahlias and words, in Marcellus. A long name wraps onto up to three lines; an empty one gives the card without a name. 1122 by 1402 pixels, for WhatsApp, email or print.</p></div></div>');
    n.innerHTML = out.join('');
    if (B.sentOpen) sentLoad();
    redraw();
    A.say($('#paneNote'), today.length ? today.length + (today.length === 1 ? ' birthday today' : ' birthdays today') : 'No birthdays today');
  }

  /* ---- the cards sent ---------------------------------------------------- */
  function sentFilters() {
    var f = B.f;
    var opt = function (v, label, cur) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>'; };
    return '<div class="bd-filters">'
      + '<label>Period<select data-bdf="period">' + opt('month', 'This month', f.period) + opt('last', 'Last month', f.period) + opt('3m', 'Last 3 months', f.period) + opt('year', 'This year', f.period) + opt('all', 'All time', f.period) + opt('custom', 'Choose the dates', f.period) + '</select></label>'
      + '<label' + (f.period === 'custom' ? '' : ' hidden') + ' data-bdf-custom>From<input type="date" data-bdf="from" value="' + esc(f.from) + '"></label>'
      + '<label' + (f.period === 'custom' ? '' : ' hidden') + ' data-bdf-custom>To<input type="date" data-bdf="to" value="' + esc(f.to) + '"></label>'
      + '<label>Status<select data-bdf="state">' + opt('', 'All', f.state) + opt('sent', 'Sent', f.state) + opt('waiting', 'Waiting to send', f.state) + opt('failed', 'Could not send', f.state) + '</select></label>'
      + '<label>How<select data-bdf="how">' + opt('', 'All', f.how) + opt('auto', 'By itself, in the morning', f.how) + opt('panel', 'From the panel', f.how) + '</select></label>'
      + '<label>Search<input type="search" data-bdf="q" maxlength="80" placeholder="Name or email" value="' + esc(f.q) + '" autocomplete="off"></label>'
      + '</div>';
  }
  /* the period as dates, by India's today */
  function range() {
    var f = B.f;
    if (f.period === 'custom') return { from: f.from, to: f.to };
    var t = (B.data && B.data.today) || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    var y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var first = function (yy, mm) { while (mm < 1) { mm += 12; yy -= 1; } return yy + '-' + pad(mm) + '-01'; };
    if (f.period === 'month') return { from: first(y, m), to: t };
    if (f.period === 'last') { var start = first(y, m - 1); var end = new Date(Date.parse(first(y, m) + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10); return { from: start, to: end }; }
    if (f.period === '3m') return { from: first(y, m - 2), to: t };
    if (f.period === 'year') return { from: y + '-01-01', to: t };
    return { from: '', to: '' };
  }
  function sentQuery() {
    var r = range();
    var q = [['from', r.from], ['to', r.to], ['state', B.f.state], ['how', B.f.how], ['q', B.f.q.trim()]].filter(function (x) { return x[1]; });
    return 'sent=1' + q.map(function (x) { return '&' + x[0] + '=' + encodeURIComponent(x[1]); }).join('');
  }
  function at(iso) {
    var d = new Date(iso || '');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).replace(/\s?([ap])m$/i, ' $1m').toLowerCase().replace(/^(\d+ )(\w)/, function (_, a, b) { return a + b.toUpperCase(); });
  }
  function sentLoad() {
    var box = $('[data-bd-sentbox]');
    if (!box) return;
    var mine = ++B.sentAsk;
    if (!box.innerHTML) box.innerHTML = '<p class="bd-line">Reading the cards sent\u2026</p>';
    A.api('/api/admin/birthdays?' + sentQuery()).then(function (d) {
      if (mine !== B.sentAsk) return;
      var rows = d.rows || [];
      var STATE = { sent: 'Sent', waiting: 'Waiting to send', failed: 'Could not send' };
      var count = (d.count || 0) + (d.count === 1 ? ' card' : ' cards') + (d.total !== d.count ? ' of ' + d.total : '');
      box.innerHTML = '<div class="bd-sentbar"><p class="bd-line"><b>' + esc(count) + '</b>' + (d.count > rows.length ? ', the newest ' + rows.length + ' shown; the CSV has them all' : '') + '</p>'
        + (d.count ? '<button class="ghost" type="button" data-bd="csv">Download CSV</button>' : '') + '</div>'
        + (rows.length ? '<table class="bd-table"><thead><tr><th>Birthday</th><th>Name</th><th>Email</th><th>Turned</th><th>Status</th><th>How</th></tr></thead><tbody>'
          + rows.map(function (r) {
            return '<tr><td>' + esc(dayWords(r.day)) + ' ' + esc(r.day.slice(0, 4)) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.email) + '</td><td data-label="Turned ">' + (r.turns > 0 ? r.turns : '') + '</td>'
              + '<td data-state="' + esc(r.state) + '">' + esc(STATE[r.state] || r.state) + (r.state === 'sent' && at(r.at) ? ', ' + esc(at(r.at)) : '') + '</td>'
              + '<td>' + (r.how === 'auto' ? 'By itself, in the morning' : 'From the panel' + (r.by ? ' by ' + esc(r.by) : '')) + '</td></tr>';
          }).join('') + '</tbody></table>'
          : '<p class="bd-empty">' + (d.total ? 'No card sent matches these filters.' : 'No card has been emailed yet. The first goes ' + window_() + ' on someone\u2019s birthday.') + '</p>');
    }).catch(function (e) { if (mine === B.sentAsk) box.innerHTML = '<p class="bd-line" data-tone="bad">' + esc(e.message) + '</p>'; });
  }
  function sentCsv(b) {
    b.disabled = true;
    A.token().then(function (id) {
      return fetch('/api/admin/birthdays?' + sentQuery() + '&format=csv', { headers: { Authorization: 'Bearer ' + id } });
    }).then(function (r) { if (!r.ok) throw new Error('The CSV could not be made just now.'); return r.blob(); }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'PFA-birthday-cards-sent.csv'; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }).catch(function (e) { window.alert(e.message); }).then(function () { b.disabled = false; });
  }

  function say(text, bad) {
    var s = $('#bdSay');
    if (!s) return;
    s.textContent = text || '';
    if (bad) s.setAttribute('data-tone', 'bad'); else s.removeAttribute('data-tone');
  }

  function redraw() {
    var c = $('#bdCanvas');
    if (!c || !window.PFABirthdayCard) return Promise.resolve();
    var input = $('#bdName');
    B.name = input ? input.value : B.name;
    say('Drawing the card\u2026');
    return window.PFABirthdayCard.draw(c, B.name).then(function (r) { say(r.name ? 'The card for ' + r.name + '.' : 'The card without a name.'); }, function (e) { say(e.message, true); });
  }

  function download(name) {
    if (!window.PFABirthdayCard || B.busy) return;
    B.busy = true;
    say('Saving the card\u2026');
    window.PFABirthdayCard.png(name).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = window.PFABirthdayCard.fileName(name);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      say('Saved ' + a.download + '.');
    }, function (e) { say(e.message, true); }).then(function () { B.busy = false; });
  }

  /* the morning's email, now (lib/routes/admin/birthdays.js POST send) */
  function email(p, b) {
    if (B.busy) return;
    B.busy = true; b.disabled = true;
    var line = b.closest('[data-bd-id]') && b.closest('[data-bd-id]').querySelector('.bd-sent');
    if (line) { line.textContent = 'Emailing the card\u2026'; line.setAttribute('data-tone', 'wait'); }
    A.api('/api/admin/birthdays', { method: 'POST', body: { action: 'send', key: p.key } }).then(function (r) {
      p.greeting = r.greeting || { state: r.state };
      paint();
    }, function (e) {
      b.disabled = false;
      if (line) { line.textContent = (e && e.message) || 'The card could not be emailed just now.'; line.setAttribute('data-tone', 'bad'); }
    }).then(function () { B.busy = false; });
  }

  function copy(text) {
    var done = function () { say('The wish is copied: paste it into WhatsApp or an email.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, function () { say('Copying was not allowed here.', true); });
    var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch (_) { say('Copying was not allowed here.', true); }
    t.remove();
    return null;
  }

  function personOf(el) {
    var li = el.closest('[data-bd-id]');
    if (!li || !B.data) return null;
    var id = li.getAttribute('data-bd-id');
    return (B.data.people || []).concat(B.data.upcoming || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  var wired = false;
  function wire() {
    var n = node();
    if (!n || wired) return;
    wired = true;
    n.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-bd]');
      if (!b) return;
      var what = b.getAttribute('data-bd');
      if (what === 'csv') return sentCsv(b);
      if (what === 'redraw') return redraw();
      if (what === 'save') { var i = $('#bdName'); return download(i ? i.value : B.name); }
      var p = personOf(b);
      if (!p) return;
      if (what === 'download') return download(p.name);
      if (what === 'email') return email(p, b);
      if (what === 'wish') return copy(wish(p));
      if (what === 'show') {
        var input = $('#bdName');
        if (input) input.value = p.name;
        redraw();
        var h = $('#bdCardHead'); if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    /* the Sent fold reads its list when opened */
    n.addEventListener('toggle', function (e) {
      if (!e.target || e.target.id !== 'bdSentFold') return;
      B.sentOpen = e.target.open;
      if (e.target.open) sentLoad();
    }, true);
    var filter = function (e) {
      var t = e.target;
      var k = t && t.getAttribute && t.getAttribute('data-bdf');
      if (!k) return;
      B.f[k] = t.value;
      if (k === 'period') {
        Array.prototype.forEach.call(n.querySelectorAll('[data-bdf-custom]'), function (l) { l.hidden = t.value !== 'custom'; });
      }
      clearTimeout(B.sentTimer);
      B.sentTimer = setTimeout(sentLoad, k === 'q' ? 300 : 0);
    };
    n.addEventListener('change', filter);
    n.addEventListener('input', function (e) { if (e.target && e.target.getAttribute && e.target.getAttribute('data-bdf') === 'q') filter(e); });
    n.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.id === 'bdName') { e.preventDefault(); redraw(); }
    });
  }

  function pane() {
    var n = node();
    if (!n) return;
    wire();
    seen();
    n.innerHTML = '<div class="loading">Reading the birthdays\u2026</div>';
    A.api('/api/admin/birthdays').then(function (d) {
      B.data = d;
      if (!B.name && (d.people || [])[0]) B.name = d.people[0].name;
      paint();
      remind(d);
    }).catch(function (e) {
      n.innerHTML = '<div class="empty"><b>Nothing to show</b>' + esc(e && e.denied ? 'Your account does not carry the People directory, where birthdays come from. A super admin can add it under People.' : (e && e.message) || 'That could not be read.') + '</div>';
    });
  }

  /* ---- the reminder: the count on the rail, and a notice on every page
     until today's birthdays have been opened (once a day, per browser) ---- */
  var KEY = 'pfa:birthdays-seen';
  function todayIst() { return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10); }
  function wasSeen() { try { return window.localStorage.getItem(KEY) === todayIst(); } catch (_) { return false; } }
  function seen() {
    try { window.localStorage.setItem(KEY, todayIst()); } catch (_) {}
    var note = $('#bdayNote'); if (note) note.hidden = true;
  }
  function remind(d) {
    var today = (d && d.people) || [];
    var pip = $('#pipBirthdays');
    if (pip) { pip.textContent = String(today.length); pip.hidden = !today.length; }
    var note = $('#bdayNote');
    var text = $('#bdayNoteText');
    if (!note || !text) return;
    if (!today.length || wasSeen()) { note.hidden = true; return; }
    var mailed = today.filter(function (p) { return p.greeting && p.greeting.state === 'sent'; }).length;
    var after = mailed === today.length ? (today.length === 1 ? ' Their card was emailed this morning.' : ' Their cards were emailed this morning.')
      : mailed ? ' ' + mailed + ' of their cards were emailed this morning; see who is left.'
      : (today.length === 1 ? ' Their card is ready.' : ' Their cards are ready.');
    text.innerHTML = today.length === 1
      ? 'It is <b>' + esc(today[0].name || 'someone') + '</b>&rsquo;s birthday today' + (today[0].turns > 0 ? ' (' + today[0].turns + ')' : '') + '.' + after
      : '<b>' + today.length + ' birthdays today</b>, including ' + esc(today[0].name || 'someone') + '.' + after;
    note.hidden = false;
  }
  function watch() {
    A.api('/api/admin/birthdays').then(remind).catch(function () { /* the next look tries again */ });
  }

  window.PFABirthdays = { pane: pane, watch: watch, seen: seen, _wish: wish };
})();
