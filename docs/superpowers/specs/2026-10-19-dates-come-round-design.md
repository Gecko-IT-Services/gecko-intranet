# Dates that come round (19 Oct 2026)

## Why
Philip: "yes build the dates next". Renewals and deadlines are easy to miss and each is a reason to talk to the client: raise them early
enough to act on, and to sell with.

## What it does (`core/dates.js` `comingUp`, tests `tests/dates.mjs`)
| Kind | From | Raised | Group |
|---|---|---|---|
| Annual renewal | Xero repeating invoices every 11 or 12 months (hosting, domains), with the total | 60 days ahead | money: check what they use, offer more |
| Domain expiry | `domain_dates` (new): domains on Xero lines, contacts' email domains, client websites; expiry from public RDAP | 60 days | billed by us: **protect** (renew at the registrar); not ours: offer to look after it (protect inside 14 days) |
| VoIP contract end | `voip_dealer_services.contract_end` | 90 days | money: renew through the dealer account |
| PSTN switch-off | dealer services on PSTN, `PSTN_OFF` 31 Jan 2027 | 180 days | money: SOGEA, FTTP or VoxOne |
| End of support | Upgrades findings marked soon, now carrying `ends` (servers, Windows 11 versions, Office) | 120 days | money: plan the replacement |

- Into **Do next** (ranked: protect first; money by value × urgency: ×3 inside 14 days, ×2 inside 30) and the **Monday brief**'s new
  **Coming up** section (soonest first, "in N days", value).
- `domain-check` Edge Function (no secrets): Mondays 05:23 UTC and on demand; Nominet RDAP for .uk, rdap.org for the rest; free-mail
  domains (gmail, outlook, btinternet…) and gecko-it.com skipped; errors kept per domain, the last good date kept.

## Not done
- **Warranty dates** (Dell, Lenovo): their warranty APIs need a registered developer account and key each; possible later with Philip's sign-up.
- SSL certificates: they renew themselves on almost every client site; not worth the noise.
