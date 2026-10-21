'use strict';

const { cleanText } = require('./ccavenue');
const RULES = require('../assets/field-rules.js');

/* A donation given as a gift (owner, 8 Oct 2026, after the old site's
   make-a-gift.html): the person it is for receives a Certificate of
   Appreciation signed by Smt. Maneka Sanjay Gandhi, posted to them. As on
   the old site, only a gift of Rs 1,000 or more comes with a certificate.
   Rupees only: the certificate goes by post from Delhi, and a dollar gift
   goes through PayPal, which carries none of these details. */
const GIFT_MIN_INR = 1000;
const GIFT_OCCASIONS = [
  'Birthday', 'Anniversary', 'Wedding', 'A new baby', 'Festival', 'Thank you', 'In memory'
];
/* The occasion is optional. It used to default to "Just because", which the
   person never chose and which then appeared on the check screen, the
   receipt and PFA's copy as though they had (owner, 21 Oct 2026: "what
   nonsense is just becoz?"). No occasion chosen is now no occasion, an empty
   string, and nothing is printed for it. */

function parseGift(body, currency, amount) {
  if (String(body.gift || '').trim().toLowerCase() !== 'yes') return null;
  if (currency !== 'inr') throw new Error('A gift with a certificate is given in rupees.');
  if (Number(amount) < GIFT_MIN_INR) throw new Error('A gift of ₹1,000 or more comes with a certificate. Choose ₹1,000 or more.');
  const check = (field, opts) => {
    const error = RULES.checkField(field, body[field], opts);
    if (error) throw new Error(error);
    return RULES.normaliseField(field, body[field]);
  };
  const to = check('giftTo', { required: true, emptyMessage: 'Add the name of the person the gift is for.' });
  const address = check('giftAddress', { required: true, emptyMessage: 'Add the address the certificate should be posted to.' });
  const pin = check('giftPin', { required: true, emptyMessage: 'Add the PIN code the certificate should be posted to.' });
  const occasionValue = cleanText(body.giftOccasion, 40);
  const occasion = GIFT_OCCASIONS.includes(occasionValue) ? occasionValue : '';
  const email = check('giftEmail', { required: false });
  return { to, address, pin, occasion, email };
}

const DONATION_CAUSES = new Set([
  'Where it is needed most',
  'Hospitals',
  'Rescue',
  'Legal work',
  'Learning'
]);

// USD figures are placeholder starting points (rough INR conversion, rounded).
// PFA should confirm final USD pricing before this goes live.


// The Colony Animal Colony Caregiver Card itself is never sold. This is the flat
// printing and delivery charge for people who also want the physical card;
// the digital card is issued free through /api/caregiver-issue.
const CAREGIVER_SHIPPING_PRICE = '100.00';
/* The colony caregiver card is not issued on payment. The fifty rupees
   confirms the application and buys it an application number; a named
   person at PFA reads it and decides. */
const CAREGIVER_APPLICATION_FEE = '50.00';

const AMOUNT_BOUNDS = {
  inr: { min: 1, max: 10000000, label: '₹1 and ₹1,00,00,000' },
  usd: { min: 1, max: 100000, label: '$1 and $100,000' }
};

function parseCurrency(body) {
  const value = String(body.currency || 'inr').trim().toLowerCase();
  if (!['inr', 'usd'].includes(value)) throw new Error('Choose INR or USD.');
  return value;
}

function parseAmount(value, label = 'Amount', currency = 'inr') {
  const raw = String(value == null ? '' : value).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw)) throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  const amount = Number(raw);
  const bounds = AMOUNT_BOUNDS[currency] || AMOUNT_BOUNDS.inr;
  if (!Number.isFinite(amount) || amount < bounds.min || amount > bounds.max) {
    throw new Error(`${label} must be between ${bounds.label}.`);
  }
  return amount.toFixed(2);
}

function requiredCustomer(body) {
  /* This used to accept any ten digits, which let 0000000000 through on the
     donation path while the caregiver path was already strict.
     Both now go through the same rule file the browser uses, and the name is
     stored in Title Case. */
  const parsed = RULES.parseFields(body, [
    ['name', { required: true, emptyMessage: 'Enter your name.' }],
    ['mobile', { required: true, emptyMessage: 'Enter a 10-digit Indian mobile number.' }],
    /* Required for every payment (owner, 16 Sep 2026): the receipt, the
       welcome letter and the application number all go to it, and it is how
       PFA keeps track of who paid for what. */
    ['email', { required: true, emptyMessage: 'Enter your email, so your receipt and confirmation reach you.' }]
  ]);
  if (!parsed.ok) throw new Error(parsed.field === 'email' && cleanText(body.email, 10) ? 'Enter a valid email address.' : parsed.message);
  return { name: parsed.values.name.slice(0, 100), mobile: parsed.values.mobile, email: parsed.values.email };
}

