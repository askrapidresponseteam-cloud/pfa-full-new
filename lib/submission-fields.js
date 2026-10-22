/* What each public form is allowed to send, and what it must send.

   ---- why this file exists -------------------------------------------------

   /api/pfa-submissions checked every field it was given against the shared
   rules in assets/field-rules.js, which is the right check for a field it
   recognises. It did not check that the field was there at all. Nothing was
   ever required, so an empty POST

       { "kind": "PFA-CR", "data": {} }

   allocated a reference and filed a cruelty report with no account of what
   happened, nobody's name and no way to call anyone back. Nor was a choice
   ever judged against the list it was chosen from: "animal": "Dragon" was
   filed exactly as "Dog" was, because the browser's <select> is a courtesy
   and not a boundary.

   So the spec below is the other half of validation: the browser decides what
   is convenient to type, this decides what may be recorded.

   ---- the standard it is written to ---------------------------------------

   Rejecting a real report costs more than storing a junk one. Someone
   standing over an injured animal is not going to fill the form in twice.
   So this file is deliberately narrow:

     - `required` names only fields the page itself already marks required,
       with the page's own wording, so nobody can be refused here for
       something the form never asked them for.
     - `options` lists only choices whose values are fixed in the markup.
       careers.html's Zone list is built at runtime from PFA_ZONES, so zone is
       validated as text and not against a list that could drift out of date.
     - `requiredWhen` names a field needed only for some answers to another
       (the Zone, for the Zonal Head), with the message the page shows.
     - unknown extra keys are not rejected. They are capped and checked for
       length as before. A form that grows a field keeps working; the field
       simply gets no rule until someone adds one.

   test/submission-fields.test.js reads the pages and asserts every list here
   still matches the markup, so the two cannot drift apart silently. */

'use strict';

const RULES = require('../assets/field-rules.js');
/* The same table the two pages fill their dropdowns from, so a pair the
   browser offers can never be one this file refuses. */
const INDIA = require('../assets/india-districts.js');

/* Keyed by submission kind. `page` is where the form lives, and is what the
   test reads to check this file against the markup. */
