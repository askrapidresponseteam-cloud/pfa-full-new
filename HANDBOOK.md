# PFA Website - Operations Handbook

_Current version: v1.46 (22 Aug 2026). Update this line with every release._

**Companion:** `ARCHITECTURE.md` - system design, money flows, data model, trust boundaries, security controls, known gaps, secrets inventory.

Read this first. It is the one document that explains how the site is built,
how it is deployed, what went wrong on 22 Aug 2026 and why, and exactly what
to do next. Everything else (`BACKEND-SETUP.md`, `PFA_STORE_SHOPIFY_SETUP.md`,
`VERCEL_CCAVENUE_SETUP.md`) is detail referenced from here.

---

## 1. The shape of the system

```
Browser (static HTML/JS in repo root)
   │
   ├── /products/<handle> ──► same function (product-page route)
   ├── /api/*  ──► api/index.js  (ONE Vercel function)
   │                 │  routes by path to lib/routes/<name>.js
   │                 ├── payment/*        CCAvenue  (donate, give/send, membership)
   │                 ├── caregiver/*      Colony Caregiver Card programme
   │                 ├── member/*, member-status
   │                 ├── admin/*          admin.html backend
   │                 ├── paws-catalog     Shopify products → PFA catalogue
   │                 ├── product-page     /products/<handle> server-rendered pages
   │                 ├── pfa-orders       creates Shopify cart, returns checkout URL
   │                 ├── pfa-order-status order confirmation + tracking
   │                 └── webhooks/*       Shopify → PFA order events
   │
   ├── Firestore (via firebase-admin, server-side only)
   ├── CCAvenue  (PFA's own money: donations, membership)
   └── Shopify sg37v1-ta.myshopify.com (Paws & Tails' money: store)
```

**Money never touches PFA for store orders.** The shopper pays on a
Shopify-hosted page. PFA only learns about the order through webhooks.

### Why one function

Vercel Hobby allows 12 Serverless Functions per deployment. The site has 23
API handlers. Instead of upgrading, every handler moved from `api/` to
`lib/routes/` and one router (`api/index.js`) dispatches to them.
`vercel.json` rewrites `/api/:path*` → `/api/index?__route=:path*`. Public
URLs did not change; the frontend needed no edits.

Adding a route = one file in `lib/routes/` + one line in the `LOADERS` table
in `api/index.js`. The function count stays 1.

---

## 2. Lessons from the 22 Aug deployment (read before touching anything)

| What happened | Why | Rule going forward |
| --- | --- | --- |
| Deploy rejected: cron `*/10 * * * *` | Hobby allows at most once-per-day crons | Cron is now `0 3 * * *`. Trigger the email worker manually if needed (see §6). |
| Deploy rejected: 23 functions > 12 | Hobby limit | One function, see §1. Never create files directly under `api/` except `index.js`. |
| Tests passed locally, production API returned 404 | Vercel didn't recognise the `api/[...path].js` catch-all on this project | Use `api/index.js` + explicit `rewrites` in `vercel.json`. Rewrites are boring and always work. |
| Every import broke (`../../../lib/firebase` not found) | A migration script was run twice; it moved files a second level deeper | Patches are now shipped as full-tree zips, never as scripts that mutate the tree. |
| `.git` folder disappeared | Folder was replaced by unzipping over it | History lives on GitHub. Recover with `git init` → `git remote add` → `git fetch` → `git reset --soft origin/main` (see §4). |
| `.env.example` vanished from git | Vercel CLI appended `.env*` to `.gitignore` when it wrote `.env.local` | `.gitignore` ignores `.env` and `.env.*` but explicitly un-ignores `.env.example`. |
| Site search linked to `/products/<handle>.html`, which never existed; 404 page rendered unstyled | Products only lived in a quick-view modal with no URL; 404.html used relative asset paths | Every product has a real page at `/products/<handle>` (v1.38). All product links must use that path. 404.html uses absolute paths. |
| "Store partner payment is not connected in this build" at checkout | `window.PFA_COMMERCE.liveOrders` kill switch existed but nothing set it | `assets/commerce-config.js` sets it `true`. Set `false` only to pause the store. |
| Whole site 404 after a CLI deploy | `npx vercel --prod` uploaded a 5-file skeleton folder | Deploy only via `git push`; Instant Rollback to recover; then `vercel promote` the good build |
| Admin page looked "dead" - no feedback on sign-in | `site.css` has a global `.error{display:none}` for form validation; admin reused the class for its status line, so every message was invisible | `.admin-msg` forced visible, uses `.is-error`. Rule: never reuse `.error`/`.field` classes outside forms. |
| Admin sign-in button did nothing | Two causes: the site-wide `.error{display:none}` hid every status message, and the page depended on an ES module from `www.gstatic.com` | Messages forced visible (`.is-error`); sign-in moved to the Identity Toolkit REST API - no CDN module, no authorised-domain requirement (v1.46) |
| Vendor PDF contained a live Admin API token | Vendor sent credentials in documentation | Credentials go only in Vercel env vars. Ask vendor to rotate the token after go-live. |

