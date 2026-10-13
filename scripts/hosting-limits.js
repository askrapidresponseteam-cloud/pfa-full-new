'use strict';

/* The one place the Firebase Hosting storage limits are written down.
 *
 * scripts/build-firebase.js enforces the bundle budget, scripts/hosting-
 * retention.js sets the retained release count on the project, and
 * test/firebase-hosting-budget.test.js checks the two still add up. Changing
 * a number here changes all three.
 *
 * Why any of this exists
 * ----------------------
 * Firebase Hosting keeps every version you have ever deployed, and storage is
 * the sum of all of them, not the size of the live site. There is no dedupe
 * across versions: a file that has not changed in a month is counted again in
 * every version that contains it.
 *
 * On 8 Oct 2026 scripts/ship.sh began running `firebase deploy --only
 * functions,hosting` so the admin panel stopped going stale. That was right,
 * but `hosting` does not mean the panel: it means the whole of public/, and
 * public/ was then the entire 31 page site plus media/ and a second copy of
 * the library's PDFs, about 480 MB. Twenty ships in five days put Hosting
 * storage at 9.73 GB of the 10 GB that is free, while total downloads for the
 * month were 8.21 MB, because visitors are served by Vercel and nobody was
 * fetching any of it. The project was days from the ceiling, where deploys
 * either start costing per GB or stop working, for twenty historical copies
 * of a website Firebase does not serve.
 *
 * The fix is two numbers that cannot drift:
 *
 *   RETAINED_RELEASES  how many versions Firebase keeps. Set on the project
 *                      itself on every ship, so a change made in the console
 *                      cannot survive the next deploy.
 *   SAFE_BYTES         the most storage this project may ever occupy. The
 *                      build multiplies the bundle it just made by the
 *                      retained count and refuses to build if the result
 *                      crosses it.
 *
 * Worst case is therefore bundle x (RETAINED_RELEASES + 1), bounded at build
 * time, every time, on every machine. Hitting the ceiling now requires the
 * panel itself to grow past the budget, which is a genuine need, and the
 * build says so in plain words instead of letting it happen quietly.
 */

/* Firebase's own free allowance. Past this, Blaze bills 0.026 USD per GB. */
const CEILING_BYTES = 10 * 1024 * 1024 * 1024;

/* Half of it. The headroom is deliberate: Hosting storage is an estimate
   updated once a day, so the number being watched is always behind reality,
   and a limit set at the ceiling would be found out too late. */
const SAFE_BYTES = CEILING_BYTES / 2;

/* 1 to 100 is what the API accepts. Ten is enough history to roll back a bad
   release several times over, and at a panel sized bundle costs nothing. */
const RETAINED_RELEASES = 10;

/* The deploy in progress is not yet one of the retained ones. */
const WORST_CASE_MULTIPLIER = RETAINED_RELEASES + 1;

/* The largest bundle that still fits, given the above. */
const MAX_BUNDLE_BYTES = Math.floor(SAFE_BYTES / WORST_CASE_MULTIPLIER);

function worstCaseBytes(bundleBytes) {
  return bundleBytes * WORST_CASE_MULTIPLIER;
}

function withinBudget(bundleBytes) {
  return worstCaseBytes(bundleBytes) <= SAFE_BYTES;
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function gb(bytes) {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

module.exports = {
  CEILING_BYTES,
  SAFE_BYTES,
  RETAINED_RELEASES,
  WORST_CASE_MULTIPLIER,
  MAX_BUNDLE_BYTES,
  worstCaseBytes,
  withinBudget,
  mb,
  gb
};
