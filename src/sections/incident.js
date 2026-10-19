/* ╔═══════════════════════════════════════════════════════════════════╗
   ║   HELP WITH THIS (one pop-up, opened from Devices and Alerts)     ║
   ║                                                                   ║
   ║   For one machine's problem: the likely causes, the steps for us, ║
   ║   and a simple message for the client to follow. Gathers what     ║
   ║   Gecko HQ knows (Atera, the alert or check, the client's note,   ║
   ║   recent timesheet notes about the machine), asks the AI once     ║
   ║   (client-ai, kind incident, ~1p). Nothing is sent from here.     ║
   ║   Logic: core/incident.js. Design: docs/superpowers/specs/        ║
   ║   2026-10-19-incident-help-design.md                              ║
   ║                                                                   ║
   ║   NOTE: no top-level `window` access (importable under Node).     ║
   ╚═══════════════════════════════════════════════════════════════════╝ */

import { toast, escapeHtml } from '../core/ui.js';
import { connectSupabase } from '../core/supabase.js';
import { sameAteraClient } from '../core/devices.js';
import { sameClient } from '../core/client.js';
import { machineFacts, relatedWork, incidentFacts } from '../core/incident.js';

const IH = { ctx: null, facts: null, result: null, busy: false, error: '' };
const must = ({ data, error }) => { if (error) throw new Error(error.message || 'Database request failed'); return data; };
const same = (a, b) => sameAteraClient(a, b) || sameAteraClient(b, a) || sameClient(a, b);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const myName = () => (document.getElementById('userName')?.textContent || '').trim();

function dialog() {
  let d = document.getElementById('ihDialog');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'ihDialog'; d.className = 'ih-dialog'; d.setAttribute('aria-labelledby', 'ihTitle');
    document.getElementById('app').append(d);
    d.addEventListener('click', onClick);
  }
  return d;
}

function draw() {
  const d = document.getElementById('ihDialog');
  if (!d || !IH.ctx) return;
  const { client, device, problem } = IH.ctx;
  const r = IH.result;
  const body = IH.error ? `<div class="state-error"><strong>Couldn’t work it out.</strong><p>${escapeHtml(IH.error)}</p></div>`
    : IH.busy ? `<p class="ih-wait">${IH.facts ? 'Thinking it through…' : 'Gathering what we know about it…'}</p>`
    : !r ? '' : `
      <section><h4>Likely causes</h4><ol class="ih-list">${r.causes.map(c => `<li><strong>${escapeHtml(c.cause)}</strong> <span>${escapeHtml(c.why)}</span></li>`).join('')}</ol></section>
      <section><h4>What to do</h4><ol class="ih-list">${r.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol></section>
      <section><h4>Message for the client</h4><p class="ih-note">Plain steps they can follow. Check it, then copy it into WhatsApp, a text or an email.</p>
        <textarea class="ih-msg" data-ih-msg rows="12">${escapeHtml(r.message)}</textarea></section>`;
  d.innerHTML = `<div class="ih-wrap">
    <header><h3 id="ihTitle">${escapeHtml(device || 'This machine')} <span>${escapeHtml(client)}</span></h3><p>${escapeHtml(problem)}</p></header>
    ${body}
    <div class="ih-acts">
      <button type="button" class="btn btn-ghost" data-ih="close">Close</button>
      ${r ? `<button type="button" class="btn btn-sm" data-tk="add" data-client="${escapeHtml(client)}" data-title="${escapeHtml(`${device}: ${r.causes[0]?.cause || problem}`)}" data-note="${escapeHtml(`${problem}\n\nSteps:\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)}">Add task</button>
        <button type="button" class="btn btn-sm" data-ih="again"${IH.busy ? ' disabled' : ''}>Ask again</button>
        <button type="button" class="btn btn-primary" data-ih="copy">Copy message</button>` : IH.error ? '<button type="button" class="btn btn-primary" data-ih="again">Try again</button>' : ''}
    </div></div>`;
}

