'use strict';

/* What a person is told once they have sent something to PFA: in the letter
   emailed to them, and on the page they are looking at when it goes.

   ---- why this file exists -------------------------------------------------

   The membership welcome letter was the one confirmation written to the
   brief: one flat electric blue, poster type, the number large. Everything
   else went out as the grey acknowledgement; a colony caregiver application,
   paid for, went out with no email at all; and no page told anyone that the
   email might be sitting in Spam. The pages could not have said so anyway:
   /api/pfa-submissions answered `acknowledged` and pfa-forms.js kept only the
   reference, so a page had no idea whether an email had gone.

   So every kind now gets the letter, worded for what was actually sent, with
   its number called what it is: an application number for an application, a
   member number for a membership, a reference for a report. Every page that
   shows a number says whether a confirmation went, to which address, and
   where to look when it is not in the inbox. The words for both live here,
   so the email and the screen cannot disagree.

   The lead lines are the pages' own success copy. Each `path` is the stage
   list the form itself shows under "Where an application goes", or the public
   statuses from lib/submissions.js; test/confirmations.test.js reads the
   pages and fails if the two drift apart. */

const S = require('./submissions');

const APPLICATION = 'Application number';
const REFERENCE = 'Reference';
const MEMBER = 'Member number';
const TRANSACTION = 'PFA transaction ID';

/* The public statuses, in the order a record moves through them. Read from
   the one vocabulary the track page and the panel already use. */
const GENERIC_PATH = ['new', 'in-progress', 'handled'].map((status) => S.PUBLIC_STATUS[status].label);

