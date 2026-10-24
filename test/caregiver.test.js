'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CAREGIVER = require('../lib/caregiver');
const mail = require('../lib/caregiver-mail');
const { parsePaymentRequest } = require('../lib/payment');

const application = {
  name: 'Asha Kumar',
  mobile: '9876543210',
  email: 'asha@example.com',
  address: 'C-25, Shanti Nagar, Block A, Colony Road, New Delhi 110031'
};

test('identifiers are distinguishable and unambiguous to read aloud', () => {
  assert.match(CAREGIVER.createCardId(), CAREGIVER.CARD_ID_PATTERN);
  assert.match(CAREGIVER.createOrderId(), CAREGIVER.ORDER_ID_PATTERN);
  assert.match(CAREGIVER.createShipmentId(), CAREGIVER.SHIPMENT_ID_PATTERN);
  assert.ok(!/[01IO]/.test(CAREGIVER.ALPHABET), 'ambiguous glyphs must not appear in card numbers');
});

test('the application asks for five things and validates every one', () => {
  const parsed = CAREGIVER.parseApplication(application);
  assert.equal(parsed.name, 'Asha Kumar');
  assert.equal(parsed.pin, '110031', 'the PIN is read out of the address, never asked for twice');

  assert.throws(() => CAREGIVER.parseApplication({ ...application, mobile: '1234567890' }), /mobile/i);
  assert.throws(() => CAREGIVER.parseApplication({ ...application, email: 'not-an-email' }), /email/i);
  assert.throws(() => CAREGIVER.parseApplication({ ...application, name: 'A' }), /name/i);
  assert.throws(() => CAREGIVER.parseApplication({ ...application, address: 'C-25, Shanti Nagar' }), /PIN/i);
});

test('mobile numbers normalise to one shape so duplicates cannot slip past', () => {
  ['9876543210', '+91 98765 43210', '09876543210', '91-9876543210'].forEach((input) => {
    assert.equal(CAREGIVER.normaliseMobile(input), '9876543210');
  });
});

test('delivery defaults to the card address and is only asked for when it differs', () => {
  assert.deepEqual(CAREGIVER.parseDeliveryChoice({}), { sameAsCardAddress: true });
  assert.deepEqual(CAREGIVER.parseDeliveryChoice({ deliverElsewhere: 'no' }), { sameAsCardAddress: true });

  const elsewhere = CAREGIVER.parseDeliveryChoice({
    deliverElsewhere: 'yes',
    recipient: 'Meena Rao',
    deliveryAddress: '4 Turner Road, Bandra West, Mumbai 400050'
  });
  assert.equal(elsewhere.sameAsCardAddress, false);
  assert.equal(elsewhere.pin, '400050');
  assert.throws(() => CAREGIVER.parseDeliveryChoice({ deliverElsewhere: 'yes', recipient: 'X' }), /delivery address/i);
});

test('card validity runs three years from issue', () => {
  const { issuedAt, validUntil } = CAREGIVER.computeValidity('2026-08-21T00:00:00.000Z');
  assert.equal(new Date(validUntil).getUTCFullYear() - new Date(issuedAt).getUTCFullYear(), 3);
  assert.equal(CAREGIVER.cardStanding({ status: 'active', validUntil }, '2027-01-01'), 'active');
  assert.equal(CAREGIVER.cardStanding({ status: 'active', validUntil }, '2030-01-01'), 'expired');
  assert.equal(CAREGIVER.cardStanding({ status: 'revoked', validUntil }, '2027-01-01'), 'revoked');
});

test('a shipment can only move forwards, and never out of a terminal state', () => {
  assert.ok(CAREGIVER.canTransition(null, 'order_confirmed'));
  assert.ok(CAREGIVER.canTransition('order_confirmed', 'preparing'));
  assert.ok(CAREGIVER.canTransition('preparing', 'out_for_delivery'), 'skipping ahead is allowed');

  assert.ok(!CAREGIVER.canTransition('dispatched', 'preparing'), 'no walking backwards');
  assert.ok(!CAREGIVER.canTransition('delivered', 'in_transit'), 'delivered is final');
  assert.ok(!CAREGIVER.canTransition('cancelled', 'dispatched'), 'cancelled is final');
  assert.ok(!CAREGIVER.canTransition('preparing', 'preparing'), 'no self-transitions');
  assert.ok(!CAREGIVER.canTransition('preparing', 'teleported'), 'unknown states are rejected');

  assert.ok(CAREGIVER.canTransition('in_transit', 'exception'), 'exits are always reachable');
  assert.ok(CAREGIVER.canTransition('exception', 'out_for_delivery'), 'an exception can be recovered');
  assert.ok(!CAREGIVER.canTransition('exception', 'preparing'), 'but not back to before dispatch');
});

