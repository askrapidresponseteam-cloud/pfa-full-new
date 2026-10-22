# PFA - logic, APIs and backend

Split out of `PFA_Full_Website_v1_63.zip`. This half holds everything that makes
the journeys **work**: the serverless API, the shop/store integration, payments,
validation, persistence, tests and deployment config.

The other half (`PFA_UI_Content`) holds the pages, styling, media and content.
Together the two zips reconstitute the original archive exactly.

---

## What is in here

| Path | Files | Size |
| --- | ---: | ---: |
| `_inline-extracts/` | 9 | 273 KB |
| `_retired-assets/` | 14 | scripts no page loads; see its README |
| `api/` | 1 | 6 KB |
| `assets/` | 30 | 424 KB |
| `lib/` | 43 | 346 KB |
| `scripts/` | 4 | 20 KB |
| `test/` | 30 | 226 KB |
| `tools/` | 2 | 9 KB |
| (root) | 25 | 298 KB |

### The API - one function, many routes
`api/index.js` is the single Vercel serverless function; `vercel.json` rewrites
`/api/:path*` and `/products/:handle` into it. Handlers live in `lib/routes/`
and are registered in the `LOADERS` table in `api/index.js`. Vercel Hobby caps
the project at 12 functions, which is why nothing else may be added under `api/`.

| Area | Routes |
| --- | --- |
| Store (Paws & Tails / Shopify) | `paws-catalog`, `pfa-pay-start`, `pfa-pay-confirm` (direct pay, Razorpay), `pfa-orders` (seller checkout fallback), `pfa-order-status` (token, handle, or PFA id + contact), `pfa-store-reconcile`, `product-page`, `webhooks/*` |
| Payments (CCAvenue, PFA is merchant) | `payment/create`, `payment/response`, `payment/health` |
| Colony Caregiver Card programme | `caregiver/apply` (410, retired), `caregiver/card` (read by `caregiver-card.html`), `caregiver/order`, `caregiver/replace`, `caregiver/admin-shipment`, `caregiver/email-worker` |
| Members | `member/auth/start`, `member/auth/verify`, `member-status`, `verify-card` |
| Admin panel backend | `admin/*` (Firebase ID token + `admin: true` claim) |
| Shared | `location-lookup`, `pfa-submissions`, `photo/remove-background` |

Two money flows, deliberately kept apart: **PFA** is merchant of record for
donations and Give/Send (CCAvenue); **Paws & Tails** is
merchant for the store (Shopify checkout → seller's Razorpay). `lib/payment.js`
rejects any attempt to push a store item through CCAvenue.

### Client-side logic in `assets/`
The browser-side halves of those journeys: shared field validation
(`field-rules.js` with `field-validate.js`), the bag, the chrome, the Colony
Caregiver Card, QR, photo capture and cutout.

### `_inline-extracts/`
Several pages keep their behaviour in an inline `<script>` instead of in
`assets/` - `store.html` alone carries ~80 KB of storefront logic. A file-level
split cannot separate that from its markup, so those blocks are snapshotted
here as **read-only reference copies**. The live code is in the `.html` files in
the UI zip. See `_inline-extracts/README.md`.

---

## Cross-zip dependencies - read this before running anything

Neither zip is a runnable site on its own; the split is for hand-off and review,
not for deployment. To run or deploy, merge both trees back over each other.

**Coming from the UI zip, this half needs:**

| Needed | Why |
| --- | --- |
| `*.html` | every route the API serves or redirects to |
| `assets/data.js` | `PFA_DATA` - units, animals, stories, guides, the local product list |
| `assets/site.css`, `assets/*.css` | referenced by `test/site-integrity.test.js` |
| `assets/search-index.json` | written by `scripts/build-search-index.js` |
| the `seo:start`/`seo:end` block in every page head | written by `scripts/build-seo.js` |
| `sitemap.xml` | written by `scripts/build-search-index.js` |
| `media/**` | referenced by pages and the audit |

**Living here but loaded by the UI:**

| File | Note |
| --- | --- |
| `assets/field-rules.js` | **`require()`d by `lib/payment.js`, `lib/firebase.js`, `lib/submissions.js`, `lib/submission-fields.js`, `lib/caregiver.js` and the routes** *and* `<script>`-tagged by the ten pages that take an entry. It is deliberately one file: the whole point is that the form and the API cannot disagree about what a valid Indian mobile number is. Do not copy it into the UI zip - keep the single copy here. |
| `assets/field-validate.js` | applies those rules in the browser: keystroke filtering, the stored form on blur, length caps, and a field-specific message in whichever error element the page uses. Loaded immediately after `field-rules.js`. |

Tests will not pass in isolation: `test/site-integrity.test.js`,
`test/cta-coherence.test.js`, `test/admin-page.test.js`, `test/help-page.test.js`,
`test/store-experience.test.js` and others read the HTML and CSS. Merge first,
then `npm test`.

`test/photo-cutout.test.js` and `test/store-experience.test.js` reference
`assets/three.min.js` and `assets/pfa-store-cinematic.js`, which are **absent
from the original archive** - that is pre-existing, not a result of this split.

---

## Secrets
None are in here. `.env.example` lists the names only; values live in Vercel.
See `ARCHITECTURE.md` §7 for the full inventory and `HANDBOOK.md` for rotation.
