/* The rules in assets/field-rules.js, applied in the browser.

   ---- what was wrong -------------------------------------------------------

   field-rules.js was written to be the one definition of a valid entry, used
   by the page and by the API so the two could never disagree. The API used
   it. No page ever loaded it: nothing in the tree carried a
   <script src="assets/field-rules.js">, so `window.PFA_RULES` did not exist in
   any browser that has ever visited this site.

   assets/site.js holds a full validation layer written against that global,
   and every one of its functions begins `var R = window.PFA_RULES; if (!R)
   return;`. It is also loaded by no page - it is an older site's script, and
   loading it now would inject a Back button, reveal animations and a search
   index full of pages that no longer exist. So that layer could not simply be
   switched on.

   What the pages had instead was a copy of the rules per page, written by
   hand: report.html tests a mobile with one regex, events.html with another,
   ask.html accepts an email that the API then refuses.

   ---- what this does -------------------------------------------------------

   The same rules, and nothing else. No cart, no chrome, no navigation.

     - what may be typed at all: a digit never lands in a name box, a letter
       never lands in a mobile or a PIN, and the caret stays where it was
     - the stored form, on leaving the box: "+91 98765 43210" becomes ten
       digits, "rAJESH kumAR" becomes Rajesh Kumar, before the page reads it
     - the length the record can hold, written to maxlength, and the keyboard
       a phone should offer
     - a field-specific message when what is in the box is malformed, in
       whichever error element the page already uses

   ---- how it shares a page with the page's own validation -----------------

   It does not replace it. Each page still decides what is required and still
   runs its own checks on submit; this adds the format checks the pages do not
   have, and speaks through the markup they already carry:

     <p class="err" hidden>      report, ask, careers    shown by clearing hidden
     <span class="error">        donate, get-involved,   shown by .is-bad on .field
                                 events, wall

   The original wording of an error element is kept and put back when the
   field is fixed, so the page's own message is never lost.

   Requires assets/field-rules.js before it. Does nothing without it. */

