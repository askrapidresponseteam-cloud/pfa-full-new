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
      "why": "Article 51A sits in Part IVA, the Fundamental Duties, added in 1976. Clause (g) asks every citizen to protect and improve the natural environment, including forests, lakes, rivers and wildlife, and to have compassion for living creatures.",
      "explain": [
        "Article 51A sits in Part IVA, the Fundamental Duties, added in 1976. Clause (g) asks every citizen to protect the environment and wildlife and to have compassion for living creatures.",
        "Article 51A(g) is in the part on duties, not the part on fundamental rights. Courts use it to read animal welfare laws, but it gives animals no right to sue under it.",
        "The duty falls on every citizen, not on the police alone. Police duties come from the BNSS and the laws they enforce.",
        "It is part of the Constitution, not a rule of the Animal Welfare Board. The Board advises governments and cannot make constitutional provisions.",
        "The PCA Act is a separate law passed by Parliament in 1960. Article 51A(g) is in the Constitution and was added in 1976."
      ],
      "risk": "Citing Article 51A(g) as if it were an enforceable right or a penal section can make a complaint look poorly founded. It works best alongside the PCA Act and the BNS, not in place of them."
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
      "why": "Rule 11(9). Taking a mother away from very young puppies would leave them to die.",
      "explain": [
        "Rule 11(9) bars catching puppies under six months and mothers with puppies under two months. Taking a mother from very young puppies would leave them to die.",
        "The Rules require both male and female dogs to be sterilised. Neutering males also reduces fighting and mating stress, and the ABC programme covers both sexes.",
        "The Rules set no upper age limit. Older dogs can still breed, and the vet decides whether each dog is fit for surgery.",
        "The Rules do not need feeders' written consent before a dog is caught. Feeders are encouraged to help, but they hold no veto.",
        "The Rules contain no seasonal ban on catching females. Proper surgery and post-operative care, not the calendar, govern healing."
      ],
      "risk": "Catching a nursing mother can kill her whole litter and is a breach of the Rules that can be reported against the ABC centre. Wrongly leaving out males or older dogs slows the programme."
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
      "why": "Cool first, transport second: water cooler than the dog, with moving air, brings the temperature down fastest. A wet blanket left on traps heat. Heatstroke can damage organs even after the dog seems better, so it still needs a vet.",
      "explain": [
        "Cool first, transport second. Water cooler than the dog, with moving air, brings the temperature down fastest, and a vet is still needed because heatstroke can damage organs after the dog seems better.",
        "Heatstroke gets worse by the minute, and waiting in the shade alone does not cool a collapsed dog fast enough. An hour can mean organ failure or death.",
        "Forcing large amounts of water can make the dog vomit or inhale water into its lungs. Small sips are safe; cooling the body from the outside is what works.",
        "A wet blanket left on traps heat against the body and stops evaporation. Cooling needs water poured over and air moving across the dog.",
        "Paracetamol can damage a dog's liver and blood, and fever medicine does not lower heatstroke temperature, which is not a fever. Never give human medicines without a vet."
      ],
      "risk": "Delay or the wrong first aid can cause brain damage, organ failure or death within hours. Giving human medicines can poison the dog on top of the heatstroke."
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
      "why": "A third factor, the number of dogs, can drive both. A link between two things in the same places is not proof that one causes the other.",
      "explain": [
        "A third factor, the number of dogs, can drive both feeders and bites. Two things rising together in the same places does not prove that one causes the other.",
        "Whether every feeder is registered does not touch the causal leap. Even a perfect count of feeders would not show that feeding causes bites.",
        "The source of bite reports is a data quibble. Hospital records would still show only a link, not that feeders cause bites.",
        "Missing details about the cities weaken the evidence a little, but the main flaw is treating a link as cause, even with full details.",
        "How serious each bite was is beside the point. The argument fails because it ignores a common cause, not because of bite severity."
      ],
      "risk": "Blaming feeders leads to feeding bans and harassment of feeders. Hungry, displaced dogs then roam and bite more, and the ABC Rules, 2023 provide for feeding spots rather than bans."
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
      "fixed": true,
      "explain": [
        "Statement (1) gives only the share, 40 percent sterilised. Without the total number of dogs, the number unsterilised cannot be found.",
        "Statement (2) gives 150 sterilised dogs but not the total or the share, so the number unsterilised cannot be found.",
        "Neither alone gives the total. Together, 150 is 40 percent of 375, so 375 minus 150 leaves 225 unsterilised.",
        "Neither statement works alone: one has only a percentage and the other only a count. Each alone leaves the total unknown.",
        "Together they fix the total at 375 and the unsterilised count at 225, so they are sufficient."
      ],
      "risk": "Planning an ABC drive on a guess rather than a fixed count can leave the team short of surgery slots, vaccines and kennels. Unsterilised dogs keep breeding and the drive fails to stabilise the ward."
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
      "why": "Each kennel turns over 30 / 5 = 6 times a month. 40 kennels times 6 is 240.",
      "explain": [
        "Each kennel holds a dog for 5 days, so it turns over 30 divided by 5, which is 6 times a month. 40 kennels times 6 gives 240 dogs.",
        "160 is 40 kennels times 4 post-surgery days. That multiplies kennels by days instead of dividing the month by each dog's stay.",
        "200 comes from dividing 1,200 kennel-days by 6, adding an extra day to each stay. Each dog uses 5 days, not 6.",
        "300 comes from dividing 1,200 kennel-days by 4, which leaves out the day before surgery. Each dog uses 5 days.",
        "1,200 is the total kennel-days, 40 times 30. It treats each kennel-day as a separate dog, ignoring that each dog stays 5 days."
      ],
      "risk": "Overestimating capacity crowds the kennels, so dogs are released before they recover and wounds can open or get infected. The ABC Rules, 2023 require proper post-operative care before release."
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
      "why": "Sterilised, vaccinated dogs that hold their ground keep others out; open food waste keeps pulling new dogs in and undoes the work. The panchayat’s past work in another village is weaker: it says nothing about this market.",
      "explain": [
        "Sterilised, vaccinated dogs that hold their ground keep others out. Clearing the meat waste removes the food that pulls new, unsterilised dogs in and undoes the work.",
        "When the market is busiest says nothing about whether the plan will cut bites. It is background, not support.",
        "Past work in another village two years ago says nothing about this market or whether new dogs will keep arriving here.",
        "Daily scraps keep a food source open that can draw new dogs, and pet dogs at home are outside the plan. It does not clearly help.",
        "Fewer visitors during the surgery months does not show bites will fall once the season ends. The result depends on keeping new dogs out."
      ],
      "risk": "If food waste keeps drawing new dogs, bites continue and the panchayat may push to remove the sterilised dogs. The ABC Rules, 2023 require dogs to be returned where they were caught, so relocation is unlawful."
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
    + '.lqs__opts button b{flex:0 0 auto;width:24px;height:24px;display:grid;place-items:center;border:1px solid #111;font-size:11px;line-height:1}'
    + '.lqs__opts button:hover:not([disabled]){border-color:#111}.lqs__opts button[aria-checked="true"]{border-color:#111;background:#f5f4f1}'
    + '.lqs__opts button[data-r="right"]{border-color:#1f6b3a;background:#eef6f0}.lqs__opts button[data-r="wrong"]{border-color:#a3251f;background:#fbefee}'
    + '.lqs__opts button[disabled]{cursor:default}.lqs__why{margin:14px 0 0;padding:12px 14px;background:#f5f4f1;font-size:14px;line-height:1.6}'
    + '.lqs__why b{display:block;margin:0 0 4px}.lqs__acts{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0 0}'
    + '.lqs .lqs__btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:48px;margin:0;padding:0 26px;border:1px solid #111!important;background:#111!important;color:#fff!important;font:700 12px/1.3 var(--body,"Helvetica Neue",Helvetica,Arial,sans-serif)!important;letter-spacing:.12em;text-transform:uppercase;text-align:center!important;cursor:pointer;opacity:1!important;transition:background .2s,color .2s}'
    + '.lqs .lqs__btn:hover:not([disabled]){background:#fff!important;color:#111!important}'
    + '.lqs .lqs__btn--light{background:#fff!important;color:#111!important}.lqs .lqs__btn--light:hover{background:#111!important;color:#fff!important}'
    + '.lqs .lqs__btn[disabled]{background:#fff!important;color:#6a6a6a!important;border-color:#cfccc6!important;cursor:not-allowed}'
    + '.lqs .lqs__link{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:700;color:#111;text-decoration:none;border-bottom:1px solid currentColor}'
    + '.lqs .lqs__opts button{justify-content:flex-start!important;text-align:left!important;align-items:flex-start!important;color:#111!important;background:#fff!important;min-height:0!important;line-height:1.5!important;white-space:normal}'
    + '.lqs .lqs__opts button[aria-checked="true"]{background:#f5f4f1!important}.lqs .lqs__opts button[data-r="right"]{background:#eef6f0!important}.lqs .lqs__opts button[data-r="wrong"]{background:#fbefee!important}'
    + '.lqs .lqs__opts button span{flex:1 1 auto;min-width:0;padding-top:1px}'
    + '.lqs__acts .btn{margin:0}.lqs__score{font-family:var(--display,Marcellus,Georgia,serif);font-size:44px;line-height:1;margin:6px 0 10px}'
    + '.lqs__list{margin:0 0 12px;padding:0 0 0 18px;font-size:14px;line-height:1.7;color:#444}'
    + '.lqs__sub{margin:22px 0 8px;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6a6a6a}'
    + '.lqs__rev{border-top:1px solid #e4e2df}.lqs__rev details{border-bottom:1px solid #e4e2df}'
    + '.lqs__rev summary{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;padding:14px 0;cursor:pointer;list-style:none;font-size:14px;font-weight:700;line-height:1.45}.lqs__rev summary::-webkit-details-marker{display:none}'
    + '.lqs__rq{flex:1 1 auto;min-width:0}.lqs__tag{flex:none;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border:1px solid currentColor}.lqs__tag[data-r="right"]{color:#1f6b3a}.lqs__tag[data-r="wrong"]{color:#a3251f}'
    + '.lqs__pre{white-space:pre-line}.lqs__ex{display:grid;gap:8px;margin:0 0 12px;padding:0;list-style:none}'
    + '.lqs__ex li{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid #e4e2df;text-align:left}.lqs__ex li[data-r="right"]{border-color:#1f6b3a;background:#eef6f0}.lqs__ex li[data-r="wrong"]{border-color:#a3251f;background:#fbefee}'
    + '.lqs__ex b{flex:0 0 auto;width:24px;height:24px;display:grid;place-items:center;border:1px solid #111;font-size:11px;line-height:1}.lqs__ex div{flex:1 1 auto;min-width:0}'
    + '.lqs__c{margin:0;font-size:14px;line-height:1.5}.lqs__c em{display:block;margin-top:4px;font-style:normal;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}'
    + '.lqs__e{margin:6px 0 0;font-size:13px;line-height:1.55;color:#444}.lqs__e i{font-style:normal;font-weight:700;color:#111}'
    + '.lqs__rev summary::after{content:"+";flex:none;font-weight:400;font-size:20px;line-height:1;transition:transform .2s}.lqs__rev details[open]>summary::after{transform:rotate(45deg)}'
    + '.lqs__rev .lqs__why{margin:0 0 16px}'
    /* the host page's own type (the internship reader sets 11px on every button) must not reach in */
    + '.lqs{font-size:14px;line-height:1.5}.lqs .lqs__opts button{font-size:14px!important;font-weight:400!important;letter-spacing:0!important;text-transform:none!important}.lqs .lqs__opts button b{font-weight:700}'
    + '.lqs .lqs__rev summary{font-size:14px}.lqs .lqs__tag{font-size:11px}'
    + '@media (max-width:600px){.lqs{padding:16px}.lqs__ex li{padding:10px}.lqs__ex{gap:6px}}';
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
    this.at = 0; this.got = []; this.picks = []; this.picked = -1; this.checked = false;
    this.intro();
  };
  Practice.prototype.intro = function () {
    this.box.innerHTML = '<div class="lqs__top"><span>Practice</span><span>Not counted</span></div><div class="lqs__bar"><i style="width:0"></i></div>'
      + '<h3 class="lqs__h">Seven questions, as the quiz asks them</h3>'
      + '<p class="lqs__p">One question at a time, five choices, one best answer: easy, medium and hard, mixed, as in the real quiz. Here you see the answer after each one, and at the end why every choice is right or wrong. None of these seven is in the real quiz.</p>'
      + '<p class="lqs__p">The real quiz: 25 questions on ten common incidents, from a dog bite to the police refusing a complaint; 50 minutes, two a question; pass with 60 percent; three attempts.</p>'
      + '<div class="lqs__acts"><button class="lqs__btn" type="button" data-lqs="go">Start the practice</button></div>';
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
      + '<div class="lqs__acts"><button class="lqs__btn" type="button" data-lqs="check" disabled>Check my answer</button></div>';
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
    this.picks.push(perm[this.picked]);
    var self = this;
    Array.prototype.forEach.call(this.box.querySelectorAll('[data-lqs="pick"]'), function (b) {
      var k = Number(b.getAttribute('data-k'));
      b.disabled = true;
      if (perm[k] === q.answer) b.setAttribute('data-r', 'right');
      else if (k === self.picked) b.setAttribute('data-r', 'wrong');
    });
    this.box.querySelector('[data-lqs-why]').innerHTML = '<p class="lqs__why" role="status"><b>' + (right ? 'Right.' : 'Not quite: the answer is ' + LETTERS[perm.indexOf(q.answer)] + '.') + '</b>' + esc(q.why) + '</p>';
    var last = this.at === QUESTIONS.length - 1;
    this.box.querySelector('.lqs__acts').innerHTML = '<button class="lqs__btn" type="button" data-lqs="next">' + (last ? 'See how you did' : 'Next question') + '</button>';
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
      + '<ul class="lqs__list"><li>The real quiz has 25 questions: two or three on each of ten incidents, easy, medium and hard, all mixed.</li><li>50 minutes from the moment you start, even if you close the page.</li><li>A confirmed answer is final, and the answers open only once you pass or have used your three attempts.</li></ul>'
      + '<p class="lqs__sub">Every question, and why each choice is right or wrong</p>'
      + '<div class="lqs__rev">' + this.order.map(function (qi, i) {
        var q = QUESTIONS[qi]; var perm = self.perm[i]; var mine = self.picks[i];
        return '<details><summary><span class="lqs__rq">' + (i + 1) + '. ' + esc(q.q.split('\n')[0]) + '</span><span class="lqs__tag" data-r="' + (self.got[i] ? 'right' : 'wrong') + '">' + (self.got[i] ? 'Right' : 'Not quite') + '</span></summary>'
          + (q.q.indexOf('\n') !== -1 ? '<p class="lqs__p lqs__pre">' + esc(q.q) + '</p>' : '')
          + '<ul class="lqs__ex">' + perm.map(function (orig, k) {
            var tag = orig === q.answer ? (orig === mine ? 'The answer, and yours' : 'The answer') : orig === mine ? 'Your answer' : '';
            return '<li data-r="' + (orig === q.answer ? 'right' : orig === mine ? 'wrong' : '') + '"><b>' + LETTERS[k] + '</b><div><p class="lqs__c">' + esc(q.choices[orig]) + (tag ? ' <em>' + tag + '</em>' : '') + '</p>'
              + (q.explain ? '<p class="lqs__e"><i>' + (orig === q.answer ? 'Why it is right:' : 'Why it is wrong:') + '</i> ' + esc(q.explain[orig]) + '</p>' : '') + '</div></li>';
          }).join('') + '</ul>'
          + (q.risk ? '<p class="lqs__why"><b>What can go wrong</b>' + esc(q.risk) + '</p>' : '') + '</details>';
      }).join('') + '</div>'
      + '<div class="lqs__acts"><button class="lqs__btn lqs__btn--light" type="button" data-lqs="again">Try the seven again</button><a class="lqs__link" href="intern.html">The real quiz is in your intern portal</a></div>';
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
