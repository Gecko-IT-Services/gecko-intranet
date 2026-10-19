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
import { adviceTopics, composeEmail, summaryFacts, adviceFacts, emailAuth, servicesFrom, withM365Cover, leaveOut, itemKey, factsPanel, checkEmail,
  withEvidence, themeFigures, quarterFacts } from '../core/advice.js';
import { upgrades } from '../core/upgrades.js';
import { coverage, coverageFor } from '../core/coverage.js';
import { sameAteraClient } from '../core/devices.js';
import { readAll } from '../core/rows.js';
import { sameClient } from '../core/client.js';
import { mainContact } from '../core/contacts.js';
import { vendorMarks } from '../core/vendors.js';
import { adviceFor, proposeFromAdvice } from './opportunities.js';

const AD = { client: '', data: null, error: null, loading: false, ticked: new Map(), subject: '', sending: false, open: new Set(), note: '', noteSaved: '', leftOut: [], ai: null, writing: '' };
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const daysAgo = n => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const KIND = { advice: 'email', summary: 'IT summary', review: 'quarterly review' };
const myName = () => (document.getElementById('userName')?.textContent || '').trim();
const SOURCE = { devices: ['blue', 'Devices'], protection: ['red', 'Protection'], opportunity: ['green', 'Opportunity'] };
const MARK = { windows: 'Windows', office: 'Microsoft Office', server: 'Windows', update: 'Windows', backup: 'Acronis backup' };
const same = (a, b) => sameAteraClient(a, b) || sameAteraClient(b, a) || sameClient(a, b);

/** The tab's markup; the first call for a client starts loading and the tab redraws itself when done. */
export function html(clientName) {
  if (AD.client !== clientName) { Object.assign(AD, { client: clientName, data: null, error: null, ticked: new Map(), subject: '', open: new Set(), note: '', noteSaved: '', leftOut: [], ai: null, writing: '', evidence: null, finding: false }); load(clientName); }
  return `<div id="adMount">${body()}</div>`;
}