**Golden rule:** after any deploy, run
`curl -s https://pfa-full-website.vercel.app/api/payment/health`.
JSON = the API is alive. Vercel's "page could not be found" = routing is broken,
regardless of what the dashboard says. The dashboard does not run the tests.

---


## 2b. Go-live: what depends on what

The public site and the admin portal are independent. You can open the site to
the public today; the admin can follow.

### Public site (ready now)
| Feature | Needs | State |
| --- | --- | --- |
| All content pages | nothing | live |
| Donate / Give / Membership payments | CCAvenue env vars | live (health `ok:true`) |
| Store browse, product pages, search | nothing | live |
| Store checkout → seller payment | `PFA_SHOPIFY_STOREFRONT_ACCESS_TOKEN` | live |
| Order confirmation + tracking | `PFA_SHOPIFY_ADMIN_TOKEN` (now) or webhook secret (later) | live |
| Forms (help desk, caregiver, etc.) | Firebase service account | live - writes go server-side |
| Member area sign-in (member.html) | `PFA_MAIL_API_KEY` (Resend) for sign-in codes, Firestore rules deployed | **check** - if mail isn't configured, members can't get codes |
| The Circle (circle.js) | Firestore rules deployed (client reads) | **run** `npx firebase-tools deploy --only firestore:rules,firestore:indexes` |

Firestore **collections are created automatically** on first write - there is
nothing to "set up". Rules and indexes are the only deploy step, and the API
routes work even before that because they use the admin SDK.

### Admin portal (`/admin.html`) - 4 steps, ~15 minutes
1. Firebase console → Authentication → Sign-in method → **Email/Password → Enable**.
2. Authentication → Users → **Add user** (your email + strong password).
3. Authentication → Settings → Authorized domains → add `pfa-full-website.vercel.app`
   (good practice; since v1.46 sign-in uses the REST API and does not require it).
4. Grant the admin claim from your Mac. Take the key from Firebase, not from
   Vercel:
   ```bash
   # Firebase console > gear > Project settings > Service accounts
   #   > Generate new private key  -> downloads a .json
   cd ~/PFA_Full_Website
   node scripts/firebase-project.js ~/Desktop/pfa-new-website-firebase-adminsdk-*.json
   export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ~/Desktop/pfa-new-website-firebase-adminsdk-*.json)"
   node scripts/grant-admin.js you@peopleforanimalsindia.org
   unset FIREBASE_SERVICE_ACCOUNT_JSON
   ```
   The first line is the one that matters when more than one key is lying
   about. It prints the project every part of the tree names and the project
   the key belongs to, and exits non-zero unless they are the same and none of
   them is a project this site has left (`pfa-oldsite`). On 7 Sep 2026 the
   ship script picked the newest `*firebase-adminsdk*.json` on the Desktop,
   which was pfa-oldsite's, and got as far as replacing the working tree before
   `check:admin` stopped it with "Projects do not match". It now finds the key
   by project (`node scripts/firebase-project.js --find`), refuses a retired
   one, and runs every check before it touches the live tree. To name the key
   yourself: `PFA_SERVICE_ACCOUNT=/path/to/key.json bash scripts/ship.sh you@...`.
   **Not `vercel env pull`.** Where the Firebase variables are stored as Vercel
   *Secrets* - which they are on this project - the pull cannot read them and
   writes the literal text `[SENSITIVE]` in their place instead of failing. The
   file then looks complete and every value in it is a lie, so `grant-admin.js`
   fails somewhere far downstream, or appears to run and grants nothing. If you
   have ever run step 4 that way, assume the claim was never set.
   `npm run check:admin` names this case explicitly.
Then sign in at `/admin.html`.

