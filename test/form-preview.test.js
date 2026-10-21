'use strict';

/* The last look before a form is sent (assets/form-preview.js).

   Asked for on 16 Sep 2026: before anything goes, show everything that is
   about to be sent, then ask for the email and mobile to be checked on their
   own, because a wrong one means no confirmation arrives and nobody at PFA
   can get back to the person. These drive the real component in jsdom, both
   as a native <dialog> and as the overlay a browser without one gets, and
   hold every page to calling it before it sends, uploads or pays. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PREVIEW = read('assets/form-preview.js');
const FORMS_JS = read('pfa-forms.js');

const FORM = `
  <form id="f">
    <div class="field"><label for="what">What is happening <small>(say it plainly)</small></label><textarea id="what" name="what">A dog tied up
without water</textarea></div>
    <div class="field"><label for="animal">Animal</label><select id="animal" name="animal"><option value="">Choose</option><option value="Dog" selected>Dog</option></select></div>
    <fieldset><legend>Is it still going on?</legend>
      <label><input type="radio" name="urgency" value="now" checked> Happening now</label>
      <label><input type="radio" name="urgency" value="past"> Past</label></fieldset>
    <div class="field"><label for="name">Your name</label><input id="name" name="name" value="Asha &lt;b&gt;Rao&lt;/b&gt;"></div>
    <div class="field"><label for="mobile">Mobile <span class="opt">(optional)</span></label><input id="mobile" name="mobile" type="tel" value="9876543210"></div>
    <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" value="asha@gmial.com"></div>
    <div class="field" data-preview="skip"><label for="internal">Internal</label><input id="internal" value="never shown"></div>
    <input type="hidden" name="token" value="secret">
    <input type="file" id="photos">
    <label class="consent"><input type="checkbox" id="consent" checked> I have the right to share this</label>
    <button type="submit">Send the report</button>
  </form>`;

function boot({ dialog = 'native', html = FORM } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, { runScripts: 'outside-only', url: 'https://pfa.test/report.html' });
  const w = dom.window;
  const proto = w.HTMLDialogElement && w.HTMLDialogElement.prototype;
  if (dialog === 'native') {
    assert.ok(proto, 'jsdom has a dialog element to stand in for');
    if (typeof proto.showModal !== 'function') proto.showModal = function () { this.setAttribute('open', ''); };
    if (typeof proto.close !== 'function') proto.close = function () { this.removeAttribute('open'); };
  } else if (proto) {
    proto.showModal = undefined;
  }
  w.eval(PREVIEW);
  const d = w.document;
  return { w, d, form: d.getElementById('f'), $: (s) => d.querySelector(s), $$: (s) => [...d.querySelectorAll(s)] };
}
const click = (p, el) => el.dispatchEvent(new p.w.MouseEvent('click', { bubbles: true, cancelable: true }));
const button = (p, text) => p.$$('[data-pfa-preview] button').find((b) => b.textContent.trim() === text);
const tick = () => new Promise((r) => { setImmediate(r); });

test('a likely typo in a big provider is offered as a fix, and a real address is left alone', () => {
  const { w } = boot();
  const s = w.PFAPreview.suggestEmail;
  assert.equal(s('asha@gmial.com'), 'asha@gmail.com');
  assert.equal(s('asha@gmail.con'), 'asha@gmail.com');
  assert.equal(s('asha@gmai.com'), 'asha@gmail.com');
  assert.equal(s('asha@yaho.co.in'), 'asha@yahoo.co.in');
  assert.equal(s('asha@hotmial.com'), 'asha@hotmail.com');
  assert.equal(s('asha@rediffmial.com'), 'asha@rediffmail.com');
  assert.equal(s('ravi@company.con'), 'ravi@company.com');
  for (const fine of ['asha@gmail.com', 'asha@mail.com', 'asha@email.com', 'asha@outlook.in', 'office@peopleforanimalsindia.org', 'a@pfa.org', 'not an email']) {
    assert.equal(s(fine), '', `${fine} was "corrected"`);
  }
  assert.equal(w.PFAPreview.formatMobile('9876543210'), '+91 98765 43210');
  assert.equal(w.PFAPreview.formatMobile('+91 98765 43210'), '+91 98765 43210');
  assert.equal(w.PFAPreview.formatMobile('12345'), '12345');
});

test('everything filled in is listed under the label the person saw, and nothing else', () => {
  const p = boot();
  const rows = p.w.PFAPreview.rowsOf(p.form, { labels: { urgency: 'Still going on' }, extra: [['Photographs', '2 attached'], ['Empty', '']] });
  const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
  assert.equal(byLabel['What is happening'], 'A dog tied up\nwithout water', 'the hint is not part of the label, and the line break is kept');
  assert.equal(byLabel.Animal, 'Dog', 'the chosen option is written as the person read it');
  assert.equal(byLabel['Still going on'], 'Happening now', 'a radio group under its given label, with the choice made');
  assert.equal(byLabel.Mobile, '9876543210', '"(optional)" is not part of the label');
  assert.equal(byLabel.Agreed, 'I have the right to share this');
  assert.equal(byLabel.Photographs, '2 attached');
  assert.ok(!('Internal' in byLabel), 'a field marked data-preview="skip" is not shown');
  assert.ok(!rows.some((r) => /secret/.test(r.value)), 'a hidden field is not shown');
  assert.ok(!('Empty' in byLabel), 'an extra row with no value is not shown');
});

for (const mode of ['native', 'overlay']) {
  test(`${mode}: step 1 shows everything, step 2 the contact details, and only a ticked box sends`, async () => {
    const p = boot({ dialog: mode });
    let result;
    const asked = p.w.PFAPreview.confirm(p.form, { title: 'Check your report before it is sent', send: 'Send the report' }).then((r) => { result = r; });
    const shell = p.$('[data-pfa-preview]');
    assert.ok(shell, 'the preview is open');
    assert.equal(shell.tagName, mode === 'native' ? 'DIALOG' : 'DIV');
    if (mode === 'overlay') assert.equal(shell.getAttribute('aria-modal'), 'true');
    assert.equal(p.d.getElementById(shell.getAttribute('aria-labelledby')).textContent, 'Check your report before it is sent');
    assert.equal(p.d.activeElement, p.$('.pfa-pv__title'), 'focus moves to the heading, so a screen reader hears where it is');
    assert.equal(p.d.documentElement.style.overflow, 'hidden');
    assert.match(shell.textContent, /Asha <b>Rao<\/b>/, 'what was typed is shown as typed');
    assert.equal(shell.querySelector('b'), null, 'and never becomes markup');

    click(p, button(p, 'Continue'));
    assert.match(p.$('.pfa-pv__step').textContent, /Step 2 of 2/);
    assert.equal(p.$('[data-contact="mobile"] .pfa-pv__v').textContent, '+91 98765 43210');
    assert.equal(p.$('[data-contact="email"] .pfa-pv__v').textContent, 'asha@gmial.com');

    let typed = 0;
    p.$('#email').addEventListener('input', () => { typed += 1; });
    click(p, button(p, 'Use asha@gmail.com'));
    assert.equal(p.$('#email').value, 'asha@gmail.com', 'the fix is written into the form itself');
    assert.equal(typed, 1, 'and the page hears it, so its own checks see the new address');
    assert.equal(p.$('[data-contact="email"] .pfa-pv__v').textContent, 'asha@gmail.com');
    assert.match(p.$('.pfa-pv__live').textContent, /Email changed to asha@gmail\.com/);

    click(p, button(p, 'Send the report'));
    await tick();
    assert.equal(result, undefined, 'nothing is sent until the box is ticked');
    assert.equal(p.$('.pfa-pv__need').hidden, false);
    assert.equal(p.d.activeElement, p.$('.pfa-pv__check input'));

    p.$('.pfa-pv__check input').checked = true;
    click(p, button(p, 'Send the report'));
    await asked;
    assert.equal(result, true);
    assert.equal(p.$('[data-pfa-preview]'), null, 'the preview is gone');
    assert.equal(p.d.documentElement.style.overflow, '');
  });

  test(`${mode}: going back, closing, or Escape sends nothing and puts the person where they need to be`, async () => {
    const p = boot({ dialog: mode });
    const one = p.w.PFAPreview.confirm(p.form, {});
    click(p, button(p, 'Continue'));
    click(p, button(p, 'Change them'));
    assert.equal(await one, false);
    assert.equal(p.d.activeElement, p.$('#email'), 'straight to the email field');

    const two = p.w.PFAPreview.confirm(p.form, {});
    click(p, button(p, 'Change something'));
    assert.equal(await two, false);
    assert.equal(p.d.activeElement, p.$('#what'), 'to the first field');

    const three = p.w.PFAPreview.confirm(p.form, {});
    p.d.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(await three, false);

    const four = p.w.PFAPreview.confirm(p.form, {});
    click(p, p.$('.pfa-pv__x'));
    assert.equal(await four, false);
    assert.equal(p.$$('[data-pfa-preview]').length, 0);
  });
}

test('with no mobile given, step 2 asks only about the email, and says email is then the only way', async () => {
  const p = boot();
  p.$('#mobile').value = '';
  const asked = p.w.PFAPreview.confirm(p.form, { send: 'Send the question' });
  click(p, button(p, 'Continue'));
  assert.equal(p.$('.pfa-pv__title').textContent, 'Is your email address right?');
  assert.equal(p.$('[data-contact="mobile"] .pfa-pv__v').textContent, 'Not given');
  assert.ok(p.$('[data-contact="mobile"] .pfa-pv__v').classList.contains('is-none'), 'a blank optional mobile is not shown as an error');
  assert.match(p.$('[data-contact="mobile"]').textContent, /only by email/);
  assert.equal(p.$('.pfa-pv__check span').textContent, 'My email is correct');
  click(p, button(p, 'Send the question'));
  assert.equal(p.$('.pfa-pv__need').textContent, 'Tick the box once you have checked it.');
  click(p, button(p, 'Change it'));
  assert.equal(await asked, false);
  assert.equal(p.d.activeElement, p.$('#email'));
});

test('a second press while the preview is open can never send twice', async () => {
  const p = boot();
  const first = p.w.PFAPreview.confirm(p.form, {});
  assert.equal(await p.w.PFAPreview.confirm(p.form, {}), false);
  assert.equal(p.$$('[data-pfa-preview]').length, 1);
  click(p, p.$('.pfa-pv__x'));
  assert.equal(await first, false);
});

test('wire() sends only once the person confirms, and not at all when they go back', async () => {
  for (const answer of [false, true]) {
    const dom = new JSDOM(`<!doctype html><body><form id="f"><input id="email" type="email" value="a@b.in"><button type="submit">Send</button><p data-form-status hidden></p></form></body>`, { runScripts: 'outside-only', url: 'https://pfa.test/events.html' });
    const w = dom.window;
    const calls = [];
    w.fetch = (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return new Promise(() => {}); };
    w.PFAPreview = { confirm: () => Promise.resolve(answer) };
    w.eval(FORMS_JS);
    const form = w.document.getElementById('f');
    w.PFAForms.wire(form, { kind: 'PFA-EV', collect: () => ({ email: 'a@b.in', name: 'Asha Rao' }) });
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await tick(); await tick();
    assert.equal(calls.length, answer ? 1 : 0, answer ? 'confirmed, so it sends' : 'went back, so nothing is sent');
    if (answer) assert.equal(calls[0].body.kind, 'PFA-EV');
    assert.equal(form.querySelector('button').disabled, answer, 'the button is only disabled once it is really sending');
  }
});

test('an email corrected in the preview is the email that is sent', async () => {
  const dom = new JSDOM(`<!doctype html><body><form id="f"><input id="email" type="email" value="asha@gmial.com"><button type="submit">Send</button><p data-form-status hidden></p></form></body>`, { runScripts: 'outside-only', url: 'https://pfa.test/events.html' });
  const w = dom.window;
  const calls = [];
  w.fetch = (url, opts) => { calls.push(JSON.parse(opts.body)); return new Promise(() => {}); };
  w.PFAPreview = { confirm: (form) => { form.querySelector('#email').value = 'asha@gmail.com'; return Promise.resolve(true); } };
  w.eval(FORMS_JS);
  const form = w.document.getElementById('f');
  w.PFAForms.wire(form, { kind: 'PFA-EV', collect: () => ({ name: 'Asha Rao', email: form.querySelector('#email').value }) });
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.email, 'asha@gmail.com', 'the typo the person corrected was sent anyway');

  /* The pages that send by themselves read the email again once confirmed. */
  const again = { 'report.html': 'data = collect(); if (!data)', 'ask.html': 'data = collect(); if (!data)', 'careers.html': "data.email = $('#email').value.trim();", 'wall.html': 'data.email = email.value.trim();' };
  for (const [page, reread] of Object.entries(again)) {
    const html = read(page);
    const go = html.indexOf('function go(confirmed)');
    assert.ok(go > -1 && html.indexOf(reread, go) > go && html.indexOf(reread, go) < html.indexOf('PFAForms.submit(', go), `${page} sends the fields as they were before the preview`);
  }
});

