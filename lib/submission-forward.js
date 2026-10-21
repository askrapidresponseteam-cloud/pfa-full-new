'use strict';

/* Every submission, emailed to PFA's inbox, with Reply-To set to the person
   who sent it (owner, 3 Oct 2026).

   The inbox is gandhim@exmpls.sansad.in, a government mailbox: nothing on
   that side can be configured or connected, so this asks nothing of it. The
   site sends an ordinary email to it; the email's Reply-To is the address
   the submitter gave on the form; pressing Reply in any mail app therefore
   writes straight to the submitter, from that mailbox. The site is not in
   the conversation after the first email, and keeps no copy of the reply.

   One forward per submission, whatever made it: the public forms
   (lib/routes/pfa-submissions.js), and the two records a payment opens, a
   membership and a colony caregiver application
   (lib/routes/payment/response.js). Sent through the same outbound queue as
   the confirmations, so a mail provider that is slow or down delays the
   forward and never fails the form; a retried send carries the same
   idempotency key, so the inbox gets it once.

   PFA_SUBMISSIONS_INBOX overrides the inbox, and may name several addresses
   separated by commas. Set it to "off" to stop forwarding. A record of money
   goes elsewhere: see PAID_KINDS below.

   Since v1.399 the site is in the conversation after all. The copy carries a
   Message-ID naming the submission and its thread (lib/mail-thread.js), and
   when a mailbox is set up for replies (PFA_IMAP_USER, or the sending
   mailbox) it is named as a second Reply-To after the sender's address: a
   Reply from the inbox still goes to the sender, and a copy comes back to
   that mailbox, where lib/inbound-mail.js files it on the same record. */

const crypto = require('crypto');
const CONFIRM = require('./confirmations');
const ORDER = require('./message-order');

const DEFAULT_INBOX = 'gandhim@exmpls.sansad.in';
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/;

/* Money goes to its own two inboxes (owner, 21 Oct 2026: "any record of
   money collected on the website to only go to pfadcmho@gmail.com ;
   ozairhusain@gmail.com not gandhim"). A record is money when a payment
   opened it, which is what these four kinds are: lib/routes/payment/
   response.js files the membership, the caregiver application and the
   donation (a gift is a donation), and lib/routes/shop/response.js the shop
   order. test/payment-inbox.test.js reads those two files and fails if they
   ever file a kind that is not listed here.

   PFA_PAYMENTS_INBOX overrides the pair, comma separated, or "off". Whatever
   it says, the forms inbox's own default address never receives a record
   of money: it is struck from the list, so no setting, old or new, in
   Vercel or in functions/.env, can send one there. */
const DEFAULT_PAYMENTS_INBOX = 'pfadcmho@gmail.com, ozairhusain@gmail.com';
/* the same list the public intake refuses (lib/submissions.js): a kind only
   a payment can open, so one list says both things */
const PAID_KINDS = require('./submissions').PAID_KINDS;
const NEVER_FOR_PAYMENTS = new Set([DEFAULT_INBOX]);

function listOf(name, fallback) {
  const raw = String(process.env[name] == null ? fallback : process.env[name]).trim();
  if (!raw || /^off$/i.test(raw)) return [];
  return [...new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => EMAIL.test(s)))];
}

function isPaid(record) {
  return PAID_KINDS.has(String((record && record.kind) || '').trim().toUpperCase());
}

/* Any address that may receive a record of money: never the forms inbox. */
function forPayments(addresses) {
  return (addresses || []).map((a) => String(a || '').trim().toLowerCase()).filter((a) => a && !NEVER_FOR_PAYMENTS.has(a));
}

function paymentInboxes() {
  return forPayments(listOf('PFA_PAYMENTS_INBOX', DEFAULT_PAYMENTS_INBOX));
}

function formInboxes() {
  return listOf('PFA_SUBMISSIONS_INBOX', DEFAULT_INBOX);
}

/* Where this record's copy goes: a record of money to the payments pair,
   anything else to the forms inbox. With no record, the forms inbox, as
   before. */
function inboxes(record) {
  return record && isPaid(record) ? paymentInboxes() : formInboxes();
}

/* Every mailbox that receives copies, for telling a reply from staff apart
   from one by the person who wrote in. */
function allInboxes() {
  return [...new Set([...formInboxes(), ...paymentInboxes()])];
}

/* "animalType" and "animal_type" both read "Animal type". */
function labelFor(key) {
  /* A key that is already words ("Q1 Poisoning and FIR refusal", the job
     form's questions) is the form's own heading: kept as written. */
  if (/\s/.test(String(key).trim())) return String(key).trim();
  const words = String(key).replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(key);
}