test('only meaningful delivery steps are emailed', () => {
  assert.ok(CAREGIVER.shouldNotify('dispatched'));
  assert.ok(CAREGIVER.shouldNotify('delivered'));
  assert.ok(!CAREGIVER.shouldNotify('in_transit'), 'four courier scans must not send four emails');
  assert.ok(!CAREGIVER.shouldNotify('preparing'));
});

test('the public projection cannot leak the holder', () => {
  const projection = CAREGIVER.publicProjection({
    card: {
      cardId: 'PFA-CCT-ABCD2345',
      name: 'Asha Kumar',
      status: 'active',
      issuedAt: '2026-08-21T00:00:00.000Z',
      validUntil: '2029-08-21T00:00:00.000Z',
      mobile: '9876543210',
      email: 'asha@example.com',
      address: 'C-25, Shanti Nagar',
      tokenHash: 'deadbeef'
    },
    shipment: {
      trackingId: 'PFA-SHP-ABCD2345',
      status: 'dispatched',
      carrier: 'India Post',
      history: [{ status: 'order_confirmed', at: '2026-08-21T00:00:00.000Z' }]
    }
  });

  const serialised = JSON.stringify(projection);
  ['9876543210', 'asha@example.com', 'Shanti Nagar', 'deadbeef'].forEach((secret) => {
    assert.ok(!serialised.includes(secret), `${secret} must never reach a public card page`);
  });
  assert.equal(projection.delivery.statusLabel, 'Dispatched');
});

test('card tokens are stored hashed and compared in constant time', () => {
  const raw = CAREGIVER.createCardToken();
  const stored = CAREGIVER.hashToken(raw);
  assert.notEqual(stored, raw);
  assert.ok(CAREGIVER.safeEqual(stored, CAREGIVER.hashToken(raw)));
  assert.ok(!CAREGIVER.safeEqual(stored, CAREGIVER.hashToken(CAREGIVER.createCardToken())));
  assert.ok(!CAREGIVER.safeEqual(stored, 'short'), 'length mismatch must not throw');
});

test('caregiver shipping cannot be pushed through the generic payment endpoint', () => {
  assert.throws(() => parsePaymentRequest({ type: 'caregiver', amount: '1' }), /card page/i);
});

test('every email template renders with a subject, html and plain text', () => {
  const payloads = {
    card_issued: { name: 'Asha', applicationRef: 'PFA-CG-2026-00001', issuedAt: '2026-08-21', validUntil: '2029-08-21', postTo: ['C-25, Shanti Nagar, Udupi', 'Karnataka 576101'], followUrl: 'https://pfa/t' },
    card_posted: { name: 'Asha', applicationRef: 'PFA-CG-2026-00001', postedAt: '2026-08-25', postTo: ['C-25, Shanti Nagar, Udupi', 'Karnataka 576101'] },
    shipping_paid: { cardId: 'PFA-CCT-ABCD2345', trackingId: 'PFA-SHP-ABCD2345', amount: '100.00', paymentReference: 'TRK1', cardUrl: 'https://pfa/c' },
    shipment_update: { status: 'delivered', statusLabel: 'Delivered', trackingId: 'PFA-SHP-ABCD2345', cardId: 'PFA-CCT-ABCD2345', cardUrl: 'https://pfa/c' }
  };

  Object.keys(payloads).forEach((template) => {
    const rendered = mail.render(template, payloads[template]);
    assert.ok(rendered.subject.length > 5, `${template} needs a subject`);
    assert.ok(rendered.html.includes('<html'), `${template} needs html`);
    assert.ok(rendered.text.length > 20, `${template} needs a text part`);
  });

  assert.throws(() => mail.render('nope', {}), /Unknown email template/);
});

