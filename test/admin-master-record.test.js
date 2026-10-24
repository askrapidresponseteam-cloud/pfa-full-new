'use strict';

/* The critical rule: nothing is ever deleted from Admin.

   This is not aspirational. lib/routes/admin/circle.js used to call
   ref.delete() in four places - posts, their replies, individual replies and
   whole member profiles were destroyed, leaving only a 140-character excerpt
   in the log. These tests exist so that cannot return. */

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/submissions.js');
const M = require('../lib/admin-modules.js');

const ROOT = path.join(__dirname, '..');
function serverFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) serverFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no server code deletes a stored record', () => {
  const offenders = [];
  for (const file of serverFiles(path.join(ROOT, 'lib'))) {
    /* Strip comments before looking, rather than skipping lines that *start*
       like one - the comment explaining this rule spans several lines, and its
       continuation lines were being read as code. */
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    src.split('\n').forEach((line, i) => {
      if (/claimsCache\.delete|searchParams\.delete|memory\w*\.delete/.test(line)) return;  // in-process caches
      /* The one exception (owner, 23 Oct 2026, test data): lib/test-data.js
         MOVES a record into the archive, its copy written in the same
         transaction on the line before. Held to exactly that below and in
         test/test-data.test.js. */
      if (path.relative(ROOT, file) === path.join('lib', 'test-data.js') && line.trim() === 'tx.delete(pair.from);') return;
      if (/\.delete\(\)|batch\.delete\(|tx\.delete\(|\.doc\([^)]*\)\.delete/.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `these destroy records:\n  ${offenders.join('\n  ')}`);
});


test('the archive move removes nothing it has not copied in the same transaction', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'test-data.js'), 'utf8').split('\n');
  const removals = src.map((line, i) => [line.trim(), i]).filter(([line]) => /\.delete\(/.test(line));
  assert.equal(removals.length, 1, 'one place, used both ways');
  for (const [line, i] of removals) {
    assert.equal(line, 'tx.delete(pair.from);');
    assert.equal(src[i - 1].trim(), 'tx.create(pair.to, data);', 'the whole record, read afresh in the transaction, is written first, never over anything');
  }
  assert.match(src.join('\n'), /const sources = await tx\.getAll\(\.\.\.pairs\.map\(\(p\) => p\.from\)\);/, 'read in the transaction that moves it');
});
