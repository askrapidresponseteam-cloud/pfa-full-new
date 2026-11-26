'use strict';

/* One signature, everywhere (owner, 26 Nov 2026, with MG-Sign-Vector-Clean.svg:
   "clean sign. pls use this everywhere. remove all other versions of sign
   from every place. surgical removal", then "do an enterprise grade
   implementation and update"). scripts/build-signature.js makes every
   picture from the one master; lib/signature-vault.js retires the earlier
   ones in the collection. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const B = require('../scripts/build-signature.js');
const V = require('../lib/signature-vault');
const { memoryFirestore } = require('./_memory-firestore.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sizeOf = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colourType: b[25] }; };

test('the master is the clean signature as it came: one path, its own ink', () => {
  const master = read('scripts/source/MG-Sign-Vector-Clean.svg');
  assert.match(master, /<title>Maneka Sanjay Gandhi<\/title>/);
  const ink = B.inkOf(master);
  assert.equal(ink.fill, '#193b84');
  assert.ok(ink.d.length > 10000);
});

test('every picture is made from the master, at the size its place has always drawn, with a clear ground', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-signature.js'), '--check'], { stdio: 'pipe' });
  const want = { 'lib/letter-art/signature.png': [2748, 748], 'assets/certificates/signature.png': [504, 146], 'assets/certificates/signature-print.png': [1512, 438] };
  for (const [f, [w, h]] of Object.entries(want)) {
    const s = sizeOf(f);
    assert.deepEqual([s.w, s.h], [w, h], f);
    assert.equal(s.colourType, 6, `${f} has a see-through ground`);
  }
  /* the letters' maths keeps its shape */
  assert.match(read('lib/letters.js'), /signature: 1374 \/ 374/);
  const ink = B.inkOf(read('scripts/source/MG-Sign-Vector-Clean.svg'));
  const svg = read('assets/certificates/signature.svg');
  assert.ok(svg.includes(`d="${ink.d}"`), 'the cards’ vector is the master’s');
  assert.match(svg, /viewBox="0 0 1512 438"/);
  assert.ok(!/<rect/.test(svg), 'without its white ground');
  const design = read('scripts/source/PFA-Certificate.html');
  const sig = design.slice(design.indexOf('<div class="signature">'), design.indexOf('</svg>', design.indexOf('<div class="signature">')));
  assert.ok(sig.includes(`d="${ink.d}"`), 'the certificate design carries the master');
  assert.ok(!/data:image/.test(sig), 'and not the picture it had');
});

test('no other signature is left: the old caregiver card one gone, the certificate build no longer makes one', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'media', 'pfa-signature.png')));
  const art = read('scripts/build-certificate-art.js');
  assert.doesNotMatch(art, /screenshot\(\{ path: SIG_OUT/);
  assert.doesNotMatch(art, /screenshot\(\{ path: SIG_PRINT_OUT/);
  assert.match(art, /if \(require\.main === module\) main\(\)/, 'reading it never runs it');
  /* every place that draws a signature reads one of the made files */
  assert.match(read('assets/certificate.js'), /assets\/certificates\/signature\.png/);
  assert.match(read('assets/caregiver-card.js'), /assets\/certificates\/signature-print\.png/);
  assert.match(read('assets/member-card.js'), /assets\/certificates\/signature-print\.png/);
  assert.match(read('lib/routes/signature.js'), /\/assets\/certificates\/signature\.svg/);
});

test('the collection: signatures and choices from before are retired, never drawn or chosen; one added after is used', async () => {
  const db = memoryFirestore();
  const col = db.collection(V.COLLECTION);
  const before = '2026-11-22T08:00:00.000Z';
  const after = '2026-11-27T08:00:00.000Z';
  await col.doc('sig-with-name').set({ name: 'With name', addedAt: before, box: {} });
  await col.doc('sig-clean-navy').set({ name: 'Clean, navy', addedAt: after, box: {} });
  await col.doc('use-letter').set({ id: 'with-name', name: 'With name', colour: '#0e33a6', png: Buffer.from('old').toString('base64'), w: 10, h: 3, updatedAt: before });
  await col.doc('use-card').set({ id: 'clean-navy', name: 'Clean, navy', colour: '#193b84', png: Buffer.from('new').toString('base64'), w: 10, h: 3, updatedAt: after });
  assert.equal(await V.pictureFor(db, 'letter'), null, 'the old choice is not drawn: the clean built-in is');
  assert.equal((await V.pictureFor(db, 'card')).png.toString(), 'new');
  const list = await V.list(db);
  assert.deepEqual(list.signatures.map((s) => s.name), ['Clean, navy']);
  assert.equal(list.retired, 1);
  assert.deepEqual(Object.keys(list.using), ['card']);
  const r = await V.use(db, 'a@pfa', 'letter', 'with-name', '#193b84', 'data:image/png;base64,AAAA', Date.parse(after));
  assert.equal(r.ok, false);
  assert.match(r.message, /retired on 26 Nov 2026/);
  assert.ok((await col.doc('sig-with-name').get()).exists, 'retired, not deleted: the record of what was');
});

test('letters type her name under the clean signature, which no longer carries it', async () => {
  const L = require('../lib/letters');
  const PDFDocument = require('pdfkit');
  const drawn = [];
  const real = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function (s, ...r) { drawn.push(String(s)); return real.call(this, s, ...r); };
  try {
    const v = L.check({ kind: 'general', subject: 'A test', body: 'Words.', recipient: 'Someone' }, Date.now(), false).values;
    assert.equal(v.signName, 'Maneka Sanjay Gandhi');
    await L.pdfOf(v, {});
    assert.ok(drawn.join('').includes('Maneka Sanjay Gandhi'));
    drawn.length = 0;
    await L.pdfOf(L.check({ kind: 'general', subject: 'A test', body: 'Words.', recipient: 'Someone', signName: '' }, Date.now(), false).values, {});
    assert.ok(!drawn.join('').includes('Maneka Sanjay Gandhi'), 'emptied, none');
  } finally { PDFDocument.prototype.text = real; }
  assert.match(read('assets/admin-letters.js'), /Name under the signature/);
});
