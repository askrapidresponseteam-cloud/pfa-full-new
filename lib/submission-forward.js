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

/* Kept in the admin panel only, never emailed to anyone at PFA. From
   21 Oct 2026 these were volunteer applications and memberships ("Keep
   volunteer and membership submissions in the admin panel only"). Owner,
   23 Oct 2026, reversed it: "ensure all caregiver and volunteer and job and
   membership applications go to gandhim email id." So nothing is kept to
   the panel alone any more; the set stays, empty, so a kind can be put back
   in it without new code. */
const PANEL_ONLY_KINDS = new Set();

function panelOnly(record) {
  return PANEL_ONLY_KINDS.has(String((record && record.kind) || '').trim().toUpperCase());
}

/* A colony caregiver application and a membership are forms that come
   with a fee (owner, 23 Oct 2026: "hope all caregiver application goes to
   gandhim, ensure it does. payment receipt to go to others. but application
   should go to gandhim email ID pls.", and the same evening "ensure all
   caregiver and volunteer and job and membership applications go to
   gandhim email id."). So each is copied twice: the application, with its
   photograph and without a word about the money, to the forms inbox; the
   payment, as a receipt with no application in it, to the payments inboxes.
   An address on both lists gets one copy carrying both. What the person
   writes back is about their application, so it is relayed to the forms
   inbox, where the application is. */
const SPLIT_KINDS = new Set(['PFA-CG', 'PFA-MEM']);

function kindOf(record) {
  return String((record && record.kind) || '').trim().toUpperCase();
}

function split(record) {
  return SPLIT_KINDS.has(kindOf(record));
}

/* The copy that carries money: a receipt, or both in one. */
function carriesMoney(payload) {
  const copy = payload && payload.copy;
  return copy === 'payment' || copy === 'whole';
}

/* Every copy this record makes: to whom, and which. '' is the record as it
   is (a form to the forms inbox, a record of money to the payments inboxes).
   A follow-up (the photograph sent after the first copy went without it)
   belongs to the application, so only the application's inboxes get it. */
function copiesOf(record) {
  if (!record) return formInboxes().map((to) => ({ to, copy: '' }));
  if (panelOnly(record)) return [];
  if (!isPaid(record)) return formInboxes().map((to) => ({ to, copy: '' }));
  if (!split(record)) return paymentInboxes().map((to) => ({ to, copy: '' }));
  const pay = paymentInboxes();
  const forms = formInboxes();
  const out = forms.map((to) => ({ to, copy: pay.includes(to) ? 'whole' : 'application' }));
  if (!record.followUp) for (const to of pay) if (!forms.includes(to)) out.push({ to, copy: 'payment' });
  return out;
}

/* Every inbox this record's copies go to: nowhere for a panel-only kind, a
   record of money to the payments pair, a caregiver application to both
   (each its own copy), anything else to the forms inbox. With no record,
   the forms inbox, as before. */
function inboxes(record) {
  return [...new Set(copiesOf(record).map((c) => c.to))];
}

