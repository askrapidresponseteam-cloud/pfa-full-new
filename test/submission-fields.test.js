'use strict';

/* The per-kind spec in lib/submission-fields.js, held to two things.

   First, that it still matches the markup. A list of allowed choices written
   out a second time is a list that drifts, and the day it drifts is the day
   the form offers an option the API refuses. So every `options` list here is
   read back off the page it came from and compared.

   Second, that the API actually enforces it. Before the spec existed nothing
   was required: an empty POST filed a cruelty report with no account of what
   happened and nobody's name, and "animal": "Dragon" was stored as readily as
   "Dog", because a <select> is a convenience and not a boundary. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const FIELDS = require('../lib/submission-fields.js');
const { PLACE } = require('./_place');
const { createHandler } = require('../lib/routes/pfa-submissions')._private;

const ROOT = path.join(__dirname, '..');
const page = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* ---- reading the markup ------------------------------------------------- */

function selectBlock(html, id) {
  const open = new RegExp(`<select[^>]*\\b(?:id|name)="${id}"[^>]*>`, 'i').exec(html);
  assert.ok(open, `no <select> called ${id} on the page`);
  const from = open.index + open[0].length;
  const to = html.indexOf('</select>', from);
  assert.ok(to > -1, `the <select> called ${id} is never closed`);
  return html.slice(from, to);
}

/* What a browser would submit for each option: the value attribute when there
   is one, the text when there is not. The empty placeholder ("Choose") is not
   an answer and is left out. */
function optionValues(block) {
  const out = [];
  const re = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(block))) {
    const value = /value="([^"]*)"/i.exec(m[1]);
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    const submitted = value ? value[1] : text;
    if (submitted) out.push(submitted);
  }
  return out;
}

/* wall.html sends the option's wording rather than its value, so that the
   panel reads "Short form, under a minute" and not "short". */
function optionLabels(block) {
  const out = [];
  const re = /<option([^>]*)>([\s\S]*?)<\/option>/gi;
  let m;
  while ((m = re.exec(block))) {
    const value = /value="([^"]*)"/i.exec(m[1]);
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (value && value[1] && text) out.push(text);
  }
  return out;
}

function radioValues(html, name) {
  const out = [];
  const re = new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    if (!/type="radio"/i.test(m[0])) continue;
    const value = /value="([^"]*)"/i.exec(m[0]);
    if (value && value[1]) out.push(value[1]);
  }
  return out;
}

/* Where each spec'd choice comes from in the page it belongs to. */
const MARKUP = {
  'PFA-CR': { animal: ['select', 'animal'], urgency: ['select', 'urgency'] },
  'PFA-Q': { topic: ['select', 'topic'] },
  'PFA-J': { pfaMember: ['radio', 'member'], travel: ['radio', 'travel'], roleId: ['radio', 'roleId'], level: ['radio', 'level'] },
  'PFA-S': { wall: ['labels', 'wallWhich'] },
  'PFA-EV': { title: ['select', 'evKind'] },
  'PFA-CK': { category: ['select', 'ckCategory'] },
  /* the microsites (9 Oct 2026): every choice is a card, a dressed radio */
  'PFA-CAM': { faculty: ['radio', 'faculty'], institution: ['radio', 'institution'] },
  'PFA-CSR': { budget: ['radio', 'budget'], span: ['radio', 'span'] },
  'PFA-LEG': { interest: ['radio', 'interest'], contactBy: ['radio', 'contactBy'] },
  'PFA-CMP': { cause: ['radio', 'cause'], format: ['radio', 'format'], goalType: ['radio', 'goalType'] },
  'PFA-SG': { offer: ['radio', 'offer'] },
  'PFA-PRV': { request: ['radio', 'request'] },
  'PFA-U': { salutation: ['radio', 'salutation'], criteria: ['radio', 'criteria'] }
};