async function load(name) {
  AD.loading = true;
  try {
    const sb = await connectSupabase();
    const [agents, contacts, tenants, items, opp, notes, repeating, sites, ssaRows, insights] = await Promise.all([
      sb.from('atera_agents').select('customer_name,machine_name,device_type,os,last_seen,last_user,model,online,raw').then(must),
      sb.from('client_contacts').select('*').then(must),
      sb.from('acronis_tenants').select('tenant_id,name,kind').then(must),
      readAll(() => sb.from('acronis_items').select('kind,tenant_id,raw').in('kind', ['resource_status', 'agent', 'usage']).order('kind').order('item_id')),
      adviceFor(name),
      // Before the notes table exists (this update), no note: the rest still works.
      sb.from('client_notes').select('*').then(({ data, error }) => (error ? [] : data || [])),
      sb.from('xero_repeating_invoices').select('contact_name,status,line_items').eq('status', 'AUTHORISED').then(must),
      sb.from('webroot_sites').select('name,raw').then(({ data, error }) => (error ? [] : data || [])),
      sb.from('ssa_clients').select('id,name').then(must),
      // Before the insights table exists (this update), none: the rest still works.
      sb.from('client_insights').select('*').eq('kind', 'evidence').order('created_at', { ascending: false }).then(({ data, error }) => (error ? [] : data || []))
    ]);
    if (AD.client !== name) return;
    // Six months of the client's own timesheet notes, for "What we keep fixing" (timesheets hold SSA clients' work).
    const ssaIds = ssaRows.filter(r => same(r.name, name)).map(r => r.id);
    const since = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
    const entries = ssaIds.length ? await readAll(() => sb.from('timesheet_entries').select('id,entry_date,title,work_description,work_type,hours,engineer')
      .in('client_id', ssaIds).gte('entry_date', since).is('deleted_at', null).gt('hours', 0).neq('engineer', 'System').order('id')) : [];
    AD.evidence = insights.find(i => same(i.client_name, name)) || null;
    const up = upgrades(agents.filter(a => same(a.customer_name, name)), today()).clients[0] || null;
    const cov = coverageFor(coverage(tenants, items, agents, new Date()), name);
    const main = mainContact(contacts.filter(c => same(c.client_name, name)), opp.contact ? { name: opp.contactName, email: opp.contact } : null);
    const note = notes.find(n => n.client_name === name) || notes.find(n => same(n.client_name, name));
    AD.note = AD.noteSaved = note?.setup || '';
    AD.leftOut = Array.isArray(note?.left_out) ? note.left_out : [];
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
    const topics = withM365Cover(adviceTopics({ client: name, device: up, coverage: cov, gaps: opp.gaps, products: opp.products }), acronis?.m365 || null);
    const extra = { more: opp.more || [], products: opp.products, m365: acronis?.m365 || null };
    const lines = repeating.filter(r => same(r.contact_name, name)).flatMap(r => r.line_items || []);
    const site = sites.find(x => same(x.name, name) && x.raw?.Deactivated !== true && Number(x.raw?.TotalEndpoints) > 0);
    const myAgents = agents.filter(a => same(a.customer_name, name));
    AD.data = { topics, main, ...extra, entries, facts: { agents: myAgents, device: up, acronis, antivirus: site ? Number(site.raw?.TotalEndpoints) || true : 0, services: servicesFrom(lines) } };
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
  if (AD.data) { AD.data.email = emailAuth({ mx, txt, dmarc, dkim }); draw(); }
}

function draw() {
  const m = document.getElementById('adMount');
  if (m) m.innerHTML = body();
}

/** The ticked topics, without the machines left out. */
const themes = () => AD.evidence?.data?.themes || [];
const chosen = () => withEvidence(leaveOut((AD.data?.topics || []).filter(t => AD.ticked.get(t.key)), AD.leftOut), themes());
/** What the AI is told for an email of this kind, as things stand now. */
function currentFacts(kind) {
  const f = AD.data.facts;
  // The quarterly review: IT at a glance plus the last three months of support (Gecko HQ's sums from the timesheets).
  if (kind === 'review') return { ...currentFacts('summary'), lastThreeMonths: quarterFacts(AD.data.entries || [], { from: daysAgo(91), to: today() }) };
  return kind === 'summary'
    ? summaryFacts({ ...f, email: AD.data.email || null, topics: chosen(), leftOut: AD.leftOut, themes: themes(), today: today() })   // the ticked topics only
    : adviceFacts(chosen(), AD.leftOut);
}
/** An AI email is showing and the notes, ticks or left-out machines have changed since it was written. */
const stale = () => !!AD.ai && !AD.writing && (AD.note.trim() !== (AD.ai.noteUsed ?? '') || JSON.stringify(currentFacts(AD.ai.kind).recommendations) !== AD.ai.recsUsed
  || JSON.stringify(AD.leftOut) !== AD.ai.leftUsed);
/** Gecko HQ's check of the AI email as it reads now (edits included). */
function checks(fromScreen = false) {
  if (!AD.ai || AD.writing) return '';
  const shown = fromScreen ? document.querySelector('[data-ad-preview]') : null;
  const text = shown ? shown.innerText : AD.ai.html.replace(/<\/(p|li|h3)>|<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  const found = checkEmail(text, { facts: AD.ai.facts, note: AD.ai.noteUsed, machines: (AD.data.facts.agents || []).map(a => a.machine_name), leftOut: AD.leftOut });
  return found.length
    ? `<div class="ad-checks"><strong>Check before sending (${found.length})</strong><ul>${found.map(f => `<li class="ad-check-${f.level}">${escapeHtml(f.text)}</li>`).join('')}</ul><p>Fix it in the email below (the list updates as you type), or change the facts and rewrite.</p></div>`
    : '<div class="ad-checks ad-checks-ok">Gecko HQ’s checks found nothing: no internal names, numbers match the facts, nothing already covered is offered. Still give it a read.</div>';
}
/** What the AI will be told, to read before spending anything. */
function factsBox() {
  const f = currentFacts('review');
  const rows = factsPanel(f, { kind: 'summary', antivirusCount: typeof AD.data.facts.antivirus === 'number' ? AD.data.facts.antivirus : null,
    sell: chosen().filter(t => t.productKey) });
  const pick = label => rows.find(r => r[0] === label)?.[1] || '';
  const head = [chosen().some(t => t.productKey) ? `selling ${chosen().filter(t => t.productKey).length}` : 'nothing to sell ticked', pick('Computers').split(';')[0], pick('Antivirus') && `antivirus ${pick('Antivirus').split(';')[0]}`, pick('Microsoft 365 backup').split(';')[0],
    `${f.recommendations.length} recommendation${f.recommendations.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return `<details class="ad-facts"${AD.factsOpen ? ' open' : ''} data-ad-facts>
    <summary>What the AI will be told <span>${escapeHtml(head)}</span></summary>
    <dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
    <p>Plus your note. The quarterly review gets all of this; “IT at a glance” all but the last three months; an advice email only the recommendations. Antivirus counts are for you: the email is only told “in place” or “on every computer”.</p>
  </details>`;
}
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
      <p>Private to Gecko. Background for every AI email to ${escapeHtml(AD.client)}: what they have, how they work, the people and the feel of the place, so it writes like someone who knows them. To keep a machine out of an email, untick it under What to raise.</p></header>
    <textarea data-ad-note rows="6" maxlength="8000" placeholder="e.g. Chris Wyeth runs the office day to day and signs off spend; Tim Button is MD. Two sites: Whiteley and the Isle of Wight, with two people working from home in Swindon and Poland. Engineers draw in AutoCAD and SCIA; everyday files live in SharePoint. Sage runs on its own PC. Friendly, practical people who like things explained simply.">${escapeHtml(AD.note)}</textarea>
    <div class="ad-do"><button type="button" class="btn btn-sm${dirty ? ' btn-primary' : ''}" data-ad-act="save-note"${dirty ? '' : ' disabled'}>${dirty ? 'Save' : 'Saved'}</button>
      <span>${AD.note.trim() ? '' : 'Nothing written yet: emails will only know what Gecko HQ can see.'}</span></div>
  </section>`;
  const canAdd = (AD.data.more || []).filter(m => !topics.some(t => t.productKey === m.product.key));
  // Any catalogue product they don't have, for what Gecko HQ can't see (Philip, 19 Oct 2026: "this is a sales tool").
  const add = canAdd.length ? `<label class="ad-add"><span>Add a product to sell</span><select data-ad-add><option value="">Choose from the catalogue…</option>${canAdd.map(m => `<option value="${escapeHtml(m.product.key)}">${escapeHtml(m.product.name)}${m.deal ? ` (${m.deal.status === 'proposed' ? 'Proposed' : 'idea'} in the pipeline)` : ''}</option>`).join('')}</select></label>` : '';
  const list = (topics.length ? `<ul class="ad-topics">${topics.map(topicHtml).join('')}</ul>` : '<p class="ad-none">Nothing to raise right now: every device is supported and nothing in the catalogue fits. Add a product below, or write an IT summary.</p>') + add;
  const preview = AD.writing ? `<p class="ad-none">Writing the ${KIND[AD.writing]}…</p>`
    : AD.ai ? AD.ai.html : mail ? mail.html : '<p class="ad-none">Tick at least one item to build the email, or write an IT summary.</p>';
  const can = !AD.writing && !AD.sending;
  return `${setup}<div class="ad-wrap">
    <section class="ad-col">
      ${evidenceHtml()}
      <header class="ad-head"><h2>What to raise</h2><p>Tick what to include. Devices and backups come from Atera and Acronis; products from the Opportunities catalogue.</p></header>
      ${list}
    </section>
    <section class="ad-col ad-mail">
      <header class="ad-head"><h2>Email</h2><p>Saved to your Outlook Drafts, never sent from here. Check it, then send it yourself.</p></header>
      <div class="ad-card">
        <div class="ad-write">
          <button type="button" class="btn btn-sm btn-primary" data-ad-act="ai-advice"${can && picked.length ? '' : ' disabled'}>Write advice email with AI</button>
          <button type="button" class="btn btn-sm" data-ad-act="ai-summary"${can ? '' : ' disabled'}>Write “IT at a glance” with AI</button>
          <button type="button" class="btn btn-sm" data-ad-act="ai-review"${can ? '' : ' disabled'}>Write quarterly review with AI</button>
          ${AD.ai?.kind === 'review' ? '<button type="button" class="btn btn-sm btn-ghost" data-ad-act="print">Print or save as PDF</button>' : ''}
          ${AD.ai ? '<button type="button" class="btn btn-sm btn-ghost" data-ad-act="template">Back to the plain version</button>' : ''}
        </div>
        <p class="ad-mode">${AD.ai ? `Written by AI from the facts and your notes${AD.ai.costUsd ? ` (about ${escapeHtml((AD.ai.costUsd * 100).toFixed(1))}¢)` : ''}. Click into it to change anything.` : 'Plain version, built from the ticked items. AI writes a version that uses your notes.'}</p>
        <div class="ad-to">To ${main?.email ? `<strong>${escapeHtml(main.name || main.email)}</strong> <span>${escapeHtml(main.email)}</span>` : '<strong class="ad-warn">no main contact email</strong> <span>(add one on Details & contacts, or fill in the recipient in Outlook)</span>'}</div>
        <label class="ad-subject">Subject <input type="text" data-ad-subject value="${escapeHtml(subject)}" maxlength="200"${AD.ai || picked.length ? '' : ' disabled'}></label>
        ${factsBox()}
        <div class="ad-stale" data-ad-stale${stale() ? '' : ' hidden'}><span>Your notes or what’s ticked have changed since this was written.</span>
          <button type="button" class="btn btn-sm btn-primary" data-ad-act="rewrite"${can ? '' : ' disabled'}>Rewrite with the updated notes</button></div>
        <div data-ad-checks>${AD.ai && !AD.writing ? checks() : ''}</div>
        <div class="ad-preview"${AD.ai ? ' contenteditable="true" data-ad-preview' : ''}>${preview}</div>
        <div class="ad-do">
          <button type="button" class="btn btn-primary" data-ad-act="draft"${(AD.ai || picked.length) && can ? '' : ' disabled'}${AD.sending ? ' aria-busy="true"' : ''}>${AD.sending ? 'Saving draft…' : 'Draft email in Outlook'}</button>
          <span>${AD.ai ? (AD.ai.kind !== 'advice' ? KIND[AD.ai.kind].replace(/^./, c => c.toUpperCase()) : `${picked.length} item${picked.length === 1 ? '' : 's'}`) : `${picked.length} of ${topics.length} item${topics.length === 1 ? '' : 's'}`}${picked.some(t => t.productKey) && AD.ai?.kind !== 'summary' ? ' · products in it become Proposed in the pipeline' : ''}</span>
        </div>
      </div>
    </section>
  </div>`;
}

/** Ask the email writer (Edge Function) for an AI version: kind 'advice' (ticked items), 'summary' (IT at a glance) or 'review' (quarterly review). */
async function writeWithAi(kind) {
  if (AD.writing) return;
  if (AD.note !== AD.noteSaved) await saveNote();
  const facts = currentFacts(kind);
  AD.writing = kind; AD.subject = ''; draw();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('email-writer', { body: { kind, client: AD.client, firstName: firstName(), sender: myName(), note: AD.note.trim(), facts } });
    if (error) throw new Error(error.message || 'The email writer didn’t answer');
    if (!data?.ok) throw new Error(data?.error || 'The email writer didn’t answer');
    AD.ai = { kind, subject: data.subject, html: data.html, costUsd: data.costUsd, noteUsed: AD.note.trim(), facts,
      recsUsed: JSON.stringify(facts.recommendations), leftUsed: JSON.stringify(AD.leftOut) };
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
      <span class="badge badge-${SOURCE[t.source][0]}">${escapeHtml(SOURCE[t.source][1])}</span>${dealBadge(t)}</label>
    ${why ? `<p class="ad-why">${escapeHtml(why)}</p>` : ''}
    ${t.summary ? `<p class="ad-sum">${escapeHtml(t.summary)}</p>` : ''}
    ${shown.length ? `<ul class="ad-items">${shown.map(i => itemHtml(t, i)).join('')}</ul>` : ''}
    ${t.items.length > 4 ? `<button type="button" class="ad-more" data-ad-more="${escapeHtml(t.key)}">${open ? 'Show fewer' : `and ${t.items.length - 4} more`}</button>` : ''}
    ${t.price ? `<p class="ad-price">${escapeHtml(t.price)}</p>` : ''}
  </li>`;
}

const shortDay = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
/** Where the product already is in the pipeline, or that it was added by hand. */
function dealBadge(t) {
  if (t.added) return ' <span class="badge badge-blue">Added by you</span>';
  if (!t.deal) return '';
  return t.deal.status === 'proposed'
    ? ` <span class="badge badge-amber" title="Already proposed: an email went on ${escapeHtml(shortDay(t.deal.since))}. Tick it to write again.">Proposed ${escapeHtml(shortDay(t.deal.since))}</span>`
    : ' <span class="badge badge-amber">Idea in the pipeline</span>';
}

/** Add a catalogue product to the email by hand: it joins the list ticked, worded from the catalogue like any other. */
function addProduct(key) {
  const m = (AD.data.more || []).find(x => x.product.key === key);
  if (!m) return;
  const [t] = withM365Cover(adviceTopics({ client: AD.client, gaps: [{ ...m, added: true }], products: AD.data.products }), AD.data.m365).filter(x => x.productKey === key);
  if (!t) { toast(`${m.product.name} has no email wording in the catalogue yet: add it on Opportunities › Products.`, 'error', 8000); draw(); return; }
  AD.data.topics.push(t);
  AD.ticked.set(t.key, true);
  AD.subject = ''; draw();
}

/** "What we keep fixing": the AI's themes from six months of timesheet notes, with Gecko HQ's own counts, and what would stop each. */
function evidenceHtml() {
  const n = (AD.data.entries || []).length;
  const ev = AD.evidence;
  const head = `<header class="ad-head"><h2>What we keep fixing</h2><p>Patterns in the last six months of timesheet notes, and what would stop them: evidence for the sale. The AI only groups the jobs; the counts and hours are added up from the timesheets.</p></header>`;
  if (!n && !ev) return `<section class="ad-ev">${head}<p class="ad-none">No timesheet entries for ${escapeHtml(AD.client)} in the last six months (timesheets cover support-hours clients).</p></section>`;
  const run = `<button type="button" class="btn btn-sm${ev ? ' btn-ghost' : ' btn-primary'}" data-ad-act="evidence"${AD.finding || n < 2 ? ' disabled' : ''}>${AD.finding ? 'Reading the notes…' : ev ? 'Read again' : `Find patterns in ${n} notes with AI`}</button>`;
  if (!ev) return `<section class="ad-ev">${head}<div class="ad-do">${run}<span>about 1p; kept for next time</span></div></section>`;
  const list = ev.data.themes || [];
  const shownProducts = new Set((AD.data.topics || []).map(t => t.productKey).filter(Boolean));
  const name = key => (AD.data.products || []).find(p => p.key === key)?.name || key;
  const rows = list.map(x => {
    const act = !x.product_key ? '' : shownProducts.has(x.product_key)
      ? `<span class="badge badge-green">${escapeHtml(name(x.product_key))}: evidence added</span>`
      : (AD.data.more || []).some(m => m.product.key === x.product_key)
        ? `<button type="button" class="btn btn-sm" data-ad-act="add-product" data-key="${escapeHtml(x.product_key)}">Add ${escapeHtml(name(x.product_key))}</button>` : '';
    return `<li><div class="ad-ev-row"><strong>${escapeHtml(x.theme)}</strong> <span>${escapeHtml(themeFigures(x))}</span></div>
      <p>${escapeHtml(x.client_line)}</p>
      ${x.examples?.length ? `<p class="ad-ev-eg">e.g. ${x.examples.map(e => `“${escapeHtml(e)}”`).join(' · ')}</p>` : ''}${act ? `<div class="ad-ev-act">${act}</div>` : ''}</li>`;
  }).join('');
  const when = new Date(ev.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `<section class="ad-ev">${head}
    ${list.length ? `<ul class="ad-ev-list">${rows}</ul>` : '<p class="ad-none">Nothing keeps coming back: no theme with two or more jobs.</p>'}
    <div class="ad-do">${run}<span>Read ${escapeHtml(when)} from ${ev.data.entries} notes${n !== ev.data.entries ? ` (${n} now)` : ''}</span></div></section>`;
}

/** Ask the AI for "What we keep fixing" (Edge Function client-ai, kind evidence). */
async function findEvidence() {
  if (AD.finding) return;
  if (AD.note !== AD.noteSaved) await saveNote();
  const active = (AD.data.products || []).filter(p => p.active);
  const offered = new Set([...(AD.data.topics || []).map(t => t.productKey), ...(AD.data.more || []).map(m => m.product.key)]);
  AD.finding = true; draw();
  try {
    const sb = await connectSupabase({ interactive: true });
    const { data, error } = await sb.functions.invoke('client-ai', { body: { kind: 'evidence', client: AD.client, note: AD.note.trim(),
      entries: AD.data.entries.map(e => ({ id: e.id, date: e.entry_date, text: [e.title, e.work_description].filter((v, i, a) => v && a.indexOf(v) === i).join(': ') })),
      catalogue: active.map(p => ({ key: p.key, name: p.name, pitch: p.pitch || '' })),
      already: active.filter(p => !offered.has(p.key)).map(p => p.key) } });
    if (error) throw new Error(error.message || 'The AI didn’t answer');
    if (!data?.ok) throw new Error(data?.error || 'The AI didn’t answer');
    AD.evidence = data.insight;
  } catch (err) {
    toast(`Couldn’t read the notes: ${err.message || err}`, 'error', 9000);
  } finally {
    AD.finding = false; draw();
  }
}

/** One machine or finding under a topic. Machines (devices and protection) have their own tick: unticked = left out for this client. */
function itemHtml(t, i) {
  const text = i.note ? `<strong>${escapeHtml(i.name)}</strong> <span>${escapeHtml(i.note)}</span>` : `<span>${escapeHtml(i.name)}</span>`;
  if (t.source === 'opportunity') return `<li>${text}</li>`;
  const key = itemKey(i);
  const out = AD.leftOut.some(n => n.toUpperCase() === key.toUpperCase());
  return `<li class="ad-item${out ? ' out' : ''}"><label><input type="checkbox" data-ad-item="${escapeHtml(key)}"${out ? '' : ' checked'}> ${text}${out ? ' <em>left out</em>' : ''}</label></li>`;
}

/** Leave a machine out of (or back into) every email to this client, remembered with the client's note. */
async function setLeftOut(key, include) {
  const before = AD.leftOut;
  AD.leftOut = include ? before.filter(n => n.toUpperCase() !== key.toUpperCase()) : [...before.filter(n => n.toUpperCase() !== key.toUpperCase()), key];
  AD.subject = ''; draw();
  try {
    const sb = await connectSupabase({ interactive: true });
    must(await sb.from('client_notes').upsert({ client_name: AD.client, left_out: AD.leftOut, updated_by: myName() }, { onConflict: 'client_name' }).select('client_name'));
  } catch (err) {
    AD.leftOut = before; draw();
    toast(/left_out/.test(err.message || '') ? 'Couldn’t remember that yet: the database update for it hasn’t arrived (it comes with this change).' : `Couldn’t save that: ${err.message || err}`, 'error', 9000);
  }
}

/** The quarterly review on its own page, to print or save as a PDF for the meeting (the browser's own print dialog). */
function printReview() {
  const html = document.querySelector('[data-ad-preview]')?.innerHTML || AD.ai?.html || '';
  const w = window.open('', '_blank');
  if (!w) { toast('The browser blocked the new window: allow pop-ups for Gecko HQ, then try again.', 'error', 8000); return; }
  const title = escapeHtml(AD.subject || AD.ai.subject || `IT review: ${AD.client}`);
  w.document.write(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${title}</title><style>
    body { font: 15px/1.55 -apple-system, "Segoe UI", Arial, sans-serif; color: #111; max-width: 680px; margin: 40px auto; padding: 0 24px; }
    h1 { font-size: 22px; margin: 0 0 4px; } .who { color: #555; margin: 0 0 24px; } h3 { font-size: 16px; margin: 22px 0 6px; }
    ul, ol { padding-left: 22px; } li { margin: 3px 0; } @media print { body { margin: 0 auto; } }
  </style></head><body><h1>${title}</h1><p class="who">${escapeHtml(AD.client)} · prepared by ${escapeHtml(myName() || 'Gecko IT Services')}, Gecko IT Services · ${escapeHtml(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>${html}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
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
    if (t) { AD.ticked.set(t.dataset.adTick, t.checked); AD.subject = ''; draw(); }
    const ad = e.target.closest?.('[data-ad-add]');
    if (ad && ad.value) addProduct(ad.value);
    const it = e.target.closest?.('[data-ad-item]');
    if (it) setLeftOut(it.dataset.adItem, it.checked);
  });
  root.addEventListener('input', e => {
    const s = e.target.closest?.('[data-ad-subject]');
    if (s) AD.subject = s.value;
    if (e.target.closest?.('[data-ad-preview]')) {   // re-check as Philip edits; only the checks box redraws (keeps the cursor)
      clearTimeout(AD.recheck);
      const ed = e.target.closest('[data-ad-preview]');
      if (AD.ai) AD.ai.html = ed.innerHTML;   // edits survive a redraw (ticking something, opening the facts)
      AD.recheck = setTimeout(() => { const box = document.querySelector('[data-ad-checks]'); if (box) box.innerHTML = checks(true); }, 400);
    }
    const n = e.target.closest?.('[data-ad-note]');
    if (n) {
      AD.note = n.value;
      const b = document.querySelector('[data-ad-act="save-note"]');   // just the button: a redraw would lose the cursor
      if (b) { const dirty = AD.note !== AD.noteSaved; b.disabled = !dirty; b.textContent = dirty ? 'Save' : 'Saved'; b.classList.toggle('btn-primary', dirty); }
      const banner = document.querySelector('[data-ad-stale]');
      if (banner) banner.hidden = !stale();
    }
  });
  root.addEventListener('toggle', e => { if (e.target.matches?.('[data-ad-facts]')) AD.factsOpen = e.target.open; }, true);
  root.addEventListener('click', e => {
    const more = e.target.closest?.('[data-ad-more]');
    if (more) { const k = more.dataset.adMore; AD.open.has(k) ? AD.open.delete(k) : AD.open.add(k); draw(); return; }
    const a = e.target.closest?.('[data-ad-act]')?.dataset.adAct;
    if (a === 'draft') draft();
    if (a === 'evidence') findEvidence();
    if (a === 'add-product') addProduct(e.target.closest('[data-key]').dataset.key);
    if (a === 'save-note') saveNote();
    if (a === 'ai-advice') writeWithAi('advice');
    if (a === 'ai-summary') writeWithAi('summary');
    if (a === 'ai-review') writeWithAi('review');
    if (a === 'print') printReview();
    if (a === 'rewrite' && AD.ai) writeWithAi(AD.ai.kind);
    if (a === 'template') { AD.ai = null; AD.subject = ''; draw(); }
    if (a === 'reload') { const n = AD.client; AD.client = ''; html(n); draw(); }
  });
}
