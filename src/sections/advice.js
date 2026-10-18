/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   UPGRADES & ADVICE (client page tab)                             ║
   ║                                                                   ║
   ║   Everything worth raising with one client: devices to upgrade or ║
   ║   replace, servers, old Office, machines with no backup, and the  ║
   ║   Opportunities catalogue's gaps. Tick what to include and Draft  ║
   ║   email writes one friendly email to the main contact in your     ║
   ║   Outlook Drafts (never sent). Products in it become Proposed.    ║
   ║   Logic: core/advice.js. Design: docs/superpowers/specs/          ║
   ║   2026-10-18-client-advice-email-design.md                        ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml } from '../core/ui.js';
import { graphFetch } from '../core/graph.js';
import { connectSupabase } from '../core/supabase.js';
import { adviceTopics, composeEmail } from '../core/advice.js';
import { upgrades } from '../core/upgrades.js';
import { coverage, coverageFor } from '../core/coverage.js';
import { sameAteraClient } from '../core/devices.js';
import { sameClient } from '../core/client.js';
import { mainContact } from '../core/contacts.js';
import { vendorMarks } from '../core/vendors.js';
import { adviceFor, proposeFromAdvice } from './opportunities.js';

const AD = { client: '', data: null, error: null, loading: false, ticked: new Map(), subject: '', sending: false, open: new Set() };
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const myName = () => (document.getElementById('userName')?.textContent || '').trim();
const SOURCE = { devices: ['blue', 'Devices'], protection: ['red', 'Protection'], opportunity: ['green', 'Opportunity'] };
const MARK = { windows: 'Windows', office: 'Microsoft Office', server: 'Windows', update: 'Windows', backup: 'Acronis backup' };
const same = (a, b) => sameAteraClient(a, b) || sameAteraClient(b, a) || sameClient(a, b);

/** The tab's markup; the first call for a client starts loading and the tab redraws itself when done. */
export function html(clientName) {
  if (AD.client !== clientName) { Object.assign(AD, { client: clientName, data: null, error: null, ticked: new Map(), subject: '', open: new Set() }); load(clientName); }
  return `<div id="adMount">${body()}</div>`;
}

async function load(name) {
  AD.loading = true;
  try {
    const sb = await connectSupabase();
    const [agents, contacts, tenants, items, opp] = await Promise.all([
      sb.from('atera_agents').select('customer_name,machine_name,device_type,os,last_seen,last_user,model,online,raw').then(must),
      sb.from('client_contacts').select('*').then(must),
      sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
      sb.from('acronis_items').select('kind,tenant_id,raw').in('kind', ['resource_status', 'agent', 'usage']).then(must),
      adviceFor(name)
    ]);
    if (AD.client !== name) return;
    const up = upgrades(agents.filter(a => same(a.customer_name, name)), today()).clients[0] || null;
    const cov = coverageFor(coverage(tenants, items, agents, new Date()), name);
    const topics = adviceTopics({ client: name, device: up, coverage: cov, gaps: opp.gaps, products: opp.products });
    const main = mainContact(contacts.filter(c => same(c.client_name, name)), opp.contact ? { name: opp.contactName, email: opp.contact } : null);
    AD.data = { topics, main };
    for (const t of topics) AD.ticked.set(t.key, t.checked);
  } catch (err) {
    if (AD.client === name) AD.error = err;
  } finally {
    AD.loading = false;
    draw();
  }
}

function draw() {
  const m = document.getElementById('adMount');
  if (m) m.innerHTML = body();
}

const chosen = () => (AD.data?.topics || []).filter(t => AD.ticked.get(t.key));
const firstName = () => String(AD.data?.main?.name || '').trim().split(/\s+/)[0] || '';
const sender = () => (myName() ? `Kind regards,\n${myName()}\nGecko IT Services` : 'Kind regards,\nGecko IT Services');