test('email templates escape what they interpolate', () => {
  const rendered = mail.render('card_issued', {
    name: '<script>alert(1)</script>',
    applicationRef: 'PFA-CG-2026-00001',
    issuedAt: '2026-08-21',
    validUntil: '2029-08-21',
    postTo: ['<img src=x onerror=alert(1)>', 'Karnataka 576101']
  });
  assert.ok(!rendered.html.includes('<script>alert'), 'template output must not carry raw markup');
  assert.ok(!rendered.html.includes('<img src=x'), 'nor the address');
});

function loadRenderer() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'caregiver-card.js'), 'utf8');
  const context = {
    window: {}, document: { createElement: () => ({ getContext: () => ({}) }), fonts: null },
    Image: function () {}, Blob, TextEncoder, atob, URL, setTimeout
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.PFACaregiverCard;
}

test('the print-ready PDF is a valid two-page document at true card size', async () => {
  const renderer = loadRenderer();
  const jpeg = fs.readFileSync(path.join(__dirname, 'fixtures', 'card-sample.jpg'));
  /* 85.6 x 54 mm, landscape (ID-1, the owner's template, 24 Oct 2026) at
     600 dpi: 2022 x 1276 pixels */
  const page = { width: 2022, height: 1276, bytes: new Uint8Array(jpeg) };
  const pdf = Buffer.from(await renderer._buildPdf([page, page]).arrayBuffer());
  const text = pdf.toString('latin1');

  assert.ok(text.startsWith('%PDF-1.4'));
  assert.equal((text.match(/\/Type \/Page[^s]/g) || []).length, 2);
  assert.match(text, /\/MediaBox \[0 0 242\.646 153\.071\]/, 'a card turned landscape, at its true size');

  const xrefStart = Number(text.slice(text.lastIndexOf('startxref')).split('\n')[1]);
  const entries = text.slice(xrefStart).split('\n').slice(2).filter((line) => /\d{10} \d{5} n/.test(line));
  assert.equal(entries.length, 8);
  entries.forEach((entry, index) => {
    assert.ok(text.startsWith(`${index + 1} 0 obj`, Number(entry.slice(0, 10))),
      `object ${index + 1} is not at its cross-reference offset`);
  });
});

test('identity fingerprints catch the same person applying twice', () => {
  const asha = CAREGIVER.identityKey('Asha Kumar', '110031');
  assert.equal(CAREGIVER.identityKey('Dr. Asha Kumar', '110031'), asha, 'honorifics are stripped');
  assert.equal(CAREGIVER.identityKey('  asha   KUMAR ', '110031'), asha, 'case and spacing are normalised');
  assert.equal(CAREGIVER.identityKey('Kumar Asha', '110031'), asha, 'name order does not matter');
  assert.notEqual(CAREGIVER.identityKey('Asha Kumar', '560001'), asha, 'a different PIN is a different person');
  assert.notEqual(CAREGIVER.identityKey('Meena Kumar', '110031'), asha, 'a different name is a different person');
});

test('a household key is stable for one address and unique across addresses', () => {
  const a = CAREGIVER.householdKey('C-25, Shanti Nagar, Block A', '110031');
  assert.equal(CAREGIVER.householdKey('c-25  shanti nagar block a', '110031'), a);
  assert.notEqual(CAREGIVER.householdKey('C-26, Shanti Nagar, Block A', '110031'), a);
});


test('photograph resolution thresholds follow print maths, not guesswork', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'photo-editor.js'), 'utf8');
  const context = { window: {}, document: { createElement: () => ({ getContext: () => ({}) }) },
    Image: function () {}, FileReader: function () {}, setTimeout };
  vm.createContext(context);
  vm.runInContext(source, context);
  const editor = context.window.PFAPhotoEditor;
  assert.equal(editor.IDEAL_PX, 638, '54 mm at 300 dpi');
  assert.ok(editor.POOR_PX < editor.IDEAL_PX && editor.POOR_PX > 300);
});

