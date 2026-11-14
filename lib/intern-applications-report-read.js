'use strict';

/* The month's internship applications, read for the monthly report
   (lib/intern-applications-report.js). Reading the register lives apart:
   no file that reads submissions writes anything (test/submissions.test.js). */

const APPS = require('./intern-applications');
const TEST = require('./test-data');

/* Every live internship application that came in from `from` to before `to`, oldest first. */
async function applicationsBetween(db, from, to) {
  const snap = await db.collection('submissions').where('kind', '==', APPS.KIND).get();
  return (snap.docs || []).map((d) => Object.assign({ reference: d.id }, d.data() || {}))
    .filter((a) => !['removed', 'spam'].includes(a.status) && !TEST.isTest(a))
    .filter((a) => { const t = Date.parse(a.createdAt || ''); return t >= from && t < to; })
    .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)) || String(x.reference).localeCompare(String(y.reference)));
}

module.exports = { applicationsBetween };
