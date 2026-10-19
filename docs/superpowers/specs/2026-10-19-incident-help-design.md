# Help with this (19 Oct 2026)

## Why
Kelly's PC at Daron Motors showed INACCESSIBLE_BOOT_DEVICE on Monday morning. What helped was a short list of likely causes and a
"simpleton" WhatsApp message the office could follow; it worked ("kellys pc was fine after the advice given"). Philip chose to
have Gecko HQ do that ("1-3 i like very much": this is 1).

## What it does
- **Help with this** on every Monitoring › Devices "Not on this morning" item, and **Help** on every open alert (Monitoring ›
  Alerts). One native dialog (`src/sections/incident.js`) for both.
- Gecko HQ gathers what it knows (`core/incident.js`): the machine as Atera last saw it (`machineFacts`: OS and build, model, age
  from the BIOS date, memory, disks, last restart, last seen; unknowns left out), the problem and what the alert or check says
  (Gecko HQ's own likely reasons for "not on"), the client's setup note, and up to 12 recent timesheet notes that mention the
  machine or its user (`relatedWork`). Matched by computer name or Atera's display name ("Kelly's PC" = FIPC).
- One call to `client-ai` (kind `incident`, Sonnet 5.5, about 1p, logged) returns: **likely causes** (most likely first, each saying
  which facts point to it), **what to do** (safest first; data protected before anything destructive) and **a message for the
  client**: plain, numbered emoji steps they can safely do, ⚠️ for what not to do and when to send a photo, signed by the sender.
- The message is editable; **Copy message** for WhatsApp, a text or an email (nothing is sent from Gecko HQ); **Add task** carries
  the steps; **Ask again** for another answer.

## Not done
- Not saved (each answer is for the moment); not on Overview's rows yet (they open the right page, where the button is).
- No WhatsApp link: the client's mobile numbers aren't kept reliably, and copying keeps sending in Philip's hands.
