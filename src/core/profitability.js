/* Profitability: which clients need a look (no window). Tested in tests/profitability.mjs.
   Design: docs/superpowers/specs/2026-10-09-simpler-profitability-design.md

   One client, one month, as the page works it out (prfClientHeadline): revenue (Xero recurring on
   months the feed covers, else the typed lines), cost (lines + supplier invoices dated that month),
   the monthly lines' sell (hosting already off them on feed months) and what Xero billed. */

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const gbp = n => '£' + round2(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const THIN_MARGIN = 0.4;   // the red margin colour's line
export const UNDER_BY = 1;        // Xero more than £1 under the lines: pennies of rounding aren't a flag

/**
 * row: { sell, cost, lines, fromXero, xeroTotal, xeroRecurring, month, current } (months 'YYYY-MM')
 * → [{ key, level: 'red'|'amber', text }], most serious first; [] when nothing needs a look.
 */
export function flags({ sell = 0, cost = 0, lines = 0, fromXero = false, xeroTotal = 0, xeroRecurring = 0, month = '', current = '' }) {
  const billed = Number(xeroTotal) > 0;
  // The current month on the feed, before the client's invoice goes out: nothing to judge yet.
  if (fromXero && !billed && month >= current) return [];
  const out = [];
  const gp = round2(sell - cost);
  if (gp < 0) out.push({ key: 'losing', level: 'red', text: 'Losing money' });
  else if (sell > 0 && gp / sell < THIN_MARGIN) out.push({ key: 'thin', level: 'amber', text: 'Thin margin' });
  if (fromXero && billed && round2(lines - xeroRecurring) > UNDER_BY) {
    out.push({ key: 'under', level: 'amber', text: `Xero ${gbp(lines - xeroRecurring)} under lines` });
  }
  if (fromXero && !billed && lines > 0) out.push({ key: 'unbilled', level: 'amber', text: 'Not billed in Xero' });
  return out;
}
