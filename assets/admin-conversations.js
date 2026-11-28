/* Conversations: every email to info@ that is not about a submission
   (owner, 28 Nov 2026: "ensure every revert/reply of email is properly sent
   and received from info@ for all queries and responses.. back and forth").

   A reply to a card being posted, to an intern's start link, to a letter or a
   birthday card, and any new email a person wrote to info@, is listed here
   with what it answers. Open one to read the whole exchange and answer it:
   the answer goes from info@, in the same thread in their mail program, and
   their next reply comes back here. A conversation is closed when it is done
   and reopens by itself if they write again. Nothing here deletes anything. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$;
  var esc = A.esc;
  /* its own look, kept here so the panel's page stays under its size ceiling */
  var CSS = '.conv-views{gap:8px}' +
    '.conv-views .ghost[aria-pressed="true"]{border-color:var(--ink);font-weight:700}' +
    '.conv-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}' +
    '.conv-list > li{border-bottom:1px solid var(--line)}' +
    '.conv-row{display:block;width:100%;text-align:left;background:none;border:0;padding:14px 4px;min-height:44px;cursor:pointer;font:inherit;color:inherit}' +
    '.conv-row:hover,.conv-row[aria-expanded="true"]{background:#f6f6f4}' +
    '.conv-row:focus-visible{outline:2px solid var(--ink);outline-offset:-2px}' +
    '.conv-who{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-weight:600;font-size:14px;overflow-wrap:anywhere}' +
    '.conv-sub{display:block;font-size:13px;margin-top:3px;overflow-wrap:anywhere}' +
    '.conv-open{padding:4px 4px 18px}' +
    '.conv-thread{list-style:none;margin:8px 0 16px;padding:0;display:grid;gap:10px}' +
    '.conv-msg{border:1px solid var(--line);padding:12px 14px;max-width:72ch}' +
    '.conv-msg[data-dir="out"]{margin-left:auto;background:#f6f6f4}' +
    '.conv-meta{margin:0 0 6px;font-size:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
    '.conv-body{font-size:14px;line-height:1.55;overflow-wrap:anywhere}' +
    '.conv-body p{margin:0 0 8px}' +
    '.conv-open textarea{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:14px;padding:10px;border:1px solid var(--line);margin:6px 0 4px;resize:vertical}' +
    '.conv-open .act{margin-top:12px}';
  if (!document.getElementById('convCss')) {
    var st = document.createElement('style');
    st.id = 'convCss';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  var view = 'open';
  var openId = '';

  function when(value) {
    if (!value) return '-';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    var same = d.toDateString() === new Date().toDateString();
    return same ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  function who(p) {
    p = p || {};
    return p.name ? p.name + ' (' + p.email + ')' : (p.email || 'Someone');
  }
  function about(c) {
    if (!c.answers) return 'A new email to info@';
    var h = c.answers.hint || {};
    var ref = c.answers.reference || h.internId || h.orderId || h.memberId || h.cardId || h.number || '';
    return 'Reply to: ' + (c.answers.label || 'an email from the site') + (ref ? ', ' + ref : '');
  }
  function paras(text) {
    return String(text || '').trim().split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  function load(after) {
    var box = $('#conversations');
    if (!box) return Promise.resolve();
    return A.api('/api/admin/conversations?state=' + encodeURIComponent(view)).then(function (r) {
      var counts = r.counts || {};
      var list = r.conversations || [];
      var out = ['<h2>Conversations</h2>'];
      out.push('<p class="hint">Emails to info@ that are not about a form: replies to cards, letters, the internship, the shop, and new emails people write. Answer here and it goes from info@, in the same thread, and their next reply comes back here.</p>');
      out.push('<p class="state" data-tone="' + (counts.waiting ? 'bad' : 'good') + '">'
        + (counts.waiting ? '<b>' + counts.waiting + (counts.waiting === 1 ? ' is waiting for an answer.' : ' are waiting for an answer.') + '</b>' : 'Nothing is waiting for an answer.')
        + (counts.open ? ' ' + counts.open + ' open.' : '') + '</p>');
      if (!r.mailOn) out.push('<p class="state" data-tone="bad">Email cannot leave the site just now, so answers are kept and queued until it can.</p>');
      out.push('<div class="act conv-views" role="group" aria-label="Which conversations">'
        + ['open', 'closed', 'all'].map(function (v) {
          return '<button class="ghost" type="button" data-cv="' + v + '" aria-pressed="' + (v === view) + '">' + (v === 'open' ? 'Open' : v === 'closed' ? 'Closed' : 'All') + '</button>';
        }).join('') + '</div>');
      if (!list.length) {
        out.push('<p class="note">' + (view === 'closed' ? 'No closed conversations.' : view === 'all' ? 'No conversations yet.' : 'No open conversations.') + '</p>');
      } else {
        out.push('<ul class="conv-list">' + list.map(function (c) {
          return '<li><button type="button" class="conv-row" data-conv="' + esc(c.id) + '" aria-expanded="' + (c.id === openId) + '">'
            + '<span class="conv-who">' + esc(who(c.person)) + (c.needsAnswer ? ' <span class="flag" data-s="new">Waiting</span>' : c.state === 'closed' ? ' <span class="flag" data-s="handled">Closed</span>' : ' <span class="flag" data-s="sent">Answered</span>') + '</span>'
            + '<span class="conv-sub">' + esc(c.subject || '(no subject)') + '</span>'
            + '<span class="detail">' + esc(about(c)) + ', ' + esc(c.count) + (c.count === 1 ? ' email in' : ' emails in') + (c.replies ? ', ' + c.replies + (c.replies === 1 ? ' answer' : ' answers') : '') + ', last ' + esc(when(c.updatedAt)) + '</span>'
            + '</button><div class="conv-open" id="conv-' + esc(c.id) + '"' + (c.id === openId ? '' : ' hidden') + '></div></li>';
        }).join('') + '</ul>');
      }
      out.push('<p class="say" id="convSay"></p>');
      box.innerHTML = out.join('');
      if (after) A.say($('#convSay'), after.text, after.tone);
      Array.prototype.forEach.call(box.querySelectorAll('[data-cv]'), function (b) {
        b.addEventListener('click', function () { view = b.getAttribute('data-cv'); openId = ''; load(); });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-conv]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-conv');
          var pane = document.getElementById('conv-' + id);
          if (openId === id) { openId = ''; pane.hidden = true; b.setAttribute('aria-expanded', 'false'); return; }
          if (openId) {
            var was = document.getElementById('conv-' + openId);
            if (was) was.hidden = true;
            var wasB = box.querySelector('[data-conv="' + openId + '"]');
            if (wasB) wasB.setAttribute('aria-expanded', 'false');
          }
          openId = id;
          b.setAttribute('aria-expanded', 'true');
          show(id, pane);
        });
      });
      if (openId) { var p = document.getElementById('conv-' + openId); if (p) show(openId, p); }
    }).catch(function (e) {
      box.innerHTML = '<h2>Conversations</h2><p class="state" data-tone="bad">' + esc((e && e.message) || 'That could not be read.') + '</p>';
    });
  }

  function show(id, pane) {
    pane.hidden = false;
    pane.innerHTML = '<p class="note">Opening…</p>';
    A.api('/api/admin/conversations?id=' + encodeURIComponent(id)).then(function (r) {
      var c = r.conversation || {};
      var out = [];
      if (c.answers) {
        out.push('<p class="detail">' + esc(about(c)) + (c.answers.subject ? ': ' + esc(c.answers.subject) : '') + (c.answers.to ? ', sent to ' + esc(c.answers.to) : '') + '</p>');
      }
      out.push('<ol class="conv-thread">' + (r.messages || []).map(function (m) {
        var mine = m.direction === 'out';
        var from = mine ? 'PFA, from info@' + (m.by && (m.by.name || m.by.email) ? ' (' + (m.by.name || m.by.email) + ')' : '') : (m.party === 'staff' ? 'Staff, ' : '') + (m.fromName ? m.fromName + ' (' + m.from + ')' : m.from);
        var state = mine ? (m.state === 'sent' ? ' <span class="flag" data-s="sent">Sent</span>' : m.state ? ' <span class="flag" data-s="' + (m.state === 'unsent' ? 'failed' : 'queued') + '">' + esc(m.state === 'unsent' ? 'Not sent' : 'Queued') + '</span>' : '') : '';
        var relay = !mine && m.relay && m.relay.to && m.relay.to.length ? '<span class="detail">Sent on to ' + esc(m.relay.to.join(', ')) + '</span>' : '';
        var files = (m.attachments || []).length ? '<span class="detail">' + m.attachments.length + (m.attachments.length === 1 ? ' attachment' : ' attachments') + ' (' + esc(m.attachments.map(function (a) { return a.filename; }).join(', ')) + '), kept in the info@ mailbox</span>' : '';
        return '<li class="conv-msg" data-dir="' + (mine ? 'out' : 'in') + '"><p class="conv-meta"><b>' + esc(from) + '</b>, ' + esc(when(m.at)) + (m.auto ? ' <span class="flag">Automatic reply</span>' : '') + state + '</p>'
          + '<div class="conv-body">' + paras(m.text || '(no text)') + '</div>'
          + (m.fullText ? '<details class="fold"><summary>The whole email, with what it quoted</summary><div class="conv-body">' + paras(m.fullText) + '</div></details>' : '')
          + relay + files + '</li>';
      }).join('') + '</ol>');
      var to = (c.person && c.person.email) || '';
      if (to) {
        out.push('<label class="lab" for="convText-' + esc(id) + '">Answer ' + esc(who(c.person)) + ' from info@</label>'
          + '<textarea id="convText-' + esc(id) + '" rows="5" maxlength="20000" aria-describedby="convHint-' + esc(id) + '"></textarea>'
          + '<p class="hint" id="convHint-' + esc(id) + '">It goes from info@ under the subject "Re: ' + esc(String(c.subject || '').replace(/^(re|fwd?):\s*/i, '')) + '", with a greeting and your name added. Their reply comes back here.</p>');
      }
      out.push('<div class="act">'
        + (to ? '<button class="press" type="button" data-send style="width:auto">Send answer</button>' : '')
        + '<button class="ghost" type="button" data-state>' + (c.state === 'closed' ? 'Reopen' : 'Close') + '</button>'
        + '<p class="say" data-said></p></div>');
      pane.innerHTML = out.join('');
      var said = pane.querySelector('[data-said]');
      var send = pane.querySelector('[data-send]');
      if (send) send.addEventListener('click', function () {
        var field = document.getElementById('convText-' + id);
        var text = String(field.value || '').trim();
        if (text.length < 2) { A.say(said, 'Write the answer first.', 'bad'); field.focus(); return; }
        send.disabled = true;
        A.say(said, 'Sending…');
        A.api('/api/admin/conversations', { method: 'POST', body: { action: 'answer', id: id, text: text } }).then(function (o) {
          load({ text: o.message || 'Sent.', tone: o.state === 'unsent' ? 'bad' : 'good' });
        }).catch(function (e) {
          send.disabled = false;
          A.say(said, (e && e.data && e.data.message) || (e && e.message) || 'That did not go. Try again.', 'bad');
        });
      });
      pane.querySelector('[data-state]').addEventListener('click', function (ev) {
        var b = ev.currentTarget;
        b.disabled = true;
        A.api('/api/admin/conversations', { method: 'POST', body: { action: c.state === 'closed' ? 'reopen' : 'close', id: id } }).then(function (o) {
          if (o.state === 'closed' && view === 'open') openId = '';
          load({ text: o.state === 'closed' ? 'Closed. It opens again if they write back.' : 'Reopened.', tone: 'good' });
        }).catch(function (e) { b.disabled = false; A.say(said, (e && e.message) || 'That could not be done.', 'bad'); });
      });
    }).catch(function (e) {
      pane.innerHTML = '<p class="state" data-tone="bad">' + esc((e && e.message) || 'That could not be opened.') + '</p>';
    });
  }

  window.PFAConversations = { load: load };
})();
