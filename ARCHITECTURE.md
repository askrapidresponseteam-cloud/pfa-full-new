# PFA Website - Architecture & Security

_Companion to `HANDBOOK.md` (operations). This document explains how the system
is built, where the trust boundaries are, and what protects each one.
Version v1.45, 22 Aug 2026._

---

## 1. System overview

```
                        ┌──────────────────────────────────────────────┐
                        │  Browser (static HTML/CSS/JS from Vercel CDN) │
                        └──────┬──────────────────┬──────────────┬──────┘
                               │ /api/*            │ /products/*  │ CCAvenue / Shopify
                               ▼                   ▼              ▼  (hosted payment pages)
      ┌──────────────────────────────────────────────────────────────────────┐
      │  Vercel - ONE Node serverless function  api/index.js                 │
      │  vercel.json rewrites /api/:path* and /products/:handle into it      │
      │                                                                      │
      │  lib/routes/                                                         │
      │   payment/*      CCAvenue: donate, give/send, membership             │
      │   caregiver/*    Colony Caregiver Card programme (apply, card, shipping)    │
      │   member/*       member sign-in by emailed code                      │
      │   admin/*        admin panel backend (Firebase ID token, admin claim)│
      │   paws-catalog   Shopify products → PFA catalogue (cached 10 min)    │
      │   pfa-orders     creates a Shopify cart, returns seller checkout URL │
      │   pfa-order-status  confirmation + tracking (token / PFA-ST id)      │
      │   webhooks/*     Shopify order events (HMAC-verified)                │
      │   product-page   server-rendered /products/<handle>                  │
      │   location-lookup  reverse geocode for checkout                      │
      │   verify-card, pfa-submissions, photo/remove-background              │
      └───────┬───────────────────┬──────────────────────┬───────────────────┘
              │ firebase-admin    │ HTTPS                │ HTTPS
              ▼                   ▼                      ▼
      ┌───────────────┐   ┌──────────────────┐   ┌──────────────────────┐
      │ Firestore     │   │ Shopify          │   │ CCAvenue · Resend ·  │
      │ (asia-south1) │   │ sg37v1-ta        │   │ BigDataCloud/OSM/    │
      │               │   │ Storefront+Admin │   │ India Post · bg-rmv  │
      └───────────────┘   └──────────────────┘   └──────────────────────┘
```

**Why one function.** Vercel Hobby allows 12 serverless functions. Every
handler is a plain `(request, response)` module under `lib/routes/`; the router
dispatches by path. Adding a route is one file + one table entry.

**Static first.** Every page is a static HTML file. JavaScript enhances; nothing
requires a build step. Product pages are the one server-rendered exception, for
link previews and search engines.

---

## 2. Money flows (who is the merchant)