test('every list of choices the API enforces is the list the page offers', () => {
  for (const [kind, spec] of Object.entries(FIELDS.KINDS)) {
    const options = spec.options || {};
    for (const field of Object.keys(options)) {
      const where = MARKUP[kind] && MARKUP[kind][field];
      assert.ok(where, `${kind}.${field} has an options list but this test does not know where it comes from`);
      const html = page(spec.page);
      const [how, id] = where;
      const found = how === 'radio' ? radioValues(html, id)
        : how === 'labels' ? optionLabels(selectBlock(html, id))
          : optionValues(selectBlock(html, id));
      assert.deepEqual([...options[field]].sort(), [...found].sort(),
        `${kind}.${field} and ${spec.page} disagree about what may be chosen`);
    }
  }
});

test('every kind in the spec is a kind the server accepts, on a page that exists', () => {
  const S = require('../lib/submissions.js');
  for (const [kind, spec] of Object.entries(FIELDS.KINDS)) {
    assert.ok(S.KIND_LABELS[kind], `${kind} is specified but the server would refuse it`);
    assert.ok(fs.existsSync(path.join(ROOT, spec.page)), `${kind} names ${spec.page}, which is not there`);
  }
});

test('every refusal names its field and is written for the person reading it', () => {
  for (const [kind, spec] of Object.entries(FIELDS.KINDS)) {
    for (const [field, message] of Object.entries(spec.required || {})) {
      assert.ok(message.length > 8, `${kind}.${field} has no real message`);
      assert.match(message, /[.?]$/, `${kind}.${field}: "${message}" is not a sentence`);
      assert.doesNotMatch(message, /invalid|error|failed/i,
        `${kind}.${field} talks like a stack trace: "${message}"`);
    }
  }
});

/* ---- the API, driven ----------------------------------------------------- */

function fakeDb() {
  const store = new Map();
  const key = (c, id) => `${c}/${id}`;
  const docRef = (c, id) => ({
    id,
    collection: (sub) => ({ doc: (subId) => docRef(`${c}/${id}/${sub}`, subId) }),
    async get() { const d = store.get(key(c, id)); return { exists: Boolean(d), id, data: () => d }; },
    async create(data) {
      if (store.has(key(c, id))) { const e = new Error('exists'); e.code = 6; throw e; }
      store.set(key(c, id), Object.assign({}, data));
    },
    async set(data, opts) {
      const prev = (opts && opts.merge && store.get(key(c, id))) || {};
      store.set(key(c, id), Object.assign({}, prev, data));
    },
    async update(data) { store.set(key(c, id), Object.assign({}, store.get(key(c, id)), data)); }
  });
  return {
    store,
    collection: (c) => ({ doc: (id) => docRef(c, id) }),
    async runTransaction(fn) {
      return fn({ get: (ref) => ref.get(), set: (ref, data, opts) => { ref.set(data, opts); } });
    }
  };
}

function request(body) {
  const r = new EventEmitter();
  r.method = 'POST'; r.query = {}; r.headers = {};
  process.nextTick(() => { r.emit('data', JSON.stringify(body)); r.emit('end'); });
  return r;
}

async function post(handler, body) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b || '{}'); } };
  await handler(request(body), res);
  return res;
}

function handler(db) {
  return createHandler({
    getDb: () => db,
    deliver: async () => ({}),
    isConfigured: () => false,
    now: () => Date.UTC(2026, 7, 23, 10, 0)
  });
}

const REPORT = { email: 'asha@example.com',
  what: 'A man is beating a dog outside the market with a stick.',
  animal: 'Dog',
  urgency: 'Happening now',
  /* where it is: the address block every form carries (24 Oct 2026) */
  address: 'Ashraya Ankadakatte, near the temple',
  pincode: '576222',
  city: 'Kundapur',
  state: 'Karnataka',
  district: 'Udupi',
  name: 'karthik dhanya',
  mobile: '8105250299'
};

test('a report with nothing in it is refused, and spends no reference', async () => {
  const db = fakeDb();
  const res = await post(handler(db), { kind: 'PFA-CR', data: {} });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.fields[0].message, 'Nothing was filled in.');
  assert.equal(db.store.has('counters/submissions'), false, 'a number was issued for an empty report');
});

