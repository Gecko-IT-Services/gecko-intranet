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
import { adviceTopics, composeEmail, summaryFacts, adviceFacts, emailAuth, servicesFrom } from '../core/advice.js';
import { upgrades } from '../core/upgrades.js';
import { coverage, coverageFor } from '../core/coverage.js';
import { sameAteraClient } from '../core/devices.js';
import { sameClient } from '../core/client.js';
import { mainContact } from '../core/contacts.js';
import { vendorMarks } from '../core/vendors.js';
import { adviceFor, proposeFromAdvice } from './opportunities.js';

const AD = { client: '', data: null, error: null, loading: false, ticked: new Map(), subject: '', sending: false, open: new Set(), note: '', noteSaved: '', ai: null, writing: '' };
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const myName = () => (document.getElementById('userName')?.textContent || '').trim();
const SOURCE = { devices: ['blue', 'Devices'], protection: ['red', 'Protection'], opportunity: ['green', 'Opportunity'] };
const MARK = { windows: 'Windows', office: 'Microsoft Office', server: 'Windows', update: 'Windows', backup: 'Acronis backup' };
const same = (a, b) => sameAteraClient(a, b) || sameAteraClient(b, a) || sameClient(a, b);

/** The tab's markup; the first call for a client starts loading and the tab redraws itself when done. */
export function html(clientName) {
  if (AD.client !== clientName) { Object.assign(AD, { client: clientName, data: null, error: null, ticked: new Map(), subject: '', open: new Set(), note: '', noteSaved: '', ai: null, writing: '' }); load(clientName); }
  return `<div id="adMount">${body()}</div>`;
}

async function load(name) {
  AD.loading = true;
  try {
    const sb = await connectSupabase();
    const [agents, contacts, tenants, items, opp, notes, repeating, sites] = await Promise.all([
      sb.from('atera_agents').select('customer_name,machine_name,device_type,os,last_seen,last_user,model,online,raw').then(must),
      sb.from('client_contacts').select('*').then(must),
      sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
      sb.from('acronis_items').select('kind,tenant_id,raw').in('kind', ['resource_status', 'agent', 'usage']).then(must),
      adviceFor(name),
      // Before the notes table exists (this update), no note: the rest still works.
      sb.from('client_notes').select('*').then(({ data, error }) => (error ? [] : data || [])),
      sb.from('xero_repeating_invoices').select('contact_name,status,line_items').eq('status', 'AUTHORISED').then(must),
      sb.from('webroot_sites').select('name,raw').then(({ data, error }) => (error ? [] : data || []))
    ]);
    if (AD.client !== name) return;
    const up = upgrades(agents.filter(a => same(a.customer_name, name)), today()).clients[0] || null;
    const cov = coverageFor(coverage(tenants, items, agents, new Date()), name);
    const topics = adviceTopics({ client: name, device: up, coverage: cov, gaps: opp.gaps, products: opp.products });
    const main = mainContact(contacts.filter(c => same(c.client_name, name)), opp.contact ? { name: opp.contactName, email: opp.contact } : null);
    const note = notes.find(n => n.client_name === name) || notes.find(n => same(n.client_name, name));
    AD.note = AD.noteSaved = note?.setup || '';
    // What the AI writer may be told (client-facing only: see core/advice.js).
    const tenant = tenants.find(t => t.kind === 'customer' && same(t.name, name));
    const mine = tenant ? items.filter(i => i.tenant_id === tenant.tenant_id) : [];
    const use = n => mine.filter(i => i.kind === 'usage' && i.raw?.name === n).reduce((t, i) => t + (Number(i.raw?.value) || 0), 0);
    const acronis = tenant ? {
      machines: mine.filter(i => i.kind === 'resource_status' && /^resource\.machine/.test(i.raw?.context?.type || '') && (i.raw?.policies || []).length)
        .map(i => ({ name: i.raw.context.name, lastSuccess: (i.raw.policies || []).map(p => p.last_success_run).filter(Boolean).sort().pop() || null })),
      m365: use('pw_base_m365_seats') ? { accounts: use('pw_base_m365_seats'), sharepoint: use('pw_base_m365_sharepoint_sites') > 0, teams: use('pw_base_m365_teams') > 0,
        mailboxes: use('protected_mailbox_storage') > 0, onedrive: use('protected_one_drive_storage') > 0 } : null
    } : null;
    const lines = repeating.filter(r => same(r.contact_name, name)).flatMap(r => r.line_items || []);
    const site = sites.find(x => same(x.name, name) && x.raw?.Deactivated !== true && Number(x.raw?.TotalEndpoints) > 0);
    const myAgents = agents.filter(a => same(a.customer_name, name));
    AD.data = { topics, main, facts: { agents: myAgents, device: up, acronis, antivirus: !!site, services: servicesFrom(lines) } };
    emailCheck(main?.email);
    for (const t of topics) AD.ticked.set(t.key, t.checked);
  } catch (err) {
    if (AD.client === name) AD.error = err;
  } finally {
    AD.loading = false;
    draw();
  }
}