/* Where what the person writes back is carried. */
function relayInboxes(record) {
  if (record && split(record) && !panelOnly(record)) return formInboxes();
  return inboxes(record);
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
  pin: 'PIN code',
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
  'PFA-CG': { title: 'Application', notes: 'About the colony', address: 'Post the card to', colony: 'Colony where they feed' },
  'PFA-MEM': { title: 'Application', address: 'Post the card and kit to' },
  'PFA-DON': {
    title: 'Gift', amount: 'Amount paid',
    certificate: 'To do', giftTo: 'Certificate for', giftAddress: 'Post the certificate to',
    giftEmail: 'Digital copy to (if asked)'
  },
  'PFA-SHP': { title: 'Order', address: 'Deliver to' },
  'PFA-CAM': { college: 'College or university', institution: 'Kind of institution', city: 'City and state', teamSize: 'Core team',
    desks: 'Desks the team will run', faculty: 'Faculty supervisor agreed', facultyName: 'Faculty supervisor', role: 'Lead\'s course and year', plan: 'First thing they will do' },
  'PFA-VI': { age: 'Age', why: 'Why they want to do it', work: 'College or work', social: 'Instagram or YouTube', parent: 'A parent or guardian agrees' },
  'PFA-CSR': { company: 'Company', role: 'Designation', areas: 'Where it should go', focus: 'Programmes', ways: 'Ways to work together', budget: 'Budget for the year', span: 'Over', message: 'From the company' },
  'PFA-LEG': { interest: 'Thinking of', wording: 'Wording they drafted', contactBy: 'Reach them by', message: 'In their words' },
  'PFA-CMP': { cause: 'Cause', format: 'Kind of campaign', title: 'Campaign name', goalType: 'Raising', goal: 'Goal', when: 'When', reach: 'People it will reach', story: 'Why they are doing it' },
  'PFA-SG': { offer: 'Offering', items: 'Supplies', when: 'When', groupSize: 'Group size', group: 'Group', message: 'Notes' },
  'PFA-PRV': { request: 'Asking for', references: 'Reference numbers given', details: 'Details' },
  'PFA-J': { level: 'Post', dates: 'Available', why: 'Why this role', cv: 'CV or profile' },
  /* The paper form's own wording, in its order (units.html, 22 Oct 2026). */
  'PFA-U': {
    unitPlace: 'Unit of PFA in', unitDistrict: 'District of the unit',
    address: 'Address of the applicant', city: 'City', district: 'District', phone2: 'Phone number (2)',
    member1: 'Board member 1', member2: 'Board member 2', member3: 'Board member 3', member4: 'Board member 4',
    member5: 'Board member 5', member6: 'Board member 6', member7: 'Board member 7',
    criteria: 'Qualifies under',
    case1: 'A) Case 1', case2: 'A) Case 2', case3: 'A) Case 3', case4: 'A) Case 4', case5: 'A) Case 5',
    rescue1: 'B) Rescue 1', rescue2: 'B) Rescue 2', rescue3: 'B) Rescue 3', rescue4: 'B) Rescue 4', rescue5: 'B) Rescue 5',
    salutation: 'Dr. / Mr. / Ms.', relation: 'Son, daughter or wife of', workingAs: 'Presently working as',
    undertaking: 'Undertaking', signature: 'Signature (name typed)', signedOn: 'Date'
  }
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

/* The address, as one line at the top of the copy (owner, 24 Oct 2026:
   "ensure all the forms have the address clearly captured and sent to
   gandhim email ID"). Every form sends the same five fields
   (assets/address.js); a record from before keeps whatever it had (a
   cruelty report's "Where" and its PIN, a caregiver's "pin"). The parts are
   not listed again below it. A map link goes with it: the one the person
   attached, or a search for the address itself. */
const PLACE_KEYS = ['address', 'location', 'city', 'district', 'state', 'pincode', 'pin', 'mapLink'];
const PLACE_LABELS = {
  'PFA-CR': 'Where it is happening', 'PFA-EV': 'Where it would be held', 'PFA-CMP': 'Where it will happen',
  'PFA-CAM': 'College address', 'PFA-CSR': 'Company address', 'PFA-U': 'Address of the applicant'
};
/* the kinds whose address is the place of the thing itself: shown first */
const PLACE_FIRST = new Set(['PFA-CR', 'PFA-EV', 'PFA-CMP']);
const LINKISH = /^https?:\/\/\S+$/i;

function placeOf(record) {
  const f = (record && record.fields) || {};
  const text = (k) => String(f[k] == null ? '' : f[k]).replace(/\s+/g, ' ').trim();
  const line = text('address') || text('location');
  const city = text('city');
  const district = text('district');
  const state = text('state');
  const pin = text('pincode') || text('pin');
  if (!line && !city && !district && !state && !pin) return null;
  const key = (v) => v.toLowerCase().replace(/[^a-z]/g, '');
  const parts = [];
  const seen = [];
  const add = (v) => {
    if (!v) return;
    const k = key(v);
    if (k && seen.some((x) => x === k)) return;
    if (k) seen.push(k);
    parts.push(v);
  };
  add(line);
  add(city);
  /* the district, unless it is the town itself (Kolkata, Kolkata): it is
     what tells the office which unit is nearest */
  add(district && key(district) !== key(city) ? `${district} district` : '');
  const tail = [state, pin].filter(Boolean).join(' ');
  if (tail && !(state && seen.includes(key(state)) && !pin)) parts.push(tail);
  const value = parts.join(', ');
  const given = text('mapLink');
  const map = LINKISH.test(given) ? given
    : LINKISH.test(line) ? line
    : value ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}` : '';
  return { label: PLACE_LABELS[record.kind] || 'Address', value, map, first: PLACE_FIRST.has(record.kind) };
}

/* What the email carries, from a stored submission record. With noMoney,
   none of the fields that say what was paid (a membership keeps them among
   its fields). */
function payloadFor(record, siteUrl, options) {
  const fields = record.fields || {};
  const email = firstOf(fields, /^(e-?mail|email ?address|contactEmail)$/i) || firstOf(fields, /mail/i);
  const name = firstOf(fields, /^(name|full ?name|your ?name|applicantName|contactName)$/i);
  const mobile = firstOf(fields, /^(mobile|phone|whatsapp|telephone|contact ?number)$/i);
  const skip = new Set([email && email.key, name && name.key, mobile && mobile.key].filter(Boolean));
  if (options && options.noMoney) MONEY_KEYS.forEach((k) => skip.add(k));
  const place = placeOf(record);
  if (place) PLACE_KEYS.forEach((k) => skip.add(k));
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
    place,
    attachments: Number(record.attachments) || (Array.isArray(record.attachments) ? record.attachments.length : 0),
    page: record.page || '',
    adminUrl: site ? `${site}/admin.html` : '',
    siteUrl: site,
    replyTo
  };
}

/* Nothing about money, whatever the payload held: no row that names an
   amount, an order or a bank, and none of the payment's own keys. A
   caregiver application's fields never held any; this is the belt. */
const MONEY_ROW = /amount|paid|order id|tracking id|bank ref|payment|\bfee\b|\btotal\b/i;
const MONEY_KEYS = ['payment', 'amount', 'currency', 'orderId', 'trackingId', 'bankReference', 'total', 'paidAt'];
function withoutMoney(payload) {
  const out = Object.assign({}, payload);
  for (const key of MONEY_KEYS) delete out[key];
  out.rows = (Array.isArray(out.rows) ? out.rows : []).filter((r) => r && !MONEY_ROW.test(String(r.label || '')));
  return out;
}

const PAYMENT_LABELS = { 'PFA-CG': 'Payment for a colony caregiver application', 'PFA-MEM': 'Payment for a membership' };

/* The payment, as the payments inboxes are sent it: who paid, how much, and
   the numbers that find it at the bank and at CCAvenue. */
function paymentRows(record) {
  /* a caregiver application keeps it beside the fields; a membership among them */
  const f = (record && record.fields) || {};
  const pay = (record && record.payment) || { amount: f.amount, orderId: f.orderId, trackingId: f.trackingId, bankReference: f.bankReference };
  const n = Number(pay.amount);
  const amount = pay.amount == null || pay.amount === '' ? '' : Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : String(pay.amount);
  return [
    { label: 'Membership', value: kindOf(record) === 'PFA-MEM' ? String(f.tier || '') : '' },
    { label: 'Amount paid', value: amount },
    { label: 'Order ID', value: pay.orderId || '' },
    { label: 'CCAvenue tracking ID', value: pay.trackingId || '' },
    { label: 'Bank reference', value: pay.bankReference || '' }
  ].filter((r) => r.value);
}

/* What one copy carries. */
function copyPayload(record, siteUrl, copy) {
  if (copy === 'application') return Object.assign(withoutMoney(payloadFor(record, siteUrl, { noMoney: true })), { copy });
  const base = payloadFor(record, siteUrl);
  if (copy === 'whole') return Object.assign(base, { copy, rows: base.rows.concat(paymentRows(record)) });
  if (copy === 'payment') {
    const forms = formInboxes();
    return Object.assign(base, {
      copy,
      kindLabel: PAYMENT_LABELS[kindOf(record)] || `Payment: ${base.kindLabel}`,
      rows: paymentRows(record).concat({ label: 'The application', value: forms.length ? `Sent separately to ${forms.join(', ')}` : 'In the admin panel' }),
      place: null,
      /* a receipt: the photograph goes with the application */
      attachments: 0
    });
  }
  return base;
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
  if (!record || !record.reference) return [];
  const copies = copiesOf(record);
  if (!copies.length) return [];
  const followUp = /^[a-z0-9-]{1,20}$/.test(String(record.followUp || '')) ? record.followUp : '';
  const payloads = copies.map(({ copy }) => {
    const payload = copyPayload(record, siteUrl, copy);
    if (followUp) payload.followUp = followUp;
    return payload;
  });
  const outcomes = await Promise.all(copies.map(({ to: address }, i) => CONFIRM.send({
    to: address,
    template: 'submission_forward',
    payload: payloads[i],
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
    const WHAT = {
      application: 'Copy of the application sent to PFA\'s inbox, without the payment.',
      payment: 'Receipt for the payment sent to the payments inbox.'
    };
    for (const [i, outcome] of outcomes.entries()) {
      if (!outcome || outcome.state === 'none' || outcome.reason === 'MAIL_NOT_CONFIGURED') continue;
      const payload = payloads[i];
      const part = payload.followUp ? `forward.${payload.followUp}` : 'forward';
      const messageId = mailer.threadHeaders({ reference: record.reference, threadId: record.threadId }, part).messageId;
      const id = `out-${part.replace('.', '-')}-${crypto.createHash('sha256').update(String(outcome.to), 'utf8').digest('hex').slice(0, 12)}`;
      try {
        await db.collection('submissions').doc(record.reference).collection('messages').doc(id).create({
          id, seq: ORDER.nextSeq(), type: 'email', direction: 'out', party: 'site', to: outcome.to, from: mailer.sender().address,
          subject: `${record.reference}: ${payload.kindLabel} from ${payload.name || 'Someone'}`,
          text: payload.followUp ? 'The photograph, sent to PFA\'s inbox after the first copy went without it.' : WHAT[payload.copy] || 'Copy of the submission sent to PFA\'s inbox.',
          messageId, state: outcome.state, at: payload.followUp ? new Date().toISOString() : at,
          /* the queue row this line stands for, so the panel shows what has
             happened to it since, not what it was when the form answered */
          emailIds: [require('./caregiver-store').emailIdFor('submission_forward', forwardKey(Object.assign({}, record, { followUp }), outcome.to))]
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

module.exports = {
  DEFAULT_INBOX, DEFAULT_PAYMENTS_INBOX, PAID_KINDS, PANEL_ONLY_KINDS, SPLIT_KINDS, panelOnly, isPaid, split, carriesMoney, forPayments,
  paymentInboxes, formInboxes, copiesOf, inboxes, relayInboxes, allInboxes, labelFor, labelIn, payloadFor, placeOf, copyPayload, withoutMoney, forward, forwardKey
};