const KINDS = {
  'PFA-CR': {
    page: 'report.html',
    required: {
      what: 'Say what is happening.',
      animal: 'Which animal?',
      urgency: 'Is it still going on?',
      location: 'Where is it?',
      name: 'Your name, so someone can call you back.',
      mobile: 'A mobile number to reach you on.',
      email: 'An email, so the acknowledgement and any follow-up reach you.'
    },
    options: {
      animal: ['Dog', 'Cat', 'Cow or buffalo', 'Horse or donkey', 'Bird', 'Monkey', 'Goat or sheep', 'Other'],
      urgency: ['Happening now', 'Ongoing', 'Past']
    }
  },

  'PFA-Q': {
    page: 'ask.html',
    required: {
      question: 'What would you like to ask?',
      topic: 'Pick the closest topic.',
      /* Where the asker is, because the answer is pointed at the unit nearest
         them. It was one optional free-text box, so a question could arrive
         from nowhere in particular, or from a city that is not in the state
         beside it, and neither can be routed. */
      state: 'Choose your state, so the answer comes from the right unit.',
      city: 'Choose your district or city.',
      name: 'Your name, so the answer is addressed to someone.',
      email: 'An email, so the answer and your confirmation reach you.'
    },
    /* Checked as a pair, not two fields that each look filled in. */
    pairs: [{ state: 'state', district: 'city',
      message: 'That district is not in the state given. Choose one from the list.' }],
    /* The page sends mobile and email; `contact` is the generic key other
       kinds use for the same thing, and is honoured so a caller that posts
       one is not told to supply a contact it already gave. */
    options: {
      topic: ['An animal I found or feed', 'Adoption', 'Animal law', 'A PFA unit or hospital',
        'Colony caregiver card', 'Volunteering', 'A donation or receipt', 'The shop or an order',
        'Working with PFA', 'Something else']
    }
  },

  'PFA-J': {
    page: 'careers.html',
    required: {
      name: 'Add your name.',
      city: 'Where are you based?',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add an email for the reply.',
      background: 'A line or two about your background.',
      pfaMember: 'Yes or not yet.'
    },
    /* Careers lists five openings since 9 Oct 2026 (owner: "properly update
       the existing Jobs section"). The Zone and the travel question belong
       to the Zonal Head alone; the level to the veterinary posts; the dates
       to the internship. An application with no roleId is the Zonal Head's,
       as every application was before the other openings came back, so a
       page still open from before the change is held to what it asked. */
    requiredWhen: [
      { field: 'zone', message: 'Choose the Zone you would work in.', when: { field: 'roleId', in: ['zonal-head'], orBlank: true } },
      { field: 'travel', message: 'Pick one.', when: { field: 'roleId', in: ['zonal-head'], orBlank: true } },
      { field: 'level', message: 'Choose the post you are applying for.', when: { field: 'roleId', in: ['veterinary-team'] } },
      { field: 'dates', message: 'Say when you can start and for how long.', when: { field: 'roleId', in: ['internship'] } }
    ],
    /* The two written answers travel under the question's own wording, which
       belongs to the role and can change with it. They are checked as text
       and not required here, so editing a question cannot start refusing
       applications. */
    options: {
      roleId: ['zonal-head', 'veterinary-team', 'cruelty-response-coordinator', 'social-media-fundraising', 'internship'],
      level: ['Senior veterinary doctor', 'Junior veterinary doctor', 'Para vet', 'Visiting vet or veterinary student'],
      pfaMember: ['Yes', 'No'],
      travel: ['Yes', 'No', 'With notice']
    }
  },

  'PFA-S': {
    page: 'wall.html',
    required: {
      url: 'Paste the full link to a public post.',
      wall: 'Choose a wall.',
      name: 'Add the name to credit.',
      email: 'Add a valid email, so an editor can reach you.'
    },
    options: {
      wall: ['Long form, over three minutes', 'Short form, under a minute']
    },
    /* What The Wall is: a public post on one of six platforms. The list lived
       only in wall.html, so a direct post could put any link at all on a page
       PFA republishes under a name the sender chose. */
    hosts: {
      url: ['instagram.com', 'facebook.com', 'fb.watch', 'youtube.com', 'youtu.be', 'vimeo.com']
    }
  },

  'PFA-V': {
    page: 'get-involved.html',
    required: {
      name: 'Add your name.',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add a valid email for the reply.',
      city: 'Tell us where you are.',
      title: 'Choose at least one area, so PFA knows what to consider you for.'
    }
  },

  /* PFA-W, the newsroom's field note, has no per-kind spec: the form left
     newsroom.html on 16 Sep 2026 when the page went back to its editorial
     cut. The kind and its label stay in lib/submissions.js so notes already
     filed keep their name in the panel, and /api/field-notes still serves
     what the desk published. If the form returns, restore the spec that
     stood here (required: type, title, story, city, name; one of mobile or
     email; type chosen from the page's own list) and its rows in
     test/forms-wired.test.js and test/every-form-reaches-admin.test.js. */

  'PFA-EV': {
    page: 'events.html',
    required: {
      title: 'Choose what you are asking for.',
      city: 'Tell us where.',
      name: 'Add your name.',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add a valid email, so PFA can confirm your request.'
    },
    options: {
      title: ['An adoption drive', 'A sterilisation or vaccination camp', 'A CineKind screening',
        'A talk or a school session', 'Something else']
    }
  },

  /* CineKind nominations, reopened for the 2027 edition (16 Sep 2026). The
     first form on this page validated its fields and then thanked people
     without sending anything; the one on the page now goes through
     pfa-forms.js to /api/pfa-submissions and shows only the reference the
     server issued. This spec is the server's half of that wiring:
     test/forms-wired.test.js holds the browser's half, and the admin
     register already names PFA-CK, so a nomination lands in the panel the
     moment it is filed. */
  /* The microsites (9 Oct 2026). Each asks only for what its page marks
     required, in the page's own words; choices are judged against the cards
     the page offers (test/submission-fields.test.js reads the markup). */
  'PFA-CAM': {
    page: 'campus.html',
    required: {
      college: 'Name your college or university.',
      city: 'Which city and state is it in?',
      desks: 'Choose at least one desk your team will run.',
      faculty: 'Has a faculty member agreed to supervise?',
      name: 'Add the name of the student who leads the team.',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add an email, so PFA Campus can reply.'
    },
    options: {
      faculty: ['Yes', 'Not yet'],
      institution: ['A college', 'A university', 'A school', 'An institute']
    }
  },

  'PFA-CSR': {
    page: 'csr.html',
    required: {
      focus: 'Choose at least one area your company would fund.',
      company: 'Add the company\'s name.',
      name: 'Add your name.',
      email: 'Add a work email, so PFA can send a proposal.',
      mobile: 'Enter a 10-digit Indian mobile number.'
    },
    options: {
      budget: ['Under \u20b910 lakh', '\u20b910 lakh to \u20b950 lakh', '\u20b950 lakh to \u20b91 crore', 'Above \u20b91 crore', 'Not decided yet'],
      span: ['One year', 'Two to three years', 'A single project', 'Not decided yet']
    }
  },

  'PFA-LEG': {
    page: 'legacy.html',
    required: {
      interest: 'Choose what you are thinking of.',
      name: 'Add your name.',
      email: 'Add an email, so PFA can reply in confidence.',
      contactBy: 'Choose how PFA should reach you.'
    },
    requiredWhen: [
      { field: 'mobile', message: 'Add a mobile, so PFA can call you.', when: { field: 'contactBy', in: ['Phone'] } }
    ],
    options: {
      interest: ['A share of what I leave', 'A sum of money', 'Property or another asset', 'A gift in memory of someone',
        'I am only exploring'],
      contactBy: ['Email', 'Phone']
    }
  },

  'PFA-CMP': {
    page: 'campaign.html',
    required: {
      cause: 'Choose the cause your campaign is for.',
      format: 'Choose the kind of campaign.',
      title: 'Give your campaign a name.',
      name: 'Add your name.',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add an email, so PFA can reply.',
      city: 'Where will it happen?'
    },
    options: {
      cause: ['Cows in need', 'Community dogs', 'Injured and sick animals', 'Feeding drives',
        'The Sanjay Gandhi Animal Care Centre', 'Where it is needed most'],
      format: ['A birthday or celebration', 'A workplace drive', 'A school or college drive',
        'A run, walk or sports challenge', 'A collection of supplies', 'An awareness event'],
      goalType: ['Money', 'Supplies', 'Awareness']
    }
  },

  'PFA-SG': {
    page: 'sgacc.html',
    required: {
      offer: 'Choose how you would like to help.',
      name: 'Add your name.',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add an email, so the centre can reply.'
    },
    options: {
      /* Time as a volunteer left this form on 9 Oct 2026: volunteering at the
         centre is an area of the one volunteer application (PFA-V). */
      offer: ['Supplies for the animals', 'A visit with a group']
    }
  },

  'PFA-PRV': {
    page: 'privacy.html',
    required: {
      request: 'Choose what you are asking for.',
      name: 'Add your name.',
      email: 'Add the email you gave PFA, so the answer reaches you.'
    },
    options: {
      request: ['A copy of what PFA holds about me', 'A correction', 'Erase what I sent',
        'Withdraw my consent', 'A question about this policy']
    }
  },

  'PFA-CK': {
    page: 'cinekind.html',
    required: {
      nominee: 'Say who you are nominating.',
      category: 'Choose the closest category.',
      why: 'Say why they should be honoured.',
      name: 'Add your name.',
      email: 'Add a valid email, so the committee can reach you.'
    },
    options: {
      category: ['A film or documentary', 'A director or filmmaker', 'An actor or public figure',
        'A journalist or photographer', 'A caregiver or rescue worker', 'Something else']
    }
  },

  /* The application form for approval of a new PFA unit, online (owner,
     22 Oct 2026: "a ditto digital version, which on submission should go to
     gandhim"). The paper form's own fields, in its own words: the applicant,
     the seven board members (the undertaking commits "all 7 members"), five
     cases under criterion A or the rescue work under criterion B, and the
     undertaking, agreed and signed. The page sends each board member, case
     and rescue as one line, so the whole application stays under the
     intake's forty fields; it checks the parts of each line itself (one
     member an advocate, an age, a phone). */
  'PFA-U': {
    page: 'units.html',
    required: {
      name: 'Add your name, as the applicant.',
      address: 'Add your address.',
      city: 'Add your city.',
      district: 'Add your district.',
      mobile: 'Enter a 10-digit Indian mobile number.',
      email: 'Add an email, so the head office can reply.',
      unitPlace: 'Say where the unit would be.',
      unitDistrict: 'Add the district of the unit.',
      member1: 'Add board member 1.',
      member2: 'Add board member 2.',
      member3: 'Add board member 3.',
      member4: 'Add board member 4.',
      member5: 'Add board member 5.',
      member6: 'Add board member 6.',
      member7: 'Add board member 7.',
      criteria: 'Choose A or B, the criterion you qualify under.',
      salutation: 'Choose Dr., Mr. or Ms.',
      relation: 'Add whose son, daughter or wife you are.',
      workingAs: 'Say what you presently work as.',
      undertaking: 'Agree to the undertaking before sending.',
      signature: 'Type your name as your signature.'
    },
    /* Criterion A is five cases, every one of them; criterion B is the rescue
       work, at least one rescue. */
    requiredWhen: [1, 2, 3, 4, 5].map((n) => ({
      field: `case${n}`, message: `Add case ${n}: criterion A is five cases.`,
      when: { field: 'criteria', in: ['A. Cases lodged', 'Both A and B'] }
    })).concat([{
      field: 'rescue1', message: 'Add at least one rescue for criterion B.',
      when: { field: 'criteria', in: ['B. Rescue work', 'Both A and B'] }
    }]),
    options: {
      salutation: ['Dr.', 'Mr.', 'Ms.'],
      criteria: ['A. Cases lodged', 'B. Rescue work', 'Both A and B']
    }
  }
};

