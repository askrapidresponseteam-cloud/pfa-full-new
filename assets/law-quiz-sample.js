/* The law quiz, practice (owner, 3 Nov 2026: "also have a sample quiz/train
   that doesnt need login. with set of 7 qs.. and these cannot be in actual
   quiz.. but these need to give end user a proper idea of how it will be").

   Seven questions, open to anyone, on the internship page and in the intern
   portal: one at a time, five choices, easy, medium and hard mixed, as the
   real quiz asks them; here the answer and why show after each, and the
   score at the end. They count for nothing and none of them is in the real
   quiz (lib/intern-quiz-bank.js SAMPLE, which test/intern-quiz.test.js
   holds this list to). A button with data-law-sample opens it in place. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFALawSample = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var QUESTIONS = [
    {
      "level": "easy",
      "q": "Article 51A(g) of the Constitution, which speaks of compassion for living creatures, is:",
      "choices": [
        "A fundamental duty of every citizen",
        "A fundamental right that animals can enforce in court",
        "An instruction to the police alone",
        "A rule made by the Animal Welfare Board of India",
        "A section of the Prevention of Cruelty to Animals Act"
      ],
      "answer": 0,
      "why": "Article 51A sits in Part IVA, the Fundamental Duties, added in 1976. Clause (g) asks every citizen to protect and improve the natural environment, including forests, lakes, rivers and wildlife, and to have compassion for living creatures."
    },
    {
      "level": "medium",
      "q": "Under the ABC Rules, 2023, which dogs must not be caught for sterilisation?",
      "choices": [
        "Puppies under six months, and mothers with puppies under two months",
        "All male dogs, since sterilising males does nothing to reduce the number of puppies born",
        "Dogs older than five years, since they are past breeding age and the surgery is too risky",
        "Dogs that residents feed regularly, unless every one of their feeders agrees in writing",
        "All female dogs during the rainy season, when wounds are slow to heal after surgery"
      ],
      "answer": 0,
      "why": "Rule 11(9). Taking a mother away from very young puppies would leave them to die."
    },
    {
      "level": "medium",
      "q": "On a hot afternoon a dog collapses, panting hard. What is the best first step?",
      "choices": [
        "Move it to shade, pour cool or cold water over it with a fan or breeze on it, offer small sips, and get it to a vet",
        "Wait in the shade for it to recover on its own, and take it to a vet only if it is still panting heavily after an hour",
        "Make it drink as much water as possible at once, so that it cools down from the inside quickly",
        "Wrap it tightly in a wet blanket and leave it to rest quietly in a dark room until it gets up",
        "Give it half a paracetamol tablet for the fever, then carry it to a vet once it is calmer"
      ],
      "answer": 0,
      "why": "Cool first, transport second: water cooler than the dog, with moving air, brings the temperature down fastest. A wet blanket left on traps heat. Heatstroke can damage organs even after the dog seems better, so it still needs a vet."
    },
    {
      "level": "hard",
      "q": "‘Cities with more registered feeders report more dog bites. So feeders cause bites.’ What is the main flaw?",
      "choices": [
        "It ignores that cities with more dogs are likely to have both more feeders and more bites",
        "It assumes that every feeder in those cities is registered with the municipality, which may not be true",
        "It relies on reports of bites made to the police rather than on hospital records of people treated",
        "It does not say which cities were compared, or how many of them were included in the study",
        "It assumes that every bite reported is serious enough to need treatment with the rabies vaccine"
      ],
      "answer": 0,
      "why": "A third factor, the number of dogs, can drive both. A link between two things in the same places is not proof that one causes the other."
    },
    {
      "level": "hard",
      "q": "How many dogs in Ward 9 are unsterilised?\n(1) 40 percent of the dogs in Ward 9 are sterilised.\n(2) Ward 9 has 150 sterilised dogs.",
      "choices": [
        "Statement (1) alone is sufficient, but statement (2) alone is not.",
        "Statement (2) alone is sufficient, but statement (1) alone is not.",
        "Both statements together are sufficient, but neither alone is.",
        "Each statement alone is sufficient.",
        "The statements together are not sufficient."
      ],
      "answer": 2,
      "why": "Neither alone gives the total. Together: 150 is 40 percent of 375, so 225 are unsterilised. This is a data sufficiency question: you judge whether the facts are enough, not the number itself.",
      "fixed": true
    },
    {
      "level": "hard",
      "q": "An ABC centre has 40 kennels. Each dog uses a kennel for 5 days: one before surgery and four after. Working 30 days a month with every kennel full, how many dogs can it sterilise in a month?",
      "choices": [
        "240",
        "160",
        "200",
        "300",
        "1,200"
      ],
      "answer": 0,
      "why": "Each kennel turns over 30 / 5 = 6 times a month. 40 kennels times 6 is 240."
    },
    {
      "level": "hard",
      "q": "A panchayat plans to cut bites around its weekly market by sterilising and vaccinating every dog there. Which of the following, if true, would most help the plan succeed?",
      "choices": [
        "Waste from the market’s meat stalls is cleared every night, so the food no longer draws new, unsterilised dogs",
        "The market is busiest on Sundays, when traders come from several nearby villages with their goods",
        "The panchayat has done similar work before, in another village of the district, two years ago",
        "Most of the stall-holders own a dog at home, and many of them also give the market’s dogs scraps at the end of each day",
        "The sterilisations will be done in the rainy season, when fewer people come to the market"
      ],
      "answer": 0,
      "why": "Sterilised, vaccinated dogs that hold their ground keep others out; open food waste keeps pulling new dogs in and undoes the work. The panchayat’s past work in another village is weaker: it says nothing about this market."
    }
  ];

  /* ---- in the browser ------------------------------------------------------ */
  if (typeof document === 'undefined') return { QUESTIONS: QUESTIONS };

  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var LEVEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  var POINTS = { easy: 1, medium: 2, hard: 3 };

  var css = document.createElement('style');
  css.textContent = '.lqs{margin:18px 0 0;padding:22px;border:1px solid #e4e2df;background:#fff;color:#111;font-family:var(--body,"Helvetica Neue",Helvetica,Arial,sans-serif);text-align:left}'
    + '.lqs *{box-sizing:border-box}.lqs__top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 14px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6a6a6a}'
    + '.lqs__bar{height:2px;background:#e4e2df;margin:12px 0 18px}.lqs__bar i{display:block;height:100%;background:#111;transition:width .3s}'
    + '.lqs__h{margin:0 0 10px;font-family:var(--display,Marcellus,Georgia,serif);font-weight:400;font-size:clamp(22px,2.6vw,30px);line-height:1.1;text-transform:uppercase;letter-spacing:.01em}'
    + '.lqs__p{margin:0 0 12px;font-size:14px;line-height:1.6;color:#444}.lqs__q{margin:0 0 16px;font-size:16px;line-height:1.6;white-space:pre-line}'
    + '.lqs__hint{margin:-6px 0 14px;font-size:12px;color:#6a6a6a}.lqs__opts{display:grid;gap:8px}'
    + '.lqs__opts button{display:flex;gap:12px;align-items:flex-start;width:100%;padding:12px 14px;border:1px solid #e4e2df;background:#fff;color:#111;font:inherit;font-size:14px;line-height:1.5;text-align:left;cursor:pointer;transition:border-color .2s,background .2s}'
    + '.lqs__opts button b{flex:0 0 auto;width:22px;height:22px;display:grid;place-items:center;border:1px solid #111;font-size:11px}'
    + '.lqs__opts button:hover:not([disabled]){border-color:#111}.lqs__opts button[aria-checked="true"]{border-color:#111;background:#f5f4f1}'
    + '.lqs__opts button[data-r="right"]{border-color:#1f6b3a;background:#eef6f0}.lqs__opts button[data-r="wrong"]{border-color:#a3251f;background:#fbefee}'
    + '.lqs__opts button[disabled]{cursor:default}.lqs__why{margin:14px 0 0;padding:12px 14px;border-left:2px solid #111;background:#f5f4f1;font-size:14px;line-height:1.6}'
    + '.lqs__why b{display:block;margin:0 0 4px}.lqs__acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0 0}'
    + '.lqs__acts .btn{margin:0}.lqs__score{font-family:var(--display,Marcellus,Georgia,serif);font-size:44px;line-height:1;margin:6px 0 10px}'
    + '.lqs__list{margin:0 0 12px;padding:0 0 0 18px;font-size:14px;line-height:1.7;color:#444}';
  document.head.appendChild(css);

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i -= 1) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function Practice(box) {
    this.box = box;
    this.start();
  }
  Practice.prototype.start = function () {
    this.order = shuffle(QUESTIONS.map(function (_, i) { return i; }));
    this.perm = this.order.map(function (qi) { var idx = [0, 1, 2, 3, 4]; return QUESTIONS[qi].fixed ? idx : shuffle(idx); });
    this.at = 0; this.got = []; this.picked = -1; this.checked = false;
    this.intro();
  };
  Practice.prototype.intro = function () {
    this.box.innerHTML = '<div class="lqs__top"><span>Practice</span><span>Not counted</span></div><div class="lqs__bar"><i style="width:0"></i></div>'
      + '<h3 class="lqs__h">Seven questions, as the quiz asks them</h3>'
      + '<p class="lqs__p">One question at a time, five choices, one best answer: easy, medium and hard, mixed, as in the real quiz. Here you see the answer and why after each one. None of these seven is in the real quiz.</p>'
      + '<p class="lqs__p">The real quiz: 30 questions on ten common incidents, from a dog bite to the police refusing a complaint; 60 minutes, two a question; pass with 60 percent; three attempts.</p>'
      + '<div class="lqs__acts"><button class="btn" type="button" data-lqs="go">Start the practice</button></div>';
  };
  Practice.prototype.show = function () {
    var q = QUESTIONS[this.order[this.at]];
    var perm = this.perm[this.at];
    this.picked = -1; this.checked = false;
    this.box.innerHTML = '<div class="lqs__top"><span>Practice · ' + LEVEL[q.level] + ' · ' + POINTS[q.level] + (POINTS[q.level] === 1 ? ' mark' : ' marks') + '</span><span>Question ' + (this.at + 1) + ' of ' + QUESTIONS.length + '</span></div>'
      + '<div class="lqs__bar"><i style="width:' + Math.round((this.at / QUESTIONS.length) * 100) + '%"></i></div>'
      + '<p class="lqs__q" id="lqsQ">' + esc(q.q) + '</p>'
      + (q.fixed ? '<p class="lqs__hint">Data sufficiency: decide whether the statements give enough to answer, not what the answer is.</p>' : '')
      + '<div class="lqs__opts" role="radiogroup" aria-labelledby="lqsQ">' + perm.map(function (orig, k) { return '<button type="button" role="radio" aria-checked="false" data-lqs="pick" data-k="' + k + '"><b>' + LETTERS[k] + '</b><span>' + esc(q.choices[orig]) + '</span></button>'; }).join('') + '</div>'
      + '<div data-lqs-why></div>'
      + '<div class="lqs__acts"><button class="btn" type="button" data-lqs="check" disabled>Check my answer</button></div>';
  };
  Practice.prototype.pick = function (k) {
    if (this.checked) return;
    this.picked = k;
    Array.prototype.forEach.call(this.box.querySelectorAll('[data-lqs="pick"]'), function (b) { b.setAttribute('aria-checked', String(Number(b.getAttribute('data-k')) === k)); });
    this.box.querySelector('[data-lqs="check"]').disabled = false;
  };
  Practice.prototype.check = function () {
    if (this.picked < 0 || this.checked) return;
    this.checked = true;
    var q = QUESTIONS[this.order[this.at]];
    var perm = this.perm[this.at];
    var right = perm[this.picked] === q.answer;
    this.got.push(right);
    var self = this;
    Array.prototype.forEach.call(this.box.querySelectorAll('[data-lqs="pick"]'), function (b) {
      var k = Number(b.getAttribute('data-k'));
      b.disabled = true;
      if (perm[k] === q.answer) b.setAttribute('data-r', 'right');
      else if (k === self.picked) b.setAttribute('data-r', 'wrong');
    });
    this.box.querySelector('[data-lqs-why]').innerHTML = '<p class="lqs__why" role="status"><b>' + (right ? 'Right.' : 'Not quite: the answer is ' + LETTERS[perm.indexOf(q.answer)] + '.') + '</b>' + esc(q.why) + '</p>';
    var last = this.at === QUESTIONS.length - 1;
    this.box.querySelector('.lqs__acts').innerHTML = '<button class="btn" type="button" data-lqs="next">' + (last ? 'See how you did' : 'Next question') + '</button>';
    this.box.querySelector('[data-lqs="next"]').focus();
  };
  Practice.prototype.next = function () {
    this.at += 1;
    if (this.at < QUESTIONS.length) return this.show();
    var self = this;
    var right = this.got.filter(Boolean).length;
    var marks = 0; var max = 0;
    this.order.forEach(function (qi, i) { var p = POINTS[QUESTIONS[qi].level]; max += p; if (self.got[i]) marks += p; });
    var pct = Math.round((marks / max) * 100);
    this.box.innerHTML = '<div class="lqs__top"><span>Practice, done</span><span>Not counted</span></div><div class="lqs__bar"><i style="width:100%"></i></div>'
      + '<p class="lqs__score">' + right + ' of ' + QUESTIONS.length + '</p>'
      + '<p class="lqs__p">' + marks + ' of ' + max + ' marks, ' + pct + ' percent. ' + (pct >= 60 ? 'That would pass: the real quiz asks for 60 percent.' : 'The real quiz asks for 60 percent: read the four laws once more before you start it.') + '</p>'
      + '<ul class="lqs__list"><li>The real quiz has 30 questions: three on each of ten incidents, one easy, one medium, one hard, all mixed.</li><li>60 minutes from the moment you start, even if you close the page.</li><li>A confirmed answer is final, and the answers open only once you pass or have used your three attempts.</li></ul>'
      + '<div class="lqs__acts"><button class="btn btn--light" type="button" data-lqs="again">Try the seven again</button><a class="linkish" href="intern.html">The real quiz is in your intern portal</a></div>';
  };

  var live = typeof WeakMap === 'function' ? new WeakMap() : null;
  function boxFor(button) {
    var host = button.closest('[data-law-sample-host]') || button.parentNode;
    var box = host.querySelector('.lqs');
    if (!box) { box = document.createElement('div'); box.className = 'lqs'; box.setAttribute('aria-live', 'polite'); host.appendChild(box); }
    return box;
  }
  document.addEventListener('click', function (e) {
    var open = e.target.closest && e.target.closest('[data-law-sample]');
    if (open) {
      var box = boxFor(open);
      if (!live || !live.get(box)) { var p = new Practice(box); if (live) live.set(box, p); }
      open.hidden = true;
      try { box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
      return;
    }
    var act = e.target.closest && e.target.closest('[data-lqs]');
    if (!act) return;
    var host = act.closest('.lqs');
    var pr = live && live.get(host);
    if (!pr) return;
    var what = act.getAttribute('data-lqs');
    if (what === 'go') pr.show();
    else if (what === 'pick') pr.pick(Number(act.getAttribute('data-k')));
    else if (what === 'check') pr.check();
    else if (what === 'next') pr.next();
    else if (what === 'again') pr.start();
  });

  return { QUESTIONS: QUESTIONS };
}));