**If nobody can sign in,** run `npm run check:admin -- you@example.org` with the
same environment exported. The panel refuses every failed sign-in with one
sentence on purpose, so it cannot tell you whether the account is unknown, has
no claim, or cannot be verified at all; that check can, and the Vercel function
log carries the same answer. The two that look identical from outside and are
not are: the service account variables missing, and `FIREBASE_PROJECT_ID`
naming a different project from `assets/firebase-config.js` - in which case
every token is valid and none of them is for this server, and re-running
`grant-admin.js` will never help. `PFA_ADMIN_API_KEY` is no longer read by
anything and should be removed from the environment. `PFA_ADMIN_TOKEN` is now
only the caregiver email worker's trigger; it no longer opens the panel or any
`/api/admin/*` route, so keep it only if you use §6.

### What the admin sees end to end (v1.45)
Overview counts (submissions, members, caregivers, card payments, **store
orders**, paid-awaiting-shipment) · Submissions queue with status actions ·
Members · Caregivers · Payments (CCAvenue) · **Store** register: every Paws &
Tails order with PFA order number, customer, items, total, status, courier
tracking link, and a direct link to the order in Shopify; search by
`PFA-ST-<n>` or Shopify order id · Verify a card · The Circle · Member import.

## 3. Deploying

**Working folder is `~/PFA_Full_Website`** (a git clone). Not the Desktop -
the Desktop copy was wiped twice on 22 Aug, most likely by iCloud Desktop sync.
Changes arrive as small `.patch` files: `patch -p1 < file.patch`,
then `npm test`, commit, push.

**Deploy by `git push` only.** The Vercel project is connected to GitHub and
builds `main` automatically. Do not run `npx vercel --prod` from the Desktop
folder: it uploads whatever is on disk, and twice on 22 Aug that was a
half-assembled folder, which put a 404 site into production.

```bash
cd ~/Desktop/PFA_Full_Website
npm test                          # MUST be all pass
git add -A && git commit -m "describe the change"
git push origin main              # Vercel builds and promotes this
# wait ~1 min, then:
curl -s https://pfa-full-website.vercel.app/api/payment/health
```

**If you ever use Instant Rollback**, Vercel pins production and stops
promoting new pushes until you clear it: dashboard → yellow banner →
*re-enable auto-assigning custom domains*, or from the terminal
`npx vercel promote <newest-deployment-url> --yes`.

**Replacing the folder from a zip** (only if you must): `rm -rf` the old folder
first, unzip the full zip, then `git init` + `git remote add` + `git fetch` +
`git reset --soft origin/main` (see §4). Never `unzip -o` a handful of files
into a folder that may not exist - that creates a skeleton.

### Old instructions (kept for reference)

```bash
cd ~/Desktop/PFA_Full_Website
npm install
npm test                          # MUST be: pass 116, fail 0
git add -A
git commit -m "describe the change"
git push origin main              # GitHub integration deploys automatically
# or force a CLI deploy:
npx vercel --prod --force
curl -s https://pfa-full-website.vercel.app/api/payment/health
```

`vercel` and `firebase` are not installed globally - always prefix with `npx`
(`npx vercel`, `npx firebase-tools`).

Project: `pfa-full-website` in team `karthik-dhanyas-projects-22a9a267`.
Alias: `https://pfa-full-website.vercel.app`. The other Vercel projects
(`pfa-demo`, `pfa-demo-p5t7`) are stale; ignore them.

---

## 4. If git gets lost again

```bash
cd ~/Desktop/PFA_Full_Website
git init -q
git remote add origin https://github.com/askrapidresponseteam-cloud/pfa-demo.git
git fetch -q origin
git reset -q --soft origin/main   # adopt GitHub history, keep local files
git branch -M main
git add -A && git commit -m "..." && git push origin main
```

---

## 5. Environment variables (Vercel → Settings → Environment Variables)

Check what's set: `npx vercel env ls`

