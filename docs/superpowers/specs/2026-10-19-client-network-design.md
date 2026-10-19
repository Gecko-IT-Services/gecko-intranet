# Network drawing per client (19 Oct 2026)

## Why
Philip: "could we have a network diagram per client, something visual based on what they have, visio style perhaps". Chose to build it
without network equipment for now ("yes without for now").

## What it does
- Client page › **Network**: one drawing, redrawn from live data (`core/network.js` `sites` + `drawing`, SVG; tests `tests/network.mjs`).
- **Sites from Atera**: machines reporting from the same internet address (IPv4, or an IPv6 /48 for home broadband) are one site,
  biggest first (Cowans: the Whiteley office, 12 machines on 10.0.0.x; Bernadett's home with two PCs). A machine alone on its connection
  is **Home and remote**. Key PCs (server, Sage, file) first in each site; machines quiet 30+ days last, dashed and faded.
- Sites are named once on the tab (`client_sites`, against the address); unnamed ones show "Site 2".
- **Lenses** colour every machine: **Health** (no Windows security updates red; old Office or support ending amber; from Upgrades),
  **Backups** (Coverage: backed up, warnings, failing, or a server with none; workstations without a plan grey), **Antivirus**
  (Webroot endpoint by hostname; none red unless quiet or a Mac). A green dot = on now. Legend per lens.
- **Cloud services** box: Microsoft 365 backup (accounts, SharePoint sites, Teams), Webroot count, Acronis machines, VoxOne seats.
  The main site's connection from the VoIP Unlimited dealer list where known (Ethernet, FTTP…).
- Click a machine: where, user, model, Windows, last seen, network, backup, each lens's verdict, Upgrades findings with the fix;
  **Help with this** and **Open in Atera**.
- **Download image** (SVG, light Visio-like colours, opens in Visio and browsers) and **Print or save as PDF** (A4 landscape, titled).

## Not done
- Network equipment (routers, firewalls, switches, Wi-Fi, NAS, printers): not in Atera; an "Add equipment" form per site was offered
  and left for later.
- Drag to rearrange (the layout is automatic so it never goes stale).