/* The PAN a donor gives so their gift can carry an 80G certificate.

   It was typed into donate.html, checked there, posted here, and dropped:
   parseDonation never read body.pan, so the customer record never carried
   one. lib/routes/payment/response.js puts cleanText(customer.pan, 12) on the
   receipt and caregiver-mail only writes "including for your 80G certificate"
   when a PAN is present, so both were reading a field nothing ever wrote.
   Optional, and checked by the same rule the browser now applies. */
function panField(body) {
  if (!cleanText(body.pan, 20)) return '';
  const error = RULES.checkField('pan', body.pan, { required: false });
  if (error) throw new Error(error);
  return RULES.normaliseField('pan', body.pan);
}

/* A field that must read as a place or address: checked by the shared rule
   and stored in Title Case. */
function placeField(body, field, opts) {
  const error = RULES.checkField(field, body[field], opts);
  if (error) throw new Error(opts.emptyMessage && !cleanText(body[field], 10) ? opts.emptyMessage : error);
  return RULES.normaliseField(field, body[field]);
}

function acceptedTerms(body) {
  return ['yes', 'accepted', 'true', '1', 'on'].includes(String(body.terms || '').toLowerCase())
    || ['yes', 'accepted', 'true', '1', 'on'].includes(String(body.termsAccepted || '').toLowerCase());
}

function parseType(body) {
  const value = String(body.type || body.paymentType || '').trim().toLowerCase();
  if (!['donate', 'caregiver', 'caregiver-application', 'membership'].includes(value)) {
    throw new Error('This payment flow is not enabled. Store purchases remain separate from CCAvenue.');
  }
  return value;
}


function parseDonation(body) {
  const customer = requiredCustomer(body);
  const currency = parseCurrency(body);
  const address = placeField(body, 'address', { required: true, emptyMessage: 'Enter your address.' });
  const causeValue = cleanText(body.cause, 80);
  const cause = DONATION_CAUSES.has(causeValue) ? causeValue : 'Where it is needed most';
  const pan = panField(body);
  if (!acceptedTerms(body)) throw new Error('Accept the gift and receipt terms to continue.');
  const amount = parseAmount(body.amount, 'Donation amount', currency);
  const gift = parseGift(body, currency, amount);
  return {
    /* The PAN travels on the customer record, which is what the receipt
       reads. It is never put in merchantValues: CCAvenue has no business
       with a donor's tax number. Nor, for a gift, the recipient's address:
       it stays on the transaction and the record, and goes to PFA's inbox. */
    type: 'donate', amount, currency, customer: { ...customer, address, pan },
    metadata: Object.assign({ cause, donationAmount: Number(amount) }, gift ? { gift } : {}),
    merchantValues: {
      currency: currency.toUpperCase(), language: 'EN', billing_name: customer.name, billing_tel: customer.mobile,
      billing_email: customer.email, billing_address: address, merchant_param1: cause,
      merchant_param2: gift ? 'PFA Gift' : 'PFA Donation', merchant_param3: 'donate', merchant_param4: 'PFA Website'
    }
  };
}


/* The application fee. What is validated here is what a reviewer will need to
   act on it: who they are, how to reach them, and which colony. Nothing about
   a card is decided by paying - the fifty rupees confirms the application and
   buys it a number, and a named person at PFA decides from there.

   Uses the same helpers as the donation path, so the two cannot disagree about
   what a valid mobile number or a valid address is. */
function parseCaregiverApplication(body) {
  const customer = requiredCustomer(body);
  const address = placeField(body, 'address', { required: true, emptyMessage: 'Tell us which colony or locality you feed in.' });
  const city = placeField(body, 'city', { required: true, emptyMessage: 'Tell us the city or town.' });
  /* District and state print on the card itself, so they are structured
     fields rather than read out of free text. The same geography the donate
     flow validates against. */
  const state = placeField(body, 'state', { required: true, emptyMessage: 'Pick your state.' });
  const district = placeField(body, 'district', { required: true, emptyMessage: 'Pick your district.' });
  /* "Roughly how many animals" is a count, and was stored as whatever text
     arrived. The shared rule reads the digits out of it and refuses an entry
     with no digits at all, so the reviewer gets a number or nothing. */
  const animalsError = RULES.checkField('animals', body.animals, { required: false });
  if (animalsError) throw new Error(animalsError);
  const animals = RULES.normaliseField('animals', body.animals);
  /* Tidied rather than judged: it is optional free text, and the textarea
     already caps it at 1200. */
  const notes = RULES.normaliseField('notes', body.notes).slice(0, 1200);
  /* The photograph was sent to /api/caregiver/documents first and is held
     under this token until the fee clears. No token, no application: a card
     cannot be printed without a face. The proof of address is no longer
     asked for; the address and district the applicant gives are what the
     reviewer checks. */
  const documents = cleanText(body.documents, 48);
  if (!/^[a-f0-9]{48}$/.test(documents)) {
    throw new Error('Attach your photograph before paying.');
  }

  return {
    type: 'caregiver-application',
    amount: CAREGIVER_APPLICATION_FEE,
    currency: 'inr',
    customer: { ...customer, address, city, district, state },
    metadata: { address, city, district, state, animals, notes, documents },
    merchantValues: {
      currency: 'INR', language: 'EN',
      billing_name: customer.name, billing_tel: customer.mobile, billing_email: customer.email,
      billing_address: address, billing_city: city,
      merchant_param1: 'Colony caregiver application',
      merchant_param2: city,
      merchant_param3: 'caregiver-application',
      merchant_param4: animals ? `animals=${animals}` : 'PFA Website'
    }
  };
}

