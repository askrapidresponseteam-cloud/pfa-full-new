'use strict';

/* Ready-made CSR projects at a fixed price, each a one-page PDF (owner,
   3 Nov 2026: "Make 6 to 8 ready-made projects with a fixed price, each as
   a one-page PDF"). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { projects } = require('../scripts/build-csr-projects');

test('six to eight projects, each priced line by line, the lines adding up, overheads at most 5 percent', () => {
  const list = projects();
  assert.ok(list.length >= 6 && list.length <= 8, `${list.length} projects`);
  const ids = list.map((p) => p.id);
  for (const want of ['ambulance', 'abc-town', 'para-vets']) assert.ok(ids.includes(want), `the owner's example: ${want}`);
  for (const p of list) {
    assert.equal(p.lines.reduce((s, l) => s + l.inr, 0), p.price, `${p.id} adds up`);
    const admin = p.lines.filter((l) => /admin/i.test(l.item)).reduce((s, l) => s + l.inr, 0);
    assert.ok(admin / p.price <= 0.05, `${p.id} overheads ${admin}`);
    assert.ok(p.outcomes.length >= 3, `${p.id} says what can be reported`);
    assert.match(p.schedule, /\(iv\)/);
  }
  const all = JSON.stringify(list).toLowerCase();
  for (const sector of ['dairy', 'pharma', 'pet', 'agri']) assert.ok(all.includes(sector), `something for ${sector} companies`);
});

test('on the CSR page, current, with a PDF of one page each and a way to start the brief', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-csr-projects.js'), '--check'], { stdio: 'pipe' });
  const html = read('csr.html');
  for (const p of projects()) {
    assert.ok(html.includes(`id="project-${p.id}"`));
    assert.ok(html.includes(`href="media/csr/${p.id}.pdf"`));
    const pdf = fs.readFileSync(path.join(ROOT, 'media', 'csr', p.id + '.pdf')).toString('latin1');
    assert.match(pdf, /\/Type \/Pages[\s\S]*?\/Count 1\b/, `${p.id}.pdf is one page`);
  }
  assert.match(html, /data-csr-pick=/);
  /* the PDFs travel in the zip: scripts/make-zip.sh leaves out resources/ (the library is fetched
     on deploy), and on 3 Nov 2026 the first build kept them there, so the deploy's tests found
     the CSR page's PDF links dead */
  const zip = read('scripts/make-zip.sh');
  for (const m of zip.matchAll(/--exclude='\.\/([^'*]+)'/g)) assert.ok(!'media/csr/'.startsWith(m[1].replace(/\/?$/, '/')), `the zip leaves out ${m[1]}, where the PDFs are`);
  assert.match(html, /href="#projects">See the projects</);
  assert.doesNotMatch(html, /[–—]/);
  assert.doesNotMatch(read('data/csr-projects.json'), /[–—]/);
});
