'use strict';

/* Every submission, from the form to PFA's inbox and the admin panel.

   Owner, 7 Oct 2026: "need the submissions to work perfectly. it should go
   to gandhim email id. records to be kept in the admin panel."

   Each public form, and each paid application, is driven through the real
   route handlers against an in-memory Firestore (test/_memory-firestore.js,
   which leaves a document out of an ordered query when it lacks the field,
   as Firestore does) and the real mailer, with only the provider's HTTP
   endpoint captured. For every one this holds:

     1. the record is on file under the number the person was given;
     2. the person gets a confirmation;
     3. gandhim@exmpls.sansad.in gets a full copy, Reply-To the sender,
        every field under the form's own wording, photographs attached;
     4. the admin panel's Submissions list shows it.

   The field values are what the real pages sent when filled in by a browser
   on 7 Oct 2026 (careers, report, ask, events, volunteer, CineKind
   nomination, the wall), so a form and this test cannot be talking about
   different fields. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* The admin panel's sign-in, stood in for: the token "test-admin" is a super
   administrator. Installed before anything loads firebase-admin/auth. */
const authPath = require.resolve('firebase-admin/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    getAuth: () => ({
      async verifyIdToken(token) { if (token !== 'test-admin') throw new Error('bad token'); return { uid: 'u1', email: 'admin@pfa.test' }; },
      async getUser() { return { uid: 'u1', email: 'admin@pfa.test', customClaims: { admin: true, role: 'super' } }; }
    })
  }
};

const { memoryFirestore } = require('./_memory-firestore');
const firebase = require('../lib/firebase');
const { encrypt, decrypt, encodeMerchantData, decodeMerchantData } = require('../lib/ccavenue');

const ROOT = path.join(__dirname, '..');
const INBOX = 'gandhim@exmpls.sansad.in';
/* a record of money goes to these two, never to gandhim (owner, 21 Oct 2026) */
const PAY = ['pfadcmho@gmail.com', 'ozairhusain@gmail.com'];
const WORKING_KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const PHOTO = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'media/cinekind-2026/reels/glimpse.jpg')).toString('base64');