/* The forms' own wording for the keys they send (owner, 7 Oct 2026: the
   inbox read "What" and "Accused" where the form had asked "What is
   happening" and "Who is doing it"). A key that means something different
   on one form is named under that form's kind. Anything not here falls back
   to labelFor, so a field a form gains later still arrives, just plainly
   named. */
const LABELS = {
  what: 'What is happening',
  animal: 'Animal',
  urgency: 'Still going on',
  location: 'Where',
  pincode: 'Pincode',
  when: 'When',
  accused: 'Who is doing it',
  question: 'Question',
  topic: 'What it is about',
  state: 'State',
  city: 'City or district',
  notes: 'Anything else',
  nominee: 'Nominating',
  category: 'Kind of work',
  work: 'The film or work',
  link: 'Link',
  why: 'Why they should be honoured',
  url: 'Link to the video',
  wall: 'Which wall',
  role: 'Role',
  roleId: 'Role code',
  zone: 'Zone',
  pfaMember: 'Already a PFA member',
  unit: 'Unit and role there',
  background: 'Background',
  travel: 'Can travel',
  timeToApply: 'Time taken to apply',
  tier: 'Membership',
  kit: 'Kit',
  address: 'Address',
  district: 'District',
  amount: 'Amount paid (INR)',
  orderId: 'Order ID',
  bankReference: 'Bank reference',
  pan: 'PAN (for the 80G certificate)',
  cause: 'Where it goes',
  items: 'Ordered',
  total: 'Total paid (INR)',
  trackingId: 'CCAvenue tracking ID'
};
const KIND_LABELS = {
  'PFA-EV': { title: 'Asking for', address: 'Where it could be held' },
  'PFA-V': { title: 'Areas offered', city: 'City or town' },
  'PFA-CG': { title: 'Application', notes: 'About the colony' },
  'PFA-MEM': { title: 'Membership' },
  'PFA-DON': {
    title: 'Gift', amount: 'Amount paid',
    certificate: 'To do', giftTo: 'Certificate for', giftAddress: 'Post the certificate to',
    giftEmail: 'Digital copy to (if asked)'
  },
  'PFA-SHP': { title: 'Order', address: 'Deliver to' },
  'PFA-CAM': { college: 'College or university', institution: 'Kind of institution', city: 'City and state', teamSize: 'Core team',
    desks: 'Desks the team will run', faculty: 'Faculty supervisor agreed', facultyName: 'Faculty supervisor', role: 'Lead\'s course and year', plan: 'First thing they will do' },
  'PFA-CSR': { company: 'Company', role: 'Designation', areas: 'Where it should go', focus: 'Programmes', ways: 'Ways to work together', budget: 'Budget for the year', span: 'Over', message: 'From the company' },
  'PFA-LEG': { interest: 'Thinking of', wording: 'Wording they drafted', contactBy: 'Reach them by', message: 'In their words' },
  'PFA-CMP': { cause: 'Cause', format: 'Kind of campaign', title: 'Campaign name', goalType: 'Raising', goal: 'Goal', when: 'When', reach: 'People it will reach', story: 'Why they are doing it' },
  'PFA-SG': { offer: 'Offering', items: 'Supplies', when: 'When', groupSize: 'Group size', group: 'Group', message: 'Notes' },
  'PFA-PRV': { request: 'Asking for', references: 'Reference numbers given', details: 'Details' },
  'PFA-J': { level: 'Post', dates: 'Available', why: 'Why this role', cv: 'CV or profile' }
};

function labelIn(kind, key) {
  const own = KIND_LABELS[kind];
  if (own && own[key]) return own[key];
  return Object.prototype.hasOwnProperty.call(LABELS, key) ? LABELS[key] : labelFor(key);
}

/* The fields as label/value rows, in the order the form sent them, without
   the ones the email already shows at the top, and without empty ones. */
function rowsOf(fields, skip, kind) {
  const out = [];
  for (const [key, value] of Object.entries(fields || {})) {
    if (skip.has(key)) continue;
    const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : (value && typeof value === 'object' ? JSON.stringify(value) : String(value == null ? '' : value));
    if (!text.trim()) continue;
    out.push({ label: labelIn(kind, key), value: text.slice(0, 4000) });
  }
  return out;
}

function firstOf(fields, pattern) {
  for (const [key, value] of Object.entries(fields || {})) {
    if (pattern.test(key) && typeof value === 'string' && value.trim()) return { key, value: value.trim() };
  }
  return null;
}

