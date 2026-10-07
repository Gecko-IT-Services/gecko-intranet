// SSA renewal — the pure half of Timesheets › SSA › "Renew".
// See docs/superpowers/specs/2026-10-07-ssa-renew-design.md.
//
// Today a renewal is: a System credit entry in SharePoint (−10 per block),
// wait for the "Update Client Balances" flow to apply it, press "Send
// Timesheet" (flow "Create Timesheets Table Email"), then raise the invoice
// in Xero by hand. The portal now does the first three in one go. This
// module holds what can be tested without a browser: which entries the
// email lists, the email itself, and the Xero lines to raise.
//
// Rule (Philip, 7 Oct 2026): the portal never writes HoursUsed. The flow
// applies the credit exactly as it does for a credit typed in SharePoint.

export const SSA_BLOCK_HOURS = 10;
/** £ ex VAT per 10-hour block — Xero item "SSA" on every renewal since Jun 2026. */
export const SSA_BLOCK_PRICE = 650;
export const SSA_VAT_RATE = 0.2;
export const SSA_MAX_BLOCKS = 5;

export const SSA_XERO = Object.freeze({
  itemCode: 'SSA',
  description: 'Software Support Agreement - 10 hours',
  accountCode: '214',
  reference: 'Renewal'
});

/** The logo the flow's email uses (hosted on the Gecko website). */
export const EMAIL_LOGO_URL = 'https://static.wixstatic.com/media/5ed978_88e9bb0b8dbe4af5b39c613f5fe36e77~mv2.png';
export const EMAIL_SUBJECT = 'Latest Timesheet';

const TZ = 'Europe/London';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Whole blocks between 1 and SSA_MAX_BLOCKS, or null. */
export function validBlocks(n) {
  const b = Number(n);
  return Number.isInteger(b) && b >= 1 && b <= SSA_MAX_BLOCKS ? b : null;
}

/** The credit entry, in the same words as the ones typed in SharePoint. */
export function creditEntry(blocks) {
  const hours = blocks * SSA_BLOCK_HOURS;
  return { engineer: 'System', hours: -hours, description: `Credit - ${hours} Hours` };
}