/** Public DNS for the client's email domain (from the main contact's address), for the summary's "email set-up" facts. */
async function emailCheck(address) {
  const domain = String(address || '').split('@')[1];
  if (!domain || !AD.data) return;
  const q = async (name, type) => {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
      return ((await r.json()).Answer || []).map(a => String(a.data || ''));
    } catch { return []; }
  };
  const [mx, txt, dmarc, dkim] = await Promise.all([q(domain, 'MX'), q(domain, 'TXT'), q('_dmarc.' + domain, 'TXT'), q('selector1._domainkey.' + domain, 'CNAME')]);
  if (AD.data) AD.data.email = emailAuth({ mx, txt, dmarc, dkim });
}

function draw() {
  const m = document.getElementById('adMount');
  if (m) m.innerHTML = body();
}

/** An AI email is showing and the setup notes have changed since it was written. */
const stale = () => !!AD.ai && !AD.writing && AD.note.trim() !== (AD.ai.noteUsed ?? '');
const chosen = () => (AD.data?.topics || []).filter(t => AD.ticked.get(t.key));
const firstName = () => String(AD.data?.main?.name || '').trim().split(/\s+/)[0] || '';
const sender = () => (myName() ? `Kind regards,\n${myName()}\nGecko IT Services` : 'Kind regards,\nGecko IT Services');

