# Membership card - journey and data architecture

Owner, 26 Oct 2026: "admin should have option to send email to the applicant
to upload photo. once they upload the application should come to pfa for
approval and card generation."

## The journey

| Stage (record `status`) | Label the member sees | Reached by |
|---|---|---|
| `new` | Member | The paid membership (lib/routes/payment/response.js) |
| `photo-requested` | Photo requested | Panel: Email photo link, or Ask for another photo |
| `photo-received` | Photo received | The member sending a photograph through the link |
| `card-approved` | Card approved | Panel: Approve and issue card |
| `dispatched` | Kit dispatched | Status change, as before |
| `delivered` | Kit delivered | Status change, as before |

The three middle stages are action-only (`lib/case-flow.js` ACTION_ONLY), so
the case drawer can never say a link went, a photograph arrived or a card
exists when it did not.

## Where things live

| Collection / path | Holds | Written by |
|---|---|---|
| `submissions/{ref}.memberPhoto` | current link hash and expiry, times asked, reasons, current photo id, superseded photo ids | the steps below |
| `submissions/{ref}.memberCard` | card summary: printed name, validity, approved and printed times | approve, printed |
| `submissions/{ref}/attachments/member-photo-*` | each photograph (bytes in the private bucket, `submissions/{ref}/...`) with size and consent time | upload |
| `submissions/{ref}/messages` | a note for every step, in the case's conversation | every step |
| `memberCards/{ref}` | the card on the register | approve, printed |
| `memberPhotoLinks/{sha256}` | a link: member, expiry, used, retired | request, upload |
| `caregiverEmails` | the letters, queued and retried by the worker | every letter |
| `adminAudit` | who did what | every panel action |

All writes to a submission go through `lib/routes/admin/case.js`
(`memberStep`), which touches status, photo and card state, history and the
conversation, never what the member wrote. Nothing is deleted: a photograph
not approved stays on file as superseded.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| GET | `/api/admin/membership?queue=all` | Membership cards module |
| GET | `/api/admin/membership?reference=` | Membership cards module (returns the photograph) |
| POST | `/api/admin/membership` `request-photo`, `retake`, `approve`, `printed` | Membership cards module |
| POST | `/api/membership/photo` `open`, `send` | the link itself |

## The link

- 32 random bytes, base64url (43 characters). Only its SHA-256 is stored.
- One live link per member: the record holds the current hash; sending a new
  link retires the old one in the same transaction.
- Expires after 14 days (`LINK_DAYS`), used once (marked in the transaction
  that files the photograph).
- Carried in the page's fragment (`member-photo.html#t=`), which browsers do
  not send, and posted in the body; the page removes it from the address bar.
- The queued letter is the only full copy; once sent, the queue's copy is
  blanked. A letter that could not go keeps it for the worker.
- `open` returns the first name, the membership and the expiry; never email,
  mobile, address or payment.

## The photograph

Framed on the member's device to the card's 3:4 window and exported as a
600 x 800 JPEG (assets/photo-editor.js). The server reads the size from the
file's own header and refuses anything that is not a JPEG, PNG or WebP, is
smaller than 300 x 400, or is not upright. Consent is required and recorded.

## The card

`assets/member-card.js`, loaded by the panel only. ID-1, 85.6 x 54 mm, laid
out in tenths of a millimetre. Fonts are self-hosted (Cinzel and DM Sans, SIL
Open Font License, in fonts/). The name prints at one size; a name that does
not fit is shortened by the reviewer before approval (the panel suggests
initials). District and state use the caregiver card's short forms
(assets/card-print.js). Printing: one face a page at 85.6 x 54 mm from the
print window, or a 600 dpi PNG of each face. Never emailed.

Validity: a year from the day the membership was paid
(`VALIDITY_MONTHS` in lib/membership-card.js); lifetime prints "Lifetime".

## Settings

| Variable | Default | What |
|---|---|---|
| `PFA_PUBLIC_SITE_URL` | https://peopleforanimalsindia.org | where the photo link points |
| `PFA_PANEL_URL` | https://pfa-new-website.web.app/admin.html | the link in the office's notice |
| `PFA_SUBMISSIONS_INBOX` | gandhim@exmpls.sansad.in | who gets the office's notice |

## Access

A super admin has the section. Staff need the Membership cards module ticked
on the People page.