/** What Gecko HQ knows about the machine: Atera's record, the client's note, recent timesheet notes about it. */
async function gather(sb) {
  const { client, device, problem, details } = IH.ctx;
  const [agents, notes, ssa] = await Promise.all([
    // An alert may name the machine by Atera's display name ("Kelly's PC") or its computer name (FIPC): match either, in the browser.
    sb.from('atera_agents').select('agent_id,customer_name,machine_name,device_type,os,os_version,online,last_seen,last_user,'
      + 'AgentName:raw->>AgentName,HardwareDisks:raw->HardwareDisks,BiosReleaseDate:raw->>BiosReleaseDate,LastRebootTime:raw->>LastRebootTime,'
      + 'BatteryInfo:raw->BatteryInfo,Vendor:raw->>Vendor,VendorBrandModel:raw->>VendorBrandModel,Processor:raw->>Processor,Memory:raw->>Memory,OSBuild:raw->>OSBuild')
      .then(must).then(rows => rows.map(({ agent_id, customer_name, machine_name, device_type, os, os_version, online, last_seen, last_user, ...raw }) =>
        ({ agent_id, customer_name, machine_name, device_type, os, os_version, online, last_seen, last_user, raw }))),
    sb.from('client_notes').select('client_name,setup').then(({ data, error }) => (error ? [] : data || [])),
    sb.from('ssa_clients').select('id,name').then(must)
  ]);
  const named = a => [a.machine_name, a.raw.AgentName].some(n => String(n || '').toLowerCase() === String(device || '').toLowerCase());
  const agent = agents.find(a => named(a) && same(a.customer_name, client)) || agents.find(named) || null;
  const machine = machineFacts(agent);
  const ids = ssa.filter(s => same(s.name, client)).map(s => s.id);
  const since = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  const entries = ids.length ? must(await sb.from('timesheet_entries').select('entry_date,title,work_description').in('client_id', ids).gte('entry_date', since)
    .is('deleted_at', null).neq('engineer', 'System').order('entry_date', { ascending: false }).limit(400)) : [];
  const note = notes.find(n => same(n.client_name, client))?.setup || '';
  return { facts: incidentFacts({ client, machine, problem, details, related: relatedWork(entries, { device, user: machine?.user || '' }), today: today() }), note };
}

async function ask() {
  IH.busy = true; IH.error = ''; IH.result = null; draw();
  try {
    const sb = await connectSupabase({ interactive: true });
    if (!IH.facts) IH.facts = await gather(sb);
    draw();
    const { data, error } = await sb.functions.invoke('client-ai', { body: { kind: 'incident', client: IH.ctx.client, sender: myName(), note: IH.facts.note, facts: IH.facts.facts } });
    if (error) throw new Error(error.message || 'The AI didn’t answer');
    if (!data?.ok) throw new Error(data?.error || 'The AI didn’t answer');
    IH.result = data.help;
  } catch (err) {
    IH.error = err.message || String(err);
  } finally {
    IH.busy = false; draw();
  }
}

/**
 * Open the pop-up for one machine's problem and ask straight away. ctx: { client, device, problem (one sentence), details (what the
 * alert or check says: plain values) }.
 */
export function openIncident(ctx) {
  Object.assign(IH, { ctx, facts: null, result: null, busy: false, error: '' });
  const d = dialog();
  draw();
  if (!d.open) d.showModal();
  ask();
}

async function onClick(e) {
  const a = e.target.closest?.('[data-ih]')?.dataset.ih;
  if (a === 'close') document.getElementById('ihDialog')?.close();
  if (a === 'again') ask();
  if (a === 'copy') {
    const text = document.querySelector('[data-ih-msg]')?.value || '';
    try { await navigator.clipboard.writeText(text); toast('Message copied: paste it into WhatsApp, a text or an email.', 'success'); }
    catch { toast('Couldn’t copy: select the text and copy it instead.', 'error'); }
  }
}
