/* The last look before a form is sent.
   ------------------------------------------------------------------------
   Asked for on 16 Sep 2026: before anything is submitted, show the person
   everything they are about to send, then ask them, on its own, to check
   the two details PFA reaches them on. A mistyped email means no
   confirmation arrives, and a mistyped mobile or email means nobody at PFA
   can get back to them.

   Every public form calls PFAPreview.confirm(form, options) after its own
   checks have passed and before it sends, uploads or pays. It resolves true
   when the person confirms and false when they go back. Nothing is disabled,
   uploaded or sent while it is open, so going back leaves the form exactly
   as it was.

     Step 1  Everything being sent: every filled field under the label the
             person saw, in the order the form asked for it.
     Step 2  How PFA reaches you: the email and mobile, large, a likely typo
             in a big provider's domain offered as a one-tap fix (never
             applied without the tap), and a box to tick that says both are
             right before the send button will go.

     options  title   heading for step 1
              send    wording of the final button, usually the form's own
              labels  { id or name: label } where the page's label will not do
              extra   [[label, value]] for what is not a field (an amount,
                      the areas picked, a photograph attached)
              contact { email, mobile } inputs, when not found by type

   Values are always written as text, never as markup. The dialog is a native
   <dialog> opened modal where the browser has one (focus held inside, Escape
   goes back, the page behind inert) and a fixed overlay with a focus trap
   where it does not. A second call while one is open resolves false, so a
   double press can never send twice. test/form-preview.test.js holds it. */

