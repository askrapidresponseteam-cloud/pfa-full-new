# Deploying to Firebase

The site runs on Vercel. Firebase serves the admin panel and the API behind it,
and nothing else. `vercel.json` is untouched, so both work and you can move back.

## What Firebase Hosting serves, and why it matters

`public/` is `admin.html`, the files `admin.html` loads, and an index that
sends the bare domain to the panel. About 350 KB. It is not the website.

This is worth knowing because `firebase deploy --only hosting` deploys the
whole of `public/`, whatever is in it, and because Firebase keeps every version
you have ever deployed, for ever, without deduping between them. Storage is the
sum of all of them. Until 13 Oct 2026 `public/` was a full mirror of the site,
all 31 pages plus `media/` plus a second copy of the library's PDFs, about
480 MB, and ship.sh deployed it on every release. Twenty ships in five days put
Hosting storage at 9.73 GB of the 10 GB that is free, for copies nobody
downloaded: transfer for that month was 8.21 MB, because visitors are on Vercel.

Two guards make that impossible to repeat, and neither needs remembering:

    node scripts/build-firebase.js      refuses to build a bundle that, kept as
                                        many times as Firebase keeps it, would
                                        cross half the free allowance
    node scripts/hosting-retention.js   sets how many versions Firebase keeps,
                                        on every ship, before the deploy

Both numbers are in `scripts/hosting-limits.js`, which explains itself. To see
where the project stands without changing anything:

    npm run check:hosting

The whole site can still be built, for comparing the two deployments or for
moving off Vercel:

    npm run build:firebase:full

That bundle is around 480 MB, so the budget refuses it. Serve the library's
PDFs from somewhere that is not Hosting first.

## Once

    npm install -g firebase-tools
    firebase login
    cd functions && npm install && cd ..

Environment. Vercel holds these as project variables; Firebase needs them too.
The secret ones go in Secret Manager, not a file:

    firebase functions:secrets:set CCAVENUE_WORKING_KEY
    firebase functions:secrets:set CCAVENUE_ACCESS_CODE
    firebase functions:secrets:set CCAVENUE_MERCHANT_ID
    firebase functions:secrets:set PFA_ADMIN_TOKEN
    firebase functions:secrets:set PFA_AUTH_PEPPER
    firebase functions:secrets:set PFA_MAIL_API_KEY
    firebase functions:secrets:set PFA_SHOPIFY_ADMIN_TOKEN
    firebase functions:secrets:set PFA_SHOPIFY_WEBHOOK_SECRET
    firebase functions:secrets:set CRON_SECRET

Firebase mounts a secret only into a function that names it, and naming one
that was never created fails the deploy. `npm run deploy:firebase` handles
both: `scripts/firebase-secrets.js` asks the project which secrets exist and
writes them to `functions/.env` as `PFA_FUNCTION_SECRETS`. A secret you have
not created yet is skipped, so only its feature stays off (no `PFA_SMTP_PASS`
means no email), and the rest of the API still deploys.

The rest (PUBLIC_SITE_URL, PFA_SMTP_USER, PAWS_SHOPIFY_DOMAIN, PFA_MAIL_FROM
and so on) go in `functions/.env`. Firebase credentials are not needed: a function running in
the project authenticates to Firestore on its own, so FIREBASE_PRIVATE_KEY and
FIREBASE_SERVICE_ACCOUNT_JSON can be left out entirely.

## Every time

    npm run deploy:firebase

which is `node scripts/build-firebase.js && node scripts/firebase-secrets.js && firebase deploy --only functions,hosting,firestore --project pfa-new-website`.

Storage rules (storage.rules: no browser may read or write the bucket that keeps
photographs) go separately, because Firebase only takes them once Storage is
switched on in the console (Build > Storage > Get started):

    npm run deploy:storage-rules

scripts/ship.sh does this as its last step and treats "Storage is not set up
yet" as a note, not a failure.

The build also copies `assets/field-rules.js` and `assets/india-districts.js`
into `functions/`, which lib/ loads, and refuses to finish if any file the
API loads is missing from the bundle. Before 7 Oct 2026 those two were left
out and every API route on Firebase crashed on load, which the panel showed
as "could not reach its own API".

The build step assembles two directories:

  public/     19 pages and 44 assets, copied from an allowlist
  functions/  the API and lib/, wrapped as one Cloud Function

## Why an allowlist

Hosting can be pointed at `.` with an "ignore" array. One missing entry there
publishes `lib/ccavenue.js`, and the working key it reads, as a static file
anyone can fetch. The build names what ships instead, so a new server file is
private by default, and it refuses to finish if anything server-side reaches
`public/`. Never set `hosting.public` to `.`.

## What changed from Vercel, and what did not

Nothing in `api/` or `lib/`. `api/index.js` is a plain Node handler with no
Vercel SDK, so it drops into `onRequest` unmodified.

Two routing differences are handled in `functions/index.js`:

  - Vercel rewrote `/api/<x>` to `?__route=<x>`. Hosting cannot add a query
    parameter, but the router already falls back to reading the pathname, so
    all 34 routes resolve on their own.
  - `/products/<handle>` did need injected parameters. The wrapper sets them.

The daily 03:00 caregiver email worker moves from `vercel.json` crons to
Cloud Scheduler via `onSchedule`, same time, Asia/Kolkata.

Functions run in `asia-south1` (Mumbai), beside the Firestore database, so
reads between them do not cross a region.

## After the first deploy

Point these at the Firebase URL, or they will keep talking to Vercel:

  - CCAvenue redirect and cancel URLs in the CCAvenue dashboard
  - the Shopify webhook endpoint
  - PUBLIC_SITE_URL / SITE_URL
  - your domain's DNS, when you are ready to cut over

## Cost

Blaze bills usage with no cap. Set a budget alert in Google Cloud Billing
before the first deploy. On this site's measured payload, hosting is roughly
$0 up to 200k page views a month, and about $5 at 800k.
