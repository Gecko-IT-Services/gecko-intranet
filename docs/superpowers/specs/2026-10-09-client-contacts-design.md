# Contacts per client

Philip, 9 Oct 2026, asked how to improve contacts and sales; chose (in order) contacts per client, activity &
follow-ups, a sharper pipeline, prospects. This is the first.

Before: one contact name and email per client, from the SSA `Clients` list (and only for SSA clients).

## Now
- Table `client_contacts` (RLS, staff only): client name, name, role, email, phone, main contact, notes, source.
  One row per person per client by email (unique, case-insensitive); a name or an email is required.
- Seeded once by the migration from each SSA client's primary contact + email (marked main, source `ssa`).
- Client page › **Contacts** tab: cards (main first) with mailto / tel links; Add, Edit, Make main, Remove.
  Only one main contact per client (the others are unset when one is made main).
- The header under the client name shows the main contact (name, role, email, phone); without any contacts it
  falls back to the SSA list as before.

## Rules (`src/core/contacts.js`, tests `tests/contacts.mjs`)
Names tidied, emails lower-cased and checked, phone numbers keep digits/+/()/-/spaces, roles suggested
(Owner / director, Accounts, Office manager, IT contact, Staff) but free text. Contacts match a client under any
spelling of its name (`sameClient`).

## Not now
- Pulling contact persons from Xero: reading Xero contacts needs the `accounting.contacts` scope (a re-consent);
  emails already reach Xero's own contact on Nudge. Revisit if typing them in proves slow.
- The SSA list's PrimaryContact/Email columns are not written back (the SharePoint flows don't use them).