function body() {
  if (AD.error) return `<div class="cl-error art art-offline"><strong>Could not gather the advice for ${escapeHtml(AD.client)}.</strong>${escapeHtml(AD.error.message || AD.error)} <button type="button" class="btn btn-sm" data-ad-act="reload">Retry</button></div>`;
  if (!AD.data) return '<p class="cl-empty art art-loading">Gathering devices, backups and opportunities…</p>';
  const { topics, main } = AD.data;
  const picked = chosen();
  const mail = AD.ai ? null : picked.length ? composeEmail({ client: AD.client, firstName: firstName(), sender: sender(), topics: picked }) : null;
  const subject = AD.ai ? (AD.subject || AD.ai.subject) : (AD.subject || mail?.subject || '');
  const dirty = AD.note !== AD.noteSaved;
  const setup = `<section class="ad-setup">
    <header class="ad-head"><h2>How ${escapeHtml(AD.client)} is set up, in our words</h2>
      <p>Private to Gecko. Every AI email to ${escapeHtml(AD.client)} reads this first: people, sites, systems, what's agreed, the tone to use, what not to raise.</p></header>
    <textarea data-ad-note rows="6" maxlength="8000" placeholder="e.g. Chris Wyeth runs the office and signs off spend; cost-conscious, likes things explained simply. Two sites: Whitely and the Isle of Wight. Engineers use Tekla on the CAD PCs. Sage PC holds the accounts. Replacing the Sage PC was agreed in September. Don't mention email filtering until the new year.">${escapeHtml(AD.note)}</textarea>
    <div class="ad-do"><button type="button" class="btn btn-sm${dirty ? ' btn-primary' : ''}" data-ad-act="save-note"${dirty ? '' : ' disabled'}>${dirty ? 'Save' : 'Saved'}</button>
      <span>${AD.note.trim() ? '' : 'Nothing written yet: emails will only know what Gecko HQ can see.'}</span></div>
  </section>`;
  const list = topics.length ? `<ul class="ad-topics">${topics.map(topicHtml).join('')}</ul>` : '<p class="ad-none">Nothing to raise right now: every device is supported and nothing in the catalogue fits. An IT summary can still be written.</p>';
  const preview = AD.writing ? `<p class="ad-none">Writing the ${AD.writing === 'summary' ? 'IT summary' : 'email'}…</p>`
    : AD.ai ? AD.ai.html : mail ? mail.html : '<p class="ad-none">Tick at least one item to build the email, or write an IT summary.</p>';
  const can = !AD.writing && !AD.sending;
  return `${setup}<div class="ad-wrap">
    <section class="ad-col">
      <header class="ad-head"><h2>What to raise</h2><p>Tick what to include. Devices and backups come from Atera and Acronis; products from the Opportunities catalogue.</p></header>
      ${list}
    </section>
    <section class="ad-col ad-mail">
      <header class="ad-head"><h2>Email</h2><p>Saved to your Outlook Drafts, never sent from here. Check it, then send it yourself.</p></header>
      <div class="ad-card">
        <div class="ad-write">
          <button type="button" class="btn btn-sm btn-primary" data-ad-act="ai-advice"${can && picked.length ? '' : ' disabled'}>Write advice email with AI</button>
          <button type="button" class="btn btn-sm" data-ad-act="ai-summary"${can ? '' : ' disabled'}>Write “IT at a glance” with AI</button>
          ${AD.ai ? '<button type="button" class="btn btn-sm btn-ghost" data-ad-act="template">Back to the plain version</button>' : ''}
        </div>
        <p class="ad-mode">${AD.ai ? `Written by AI from the facts and your notes${AD.ai.costUsd ? ` (about ${escapeHtml((AD.ai.costUsd * 100).toFixed(1))}¢)` : ''}. Click into it to change anything.` : 'Plain version, built from the ticked items. AI writes a version that uses your notes.'}</p>
        <div class="ad-to">To ${main?.email ? `<strong>${escapeHtml(main.name || main.email)}</strong> <span>${escapeHtml(main.email)}</span>` : '<strong class="ad-warn">no main contact email</strong> <span>(add one on Details & contacts, or fill in the recipient in Outlook)</span>'}</div>
        <label class="ad-subject">Subject <input type="text" data-ad-subject value="${escapeHtml(subject)}" maxlength="200"${AD.ai || picked.length ? '' : ' disabled'}></label>
        <div class="ad-stale" data-ad-stale${stale() ? '' : ' hidden'}><span>Your notes have changed since this was written.</span>
          <button type="button" class="btn btn-sm btn-primary" data-ad-act="rewrite"${can ? '' : ' disabled'}>Rewrite with the updated notes</button></div>
        <div class="ad-preview"${AD.ai ? ' contenteditable="true" data-ad-preview' : ''}>${preview}</div>
        <div class="ad-do">
          <button type="button" class="btn btn-primary" data-ad-act="draft"${(AD.ai || picked.length) && can ? '' : ' disabled'}${AD.sending ? ' aria-busy="true"' : ''}>${AD.sending ? 'Saving draft…' : 'Draft email in Outlook'}</button>
          <span>${AD.ai ? (AD.ai.kind === 'summary' ? 'IT summary' : `${picked.length} item${picked.length === 1 ? '' : 's'}`) : `${picked.length} of ${topics.length} item${topics.length === 1 ? '' : 's'}`}${picked.some(t => t.productKey) && AD.ai?.kind !== 'summary' ? ' · products in it become Proposed in the pipeline' : ''}</span>
        </div>
      </div>
    </section>
  </div>`;
}