test('a choice card is named by its own label, not by everything printed on it', () => {
  const p = boot({ html: `<form id="f"><label class="tier"><input type="radio" name="tier" value="silver" data-preview-label="Silver" checked><span>Silver</span><span>\u20b91,000</span><span>The book and a card</span></label>
    <label><input type="checkbox" id="terms" checked><span>I accept the</span> <a href="#">membership terms</a>, and the rest.</label></form>` });
  const rows = p.w.PFAPreview.rowsOf(p.form, { labels: { tier: 'Membership' } });
  /* Array.from: the rows are built in the page's realm, and a strict deep
     comparison would otherwise fail on the Array prototype, not the values. */
  assert.deepEqual(Array.from(rows, (r) => [r.label, r.value]), [['Membership', 'Silver'], ['Agreed', 'I accept the membership terms, and the rest.']]);
});

test('every public form loads the preview and asks it before it sends, uploads or pays', () => {
  const pages = ['report.html', 'ask.html', 'careers.html', 'wall.html', 'events.html', 'cinekind.html', 'get-involved.html', 'donate.html'];
  for (const page of pages) {
    const html = read(page);
    const at = html.indexOf('<script src="assets/form-preview.js"');
    assert.ok(at > -1, `${page} does not load the preview`);
    const forms = html.indexOf('<script src="pfa-forms.js"');
    if (forms > -1) assert.ok(at < forms, `${page} loads the preview after pfa-forms.js`);
  }
  const before = (page, first, then) => {
    const html = read(page);
    const a = html.indexOf(first);
    const b = html.indexOf(then, a);
    assert.ok(a > -1 && b > a, `${page}: ${first} must come before ${then}`);
  };
  before('report.html', "window.PFAForms.preview(form, { title: 'Check your report", "window.PFAForms.submit('PFA-CR'");
  before('ask.html', "window.PFAForms.preview(form, { title: 'Check your question", "window.PFAForms.submit('PFA-Q'");
  before('careers.html', "window.PFAForms.preview(form, { title: 'Check your application", "window.PFAForms.submit('PFA-J'");
  before('wall.html', "window.PFAForms.preview(f, { title: 'Check your film", "window.PFAForms.submit('PFA-S'");
  before('get-involved.html', "PFAPreview.confirm(form, {\n        title: 'Check your membership before you pay'", 'form.submit(); });');
  before('get-involved.html', "window.PFAForms.preview(form, { title: 'Check your application before you pay'", "fetch('/api/caregiver/documents'");
  before('donate.html', "window.PFAPreview.confirm(giveForm", 'giveForm.submit();');
  for (const [page, kind] of [['events.html', 'PFA-EV'], ['cinekind.html', 'PFA-CK'], ['get-involved.html', 'PFA-V']]) {
    assert.match(read(page), new RegExp(`PFAForms\\.wire\\(form, \\{[\\s\\S]{0,160}${kind}|PFAForms\\.wire\\(form, \\{[\\s\\S]{0,80}previewTitle`), `${page} sends ${kind} through wire()`);
  }
  const wire = FORMS_JS.slice(FORMS_JS.indexOf('function wire('));
  assert.ok(wire.indexOf('preview(form, {') > -1 && wire.indexOf('preview(form, {') < wire.indexOf('submit(config.kind'), 'wire() asks before it sends');
});

test('a section that is switched off is not listed, even through form="..."', () => {
  /* 21 Oct 2026: a plain ₹100 donation was checked under "The occasion: Just
     because". donate.html's gift section is a fieldset, disabled unless a
     gift is chosen, and its fields join the form through form="giveForm".
     The browser does not send them, but a field inside a disabled fieldset
     still reports disabled === false, so the check screen listed the one
     that always has a value: the occasion dropdown. */
  const p = boot({ html: `
    <form id="f"><div class="field"><label for="n">Full name</label><input id="n" name="n" value="Asha"></div></form>
    <fieldset id="extra" disabled>
      <div class="field"><label for="occ">The occasion</label><select id="occ" name="occ" form="f"><option>Birthday</option></select></div>
      <div class="field"><label for="to">Who it is for</label><input id="to" name="to" form="f" value="Ravi"></div>
    </fieldset>` });
  const labels = () => Array.from(p.w.PFAPreview.rowsOf(p.form), (r) => r.label);
  assert.deepEqual(labels(), ['Full name'], 'nothing from the switched-off section');
  p.$('#extra').disabled = false;
  assert.deepEqual(labels(), ['Full name', 'The occasion', 'Who it is for'], 'and all of it once the section is on');
});
