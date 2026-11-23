/* Teach the chat: in the panel's Live chat section (owner, 23 Nov 2026:
   "can you have chat module keep learning and get better").

   What visitors asked the site's chat in the last 30 days that it could not
   answer, or answered and they asked for a person straight after, most
   asked first. Teach an answer (a sentence or two, and a page of the site
   if one says more) and the chat gives it from then on, to that question and
   to the other ways it is asked; or set the question aside. Taught answers
   can be changed or forgotten. Only the words of a question are ever kept:
   numbers, emails and phone numbers are taken out before it is stored
   (lib/analytics.js). The server is lib/routes/admin/chat-learn.js.

   Loaded by assets/admin-live-chat.js, which calls PFAChatLearn.mount(pane)
   each time it draws the section, so admin.html stays under its ceiling. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFAChatLearn) return;
  var esc = A.esc;
  var URL_ = '/api/admin/chat-learn';
  var MAX = 700;
  var st = { data: null, loading: false, open: false, editing: '', said: '', tone: '' };

  var style = document.createElement('style');
  style.textContent = [
    '.cl{margin:22px 0 0;padding:14px 16px;border:1px solid var(--line)}',
    '.cl > summary{font-size:14px}',
    '.cl__lead{margin:8px 0 12px;font-size:13px;line-height:1.55;color:var(--muted);max-width:720px;overflow-wrap:anywhere}',
    '.cl__list{display:grid;gap:0;margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}',
    '.cl__row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}',
    '.cl__q{margin:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}',
    '.cl__meta{grid-column:1;margin:0;font-size:12px;line-height:1.4;color:var(--muted)}',
    '.cl__meta b{color:#8a5a12;font-weight:600}',
    '.cl__acts{grid-column:2;grid-row:1 / span 2;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}',
    '.cl__a{grid-column:1 / -1;margin:2px 0 0;font-size:13px;line-height:1.55;overflow-wrap:anywhere;white-space:pre-wrap}',
    '.cl__form{grid-column:1 / -1;display:grid;gap:12px;padding:12px 0 4px;max-width:720px}',
    '.cl__lab{display:grid;gap:6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.cl__in{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);font:inherit;font-size:14px;line-height:1.5;letter-spacing:0;text-transform:none;background:var(--paper,#fff);color:var(--ink)}',
    '.cl__in:focus{border-color:var(--ink);outline:none}',
    'textarea.cl__in{min-height:84px;resize:vertical}',
    /* a long question wraps rather than running out of its box */
    'textarea.cl__qin{min-height:0;field-sizing:content}',
    '.cl__hint{margin:0;font-size:12px;line-height:1.45;letter-spacing:0;text-transform:none;color:var(--muted)}',
    '.cl__btns{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
    '.cl__btns .press,.cl__btns .ghost{width:auto;min-height:40px;height:40px}',
    '.cl__say{margin:0 0 10px;font-size:13px;overflow-wrap:anywhere}.cl__say:empty{display:none}.cl__say[data-tone="bad"]{color:#a3251f}.cl__say[data-tone="good"]{color:#1f6b3a}',
    '.cl__empty{margin:0;padding:12px 0;font-size:14px;line-height:1.5;color:var(--muted)}',
    '.cl details.fold{margin:16px 0 0}',
    '@media (max-width:640px){.cl__row{grid-template-columns:minmax(0,1fr)}.cl__acts{grid-column:1;grid-row:auto;justify-content:flex-start}}'
  ].join('');
  document.head.appendChild(style);

  function api(body) { return A.api(URL_, body ? { method: 'POST', body: body } : undefined); }
  function times(n) { return n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'; }
  function find(id) {
    var d = st.data || { open: [], taught: [] };
    return d.open.filter(function (x) { return x.id === id; })[0] || d.taught.filter(function (x) { return x.id === id; })[0] || null;
  }

  function form(item, taught) {
    var also = taught ? (item.also || []).join('\n') : '';
    var answer = taught ? item.answer : '';
    return '<form class="cl__form" data-cl-form="' + esc(item.id) + '" autocomplete="off">'
      + '<label class="cl__lab">The question<textarea class="cl__in cl__qin" name="q" rows="2" maxlength="150">' + esc(item.q) + '</textarea></label>'
      + '<label class="cl__lab">The chat\'s answer<textarea class="cl__in" name="answer" maxlength="' + MAX + '" required>' + esc(answer) + '</textarea>'
      + '<span class="cl__hint">A sentence or two, as you would say it. Up to ' + MAX + ' letters.</span></label>'
      + '<details class="fold"><summary>More</summary><div class="cl__form">'
      + '<label class="cl__lab">A page of the site that says more<input class="cl__in" name="link" placeholder="donate.html" value="' + esc(taught ? item.link || '' : '') + '"></label>'
      + '<label class="cl__lab">Other ways people ask it<textarea class="cl__in" name="also" placeholder="One on each line">' + esc(also) + '</textarea>'
      + '<span class="cl__hint">The chat answers these the same way.</span></label></div></details>'
      + '<div class="cl__btns"><button type="submit" class="press">' + (taught ? 'Save the answer' : 'Teach the chat') + '</button><button type="button" class="ghost" data-cl-cancel>Cancel</button></div>'
      + '</form>';
  }

  function openRow(x) {
    var meta = 'Asked ' + times(x.n) + (x.wrong ? '. <b>The chat answered, but ' + (x.wrong === 1 ? 'once' : times(x.wrong)) + ' they still asked for a person.</b>' : '. The chat had no answer.');
    return '<li class="cl__row"><p class="cl__q">' + esc(x.q) + '</p><p class="cl__meta">' + meta + '</p>'
      + '<div class="cl__acts"><button type="button" class="ghost" data-cl-teach="' + esc(x.id) + '">Teach</button><button type="button" class="ghost" data-cl-ignore="' + esc(x.id) + '">Set aside</button></div>'
      + (st.editing === x.id ? form(x, false) : '') + '</li>';
  }
  function taughtRow(x) {
    return '<li class="cl__row"><p class="cl__q">' + esc(x.q) + '</p><p class="cl__meta">Taught by ' + esc(x.by || 'PFA') + (x.also && x.also.length ? ', with ' + x.also.length + (x.also.length === 1 ? ' other wording' : ' other wordings') : '') + (x.link ? ', links to ' + esc(x.link) : '') + '</p>'
      + '<div class="cl__acts"><button type="button" class="ghost" data-cl-teach="' + esc(x.id) + '">Change</button><button type="button" class="ghost" data-cl-forget="' + esc(x.id) + '">Forget</button></div>'
      + (st.editing === x.id ? form(x, true) : '<p class="cl__a">' + esc(x.answer) + '</p>') + '</li>';
  }

  function body() {
    if (!st.data) return '<p class="cl__empty">' + (st.loading ? 'Reading the questions.' : 'The questions could not be read just now.') + '</p>';
    var d = st.data;
    return '<p class="cl__say" data-cl-say role="status"' + (st.tone ? ' data-tone="' + st.tone + '"' : '') + '>' + esc(st.said) + '</p>'
      + '<p class="cl__lead">What visitors asked the chat in the last ' + d.days + ' days that it could not answer well, most asked first. Teach an answer and the chat gives it from then on. Only the words are kept: numbers, emails and phone numbers are taken out.</p>'
      + (d.open.length ? '<ul class="cl__list">' + d.open.map(openRow).join('') + '</ul>' : '<p class="cl__empty">Nothing waiting. Every question asked lately had an answer.</p>')
      + '<details class="fold"' + (st.editing && d.taught.some(function (x) { return x.id === st.editing; }) ? ' open' : '') + '><summary>Taught answers (' + d.taught.length + ')</summary>'
      + (d.taught.length ? '<ul class="cl__list">' + d.taught.map(taughtRow).join('') + '</ul>' : '<p class="cl__empty">None yet.</p>')
      + '</details>';
  }
  function title() {
    var n = st.data ? st.data.open.length : 0;
    return 'Teach the chat' + (st.data ? (n ? ': ' + n + (n === 1 ? ' question' : ' questions') + ' to answer' : ': nothing waiting') : '');
  }

  var host = null;
  function paint() {
    if (!host || !host.isConnected) return;
    host.querySelector('summary').textContent = title();
    host.querySelector('[data-cl-body]').innerHTML = body();
  }
  function load() {
    st.loading = true;
    return api().then(function (d) { st.data = d; }).catch(function () { st.data = st.data || null; })
      .then(function () { st.loading = false; paint(); });
  }
  function tell(text, tone) { st.said = text; st.tone = tone || ''; }

  function mount(pane) {
    if (!pane) return;
    var old = pane.querySelector('[data-cl]');
    if (old) old.remove();
    host = document.createElement('details');
    host.className = 'fold cl';
    host.setAttribute('data-cl', '');
    if (st.open) host.open = true;
    host.innerHTML = '<summary></summary><div data-cl-body></div>';
    pane.appendChild(host);
    host.addEventListener('toggle', function () { st.open = host.open; if (host.open) load(); });
    host.addEventListener('click', click);
    host.addEventListener('submit', submit);
    paint();
    if (!st.data && !st.loading) load();
  }

  function click(e) {
    var b = e.target.closest('button');
    if (!b || !host.contains(b)) return;
    if (b.hasAttribute('data-cl-teach')) { st.editing = b.getAttribute('data-cl-teach'); tell(''); paint(); var f = host.querySelector('[data-cl-form] textarea[name="answer"]'); if (f) f.focus(); return; }
    if (b.hasAttribute('data-cl-cancel')) { st.editing = ''; paint(); return; }
    var id = b.getAttribute('data-cl-ignore') || b.getAttribute('data-cl-forget');
    if (!id) return;
    var item = find(id);
    var action = b.hasAttribute('data-cl-ignore') ? 'ignore' : 'forget';
    b.disabled = true;
    api({ action: action, id: id, q: item ? item.q : '' }).then(function () {
      tell(action === 'ignore' ? 'Set aside: it is off the list.' : 'Forgotten: the chat no longer gives that answer.', 'good');
      return load();
    }).catch(function (err) { tell((err && err.message) || 'That could not be done.', 'bad'); b.disabled = false; paint(); });
  }
  function submit(e) {
    var f = e.target.closest('[data-cl-form]');
    if (!f) return;
    e.preventDefault();
    var id = f.getAttribute('data-cl-form');
    var btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    api({ action: 'teach', id: id, q: f.q.value, answer: f.answer.value, link: f.link.value, also: f.also.value }).then(function () {
      st.editing = '';
      tell('Taught. The chat gives this answer within five minutes.', 'good');
      return load();
    }).catch(function (err) { btn.disabled = false; tell((err && err.message) || 'That could not be saved.', 'bad'); var s = host.querySelector('[data-cl-say]'); if (s) { s.textContent = st.said; s.setAttribute('data-tone', 'bad'); } });
  }

  window.PFAChatLearn = { mount: mount, reload: load };
  var pane = document.querySelector('[data-pane="livechat"]');
  if (pane && pane.querySelector('.lc-grid')) mount(pane);
}());