| Variable | Used by | Status |
| --- | --- | --- |
| `CCAVENUE_MERCHANT_ID`, `CCAVENUE_ACCESS_CODE`, `CCAVENUE_WORKING_KEY`, `CCAVENUE_MODE` | donate / membership | set ✔ (health reports true) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | everything | set ✔ |
| `PUBLIC_SITE_URL` | payment return URLs, links in emails | must be `https://peopleforanimalsindia.org`. Until 21 Oct 2026 it said `https://book.pfaevents.buzz`, which no longer serves the site, so CCAvenue sent every payer back to a dead address and paid payments stayed Started. Check it with `vercel env pull` (it is not a secret). |
| `PFA_SHOPIFY_STORE_DOMAIN` | store checkout, webhooks | `sg37v1-ta.myshopify.com` - **add** |
| `PFA_SHOPIFY_STOREFRONT_ACCESS_TOKEN` | store checkout (address prefilled) | Optional since v1.41: without it checkout falls back to a cart permalink. The seller's **public** storefront token is visible in pawsandtails24.com page source (`storefrontAccessToken`); using it is fine but tell the vendor. |
| `PFA_SHOPIFY_WEBHOOK_SECRET` | webhooks | **waiting on vendor** |
| `PFA_SHOPIFY_ADMIN_TOKEN` | order confirmation fallback (Admin `read_orders`) + catalogue stock levels | **set it** - the `shpat_…` value from the vendor PDF. Without it, PFA confirmation waits for the webhook. |
| `PFA_ADMIN_TOKEN` | email worker manual trigger | set if you want §6 |
| `PFA_SHOP_FIREBASE_SERVICE_ACCOUNT` | the PFA shop (shop.html): writes orders, stock and the store totals to **pfa-oldsite**, the backend its panel at pfa-oldsite.web.app reads | **add**: Firebase console, project pfa-oldsite, Project settings, Service accounts, Generate new private key; paste the JSON (or its base64). Refused if it belongs to any other project. Optional: without it, shop orders go to this site's own Firestore (shopOrders, shopStock, shopTotals), the database donations use, so the shop takes payment either way. Every shop order is also a row in the admin panel's Payments tab, type Shop order. `/api/payment/health` reports which store is in use as `shopOrders`. This is the only place pfa-oldsite is used; it stays retired as the site's own server key. |
| `PFA_PAYMENTS_INBOX` | every record of money: donations and gifts, shop orders, and the receipt for the fee paid with a membership or a colony caregiver application (lib/submission-forward.js `PAID_KINDS`; the application itself goes to `PFA_SUBMISSIONS_INBOX` without the payment, `SPLIT_KINDS`) | optional: unset means pfadcmho@gmail.com and ozairhusain@gmail.com (owner, 21 Oct 2026: "any record of money collected on the website to only go to pfadcmho@gmail.com ; ozairhusain@gmail.com not gandhim"); comma separated; `off` stops them. gandhim@exmpls.sansad.in is struck from it whatever it says. Every copy, relay or packing note about money may go to these addresses and no others: `deliver()` in lib/caregiver-mail.js refuses any other recipient, and a `PFA_MAIL_REPLY_TO` naming gandhim is ignored on a payer's receipt. |
| `PFA_SUBMISSIONS_INBOX` | every form that is not a payment, and every application: caregiver, membership, volunteer and job (owner, 23 Oct 2026: "ensure all caregiver and volunteer and job and membership applications go to gandhim email id"); a caregiver application's and a membership's copy carries no payment (lib/submission-forward.js `SPLIT_KINDS`) | optional: where each submission is emailed, with Reply-To set to the sender, so a Reply from that inbox reaches them. Unset means gandhim@exmpls.sansad.in; several addresses may be given, separated by commas; `off` stops forwarding. Needs the mailbox below (or `PFA_MAIL_API_KEY`), like every email. |
| `PFA_IMAP_USER`, `PFA_IMAP_PASS`, `PFA_IMAP_HOST`, `PFA_IMAP_PORT` | replies (lib/inbound-mail.js) | all optional: the mailbox replies are read from. Unset, the sending mailbox (`PFA_SMTP_USER`) is read, which is the normal case. |
| `PFA_CAPTURE_REPLIES` | replies | optional: `off` stops the copy of a submission naming the site's mailbox as a second Reply-To. Replies then reach the person and are not kept in the panel. |
| `CRON_SECRET` | the daily email worker and the mailbox check | **set it** (any long random string): Vercel's cron and Cloud Scheduler present it, and without it neither worker runs. |
| `PFA_SHOP_ORDERS_EMAIL` | the PFA shop | optional: a packing note for every paid order, sent only to those of its addresses (comma separated) that are also payments inboxes, one email each; any other address gets nothing (21 Oct 2026). The order's full copy already goes to the payments inboxes, and the order is in the pfa-oldsite panel either way. |
| `PFA_SMTP_USER`, `PFA_SMTP_PASS` | every email: confirmations, receipts, and the copy of each submission to gandhim | **the way PFA sends (owner, 7 Oct 2026).** The GoDaddy mailbox `info@peopleforanimalsindia.org` and its password. Every email then comes from that address through GoDaddy (Titan). In the mailbox's settings turn on third-party email access; with two-step sign-in, use an app password. Optional `PFA_SMTP_HOST` (default: tries `smtpout.secureserver.net`, then `smtp.titan.email`) and `PFA_SMTP_PORT` (default 465). Takes precedence over Resend. |
| `PFA_MAIL_API_KEY` | every email: confirmations, receipts, and the copy of each submission to the inbox | **required for any email to leave the site.** A Resend API key. Without it every form is still filed and listed in the panel, but nothing is emailed. |
| `PFA_MAIL_FROM` | every email | optional: the address the site sends as. Unset means `People for Animals <cards@peopleforanimalsindia.org>`, which Resend sends only if **peopleforanimalsindia.org is verified in the Resend account** (DNS records Resend lists, added on that domain). If that domain cannot be verified, verify one you control (for example pfaevents.buzz) and set this to an address on it, e.g. `People for Animals <submissions@pfaevents.buzz>`. A sender Resend refuses means **no** email goes at all. |