test('a report missing what the form asked for is refused in the form\'s own words', async () => {
  const db = fakeDb();
  const res = await post(handler(db), { kind: 'PFA-CR', data: { name: 'Karthik Dhanya' } });
  assert.equal(res.statusCode, 422);
  const said = Object.fromEntries(res.body.fields.map((f) => [f.field, f.message]));
  assert.equal(said.what, 'Say what is happening.');
  assert.equal(said.animal, 'Which animal?');
  assert.equal(said.mobile, 'A mobile number to reach you on.');
  assert.equal(said.name, undefined, 'the name was given and must not be complained about');
  assert.equal(db.store.size, 0, 'nothing was written');
});

test('a choice the form never offered is refused, however the request was made', async () => {
  const db = fakeDb();
  const res = await post(handler(db), { kind: 'PFA-CR', data: Object.assign({}, REPORT, { animal: 'Dragon' }) });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.fields[0].field, 'animal');
  assert.equal(db.store.size, 0);

  const urgency = await post(handler(fakeDb()), { kind: 'PFA-CR', data: Object.assign({}, REPORT, { urgency: 'whenever' }) });
  assert.equal(urgency.statusCode, 422);
  assert.equal(urgency.body.fields[0].field, 'urgency');
});

test('a field that is only whitespace counts as not filled in', async () => {
  const res = await post(handler(fakeDb()), { kind: 'PFA-CR', data: Object.assign({}, REPORT, { what: '   \t  ' }) });
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.fields[0].field, 'what');
});

