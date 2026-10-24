/* PFA microsites: the behaviour the microsite pages share (assets/micro.css
   holds their look). Pages: campus, sgacc, csr, legacy, campaign, privacy,
   careers.

   PFAMicro.steps(form, opts)   a form in screens: tabs, a progress rule,
                                Back / Continue / Send, Enter moves on, each
                                screen checked before the next
   PFAMicro.send(opts)          the last look (assets/form-preview.js), then
                                pfa-forms.js submits and the page shows the
                                reference the server issued, never before
   PFAMicro.filter(chips, items) chips that show one kind of card
   PFAMicro.gallery(list, dialog) photographs that open larger, with
                                Previous / Next and the shared Close
   PFAMicro.picked(form, name)  the chosen value(s) of a radio or checkbox set

   Nothing here claims success on its own: send() resolves the page only when
   pfa-forms.js returns a reference (test/forms-wired.test.js). */
(function (root) {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var MOBILE = /^[6-9]\d{9}$/;
  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function digits(v) { return String(v || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''); }

  /* A checkbox set answers with a list (empty when nothing is ticked), a
     radio set with one value or ''. */
  function picked(form, name) {
    var all = $$('input[name="' + name + '"]', form);
    var on = all.filter(function (i) { return i.checked; });
    if (all.length && all[0].type === 'checkbox') return on.map(function (i) { return i.value; });
    return on[0] ? on[0].value : '';
  }

  function flag(el, message) {
    var box = el && el.closest('.field');
    var err = box && box.querySelector('.err');
    if (box) box.classList.toggle('is-bad', !!message);
    if (err) { err.textContent = message || ''; err.hidden = !message; }
  }
  function say(el, message) {
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  /* One screen's own checks: required fields, emails, mobiles, minimum
     lengths, radio and checkbox sets marked data-need. Returns the first
     control that needs attention, or null. */
  function checkStep(step) {
    var first = null;
    $$('input, textarea, select', step).forEach(function (el) {
      if (el.type === 'radio' || el.type === 'checkbox' || el.type === 'range' || el.type === 'hidden') return;
      if (el.closest('[hidden]')) return;
      if (el.closest('[data-address]')) return;   /* the block checks its own, below */
      var v = String(el.value || '').trim();
      var m = '';
      if (el.required && !v) m = el.getAttribute('data-say') || 'This is needed.';
      else if (v && el.type === 'email' && !EMAIL.test(v)) m = 'That does not look like an email address.';
      else if (v && el.getAttribute('data-mobile') !== null && !MOBILE.test(digits(v))) m = 'An Indian mobile number is 10 digits, starting 6, 7, 8 or 9.';
      else if (v && el.getAttribute('data-min') && v.length < Number(el.getAttribute('data-min'))) m = el.getAttribute('data-min-say') || 'A little more, please.';
      else if (v && el.type === 'url' && !/^https?:\/\/\S+\.\S+/.test(v)) m = 'A link starts with https://';
      flag(el, m);
      if (m && !first) first = el;
    });
    $$('[data-need]', step).forEach(function (set) {
      if (set.closest('[hidden]')) return;
      var name = set.getAttribute('data-need');
      var chosen = $$('input[name="' + name + '"]', set).filter(function (i) { return i.checked; }).length;
      var min = Number(set.getAttribute('data-need-min') || 1);
      var err = set.parentNode.querySelector('[data-err-for="' + name + '"]');
      var bad = chosen < min;
      say(err, bad ? (set.getAttribute('data-say') || 'Choose one.') : '');
      if (bad && !first) first = $('input[name="' + name + '"]', set);
    });
    /* the address block (assets/address.js), with its own messages */
    $$('[data-address]', step).forEach(function (block) {
      if (block.closest('[hidden]')) return;
      var bad = root.PFAAddress ? root.PFAAddress.check(block) : block.querySelector('input, select');
      if (bad && !first) first = bad;
    });
    $$('input[type="checkbox"][data-confirm]', step).forEach(function (box) {
      var err = step.querySelector('[data-err-for="' + box.id + '"]');
      say(err, box.checked ? '' : (box.getAttribute('data-say') || 'Please confirm before sending.'));
      if (!box.checked && !first) first = box;
    });
    return first;
  }

  function steps(form, opts) {
    opts = opts || {};
    var list = $$('.m-step', form);
    var tabs = $$('.m-tabs li', form.parentNode);
    var bar = $('.m-bar span', form.parentNode);
    var back = $('[data-back]', form);
    var next = $('[data-next]', form);
    var send = $('[data-send]', form);
    var clock = $('[data-clock]', form);
    var at = 0;
    function paint(focus) {
      list.forEach(function (s, i) { s.classList.toggle('is-current', i === at); });
      tabs.forEach(function (t, i) { t.classList.toggle('is-current', i === at); t.classList.toggle('is-done', i < at); });
      if (bar) bar.style.width = Math.round(((at + 1) / list.length) * 100) + '%';
      if (back) back.hidden = at === 0;
      var last = at === list.length - 1;
      if (next) next.hidden = last;
      if (send) send.hidden = !last;
      if (clock) clock.textContent = 'Step ' + (at + 1) + ' of ' + list.length;
      if (opts.onStep) opts.onStep(at, list[at]);
      if (focus) {
        var top = form.getBoundingClientRect().top;
        if (top < 90) form.scrollIntoView({ block: 'start', behavior: 'smooth' });
        var f = $('input:not([type="radio"]):not([type="checkbox"]):not([type="range"]), textarea, select', list[at]);
        if (f) f.focus({ preventScroll: true });
      }
    }
    function ok() {
      var bad = checkStep(list[at]);
      if (!bad && opts.check) bad = opts.check(at, list[at]) || null;
      if (bad && bad.focus) bad.focus();
      return !bad;
    }
    if (next) next.addEventListener('click', function () { if (ok()) { at++; paint(true); } });
    if (back) back.addEventListener('click', function () { if (at > 0) { at--; paint(true); } });
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      if (at < list.length - 1) { e.preventDefault(); if (next) next.click(); }
    });
    form.addEventListener('input', function (e) { if (e.target.closest('.field')) flag(e.target, ''); });
    form.addEventListener('change', function (e) {
      var name = e.target.getAttribute('name');
      if (name) say(form.querySelector('[data-err-for="' + name + '"]'), '');
      if (e.target.id) say(form.querySelector('[data-err-for="' + e.target.id + '"]'), '');
    });
    paint(false);
    return {
      ok: function () { return ok(); },
      allOk: function () {
        for (var i = 0; i < list.length; i++) {
          var bad = checkStep(list[i]) || (opts.check && opts.check(i, list[i]));
          if (bad) { at = i; paint(false); if (bad.focus) bad.focus(); return false; }
        }
        return true;
      },
      go: function (i) { at = Math.max(0, Math.min(list.length - 1, i)); paint(true); },
      at: function () { return at; }
    };
  }

  /* The last look, then the server's reference, then the page's own done
     panel. opts: form, kind, page, data() -> object, preview {title, send,
     labels, extra}, button, status, done, doneRef, track (a link to fill). */
  function send(opts) {
    var form = opts.form;
    var status = opts.status;
    var button = opts.button;
    var busy = false;
    var label = button ? button.textContent : '';
    function fail(message) {
      if (!status) return;
      status.textContent = message;
      status.setAttribute('data-state', 'bad');
      status.hidden = false;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      if (opts.ready && !opts.ready()) return;
      if (!root.PFAForms) { fail('The page did not finish loading. Reload and try again.'); return; }
      busy = true;
      if (status) status.hidden = true;
      var look = root.PFAForms.preview ? root.PFAForms.preview(form, opts.preview || {}) : null;
      if (look) look.then(go); else go(true);
      function go(confirmed) {
        if (!confirmed) { busy = false; return; }
        var data = opts.data();
        if (button) { button.disabled = true; button.textContent = 'Sending…'; }
        root.PFAForms.submit(opts.kind, data, { page: opts.page })
          .then(function (reference) {
            form.hidden = true;
            if (opts.hideOnDone) opts.hideOnDone.forEach(function (el) { if (el) el.hidden = true; });
            opts.doneRef.textContent = reference;
            opts.done.hidden = false;
            var mailNote = root.PFAForms.emailNote && root.PFAForms.emailNote(reference);
            var acts = $('.acts', opts.done);
            if (mailNote) opts.done.insertBefore(mailNote, acts);
            var copy = $('[data-copy]', opts.done);
            if (copy) copy.onclick = function () { try { navigator.clipboard.writeText(reference); copy.textContent = 'Copied'; } catch (_) {} };
            var track = $('[data-track]', opts.done);
            if (track) track.setAttribute('href', 'track.html#ref=' + encodeURIComponent(reference));
            if (opts.after) opts.after(reference, data);
            opts.done.scrollIntoView({ block: 'start', behavior: 'smooth' });
          })
          .catch(function (error) { fail(error.message); })
          .then(function () { busy = false; if (button) { button.disabled = false; button.textContent = label; } });
      }
    });
  }

  /* Chips that show one kind of card. data-filter="" is everything. */
  function filter(chips, items, attr) {
    var buttons = $$('[data-filter]', chips);
    var cards = $$(items);
    var key = attr || 'data-kind';
    var count = $('[data-count]', chips.parentNode);
    function show(value) {
      var shown = 0;
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === value)); });
      cards.forEach(function (c) {
        var kinds = (c.getAttribute(key) || '').split(/\s+/);
        var on = !value || kinds.indexOf(value) > -1;
        if (on) { c.removeAttribute('data-filtered'); shown++; } else c.setAttribute('data-filtered', 'out');
      });
      if (count) count.textContent = shown + (shown === 1 ? ' shown' : ' shown');
    }
    buttons.forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-filter')); }); });
    show('');
    return show;
  }

  /* Photographs that open larger. A photograph that failed to load is not
     offered: its tile is already gone (onerror in the markup). */
  function gallery(list, dialog) {
    if (!list || !dialog) return;
    var img = $('img', dialog);
    var cap = $('[data-lb-cap]', dialog);
    var items = function () { return $$('li:not(.is-gone) button[data-full]', list); };
    var at = 0;
    function open(i) {
      var all = items();
      if (!all.length) return;
      at = (i + all.length) % all.length;
      var b = all[at];
      img.src = b.getAttribute('data-full');
      img.alt = b.getAttribute('data-alt') || '';
      var capLine = [(at + 1) + ' of ' + all.length, b.getAttribute('data-alt') || ''];
      if (cap) { if (root.PFADots) root.PFADots(cap, capLine); else cap.textContent = capLine.filter(Boolean).join(' \u00b7 '); }
      if (!dialog.open) {
        if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
      }
    }
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-full]');
      if (!b) return;
      open(items().indexOf(b));
    });
    $$('[data-lb-prev]', dialog).forEach(function (b) { b.addEventListener('click', function () { open(at - 1); }); });
    $$('[data-lb-next]', dialog).forEach(function (b) { b.addEventListener('click', function () { open(at + 1); }); });
    $$('[data-lb-close]', dialog).forEach(function (b) {
      b.addEventListener('click', function () { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); });
    });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') open(at - 1);
      if (e.key === 'ArrowRight') open(at + 1);
    });
    dialog.addEventListener('click', function (e) { if (e.target === dialog && typeof dialog.close === 'function') dialog.close(); });
  }

  /* A hero picture is never cut by more than a quarter (10 Oct 2026, the PFA
     Campus poster read clipped): past that, its frame takes the picture's own
     shape and shows it whole. Measured once the picture has its size. */
  function keepWhole(fig) {
    var img = fig.querySelector('img');
    if (!img) return;
    function check() {
      if (!img.naturalWidth || !img.naturalHeight) return;
      var r = fig.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var rn = img.naturalWidth / img.naturalHeight, rb = r.width / r.height;
      if (Math.min(rn / rb, rb / rn) < 0.75) fig.classList.add('m-ph--whole');
    }
    if (img.complete) check(); else img.addEventListener('load', check, { once: true });
  }
  $$('.m-hero__media .m-ph:not(.m-ph--whole)').forEach(keepWhole);

  root.PFAMicro = { steps: steps, send: send, filter: filter, gallery: gallery, picked: picked, digits: digits, flag: flag, say: say, checkStep: checkStep };
}(this));