**Is email working?** Admin panel, Overview, "Copies to PFA's inbox": it says whether a key is set, where copies go and which address they are sent as; "Send a test email" sends one to the inbox and, if Resend refuses it, says why in plain words (sender domain not verified, key wrong, account in test mode). It also lists the last copies sent and whether each went; "Send the copies that did not go" sends any that were refused again, once the settings are right. Without it the daily worker (03:00 UTC) retries them for about five days.

After adding variables: `npx vercel --prod --force` (env changes need a redeploy).

---

## 6. Store integration - what to send Paws & Tails

Copy this into an email (also saved as `VENDOR-EMAIL.md`):

> **Subject: PFA Store integration - 4 items needed to go live**
>
> 1. **Storefront API access token.** Checkout uses Shopify's Storefront API,
>    which needs its own token - the `shpat_` Admin token cannot be used.
>    Shopify Admin → Sales channels → Headless → Storefront API → token with
>    `unauthenticated_write_checkouts`, `unauthenticated_read_product_listings`,
>    `unauthenticated_read_checkouts`.
> 2. **Publish all products to the Headless channel.**
> 3. **Register the six webhooks** (JSON, 2026-07) and send the **signing
>    secret** from Settings → Notifications → Webhooks:
>
>    | Topic | URL |
>    | --- | --- |
>    | orders/create | https://pfa-full-website.vercel.app/api/webhooks/order-created |
>    | orders/paid | https://pfa-full-website.vercel.app/api/webhooks/order-paid |
>    | orders/fulfilled | https://pfa-full-website.vercel.app/api/webhooks/order-fulfilled |
>    | fulfillments/update | https://pfa-full-website.vercel.app/api/webhooks/fulfillment-updated |
>    | orders/cancelled | https://pfa-full-website.vercel.app/api/webhooks/order-cancelled |
>    | refunds/create | https://pfa-full-website.vercel.app/api/webhooks/refund-created |
>
> 4. **Rotate the Admin token** after go-live; send secrets via a secure channel, not PDFs.

(Replace the domain with `peopleforanimalsindia.org` once DNS points there.)

When the secret arrives: add `PFA_SHOPIFY_WEBHOOK_SECRET` in Vercel, redeploy,
ask them to click "Send test notification" on `orders/create`, then:

```bash
npx vercel logs --prod        # look for the webhook line
curl -s "https://pfa-full-website.vercel.app/api/pfa-order-status?id=PFA-ST-<order number>"
```

### How an order flows

1. `store.html` → `POST /api/pfa-orders` → Shopify cart created with attribute
   `PFA checkout reference: <token>` → shopper sent to Shopify payment page.
2. `store.html` polls `GET /api/pfa-order-status?token=…` every 2 s.
3. Shopify fires `orders/create` → `lib/store-orders.js` stores it in Firestore
   `storeOrders/{shopifyOrderId}` and links the token → status `CONFIRMED`.
4. If no webhook record exists yet and `PFA_SHOPIFY_ADMIN_TOKEN` is set, the status endpoint asks Shopify's Admin API for recent orders with that reference and persists the match (v1.43).
5. Poll returns `verified:true`, `pfaOrderId: PFA-ST-<order number>` → confirmation screen.
6. Fulfilled / delivered / cancelled / refund webhooks update the same record;
   `track-order.html` reads it via `?id=PFA-ST-…`.