function body() {
  if (AD.error) return `<div class="cl-error art art-offline"><strong>Could not gather the advice for ${escapeHtml(AD.client)}.</strong>${escapeHtml(AD.error.message || AD.error)} <button type="button" class="btn btn-sm" data-ad-act="reload">Retry</button></div>`;
  if (!AD.data) return '<p class="cl-empty art art-loading">Gathering devices, backups and opportunities…</p>';
  const { topics, main } = AD.data;
  if (!topics.length) return '<div class="ad-wrap"><p class="ad-none">Nothing to raise with this client right now: every device is supported and nothing in the catalogue fits.</p></div>';
  const picked = chosen();
  const mail = picked.length ? composeEmail({ client: AD.client, firstName: firstName(), sender: sender(), topics: picked }) : null;
  const subject = AD.subject || mail?.subject || '';
  return `<div class="ad-wrap">
    <section class="ad-col">
      <header class="ad-head"><h2>What to raise with ${escapeHtml(AD.client)}</h2><p>Tick what to include. Devices and backups come from Atera and Acronis; products from the Opportunities catalogue.</p></header>
      <ul class="ad-topics">${topics.map(topicHtml).join('')}</ul>
    </section>
    <section class="ad-col ad-mail">
      <header class="ad-head"><h2>Email</h2><p>Saved to your Outlook Drafts, never sent from here. Check it, then send it yourself.</p></header>
      <div class="ad-card">
        <div class="ad-to">To ${main?.email ? `<strong>${escapeHtml(main.name || main.email)}</strong> <span>${escapeHtml(main.email)}</span>` : '<strong class="ad-warn">no main contact email</strong> <span>(add one on Details & contacts, or fill in the recipient in Outlook)</span>'}</div>
        <label class="ad-subject">Subject <input type="text" data-ad-subject value="${escapeHtml(subject)}" maxlength="200"${picked.length ? '' : ' disabled'}></label>
        <div class="ad-preview">${mail ? mail.html : '<p class="ad-none">Tick at least one item to build the email.</p>'}</div>
        <div class="ad-do">
          <button type="button" class="btn btn-primary" data-ad-act="draft"${picked.length && !AD.sending ? '' : ' disabled'}${AD.sending ? ' aria-busy="true"' : ''}>${AD.sending ? 'Saving draft…' : 'Draft email in Outlook'}</button>
          <span>${picked.length} of ${topics.length} item${topics.length === 1 ? '' : 's'}${picked.some(t => t.productKey) ? ' · products in it become Proposed in the pipeline' : ''}</span>
        </div>
      </div>
    </section>
  </div>`;
}

function topicHtml(t) {
  const on = !!AD.ticked.get(t.key);
  const open = AD.open.has(t.key);
  const shown = open ? t.items : t.items.slice(0, 4);
  const why = String(t.why || '').split(/(?<=\.)\s/)[0];
  return `<li class="ad-topic${on ? ' on' : ''}">
    <label class="ad-tick"><input type="checkbox" data-ad-tick="${escapeHtml(t.key)}"${on ? ' checked' : ''}>
      <span class="ad-title">${vendorMarks(MARK[t.key] || t.title)}${escapeHtml(t.title)}</span>
      <span class="badge badge-${SOURCE[t.source][0]}">${escapeHtml(SOURCE[t.source][1])}</span></label>
    ${why ? `<p class="ad-why">${escapeHtml(why)}</p>` : ''}
    ${t.summary ? `<p class="ad-sum">${escapeHtml(t.summary)}</p>` : ''}
    ${shown.length ? `<ul class="ad-items">${shown.map(i => (i.note ? `<li><strong>${escapeHtml(i.name)}</strong> <span>${escapeHtml(i.note)}</span></li>` : `<li><span>${escapeHtml(i.name)}</span></li>`)).join('')}</ul>` : ''}
    ${t.items.length > 4 ? `<button type="button" class="ad-more" data-ad-more="${escapeHtml(t.key)}">${open ? 'Show fewer' : `and ${t.items.length - 4} more`}</button>` : ''}
    ${t.price ? `<p class="ad-price">${escapeHtml(t.price)}</p>` : ''}
  </li>`;
}

async function draft() {
  const picked = chosen();
  if (!picked.length || AD.sending) return;
  const mail = composeEmail({ client: AD.client, firstName: firstName(), sender: sender(), topics: picked });
  const main = AD.data.main;
  AD.sending = true; draw();
  try {
    await graphFetch('/me/messages', {
      method: 'POST', scopes: ['Mail.ReadWrite'], interactive: true,
      body: JSON.stringify({ subject: AD.subject || mail.subject, body: { contentType: 'HTML', content: mail.html },
        toRecipients: main?.email ? [{ emailAddress: { address: main.email, name: main.name || undefined } }] : [] })
    });
  } catch (err) {
    toast(`Could not create the draft: ${err.message || err}`, 'error', 8000);
    AD.sending = false; draw();
    return;
  }
  // The draft exists now: a failure below must not read as "no draft" (a second click would make another).
  let proposed = 0;
  try { proposed = await proposeFromAdvice(AD.client, picked.map(t => t.productKey)); } catch { /* the draft is what matters; the deals can be added by hand */ }
  toast(`Draft${main?.email ? ` to ${main.name || main.email}` : ''} saved in your Outlook Drafts${proposed ? ` · ${proposed} added to the pipeline as Proposed` : ''}.`, 'success', 7000);
  AD.sending = false; draw();
}

/** Clicks and typing inside the tab (the client page draws it; these listeners are added once). */
export function wire(root) {
  root.addEventListener('change', e => {
    const t = e.target.closest?.('[data-ad-tick]');
    if (t) { AD.ticked.set(t.dataset.adTick, t.checked); AD.subject = ''; draw(); }
  });
  root.addEventListener('input', e => {
    const s = e.target.closest?.('[data-ad-subject]');
    if (s) AD.subject = s.value;
  });
  root.addEventListener('click', e => {
    const more = e.target.closest?.('[data-ad-more]');
    if (more) { const k = more.dataset.adMore; AD.open.has(k) ? AD.open.delete(k) : AD.open.add(k); draw(); return; }
    const a = e.target.closest?.('[data-ad-act]')?.dataset.adAct;
    if (a === 'draft') draft();
    if (a === 'reload') { const n = AD.client; AD.client = ''; html(n); draw(); }
  });
}