const FORMS = {
  /* internship.html (31 Oct 2026) */
  "PFA-VI": {
    "page": "internship.html",
    "data": {
      "name": "Asha Rao",
      "age": "21",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "why": "I feed twelve dogs on my street and want to learn to do it properly, with the law behind me.",
      "work": "B.Com, second year",
      "social": "@asharao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi"
    }
  },
  "PFA-Q": {
    "page": "ask.html",
    "data": {
      "question": "A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon.",
      "topic": "An animal I found or feed",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com"
    }
  },
  "PFA-J": {
    "page": "careers.html",
    "data": {
      "role": "Zonal Head - North North",
      "roleId": "zonal-head",
      "zone": "North North",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "pfaMember": "Yes",
      "unit": "PFA Delhi, volunteer",
      "background": "Five years of rescue work with community animals in my neighbourhood",
      "travel": "Yes",
      "Q1 Poisoning and FIR refusal": "A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon.",
      "Q2 First ninety days": "A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon.",
      "link": "https://www.youtube.com/watch?v=LCwIbbSg-8E",
      "timeToApply": "6 minutes"
    }
  },
  "PFA-CR": {
    "page": "report.html",
    "data": {
      "what": "A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon.",
      "animal": "Dog",
      "urgency": "Happening now",
      "when": "This morning, around 8",
      "accused": "Not known",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com"
    }
  },
  "PFA-EV": {
    "page": "events.html",
    "data": {
      "title": "An adoption drive",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "notes": "A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon."
    }
  },
  "PFA-V": {
    "page": "get-involved.html",
    "data": {
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "title": "Volunteer: Head Office",
      "notes": "Free: This morning, around 8. A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon."
    }
  },
  "PFA-CK": {
    "page": "cinekind.html",
    "data": {
      "nominee": "Kalyan Varma",
      "category": "A film or documentary",
      "work": "Wild Karnataka",
      "link": "https://www.youtube.com/watch?v=LCwIbbSg-8E",
      "why": "A community dog near the vegetable market has a deep wound on its back leg and is limping. It is friendly, eats from the tea stall every morning, and needs a vet to look at it soon.",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com"
    }
  },
  "PFA-S": {
    "page": "wall.html",
    "data": {
      "url": "https://www.youtube.com/watch?v=LCwIbbSg-8E",
      "wall": "Long form, over three minutes",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "email": "tester.pfa@example.com",
      "notes": "Consent given for PFA to show this on The Wall.",
      "mobile": "9876543210"
    }
  },
  /* The microsites (9 Oct 2026). Each is a form like any other: on record,
     confirmed, copied to gandhim, in the panel. */
  "PFA-CAM": {
    "page": "campus.html",
    "data": {
      "college": "Lady Shri Ram College for Women",
      "institution": "A college",
      "desks": "Rescue and first aid, Feeding and water",
      "teamSize": "8 students",
      "faculty": "Yes",
      "facultyName": "Dr Meera Kapoor, Zoology",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "role": "BSc Zoology, second year",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "plan": "A feeding roster for the campus dogs before the winter"
    }
  },
  "PFA-SG": {
    "page": "sgacc.html",
    "data": {
      "offer": "A visit with a group",
      "items": "Blankets and bedding",
      "group": "Class 9, Springdales School",
      "groupSize": "30",
      "when": "A Saturday in November",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "message": "The students have collected blankets for the wards"
    }
  },
  "PFA-CSR": {
    "page": "csr.html",
    "data": {
      "focus": "Rural animal hospitals, Sterilisation for a town",
      "ways": "Employee volunteering",
      "budget": "\u20b910 lakh to \u20b950 lakh",
      "span": "Two to three years",
      "company": "Asha Foods Private Limited",
      "name": "Asha Rao",
      "address": "Office 3, FC Road, Shivajinagar",
      "pincode": "411004",
      "city": "Pune",
      "state": "Maharashtra",
      "district": "Pune",
      "role": "Head of CSR",
      "email": "tester.pfa@example.com",
      "mobile": "9876543210",
      "message": "Our board meets in December to approve next year's projects"
    }
  },
  "PFA-LEG": {
    "page": "legacy.html",
    "data": {
      "interest": "A share of what I leave",
      "name": "Asha Rao",
      "address": "22 Church Street, Shanthala Nagar",
      "pincode": "560001",
      "city": "Bengaluru",
      "state": "Karnataka",
      "district": "Bengaluru (Bangalore) Urban",
      "email": "tester.pfa@example.com",
      "contactBy": "Phone",
      "mobile": "9876543210",
      "message": "Please call after six in the evening"
    }
  },
  "PFA-CMP": {
    "page": "campaign.html",
    "data": {
      "cause": "Cows in need",
      "format": "A birthday or celebration",
      "goalType": "Money",
      "goal": "\u20b925,000",
      "title": "Asha turns thirty for the cows",
      "when": "December 2026",
      "reach": "About 60 friends and family",
      "name": "Asha Rao",
      "address": "8 Tilak Marg, C Scheme",
      "pincode": "302001",
      "city": "Jaipur",
      "state": "Rajasthan",
      "district": "Jaipur",
      "mobile": "9876543210",
      "email": "tester.pfa@example.com",
      "story": "Instead of presents I would like my friends to help the cows"
    }
  },
  "PFA-PRV": {
    "page": "privacy.html",
    "data": {
      "request": "A copy of what PFA holds about me",
      "name": "Asha Rao",
      "address": "House 14, Barakhamba Road, Connaught Place",
      "pincode": "110001",
      "city": "New Delhi",
      "state": "Delhi",
      "district": "New Delhi",
      "email": "tester.pfa@example.com",
      "mobile": "9876543210",
      "references": "PFA-Q-2026-00012",
      "details": "Please send what you hold about my question from March"
    }
  },
  /* units.html (22 Oct 2026): what the page sent when filled in, criterion B */
  "PFA-U": {
    "page": "units.html",
    "data": {
      "unitPlace": "Kundapur",
      "unitDistrict": "Udupi",
      "name": "Asha Rao",
      "address": "12 Main Road, Koteshwara",
      "pincode": "576222",
      "city": "Kundapur",
      "state": "Karnataka",
      "district": "Udupi",
      "mobile": "9876543210",
      "phone2": "0820 252 0000",
      "email": "tester.pfa@example.com",
      "member1": "Meena Iyer, age 41, Advocate \u00b7 Address: 1 Temple Street, Udupi \u00b7 Phone: 9845010001 \u00b7 Email: meena@example.com",
      "member2": "Ravi Shetty, age 38, Farmer \u00b7 Address: 2 Temple Street, Udupi \u00b7 Phone: 9845010002",
      "member3": "Lata Rao, age 52, Teacher \u00b7 Address: 3 Temple Street, Udupi \u00b7 Phone: 9845010003",
      "member4": "Kiran Nayak, age 29, Veterinary doctor \u00b7 Address: 4 Temple Street, Udupi \u00b7 Phone: 9845010004",
      "member5": "Divya Bhat, age 33, Accountant \u00b7 Address: 5 Temple Street, Udupi \u00b7 Phone: 9845010005",
      "member6": "Suresh Pai, age 61, Retired banker \u00b7 Address: 6 Temple Street, Udupi \u00b7 Phone: 9845010006",
      "member7": "Nisha Kamath, age 27, Engineer \u00b7 Address: 7 Temple Street, Udupi \u00b7 Phone: 9845010007",
      "criteria": "B. Rescue work",
      "rescue1": "Animal: Dog \u00b7 Nature of the problem: Hit by a bus near the market, leg fractured \u00b7 Date: 3 January 2026 \u00b7 Action taken: Taken to the vet, treated, and released where she lives",
      "salutation": "Ms.",
      "relation": "Daughter of Ramesh Rao",
      "workingAs": "Teacher",
      "undertaking": "I, Ms. Asha Rao, daughter of Ramesh Rao, resident of 12 Main Road, Koteshwara, Kundapur, Udupi district, Karnataka 576222, and presently working as Teacher, am desirous of forming a Unit of PFA in Kundapur, District Udupi. I agree to this undertaking.",
      "signature": "Asha Rao",
      "signedOn": "22 October 2026"
    }
  }
};