/* What the email carries, from a stored submission record. */
function payloadFor(record, siteUrl) {
  const fields = record.fields || {};
  const email = firstOf(fields, /^(e-?mail|email ?address|contactEmail)$/i) || firstOf(fields, /mail/i);
  const name = firstOf(fields, /^(name|full ?name|your ?name|applicantName|contactName)$/i);
  const mobile = firstOf(fields, /^(mobile|phone|whatsapp|telephone|contact ?number)$/i);
  const skip = new Set([email && email.key, name && name.key, mobile && mobile.key].filter(Boolean));
  const site = String(siteUrl || '').replace(/\/+$/, '');
  const replyTo = email && EMAIL.test(email.value.toLowerCase()) ? email.value.toLowerCase() : '';
  return {
    reference: record.reference,
    threadId: record.threadId || '',
    kind: record.kind,
    kindLabel: record.kindLabel || record.kind,
    receivedAt: record.createdAt,
    name: name ? name.value : '',
    email: replyTo,
    mobile: mobile ? mobile.value : '',
    rows: rowsOf(fields, skip, record.kind),
    attachments: Number(record.attachments) || (Array.isArray(record.attachments) ? record.attachments.length : 0),
    page: record.page || '',
    adminUrl: site ? `${site}/admin.html` : '',
    siteUrl: site,
    replyTo
  };
}

/* The queue's key for one copy of one submission to one inbox (CONTRACT
   section 4). It carries the record's threadId: a reference can be issued a
   second time (8 Oct 2026 the counters were emptied while the queue was
   not), and keyed on the reference alone the new submission found the old
   one's row and its copy was silently never sent (review C item 1). A
   record with no threadId (written before threads existed) keeps the old
   key, so nothing already sent goes again. lib/routes/admin/mail-check.js
   builds the same keys to find copies that were never made. */
function forwardKey(record, address) {
  const r = record || {};
  const inbox = String(address || '').trim().toLowerCase();
  /* A follow-up copy (followUp: 'photo', a photograph attached after the
     first copy went without it) is its own email under its own key. */
  const more = /^[a-z0-9-]{1,20}$/.test(String(r.followUp || '')) ? `:${r.followUp}` : '';
  return r.threadId
    ? `submission_forward:${r.reference}:${r.threadId}:${inbox}${more}`
    : `submission_forward:${r.reference}:${inbox}${more}`;
}

/* Sends the forward to every inbox. Never throws: the submission is already
   on record, and a forward that cannot go must not undo that. Resolves to
   the outcome per inbox. */
async function forward({ record, siteUrl, mail, queue, timeoutMs, db }) {
  const to = inboxes(record);
  if (!to.length || !record || !record.reference) return [];
  const payload = payloadFor(record, siteUrl);
  if (/^[a-z0-9-]{1,20}$/.test(String(record.followUp || ''))) payload.followUp = record.followUp;
  const outcomes = await Promise.all(to.map((address) => CONFIRM.send({
    to: address,
    template: 'submission_forward',
    payload,
    dedupeKey: forwardKey(record, address),
    mail,
    queue,
    timeoutMs
  }).catch((error) => {
    console.warn('submission forward not sent', { reference: record.reference, message: error && error.message });
    return { state: 'unsent', to: address };
  })));
  /* The copy is the first message of the conversation the panel shows, so
     it is written there too: who it went to, under which Message-ID, and
     whether it went. Never fails the forward: the record and the email are
     already in hand. */
  if (db && record.threadId) {
    const mailer = require('./caregiver-mail');
    /* dated when the submission arrived: it is the first thing that happened to it */
    const at = record.createdAt || new Date().toISOString();
    for (const outcome of outcomes) {
      if (!outcome || outcome.state === 'none' || outcome.reason === 'MAIL_NOT_CONFIGURED') continue;
      const part = payload.followUp ? `forward.${payload.followUp}` : 'forward';
      const messageId = mailer.threadHeaders({ reference: record.reference, threadId: record.threadId }, part).messageId;
      const id = `out-${part.replace('.', '-')}-${crypto.createHash('sha256').update(String(outcome.to), 'utf8').digest('hex').slice(0, 12)}`;
      try {
        await db.collection('submissions').doc(record.reference).collection('messages').doc(id).create({
          id, seq: ORDER.nextSeq(), type: 'email', direction: 'out', party: 'site', to: outcome.to, from: mailer.sender().address,
          subject: `${record.reference}: ${payload.kindLabel} from ${payload.name || 'Someone'}`,
          text: payload.followUp ? 'The photograph, sent to PFA\'s inbox after the first copy went without it.' : 'Copy of the submission sent to PFA\'s inbox.',
          messageId, state: outcome.state, at: payload.followUp ? new Date().toISOString() : at
        });
      } catch (error) {
        if (!(error && (error.code === 6 || /already exists/i.test(String(error.message))))) {
          console.warn('forward not noted on the conversation', { reference: record.reference, message: error && error.message });
        }
      }
    }
  }
  return outcomes;
}

module.exports = { DEFAULT_INBOX, DEFAULT_PAYMENTS_INBOX, PAID_KINDS, isPaid, forPayments, paymentInboxes, formInboxes, inboxes, allInboxes, labelFor, labelIn, payloadFor, forward, forwardKey };
