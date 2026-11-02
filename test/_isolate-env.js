'use strict';

/* Preloaded before every test file (see "test" in package.json).
 *
 * The suite must not see the developer's shell or a pulled .env.local. With a
 * real PFA_SHOPIFY_ADMIN_TOKEN exported, the order-status tests would call the
 * live Shopify Admin API; with PUBLIC_SITE_URL set to a Vercel placeholder, the
 * product page would render it into the canonical tag. Each test sets exactly
 * the variables it needs, so everything else is dropped here. Anything matched
 * below that a test genuinely wants is set again inside that test. */

const AMBIENT = /^(PFA_|FIREBASE_|CCAVENUE_|PAWS_|PHOTO_CUTOUT_|PUBLIC_SITE_URL$|SITE_URL$|CRON_SECRET$|VERCEL)/;

for (const key of Object.keys(process.env)) {
  if (AMBIENT.test(key)) delete process.env[key];
}

/* Saving sent email into the mailbox's Sent folder (lib/sent-copy.js) would
   reach for a real IMAP server from any test that sets up the mailbox. Off
   here; test/sent-copy.test.js turns it on with a stand-in mailbox. */
process.env.PFA_SENT_COPY = 'off';

/* The Monday digest (lib/weekly-digest.js, Monday to Wednesday, India time)
   and the monthly payments report (lib/finance-report.js, the 1st to the
   7th) ride along with every email worker run and add one more email to
   whatever a test counts. Off here so the suite gives the same answer on
   every day of the year; their own tests call them with a fixed date. */
process.env.PFA_WEEKLY_DIGEST = 'off';
process.env.PFA_FINANCE_REPORT = 'off';
/* and the monthly cruelty report (lib/cruelty-report.js, the 2nd to the 8th) */
process.env.PFA_CRUELTY_REPORT = 'off';