let db;
let sent;
const realFetch = global.fetch;
const ENV = ['PFA_MAIL_API_KEY', 'PFA_MAIL_ENDPOINT', 'PFA_SUBMISSIONS_INBOX', 'PFA_PAYMENTS_INBOX', 'PUBLIC_SITE_URL',
  'CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'CCAVENUE_MODE'];
const saved = {};

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  Object.assign(process.env, {
    PFA_MAIL_API_KEY: 'test-key', PFA_MAIL_ENDPOINT: 'https://mail.test/emails', PUBLIC_SITE_URL: 'https://pfa.test',
    CCAVENUE_MERCHANT_ID: '123456', CCAVENUE_ACCESS_CODE: 'AVXX', CCAVENUE_WORKING_KEY: WORKING_KEY, CCAVENUE_MODE: 'test'
  });
  delete process.env.PFA_SUBMISSIONS_INBOX;
  delete process.env.PFA_PAYMENTS_INBOX;
  db = memoryFirestore();
  firebase._setDbForTests(db);
  require('../lib/routes/admin/records.js')._resetHeal();
  sent = [];
  /* the mail provider, and only the provider: everything up to the HTTP
     request is the real mailer */
  global.fetch = async (url, init) => {
    assert.equal(String(url), 'https://mail.test/emails');
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: 'mail_' + sent.length }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

test.afterEach(() => {
  global.fetch = realFetch;
  firebase._setDbForTests(null);
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function call(handler, { method = 'POST', body, query = {}, headers = {} }) {
  return new Promise((resolve, reject) => {
    const out = { statusCode: 200, headers: {}, raw: '' };
    const response = {
      get statusCode() { return out.statusCode; }, set statusCode(v) { out.statusCode = v; },
      setHeader(n, v) { out.headers[String(n).toLowerCase()] = v; },
      getHeader(n) { return out.headers[String(n).toLowerCase()]; },
      writeHead(code, h) { out.statusCode = code; Object.assign(out.headers, h || {}); },
      end(raw) { out.raw = String(raw || ''); try { out.json = JSON.parse(out.raw); } catch (_) { out.json = null; } resolve(out); }
    };
    const request = { method, url: '/api', query, body, headers: Object.assign({ host: 'pfa.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.' + Math.floor(Math.random() * 200) }, headers) };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

const submit = (kind, data, extra = {}) => call(require('../lib/routes/pfa-submissions'), {
  body: Object.assign({ kind, data, page: FORMS[kind] ? FORMS[kind].page : '', clientRequestId: 'req-' + kind + '-' + Math.random() }, extra)
});

async function adminList() {
  const res = await call(require('../lib/routes/admin/records.js'), { method: 'GET', query: { type: 'submissions', limit: '50' }, headers: { authorization: 'Bearer test-admin' } });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  return (res.json.rows || []).map((r) => r.reference);
}

const toInbox = () => sent.filter((m) => m.to.includes(INBOX));
const toPayments = (address) => sent.filter((m) => m.to.includes(address));
/* a paid record: one copy to each payments inbox, and none to gandhim */
function paidCopies() {
  assert.equal(toInbox().length, 0, 'a record of money never reaches gandhim');
  for (const address of PAY) assert.equal(toPayments(address).length, 1, `one copy to ${address}`);
  return toPayments(PAY[0]);
}

for (const [kind, form] of Object.entries(FORMS)) {
  test(kind + ' from ' + form.page + ': on record, confirmed, in gandhim\'s inbox, in the admin panel', async () => {
    const photos = kind === 'PFA-CR' ? [PHOTO] : undefined;
    const res = await submit(kind, form.data, photos ? { photos } : {});
    assert.equal(res.statusCode, 200, res.raw.slice(0, 400));
    const ref = res.json.reference;
    assert.match(ref, new RegExp('^' + kind + '-\\d{4}-\\d{5}$'));

    const record = db.dump()['submissions/' + ref];
    assert.ok(record, 'the record is on file');
    assert.equal(record.kind, kind);
    assert.ok(Number(record.receivedAtMs) > 0, 'carries the field the panel lists by');

    const confirm = sent.find((m) => m.to.includes('tester.pfa@example.com'));
    assert.ok(confirm, 'the sender is sent a confirmation');
    assert.equal(res.json.confirmation.state, 'sent');

    /* a volunteer application is kept in the panel only (owner, 21 Oct
       2026): the person is confirmed, and nobody at PFA is emailed */
    if (require('../lib/submission-forward').panelOnly({ kind })) {
      assert.deepEqual(sent.filter((m) => !m.to.includes('tester.pfa@example.com')).map((m) => m.to), [], 'no email to anyone at PFA');
      assert.ok((await adminList()).includes(ref), 'the admin panel lists it');
      return;
    }
    const copy = toInbox();
    assert.equal(copy.length, 1, 'one copy to the inbox');
    assert.equal(copy[0].reply_to, 'tester.pfa@example.com', 'Reply answers the sender');
    assert.ok(copy[0].subject.startsWith(ref + ':'), copy[0].subject);
    for (const value of Object.values(form.data)) {
      const v = String(value).slice(0, 60);
      assert.ok(copy[0].text.includes(v), 'the inbox copy carries "' + v + '"');
    }
    assert.doesNotMatch(copy[0].text, /[\u2013\u2014]/, 'no long dashes in the copy');

    if (kind === 'PFA-CR') {
      assert.equal(copy[0].attachments.length, 1, 'the photograph is attached, not only mentioned');
      assert.match(copy[0].attachments[0].filename, new RegExp('^' + ref + '-photo-1\\.jpg$'));
      assert.ok(copy[0].attachments[0].content.length > 1000);
      assert.match(copy[0].text, /What is happening: /, 'the form\'s wording, not the key "what"');
      assert.match(copy[0].text, /Who is doing it: Not known/);
      assert.match(copy[0].text, /attached to this email/);
    } else {
      assert.equal(copy[0].attachments, undefined);
    }

    assert.ok((await adminList()).includes(ref), 'the admin panel lists it');
  });
}

async function pay(form) {
  const create = require('../lib/routes/payment/create');
  const handoff = await call(create, { body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(handoff.statusCode, 200, handoff.raw.slice(0, 300));
  const enc = /name="encRequest" value="([0-9a-f]+)"/.exec(handoff.raw);
  assert.ok(enc, 'handed to CCAvenue');
  const out = decodeMerchantData(decrypt(enc[1], WORKING_KEY));
  const bank = { order_id: out.order_id, merchant_id: '123456', amount: out.amount, currency: 'INR', order_status: 'Success', tracking_id: '31233', bank_ref_no: 'BNK900', payment_mode: 'UPI', status_message: '' };
  const back = await call(require('../lib/routes/payment/response'), { body: { encResp: encrypt(encodeMerchantData(bank), WORKING_KEY) }, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(back.statusCode, 200, back.raw.slice(0, 300));
  return back.raw;
}

const PERSON = { name: 'Asha Rao', mobile: '9876543210', email: 'tester.pfa@example.com', address: '16 MG Road, Lajpat Nagar', city: 'New Delhi', state: 'Delhi', district: 'New Delhi', pincode: '110024' };

test('a paid membership: on record and in the admin panel\'s list, the application in gandhim\'s inbox (no payment in it), the receipt in the payments inboxes', async () => {
  /* owner, 23 Oct 2026: "ensure all caregiver and volunteer and job and
     membership applications go to gandhim email id" */
  const page = await pay(Object.assign({ type: 'membership', tier: 'silver', terms: 'yes' }, PERSON));
  const ref = (page.match(/PFA-MEM-\d{4}-\d{5}/) || [])[0];
  assert.ok(ref, 'the member is shown their number');
  assert.ok(Number(db.dump()['submissions/' + ref].receivedAtMs) > 0, 'without it the panel never lists the membership');
  const application = toInbox();
  assert.equal(application.length, 1, 'gandhim gets the application');
  assert.equal(application[0].subject, `${ref}: Membership from ${PERSON.name}`);
  assert.equal(application[0].reply_to, 'tester.pfa@example.com');
  assert.doesNotMatch(application[0].text, /Amount|Order ID|Bank reference|₹/, 'no payment in it');
  for (const address of PAY) {
    const receipt = toPayments(address);
    assert.equal(receipt.length, 1, `one receipt to ${address}`);
    assert.equal(receipt[0].subject, `${ref}: Payment for a membership from ${PERSON.name}`);
    assert.match(receipt[0].text, /Amount paid: ₹\d/);
  }
  assert.ok(sent.some((m) => m.to.includes('tester.pfa@example.com')), 'the member is written to');
  assert.ok((await adminList()).includes(ref));
});

test('a paid colony caregiver application: on record with its photograph, in gandhim\'s inbox with it attached (no payment in it), the receipt in the payments inboxes, in the panel', async () => {
  /* owner, 23 Oct 2026: "hope all caregiver application goes to gandhim,
     ensure it does. payment receipt to go to others." */
  const docs = await call(require('../lib/routes/caregiver/documents'), { body: { photo: PHOTO } });
  assert.equal(docs.statusCode, 200, docs.raw.slice(0, 300));
  const page = await pay(Object.assign({ type: 'caregiver-application', documents: docs.json.token, animals: '12', notes: 'Feeding them for four years.' }, PERSON));
  const ref = (page.match(/PFA-CG-\d{4}-\d{5}/) || [])[0];
  assert.ok(ref, 'the applicant is shown their number');
  const application = toInbox();
  assert.equal(application.length, 1, 'gandhim gets the application');
  assert.equal(application[0].reply_to, 'tester.pfa@example.com');
  assert.equal(application[0].subject, `${ref}: Colony caregiver application from ${PERSON.name}`);
  assert.equal(application[0].attachments.length, 1);
  assert.match(application[0].attachments[0].filename, new RegExp('^' + ref + '-photograph-1\\.jpg$'));
  assert.match(application[0].text, /Feeding them for four years/);
  assert.doesNotMatch(application[0].text, /Amount paid|Order ID|tracking ID|Bank reference|₹/, 'no payment in it');
  for (const address of PAY) {
    const receipt = toPayments(address);
    assert.equal(receipt.length, 1, `one receipt to ${address}`);
    assert.equal(receipt[0].subject, `${ref}: Payment for a colony caregiver application from ${PERSON.name}`);
    assert.match(receipt[0].text, /Amount paid: ₹\d/);
    assert.equal((receipt[0].attachments || []).length, 0);
  }
  assert.ok((await adminList()).includes(ref));
});

test('a membership filed before 7 Oct 2026, without the listing field, is put back in the panel\'s list', async () => {
  await db.collection('submissions').doc('PFA-MEM-2026-00007').create({
    reference: 'PFA-MEM-2026-00007', kind: 'PFA-MEM', kindLabel: 'Membership', status: 'new',
    fields: { name: 'Older Member', email: 'old@example.com' }, createdAt: '2026-09-20T10:00:00.000Z'
  });
  assert.ok((await adminList()).includes('PFA-MEM-2026-00007'));
  assert.equal(db.dump()['submissions/PFA-MEM-2026-00007'].receivedAtMs, Date.parse('2026-09-20T10:00:00.000Z'));
});

test('the inbox copy still goes, without attachments, when the photographs cannot be read', async () => {
  const mail = require('../lib/caregiver-mail');
  mail._setAttachmentLoader(async () => { throw new Error('storage down'); });
  try {
    const res = await submit('PFA-CR', FORMS['PFA-CR'].data, { photos: [PHOTO] });
    assert.equal(res.statusCode, 200);
    const copy = toInbox();
    assert.equal(copy.length, 1);
    assert.equal(copy[0].attachments, undefined);
    assert.match(copy[0].text, /1 file, in the admin panel/);
  } finally {
    mail._setAttachmentLoader(null);
  }
});

test('every form that sends to PFA is covered here', () => {
  /* A page that sends a kind this file does not drive is a form nobody has
     proved reaches the inbox. */
  const kinds = new Set();
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of html.matchAll(/(?:PFAForms\.submit\(|kind:\s*)'(PFA-[A-Z]+)'/g)) kinds.add(m[1]);
  }
  const covered = new Set(Object.keys(FORMS).concat(['PFA-MEM', 'PFA-CG']));
  assert.deepEqual([...kinds].filter((k) => !covered.has(k)), []);
});

/* ---- the panel's check on the live mail account (lib/routes/admin/mail-check.js) */

const check = (method, body) => call(require('../lib/routes/admin/mail-check.js'), { method, body, headers: { authorization: 'Bearer test-admin' } });

test('the panel says where copies go, and a test email reaches the inbox', async () => {
  const seen = await check('GET');
  assert.equal(seen.statusCode, 200, seen.raw.slice(0, 300));
  assert.equal(seen.json.configured, true);
  assert.deepEqual(seen.json.inboxes, [INBOX], 'forms go to the forms inbox');
  assert.deepEqual(seen.json.paymentInboxes, PAY, 'records of money to the payments pair');
  const res = await check('POST', {});
  assert.equal(res.json.ok, true);
  assert.deepEqual(sent.map((m) => m.to[0]).sort(), [INBOX, ...PAY].sort(), 'the test reaches every inbox that gets copies');
  for (const m of sent) {
    assert.match(m.subject, /^Test from the PFA website/);
    assert.doesNotMatch(m.text, /[\u2013\u2014]/);
  }
});

test('a refused sender is explained in plain words, with what to change', async () => {
  global.fetch = async () => new Response(JSON.stringify({ statusCode: 403, message: 'The peopleforanimalsindia.org domain is not verified. Please, add and verify your domain on https://resend.com/domains', name: 'validation_error' }), { status: 403 });
  const res = await check('POST', {});
  assert.equal(res.json.ok, false);
  assert.match(res.json.results[0].problem, /until the domain is verified/);
  assert.match(res.json.results[0].problem, /PFA_MAIL_FROM/);
});

test('with no mail key the panel says so plainly, and a form is still filed', async () => {
  delete process.env.PFA_MAIL_API_KEY;
  const seen = await check('GET');
  assert.equal(seen.json.configured, false);
  const res = await submit('PFA-Q', FORMS['PFA-Q'].data);
  assert.equal(res.statusCode, 200);
  assert.ok(db.dump()['submissions/' + res.json.reference]);
  assert.equal(res.json.confirmation.state, 'unsent');
});

/* Owner, 8 Oct 2026, of the panel's "No email can leave the site": "i need the
   submissions to go to gandhim". Copies are queued only when email is set up
   at the moment a form is sent, so what arrived while it was not had no copy
   anywhere. The panel lists those and sends them on a press. */
test('submissions that arrived while email was off are listed, and go to gandhim from the panel', async () => {
  const before = await submit('PFA-Q', FORMS['PFA-Q'].data);
  assert.ok(toInbox().some((m) => m.subject.startsWith(before.json.reference)), 'with email on, the copy goes at once');

  const key = process.env.PFA_MAIL_API_KEY;
  delete process.env.PFA_MAIL_API_KEY;
  const res = await submit('PFA-CR', FORMS['PFA-CR'].data, { photos: [PHOTO] });
  assert.equal(res.statusCode, 200);
  const ref = res.json.reference;
  const off = await check('GET');
  assert.equal(off.json.configured, false);
  assert.deepEqual(off.json.missed.map((m) => m.reference), [ref], 'only the one made while email was off');
  assert.equal(off.json.host, 'vercel');
  assert.match(off.json.settingsHelp, /In Vercel/);
  assert.equal(toInbox().some((m) => m.subject.startsWith(ref)), false);

  process.env.PFA_MAIL_API_KEY = key;
  const on = await check('GET');
  assert.deepEqual(on.json.missed.map((m) => m.reference), [ref], 'still listed once email works, until it is sent');
  const go = await check('POST', { action: 'send-missed' });
  assert.equal(go.json.ok, true, JSON.stringify(go.json));
  assert.equal(go.json.sent, 1);
  const copy = toInbox().find((m) => m.subject.startsWith(ref));
  assert.ok(copy, 'the copy reached gandhim');
  assert.equal(copy.attachments.length, 1, 'with its photograph');
  assert.equal(copy.reply_to, FORMS['PFA-CR'].data.email, 'Reply goes to the person who wrote in');

  const after = await check('GET');
  assert.deepEqual(after.json.missed, [], 'no longer listed');
  assert.equal(after.json.recent.find((r) => r.reference === ref).status, 'sent');
  const again = await check('POST', { action: 'send-missed' });
  assert.equal(again.json.tried, 0, 'pressing again sends nothing twice');
  assert.equal(toInbox().filter((m) => m.subject.startsWith(ref)).length, 1);
});

test('on the Firebase deployment the panel names Firebase, not Vercel, as where the mail settings live', async () => {
  process.env.K_SERVICE = 'api';
  try {
    delete process.env.PFA_MAIL_API_KEY;
    const seen = await check('GET');
    assert.equal(seen.json.host, 'firebase');
    assert.match(seen.json.settingsHelp, /npx firebase-tools functions:secrets:set PFA_SMTP_PASS/);
    assert.doesNotMatch(seen.json.settingsHelp, /Vercel/);
  } finally { delete process.env.K_SERVICE; }
});

test('copies refused while the account was wrong go out from the panel once it is right', async () => {
  const realDeliverFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ statusCode: 403, message: 'domain is not verified' }), { status: 403 });
  const res = await submit('PFA-CR', FORMS['PFA-CR'].data, { photos: [PHOTO] });
  assert.equal(res.statusCode, 200, 'the report is filed even though no email could go');
  const listed = await check('GET');
  const row = listed.json.recent.find((r) => r.reference === res.json.reference);
  assert.ok(row, 'the refused copy is listed');
  assert.notEqual(row.status, 'sent');
  assert.match(row.problem, /verified/);

  global.fetch = realDeliverFetch;
  const again = await check('POST', { action: 'resend' });
  assert.equal(again.json.ok, true, JSON.stringify(again.json));
  /* Since 8 Oct 2026 Resend sends every email that did not go, not only
     the copies to the inbox: the person's confirmation, refused by the
     same account, goes too (review C item 2). */
  assert.equal(again.json.sent, 2);
  assert.ok(sent.some((m) => m.to.includes('tester.pfa@example.com') && /PFA-CR/.test(m.subject)), 'the person\'s confirmation went too');
  const copy = toInbox().find((m) => m.subject.startsWith(res.json.reference));
  assert.ok(copy, 'the copy reached the inbox');
  assert.equal(copy.attachments.length, 1, 'with its photograph');
  const after = await check('GET');
  assert.equal(after.json.recent.find((r) => r.reference === res.json.reference).status, 'sent');
});

/* ---- sending through PFA's own mailbox (owner, 7 Oct 2026: "info@peopleforanimalsindia.org
   is ready on godaddy ... all submissions to go to gandhim email id. through info") */

function withMailbox(fn) {
  return async () => {
    const mailer = require('../lib/caregiver-mail');
    const saved2 = { u: process.env.PFA_SMTP_USER, p: process.env.PFA_SMTP_PASS, k: process.env.PFA_MAIL_API_KEY, h: process.env.PFA_SMTP_HOST };
    process.env.PFA_SMTP_USER = 'info@peopleforanimalsindia.org';
    process.env.PFA_SMTP_PASS = 'test-password';
    delete process.env.PFA_MAIL_API_KEY;
    delete process.env.PFA_SMTP_HOST;
    const smtp = { sent: [], hosts: [], fail: {} };
    mailer._setSmtpTransport((options) => ({
      async sendMail(message) {
        smtp.hosts.push(options.host);
        const f = smtp.fail[options.host];
        if (f) throw Object.assign(new Error(f.message), { code: f.code, responseCode: f.responseCode });
        smtp.sent.push({ options, message });
        return { messageId: '<m' + smtp.sent.length + '@pfa>' };
      },
      close() {}
    }));
    global.fetch = async () => { throw new Error('Resend must not be used when the mailbox is set up'); };
    try { await fn(smtp); } finally {
      mailer._setSmtpTransport(null);
      for (const [k, v] of [['PFA_SMTP_USER', saved2.u], ['PFA_SMTP_PASS', saved2.p], ['PFA_MAIL_API_KEY', saved2.k], ['PFA_SMTP_HOST', saved2.h]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}

test('with the GoDaddy mailbox set up, a submission goes to gandhim from info@, Reply to the site, photo attached', withMailbox(async (smtp) => {
  const res = await submit('PFA-CR', FORMS['PFA-CR'].data, { photos: [PHOTO] });
  assert.equal(res.statusCode, 200, res.raw.slice(0, 300));
  assert.equal(res.json.confirmation.state, 'sent');
  const copy = smtp.sent.find((m) => m.message.to === INBOX);
  assert.ok(copy, 'the copy went to gandhim');
  assert.equal(copy.message.from, 'People for Animals <info@peopleforanimalsindia.org>');
  /* the site's mailbox and nothing else (v1.422). It used to be the sender
     first with the mailbox after, so Reply reached them directly and info@
     rode along as a second address anybody could drop. Now the reply arrives
     here, is filed, and is carried on to them as info@. */
  assert.deepEqual(copy.message.replyTo, 'info@peopleforanimalsindia.org');
  assert.ok(!String(copy.message.replyTo).includes('tester.pfa@example.com'),
    'the sender is not addressed directly, so no Reply can leave the record');
  assert.equal(copy.message.attachments.length, 1);
  assert.ok(Buffer.isBuffer(copy.message.attachments[0].content) && copy.message.attachments[0].content.length > 1000);
  assert.equal(copy.options.host, 'smtpout.secureserver.net');
  assert.equal(copy.options.port, 465);
  assert.equal(copy.options.secure, true);
  assert.equal(copy.options.auth.user, 'info@peopleforanimalsindia.org');
  const confirm = smtp.sent.find((m) => m.message.to === 'tester.pfa@example.com');
  assert.ok(confirm, 'the sender is confirmed from the same mailbox');
  assert.match(res.json.confirmation.steps.join(' '), /info@peopleforanimalsindia\.org/, 'the page says to search for the address it really came from');
  assert.ok((await adminList()).includes(res.json.reference));
}));

test('if GoDaddy\'s server cannot be reached, Titan\'s is tried', withMailbox(async (smtp) => {
  smtp.fail['smtpout.secureserver.net'] = { code: 'ETIMEDOUT', message: 'Connection timeout' };
  const res = await submit('PFA-Q', FORMS['PFA-Q'].data);
  assert.equal(res.statusCode, 200);
  assert.deepEqual([...new Set(smtp.hosts)], ['smtpout.secureserver.net', 'smtp.titan.email']);
  assert.ok(smtp.sent.some((m) => m.message.to === INBOX && m.options.host === 'smtp.titan.email'));
}));

test('a wrong mailbox password is explained in plain words, and not retried on the other server', withMailbox(async (smtp) => {
  smtp.fail['smtpout.secureserver.net'] = { code: 'EAUTH', responseCode: 535, message: 'Invalid login: 535 Authentication failed' };
  const res = await check('POST', {});
  assert.equal(res.json.ok, false);
  assert.match(res.json.results[0].problem, /did not accept the mailbox and password/);
  assert.match(res.json.results[0].problem, /third-party email access/);
  assert.deepEqual([...new Set(smtp.hosts)], ['smtpout.secureserver.net'], 'never retried on the other server');
  assert.equal(smtp.hosts.length, res.json.results.length, 'one attempt per inbox, no more');
  const seen = await check('GET');
  assert.equal(seen.json.via, 'smtp');
  assert.equal(seen.json.from, 'People for Animals <info@peopleforanimalsindia.org>');
}));