/** YYYY-MM-DD of a SharePoint date as it reads in the UK. */
export function ukDateKey(value) {
  if (!value) return '';
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function ukDisplayDate(key) {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Entries the timesheet email lists: everything after the client's
 * PREVIOUS credit — the flow takes the two latest credits by date and
 * starts from the older one, so the email covers the work since the last
 * renewal plus the credit just added.
 *
 * The flow compares a UK date against a UTC timestamp, which in summer drops
 * entries dated the same day as the previous credit and in winter keeps the
 * previous credit itself. Here: entries dated after the previous credit, or
 * on the same day and created after it (higher ID). Archived entries count;
 * the flow does not filter them either.
 *
 * entries: [{ id, date, hours, ... }] for ONE client; date as SharePoint gives it.
 */
export function timesheetEntries(entries) {
  const withKey = entries.map(e => ({ ...e, dateKey: ukDateKey(e.date), idNum: Number(e.id) }));
  const credits = withKey.filter(e => e.hours < 0)
    .sort((a, b) => (b.dateKey.localeCompare(a.dateKey)) || (b.idNum - a.idNum));
  const prev = credits.length >= 2 ? credits[1] : null;
  const picked = prev
    ? withKey.filter(e => e.dateKey > prev.dateKey || (e.dateKey === prev.dateKey && e.idNum > prev.idNum))
    : withKey;
  return picked.sort((a, b) => (b.dateKey.localeCompare(a.dateKey)) || (a.idNum - b.idNum));
}

function fmtHours(h) { return (Math.round(h * 100) / 100).toFixed(2); }

/** One email row, worded as the flow words it. */
export function emailRow(e) {
  const credit = e.hours < 0;
  const credited = -e.hours;
  return {
    date: ukDisplayDate(e.dateKey || ukDateKey(e.date)),
    engineer: e.engineer || '',
    hours: credit ? '+' + fmtHours(credited) : fmtHours(e.hours),
    // The flow always said "10 hours"; a 2-block credit now says 20.
    description: credit ? `Credit – ${fmtHours(credited).replace(/\.00$/, '')} hours (SSA renewal)` : (e.workDescription || e.description || '')
  };
}

const FONT = 'font-family:Aptos,Calibri,Segoe UI,Arial,sans-serif;';
const TH = 'background:#f3f4f6;border:1px solid #e5e7eb;padding:8px;text-align:left;font-weight:700;';
const TD = 'border:1px solid #e5e7eb;padding:8px;vertical-align:top;word-break:normal;overflow-wrap:break-word;';

/**
 * The email body, matching "Create Timesheets Table Email": greeting, then a
 * card with the logo, client, run date, current balance and the entries.
 */
export function emailHtml({ clientName, primaryContact, runDateKey, hoursRemaining, rows }) {
  const bal = Number(hoursRemaining) || 0;
  const badge = `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${bal >= 1 ? '#dcfce7' : '#fee2e2'};color:${bal >= 1 ? '#166534' : '#991b1b'};font-weight:800;">${fmtHours(bal)} hours</span>`;
  const body = rows.map(r => `<tr><td style="${TD}">${esc(r.date)}</td><td style="${TD}">${esc(r.engineer)}</td><td style="${TD}">${esc(r.hours)}</td><td style="${TD}">${esc(r.description)}</td></tr>`).join('');
  return `<p>To ${esc(primaryContact || clientName)},<br><br>Please find attached your latest timesheet for your perusal. If you have any issues or queries, please do not hesitate to contact us.<br><br>Kind regards,<br><br>Gecko IT Services<br>02381 800171<br>support@gecko-it.com</p><br>`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0;padding:0;background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">`
    + `<table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0" style="width:720px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">`
    + `<tr><td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;"><tr>`
    + `<td style="width:90px;vertical-align:middle;"><img src="${EMAIL_LOGO_URL}" width="70" alt="Gecko IT Services" style="display:block;border:0;height:auto;"></td>`
    + `<td style="vertical-align:middle;${FONT}"><div style="font-size:18px;font-weight:700;color:#111827;">Latest Timesheet Entries</div><div style="margin-top:4px;font-size:13px;color:#6b7280;">Client: ${esc(clientName)}</div></td>`
    + `<td align="right" style="vertical-align:top;${FONT}font-size:13px;color:#6b7280;white-space:nowrap;">${esc(ukDisplayDate(runDateKey))}</td>`
    + `</tr></table><div style="margin-top:14px;${FONT}font-size:14px;"><strong>Current balance:</strong> ${badge}</div></td></tr>`
    + `<tr><td style="padding:8px 20px 20px 20px;${FONT}font-size:13px;color:#111827;"><table style="width:100%;border-collapse:collapse;"><thead><tr>`
    + `<th style="${TH}width:95px;white-space:nowrap;">Date</th><th style="${TH}width:90px;white-space:nowrap;">Engineer</th><th style="${TH}width:60px;white-space:nowrap;">Hours</th><th style="${TH}">Description</th>`
    + `</tr></thead><tbody>${body}</tbody></table></td></tr>`
    + `<tr><td style="padding:12px 20px;border-top:1px solid #e5e7eb;${FONT}font-size:12px;color:#6b7280;">Gecko IT Services</td></tr>`
    + `</table></td></tr></table>`;
}

/** Recipients from the Clients list "Email" column (may hold several). */
export function recipients(emailField) {
  return String(emailField || '').split(/[;,\s]+/).map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

/** The copy the flow saves to Gecko Docs/clients/<folder>/. UTC, as the flow does. */
export function archiveFileName(clientName, now) {
  const d = new Date(now);
  const p = n => String(n).padStart(2, '0');
  const safe = String(clientName).replace(/[\\/:*?"<>|#%]/g, '-');
  return `Timesheet Summary - ${safe} - ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} - ${p(d.getUTCHours())}${p(d.getUTCMinutes())}.html`;
}

/**
 * Has the "Update Client Balances" flow applied the credit? It adds the
 * credit's (negative) hours to HoursUsed. Another entry logged in the same
 * minute could add a little back, so a drop of more than half the credit
 * counts as applied.
 */
export function creditApplied(hoursUsedBefore, hoursUsedNow, creditHours) {
  return Number(hoursUsedBefore) - Number(hoursUsedNow) > creditHours / 2;
}

/** What to type into Xero. Money to the penny; VAT at 20%. */
export function xeroInvoice(blocks) {
  const net = Math.round(blocks * SSA_BLOCK_PRICE * 100) / 100;
  const vat = Math.round(net * SSA_VAT_RATE * 100) / 100;
  return { ...SSA_XERO, quantity: blocks, unitAmount: SSA_BLOCK_PRICE, net, vat, total: Math.round((net + vat) * 100) / 100 };
}