Status values: `AWAITING_PAYMENT → CONFIRMED → FULFILLED`, terminal
`CANCELLED` / `REFUND_RECORDED`. A late-arriving create can never undo a
terminal state. Shopify retries are deduplicated by `X-Shopify-Webhook-Id`.

### Manual email-worker trigger (Hobby cron is daily)

```bash
curl -X POST -H "Authorization: Bearer $PFA_ADMIN_TOKEN" \
  https://pfa-full-website.vercel.app/api/caregiver/email-worker
```

### Replies: how a conversation works, and reading the mailbox now

Every submission, paid application, donation and shop order is one
conversation (v1.399):

1. The copy goes to gandhim@exmpls.sansad.in from info@peopleforanimalsindia.org
   (a record of money goes to pfadcmho@gmail.com and ozairhusain@gmail.com
   instead, never to gandhim; owner, 21 Oct 2026).
   Reply-To is the person's own address first and info@ second, and the
   Message-ID names the submission and its thread id
   (`<PFA-CR-2026-00042.9f3a1c7e2b4d.forward@peopleforanimalsindia.org>`).
2. Madam presses Reply. Her mail app addresses the person and info@; nothing
   is typed or copied. The person gets her reply directly.
3. The site reads info@ over IMAP and files her reply on the submission,
   found from In-Reply-To and References and checked against the thread id.
   The same email read twice is one message. The panel's case view shows the
   whole exchange oldest first.
4. If the person writes back to PFA (a reply to their letter, or Reply all to
   Madam), it is filed the same way and relayed to the inbox in the same
   conversation there, Reply-To the person again. A plain Reply to Madam
   goes to her mailbox alone and the site does not see it.

On Firebase, Cloud Scheduler reads the mailbox every ten minutes
(`inboundMailCheck` in functions/index.js). On Vercel the daily cron reads
it at 03:30 UTC; in between, the panel's Overview has "Read the mailbox
now" under Replies, or:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://pfa-full-website.vercel.app/api/inbound-mail
```

`GET /api/inbound-mail` (with an administrator's token) says when it was
last read and what it found. A webhook from any inbound mail provider can
hand a message in the same way: `POST { "message": { from, to, subject,
messageId, inReplyTo, references, text, attachments: [{ filename,
contentType, content (base64) }] } }` with the same bearer token.

---

## 6b. Product pages (`/products/<handle>`)

Each Paws & Tails product has a real page on PFA's domain. Nothing links to
the seller's site.

- `vercel.json` rewrites `/products/:handle` → `api/index?__route=product-page&handle=…`
- `lib/routes/product-page.js` loads the catalogue (cached 10 min), finds the
  product, and injects into `product.html`: title/description, Open Graph
  image + price (WhatsApp previews), JSON-LD (Google), the product JSON, and
  up to 8 related products. Cached 10 min at the edge.
- `product.html` carries its own script for gallery, variants, stock, quantity,
  Add to bag / Buy now (the same bag as the store, through `assets/bag.js`),
  prescription notice, the "product label" panel, description, share, related.
  There was an `assets/product.js` that did this for the other half of the
  project; it rendered `pd-*` markup and linked to a `store.html` that does not
  exist here, was loaded by no page, and has been removed.
- `store.html` accepts `?bag=1`, `?checkout=1`, `?category=<id>` so the product
  page can hand back to the store.
- `product.html` is a template: keep `<!--PFA_HEAD_START-->…<!--PFA_HEAD_END-->`
  and `<!--PFA_DATA-->`. It also works statically as `product.html?p=<handle>`.
- `functions.api/index.js.includeFiles = product.html` in `vercel.json` ships the
  template with the function. Remove it and every product page 500s.

Check after deploy:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pfa-full-website.vercel.app/products/iron-cage   # 200
curl -s https://pfa-full-website.vercel.app/products/iron-cage | grep -o '<title>[^<]*'        # IRON CAGE | PFA Store
```

## 7. Firestore