| Flow | Merchant of record | Gateway | PFA's role |
| --- | --- | --- | --- |
| Donate, Give/Send, Patron membership | **PFA** | CCAvenue (PFA account) | collects money; `lib/payment.js` recomputes every amount server-side from a fixed catalogue - the browser's number is never trusted |
| Store (Paws & Tails products), retired | **Paws & Tails** | Shopify checkout → Razorpay (seller's) | never touched money; created the Shopify cart, handed the shopper to the seller's page, then mirrored the resulting order |
| PFA shop (`shop.html`, PFA's own merchandise) | **PFA** | CCAvenue (PFA account) | sells; the money is PFA's (owner, 3 Oct 2026). `lib/shop.js` prices every order server-side, `lib/routes/shop/*` takes it, and the order is recorded in the pfa-oldsite backend |

`lib/payment.js` rejects any attempt to push a store item through
`/api/payment/create` (there is a test for it): money that is a seller's, not
PFA's, never goes through PFA's CCAvenue. The PFA shop is PFA's own money and
has its own routes, `/api/shop/checkout` and `/api/shop/response`.

### Store order lifecycle

```
bag (localStorage) ──► POST /api/pfa-orders ──► Shopify cartCreate (Storefront API)
        │                  attributes: "PFA checkout reference: <token>"
        │                  idempotency: same key → same cart (Firestore storeCheckoutIntents)
        ▼
seller checkout (popup) ──► pays on seller's Razorpay ──► Shopify order exists
        │
        ├─ primary:  Shopify webhook orders/create ──► /api/webhooks/order-created (HMAC) ─┐
        └─ fallback: store page polls /api/pfa-order-status?token=… ──► Admin API lookup ──┤
                                                                                           ▼
                                                       Firestore storeOrders/{shopifyOrderId}
                                                       status machine:
                                                       AWAITING_PAYMENT → CONFIRMED → FULFILLED
                                                       terminal: CANCELLED | REFUND_RECORDED
        ▼
PFA confirmation "Order placed - PFA-ST-<n>"; seller popup closed; tracking page; admin Store register
```

---

## 3. Data

| Firestore collection | Written by | Read by | Contains |
| --- | --- | --- | --- |
| `transactions` | payment routes | admin, member flow | CCAvenue payments (amount, status, type) - no card data ever |
| `members` | payment/response, import | member API, admin | member record; password lives in Firebase Auth, only a `hasPassword` flag here |
| `memberAuthCodes` | member/auth/start | member/auth/verify | **SHA-256(memberId:code:PEPPER)** - codes are never stored in clear |
| `caregiver*` (7 collections) | caregiver routes | admin, public card page | applications, cards, addresses, shipments; public projection cannot leak the holder (tested) |
| `submissions` | pfa-submissions | admin | all twelve form categories |
| `storeCheckoutIntents` | pfa-orders, webhooks | pfa-order-status | idempotency lock + token→order link; doc id is `sha256("store:"+token)` |
| `storeOrders` | webhooks / Admin lookup | pfa-order-status, admin | mirrored Shopify order (name, email, items, totals, tracking) |
| `storeWebhookEvents` | webhooks | webhooks | Shopify webhook ids, for de-duplication |
| `circle*` | admin/circle, client | client (rules) | The Circle community content |

**PII minimisation.** `pfa-order-status` returns a `publicView` with no email or
address. `verify-card` and `member-status` expose card-display fields only
(tested). Store webhooks persist name/email (needed for support) but never
payment instruments - Shopify never sends them.

**Nothing in the browser is trusted.** Amounts, variant ids, addresses and
phone numbers are re-validated server-side (`assets/field-rules.js` is shared
by form and API so the verdicts match).

---

## 4. Trust boundaries and what guards each

### 4.1 Browser → PFA API
- **Input validation** on every route: `cleanText()` strips control characters
  and caps length; variant ids must be 8-20 digits; quantities 1-25; Indian
  mobiles normalised and range-checked; PIN codes 6 digits; JSON bodies capped
  (1 MB orders, 64 KB forms, 1 MB webhooks).
- **Output encoding**: all user-derived strings rendered on pages go through
  `P.escape()` / `escapeHtml()`. Server-rendered product JSON is embedded with
  `safeJson()` which escapes `<` so a product title cannot close the
  `<script>` tag (tested with a hostile title).
- **Idempotency** on `/api/pfa-orders`: an `Idempotency-Key` maps to one Shopify
  cart; a changed payload under the same key is refused (409). Prevents
  double-submit becoming two orders.
- **No secrets in the client.** The only token in page source is the seller's
  *public* Storefront token, which Shopify designs to be public. Admin, CCAvenue,
  Firebase, mail and webhook secrets exist only as Vercel env vars.

### 4.2 Shopify → PFA (webhooks)
- Every request must carry `X-Shopify-Hmac-Sha256`; the receiver recomputes
  HMAC-SHA256 over the **raw body** with `PFA_SHOPIFY_WEBHOOK_SECRET` and
  compares in constant time. Missing secret → every webhook refused (503);
  bad signature → 401. There is deliberately no bypass.
- `X-Shopify-Shop-Domain` must equal `PFA_SHOPIFY_STORE_DOMAIN`.
- `X-Shopify-Webhook-Id` is recorded; redeliveries are no-ops (tested: a
  refund delivered twice is counted once).
- Out-of-order events cannot regress a terminal state (a late `orders/create`
  cannot undo `CANCELLED`).

### 4.3 PFA → Shopify
- Storefront token (public scope: create carts, read listings).
- Admin token (`PFA_SHOPIFY_ADMIN_TOKEN`, read-only scopes) used only
  server-side for catalogue stock and the order-confirmation fallback lookup.
  Never sent to the browser.

### 4.4 CCAvenue ↔ PFA
- Requests encrypted AES-128-CBC with the working key, per CCAvenue's
  reference implementation (tested against the PHP algorithm).
- On callback, the decrypted amount is compared to the stored order amount in
  paise (`amountMatches`), and the status is read from CCAvenue's payload, not
  the URL. Success pages render only after that check.

### 4.5 Admin panel
- Firebase Authentication (email/password) via the Identity Toolkit **REST API** -
  the panel loads no third-party SDK. The API verifies the **ID token**
  with the admin SDK (`verifyIdToken(token, checkRevoked=true)`) and requires
  the custom claim `admin: true`. A valid token without the claim is a member,
  not an admin.
- The claim can only be set by `scripts/grant-admin.js` with the service
  account - there is no web route that can mint an admin.
- The legacy shared-secret fallbacks are gone. `lib/admin-auth.js` admits
  only a verified Firebase identity; `PFA_ADMIN_API_KEY` is read by nothing
  and `PFA_ADMIN_TOKEN` now only triggers the caregiver email worker.
- Every change an administrator makes is written to an append-only log
  (`lib/admin-audit.js`, collection `adminAudit`), readable by super admins at
  `GET /api/admin/records?type=audit`.

### 4.6 Member sign-in
- Email/mobile → one-time code delivered by Resend. Stored as a peppered
  SHA-256 hash; `start` returns the same response whether or not the member
  exists (no enumeration).

### 4.7 Firestore rules (`firestore.rules`)
- Default deny. Browsers can read only a member's own record (signed in) and
  the Circle's public content. Every `caregiver*`, `storeOrders`, `submissions`
  path is admin-only or server-only (`if false`). The API uses the admin SDK,
  which bypasses rules - so the rules are a second wall for the client, not
  the only one.

### 4.8 Third-party calls
- Geocoders (BigDataCloud, OpenStreetMap, India Post) are called server-side
  with a User-Agent and timeouts; results are sanitised and restricted to an
  India bounding box. Nothing about the shopper beyond lat/lng leaves PFA.
- Background-removal provider: the key never reaches the client; provider
  errors are reported without their body (tested).

---

## 5. Availability and performance

- **Caching**: catalogue cached 10 min in-function and at the edge
  (`s-maxage=600`); product pages edge-cached 10 min; static assets with
  long-lived headers (`vercel.json` → `headers`), hashed home images immutable.
- **Degradation**: if Shopify is unreachable the store shows the last saved
  catalogue; if the Storefront token is absent checkout falls back to a cart
  permalink; if the webhook secret is absent confirmation falls back to the
  Admin API lookup; if Firestore is down the idempotency lock falls back to
  instance memory (documented in `pfa-orders.js`).
- **Payload budget**: `index.html` ≈ 57 KB, `store.html` ≈ 119 KB, other pages
  < 80 KB, store catalogue list ≈ 160 KB gzipped. See Handbook troubleshooting
  if a page grows.
- **Cron**: one daily job (`/api/caregiver/email-worker`, 03:00 UTC) - Hobby
  allows daily only; it can be run on demand with the admin token.

---

## 6. Known gaps (honest list)

| Gap | Risk | Mitigation / plan |
| --- | --- | --- |
| No rate limiting on public POST routes | form spam, order-creation abuse | Vercel's platform limits apply; add a Firestore-backed per-IP counter if abuse appears |
| No CSP / HSTS headers yet | lower defence in depth against XSS | add `headers` in `vercel.json` once third-party scripts are finalised (Shopify CDN, CCAvenue) |
| Admin token from vendor PDF is in email history | exposure of read-only scopes | vendor to rotate after go-live; token only in Vercel |
| Legacy admin shared secrets still honoured | weaker than Firebase auth | remove env vars after Firebase login works |
| Webhook secret not yet issued by vendor | confirmation relies on Admin lookup | primary path activates automatically once `PFA_SHOPIFY_WEBHOOK_SECRET` is set |
| Error reporting is Vercel logs only | slow to notice failures | optional: wire `console.error` to an alerting endpoint |

---

## 7. Secrets inventory (names only - values live in Vercel)

`CCAVENUE_MERCHANT_ID` `CCAVENUE_ACCESS_CODE` `CCAVENUE_WORKING_KEY` `CCAVENUE_MODE`
`FIREBASE_SERVICE_ACCOUNT_JSON` (or `FIREBASE_PROJECT_ID` / `_CLIENT_EMAIL` / `_PRIVATE_KEY`)
`PFA_AUTH_PEPPER` `PFA_MAIL_API_KEY` `PFA_MAIL_FROM` `PUBLIC_SITE_URL`
`PFA_SHOPIFY_STORE_DOMAIN` `PFA_SHOPIFY_STOREFRONT_ACCESS_TOKEN` (public-class)
`PFA_SHOPIFY_ADMIN_TOKEN` `PFA_SHOPIFY_WEBHOOK_SECRET` (pending)
`PFA_ADMIN_TOKEN` (caregiver worker trigger only) `PFA_ADMIN_API_KEY` (retired - remove)
`PHOTO_CUTOUT_ENDPOINT` `PHOTO_CUTOUT_FIELD` `PHOTO_CUTOUT_FORMAT` `PHOTO_CUTOUT_KEY` (background removal, optional)

Rotation: change the value in Vercel → redeploy. Nothing is cached in code.

---

## 8. Moving the website to Firebase (prepared 24 Nov 2026)

The website can be served by Firebase Hosting instead of Vercel, in the same
Firebase project as the admin panel (`pfa-new-website`), with nothing else
changing: the same pages, the same API code, the same database.

**What is in place.** Every deploy (DEPLOY.command) now also publishes the
website to its own Firebase Hosting site, next to the panel's:

| Hosting site | Address | Serves |
|---|---|---|
| panel | pfa-new-website.web.app | the admin panel (`public/`), as before |
| site | the name in `.firebaserc`, `<name>.web.app` | the public website (`site/`) |

- `scripts/firebase-site.js` makes the website's site once (its name must be
  free across Firebase) and names it in `.firebaserc`.
- `scripts/build-firebase.js` builds `site/` from `dist/` (the same minified
  copy Vercel serves), without anything server-side, and keeps both sites
  inside half the free Hosting storage (`scripts/hosting-limits.js`, five
  versions kept, set on both sites by `scripts/hosting-retention.js`).
- `firebase.json` has the website's clean addresses, redirects, rewrites and
  headers, copied from `vercel.json`; `test/firebase-deploy.test.js` keeps them
  the same for as long as both exist. `/api/**` goes to the same function the
  panel uses (Mumbai).
- CCAvenue's return point and every public link are never a Firebase address
  (`lib/ccavenue.js`, `lib/public-site.js`): donors always come back to
  peopleforanimalsindia.org.
- The scheduled jobs already run on Firebase (`functions/index.js`), every
  10 minutes and every 2 minutes, not once a day as on Vercel.
- `404.html` is the page shown for an address that is not on the site, on
  either host.

**Checking it is ready.** At the end of every deploy, DEPLOY.command runs
`node scripts/firebase-move-check.js`. It reads the site on Vercel and the
copy on Firebase and checks: the same build; every main page and the files
pages load; the API (payments health, chat, visit counter, shop, Care
Guides, the Wall, PIN lookup, signature); the old addresses' redirects; and
that Firebase has every setting Vercel has, by name only, with the same
tracking key (`PFA_AUTH_PEPPER`). It ends READY or NOT READY and, for each
missing setting, prints the one command that sets it. Run it by hand any time:

    cd ~/Desktop/PFA_Website && node scripts/firebase-move-check.js

**Moving the domain, once it says READY.** No downtime if done in this order:

1. Firebase console > pfa-new-website > Hosting > the website's site (not
   pfa-new-website) > Add custom domain > `peopleforanimalsindia.org`.
   Choose the advanced setup, which proves the domain and issues the HTTPS
   certificate *before* any traffic moves. Add the TXT record(s) it gives at
   wherever the domain's DNS is kept (Vercel > Domains if Vercel's
   nameservers are used, or the registrar). Never touch the MX or other mail
   records: info@ email depends on them.
2. Wait until Firebase shows the certificate as issued (minutes to a few
   hours). The site is still on Vercel throughout.
3. Replace the domain's A record(s) (and AAAA, if any) with the ones Firebase
   shows. Add `www.peopleforanimalsindia.org` the same way, set to redirect
   to the bare domain.
4. Within an hour or so visitors reach Firebase. Run the check again: it
   notices the domain now points at Firebase and compares against
   pfa-full-website.vercel.app instead.
5. Leave Vercel running for a week as the fallback (pointing the A record
   back undoes the move). Then disconnect the GitHub repository from the
   Vercel project, or delete the project, and downgrade Vercel to Hobby; the
   unused days of Pro are refunded pro rata.

**Cost.** Hosting is free up to 10 GB stored and about 360 MB downloaded a
day; the project is on the Blaze plan, so beyond that it is charged per GB
(cents), not stopped. Set a budget alert in Google Cloud Billing for the
project. Functions and Firestore were already serving the panel and the
schedules from this project.
