/* Birthdays in the panel (owner, 11 Nov 2026: "have this in the admin
   panel. and also have a section for birthday's today", "admin should have
   birthday reminder stuff").

   One page, top down: whose birthday it is today, each with their card to
   download, their wish to copy, and how to reach them; then the next 30
   days, folded; then the card itself, for any name. The reminder is
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
  var B = { data: null, name: '', busy: false };

  var style = document.createElement('style');
  style.textContent = [
    '.bd-line{margin:0 0 14px;font-size:13px;line-height:1.5;color:var(--muted)}.bd-line b{color:var(--ink)}',
    '.bd-h{margin:22px 0 10px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}',
    '.bd-list{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}',
    '.bd-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 20px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}',
    '.bd-who{min-width:0}.bd-who b{display:block;font-size:15px;overflow-wrap:anywhere}',
    '.bd-who .detail{display:block;margin-top:4px;font-size:12px;color:var(--muted);overflow-wrap:anywhere}',
    '.bd-who a{color:inherit}',
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

  function row(p, today) {
    var how = [p.turns > 0 ? 'Turns ' + p.turns : '', (p.categories || []).join(', '), [p.district, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' \u00b7 ');
    var reach = [p.mobile ? '<a href="tel:+91' + esc(p.mobile) + '">' + esc(phone(p.mobile)) + '</a>' : '', p.email ? '<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : ''].filter(Boolean).join(' \u00b7 ');
    return '<li class="bd-row" data-bd-id="' + esc(p.id) + '"><div class="bd-who">'
      + (today ? '' : '<span class="detail bd-when">' + esc(dayWords(p.day)) + (p.inDays === 1 ? ', tomorrow' : ', in ' + p.inDays + ' days') + '</span>')
      + '<b>' + esc(p.name || 'No name given') + '</b>'
      + (how ? '<span class="detail">' + esc(how) + '</span>' : '')
      + (reach ? '<span class="detail">' + reach + '</span>' : '') + '</div>'
      + '<div class="bd-acts"><button class="ghost" type="button" data-bd="show">See card</button><button class="press" type="button" data-bd="download">Download card</button><button class="ghost" type="button" data-bd="wish">Copy wish</button></div></li>';
  }

  function paint() {
    var n = node();
    if (!n) return;
    var d = B.data;
    var today = d.people || [];
    var soon = d.upcoming || [];
    var out = [];
    out.push('<p class="bd-line"><b>' + (today.length ? today.length + (today.length === 1 ? ' birthday today' : ' birthdays today') : 'No birthdays today') + '</b>, ' + esc(dayWords(d.today)) + '. '
      + (d.withDate || 0) + (d.withDate === 1 ? ' person has' : ' people have') + ' given a date of birth, on the donation, membership or internship forms.</p>');
    out.push('<p class="bd-h">Today</p>');
    if (today.length) out.push('<ul class="bd-list">' + today.map(function (p) { return row(p, true); }).join('') + '</ul>');
    else out.push('<p class="bd-empty">' + (soon[0] ? 'The next is ' + esc(soon[0].name || 'someone') + '&rsquo;s, on ' + esc(dayWords(soon[0].day)) + '.' : 'No birthdays in the next ' + (d.ahead || 30) + ' days.') + '</p>');
    out.push('<details class="bd-more"' + (!today.length && soon.length ? ' open' : '') + '><summary><span>Coming up <small>' + soon.length + ' in the next ' + (d.ahead || 30) + ' days</small></span></summary>'
      + (soon.length ? '<ul class="bd-list">' + soon.map(function (p) { return row(p, false); }).join('') + '</ul>' : '<p class="bd-empty">None in the next ' + (d.ahead || 30) + ' days.</p>') + '</details>');
    out.push('<p class="bd-h" id="bdCardHead">The card</p>'
      + '<div class="bd-card"><canvas id="bdCanvas" role="img" aria-label="Birthday card"></canvas>'
      + '<div class="bd-form"><label for="bdName">Name on the card<input id="bdName" maxlength="200" autocomplete="off" value="' + esc(B.name) + '"></label>'
      + '<div class="bd-acts"><button class="ghost" type="button" data-bd="redraw">Show it</button><button class="press" type="button" data-bd="save">Download PNG</button></div>'
      + '<p class="bd-say" id="bdSay" role="status" aria-live="polite"></p>'
      + '<p class="bd-line">The template&rsquo;s dahlias and words, in Marcellus. A long name wraps onto up to three lines; an empty one gives the card without a name. 1122 by 1402 pixels, for WhatsApp, email or print.</p></div></div>');
    n.innerHTML = out.join('');
    redraw();
    A.say($('#paneNote'), today.length ? today.length + (today.length === 1 ? ' birthday today' : ' birthdays today') : 'No birthdays today');
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
      if (what === 'redraw') return redraw();
      if (what === 'save') { var i = $('#bdName'); return download(i ? i.value : B.name); }
      var p = personOf(b);
      if (!p) return;
      if (what === 'download') return download(p.name);
      if (what === 'wish') return copy(wish(p));
      if (what === 'show') {
        var input = $('#bdName');
        if (input) input.value = p.name;
        redraw();
        var h = $('#bdCardHead'); if (h && h.scrollIntoView) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
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
    text.innerHTML = today.length === 1
      ? 'It is <b>' + esc(today[0].name || 'someone') + '</b>&rsquo;s birthday today' + (today[0].turns > 0 ? ' (' + today[0].turns + ')' : '') + '. Their card is ready to send.'
      : '<b>' + today.length + ' birthdays today</b>, including ' + esc(today[0].name || 'someone') + '. Their cards are ready to send.';
    note.hidden = false;
  }
  function watch() {
    A.api('/api/admin/birthdays').then(remind).catch(function () { /* the next look tries again */ });
  }

  window.PFABirthdays = { pane: pane, watch: watch, seen: seen, _wish: wish };
})();
