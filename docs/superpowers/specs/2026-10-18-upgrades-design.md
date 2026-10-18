# Upgrades (Monitoring › Upgrades)

Philip, 18 Oct 2026: "a view that highlights areas that need upgrading asap" (after asking where all the Windows 10 PCs are).

**The one question:** what in each client's estate is out of support or about to be, and what's the fix: a free upgrade, an
update, or a new PC?

## Rules (core/upgrades.js, tests/upgrades.mjs)

From Atera's device records (`atera_agents.raw`: OS, OSBuild, Office, OfficeFullVersion, Processor, Memory, HardwareDisks,
BiosReleaseDate), devices seen in the last 30 days. Support dates are Microsoft's published end-of-support dates for Home/Pro.

| Finding | Now (ASAP) | Soon (within 6 months, or worth planning) |
|---|---|---|
| Windows 7/8.1/XP, Windows 10 (14 Oct 2025), Server 2008/2012 (10 Oct 2023) | yes | |
| Windows Server 2016 (12 Jan 2027) | | yes |
| Windows 11 by build: 21H2, 22H2, 23H2 (11 Nov 2025), 24H2 (13 Oct 2026); 25H2 fine; Enterprise/Education not judged | yes | |
| Office 2003–2019 (2016/2019: 14 Oct 2025), Office 2021 (13 Oct 2026); Microsoft 365 apps fine | yes | |
| macOS Catalina / Big Sur / Monterey and older | yes | |
| Under 8 GB memory, C: under 15 GB free (or under 8% and 40 GB), hardware 6+ years old (BIOS date) | | yes |

What to do per device: Windows 10 on a processor Windows 11 supports (Intel 8th gen+, Core Ultra, AMD Ryzen 2000+) → free
Windows 11 upgrade; on an older one → replace; can't tell (Xeon, unknown) → check. A server (by OS, device type or name, e.g.
KINGDOMSERVER on Windows 10) → plan a new server. Windows 11 on an old build → the latest update (free, Windows Update or Atera).
Atera's Office name can be stale: one that says 2013 or older but runs version 16 is treated as current (usually Microsoft 365).

## Page

Four figures (upgrade now, replace, free to fix, old Office). By client, worst first, with chips (3 replace · 1 server ·
5 Windows 11 updates · 3 old Office) and Now / To plan counts; a client opens to its devices (what's wrong, what to do, last
seen, Open in Atera) and **Add task**, pre-filled with the client, a title and every device's fix (tasks.js now takes
`data-title` / `data-note` on `data-tk="add"`). **Probably gone**: devices not seen for 30+ days, to remove from Atera and Webroot.
Gecko's own machines are listed last and left out of the figures.

First run (18 Oct 2026): 92 devices to upgrade now across 19 clients: 29 PCs to replace, 4 free Windows 11 upgrades, 38 Windows 11
updates, 28 on old Office, 4 servers (Daron DCSERVER on 2012, WCF FPServer and Tserver on 2016, Kingdom's server on Windows 10);
42 devices probably gone.

## Not done

- Prices or quotes per replacement (the task is the hand-off; a job can follow).
- Windows Update / Atera patch status per device (Atera's API doesn't give it).
