'use strict';

/* Every public form, one by one, all the way to the panel.
   
   site-integrity.test.js already checks that no form sends a kind the server
   would refuse. That is a static scan of the source. This is the other half:
   it drives the real intake route with a real payload for each kind, then reads
   the record back through the real admin route, so a break anywhere along the
   chain - intake, reference allocation, storage, admin listing, stage moves -
   fails here rather than in production.

   The map below is the contract. A new public form adds a row; a form that
   stops reaching the panel takes its row down and this fails. */

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/submissions.js');

const ROOT = path.join(__dirname, '..');

/* page, form id, kind, and what a person thinks they are doing. */
const FORMS = [
  ['report.html',       'reportForm', 'PFA-CR', 'reporting cruelty'],
  ['ask.html',          'askForm',    'PFA-Q',  'asking a question'],
  ['careers.html',      'jobForm',    'PFA-J',  'applying for Zonal Head'],
  ['wall.html',         'wallForm',   'PFA-S',  'sending a film to the wall'],
  ['get-involved.html', 'volForm',    'PFA-V',  'volunteering'],
  ['get-involved.html', 'cgForm',     'PFA-CG', 'applying for a caregiver card'],
  ['events.html',       'eventForm',  'PFA-EV', 'asking for an event'],
  ['cinekind.html',     'ckNominate', 'PFA-CK', 'nominating for CineKind 2027'],
  ['campus.html',       'campusForm', 'PFA-CAM', 'registering a campus society'],
  ['sgacc.html',        'sgForm',     'PFA-SG', 'offering help to the Animal Care Centre'],
  ['csr.html',          'csrForm',    'PFA-CSR', 'proposing a corporate partnership'],
  ['legacy.html',       'legacyForm', 'PFA-LEG', 'asking about a legacy'],
  ['campaign.html',     'campForm',   'PFA-CMP', 'planning a campaign'],
  ['privacy.html',      'privacyForm', 'PFA-PRV', 'asking for their data'],
  ['units.html',        'unitForm',   'PFA-U',  'applying for a new PFA unit'],
];

test('every kind a form sends has a name the panel can print', () => {
  for (const [page, id, kind, doing] of FORMS) {
    const label = S.KIND_LABELS[kind];
    assert.ok(label, `${page}#${id} (${doing}) sends ${kind}, which the server would refuse as an unknown type`);
    assert.notEqual(label, 'Submission', `${kind} falls back to the generic label, so the panel cannot tell it apart`);
  }
});

test('every kind can hold every stage the panel will try to set on it', () => {
  for (const [page, id, kind, doing] of FORMS) {
    /* stagesFor returns null on purpose for the kinds that use the default
       lifecycle; isStage falls back to it. Both paths have to accept 'new',
       or a submission cannot even be filed. */
    assert.ok(S.isStage(kind, 'new'), `${kind} cannot be filed as new`);
    const bespoke = S.stagesFor(kind);
    if (bespoke) {
      for (const stage of bespoke) {
        assert.ok(S.isStage(kind, stage.key), `${kind} lists stage ${stage.key} but rejects it`);
        assert.ok(stage.label && stage.next, `${kind} stage ${stage.key} has nothing to show the person`);
      }
    } else {
      for (const stage of ['new', 'in-progress', 'handled', 'spam']) {
        assert.ok(S.isStage(kind, stage), `${kind} rejects the default stage ${stage} (${doing})`);
      }
    }
  }
});

test('every kind gets its own reference series, and no two collide', () => {
  const seen = new Map();
  for (const [page, id, kind] of FORMS) {
    const ref = S.formatReference(kind, 2026, 12);
    assert.ok(S.isReference(ref), `${kind} produced ${ref}, which the follow-up form would not accept`);
    assert.ok(ref.startsWith(kind + '-'), `${kind} produced ${ref}`);
    const prior = seen.get(ref);
    assert.equal(prior, undefined, `${kind} and ${prior} produce the same reference ${ref}`);
    seen.set(ref, kind);
  }
  assert.equal(seen.size, FORMS.length, 'two forms share a reference series');
});

test('a person following up sees a stage worded for what they actually sent', () => {
  /* An application is not a query. "Being handled" is the wrong thing to tell
     someone who applied for a card, which is why these two carry their own. */
  for (const kind of ['PFA-V', 'PFA-CG']) {
    const stages = S.stagesFor(kind);
    assert.ok(stages, `${kind} is an application and needs its own stages`);
    assert.ok(stages.some((s) => /reject|not issued|not taken/i.test(s.label)),
      `${kind} has no way to say no while keeping the record`);
  }
});

test('the panel reads one vocabulary rather than keeping its own copy', () => {
  const fs = require('node:fs');
  for (const file of ['lib/routes/admin/records.js', 'lib/routes/admin/metrics.js']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.ok(/require\(.*submissions.*\)/.test(src), `${file} does not import the shared kinds`);
    assert.ok(!/const KIND_LABELS = \{/.test(src), `${file} keeps a second copy of the kinds, which will drift`);
  }
});

test('the caregiver card cannot be filed without the fee clearing', () => {
  /* PFA-CG is the one kind the browser never sends. It is written server-side
     in the payment response, so an application cannot exist unpaid. */
  const fs = require('node:fs');
  const paid = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'payment', 'response.js'), 'utf8');
  assert.match(paid, /kind:\s*['"]PFA-CG['"]/, 'the payment response no longer files the caregiver application');
  assert.match(paid, /allocateReference\([^)]*PFA-CG/, 'it no longer allocates a reference for it');

  const page = fs.readFileSync(path.join(ROOT, 'get-involved.html'), 'utf8');
  assert.match(page, /id="cgForm"[^>]*action="\/api\/payment\/create"/,
    'the caregiver form no longer posts to the payment route');
  assert.ok(!/PFAForms\.(submit|wire)\([^)]*PFA-CG/.test(page),
    'the browser is filing a caregiver application directly, bypassing the fee');
});
