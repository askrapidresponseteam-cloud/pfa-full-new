/* The objection letters for lab-animal-rules.html.

   Owner, 22 Oct 2026, with three drafts: "Randomly select one of the provided
   email drafts each time, with varied subject lines and natural wording so
   emails don't feel repetitive or template-based to the recipient. Preserve
   the core message and factual accuracy, avoid consecutive repeats".

   Three drafts, each making one argument against G.S.R. 864(E):
     oversight  Rule 11(3): mild and moderate experiments go to the
                institution's own ethics committee (IAEC), not the Committee
     sourcing   Rule 21(2): some animals may be bought from non-registered
                establishments or open markets when registered breeders or
                traders have none
     safeguards the Rules as a whole: less central scrutiny, alternatives,
                care after experiments
   Both rule numbers were read against the Gazette (the Hindi text, 22 Oct
   2026). Each paragraph keeps the owner's own words as its first wording and
   carries one or two others that say exactly the same thing: the same rule,
   the same Act, the same facts, the same demand. Nothing is added that the
   drafts did not say. Subjects, the opening, the greeting and the sign-off
   vary too, so that two letters arriving at CCSEA rarely read alike.

   plan() chooses, render() writes. A plan is a handful of numbers, so the
   page chooses once when it opens and re-renders the same letter as the
   visitor types their name and city. plan() never returns the draft the
   same visitor was given last time (the page keeps that in localStorage).

   Works in the browser (window.PFALabLetters) and in Node (require), so the
   choosing is tested where it runs. No long dashes anywhere in the letters:
   the owner's rule, and test/lab-letters.test.js holds it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFALabLetters = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ACT = 'Prevention of Cruelty to Animals Act, 1960';
  var RULES = 'Draft Animal Experimentation Rules, 2026';

  var TO = [
    'To,\nThe Member Secretary, CCSEA',
    'To,\nThe Member Secretary,\nCommittee for Control and Supervision of Experiments on Animals (CCSEA)',
    'To,\nThe Member Secretary, CCSEA\n\nDear Sir/Madam,',
    'To,\nThe Member Secretary, CCSEA\n\nRespected Sir/Madam,'
  ];
  var SIGN = ['Regards,', 'Yours sincerely,', 'Sincerely,', 'Yours faithfully,', 'With regards,'];

  var DRAFTS = [
    {
      id: 'oversight',
      subjects: [
        'Objection to the ' + RULES + ': Demand for Immediate Withdrawal',
        'I object to the ' + RULES + ' and ask for their withdrawal',
        RULES + ': objection to weaker oversight under Rule 11(3)',
        'Objection: the ' + RULES + ' weaken independent oversight',
        'Request to withdraw the ' + RULES + ' (G.S.R. 864(E))'
      ],
      paragraphs: [
        [
          'I strongly object to the proposed Prevention of Cruelty to Animals (Control and Supervision of Experiment, Breeding and Trading of Laboratory Animals) Rules, 2026 and demand their immediate withdrawal.',
          'I am writing to register my strong objection to the proposed Prevention of Cruelty to Animals (Control and Supervision of Experiment, Breeding and Trading of Laboratory Animals) Rules, 2026, and to demand that they be withdrawn immediately.',
          'I wish to place on record my strong objection to the proposed Prevention of Cruelty to Animals (Control and Supervision of Experiment, Breeding and Trading of Laboratory Animals) Rules, 2026. I demand their immediate withdrawal.'
        ],
        [
          'The ' + ACT + ', exists to prevent unnecessary pain and suffering to animals.',
          'The ' + ACT + ', was enacted to prevent the infliction of unnecessary pain or suffering on animals.',
          'The very purpose of the ' + ACT + ', is to prevent unnecessary pain and suffering to animals.'
        ],
        [
          'The Draft Rules risk undermining these safeguards by reducing the role of the central Committee in approving certain experiments and allowing Institutional Animal Ethics Committees (IAECs) to decide on them instead. These committees operate within the very establishments conducting the experiments. This raises a fundamental question: why should an institution be allowed to exercise reduced-independence oversight over experiments that it conducts itself?',
          'The Draft Rules risk undermining these safeguards. They reduce the central Committee’s role in approving certain experiments and let Institutional Animal Ethics Committees (IAECs) decide on them instead, though these committees sit within the very establishments that conduct the experiments. Why should an institution be allowed to oversee, with less independence, experiments it conducts itself?'
        ],
        [
          'Under Rule 11(3), experiments classified as mild or moderate would not be referred to the central Committee for approval. This is not merely an administrative change. Reduced independent scrutiny increases the risk of conflicts of interest, inadequate oversight and avoidable animal suffering. An experiment being classified as mild or moderate does not mean that the animal experiences no pain, distress or lasting harm.',
          'Under Rule 11(3), experiments classified as mild or moderate would no longer be referred to the central Committee for approval. This is more than an administrative change: less independent scrutiny means a greater risk of conflicts of interest, inadequate oversight and avoidable animal suffering. Calling an experiment mild or moderate does not mean the animal feels no pain, distress or lasting harm.'
        ],
        [
          'Rules framed under the PCA Act must uphold its purpose, not weaken the protections it seeks to establish. The proposed dilution of independent oversight is a serious step backwards for animal welfare and accountability.',
          'Rules made under the PCA Act must uphold its purpose, not weaken the protections it was written to give. Diluting independent oversight in this way would be a serious step backwards for animal welfare and for accountability.'
        ],
        [
          'I demand the immediate withdrawal of the ' + RULES + '. These Rules must not be allowed to weaken the protection of animals under the PCA Act, 1960.',
          'I therefore demand that the ' + RULES + ' be withdrawn immediately. They must not be allowed to weaken the protection animals have under the PCA Act, 1960.'
        ]
      ]
    },
    {
      id: 'sourcing',
      subjects: [
        RULES + ' Must Be Withdrawn',
        'Objection to Rule 21(2) of the ' + RULES,
        RULES + ': animals must not enter laboratories untraced',
        'Please withdraw the ' + RULES + ': sourcing of animals and public health',
        'Objection to the ' + RULES + ' on traceability and biosecurity'
      ],
      paragraphs: [
        [
          'I strongly oppose the ' + RULES + ' and demand their immediate withdrawal.',
          'I am writing to strongly oppose the ' + RULES + ' and to demand their immediate withdrawal.',
          'I am firmly opposed to the ' + RULES + ' and demand that they be withdrawn immediately.'
        ],
        [
          'Rule 21(2) raises serious concerns by permitting certain categories of animals to be procured from non-registered establishments or open markets under specified conditions when animals are unavailable from registered breeders or traders. This creates a troubling risk: animals may enter the laboratory system through supply chains with weaker traceability and oversight.',
          'Rule 21(2) is a serious concern. When animals are unavailable from registered breeders or traders, it would permit certain categories of animals to be procured from non-registered establishments or open markets, under specified conditions. That creates a troubling risk: animals may enter the laboratory system through supply chains with weaker traceability and oversight.'
        ],
        [
          'Where did these animals come from? Can their origins be verified? Have their health histories and movements been properly documented? Were they transported and handled humanely? These are essential questions, not minor administrative details. Without reliable traceability and effective enforcement, there is a greater risk of animals being sourced through poorly regulated channels, compromising disease surveillance and biosecurity.',
          'Where did these animals come from, and can that be verified? Have their health histories and movements been properly documented? Were they transported and handled humanely? These are essential questions, not minor administrative details. Without reliable traceability and effective enforcement, animals are more likely to be sourced through poorly regulated channels, and disease surveillance and biosecurity are compromised.'
        ],
        [
          'The consequences extend beyond animal suffering. Poorly controlled sourcing, transport and quarantine can increase the risk of zoonotic disease transmission. At a time when emerging infectious diseases pose serious global concerns, India should not weaken safeguards that protect both animal and human health.',
          'The harm does not stop at animal suffering. Poorly controlled sourcing, transport and quarantine can increase the risk of zoonotic disease transmission. With emerging infectious diseases a serious concern worldwide, India should not weaken the safeguards that protect animal and human health alike.'
        ],
        [
          'The PCA Act, 1960, is intended to prevent unnecessary pain and suffering. Permitting broader sourcing routes, even with stated conditions, raises serious concerns about whether animals can be adequately protected and their origins independently verified in practice.',
          'The PCA Act, 1960, is meant to prevent unnecessary pain and suffering. Opening broader sourcing routes, even with conditions attached, raises serious doubt about whether animals can be adequately protected, and their origins independently verified, in practice.'
        ],
        [
          'Animals must not become invisible and untraceable once they enter the laboratory supply chain. Nor should public health be exposed to avoidable risks because adequate safeguards are not maintained.',
          'Once an animal enters the laboratory supply chain, it must not become invisible and untraceable. Nor should public health be exposed to avoidable risk for want of adequate safeguards.'
        ],
        [
          'The ' + RULES + ' must be withdrawn immediately. Animal welfare and public health cannot be put at risk in this manner.',
          'I ask that the ' + RULES + ' be withdrawn immediately. Animal welfare and public health must not be put at risk in this way.'
        ]
      ]
    },
    {
      id: 'safeguards',
      subjects: [
        'Withdraw the ' + RULES,
        'Objection to the ' + RULES,
        'The ' + RULES + ' are a step backwards for animal welfare',
        'Objection to G.S.R. 864(E), the ' + RULES,
        'A citizen’s objection to the ' + RULES
      ],
      paragraphs: [
        [
          'The proposed ' + RULES + ' are deeply troubling, unjustifiable and a serious step backwards as a society. They must be withdrawn immediately.',
          'I find the proposed ' + RULES + ' deeply troubling and unjustifiable. They are a serious step backwards for us as a society, and they must be withdrawn immediately.'
        ],
        [
          'Animal experimentation can subject living beings to pain, fear, distress, invasive procedures and lasting harm. This is precisely why independent oversight and clear, enforceable safeguards are essential. The ' + ACT + ', addresses the need to ensure that animals are not subjected to unnecessary pain or suffering before, during or after experiments.',
          'Experiments can subject living beings to pain, fear, distress, invasive procedures and lasting harm. That is exactly why independent oversight and clear, enforceable safeguards are essential. The ' + ACT + ', addresses the need to ensure that animals are not subjected to unnecessary pain or suffering before, during or after experiments.'
        ],
        [
          'The Draft Rules risk weakening these protections by reducing central scrutiny of certain experiments and shifting more decisions to institutional committees. They also raise concerns about whether important safeguards against unnecessary experiments and avoidable suffering will remain sufficiently strong and enforceable.',
          'The Draft Rules risk weakening these protections by reducing central scrutiny of certain experiments and moving more decisions to institutional committees. They also leave real doubt about whether important safeguards against unnecessary experiments and avoidable suffering will stay strong and enforceable.'
        ],
        [
          'An experiment should never be approved merely because an institution considers it useful or convenient. The availability of alternatives, the necessity of using animals, the severity of the procedure and the suffering involved must be taken seriously. Where a suitable alternative exists, animals should not be made to suffer simply because an institution chooses to proceed with animal testing.',
          'No experiment should be approved merely because an institution finds it useful or convenient. Whether alternatives are available, whether animals are necessary at all, how severe the procedure is and how much suffering it involves must all be taken seriously. Where a suitable alternative exists, animals should not be made to suffer simply because an institution chooses to test on animals.'
        ],
        [
          'Animal welfare does not end when an experiment is completed. Animals may continue to experience pain, disability, distress or other lasting consequences. Their care and treatment after experimentation must be taken as seriously as the experiment itself.',
          'An animal’s welfare does not end when the experiment does. Pain, disability, distress or other lasting consequences may continue afterwards, and the animal’s care and treatment after experimentation must be taken as seriously as the experiment itself.'
        ],
        [
          'These are not technicalities. They concern whether the law will meaningfully protect animals or leave them more vulnerable to institutional decisions.',
          'None of this is a technicality. It decides whether the law will meaningfully protect animals, or leave them more vulnerable to institutional decisions.'
        ],
        [
          'The Draft Rules are unacceptable because they risk diluting safeguards intended to prevent unnecessary animal suffering.',
          'The Draft Rules are unacceptable because they risk diluting the safeguards meant to prevent unnecessary animal suffering.'
        ],
        [
          'I demand the immediate withdrawal of the ' + RULES + '.',
          'I therefore demand the immediate withdrawal of the ' + RULES + '.'
        ]
      ]
    }
  ];

  /* A whole number in [0, n), from rand() in [0, 1). A rand() that returns
     1 (or more) is held inside the range rather than trusted. */
  function below(n, rand) {
    var i = Math.floor(rand() * n);
    return i >= n ? n - 1 : (i < 0 ? 0 : i);
  }

  /* One of n, never `avoid` when there is anything else to choose. Uniform
     over the rest: draw from n - 1 and step over the one to avoid. */
  function pickIndex(n, rand, avoid) {
    if (n <= 1) return 0;
    var skip = typeof avoid === 'number' && avoid >= 0 && avoid < n;
    var i = below(skip ? n - 1 : n, rand);
    return skip && i >= avoid ? i + 1 : i;
  }

  function indexOf(id) {
    for (var i = 0; i < DRAFTS.length; i += 1) if (DRAFTS[i].id === id) return i;
    return -1;
  }

  /* The choices for one letter. lastId is the draft this visitor was given
     last; it is never chosen again straight away. */
  function plan(opts) {
    var o = opts || {};
    var rand = typeof o.rand === 'function' ? o.rand : Math.random;
    var d = pickIndex(DRAFTS.length, rand, indexOf(o.lastId));
    var draft = DRAFTS[d];
    return {
      draft: draft.id,
      subject: below(draft.subjects.length, rand),
      to: below(TO.length, rand),
      sign: below(SIGN.length, rand),
      parts: draft.paragraphs.map(function (alts) { return below(alts.length, rand); })
    };
  }

  /* The letter a plan describes, signed with the visitor's name and city. */
  function render(p, who) {
    var draft = DRAFTS[indexOf(p.draft)] || DRAFTS[0];
    var w = who || {};
    var name = String(w.name || '').trim() || '[Your full name]';
    var city = String(w.city || '').trim() || '[Your city]';
    var pick = function (list, i) { return list[Math.min(Math.max(i | 0, 0), list.length - 1)]; };
    var body = [pick(TO, p.to)]
      .concat(draft.paragraphs.map(function (alts, n) { return pick(alts, (p.parts || [])[n]); }))
      .concat([pick(SIGN, p.sign) + '\n' + name + '\n' + city])
      .join('\n\n');
    return { draft: draft.id, subject: pick(draft.subjects, p.subject), body: body };
  }

  return { DRAFTS: DRAFTS, TO: TO, SIGN: SIGN, plan: plan, render: render, pickIndex: pickIndex };
}));
