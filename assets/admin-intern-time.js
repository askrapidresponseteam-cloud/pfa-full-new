/* People for Animals - reminders by hand and more time, in the panel's
   Internship section.
   ------------------------------------------------------------------------
   Owner, 12 Nov 2026: "there should be option to send reminder. we need
   option to extend timeline", and for the extensions "need all kinds of
   features. enterprise grade".

   On each intern's row: Remind (the email shown word for word first, an
   optional line from PFA, held back if they were reminded in the last 12
   hours unless sent anyway) and More time (their whole internship from a
   week, or one task to a new date; the dates that move shown before
   anything is kept; a reason kept for PFA, never emailed; the intern told
   if ticked; every change listed with Take back, which needs a reason too).

   Above the interns: Remind everyone behind (the list first, who is held
   back and why) and More time for the batch (the same as for one intern,
   for everyone, with the batch's own list and Take back).

   In Approve applications: Ask everyone missing a detail, the list first.

   The server (lib/intern-time.js, lib/routes/admin/internship.js) keeps
   every change in the audit log and refuses a send that was not previewed.
   admin.html calls PFAInternTime.bar / acts / badge / askAll as it draws
   the pane. Kept out of admin.html so that page stays under its ceiling.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A || window.PFAInternTime) return;
  var esc = A.esc;
  var URL_ = '/api/admin/internship';
  var MAX_DAYS = 56;
  var view = null;          /* the batch as last drawn */
  var apps = [];            /* the applications as last drawn */

  var style = document.createElement('style');
  style.textContent = [
    '.itm{width:min(980px,94vw)}',
    '.itm-body{flex:1;overflow-y:auto;display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:0;background:#f6f5f3}',
    '.itm-form{display:grid;gap:14px;align-content:start;padding:18px 22px;background:var(--paper);border-right:1px solid var(--line)}',
    '.itm-side{display:grid;gap:14px;align-content:start;padding:18px 22px;min-width:0}',
    '.itm-f{display:grid;gap:6px;min-width:0}',
    '.itm-f>span,.itm-k{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.itm-f input,.itm-f select,.itm-f textarea{width:100%;min-height:38px;padding:8px 10px;border:1px solid var(--line);font:inherit;font-size:14px;background:var(--paper);color:var(--ink)}',
    '.itm-f textarea{min-height:64px;resize:vertical}',
    '.itm-f input:focus,.itm-f select:focus,.itm-f textarea:focus{border-color:var(--ink);outline:none}',
    '.itm-f small{font-size:12px;line-height:1.45;color:var(--muted)}',
    '.itm-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}',
    '.itm-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.itm-chips button{min-height:30px;padding:0 12px;border:1px solid var(--line);background:var(--paper);font:inherit;font-size:12px;cursor:pointer;color:var(--ink)}',
    '.itm-chips button[aria-pressed="true"]{border-color:var(--ink);background:var(--ink);color:#fff}',
    '.itm-seg{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--ink)}',
    '.itm-seg button{min-height:38px;border:0;background:var(--paper);font:inherit;font-size:13px;cursor:pointer;color:var(--ink)}',
    '.itm-seg button[aria-pressed="true"]{background:var(--ink);color:#fff}',
    '.itm-tick{display:flex;align-items:flex-start;gap:8px;font-size:13px;line-height:1.45;cursor:pointer}',
    '.itm-tick input{margin:2px 0 0;width:16px;height:16px;flex:none;accent-color:var(--ink)}',
    '.itm-card{border:1px solid var(--line);background:var(--paper);min-width:0}',
    '.itm-card h4{margin:0;padding:10px 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid var(--line)}',
    '.itm-rows{margin:0;padding:6px 12px 10px;display:grid;gap:4px;font-size:13px;line-height:1.5}',
    '.itm-rows div{display:grid;grid-template-columns:minmax(0,140px) minmax(0,1fr);gap:10px}',
    '.itm-rows dt{color:var(--muted);overflow-wrap:anywhere}.itm-rows dd{margin:0;overflow-wrap:anywhere}',
    '.itm-empty{margin:0;padding:12px;font-size:13px;color:var(--muted);line-height:1.5}',
    '.itm-frame{display:block;width:100%;height:360px;border:0;background:#fff}',
    '.itm-subj{margin:0;padding:8px 12px;font-size:13px;font-weight:700;border-bottom:1px solid var(--line);overflow-wrap:anywhere}',
    '.itm-to{margin:0;padding:8px 12px 0;font-size:12px;color:var(--muted);overflow-wrap:anywhere}',
    '.itm-hist{list-style:none;margin:0;padding:0}',
    '.itm-hist li{padding:10px 12px;border-top:1px solid var(--line);font-size:13px;line-height:1.5;display:grid;gap:6px}',
    '.itm-hist li:first-child{border-top:0}',
    '.itm-hist .itm-off{color:var(--muted);text-decoration:line-through}',
    '.itm-hist .note{font-size:12px}',
    '.itm-form .itm-card h4{padding:10px 12px}',
    '.itm-said{margin:0;font-size:12px}.itm-said:empty{display:none}',
    '.itm-back{display:flex;flex-wrap:wrap;gap:8px}',
    '.itm-back input{flex:1;min-width:160px;min-height:34px;padding:0 8px;border:1px solid var(--line);font:inherit;font-size:13px}',
    '.itm-back .ghost{min-height:34px}',
    '.itm-t{width:100%;border-collapse:collapse;font-size:13px}',
    '.itm-t th{text-align:left;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:400;padding:8px 12px;border-bottom:1px solid var(--line)}',
    '.itm-t td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}',
    '.itm-t tr[data-skip] td{color:var(--muted)}',
    '.itm-held{margin:0;padding:10px 12px;border:1px solid var(--ink);background:var(--paper);font-size:13px;line-height:1.5}',
    '.ip-time{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 0 10px}',
    '.ip-time .ghost{min-height:36px}',
    '.ip-time .note{font-size:12px}',
    '.ip-acts2{display:flex;flex-wrap:wrap;gap:4px 12px}',
    '.ip-acts2 .linky{display:inline;margin:0;padding:0}',
    '.ip-ask{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}',
    '@media (max-width:760px){.itm .rgm-foot .rg-say{flex-basis:100%}.itm-body{grid-template-columns:minmax(0,1fr)}.itm-form{border-right:0;border-bottom:1px solid var(--line)}.itm-frame{height:300px}.itm-rows div{grid-template-columns:minmax(0,1fr)}}'
  ].join('');
  document.head.appendChild(style);

  var dlg = document.createElement('dialog');
  dlg.className = 'rgm itm';
  dlg.id = 'ipTime';
  dlg.setAttribute('aria-label', 'Reminders and more time');
  document.body.appendChild(dlg);
  var st = {};
  var asked = 0;
  var timer = 0;

  function q(sel) { return dlg.querySelector(sel); }
  function val(sel) { var el = q(sel); return el ? el.value : ''; }
  function close() { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  function openDlg() { if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', ''); }
  function sayIn(text, tone) { var s = q('[data-it-say]'); if (s) A.say(s, text, tone || ''); }
  function when(isoS) {
    if (!isoS) return '';
    try { return new Date(isoS).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }); } catch (e) { return isoS; }
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : ''; }
  function plural(n, one) { return n + ' ' + one + (n === 1 ? '' : 's'); }
  function weeksOf() { return (view && view.batch && view.batch.weeks) || []; }
  function internOf(id) { return ((view && view.interns) || []).filter(function (r) { return r.internId === id; })[0] || null; }
  function clampWeek(n) { var w = weeksOf().length || 1; return Math.max(1, Math.min(w, Number(n) || 1)); }
  function api(body) { return A.api(URL_, { method: 'POST', body: body }); }
  function reload() { try { A.refresh(); } catch (e) { /* the pane reloads on its next visit */ } }

  function head(title, sub) {
    return '<div class="rgm-head"><h3>' + esc(title) + '</h3>' + (sub ? '<p class="rgm-sub">' + sub + '</p>' : '') + '</div>';
  }
  function foot(sendLabel) {
    return '<div class="rgm-foot"><p class="rg-say" data-it-say role="status" aria-live="polite"></p>'
      + '<button class="ghost" type="button" data-it="close">Close</button>'
      + (sendLabel ? '<button class="press" type="button" data-it="go" disabled>' + esc(sendLabel) + '</button>' : '') + '</div>';
  }
  function emailCard(e, label) {
    if (!e) return '';
    return '<div class="itm-card"><h4>' + esc(label || 'The email') + '</h4>' + (e.to ? '<p class="itm-to">To ' + esc(e.to) + '</p>' : '')
      + '<p class="itm-subj">' + esc(e.subject) + '</p><iframe class="itm-frame" sandbox="" title="The email" data-it-frame></iframe></div>';
  }
  function fillFrame(html) { var f = q('[data-it-frame]'); if (f) f.setAttribute('srcdoc', html || ''); }
  function goBtn() { return q('[data-it="go"]'); }

  /* ---- reminders --------------------------------------------------------- */

  function remindOne(id) {
    var r = internOf(id) || { internId: id, name: id };
    st = { mode: 'remind', internId: id, token: '', held: false };
    dlg.innerHTML = head('Remind ' + r.name, esc(r.internId) + ' · ' + esc(r.email || '') + '. The email lists what is still open for them, with each due date.')
      + '<div class="itm-body"><div class="itm-form">'
      + '<label class="itm-f"><span>A line from PFA (optional)</span><textarea maxlength="600" data-it-note placeholder="For example: Do write if you are stuck."></textarea><small>Goes at the top of the email, as written.</small></label>'
      + '<div data-it-last></div>'
      + '</div><div class="itm-side" data-it-side><p class="itm-empty">Getting the email ready…</p></div></div>'
      + foot('Send the reminder');
    openDlg();
    previewSoon(0);
  }

  function remindAll() {
    st = { mode: 'behind', token: '', force: false };
    var b = (view && view.batch) || {};
    dlg.innerHTML = head('Remind everyone behind', esc(b.name || '') + '. Every active intern with something open gets their own list, with their own due dates.')
      + '<div class="itm-body"><div class="itm-form">'
      + '<label class="itm-f"><span>A line from PFA (optional)</span><textarea maxlength="600" data-it-note placeholder="For example: The week ends on Sunday."></textarea><small>Goes at the top of every email, as written.</small></label>'
      + '<label class="itm-tick"><input type="checkbox" data-it-force> Also those reminded in the last 12 hours</label>'
      + '</div><div class="itm-side" data-it-side><p class="itm-empty">Finding who is behind…</p></div></div>'
      + foot('Send');
    openDlg();
    previewSoon(0);
  }

  function askAll() {
    st = { mode: 'ask', token: '' };
    dlg.innerHTML = head('Ask everyone missing a detail', 'Each applicant missing their email, mobile or date of birth is emailed to send the form again; it joins the same application. Once a day at most for each.')
      + '<div class="itm-body" style="grid-template-columns:minmax(0,1fr)"><div class="itm-side" data-it-side><p class="itm-empty">Finding who is missing a detail…</p></div></div>'
      + foot('Ask them');
    openDlg();
    previewSoon(0);
  }

  /* ---- more time --------------------------------------------------------- */

  function timeFor(scope, id) {
    var b = (view && view.batch) || {};
    var r = scope === 'intern' ? internOf(id) : null;
    var nowWeek = clampWeek(scope === 'intern' && r ? r.week : b.week);
    st = { mode: 'time', scope: scope, internId: id || '', kind: 'weeks', days: 7 };
    var weeks = weeksOf();
    var tasks = (b.tasks || []);
    var title = scope === 'batch' ? 'More time for the batch' : 'More time for ' + (r ? r.name : id);
    var sub = scope === 'batch'
      ? esc(b.name || '') + ' ends ' + esc(day(b.endsOn)) + (b.extendedDays ? ' (' + plural(b.extendedDays, 'day') + ' added so far)' : '') + '. Every intern in it moves; their own extensions add on top.'
      : esc(id) + ' · ends ' + esc(day(r && r.endsOn)) + '. Only this intern moves; the batch stays as it is.';
    dlg.innerHTML = head(title, sub)
      + '<div class="itm-body"><div class="itm-form">'
      + (scope === 'intern' ? '<div class="itm-seg" role="group" aria-label="What moves"><button type="button" data-it-kind="weeks" aria-pressed="true">The internship</button><button type="button" data-it-kind="task" aria-pressed="false">One task</button></div>' : '')
      + '<div data-it-weeks><div class="itm-two"><label class="itm-f"><span>From week</span><select data-it-from>' + weeks.map(function (w) { return '<option value="' + w.n + '"' + (w.n === nowWeek ? ' selected' : '') + '>Week ' + w.n + '</option>'; }).join('') + '</select></label>'
      + '<label class="itm-f"><span>More days</span><input type="number" min="1" max="' + MAX_DAYS + '" step="1" value="7" inputmode="numeric" data-it-days></label></div>'
      + '<div class="itm-chips" style="margin-top:8px" role="group" aria-label="Days">' + [3, 7, 14, 21].map(function (n) { return '<button type="button" data-it-chip="' + n + '" aria-pressed="' + (n === 7) + '">' + n + ' days</button>'; }).join('') + '</div>'
      + '<small class="note" style="display:block;margin-top:8px">That week’s due date and every one after it move by these days. Up to ' + MAX_DAYS + ' at a time.</small></div>'
      + (scope === 'intern' ? '<div data-it-task hidden><label class="itm-f"><span>Task</span><select data-it-taskkey>' + tasks.map(function (t) { return '<option value="' + esc(t.key) + '">' + esc(t.title) + '</option>'; }).join('') + '</select></label>'
        + '<label class="itm-f" style="margin-top:12px"><span>New due date</span><input type="date" data-it-until></label><small class="note" style="display:block;margin-top:8px">Due at 11:59 pm that day. The other tasks keep their dates.</small></div>' : '')
      + '<label class="itm-f"><span>Why (kept for PFA)</span><input maxlength="300" data-it-reason placeholder="For example: exams"><small>Needed to save. In the audit log, never in the email.</small></label>'
      + '<label class="itm-f"><span>A line for the intern' + (scope === 'batch' ? 's' : '') + ' (optional)</span><textarea maxlength="600" data-it-note placeholder="For example: Take the festival week off."></textarea></label>'
      + '<label class="itm-tick"><input type="checkbox" data-it-notify checked> Email ' + (scope === 'batch' ? 'every active intern' : 'the intern') + ' the new dates</label>'
      + history(scope, id)
      + '</div><div class="itm-side" data-it-side><p class="itm-empty">Working out the new dates…</p></div></div>'
      + foot(scope === 'batch' ? 'Give the batch more time' : 'Give more time');
    openDlg();
    previewSoon(0);
  }

  /* every change so far, newest first, each with Take back */
  function history(scope, id) {
    var items = [];
    if (scope === 'batch') {
      ((view && view.batch && view.batch.extensions) || []).forEach(function (e) { items.push({ scope: 'batch', id: e.id, text: plural(e.days, 'day') + ' from week ' + e.fromWeek, e: e }); });
    } else {
      var r = internOf(id) || {};
      (r.extensions || []).forEach(function (e) { items.push({ scope: 'intern', id: e.id, text: plural(e.days, 'day') + ' from week ' + e.fromWeek, e: e }); });
      (r.moved || []).forEach(function (m) { items.push({ scope: 'task', id: m.taskKey, text: m.title + ' due ' + day(m.until) + (m.was ? ' (was ' + day(m.was) + ')' : ''), e: m }); });
    }
    items.sort(function (a, b) { return String(b.e.at).localeCompare(String(a.e.at)); });
    var out = '<div class="itm-card"><h4>Changes so far' + (items.length ? ' (' + items.length + ')' : '') + '</h4>';
    if (!items.length) return out + '<p class="itm-empty">None yet' + (scope === 'intern' ? ' for this intern' : ' for the batch') + '.</p></div>';
    out += '<ul class="itm-hist">' + items.map(function (x) {
      var e = x.e;
      return '<li data-it-scope="' + x.scope + '" data-it-id="' + esc(x.id) + '"><span' + (e.undone ? ' class="itm-off"' : '') + '><b>' + esc(x.text) + '</b></span>'
        + '<span class="note">' + esc(e.reason || '') + (e.by ? ' · ' + esc(e.by) : '') + (e.at ? ', ' + esc(when(e.at)) : '') + '</span>'
        + (e.undone ? '<span class="note">Taken back by ' + esc(e.undoneBy) + ', ' + esc(when(e.undoneAt)) + ': ' + esc(e.undoneWhy) + '</span>'
          : '<div class="itm-back"><input maxlength="300" placeholder="Why it is taken back" aria-label="Why it is taken back" data-it-why><button class="ghost" type="button" data-it="undo">Take back</button></div><p class="say itm-said" data-it-said role="status" aria-live="polite"></p>')
        + '</li>';
    }).join('') + '</ul></div>';
    return out;
  }

  /* ---- previews ---------------------------------------------------------- */

  function previewSoon(ms) { clearTimeout(timer); timer = setTimeout(preview, ms == null ? 350 : ms); }

  function body(preview) {
    var note = val('[data-it-note]');
    if (st.mode === 'remind') return { action: 'remind', internId: st.internId, note: note, preview: preview, token: st.token, force: st.held };
    if (st.mode === 'behind') { var f = q('[data-it-force]'); return { action: 'remind-behind', batchId: view.batch.batchId, note: note, preview: preview, token: st.token, force: Boolean(f && f.checked) }; }
    if (st.mode === 'ask') return { action: 'ask-missing', preview: preview, token: st.token };
    var common = { reason: val('[data-it-reason]'), note: note, notify: Boolean((q('[data-it-notify]') || {}).checked), preview: preview };
    if (st.scope === 'batch') return Object.assign({ action: 'extend-batch', batchId: view.batch.batchId, fromWeek: Number(val('[data-it-from]')), days: Number(val('[data-it-days]')) }, common);
    if (st.kind === 'task') return Object.assign({ action: 'move-task', internId: st.internId, taskKey: val('[data-it-taskkey]'), until: val('[data-it-until]') }, common);
    return Object.assign({ action: 'extend-intern', internId: st.internId, fromWeek: Number(val('[data-it-from]')), days: Number(val('[data-it-days]')) }, common);
  }

  function preview() {
    var side = q('[data-it-side]');
    if (!side) return;
    var go = goBtn();
    if (go) go.disabled = true;
    st.token = '';
    if (st.mode === 'time' && st.kind === 'task' && !val('[data-it-until]')) { side.innerHTML = '<p class="itm-empty">Choose the new due date to see what moves.</p>'; return; }
    var mine = ++asked;
    api(body(true)).then(function (d) {
      if (mine !== asked) return;
      st.token = d.token || '';
      if (st.mode === 'remind') drawRemind(side, d);
      else if (st.mode === 'behind') drawBehind(side, d);
      else if (st.mode === 'ask') drawAsk(side, d);
      else drawTime(side, d);
    }).catch(function (err) {
      if (mine !== asked) return;
      side.innerHTML = '<p class="itm-empty">' + esc((err && err.message) || 'That could not be worked out.') + '</p>';
    });
  }

  function drawRemind(side, d) {
    side.innerHTML = emailCard({ to: d.to, subject: d.subject }, 'The email, as it goes');
    fillFrame(d.html);
    var last = q('[data-it-last]');
    st.held = Boolean(d.held);
    if (last) last.innerHTML = d.last ? (d.held ? '<p class="itm-held">Reminded ' + esc(when(d.last.at)) + ' by ' + esc(d.last.by) + '. Held back for 12 hours so nobody gets two in a row; send anyway only if it is needed.</p>' : '<p class="note" style="margin:0">Last reminded ' + esc(when(d.last.at)) + ' by ' + esc(d.last.by) + '.</p>') : '<p class="note" style="margin:0">Not reminded by hand before.</p>';
    var go = goBtn();
    go.textContent = d.held ? 'Send anyway' : 'Send the reminder';
    go.disabled = false;
    sayIn(plural(d.items, 'thing') + ' open.', '');
  }

  function drawBehind(side, d) {
    var list = d.interns || [];
    var force = Boolean((q('[data-it-force]') || {}).checked);
    var going = list.filter(function (x) { return !x.skip || force; }).length;
    var html = '<div class="itm-card"><h4>Who gets one (' + going + ' of ' + list.length + ')</h4>';
    if (!list.length) html += '<p class="itm-empty">No active intern in this batch has anything open.</p>';
    else html += '<div class="wrap"><table class="itm-t"><thead><tr><th>Intern</th><th>Open</th></tr></thead><tbody>' + list.map(function (x) {
      var skip = x.skip && !force;
      return '<tr' + (skip ? ' data-skip' : '') + '><td><b>' + esc(x.name) + '</b><br><span class="note">' + esc(x.email) + '</span>' + (x.skip ? '<br><span class="note">' + (force ? 'Sent anyway: ' : 'Held back: ') + esc(x.skip) + '</span>' : '') + '</td><td>' + x.lines.map(esc).join('<br>') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    html += '</div>';
    if (d.sample) html += emailCard({ subject: d.sample.subject }, 'One of the emails, as it goes');
    side.innerHTML = html;
    if (d.sample) fillFrame(d.sample.html);
    var go = goBtn();
    go.textContent = going ? 'Send to ' + plural(going, 'intern') : 'Nobody to send to';
    go.disabled = !going;
    sayIn('', '');
  }

  function drawAsk(side, d) {
    var list = d.applications || [];
    var going = list.filter(function (x) { return !x.skip; }).length;
    var html = '<div class="itm-card"><h4>Who is asked (' + going + ' of ' + list.length + ')</h4>';
    if (!list.length) html += '<p class="itm-empty">Every application waiting has all three details.</p>';
    else html += '<div class="wrap"><table class="itm-t"><thead><tr><th>Applicant</th><th>Missing</th><th>Asked</th></tr></thead><tbody>' + list.map(function (x) {
      return '<tr' + (x.skip ? ' data-skip' : '') + '><td><b>' + esc(x.name || x.reference) + '</b><br><span class="note">' + esc(x.reference) + (x.email ? ' · ' + esc(x.email) : '') + '</span>' + (x.skip ? '<br><span class="note">Skipped: ' + esc(x.skip) + '</span>' : '') + '</td><td>' + esc(x.missing.join(', ')) + '</td><td>' + (x.asks ? plural(x.asks, 'time') + (x.askedAt ? ', last ' + esc(when(x.askedAt)) : '') : 'Not yet') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    side.innerHTML = html + '</div>';
    var go = goBtn();
    go.textContent = going ? 'Ask ' + plural(going, 'applicant') : 'Nobody to ask';
    go.disabled = !going;
  }

  function drawTime(side, d) {
    var rows = d.rows || [];
    var html = '<div class="itm-card"><h4>What moves</h4><dl class="itm-rows">' + rows.map(function (r) { return '<div><dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) + '</dd></div>'; }).join('') + '</dl></div>';
    var notify = Boolean((q('[data-it-notify]') || {}).checked);
    if (d.email && notify) html += emailCard(d.email, st.scope === 'batch' ? 'The email each intern gets' + (d.interns ? ' (' + d.interns + ')' : '') + ', with their own dates' : 'The email, as it goes');
    side.innerHTML = html;
    if (d.email && notify) fillFrame(d.email.html);
    var go = goBtn();
    var why = val('[data-it-reason]').trim();
    go.disabled = why.length < 4;
    if (st.kind === 'task') go.textContent = 'Move the date';
    else go.textContent = 'Give ' + plural(Number(val('[data-it-days]')) || 0, 'more day');
    sayIn(d.endsOn ? 'Would end ' + day(d.endsOn) + '.' : '', '');
  }

  /* ---- sending and saving ------------------------------------------------ */

  function go(btn) {
    btn.disabled = true;
    sayIn(st.mode === 'time' ? 'Saving…' : 'Sending…', '');
    api(body(false)).then(function (r) {
      var text;
      if (st.mode === 'remind') text = r.state === 'failed' ? 'The email did not go. Try again later.' : 'Reminder ' + (r.state === 'queued' ? 'queued; it goes shortly.' : 'sent.');
      else if (st.mode === 'behind') text = r.sent + ' sent' + (r.queued ? ', ' + r.queued + ' queued' : '') + (r.failed ? ', ' + r.failed + ' did not go' : '') + (r.held ? ', ' + r.held + ' held back' : '') + '.';
      else if (st.mode === 'ask') text = plural(r.asked, 'applicant') + ' asked' + (r.skipped ? ', ' + r.skipped + ' skipped' : '') + (r.failed ? ', ' + r.failed + ' did not go' : '') + '.';
      else if (r.task) text = 'Moved to ' + day(r.until) + (r.told && r.told.state === 'sent' ? '; the intern has been emailed.' : '.');
      else {
        var told = Array.isArray(r.told) ? r.told.filter(function (t) { return t.state === 'sent' || t.state === 'queued'; }).length : (r.told && (r.told.state === 'sent' || r.told.state === 'queued') ? 1 : 0);
        text = 'Saved. Now ends ' + day(r.endsOn) + (told ? '; ' + plural(told, 'intern') + ' emailed.' : '.');
      }
      done(text, r.state === 'failed' ? 'bad' : 'good');
    }).catch(function (err) {
      btn.disabled = false;
      if (err && /PREVIEW_STALE|changed since the preview/i.test(String(err.code || err.message))) previewSoon(0);
      sayIn((err && err.message) || 'That did not go through.', 'bad');
    });
  }

  function done(text, tone) {
    var go = goBtn();
    if (go) go.remove();
    var c = q('[data-it="close"]');
    if (c) { c.className = 'press'; c.textContent = 'Done'; c.focus(); }
    dlg.querySelectorAll('.itm-form input, .itm-form select, .itm-form textarea, .itm-form button').forEach(function (el) { el.disabled = true; });
    sayIn(text, tone);
    reload();
  }

  function undo(li, btn) {
    var why = (li.querySelector('[data-it-why]') || {}).value || '';
    var said = li.querySelector('[data-it-said]');
    if (why.trim().length < 4) { A.say(said, 'Say why it is taken back, in a few words.', 'bad'); li.querySelector('[data-it-why]').focus(); return; }
    var scope = li.getAttribute('data-it-scope');
    var id = li.getAttribute('data-it-id');
    var b = { action: 'undo-time', scope: scope, reason: why };
    if (scope === 'batch') { b.batchId = view.batch.batchId; b.id = id; }
    else if (scope === 'intern') { b.internId = st.internId; b.id = id; }
    else { b.internId = st.internId; b.taskKey = id; }
    btn.disabled = true;
    api(b).then(function () {
      li.querySelector('.itm-back').outerHTML = '<span class="note">Taken back just now: ' + esc(why) + '. The dates are as they were before it.</span>';
      li.firstChild.className = 'itm-off';
      A.say(said, '', '');
      reload();
      previewSoon(0);
    }).catch(function (err) { btn.disabled = false; A.say(said, (err && err.message) || 'That could not be taken back.', 'bad'); });
  }

  /* ---- the dialog's own clicks and typing -------------------------------- */

  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) { close(); return; }
    var b = e.target.closest('button');
    if (!b) return;
    var it = b.getAttribute('data-it');
    if (it === 'close') { close(); return; }
    if (it === 'go' && !b.disabled) { go(b); return; }
    if (it === 'undo') { undo(b.closest('li'), b); return; }
    var chip = b.getAttribute('data-it-chip');
    if (chip) {
      q('[data-it-days]').value = chip;
      dlg.querySelectorAll('[data-it-chip]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
      previewSoon(0);
      return;
    }
    var kind = b.getAttribute('data-it-kind');
    if (kind) {
      st.kind = kind;
      dlg.querySelectorAll('[data-it-kind]').forEach(function (c) { c.setAttribute('aria-pressed', String(c === b)); });
      q('[data-it-weeks]').hidden = kind !== 'weeks';
      q('[data-it-task]').hidden = kind !== 'task';
      previewSoon(0);
    }
  });
  dlg.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-it-why')) return;
    if (t.hasAttribute('data-it-days')) {
      dlg.querySelectorAll('[data-it-chip]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-it-chip') === t.value)); });
    }
    if (t.hasAttribute('data-it-reason') && st.mode === 'time') {
      /* the reason is not in the preview: only whether Save is allowed */
      var go = goBtn();
      var ok = t.value.trim().length >= 4;
      if (go && q('[data-it-side] .itm-card')) go.disabled = !ok;
      return;
    }
    previewSoon();
  });
  dlg.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('select, [data-it-notify], [data-it-force], [data-it-until]')) previewSoon(0);
  });
  dlg.addEventListener('cancel', function () { clearTimeout(timer); asked += 1; });

  /* ---- what admin.html draws --------------------------------------------- */

  function bar(v) {
    view = v;
    var b = v.batch || {};
    var ext = (b.extensions || []).filter(function (e) { return !e.undone; });
    return '<div class="ip-time"><button class="ghost" type="button" data-it-open="behind">Remind everyone behind</button>'
      + '<button class="ghost" type="button" data-it-open="batch">More time for the batch</button>'
      + (ext.length ? '<span class="note">' + plural(b.extendedDays || 0, 'day') + ' added (' + plural(ext.length, 'extension') + '); first planned to end ' + esc(day(b.baseEndsOn)) + '</span>' : '')
      + '</div>';
  }
  function acts(r) {
    if (r.status === 'revoked') return '';
    return '<span class="ip-acts2">' + (r.status === 'active' ? '<button class="linky" type="button" data-it-open="remind">Remind</button>' : '')
      + '<button class="linky" type="button" data-it-open="time">More time</button></span><br>';
  }
  function badge(r) {
    var bits = [];
    var own = (r.extensions || []).filter(function (e) { return !e.undone; }).reduce(function (s, e) { return s + Number(e.days || 0); }, 0);
    var moved = (r.moved || []).filter(function (m) { return !m.undone; }).length;
    if (r.endsOn && (own || moved)) bits.push('ends ' + day(r.endsOn) + (own ? ', +' + own + ' own' : '') + (moved ? ', ' + plural(moved, 'task') + ' moved' : ''));
    var n = r.nudges || [];
    if (n.length) bits.push('reminded ' + when(n[n.length - 1].at));
    return bits.length ? '<br><span class="note">' + esc(bits.join(' · ')) + '</span>' : '';
  }
  function askBar(list) {
    apps = list || [];
    var n = apps.filter(function (a) { return a.missing && a.missing.length; }).length;
    return n > 1 ? '<div class="ip-ask"><button class="ghost" type="button" data-it-open="ask">Ask all ' + n + ' missing a detail</button></div>' : '';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-it-open]');
    if (!b) return;
    var what = b.getAttribute('data-it-open');
    var row = b.closest('tr[data-intern]');
    if (what === 'remind') remindOne(row.getAttribute('data-intern'));
    else if (what === 'time') timeFor('intern', row.getAttribute('data-intern'));
    else if (what === 'behind') remindAll();
    else if (what === 'batch') timeFor('batch');
    else if (what === 'ask') askAll();
  });

  window.PFAInternTime = { bar: bar, acts: acts, badge: badge, askAll: askBar };
}());
