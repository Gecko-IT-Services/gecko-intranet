# Backup coverage (Monitoring › Coverage)

Philip, 18 Oct 2026: "it needs to be monitored better". Step 2 of `2026-10-18-acronis-sync-design.md`, built on the real
rows of the first sync (15 customers, 18 Oct).

**The one question:** is everything that should be backed up, backed up? The Backups tab (job emails) says how last
night's jobs went; it can't see a machine that stopped sending emails, or one that was never protected.

## Checks (core/coverage.js, tests/coverage.mjs)

Per Acronis customer, from `acronis_items` (`resource_status` of machines and VMs, `agent`, `usage`, `alert`) and
`atera_agents`:

| Check | Level | Example on 18 Oct |
|---|---|---|
| Machine with no plan | red (amber for a VM seen through a host) | |
| No good backup in 48 **working** hours (Mon–Fri; most plans run weekday nights, so Friday → Monday is fine) | red | Tserver (18 Apr), Regals DESKTOP-PDS8SB8 (2 Jun) |
| Last backup failed / had warnings | red / amber | Technix FilePC (warnings) |
| Acronis agent offline while Atera says the machine is on | red, says to restart "Acronis Managed Machine Service" | Tserver before the restart |
| Agent offline in both | amber | Regals |
| Agent version behind the newest major in use | amber | WCF servers on 25.1 |
| Server / domain controller in Atera with no backed-up machine of that name | red | Daron DCSERVER |
| Microsoft 365 in Acronis but no SharePoint sites protected | red (Philip: SharePoint is always backed up) | |
| Unprotected SharePoint ≥ 500 MB | amber; less is a note (every client has 21–37 MB of system sites) | Onsite 1.3 GB |
| No Microsoft 365 backup in Acronis at all | note only | WCF, Hillcrest, Kingdom, P&M, Regals, Technix |

Names are compared as `machineKey` (first DNS label, letters and digits, lower case): FPServer.wcf.local = FPSERVER.
A VM that Acronis also sees through the ESXi host is shown once, as its own machine: same name, or listed in
`SAME_MACHINE` (WCF's "File Server" is FPServer). Atera names map to Acronis names through `ATERA_NAMES` (Daron Motors =
Daron Ford Motors). Gecko's own machines are not chased.

## Where it shows

- Monitoring › **Coverage** (new hub tab after Backups): four figures, Needs a look / All clients, a row per client that
  opens its issues, machines (plan, last good backup, next run, agent) and Microsoft 365 counts. Refresh runs
  `acronis-sync` now.
- Overview › Today: each red issue is a Needs attention row ("Not covered: DCSERVER") and counts in the red total
  (`window.GeckoMonitor.coverage`, read from the database, never from Acronis).

## Not done / later

- Per-site SharePoint detail: the resource API doesn't return Microsoft 365 items for these tenants, so SharePoint is
  judged from usage counts (sites protected, unprotected bytes), not site by site.
- Storage per backup and stale archives, live cost against Xero: part 2.
- The client page's own Coverage panel (`coverageFor` is ready for it).
- Expected-workstation lists (which PCs a client wants backed up): only servers are expected today.

## Rejected

- 24-hour line: Monday mornings would be all red for Mon–Fri plans.
- Flagging every workstation with no backup: most clients back up one or two PCs on purpose.