Deploy rules after any change to `firestore.rules`:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules
```

New collections added 22 Aug: `storeOrders` (admin-readable),
`storeWebhookEvents` (server only). `storeCheckoutIntents` already existed.

### Test data (until 20 Oct 2026)

Owner, 23 Oct 2026: "dont need any record of 20 oct and earlier cause all of
them are test data". A super administrator sees a Test data box on the
Overview while any is left; Remove them, then Yes, moves every record made up
to the end of 20 Oct 2026 (India time), and everything tied to one, into
`testDataArchive/until-2026-10-20/<its own path>` (`lib/test-data.js`): cases
with their messages and photographs, payments and CCAvenue's answers, colony
cards with everything beside them, queued emails, staging photographs, shop
orders kept here, and their search entries. Nothing is destroyed: each record
is read afresh, copied without writing over anything, and removed in one
transaction, at most 6 MB at a time. The audit log, the reference
counters, members, settings and the files in Storage are left alone. To put
everything back, a super administrator posts `{ "action": "restore" }` to
`/api/admin/test-data`; both moves are written to the admin log.

---

## 8. Troubleshooting quick table

| Symptom | Check |
| --- | --- |
| API returns Vercel's HTML 404 | `vercel.json` rewrites present? `api/index.js` present? |
| `{"code":"NOT_FOUND","message":"Unknown API route."}` | Route missing from `LOADERS` in `api/index.js` |
| `WEBHOOK_NOT_CONFIGURED` | `PFA_SHOPIFY_WEBHOOK_SECRET` not set |
| `INVALID_SIGNATURE` on vendor test | Wrong secret, or vendor pointed a different shop at us |
| `SHOPIFY_STOREFRONT_NOT_CONFIGURED` on checkout | `PFA_SHOPIFY_STOREFRONT_ACCESS_TOKEN` missing |
| Checkout shows "Store partner payment is not connected" | `assets/commerce-config.js` has `liveOrders:false` or isn't loaded by `store.html` |
| Store page says "payment not verified" forever | Webhooks not registered, or order has no `PFA checkout reference` attribute - check `npx vercel logs --prod` |
| `Cannot find module '../../../lib/…'` | Import depth wrong; files under `lib/routes/<dir>/` need `../../` to reach `lib/` |
| Images look stale after a change | `vercel.json` caches `/media/*` for a day at the browser. Rename the file (or add `?v=2`) when you replace an image in place. |
| Home/store page slow to load | Check `curl -s -o /dev/null -w '%{size_download}' …/` - must stay under ~150 KB. Never embed base64 images or full catalogues in HTML (v1.42 lesson). |
| Deploy says "more than 12 functions" | Someone added a file under `api/` - move it to `lib/routes/` |
| `/products/<handle>` returns "template is missing" | `vercel.json` → `functions.api/index.js.includeFiles` must include `product.html` |

---

## 9. Files that matter

| File | Role |
| --- | --- |
| `api/index.js` | The single Vercel function; route table |
| `vercel.json` | Rewrite `/api/*` → router; daily cron |
| `lib/routes/**` | All handlers (formerly `api/**`) |
| `lib/store-orders.js` | Shopify order model, status machine, Firestore persistence |
| `lib/routes/webhooks/shopify.js` | HMAC-verified webhook receiver |
| `lib/routes/pfa-order-status.js` | Confirmation/tracking lookups |
| `lib/routes/location-lookup.js` | Reverse geocode for "Use my location", and `?pin=` asks India Post for a PIN's state, district and town |
| `assets/address.js` | The address block on every form (24 Oct 2026): house and street, PIN, town, state, district, all required; the PIN checked against the state and India Post. A form page adds `<fieldset data-address data-kind="PFA-X" data-legend="Your address">` and loads `assets/india-districts.js` then `assets/address.js`; `pfa-forms.js` adds the five fields to what is sent. A form with its own address boxes calls `PFAAddress.enhance(form, {pincode, state, district, city, address})` |
| `lib/submission-fields.js` (`ADDRESS`) | The server's copy of the same rule: every kind with a spec is refused without a whole address, a PIN outside its state, or a district outside its state |
| `lib/routes/paws-catalog.js` | Shopify → catalogue (public or Admin API) |
| `lib/routes/product-page.js` + `product.html` | Server-rendered `/products/<handle>` pages (rewrite in `vercel.json`; `includeFiles` ships the template with the function) |
| `assets/track-order.js` | Tracking page (reads API) |
| `test/shopify-webhooks.test.js` | Full order lifecycle tests |
| `firestore.rules` | Access rules incl. new store collections |
| `ARCHITECTURE.md` | Architecture and security reference |
| `CONTRIBUTING.md` | Working rules for anyone changing this repo |

## 10. Adding an event to the events page

`events.html` is written from one file, `data/events.json`. Order does not matter: the page puts the newest first.

1. Add an entry to the `events` list:
   - `code`: the next three-digit number, such as `"003"`.
   - `kind`: `awards`, `adoption`, `camp`, `openday` or `talk`. It decides which bar the event counts under.
   - `title`, `city`, and `date` written `YYYY-MM-DD`.
   - `photos`: one to three, each `{ "src", "alt", "caption" }`. Put the files under `media/events/`, or use an https address whose host is in the img-src of the Content-Security-Policy in `vercel.json`. The caption is written by hand on the card, so keep it to a name or a few words (24 characters at most).
   - Optional: `note` (one or two sentences), `tags` (up to three words), `link` `{ "href", "label" }`, and `feature` `{ "src", "alt" }` for the large photograph beside the request form.
2. Run `node scripts/build-events.js`. It refuses bad data and names the entry and the field. `DEPLOY.command` runs it for you, and the tests stop a deploy whose page is out of date (`npm run check:events`).
3. Nothing needs changing when a date passes. Which event is coming next, the countdown, and which have been held are worked out in each visitor's browser from the date.

## 11. Adding a story to the newsroom

The top of `newsroom.html`, the nameplate, the front page and the desks, is written from `data/newsroom.json`. Case 001's full record and the closing band below it are written by hand and never touched by the script.

1. Add an entry to the `stories` list. A story is something that happened, with the page that carries it:
   - `slug`: a short id in lowercase with hyphens, such as `case-002-pune`.
   - `desk`: `case`, `law`, `policy` or `cinekind`. Law and policy share the Policy and law desk.
   - `title` (at most 90 characters), `dek` (the one or two sentences under it, at most 260), `date` written `YYYY-MM-DD`, and `place`.
   - `link` `{ "href", "label" }`: a page on this site, an anchor, or both, such as `achievements.html#rec-080`. The build checks that the page and the anchor exist.
   - Optional: `image` `{ "src", "alt" }` (a file on disk, or an https address allowed by img-src), `from` (who issued it), `tag` (the label on the story, such as `Case 002`), `status` (such as `Resolved`), and `front` (1 to 4) to place it on the front page. With no story marked, the four newest make the front page.
2. Run `node scripts/build-newsroom.js`. It refuses bad data and names the story and the field. `DEPLOY.command` runs it for you, and the tests stop a deploy whose page is out of date (`npm run check:newsroom`).
3. A story with no photograph is set in type with its date large, so leave `image` out rather than use a stand-in picture.


## 12. The library and its reader

`library.html` lists every document from PFA's resources page on four shelves; `read.html?r=<slug>` opens one in the reader. The shelves are written from `data/library.json`, and the PDFs are the ones PFA put in `resources/`. `LIBRARY.md` explains every field and how the reader works.

1. **To add or change a document,** put its PDF in `resources/` and give it an entry in `data/library.json`: title, shelf, Google Drive file id, `pdf` path, and a description of at most 180 characters that says only what the document says. Then run `node scripts/build-library.js --extract`, which renders its cover and reads its contents. The script refuses bad data and names the entry and the field. The tests stop a deploy whose page, covers or indexes are out of date (`npm run check:library`, `test/library.test.js`).
2. **The reader shows the PDF itself,** page by page, as published. The script prints, for each document, how many contents entries it found: the document's own contents page where it has one, else its headings. Scans and Hindi in a font that scrambles its letters get none, and the reader moves through them by the slider and search. If a cover is not the document's first page (a foreword bound in front of it), add `"coverPage": 2` (or the right page) to its entry. Open each new document once and look.
3. **A document with no PDF here** opens in Google Drive's viewer. `npm run media:library`, which `DEPLOY.command` runs, tries to download it from Drive; Drive refuses a file not shared with "Anyone with the link".

## Reading copies of the library's PDFs

The reader opens `resources/read/<slug>.pdf`, a lighter copy of each library PDF made by `scripts/build-reading-copies.py` (photographs sized for a screen, pages drawn only as outlines turned into one picture each, linearized). Download still serves the original in `resources/`.

They are built on GitHub, not shipped in the site zip: `.github/workflows/reading-copies.yml` runs when a library PDF, `data/library.json` or the builder changes, builds any missing copy and commits it, and Vercel deploys that commit. Check it under the repository's Actions tab ("Reading copies"); it can also be run from there by hand. Until a copy exists the reader opens the original, so nothing breaks while it runs. If Actions is switched off for the repository, the site keeps working on the originals.