function specFor(kind) {
  return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : null;
}

function blank(value) {
  return !String(value == null ? '' : value).trim();
}

/* A host is on the list if it IS one of them or sits under one. Deliberately
   not a substring test: wall.html's regex is unanchored, so
   "youtube.com.example.net" satisfies the page and would have satisfied this
   too if it were written the same way. */
function hostAllowed(value, allowed) {
  let host = '';
  try { host = new URL(String(value)).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return false; }
  return allowed.some((name) => host === name || host.endsWith(`.${name}`));
}

/* Every field of one submission, judged together.

   Returns { errors, clean }. `errors` is a list of { field, message } in the
   order the form shows them, so the first one is the field to move to.
   `clean` is what should be stored: every value normalised by its rule. */
function validate(kind, fields) {
  const spec = specFor(kind) || {};
  const required = spec.required || {};
  const options = spec.options || {};
  const errors = [];
  const clean = {};
  const given = fields || {};

  /* A submission with nothing in it is not a submission. This catches the
     empty POST before anything else, so the answer names the cause rather
     than listing every field the form has. */
  const anything = Object.keys(given).some((key) => !blank(given[key]));
  if (!anything) {
    return { errors: [{ field: '', message: 'Nothing was filled in.' }], clean: {} };
  }

  /* Required first and in the spec's own order: the page asks for these in a
     sequence, and the answer should follow it. */
  Object.keys(required).forEach((field) => {
    if (blank(given[field])) errors.push({ field, message: required[field] });
  });

  /* Required only for some answers to another field: the Zone for the
     Zonal Head, a mobile when someone asks to be called. `orBlank` holds a
     submission that does not say at all to the rule, for a page still open
     from before the choice existed. */
  (spec.requiredWhen || []).forEach((rule) => {
    const on = String(given[rule.when.field] == null ? '' : given[rule.when.field]).trim();
    const applies = rule.when.in.includes(on) || (rule.when.orBlank && !on);
    if (applies && blank(given[rule.field]) && !errors.some((e) => e.field === rule.field)) {
      errors.push({ field: rule.field, message: rule.message });
    }
  });

  /* No submission of any kind is filed without an email (owner, 16 Sep 2026):
     it is how PFA keeps track of who sent what, and where the confirmation
     goes. Every kind with a form names it above in its own words; this holds
     the kinds that have no spec to the same rule. */
  if (!Object.prototype.hasOwnProperty.call(required, 'email') && blank(given.email)
      && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(given.contact == null ? '' : given.contact).trim())) {
    errors.push({ field: 'email', message: 'Add an email, so PFA can confirm this and reach you.' });
  }

  /* A state and a district can both be present and still not be a place.
     Only checked when both arrived: their absence is the required rules'
     business above, and saying it twice would put two errors on one field. */
  (spec.pairs || []).forEach((rule) => {
    const state = given[rule.state];
    const district = given[rule.district];
    if (blank(state) || blank(district)) return;
    if (!INDIA.pairOk(state, district)) errors.push({ field: rule.district, message: rule.message });
  });

  (spec.oneOf || []).forEach((rule) => {
    if (!rule.fields.some((field) => !blank(given[field]))) {
      errors.push({ field: rule.fields[0], message: rule.message });
    }
  });

  /* Then the shape of what was actually sent, required or not. A field left
     blank and not required is simply passed through: `check` judges entries,
     `required` judges absence, and the two must not be confused. */
  Object.keys(given).forEach((field) => {
    const raw = given[field];
    if (blank(raw)) { clean[field] = raw; return; }
    const message = RULES.checkField(field, raw, {
      required: false,
      options: options[field],
      optionMessage: required[field] || 'Choose one of the options offered.'
    });
    if (!message && spec.hosts && spec.hosts[field] && !hostAllowed(raw, spec.hosts[field])) {
      errors.push({
        field,
        message: `Link to the post itself on ${spec.hosts[field].slice(0, -1).join(', ')} or ${spec.hosts[field].slice(-1)}.`
      });
      clean[field] = RULES.normaliseField(field, raw);
      return;
    }
    if (message && !errors.some((e) => e.field === field)) errors.push({ field, message });
    clean[field] = options[field] ? RULES.squash(raw) : RULES.normaliseField(field, raw);
  });

  return { errors, clean };
}

module.exports = { KINDS, specFor, validate };
