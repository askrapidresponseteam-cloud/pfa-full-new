/* Ready replies, everywhere a reply is written (owner, 5 Nov 2026: "option
   to ask standard reply also should be there? everywhere.").

   One list, kept here: the replies for the kind of record that is open
   (a caregiver card, a membership, a shop order, a film...) first, then the
   few that fit anything. They appear as "Start from a ready reply" above
   the reply box of every record the panel opens (Submissions, Members,
   Caregivers, Volunteers, Internship, Job applicants, Payments, Shop orders
   and Overview all open the same record), on each card of The Wall, and a
   Reply button on each line of the two registers opens that record ready to
   write. A ready reply is only a start: it fills the box, to be edited
   before it goes. It carries no greeting or sign-off, because the email
   adds both. A part in square brackets is for the sender to fill in: it is
   picked out so typing replaces it, and a reply still holding one is not
   sent. Nothing here sends anything; Send reply does that, as before. */
(function () {
  'use strict';
  var A = window.PFAAdmin;
  if (!A) return;
  var $ = A.$;
  var esc = A.esc;

  var GENERIC = [
    ['got', 'We have it, we will come back', 'Thank you for writing to People for Animals. We have your message, and someone from the team will come back to you within two working days.'],
    ['more', 'Ask for more detail', 'Thank you for writing to People for Animals. To take this further we need a little more from you: [what is needed]. Reply to this email with it.'],
    ['call', 'Ask for a good time to call', 'Thank you for writing to People for Animals. It would be easier to talk this through. Reply with a number and two or three times over the next few days that suit you, and we will call.'],
    ['done', 'Done, closing it', 'Thank you for your patience. This is now done, so we are closing it. If anything else comes up, reply to this email and it reaches us again.']
  ];
  var INTERN = [
    ['ishort', 'Shortlisted, set up a talk', 'Thank you for applying for the PFA remote internship. We would like to talk to you. Reply with two or three times over the next week that suit you for a short call.'],
    ['ino', 'Not this time', 'Thank you for applying for the PFA remote internship. We will not be taking your application further this time, but please apply again when the next batch opens.']
  ];
  var BY_KIND = {
    'PFA-CG': [
      ['cgprint', 'Card approved, being printed', 'Your Colony Caregiver Card is approved and is being printed. It will be posted to the address on your application, and we will email you the tracking number when it goes.'],
      ['cgaddr', 'Confirm the postal address', 'Before we post your Colony Caregiver Card, please reply with your full postal address, including the 6-digit PIN code, so it reaches you.'],
      ['cgwait', 'Still being checked', 'Thank you for applying for a Colony Caregiver Card. Your application is still being checked, and we will write to you as soon as it is decided.']
    ],
    'PFA-MEM': [
      ['memwel', 'Welcome, card on its way', 'Thank you for becoming a member of People for Animals. Your membership card is being printed and will be posted to the address you gave. We will email you the tracking number when it goes.'],
      ['memaddr', 'Confirm the postal address', 'Before we post your membership card, please reply with your full postal address, including the 6-digit PIN code, so it reaches you.']
    ],
    'PFA-SHP': [
      ['shpack', 'Order being packed', 'Thank you for your order. It is being packed, and we will email you the tracking number once it is posted.'],
      ['shlate', 'Order delayed', 'Thank you for your order. It is taking a little longer than usual to send, and we expect it to go within [number] days. We are sorry for the wait.'],
      ['shaddr', 'Confirm the delivery address', 'Thank you for your order. Before we send it, please reply with your full delivery address, including the 6-digit PIN code.']
    ],
    'PFA-DON': [
      ['donty', 'Thank you for the donation', 'Thank you for your donation to People for Animals. It goes to the care of animals. If you need your receipt again, reply to this email and we will send it.']
    ],
    'PFA-S': [
      ['on', 'It is on the wall', 'Thank you for your film. It is now on PFA’s wall, for everyone to see: https://peopleforanimalsindia.org/wall'],
      ['link', 'Ask for a YouTube or Vimeo link', 'Thank you for your film. The wall can only play YouTube or Vimeo links. Could you put it on YouTube or Vimeo and reply with the link? We would like to put it up.'],
      ['about', 'Ask about the film', 'Thank you for your film. Before it goes on the wall, could you tell us where it was shot and who is in it?'],
      ['no', 'Not this time', 'Thank you for sending your film to PFA. We will not be putting this one on the wall, but please do send us your next one.']
    ],
    'PFA-V': [
      ['vnext', 'Welcome, we will call', 'Thank you for offering to volunteer with People for Animals. Someone from the team near you will call you on the number you gave to talk about where you can help.'],
      ['vnone', 'No opening near you yet', 'Thank you for offering to volunteer with People for Animals. There is no opening near you just now, but we have kept your details and will contact you when one comes up.']
    ],
    'PFA-J': [
      ['jshort', 'Shortlisted, set up a talk', 'Thank you for applying to People for Animals. We would like to talk to you. Reply with two or three times over the next week that suit you for a call.'],
      ['jno', 'Not this time', 'Thank you for applying to People for Animals. We will not be taking your application further this time, but we will keep your details for future openings.']
    ],
    'PFA-VI': INTERN,
    'PFA-VP': [
      ['vpok', 'Proof received', 'Thank you for sending your proof. We have it, and it will be checked within a few days.']
    ].concat(INTERN),
    'PFA-CR': [
      ['crpass', 'Passed to the team near you', 'Thank you for reporting this. We have passed it to our team nearest the place, and they will follow it up.'],
      ['crmore', 'Ask for photos and the place', 'Thank you for reporting this. To act on it we need photographs or a video, the exact location with a landmark, and when it happened. Reply to this email with whatever you have.']
    ],
    'PFA-A': [
      ['anext', 'We will call about the adoption', 'Thank you for wanting to adopt. Someone from the team will call you to talk about the animal and your home before anything is arranged.'],
      ['agone', 'Already adopted', 'Thank you for wanting to adopt. The animal you asked about has already found a home, but others are waiting. Reply and we will tell you about them.']
    ],
    'PFA-EV': [
      ['evask', 'Ask for the event details', 'Thank you for inviting People for Animals. Could you tell us the date, the time, the venue and how many people you expect? We will then confirm who can come.']
    ],
    'PFA-CSR': [
      ['csrcall', 'Set up a call', 'Thank you for your interest in partnering with People for Animals. We would like to set up a call. Reply with two or three times over the next week that suit you, and who should join.']
    ],
    'PFA-U': [
      ['ucall', 'We will call about the unit', 'Thank you for applying to start a People for Animals unit. Someone from the team will call you to talk through what running a unit involves.']
    ],
    'PFA-PRV': [
      ['prvok', 'Request received', 'We have your privacy request and are working on it. We will write to you again when it is done.']
    ]
  };
  var BLANKS = /\[(what is needed|number)\]/;

  function kindOf(reference) {
    var m = /^(PFA-[A-Z]+)-/.exec(String(reference || ''));
    return m ? m[1] : '';
  }
  function list(reference) { return (BY_KIND[kindOf(reference)] || []).concat(GENERIC); }
  function pick(reference, key) { return list(reference).filter(function (x) { return x[0] === key; })[0] || null; }
  function options(reference) {
    return '<option value="">Start from a ready reply…</option>'
      + list(reference).map(function (x) { return '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>'; }).join('');
  }
  /* the first blank picked out, so typing replaces it */
  function toBlank(box) {
    var m = BLANKS.exec(box.value);
    if (m) box.setSelectionRange(m.index, m.index + m[0].length);
  }
  /* used by The Wall's cards (assets/admin-wall.js) */
  window.PFAReplies = { list: list, pick: pick, options: options, toBlank: toBlank, blanks: BLANKS };

  var css = document.createElement('style');
  css.textContent = '#caseStart{display:block;width:100%;max-width:100%;margin:0 0 10px;padding:9px 11px;border:1px solid var(--line);background-color:var(--paper);font:inherit;font-size:13px;color:var(--ink)}#caseStart[hidden]{display:none}'
    + '.rg td.rg-nw .rg-row[data-reply-case]{display:block;margin:8px 0 0 2px}';
  document.head.appendChild(css);

  /* ---- the record drawer ---- */
  var text = $('#caseText');
  var title = $('#caseTitle');
  if (!text || !title) return;
  var start = document.createElement('select');
  start.id = 'caseStart';
  start.setAttribute('aria-label', 'Start from a ready reply');
  text.parentNode.insertBefore(start, text);
  var shownFor = '';
  var placed = '';
  var wantReply = '';

  function replyMode() {
    var b = document.querySelector('#caseAct .tabs button[data-mode="reply"]');
    return !b || b.getAttribute('aria-pressed') === 'true';
  }
  function refresh() {
    var ref = String(title.textContent || '').trim();
    if (ref !== shownFor) {
      shownFor = ref;
      placed = '';
      start.innerHTML = options(ref);
    }
    start.hidden = !replyMode();
    /* opened from a register's Reply: the reply box, ready to write */
    if (wantReply && wantReply === ref) {
      wantReply = '';
      var b = document.querySelector('#caseAct .tabs button[data-mode="reply"]');
      if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
      start.hidden = false;
      setTimeout(function () { if (!$('#caseAct').hidden) start.focus(); }, 0);
    }
  }
  new MutationObserver(refresh).observe(title, { childList: true, characterData: true, subtree: true });
  refresh();

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#caseAct .tabs button, [data-reply-case]');
    if (!t) return;
    if (t.hasAttribute('data-reply-case')) { wantReply = t.getAttribute('data-open-case') || ''; return; }
    start.hidden = t.getAttribute('data-mode') !== 'reply';
  });

  start.addEventListener('change', function () {
    var x = pick(shownFor, start.value);
    if (!x) return;
    var now = text.value.trim();
    if (now && now !== placed.trim() && !window.confirm('Replace what is written with this ready reply?')) { start.value = ''; return; }
    text.value = x[2];
    placed = x[2];
    start.value = '';
    text.focus();
    toBlank(text);
  });

  /* a reply still holding a blank does not go: held before Send reaches the
     panel's own handler */
  document.addEventListener('click', function (e) {
    var send = e.target.closest && e.target.closest('#caseSend');
    if (!send || !replyMode() || !BLANKS.test(text.value)) return;
    e.preventDefault();
    e.stopPropagation();
    A.say($('#caseSay'), 'Fill in the part in square brackets first.', 'bad');
    text.focus();
    toBlank(text);
  }, true);
})();