/* ---- the card is the owner's template (24 Oct 2026) ----------------------

   "caregiver card ditto", with PFA_Colony_Caregiver_Card_Template.html, then
   "nothing can be clipped. nothing can overlay nothing else. text/font size
   needs to be same for every card. think like a credit card/ aadhar card
   issuance system. it cannot look and feel different for diff people- no
   matter the length of the name or address." */

/* The renderer in a sandbox with a canvas that records what is drawn. */
function recordingRenderer() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'caregiver-card.js'), 'utf8');
  const PRINT = require('../assets/card-print.js');
  const calls = [];
  function context2d() {
    const state = { font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px' };
    const stack = [];
    const ctx = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'save') return () => stack.push(Object.assign({}, state));
        if (key === 'restore') return () => { const back = stack.pop(); if (back) Object.assign(state, back); };
        if (key === 'measureText') {
          return (text) => {
            const px = Number((/([\d.]+)px/.exec(state.font) || [])[1]) || 10;
            return { width: PRINT.width(text, px) };
          };
        }
        if (key === 'fillText') return (...args) => calls.push({ text: args[0], font: state.font, maxWidth: args[3], fill: state.fillStyle, spacing: state.letterSpacing, align: state.textAlign });
        return () => {};
      },
      set(target, key, value) { target[key] = value; return true; },
      has(target, key) { return key === 'letterSpacing' || key in target; }
    });
    return ctx;
  }
  const canvas = () => ({ width: 0, height: 0, style: {}, getContext: () => context2d() });
  const context = {
    window: {}, document: { createElement: canvas, fonts: null },
    Image: function () { setTimeout(() => this.onerror && this.onerror(), 0); },
    Blob, TextEncoder, atob, URL, setTimeout
  };
  context.self = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'card-fields.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'field-rules.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'card-print.js'), 'utf8'), context);
  vm.runInContext(source, context);
  context.window.PFA_RULES = context.window.PFA_RULES || context.PFA_RULES;
  return { Card: context.window.PFACaregiverCard, calls, canvas };
}

const CARDS = [
  { cardId: 'PFA-CCT-ABCD2345', name: 'Selina Thakur', district: 'Udupi', state: 'Karnataka', issuedOn: '2026-10-24T09:00:00Z' },
  { cardId: 'PFA-CCT-WXYZ6789', name: 'Venkata Subramanian Krishnamurthy', printName: 'Venkata S. Krishnamurthy', district: 'Nawanshahr (Shahid Bhagat Singh Nagar)', state: 'Punjab', issuedOn: '2026-01-02T09:00:00Z' },
  { cardId: 'PFA-CCT-MNPQ2345', name: 'Lakshminarayana Venkataramanappa', district: 'Paschim Medinipur (West Medinipur)', state: 'Dadra and Nagar Haveli and Daman and Diu', issuedOn: '2026-12-31T09:00:00Z' },
  { cardId: 'PFA-CCT-RSTU2345', name: 'Om', district: 'Mumbai', state: 'Maharashtra', issuedOn: '2027-03-09T09:00:00Z' }
];

test('every card is set in the same type at the same sizes, whatever the name, and nothing is pressed narrower', async () => {
  const { Card, calls, canvas } = recordingRenderer();
  const PRINT = require('../assets/card-print.js');
  const layouts = [];
  for (const data of CARDS) {
    calls.length = 0;
    const full = await Card.hydrate(data);
    Card.draw(canvas(), 'front', full, {}, 856, 1);
    layouts.push(calls.map((c) => ({ font: c.font, maxWidth: c.maxWidth, spacing: c.spacing })));
    /* every value fits its line at the fixed size, measured with the font's own widths */
    const values = calls.slice(1).filter((c) => /18\.06|180\.60/.test(c.font) || /px/.test(c.font)).map((c) => c.text);
    for (const row of ['name', 'cardId', 'district', 'state', 'issuedShort']) {
      const line = Card.lineOf(full, row);
      assert.equal(line.ghost, false, `${data.name}: ${row} prints a stand-in`);
      assert.ok(PRINT.fits(line.text), `${data.name}: "${line.text}" does not fit its line`);
      assert.ok(values.includes(line.text), `${data.name}: "${line.text}" was not drawn`);
    }
    assert.deepEqual([...Card.unprintable(full)], [], `${data.name} is ready to print`);
  }
  /* the same drawing instructions, in the same fonts, for every card */
  for (const layout of layouts.slice(1)) assert.deepEqual(layout, layouts[0], 'one card is set differently from another');
  for (const call of layouts[0]) assert.equal(call.maxWidth, undefined, 'no text is pressed into a width');
});