const KINDS = {
  'PFA-CR': {
    short: 'report',
    thing: 'cruelty report',
    subject: 'Your report is in',
    headline: ['Your', 'report', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA can now see the report and any photographs with it. You will hear back on the mobile or email you gave.',
    urgent: 'If the animal is in danger right now, call the police on 112.',
    path: GENERIC_PATH
  },
  'PFA-Q': {
    short: 'question',
    thing: 'question',
    subject: 'Your question is in',
    headline: ['Your', 'question', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA can now see your question. The answer comes to the mobile or email you gave.',
    path: GENERIC_PATH
  },
  'PFA-J': {
    short: 'application',
    thing: 'job application',
    subject: 'Your application is in',
    headline: ['Your', 'answers', 'are in.'],
    number: APPLICATION,
    lead: 'A named person at PFA can now read your answers. Shortlisted candidates are called within three weeks, and everyone hears back either way.',
    path: GENERIC_PATH
  },
  'PFA-V': {
    short: 'application',
    thing: 'volunteer application',
    subject: 'Your volunteer application is in',
    headline: ['You', 'offered', 'your', 'time.'],
    number: APPLICATION,
    lead: 'It is on PFA\'s record under Volunteers at the Submitted stage, and a named person moves it from there. Nothing is decided yet.',
    path: ['Submitted', 'Under review', 'Shortlisted', 'Approved or not taken forward']
  },
  'PFA-EV': {
    short: 'request',
    thing: 'event request',
    subject: 'Your event request is in',
    headline: ['Your', 'request', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA picks it up from here and will use the contact you gave. It is a request, not a booking: nothing is confirmed until someone at PFA replies.',
    path: GENERIC_PATH
  },
  'PFA-S': {
    short: 'film',
    thing: 'film for the Wall',
    subject: 'Your film is in',
    headline: ['Your', 'film', 'is in.'],
    number: REFERENCE,
    lead: 'An editor at PFA watches every submission before anything goes on the Wall, and will use the contact you gave.',
    path: GENERIC_PATH
  },
  'PFA-W': {
    short: 'field note',
    thing: 'field note',
    subject: 'Your field note is in',
    headline: ['Your', 'field', 'note', 'is in.'],
    number: REFERENCE,
    lead: 'The desk reads every field note before it is published, and may use the contact you gave to check a detail.',
    path: GENERIC_PATH
  },
  'PFA-CK': {
    short: 'nomination',
    thing: 'CineKind nomination',
    subject: 'Your nomination is in',
    headline: ['Your', 'nomination', 'is in.'],
    number: REFERENCE,
    lead: 'The committee reads every nomination; if they need more from you, they will use the contact you gave. A nomination is a proposal to the committee, not a promise of an award.',
    path: GENERIC_PATH
  },
  'PFA-CG': {
    short: 'application',
    thing: 'colony caregiver card application',
    subject: 'Your caregiver card application is in',
    headline: ['Applied.', 'Now a', 'person', 'reads it.'],
    number: APPLICATION,
    lead: 'A named person at PFA reads every application and decides. The card is not issued on the spot.',
    path: ['Submitted', 'Under review', 'Verified', 'Card issued']
  },
  'PFA-CAM': {
    short: 'registration',
    thing: 'PFA Campus registration',
    subject: 'Your campus registration is in',
    headline: ['Your', 'society', 'is', 'registered.'],
    number: APPLICATION,
    lead: 'Someone at PFA Campus reads every registration and will call or write to the lead you named. A society is recognised by PFA, not on the spot.',
    path: ['Submitted', 'Under review', 'Recognised']
  },
  'PFA-VI': {
    short: 'application',
    thing: 'virtual internship application',
    subject: 'Your internship application is in',
    headline: ['Applied.', 'Now a', 'person', 'reads it.'],
    number: APPLICATION,
    lead: 'A person at PFA reads every application and will write to you within a week with a batch and a mentor, or with what to do next.',
    path: ['Submitted', 'Under review', 'Accepted']
  },
  'PFA-CSR': {
    short: 'enquiry',
    thing: 'partnership enquiry',
    subject: 'Your partnership enquiry is in',
    headline: ['Your', 'enquiry', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA reads it and will write to you with what a partnership in those areas could look like. Nothing is committed on either side until you both agree it.',
    path: GENERIC_PATH
  },
  'PFA-LEG': {
    short: 'enquiry',
    thing: 'enquiry about a gift in your will',
    subject: 'Thank you for thinking of the animals',
    headline: ['Thank', 'you for', 'thinking', 'of them.'],
    number: REFERENCE,
    lead: 'A named person at PFA will reply in confidence, the way you asked. Nothing you wrote commits you to anything.',
    path: GENERIC_PATH
  },
  'PFA-CMP': {
    short: 'plan',
    thing: 'campaign plan',
    subject: 'Your campaign plan is in',
    headline: ['Your', 'campaign', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA reads your plan and will reply on the contact you gave. Please wait for that reply before you announce it in PFA\'s name.',
    path: GENERIC_PATH
  },
  'PFA-SG': {
    short: 'offer',
    thing: 'offer for the Animal Care Centre',
    subject: 'Your offer for the centre is in',
    headline: ['Your', 'offer', 'is in.'],
    number: REFERENCE,
    lead: 'Someone will reply on the contact you gave to agree a day and what to bring. Please wait for that reply before you travel.',
    path: GENERIC_PATH
  },
  'PFA-PRV': {
    short: 'request',
    thing: 'privacy request',
    subject: 'Your privacy request is in',
    headline: ['Your', 'request', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA will answer it on the email you gave. If what you asked for needs us to be sure it is you, we will ask before we act.',
    path: GENERIC_PATH
  },
  /* units.html (22 Oct 2026). The paper form asks for address proofs, case
     photocopies and rescue photographs; the page takes six photographs, and
     the rest come as a reply to this letter, which reaches the head office
     with its files under the same number (lib/inbound-mail.js). */
  'PFA-U': {
    short: 'application',
    thing: 'application for a new PFA unit',
    subject: 'Your unit application is in',
    headline: ['Your', 'application', 'is in.'],
    number: APPLICATION,
    lead: 'The head office reads every application for a new unit and will use the contact you gave. To send address proofs, case papers or photographs you did not attach, reply to this email with them attached.',
    path: GENERIC_PATH
  },
  /* Kinds the server accepts that no page sends today. Worded properly all
     the same, so one that comes back is not confirmed as "your general form
     has reached People for Animals" (21 Oct 2026). */
  'PFA-A': {
    short: 'application',
    thing: 'adoption application',
    subject: 'Your adoption application is in',
    headline: ['Your', 'application', 'is in.'],
    number: APPLICATION,
    lead: 'A named person at PFA reads every adoption application and will use the contact you gave. Nothing is decided until they have spoken to you.',
    path: GENERIC_PATH
  },
  'PFA-C': {
    short: 'request',
    thing: 'request to follow a case',
    subject: 'Your request is in',
    headline: ['Your', 'request', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA picks it up from here and will use the contact you gave.',
    path: GENERIC_PATH
  },
  'PFA-CAC': {
    short: 'entry',
    thing: 'CineKind entry',
    subject: 'Your CineKind entry is in',
    headline: ['Your', 'entry', 'is in.'],
    number: REFERENCE,
    lead: 'The committee looks at every entry; if they need more from you, they will use the contact you gave.',
    path: GENERIC_PATH
  },
  'PFA-F': {
    short: 'message',
    thing: 'message',
    subject: 'Your message is in',
    headline: ['Your', 'message', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA picks it up from here and will use the contact you gave.',
    path: GENERIC_PATH
  },
  'PFA-MEET': {
    short: 'request',
    thing: 'request to meet',
    subject: 'Your request to meet is in',
    headline: ['Your', 'request', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA will reply on the contact you gave. Nothing is fixed until they do.',
    path: GENERIC_PATH
  },
  'PFA-POD': {
    short: 'request',
    thing: 'podcast or media request',
    subject: 'Your media request is in',
    headline: ['Your', 'request', 'is in.'],
    number: REFERENCE,
    lead: 'A named person at PFA will reply on the contact you gave. Nothing is fixed until they do.',
    path: GENERIC_PATH
  },
  'PFA-MEM': {
    short: 'membership',
    thing: 'membership',
    subject: 'You\'re one of us now',
    headline: ['You\'re', 'one of', 'us now.'],
    number: MEMBER,
    lead: 'Every member is an active working member: when an animal near you needs someone, PFA may call on you, and you may call on PFA.',
    path: ['Paid', 'Your photograph', 'Card by courier']
  }
};

/* A donation is a payment, not a submission kind, but it is confirmed in the
   same letter, and the page speaks about its email the same way.

   A donation is a donation, and only a donation given in someone's name
   (donate.html, "Give as a gift") is a gift. The receipt said "Your gift is
   in" to every donor, beside a separate Give as a gift choice the donor had
   not made (owner, 21 Oct 2026: "for donation. why does it show gift"). */
const DONATION = {
  short: 'donation',
  thing: 'donation',
  subject: 'Your donation is in',
  headline: ['Your', 'donation', 'is in.'],
  number: TRANSACTION,
  lead: 'This is your acknowledgement.',
  path: []
};
const GIFT = Object.assign({}, DONATION, {
  short: 'gift',
  thing: 'gift',
  subject: 'Your gift is in',
  headline: ['Your', 'gift', 'is in.']
});

/* "CineKind entry" keeps its capital; "Corporate partnership" reads as a
   phrase inside a sentence. */
function inSentence(label) {
  const text = String(label || '').trim();
  const first = text.split(/\s+/)[0] || '';
  return /[A-Z]/.test(first.slice(1)) ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/* The wording for any kind the submissions API accepts. A kind with no entry
   above is still confirmed: it is called an application if its label says it
   is one, and a reference otherwise. */
function forKind(kind) {
  if (Object.prototype.hasOwnProperty.call(KINDS, kind)) return KINDS[kind];
  const label = S.KIND_LABELS[kind] || 'Submission';
  return {
    short: /application/i.test(label) ? 'application' : 'submission',
    thing: inSentence(label),
    subject: 'Received by PFA',
    headline: ['We have', 'it.'],
    number: /application/i.test(label) ? APPLICATION : REFERENCE,
    lead: 'A named person at PFA picks it up from here.',
    path: GENERIC_PATH
  };
}

/* The same, for what CCAvenue took payment for. */
function forPayment(type) {
  if (type === 'membership') return KINDS['PFA-MEM'];
  if (type === 'caregiver-application') return KINDS['PFA-CG'];
  return DONATION;
}

/* The subject the person's confirmation went out under, from the record
   alone. A reply from the panel is sent as "Re:" this, so Gmail and Outlook
   file it in the same conversation as the confirmation. Each template above
   builds its subject the same way; test/email-thread.test.js holds them to it. */
function threadSubject(record) {
  const r = record || {};
  const reference = String(r.reference || '');
  const fields = r.fields || {};
  if (r.kind === 'PFA-MEM') return `You're one of us now - PFA member ${reference}`;
  if (r.kind === 'PFA-DON') return `Donation received by PFA - ${fields.orderId || reference}`;
  if (r.kind === 'PFA-SHP') return `Your PFA order ${reference} is placed`;
  return `${forKind(r.kind).subject} - ${reference}`;
}

/* ---- the note on the page ----------------------------------------------- */

function senderAddress() {
  const smtp = String(process.env.PFA_SMTP_USER || '').trim().toLowerCase();
  if (smtp && process.env.PFA_SMTP_PASS) return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(smtp) ? smtp : '';
  const from = String(process.env.PFA_MAIL_FROM || 'People for Animals <cards@peopleforanimalsindia.org>');
  const bracketed = /<([^>]+)>/.exec(from);
  const address = (bracketed ? bracketed[1] : from).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(address) ? address : '';
}

/* Where to look, in the order worth trying. */
function lookSteps(reference) {
  const from = senderAddress();
  const search = [reference, from].filter(Boolean);
  return [
    'Give it a few minutes to arrive.',
    'Look in Spam or Junk. In Gmail, check the Promotions and Updates tabs too.',
    search.length ? `Search your mail for ${search.join(' or ')}.` : 'Search your mail for People for Animals.',
    'Found it in Spam or Junk? Mark it Not spam, so the next email from PFA reaches your inbox.'
  ];
}

/* What the page says about the email, from what actually happened to it.
   `state` is what send() returned, and `reason` its reason when it gave one.
   `item` names what went: "A receipt", "Your welcome letter"; left out, it
   is a confirmation carrying the number.

   An email that could not go is the person's address's fault only when the
   receiving server said so (reason RECIPIENT_REFUSED). Until 8 Oct 2026 the
   page told everyone to "check that the address is right", including when
   the site's own mailbox password was wrong (review C item 2). */
function notice({ state, to, number, reference, item, reason } = {}) {
  const label = inSentence(number || REFERENCE);
  const address = String(to || '').trim();
  const what = item || `A confirmation with your ${label}`;
  if (state === 'sent' && address) {
    return {
      state: 'sent', to: address, title: 'Check your email.',
      lines: [`${what} has been emailed to ${address}.`],
      ask: 'Not in your inbox?', steps: lookSteps(reference)
    };
  }
  if (state === 'queued' && address) {
    return {
      state: 'queued', to: address, title: 'Your email is on its way.',
      lines: [`Sending it to ${address} is taking longer than usual. If it has not arrived in a few minutes, PFA tries again on its own, which can take up to a day. Keep the ${label} meanwhile.`],
      ask: 'When you look for it:', steps: lookSteps(reference)
    };
  }
  if (state === 'unsent' && address) {
    return {
      state: 'unsent', to: address, title: 'Keep this number.',
      lines: [reason === 'RECIPIENT_REFUSED'
        ? `The mail server for ${address} did not accept the email. Check that the address is right; either way this page is your record, so keep the ${label}.`
        : `No email could be sent to ${address} just now. This page is your record, so keep the ${label}.`],
      ask: '', steps: []
    };
  }
  return {
    state: 'none', to: '', title: '',
    lines: [`No email was given, so none was sent. Keep the ${label}: it is your record.`],
    ask: '', steps: []
  };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* The note as markup, for the pages the server writes itself: the result of
   a payment, and the answer to a form posted without script. Class names are
   styled by each of those pages. */
function noticeHtml(n) {
  if (!n || (!n.title && !(n.lines || []).length)) return '';
  const to = escapeHtml(n.to);
  const lines = (n.lines || []).map((line) => {
    const safe = escapeHtml(line);
    return `<p>${to && safe.includes(to) ? safe.replace(to, `<strong>${to}</strong>`) : safe}</p>`;
  }).join('');
  const steps = (n.steps || []).length
    ? `${n.ask ? `<p class="mail__ask">${escapeHtml(n.ask)}</p>` : ''}<ol>${n.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`
    : '';
  return `<div class="mail" data-mail="${escapeHtml(n.state)}">${n.title ? `<p class="mail__title">${escapeHtml(n.title)}</p>` : ''}${lines}${steps}</div>`;
}

/* ---- sending -------------------------------------------------------------- */

const TIMEOUT_MS = 2500;
/* Sending through PFA's own mailbox is a TCP connection to GoDaddy, a TLS
   handshake, a login and an upload, photographs included: routinely past
   2.5 seconds, which was sized for a JSON API. A send that is cut off at
   that point is not stopped, only abandoned, and was then sent again by the
   worker, so the inbox got some submissions twice. The mailbox gets a
   longer wait, and a send that finishes after the wait is still recorded. */
const SMTP_TIMEOUT_MS = 9000;

function withTimeout(work, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(work).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('confirmation timed out'), { timedOut: true })), ms); })
  ]);
}

function settle(work, what) {
  return Promise.resolve().then(() => work).catch((error) => {
    console.warn(`confirmation ${what} not recorded`, error && error.message);
  });
}

/* What a failure was, as the queue counts it (lib/caregiver-store.js): the
   mailer marks its own errors. An error with no mark answers '' and the
   queue reads its words instead (only ever as a login problem, never as a
   bad address). */
function failureKind(error) {
  const e = error || {};
  if (['config', 'recipient', 'unknown', 'transient'].includes(e.kind)) return e.kind;
  if (e.uncertain) return 'unknown';
  if (e.config || e.code === 'MAIL_NOT_CONFIGURED') return 'config';
  if (e.permanent || e.code === 'INVALID_RECIPIENT') return 'recipient';
  return '';
}

/* Sends one confirmation, and never throws.

   The row goes on the outbound queue (caregiverEmails) first, already
   claimed by this request (8 Oct 2026, review C item 4), so neither the
   email worker nor the panel's Resend sends it while this request does.
   Delivery is tried at once. If the provider is slow or down, the request
   that caused the email is not held up or failed: the row stays on the
   queue and the email worker sends it on its next run. What comes back
   says which happened, so the page can say so:

     sent     the provider took it
     queued   it will go on a later attempt (also when the site's own
              mailbox login failed: that is mended at PFA's end and the
              email then goes, so the person is not asked to check their
              address)
     unsent   no attempt could be made (reason MAIL_NOT_CONFIGURED, or no
              queue to retry from), or the address was refused for good
              (reason RECIPIENT_REFUSED)
     none     no email address was given

   The dedupe key is used exactly as given: the caller decides what makes
   two emails the same one (CONTRACT section 4: a submission's keys carry
   its threadId). */
async function send({ to, template, payload, dedupeKey, mail, queue, timeoutMs = TIMEOUT_MS }) {
  const address = String(to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return { state: 'none', to: '' };
  if (!mail || typeof mail.isConfigured !== 'function' || !mail.isConfigured()) {
    return { state: 'unsent', to: address, reason: 'MAIL_NOT_CONFIGURED' };
  }

  let queued = null;
  if (queue && typeof queue.queueEmail === 'function') {
    try {
      queued = await queue.queueEmail({ template, to: address, payload, dedupeKey, claim: 'immediate' });
    } catch (error) {
      console.warn('confirmation not queued', { template, message: error && error.message });
    }
  }
  /* Already on the queue under this key: an earlier request has it in hand.
     Said as it stands on the queue, when the queue says. */
  if (queued && queued.created === false) {
    const status = String(queued.status || 'sent');
    const state = status === 'sent' ? 'sent' : status === 'failed' ? 'unsent' : 'queued';
    return { state, to: address, duplicate: true };
  }

  const claimToken = (queued && queued.claimToken) || undefined;
  const record = (result, what) => (queued
    ? settle(queue.recordEmailResult(Object.assign({ emailId: queued.emailId, claimToken }, result)), what)
    : Promise.resolve());
  const budget = typeof mail.smtpConfigured === 'function' && mail.smtpConfigured() ? Math.max(timeoutMs, SMTP_TIMEOUT_MS) : timeoutMs;
  const attempt = Promise.resolve().then(() => mail.deliver({ to: address, template, payload }));
  try {
    const sent = await withTimeout(attempt, budget);
    await record({ ok: true, providerId: sent && sent.providerId }, 'result');
    return { state: 'sent', to: address, providerId: (sent && (sent.providerId || sent.id)) || null, messageId: (sent && sent.messageId) || null };
  } catch (error) {
    if (error && error.timedOut) {
      /* The wait ran out, not the send: it may still go. The row stays
         claimed (its lease runs out on its own if this function is frozen
         before the answer comes), marked "outcome not known", and the late
         answer is written when it comes, so nothing sends a second copy
         while this one may still be on its way. */
      if (queued) {
        await record({ ok: false, uncertain: true, error: 'Still sending when the page answered (outcome not known yet).' }, 'result');
        const late = attempt.then(
          (done) => record({ ok: true, providerId: done && done.providerId }, 'late result'),
          (failed) => record({ ok: false, error: (failed && failed.message) || String(failed), kind: failureKind(failed) || undefined }, 'late result')
        );
        /* On Vercel the function may be frozen the moment it answers, which
           left the email half sent and the line "Waiting to send" until the
           next worker run (owner, 26 Oct 2026: "nothing should wait"). It is
           kept alive until the send and its result are written. */
        try { require('./sent-copy').extendLife(late); } catch (_) { /* not on Vercel */ }
      }
      console.warn('confirmation still sending when the page answered', { template });
      return { state: queued ? 'queued' : 'unsent', to: address, reason: 'SLOW' };
    }
    const kind = failureKind(error);
    await record({ ok: false, error: (error && error.message) || String(error), kind: kind || undefined }, 'result');
    console.warn('confirmation not sent at once', { template, kind, message: error && error.message });
    if (kind === 'recipient') return { state: 'unsent', to: address, reason: 'RECIPIENT_REFUSED' };
    const reason = kind === 'config' ? 'MAIL_LOGIN' : kind === 'unknown' ? 'OUTCOME_UNKNOWN' : 'RETRYING';
    return { state: queued ? 'queued' : 'unsent', to: address, reason };
  }
}

module.exports = {
  APPLICATION,
  REFERENCE,
  MEMBER,
  TRANSACTION,
  GENERIC_PATH,
  KINDS,
  DONATION,
  GIFT,
  forKind,
  forPayment,
  threadSubject,
  inSentence,
  lookSteps,
  notice,
  noticeHtml,
  send,
  senderAddress,
  failureKind
};