/* Membership. The five tiers the old site's Join Now page offered, kept
   to the rupee, with what each one sends. The tier is a key and the amount
   is looked up here: the form carries no price, so a price is not a thing
   the browser can change. The kit needs an address; a member abroad gets no
   kit (the old page said so: the shipping would be better spent on animals)
   and pays the same, which is what the terms say. */
const MEMBERSHIP_TIERS = {
  student:  { label: 'Student membership',  amount: 500,   kit: [] },
  silver:   { label: 'Silver membership',   amount: 1000,  kit: ['Using Laws to Save Animals, the book'] },
  golden:   { label: 'Golden membership',   amount: 2500,  kit: ['A PFA T-shirt', 'Keep Your Dog Vegetarian, the book'] },
  platinum: { label: 'Platinum membership', amount: 5000,  kit: ['A PFA T-shirt', 'A PFA wristband', 'Keep Your Dog Vegetarian, the book', 'Heads and Tails, the book', 'Receipt and tax exemption certificate'] },
  lifetime: { label: 'Lifetime membership', amount: 10000, kit: ['A PFA T-shirt', 'A PFA wristband', 'A set of PFA books', 'Receipt and tax exemption certificate'] }
};

function parseMembership(body) {
  const customer = requiredCustomer(body);
  const tierKey = cleanText(body.tier, 20).toLowerCase();
  const tier = MEMBERSHIP_TIERS[tierKey];
  if (!tier) throw new Error('Choose a membership.');
  const address = placeField(body, 'address', { required: true, emptyMessage: 'Enter the address your card and kit should go to.' });
  const city = placeField(body, 'city', { required: true, emptyMessage: 'Tell us the city or town.' });
  const state = placeField(body, 'state', { required: true, emptyMessage: 'Pick your state.' });
  const district = placeField(body, 'district', { required: true, emptyMessage: 'Pick your district.' });
  if (!acceptedTerms(body)) throw new Error('Accept the membership terms to continue.');
  return {
    type: 'membership',
    amount: tier.amount,
    currency: 'inr',
    customer: { ...customer, address, city, district, state },
    metadata: { tier: tierKey, tierLabel: tier.label, kit: tier.kit, address, city, district, state },
    merchantValues: {
      currency: 'INR', language: 'EN',
      billing_name: customer.name, billing_tel: customer.mobile, billing_email: customer.email,
      billing_address: address, billing_city: city,
      merchant_param1: tier.label,
      merchant_param2: city,
      merchant_param3: 'membership',
      merchant_param4: tierKey
    }
  };
}

function parsePaymentRequest(body) {
  const type = parseType(body);
  if (type === 'donate') return parseDonation(body);
  /* Colony caregiver shipping has its own endpoint, /api/caregiver/order, which owns
     the address and the price. Nothing reaches CCAvenue through this path. */
  if (type === 'caregiver-application') return parseCaregiverApplication(body);
  if (type === 'membership') return parseMembership(body);
  if (type === 'caregiver') {
    throw new Error('Order a printed Colony Caregiver Card from your card page.');
  }
  /* Every accepted type is handled above. Reaching here means parseType let
     something through, which would be a bug rather than a request to serve. */
  throw new Error('That is not something this site takes payment for.');
}

module.exports = {
  AMOUNT_BOUNDS,
  MEMBERSHIP_TIERS,
  CAREGIVER_SHIPPING_PRICE,
  CAREGIVER_APPLICATION_FEE,
  parseCaregiverApplication,
  DONATION_CAUSES,
  GIFT_MIN_INR,
  GIFT_OCCASIONS,
  parseGift,
  parseAmount,
  parseCurrency,
  parsePaymentRequest,
  parseType
};
