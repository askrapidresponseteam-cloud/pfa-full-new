/* Email this report, on Payments & donations (owner, 3 Nov 2026: "have 1
   option to send report from here to selected people with segregation. it
   should go as report, for the selected duration").

   The period and purpose are the ones chosen above the list. The report is
   the monthly report's: successful payments, grouped by purpose with each
   subtotal and the grand total, every payment listed, the CSV attached
   (lib/finance-report.js, sendPeriod). It goes only to the inboxes money
   already goes to: the payments inboxes, or the forms inbox with the
   payments inboxes copied. The server holds to that whatever is sent. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$; var esc = A.esc;
  var people = null;

  var style = document.createElement('style');
  style.textContent = '.pm-box{border:1px solid var(--line);padding:14px 16px;margin:0 0 12px;background:var(--paper)}.pm-box p{margin:0 0 10px;font-size:13px;line-height:1.5}.pm-box label{display:flex;gap:10px;align-items:flex-start;padding:6px 0;font-size:13px;cursor:pointer}.pm-box label input{margin:2px 0 0;flex:0 0 auto}.pm-box label small{display:block;color:var(--muted);font-size:12px}.pm-box label.is-off{opacity:.55;cursor:default}.pm-acts{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0;align-items:center}.pm-acts .press,.pm-acts .ghost{width:auto;margin:0}.pm-say{font-size:13px;line-height:1.5;margin:10px 0 0;overflow-wrap:anywhere}.pm-say[data-tone="bad"]{color:#a3251f}.pm-say[data-tone="good"]{color:#1f6b3a}';
  document.head.appendChild(style);

  function chosen(id) { var x = $(id); return x && x.selectedIndex >= 0 ? x.options[x.selectedIndex].textContent : ''; }

  /* the period and purpose as chosen above the list */
  function period() {
    var when = $('#payWhen') ? $('#payWhen').value : '';
    var out = { purpose: $('#payType') ? $('#payType').value : '', purposeLabel: $('#payType') && $('#payType').value ? chosen('#payType') : '' };
    if (/^\d{4}-\d{2}$/.test(when)) { out.month = when; out.label = chosen('#payWhen'); }
    else if (when === 'range') {
      out.from = $('#payFrom').value; out.dateTo = $('#payTo').value;
      out.label = [out.from, out.dateTo].filter(Boolean).join(' to ') || 'the dates chosen';
    } else out.label = 'all time';
    return out;
  }

  function box() {
    var b = $('#payMailBox');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'payMailBox'; b.className = 'pm-box'; b.hidden = true;
    var sum = $('#paySum');
    sum.parentNode.insertBefore(b, sum);
    return b;
  }

  function draw() {
    var b = box();
    var kept = Array.prototype.filter.call(b.querySelectorAll('input[type=checkbox]'), function (i) { return i.checked && !i.disabled; }).map(function (i) { return i.value; });
    var p = period();
    var form = (people || []).filter(function (x) { return x.role === 'Forms inbox'; })[0];
    b.innerHTML = '<p><b>Email the report for ' + esc(p.label) + (p.purposeLabel ? ', ' + esc(p.purposeLabel) + ' only' : '') + '.</b> Every successful payment in the period, grouped by purpose with each subtotal and the total, and the full list attached as a CSV.</p>'
      + (people ? people.map(function (x) {
        return '<label data-pm-role="' + esc(x.role) + '"><input type="checkbox" value="' + esc(x.address) + '"' + (kept.indexOf(x.address) !== -1 ? ' checked' : '') + '><span>' + esc(x.address)
          + '<small>' + esc(x.role) + (x.cc && x.cc.length ? '; the payments inboxes are copied' : '') + '</small></span></label>';
      }).join('') : '<p class="loading">Reading who it can go to…</p>')
      + '<div class="pm-acts"><button class="press" type="button" data-pm="send">Send the report</button><button class="ghost" type="button" data-pm="close">Cancel</button></div>'
      + '<p class="pm-say" data-pm-say role="status" aria-live="polite"></p>';
    b.setAttribute('data-form', form ? form.address : '');
    sync();
  }

  /* the forms inbox carries the payments inboxes in copy: ticked with it */
  function sync() {
    var b = box();
    var form = b.getAttribute('data-form');
    var formOn = Array.prototype.some.call(b.querySelectorAll('input[type=checkbox]'), function (i) { return i.value === form && i.checked; });
    Array.prototype.forEach.call(b.querySelectorAll('label[data-pm-role="Payments inbox"]'), function (l) {
      var i = l.querySelector('input');
      if (formOn) { i.checked = true; i.disabled = true; l.classList.add('is-off'); }
      else if (i.disabled) { i.checked = false; i.disabled = false; l.classList.remove('is-off'); }
    });
  }

  function open() {
    var b = box();
    if (!b.hidden) { b.hidden = true; return; }
    b.hidden = false;
    draw();
    if (people) return;
    A.api('/api/admin/finance-report?recipients=1').then(function (d) { people = d.recipients || []; draw(); }).catch(function (e) {
      var s = b.querySelector('[data-pm-say]'); s.textContent = e.message; s.setAttribute('data-tone', 'bad');
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#payMail')) { open(); return; }
    var act = e.target.closest && e.target.closest('[data-pm]');
    if (!act) return;
    var b = box();
    if (act.getAttribute('data-pm') === 'close') { b.hidden = true; return; }
    var say = b.querySelector('[data-pm-say]');
    var to = Array.prototype.filter.call(b.querySelectorAll('input[type=checkbox]'), function (i) { return i.checked && !i.disabled; }).map(function (i) { return i.value; });
    if (!to.length) { say.textContent = 'Tick who the report goes to.'; say.setAttribute('data-tone', 'bad'); return; }
    var p = period();
    if (p.from === '' && p.dateTo === '') { say.textContent = 'Choose the dates first.'; say.setAttribute('data-tone', 'bad'); return; }
    act.disabled = true;
    say.removeAttribute('data-tone');
    say.textContent = 'Making the report and sending it…';
    A.api('/api/admin/finance-report', { method: 'POST', body: { action: 'period', month: p.month || '', from: p.from || '', dateTo: p.dateTo || '', purpose: p.purpose, purposeLabel: p.purposeLabel, recipients: to } }).then(function (d) {
      var r = d.result || {};
      var went = (r.emails || []).map(function (x) { return x.to + (x.cc && x.cc.length ? ' (copied to ' + x.cc.join(', ') + ')' : '') + (x.state === 'sent' ? '' : ', going out shortly'); });
      say.textContent = 'Sent: ' + r.label + ', ' + r.count + (r.count === 1 ? ' payment, ' : ' payments, ') + r.total + '. To ' + went.join('; ') + '.';
      say.setAttribute('data-tone', 'good');
      act.disabled = false;
    }).catch(function (err) {
      say.textContent = err.message; say.setAttribute('data-tone', 'bad'); act.disabled = false;
    });
  });
  document.addEventListener('change', function (e) {
    if (e.target && e.target.closest && e.target.closest('#payMailBox') && e.target.type === 'checkbox') sync();
    /* the filters changed: the box says the new period */
    if (e.target && /^(payWhen|payType|payFrom|payTo)$/.test(e.target.id || '') && $('#payMailBox') && !$('#payMailBox').hidden) draw();
  });
})();
