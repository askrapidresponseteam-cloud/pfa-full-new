'use strict';

/* The year a reference number carries: the year in India time when the
   test runs (lib/submissions.js numbers by IST). Tests compare generated
   references against this, so the suite keeps passing after 1 January. */
module.exports = String(new Date(Date.now() + 5.5 * 3600 * 1000).getUTCFullYear());