test('a real report goes through, and is stored in its normalised form', async () => {
  const db = fakeDb();
  const res = await post(handler(db), { kind: 'PFA-CR', data: Object.assign({}, REPORT, { mobile: '+91 81052 50299' }) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.reference, /^PFA-CR-2026-\d{5}$/);
  const stored = db.store.get(`submissions/${res.body.reference}`);
  assert.equal(stored.fields.mobile, '8105250299', 'the number is stored one way however it was typed');
  assert.equal(stored.fields.name, 'Karthik Dhanya');
  assert.equal(stored.fields.animal, 'Dog');
});

test('an estimate of how many animals is a number or it is nothing', async () => {
  const R = require('../assets/field-rules.js');
  assert.equal(R.checkField('animals', 'about twenty', {}), 'Use digits only, for example 12.');
  assert.equal(R.checkField('animals', '99999', {}), 'Enter a number below 10000.');
  assert.equal(R.checkField('animals', '14', {}), null);
});

test('a note may be short, but it has to be words', async () => {
  const R = require('../assets/field-rules.js');
  assert.equal(R.checkField('notes', 'Yes, twice.', {}), null, 'a short answer is a real answer');
  assert.equal(R.checkField('notes', '###', {}), 'Use words here, not just numbers or symbols.');
  assert.equal(R.checkField('notes', 'a'.repeat(2001), {}), 'Keep this under 2000 characters.');
});

test('the account of what happened is judged as prose, not merely for length', async () => {
  const R = require('../assets/field-rules.js');
  assert.equal(R.ruleName('what'), 'longText');
  assert.equal(R.ruleName('location'), 'locality');
  assert.equal(R.checkField('what', '123', {}), 'Please write a little more so this can be acted on.');
  assert.equal(R.checkField('what', '1234567890123', {}), 'Use words here, not just numbers or symbols.');
});

test('a caller cannot choose a field name Firestore refuses', async () => {
  /* Firestore reserves any field name matching __.*__ . The keys of `fields`
     came straight from the request, so a caller could pick one and fail a
     write whose reference number had already been issued. */
  const { cleanFields } = require('../lib/routes/pfa-submissions')._private;
  const kept = cleanFields({ name: 'Asha Rao', __type__: 'x', __name__: 'y', __ok: 'z', a__b: 'w' });
  assert.equal(kept.__type__, undefined);
  assert.equal(kept.__name__, undefined);
  assert.equal(kept.name, 'Asha Rao');
  assert.equal(kept.__ok, 'z', 'only the reserved shape is dropped, not every underscore');
  assert.equal(kept.a__b, 'w');

  const db = fakeDb();
  const res = await post(handler(db), { kind: 'PFA-CR', data: Object.assign({ __type__: 'boom' }, REPORT) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.store.get(`submissions/${res.body.reference}`).fields.__type__, undefined);
});

test('the scheduled worker presents a token instead of locking itself out', () => {
  /* functions/index.js built its request with headers: {} while its own
     comment said the worker checks CRON_SECRET, so every nightly run was a
     401 and no caregiver email was ever sent from that deployment. */
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  const call = source.slice(source.indexOf('caregiverEmailWorker'));
  assert.match(call, /authorization: `Bearer \$\{token\}`/, 'the scheduled worker sends no credential');
  assert.match(call, /process\.env\.CRON_SECRET/, 'it does not read the secret it is meant to present');
});

test('The Wall takes a link to the six platforms it is for, and nothing else', () => {
  const base = { wall: 'Short form, under a minute', name: 'Asha Rao', email: 'asha@example.com', ...PLACE };
  const errorsFor = (url) => FIELDS.validate('PFA-S', { ...base, url }).errors;

  for (const good of ['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://vimeo.com/1',
    'https://m.instagram.com/p/x', 'https://fb.watch/abc']) {
    assert.deepEqual(errorsFor(good), [], `${good} was refused`);
  }

  /* The allowlist used to live only in wall.html, so a direct post could put
     any link at all on a page PFA republishes under a name the sender chose. */
  assert.equal(errorsFor('https://evil.example.com/x').length, 1);
  /* And wall.html's own regex was unanchored, so this satisfied the page. */
  const spoofed = errorsFor('https://youtube.com.example.net/x');
  assert.equal(spoofed.length, 1, 'a host merely containing youtube.com was accepted');
  assert.equal(spoofed[0].field, 'url');
});

test('the platforms the API allows are the platforms the page offers', () => {
  /* Two copies of a list drift. wall.html holds one to tell the sender before
     they send; this reads it back and compares. */
  const html = page('wall.html');
  const declared = /var HOSTS = \[([^\]]+)\]/.exec(html);
  assert.ok(declared, 'wall.html no longer declares its host list where this can read it');
  const onThePage = declared[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual([...onThePage].sort(), [...FIELDS.KINDS['PFA-S'].hosts.url].sort(),
    'wall.html and lib/submission-fields.js disagree about what The Wall is for');
});

/* ---- the address, on every form (owner, 24 Oct 2026) ----------------------
   Forwarding Maneka Gandhi: "This is NOT working out. 90% of people filling
   in this rubbish do not give any addresses, not even the city", then "can
   you ensure all the forms have the address clearly captured and sent to
   gandhim email ID" and "filling in the address in mandatory. and it should
   be in the right format. and pincode has to be valid. all field level
   intelligence and validations must exist". The page's block
   (assets/address.js) asks; this is the rule a direct post meets too. */

const ADDRESS_KEYS = ['address', 'pincode', 'city', 'state', 'district'];

test('every form the server knows requires the address, in the order the block asks it', () => {
  for (const kind of Object.keys(FIELDS.KINDS)) {
    const fields = FIELDS.validate(kind, { name: 'Asha Rao', email: 'asha@example.com' }).errors.map((e) => e.field);
    assert.deepEqual(fields.filter((f) => ADDRESS_KEYS.includes(f)), ADDRESS_KEYS, `${kind} takes no address`);
    const placed = FIELDS.validate(kind, { name: 'Asha Rao', email: 'asha@example.com', ...PLACE }).errors.map((e) => e.field);
    assert.deepEqual(placed.filter((f) => ADDRESS_KEYS.includes(f)), [], `${kind} refuses a good address`);
  }
});

test('the server and the page say the same words', () => {
  const src = fs.readFileSync(path.join(ROOT, 'assets', 'address.js'), 'utf8');
  for (const [key, message] of Object.entries(FIELDS.ADDRESS)) {
    assert.ok(src.includes(`${key}: '${message}'`), `assets/address.js says something else for ${key}`);
  }
  assert.ok(src.includes(`addressHere: '${FIELDS.ADDRESS_HERE['PFA-CR']}'`), 'and for where the cruelty is');
  const cr = FIELDS.validate('PFA-CR', Object.assign({}, REPORT, { address: '' })).errors;
  assert.deepEqual(cr, [{ field: 'address', message: 'Add where it is: house or shop, street, area, and a landmark.' }]);
});

test('an address has to be one: a house and a street, not a number, a word or the town again', () => {
  const said = (address) => FIELDS.validate('PFA-Q', { question: 'Is there a vet near the market?', topic: 'Something else',
    name: 'Asha Rao', email: 'asha@example.com', ...PLACE, address }).errors.filter((e) => e.field === 'address').map((e) => e.message)[0] || '';
  assert.equal(said('12'), 'Add the full address: house or building, street and area.');
  assert.equal(said('1234567, 89'), 'Add the street or area by name, not just numbers.');
  assert.equal(said('New Delhi'), 'Add the house or building and the street or area, not just the place name.');
  assert.equal(said('Barakhamba'), 'Add the house or building and the street or area.');
  assert.equal(said('House 14, Barakhamba Road'), '');
  assert.equal(said('https://maps.app.goo.gl/1xIqJuQvCkSlhjYk8'), '', 'a map link is a place too');
});

test('a PIN is six digits, starts 1 to 8, is one India Post uses, and is in the state given', () => {
  const said = (pincode, state) => FIELDS.validate('PFA-Q', { question: 'Is there a vet near the market?', topic: 'Something else',
    name: 'Asha Rao', email: 'asha@example.com', ...PLACE, ...(state ? { state, district: '' } : {}), pincode })
    .errors.filter((e) => e.field === 'pincode').map((e) => e.message)[0] || '';
  assert.equal(said('11000'), 'A PIN code is 6 digits and does not start with 0.');
  assert.equal(said('011000'), 'A PIN code is 6 digits and does not start with 0.');
  assert.equal(said('990000'), 'That is not a PIN code in India. Check the six digits.');
  assert.equal(said('700016'), 'PIN code 700016 is in West Bengal, not Delhi. Check the PIN code or the state.');
  assert.equal(said('403001', 'Kerala'), 'PIN code 403001 is in Goa or Maharashtra, not Kerala. Check the PIN code or the state.');
  assert.equal(said('110 001'), '', 'a space typed in the middle is not a mistake');
  assert.equal(said('744101', 'West Bengal'), '', 'a prefix two states share passes in either');
});

test('a state comes from the list, and the district from that state', () => {
  const errs = (o) => FIELDS.validate('PFA-Q', { question: 'Is there a vet near the market?', topic: 'Something else',
    name: 'Asha Rao', email: 'asha@example.com', ...PLACE, ...o }).errors;
  assert.deepEqual(errs({ state: 'Atlantis' }).map((e) => [e.field, e.message]), [['state', 'Choose the state from the list.']]);
  assert.deepEqual(errs({ district: 'Udupi' }).map((e) => [e.field, e.message]), [['district', 'Choose a district in Delhi.']]);
  /* "North 24 Parganas" is a district, digits and all */
  assert.deepEqual(errs({ state: 'West Bengal', district: 'North 24 Parganas', pincode: '743201', city: 'Barasat' }), []);
});

test('what is stored is tidy: the PIN as digits, the district as the list spells it', async () => {
  const db = fakeDb();
  const res = await post(handler(db), { kind: 'PFA-CR', data: Object.assign({}, REPORT, { pincode: '576 222', district: ' Udupi ' }) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const stored = db.store.get(`submissions/${res.body.reference}`).fields;
  assert.equal(stored.pincode, '576222');
  assert.equal(stored.district, 'Udupi');
  assert.equal(stored.state, 'Karnataka');
  assert.equal(stored.address, 'Ashraya Ankadakatte, Near the Temple');
});
