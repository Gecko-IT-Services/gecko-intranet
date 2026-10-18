# Client advice email (client page › Upgrades & advice)

Philip, 18 Oct 2026: "access to areas per client and send an email to the main person at each customer with details of the
benefits of upgrading… quick and easy, email to drafts. Incorporate and identify these gaps and opportunities and quickly email a
draft that composes a suitable, friendly email that explains the reasons why we believe they should use this/these products and
the benefits it has to them."

## What it does

A tab on every client page, **Upgrades & advice**, between Devices and Jobs. Left: everything worth raising with the client, each
with a tick box. Right: the email to the main contact, rebuilt as items are ticked, with an editable subject, and **Draft email in
Outlook**. The draft goes to the clicker's Outlook Drafts (`/me/messages`, Mail.ReadWrite, as Opportunities' Draft email): never sent
from Gecko HQ. Products in the email become **Proposed** in the pipeline (an open idea moves to Proposed; nothing is doubled).

Reached from the client page, and from Monitoring › Upgrades (each client: "Email <client> about it", `data-open-tab="advice"`, which
`openClient` now honours for any tab).

## Topics (core/advice.js, tests/advice.mjs)

| Topic | From | Ticked by default |
|---|---|---|
| Computers on an unsupported Windows: each named, "can move to Windows 11 at no cost" or "too old… replacing it" | Upgrades (Atera) | yes |
| Servers reaching end of support | Upgrades | yes |
| Computers on old Office | Upgrades | yes |
| Windows 11 update due (free, routine) | Upgrades | no |
| Machines with no backup (a server or PC with no plan) | Coverage (Acronis) | yes |
| Each catalogue product the client lacks (Opportunities gaps, open deals left out), strongest ticked | Opportunities | strength ≥ 2 |

Client-facing only. A late or failed backup is ours to fix and never goes in the email; nothing about billing, margins, leaks or our
tools (Atera, Acronis) is named. Product wording comes from the catalogue's own email (`opportunity_products.email_body`): the
paragraph that explains the problem and its • benefit bullets, plus the client price when the product has one (`priceSentence`).
Device and server wording is in core/advice.js.

The email: greeting by the main contact's first name, one line of context, the topics numbered (each: why, "What we can see", "What
it means for you"), a no-pressure close ("we'll send a clear quote for anything that has a cost"), the clicker's sign-off. A name
ending in s takes only the apostrophe ("West Country Fires' IT").

## Not done / rejected

- An AI-written email: Philip removed the paid Claude question box on 11 Oct (no running cost). The wording is his catalogue's.
- Sending from Gecko HQ: drafts only, as everywhere else.
- Logging the email on the client's Activity: the draft can still change or not be sent; log it when it goes.