(function (window, document) {
  'use strict';

  var R = window.PFA_RULES;
  if (!R || !document.addEventListener) return;

  /* Types this must not touch. A password is not text to be tidied, a search
     box is not a record, and a file input has no value to filter. */
  var SKIP = {
    hidden: 1, submit: 1, button: 1, file: 1, checkbox: 1, radio: 1,
    search: 1, password: 1, range: 1, color: 1, image: 1, reset: 1
  };

  /* Rules that rewrite what was typed into the form it is stored in. An
     amount, a free-text note and a choice are left exactly as typed. */
  var TIDY = {
    personName: 1, place: 1, locality: 1, address: 1, email: 1, contact: 1,
    mobile: 1, pin: 1, reference: 1, cardId: 1, memberId: 1, handle: 1,
    orgName: 1, shortText: 1, shortValue: 1, pan: 1
  };

  /* The name a rule is looked up by. The pages are not consistent: some name
     their controls (name="mobile"), some only give them an id (id="evMobile"),
     and caregiver-card.html has name="id" with id="cId". Try the name, then
     the id, and use whichever the rule file actually knows. */
  function keyOf(field) {
    var type = field.type;
    var name = field.getAttribute ? field.getAttribute('name') : '';
    if (name && R.ruleName(name, type)) return name;
    if (field.id && R.ruleName(field.id, type)) return field.id;
    return '';
  }

  function isData(field) {
    if (!field || !field.tagName) return false;
    if (field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA') return false;
    if (SKIP[field.type]) return false;
    if (field.hasAttribute('data-no-filter')) return false;
    return Boolean(keyOf(field));
  }

  function closest(field, selector) {
    return field.closest ? field.closest(selector) : null;
  }

  function boxOf(field) {
    return closest(field, '.field') || closest(field, '.consent') || closest(field, '.gi__doc');
  }

  /* The element a page shows its message in, and how that page shows it. */
  function noticeOf(field) {
    var box = boxOf(field);
    if (!box || !box.querySelector) return null;
    var el = box.querySelector('.err');
    if (el) return { el: el, box: box, how: 'hidden' };
    el = box.querySelector('.error');
    if (el) return { el: el, box: box, how: 'class' };
    /* Some .field wrappers carry no message element at all - donate.html's
       village and PIN boxes among them - so a verdict was reached, aria-invalid
       was set, and the person was told nothing. One is made, in the class the
       sheet already styles (.field.is-bad .error { display: block }), so the
       message has somewhere to appear. Only inside a .field: anywhere else
       there is no rule to show it and the element would sit there invisible. */
    if (!box.classList || !box.classList.contains('field')) return null;
    el = document.createElement('span');
    el.className = 'error';
    box.appendChild(el);
    return { el: el, box: box, how: 'class' };
  }

  function say(field, message) {
    var notice = noticeOf(field);
    field.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (!notice) return;
    var el = notice.el;
    if (message) {
      if (el.dataset && el.dataset.pfaWording === undefined) el.dataset.pfaWording = el.textContent || '';
      el.textContent = message;
      if (!el.id) el.id = 'pfa-err-' + (field.id || field.name || 'field');
      field.setAttribute('aria-describedby', el.id);
      if (notice.how === 'hidden') el.hidden = false; else notice.box.classList.add('is-bad');
      return;
    }
    /* Fixed: put the page's own wording back and let the page decide again
       whether the field is bad. */
    if (el.dataset && el.dataset.pfaWording !== undefined) el.textContent = el.dataset.pfaWording;
    if (notice.how === 'hidden') el.hidden = true; else notice.box.classList.remove('is-bad');
  }

  /* ---- what may be typed -------------------------------------------------- */

  function filter(field) {
    if (!isData(field)) return;
    var key = keyOf(field);
    var before = field.value;
    var after = R.filterField(key, before, field.type);
    if (after === before) return;
    var at = field.selectionStart;
    field.value = after;
    /* The caret belongs where the person was typing: its new home is however
       much of the text before it survived the filter. */
    if (typeof at === 'number') {
      try {
        var kept = R.filterField(key, before.slice(0, at), field.type).length;
        field.setSelectionRange(Math.min(after.length, kept), Math.min(after.length, kept));
      } catch (ignored) { /* a type that has no selection: nothing to restore */ }
    }
  }

  /* ---- the stored form ---------------------------------------------------- */

  function tidy(field) {
    if (!isData(field)) return;
    var key = keyOf(field);
    var rule = R.ruleName(key, field.type);
    if (!rule || !TIDY[rule]) return;
    if (!String(field.value || '').trim()) return;
    var tidied = R.normaliseField(key, field.value, field.type);
    if (tidied === field.value) return;
    field.value = tidied;
    /* Tell the page, so a character counter or a live check sees the change. */
    if (typeof window.Event === 'function') {
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
  }

  /* ---- the verdict -------------------------------------------------------- */

  /* Leaving a box empty is not yet a mistake: the person may simply be moving
     on, and the page judges emptiness on submit. A box with something in it
     is judged the moment it is left. */
  function judge(field) {
    if (!isData(field)) return;
    var key = keyOf(field);
    if (!String(field.value || '').trim()) { say(field, ''); return; }
    var message = R.checkField(key, field.value, { required: false, type: field.type }) || '';
    /* A PIN of the right shape can still be in another state, or one India
       Post does not know (assets/address.js). Leaving the box used to judge
       its shape alone and wipe that message ("PIN code 700016 is in West
       Bengal, not Karnataka") the moment the person moved on, so the step
       then stopped with nothing said on the PIN. */
    if (!message && field.getAttribute('data-addr') === 'pincode' && window.PFAAddress && window.PFAAddress.pinProblem) {
      var scope = field.closest && field.closest('[data-address], [data-address-wired]');
      var state = scope && scope.querySelector('[data-addr="state"]');
      message = window.PFAAddress.pinProblem(field.value, state ? state.value : '') || '';
    }
    say(field, message);
  }

  /* ---- the length the record holds, and the keyboard to offer ------------- */

  function prime(field) {
    if (!isData(field)) return;
    var key = keyOf(field);
    var rule = R.ruleFor(key, field.type);
    if (!rule) return;
    if (rule.max) {
      /* A mobile box has to admit "+91 98765 43210" so the filter can take the
         prefix off; the filter keeps what stays behind to ten digits. */
      var cap = rule === R.rules.mobile ? 15 : rule.max;
      var current = Number(field.getAttribute('maxlength') || 0);
      /* Tighten anything too loose - and widen a mobile box, the one case
         where a page asking for less is wrong. donate.html's carry
         maxlength="10", so the browser cut a pasted "+91 98765 43210" down to
         "+91 98765 " before the filter ever saw it, and the number that
         survived was 9198765. */
      if (!current || current > cap || (rule === R.rules.mobile && current < cap)) {
        field.setAttribute('maxlength', String(cap));
      }
    }
    if (!field.getAttribute('inputmode')) {
      if (rule === R.rules.mobile || rule === R.rules.pin || rule === R.rules.otp
        || rule === R.rules.amount || rule === R.rules.count) field.setAttribute('inputmode', 'numeric');
      else if (rule === R.rules.email) field.setAttribute('inputmode', 'email');
    }
    if (rule === R.rules.personName || rule === R.rules.place) {
      field.setAttribute('autocapitalize', 'words');
      field.setAttribute('spellcheck', 'false');
    }
  }

  function primeAll(root) {
    var all = (root.querySelectorAll ? root.querySelectorAll('input,textarea') : []);
    for (var i = 0; i < all.length; i++) prime(all[i]);
    if (root.tagName === 'INPUT' || root.tagName === 'TEXTAREA') prime(root);
  }

  /* Capture, so the box is already filtered when the page's own listener
     reads it. */
  document.addEventListener('input', function (event) {
    filter(event.target);
    /* Once a field has been marked, re-judge as it is fixed, so the message
       clears the moment it stops being true rather than on the next submit. */
    var box = event.target && event.target.closest ? boxOf(event.target) : null;
    if (box && (box.classList.contains('is-bad') || box.querySelector('.err:not([hidden])'))) judge(event.target);
  }, true);

  document.addEventListener('blur', function (event) {
    tidy(event.target);
    judge(event.target);
  }, true);

  function start() {
    primeAll(document);
    if (typeof window.MutationObserver !== 'function') return;
    /* Controls a script renders later - a step that opens, a row that is
       added - are primed as they arrive. */
    new window.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) primeAll(added[j]);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* Named so a page can call the same check the API will apply. */
  window.PFAFieldValidate = { keyOf: keyOf, judge: judge, tidy: tidy, filter: filter, prime: prime, say: say };
}(window, document));