/** Ask the email writer (Edge Function) for an AI version: kind 'advice' (ticked items) or 'summary' (IT at a glance). */
async function writeWithAi(kind) {
  if (AD.writing) return;
  if (AD.note !== AD.noteSaved) await saveNote();
  const f = AD.data.facts;
  const facts = kind === 'summary'
    ? summaryFacts({ ...f, email: AD.data.email || null, topics: AD.data.topics.filter(t => t.key !== 'update' || AD.ticked.get(t.key)), today: today() })
    : adviceFacts(chosen());
  AD.writing = kind; AD.subject = ''; draw();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('email-writer', { body: { kind, client: AD.client, firstName: firstName(), sender: myName(), note: AD.note.trim(), facts } });
    if (error) throw new Error(error.message || 'The email writer didn’t answer');
    if (!data?.ok) throw new Error(data?.error || 'The email writer didn’t answer');
    AD.ai = { kind, subject: data.subject, html: data.html, costUsd: data.costUsd, noteUsed: AD.note.trim() };
  } catch (err) {
    toast(`AI couldn’t write it: ${err.message || err}`, 'error', 9000);
  } finally {
    AD.writing = ''; draw();
  }
}

async function saveNote() {
  const text = AD.note.trim();
  try {
    const sb = await connectSupabase({ interactive: true });
    must(await sb.from('client_notes').upsert({ client_name: AD.client, setup: text, updated_by: myName() }, { onConflict: 'client_name' }).select('client_name'));
    AD.noteSaved = AD.note;
    toast('Saved.', 'success');
  } catch (err) {
    toast(`Didn’t save the notes: ${err.message || err}`, 'error', 8000);
  }
  draw();
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
  if ((!picked.length && !AD.ai) || AD.sending) return;
  const edited = document.querySelector('[data-ad-preview]');
  const mail = AD.ai ? { subject: AD.ai.subject, html: edited ? edited.innerHTML : AD.ai.html } : composeEmail({ client: AD.client, firstName: firstName(), sender: sender(), topics: picked });
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
  if (AD.ai?.kind !== 'summary') { try { proposed = await proposeFromAdvice(AD.client, picked.map(t => t.productKey)); } catch { /* the draft is what matters; the deals can be added by hand */ } }
  toast(`Draft${main?.email ? ` to ${main.name || main.email}` : ''} saved in your Outlook Drafts${proposed ? ` · ${proposed} added to the pipeline as Proposed` : ''}.`, 'success', 7000);
  AD.sending = false; draw();
}

/** Clicks and typing inside the tab (the client page draws it; these listeners are added once). */
export function wire(root) {
  root.addEventListener('change', e => {
    const t = e.target.closest?.('[data-ad-tick]');
    if (t) { AD.ticked.set(t.dataset.adTick, t.checked); AD.subject = ''; if (AD.ai?.kind === 'advice') AD.ai = null; draw(); }
  });
  root.addEventListener('input', e => {
    const s = e.target.closest?.('[data-ad-subject]');
    if (s) AD.subject = s.value;
    const n = e.target.closest?.('[data-ad-note]');
    if (n) {
      AD.note = n.value;
      const b = document.querySelector('[data-ad-act="save-note"]');   // just the button: a redraw would lose the cursor
      if (b) { const dirty = AD.note !== AD.noteSaved; b.disabled = !dirty; b.textContent = dirty ? 'Save' : 'Saved'; b.classList.toggle('btn-primary', dirty); }
      const banner = document.querySelector('[data-ad-stale]');
      if (banner) banner.hidden = !stale();
    }
  });
  root.addEventListener('click', e => {
    const more = e.target.closest?.('[data-ad-more]');
    if (more) { const k = more.dataset.adMore; AD.open.has(k) ? AD.open.delete(k) : AD.open.add(k); draw(); return; }
    const a = e.target.closest?.('[data-ad-act]')?.dataset.adAct;
    if (a === 'draft') draft();
    if (a === 'save-note') saveNote();
    if (a === 'ai-advice') writeWithAi('advice');
    if (a === 'ai-summary') writeWithAi('summary');
    if (a === 'rewrite' && AD.ai) writeWithAi(AD.ai.kind);
    if (a === 'template') { AD.ai = null; AD.subject = ''; draw(); }
    if (a === 'reload') { const n = AD.client; AD.client = ''; html(n); draw(); }
  });
}