(function () {
  'use strict';

  var STYLE_ID = 'pfa-pv-style';
  var open = false;
  var uid = 0;

  /* Big providers people actually use here. A domain one slip away from one
     of these is probably that one; a real provider that sits close to one
     (mail.com beside gmail.com) is listed so it is never "corrected". */
  var COMMON = ['gmail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rediffmail.com',
    'outlook.com', 'hotmail.com', 'icloud.com', 'protonmail.com', 'zoho.com'];
  var REAL = ['mail.com', 'email.com', 'gmx.com', 'gmx.net', 'yandex.com', 'fastmail.com', 'live.com', 'live.in',
    'outlook.in', 'hotmail.co.uk', 'yahoo.co.uk', 'me.com', 'mac.com', 'aol.com', 'msn.com', 'proton.me', 'zohomail.in'];
  var TLD = { con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', comm: 'com', cim: 'com', coom: 'com' };

  /* Edits between two strings, a swapped pair of letters counting as one. */
  function distance(a, b) {
    var d = [];
    var i;
    var j;
    for (i = 0; i <= a.length; i += 1) d[i] = [i];
    for (j = 0; j <= b.length; j += 1) d[0][j] = j;
    for (i = 1; i <= a.length; i += 1) {
      for (j = 1; j <= b.length; j += 1) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  function suggestEmail(value) {
    var match = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(String(value || '').trim());
    if (!match) return '';
    var local = match[1];
    var domain = match[2].toLowerCase();
    if (COMMON.indexOf(domain) > -1 || REAL.indexOf(domain) > -1) return '';
    var best = '';
    var bestScore = 99;
    COMMON.forEach(function (known) {
      var score = distance(domain, known);
      if (score < bestScore) { bestScore = score; best = known; }
    });
    if (best && bestScore <= (best.length > 10 ? 2 : 1)) return local + '@' + best;
    var parts = domain.split('.');
    var tld = parts[parts.length - 1];
    if (Object.prototype.hasOwnProperty.call(TLD, tld)) {
      parts[parts.length - 1] = TLD[tld];
      return local + '@' + parts.join('.');
    }
    return '';
  }

  function formatMobile(value) {
    var digits = String(value || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (/^[6-9]\d{9}$/.test(digits)) return '+91 ' + digits.slice(0, 5) + ' ' + digits.slice(5);
    return String(value || '').trim();
  }

  function escapeId(id) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(id);
    return String(id).replace(/["\\[\]]/g, '\\$&');
  }

  /* A label's words, without the hints, errors and controls inside it. */
  function words(node) {
    if (!node) return '';
    var copy = node.cloneNode(true);
    [].forEach.call(copy.querySelectorAll('.opt, small, .error, .err, input, select, textarea, button, script, style, [aria-hidden="true"]'), function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
    /* a space at every element's end, so a card's name and price do not run together */
    [].forEach.call(copy.querySelectorAll('*'), function (n) { n.appendChild(document.createTextNode(' ')); });
    return copy.textContent.replace(/\s+/g, ' ').replace(/\s+([,.;:!?)])/g, '$1').trim();
  }

  function humanise(key) {
    return String(key || 'Detail').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function given(labels, keys) {
    if (!labels) return '';
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i] && Object.prototype.hasOwnProperty.call(labels, keys[i])) return String(labels[keys[i]]);
    }
    return '';
  }

  function labelFor(field, labels) {
    var text = given(labels, [field.id, field.name]) || field.getAttribute('data-preview-label') || '';
    if (!text && field.id) text = words(document.querySelector('label[for="' + escapeId(field.id) + '"]'));
    if (!text && field.getAttribute('aria-labelledby')) {
      text = field.getAttribute('aria-labelledby').split(/\s+/).map(function (id) { return words(document.getElementById(id)); }).join(' ').trim();
    }
    if (!text) text = field.getAttribute('aria-label') || '';
    if (!text && field.closest) text = words(field.closest('label'));
    if (!text && field.closest && field.closest('fieldset')) text = words(field.closest('fieldset').querySelector('legend'));
    return text || field.getAttribute('placeholder') || humanise(field.name || field.id);
  }

  function groupLabel(field, labels) {
    var text = given(labels, [field.name]);
    if (text) return text;
    var set = field.closest ? field.closest('fieldset, [role="radiogroup"]') : null;
    if (set) text = words(set.querySelector('legend')) || set.getAttribute('aria-label') || '';
    return text || humanise(field.name);
  }

  function choiceLabel(field) {
    var own = field.getAttribute('data-preview-label');
    if (own) return own;
    var text = field.id ? words(document.querySelector('label[for="' + escapeId(field.id) + '"]')) : '';
    if (!text && field.closest) text = words(field.closest('label'));
    return text || String(field.value || '');
  }

  /* What the form holds, as the person filled it in. Files are left to the
     page, which knows what became of them (shrunk, uploaded, counted). */
  function rowsOf(form, options) {
    var opts = options || {};
    var rows = [];
    var seen = {};
    [].forEach.call((form && form.elements) || [], function (field) {
      var tag = String(field.tagName || '').toLowerCase();
      var type = String(field.type || '').toLowerCase();
      if (!/^(input|select|textarea)$/.test(tag)) return;
      if (/^(hidden|submit|button|reset|image|password|file)$/.test(type)) return;
      /* Switched off is switched off, by the field or by its section: a
         field inside a disabled fieldset reports disabled === false, yet the
         browser will not send it, so it must not be shown as if it would.
         donate.html's gift section listed "The occasion" on a plain donation
         this way (owner, 21 Oct 2026). */
      if (field.disabled || (field.matches && field.matches(':disabled')) || (field.closest && field.closest('[data-preview="skip"]'))) return;
      if (type === 'radio') {
        if (!field.name || seen[field.name]) return;
        seen[field.name] = true;
        var chosen = [].filter.call(form.elements, function (el) { return el.type === 'radio' && el.name === field.name && el.checked; })[0];
        if (chosen) rows.push({ label: groupLabel(field, opts.labels), value: choiceLabel(chosen) });
        return;
      }
      if (type === 'checkbox') {
        if (field.checked) rows.push({ label: given(opts.labels, [field.id, field.name]) || 'Agreed', value: choiceLabel(field) || 'Yes' });
        return;
      }
      var value = tag === 'select'
        ? (field.value && field.options[field.selectedIndex] ? field.options[field.selectedIndex].textContent : '')
        : field.value;
      value = String(value == null ? '' : value).trim();
      if (!value) return;
      if (tag !== 'textarea') value = value.replace(/\s+/g, ' ');
      rows.push({ label: labelFor(field, opts.labels), value: value, long: tag === 'textarea' });
    });
    (opts.extra || []).forEach(function (row) {
      if (row && row[1] != null && String(row[1]).trim()) rows.push({ label: String(row[0]), value: String(row[1]).trim() });
    });
    return rows;
  }

  function contactOf(form, options) {
    var c = (options && options.contact) || {};
    return {
      email: c.email || form.querySelector('input[type="email"]') || form.querySelector('input[name="email"]'),
      mobile: c.mobile || form.querySelector('input[type="tel"]') || form.querySelector('input[name="mobile"]')
    };
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'className') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  var CSS_TEXT = [
    '.pfa-pv{padding:0;border:0;margin:auto;width:calc(100% - 32px);max-width:680px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));background:transparent;color:var(--ink,#111);overflow:visible}',
    '.pfa-pv::backdrop{background:rgba(10,10,10,.64)}',
    '.pfa-pv--overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;width:auto;max-width:none;max-height:none;background:rgba(10,10,10,.64)}',
    '.pfa-pv--overlay .pfa-pv__panel{width:calc(100% - 32px);max-width:680px}',
    '.pfa-pv__panel{position:relative;display:flex;flex-direction:column;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));background:var(--paper,#fff);border:1px solid var(--ink,#111);font-family:var(--body,"Helvetica Neue",Helvetica,Arial,sans-serif);text-align:left}',
    '.pfa-pv__head{padding:56px 32px 18px 32px}',
    '.pfa-pv__step{margin:0 0 8px;font-size:13px;color:#595959}',
    '.pfa-pv__title{margin:0;font-family:var(--display,Marcellus,"Marcellus Fallback","Marcellus Fallback Times",Georgia,serif);font-weight:400;font-size:clamp(24px,3vw,32px);line-height:1.15;text-transform:uppercase;letter-spacing:.01em;color:var(--ink,#111)}',
    '.pfa-pv__title:focus{outline:none}',
    '.pfa-pv__lead{margin:10px 0 0;font-size:15px;line-height:1.55;color:#333;max-width:56ch}',
    '.pfa-pv__body{overflow:auto;padding:6px 32px 22px;border-top:1px solid #e3e3e3;overscroll-behavior:contain}',
    '.pfa-pv__rows{margin:0}',
    '.pfa-pv__row{display:grid;grid-template-columns:minmax(120px,34%) 1fr;gap:4px 20px;padding:12px 0;border-bottom:1px solid #eee}',
    '.pfa-pv__row dt{font-size:13px;line-height:1.45;color:#595959}',
    '.pfa-pv__row dd{margin:0;font-size:15px;line-height:1.5;color:var(--ink,#111);white-space:pre-wrap;overflow-wrap:anywhere}',
    '.pfa-pv__acts{display:flex;flex-wrap:wrap;gap:12px;justify-content:flex-end;padding:16px 32px 24px;border-top:1px solid #e3e3e3;background:var(--paper,#fff)}',
    '.pfa-pv button{font:inherit;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;line-height:1.2;min-height:50px;padding:12px 26px;border:1px solid var(--ink,#111);border-radius:0;background:#fff;color:var(--ink,#111);cursor:pointer}',
    '.pfa-pv button.pfa-pv__go{background:var(--ink,#111);color:#fff}',
    '.pfa-pv button:focus-visible,.pfa-pv input:focus-visible{outline:3px solid #2634f5;outline-offset:2px}',
    '.pfa-pv button.pfa-pv__x{position:absolute;top:12px;right:16px}',
    '.pfa-pv__contact{display:grid;gap:14px;margin:18px 0 20px}',
    '.pfa-pv__c{padding:16px 18px;border:2px solid var(--ink,#111)}',
    '.pfa-pv__k{display:block;font-size:13px;color:#595959}',
    '.pfa-pv__v{display:block;margin-top:6px;font-size:clamp(20px,2.6vw,26px);font-weight:700;line-height:1.25;overflow-wrap:anywhere}',
    '.pfa-pv__v.is-missing{color:#a3261e;font-weight:400;font-size:17px}',
    '.pfa-pv__v.is-none{color:#595959;font-weight:400;font-size:17px}',
    '.pfa-pv__note{margin:8px 0 0;font-size:14px;line-height:1.45;color:#595959}',
    '.pfa-pv__fix{margin:12px 0 0;padding:10px 12px;background:#fff5d1;border-left:4px solid #9a6b00;font-size:15px;line-height:1.5}',
    '.pfa-pv button.pfa-pv__use{min-height:40px;margin-left:6px;padding:8px 14px;font-size:14px}',
    '.pfa-pv__check{display:flex;gap:12px;align-items:flex-start;font-size:16px;font-weight:700;line-height:1.4;cursor:pointer}',
    '.pfa-pv__check input{width:22px;height:22px;margin:1px 0 0;flex:none;accent-color:var(--ink,#111)}',
    '.pfa-pv__need{margin:10px 0 0;color:#a3261e;font-size:15px}',
    '.pfa-pv__live{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:640px){.pfa-pv{width:100%;max-width:100%;height:100%;max-height:100%;margin:0}.pfa-pv__panel{height:100%;max-height:100%;border:0}.pfa-pv__head{padding:calc(56px + env(safe-area-inset-top,0px)) 20px 14px 20px}.pfa-pv button.pfa-pv__x{top:calc(8px + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px))}.pfa-pv__body{padding:4px 20px 18px}.pfa-pv__acts{padding:14px 20px calc(20px + env(safe-area-inset-bottom,0px))}.pfa-pv__acts button{flex:1 1 100%}.pfa-pv__row{grid-template-columns:1fr}}',
    '@media (prefers-reduced-motion:no-preference){.pfa-pv__panel{animation:pfa-pv-in .16s ease-out}}',
    '@keyframes pfa-pv-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}'
  ].join('\n');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  function confirm(form, options) {
    if (!form || !document.body) return Promise.resolve(true);
    if (open) return Promise.resolve(false);
    open = true;
    var opts = options || {};
    ensureStyle();
    uid += 1;
    var ids = { title: 'pfaPvTitle' + uid, lead: 'pfaPvLead' + uid, check: 'pfaPvCheck' + uid };
    var rows = rowsOf(form, opts);
    var contact = contactOf(form, opts);
    var twoSteps = Boolean(contact.email || contact.mobile);
    var before = document.activeElement;
    var submitButton = form.querySelector('[type="submit"], button:not([type="button"])');
    var root = document.documentElement;
    var overflow = root.style.overflow;
    var native = typeof document.createElement('dialog').showModal === 'function';
    var shell = el(native ? 'dialog' : 'div', {
      className: 'pfa-pv' + (native ? '' : ' pfa-pv--overlay'),
      'aria-labelledby': ids.title, 'aria-describedby': ids.lead, 'data-pfa-preview': ''
    });
    if (!native) { shell.setAttribute('role', 'dialog'); shell.setAttribute('aria-modal', 'true'); }
    var panel = el('div', { className: 'pfa-pv__panel' });
    shell.appendChild(panel);

    return new Promise(function (resolve) {
      var done = false;

      function firstField() {
        return form.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      }
      function finish(result, focusTo) {
        if (done) return;
        done = true;
        document.removeEventListener('keydown', onKey, true);
        if (native && shell.open) { try { shell.close(); } catch (e) {} }
        if (shell.parentNode) shell.parentNode.removeChild(shell);
        root.style.overflow = overflow;
        open = false;
        var target = focusTo || (result ? null : (before && before !== document.body && before.focus ? before : submitButton));
        if (target && typeof target.focus === 'function') { try { target.focus(); } catch (e) {} }
        resolve(result);
      }
      function onKey(event) {
        if (event.key === 'Escape' || event.key === 'Esc') { event.preventDefault(); finish(false); return; }
        if (!native && event.key === 'Tab') {
          var items = [].filter.call(panel.querySelectorAll('button, input, [href], [tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled; });
          if (!items.length) return;
          var first = items[0];
          var last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        }
      }
      function frame(stepText, title, lead) {
        panel.textContent = '';
        panel.appendChild(el('div', { className: 'pfa-pv__head' }, [
          el('p', { className: 'pfa-pv__step', text: stepText }),
          el('h2', { className: 'pfa-pv__title', id: ids.title, tabindex: '-1', text: title }),
          el('p', { className: 'pfa-pv__lead', id: ids.lead, text: lead })
        ]));
        var close = el('button', { type: 'button', className: 'pfa-pv__x pfa-close', 'aria-label': 'Close and go back to the form', text: 'Close' });
        close.addEventListener('click', function () { finish(false); });
        panel.appendChild(close);
      }
      function actions(back, go) {
        panel.appendChild(el('div', { className: 'pfa-pv__acts' }, [back, go]));
        var title = panel.querySelector('.pfa-pv__title');
        if (title) title.focus();
      }

      function stepOne() {
        frame(twoSteps ? 'Step 1 of 2' : 'Before you send', opts.title || 'Check everything before it is sent',
          'This is what PFA will receive. If anything is not right, go back and change it.');
        var list = el('dl', { className: 'pfa-pv__rows' });
        rows.forEach(function (row) {
          list.appendChild(el('div', { className: 'pfa-pv__row' }, [el('dt', { text: row.label }), el('dd', { text: row.value })]));
        });
        panel.appendChild(el('div', { className: 'pfa-pv__body' }, [list]));
        var back = el('button', { type: 'button', className: 'pfa-pv__back', text: 'Change something' });
        var go = el('button', { type: 'button', className: 'pfa-pv__go', text: twoSteps ? 'Continue' : (opts.send || 'Send') });
        back.addEventListener('click', function () { finish(false, firstField()); });
        go.addEventListener('click', function () { if (twoSteps) stepTwo(); else finish(true); });
        actions(back, go);
      }

      function stepTwo() {
        /* An optional mobile left blank is not a mistake to flag: the person is
           asked about what they gave, and told that email is then the only way. */
        var mobileGiven = Boolean(contact.mobile && String(contact.mobile.value || '').trim());
        var both = Boolean(contact.email && mobileGiven);
        frame('Step 2 of 2', both ? 'Are your email and mobile number right?' : (contact.email ? 'Is your email address right?' : 'Is your mobile number right?'),
          both ? 'Your confirmation email goes to this address, and PFA uses these details to get back to you. If one is wrong, nothing reaches you.'
            : 'Your confirmation goes here, and PFA uses it to get back to you. If it is wrong, nothing reaches you.');
        var body = el('div', { className: 'pfa-pv__body' });
        var cards = el('div', { className: 'pfa-pv__contact' });
        var live = el('p', { className: 'pfa-pv__live', 'aria-live': 'polite' });
        var check = el('input', { type: 'checkbox', id: ids.check });
        var need = el('p', { className: 'pfa-pv__need', role: 'alert' });
        need.hidden = true;

        function card(kind, field) {
          var value = String(field.value || '').trim();
          var email = kind === 'email';
          var shown = email ? value : formatMobile(value);
          var valueEl = el('span', { className: 'pfa-pv__v' + (value ? '' : (email ? ' is-missing' : ' is-none')), text: shown || (email ? 'No email given' : 'Not given') });
          var box = el('div', { className: 'pfa-pv__c', 'data-contact': kind }, [
            el('span', { className: 'pfa-pv__k', text: email ? 'Email, where your confirmation goes' : 'Mobile number' }),
            valueEl
          ]);
          if (!email && !value) box.appendChild(el('p', { className: 'pfa-pv__note', text: 'Without one, PFA can reach you only by email.' }));
          var better = email && value ? suggestEmail(value) : '';
          if (better) {
            var use = el('button', { type: 'button', className: 'pfa-pv__use', text: 'Use ' + better });
            var fix = el('p', { className: 'pfa-pv__fix' }, [document.createTextNode('Did you mean '), el('strong', { text: better }), document.createTextNode('?'), use]);
            use.addEventListener('click', function () {
              field.value = better;
              ['input', 'change'].forEach(function (type) { field.dispatchEvent(new Event(type, { bubbles: true })); });
              valueEl.textContent = better;
              if (fix.parentNode) fix.parentNode.removeChild(fix);
              check.checked = false;
              live.textContent = 'Email changed to ' + better + '.';
              check.focus();
            });
            box.appendChild(fix);
          }
          return box;
        }
        if (contact.email) cards.appendChild(card('email', contact.email));
        if (contact.mobile) cards.appendChild(card('mobile', contact.mobile));
        var mine = both ? 'My email and mobile number are correct' : (contact.email ? 'My email is correct' : 'My mobile number is correct');
        body.appendChild(cards);
        body.appendChild(el('label', { className: 'pfa-pv__check' }, [check, el('span', { text: mine })]));
        body.appendChild(need);
        body.appendChild(live);
        panel.appendChild(body);

        var change = el('button', { type: 'button', className: 'pfa-pv__back', text: both ? 'Change them' : 'Change it' });
        var send = el('button', { type: 'button', className: 'pfa-pv__go', text: opts.send || 'Confirm and send' });
        change.addEventListener('click', function () { finish(false, contact.email || contact.mobile); });
        check.addEventListener('change', function () { if (check.checked) need.hidden = true; });
        send.addEventListener('click', function () {
          if (!check.checked) {
            need.textContent = both ? 'Tick the box once you have checked both.' : 'Tick the box once you have checked it.';
            need.hidden = false;
            check.focus();
            return;
          }
          finish(true);
        });
        actions(change, send);
      }

      shell.addEventListener('cancel', function (event) { event.preventDefault(); finish(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(shell);
      root.style.overflow = 'hidden';
      if (native) { try { shell.showModal(); } catch (e) { shell.setAttribute('open', ''); } }
      stepOne();
    });
  }

  window.PFAPreview = { confirm: confirm, rowsOf: rowsOf, suggestEmail: suggestEmail, formatMobile: formatMobile };
})();