test('a long name prints in the form the reviewer confirmed, and one with no form is not printable', async () => {
  const { Card } = recordingRenderer();
  const confirmed = await Card.hydrate(CARDS[1]);
  assert.equal(Card.lineOf(confirmed, 'name').text, 'Venkata S. Krishnamurthy');
  assert.equal(Card.lineOf(confirmed, 'district').text, 'Nawanshahr', 'the old name in brackets is not printed');
  const ruled = await Card.hydrate(CARDS[2]);
  assert.equal(Card.lineOf(ruled, 'name').text, 'L. Venkataramanappa', 'a card from before printName prints the rule\'s form');
  assert.equal(Card.lineOf(ruled, 'state').text, 'DNH and Daman and Diu');
  const huge = await Card.hydrate({ cardId: 'PFA-CCT-ABCD2345', name: 'Wwwwwwwwwwwwwwwwwwwwwwwwwwwwww', district: 'Udupi', state: 'Karnataka', issuedOn: '2026-10-24' });
  assert.equal(Card.lineOf(huge, 'name').ghost, true, 'shown as a stand-in on a preview');
  assert.deepEqual([...Card.unprintable(huge)], ['name'], 'and refused for printing');
  const preview = await Card.hydrate({ name: 'Selina Thakur', district: 'Udupi', state: 'Karnataka' });
  assert.deepEqual([...Card.unprintable(preview)], ['card number'], 'a card with no number is a preview, never a print');
  assert.equal(Card.lineOf(preview, 'cardId').text, 'Given when issued');
});

test('the front is the template: its words, its rows, its colours and its measured layout', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'caregiver-card.js'), 'utf8');
  assert.match(source, /'COLONY CAREGIVER CARD'/);
  const rows = [...source.matchAll(/\{ label: '([A-Z ]+)', key: '(\w+)' \}/g)].map((m) => m[1]);
  assert.deepEqual(rows, ['NAME', 'ID NUMBER', 'DISTRICT', 'STATE', 'ISSUED ON']);
  for (const words of ['Authorised By:', 'Smt. Maneka Sanjay Gandhi', 'Chairperson, People For Animals']) assert.ok(source.includes(`'${words}'`), words);
  for (const colour of ["PURPLE = '#41308f'", "RULE = '#766b6b'", "FRAME = '#7768ba'", "EDGE = '#807979'"]) assert.ok(source.includes(colour), colour);
  assert.match(source, /heading: \{ x: 50\.33, y: 74\.38, size: 47, track: 0\.705 \}/, 'the heading, as the template lays it out');
  assert.match(source, /value: \{ x: 252\.97, drop: 26\.5, size: 18\.06/, 'the values, at the template\'s size');
  assert.match(source, /photo: \{ x: 578\.06, y: 117\.53, w: 168\.34, h: 232\.06, round: 0\.14 \}/, 'the photograph\'s frame, corners and all');
  assert.match(source, /var CARD = \{ w: 85\.6, h: 54 \}/, 'ID-1, landscape');
  assert.ok(!/maxWidth|fitText|measureText\(text\)\.width > /.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'nothing shrinks or squeezes text to fit');
  assert.ok(!/QR|qr\b|SIGNATURE/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'the template has no QR code and no signature image');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'media', 'caregiver-card-back.png')), 'the back, as the template carries it');
});

test('the date prints as the template prints it, and the card carries no expiry', async () => {
  const { Card } = recordingRenderer();
  const full = await Card.hydrate({ cardId: 'PFA-CCT-ABCD2345', name: 'Selina Thakur', district: 'Udupi', state: 'Karnataka', issuedOn: '2026-10-24T09:00:00Z' });
  assert.equal(Card.lineOf(full, 'issuedShort').text, '24/10/2026');
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'caregiver-card.js'), 'utf8');
  assert.ok(!/VALID|Valid until|validUntil/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')), 'no validity is printed on the card');
});
