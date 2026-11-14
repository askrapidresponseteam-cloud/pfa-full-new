/* People for Animals - from one case to the next, in the panel.
   ------------------------------------------------------------------------
   Owner, 14 Nov 2026: "this kinda thing on the right is not easy to
   navigate. can you make it full screen and easy to nav from 1 ticket to
   another".

   A case opened from a list (Submissions, Members, Caregivers, Internship
   and the rest) remembers that list as it is on screen, with its search and
   filters, in its order. Previous and Next beside Close, and the left and
   right arrow keys (never while typing), open the one before or after it
   without closing, with where you are ("9 of 138"). A case opened another
   way (a link to admin.html#case=REF) has no list, so no Previous or Next.

   What was typed in the reply box and not sent is kept when moving to
   another case, and is there again on coming back; once sent it is gone.
   Each case opens at its top.

   admin.html draws the case (showCase, drawCase) as before; this file only
   watches which case is drawn and asks for another through
   PFAAdmin.showCase. Kept out of admin.html so that page stays under its
   ceiling. The look is assets/admin-case-nav.css.
   ------------------------------------------------------------------------ */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  var drawer = document.getElementById('caseDrawer');
  if (!A || !drawer || window.PFACaseNav) return;
  var $ = function (id) { return document.getElementById(id); };
  var nav = { list: [], at: -1 };
  var drafts = {};
  var asked = '';   // the case this file, or a list click, asked for
  var shown = '';   // the case drawn now

  function visible(el) { return el.getClientRects().length > 0; }

  /* the list a row belongs to, as it is on screen, each case once */
  function listOf(opener, reference) {
    var box = opener.closest('table, .sheet, ul, ol, section, main') || document;
    var seen = {};
    var list = Array.prototype.slice.call(box.querySelectorAll('[data-open-case]')).filter(visible)
      .map(function (b) { return b.getAttribute('data-open-case'); })
      .filter(function (r) { if (seen[r]) return false; seen[r] = 1; return true; });
    var at = list.indexOf(reference);
    return at < 0 ? { list: [], at: -1 } : { list: list, at: at };
  }

  function paint() {
    var n = nav.list.length;
    $('caseNav').hidden = n < 2;
    if (n < 2) return;
    $('caseAt').textContent = (nav.at + 1) + ' of ' + n;
    $('casePrev').disabled = nav.at <= 0;
    $('caseNext').disabled = nav.at >= n - 1;
  }

  function keep() {
    if (!shown) return;
    var t = $('caseText') ? $('caseText').value : '';
    if (t.trim()) drafts[shown] = t; else delete drafts[shown];
  }

  function step(by) {
    var to = nav.at + by;
    if (to < 0 || to >= nav.list.length) return;
    keep();
    nav.at = to;
    asked = nav.list[to];
    paint();
    A.showCase(asked);
  }

  /* a row clicked: before admin.html opens it, note the list it is in */
  document.addEventListener('click', function (e) {
    var opener = e.target.closest && e.target.closest('[data-open-case]');
    if (!opener) return;
    var ref = opener.getAttribute('data-open-case');
    keep();
    if (!drawer.contains(opener)) nav = listOf(opener, ref);
    else if (nav.list.indexOf(ref) > -1) nav.at = nav.list.indexOf(ref);
    else nav = { list: [], at: -1 };
    asked = ref;
    paint();
  }, true);

  /* the drawer opened or closed by anything else: no list to walk */
  new MutationObserver(function () {
    if (!drawer.hasAttribute('data-open')) {
      keep();
      nav = { list: [], at: -1 }; asked = ''; shown = '';
      paint();
    }
  }).observe(drawer, { attributes: true, attributeFilter: ['data-open'] });

  /* a case drawn: which one, its own draft back, from its top */
  new MutationObserver(function () {
    var ref = ($('caseTitle').textContent || '').trim();
    if (!/^PFA-/.test(ref) || ref === shown) return;
    shown = ref;
    /* where it sits in the list is the case actually drawn, even if two
       presses came back out of order */
    if (nav.list.indexOf(ref) > -1) nav.at = nav.list.indexOf(ref);
    else if (asked !== ref) nav = { list: [], at: -1 };
    paint();
    var box = $('caseText');
    if (box && !box.value && drafts[ref]) box.value = drafts[ref];
    if ($('caseBody')) $('caseBody').scrollTop = 0;
  }).observe($('caseTitle'), { childList: true, characterData: true, subtree: true });

  /* sent: the draft goes with it (if it fails, the box keeps the text) */
  var send = $('caseSend');
  if (send) send.addEventListener('click', function () { delete drafts[shown]; });

  $('casePrev').addEventListener('click', function () { step(-1); });
  $('caseNext').addEventListener('click', function () { step(1); });

  /* the arrow keys, while a case is open and nothing is being typed */
  document.addEventListener('keydown', function (e) {
    if (!drawer.hasAttribute('data-open') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var card = $('cardView');
    if (card && !card.hidden) return;
    e.preventDefault();
    step(e.key === 'ArrowLeft' ? -1 : 1);
  });

  window.PFACaseNav = { state: function () { return { list: nav.list.slice(), at: nav.at, shown: shown }; } };
})();
