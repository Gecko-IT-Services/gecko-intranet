-- Opportunities (docs/superpowers/specs/2026-10-08-opportunities-design.md).
-- Clients are joined by name, like the rest of the dashboard (gecko_clients.title,
-- Xero contact names, the SSA Clients list), so nothing here stores a client id.

-- What Gecko sells, how a gap is spotted, and the email that offers it.
-- rule: how the page decides a client has a gap (src/core/opportunities.js):
--   missing          no service line / supplier invoice shows they have it
--   missing_if_m365  as missing, but only for clients on Microsoft 365
--   m365_elsewhere   their email runs on M365 or Google but not through Gecko
--   email_filter     on M365, and their mail is not behind a filtering service
--   dmarc            SPF or DMARC missing, or DMARC p=none (one-off fix)
--   hosting          they have a website and it is not on Gecko hosting
--   seo              PageSpeed SEO or performance below the thresholds
--   website          slow site or no HTTPS (one-off refresh)
--   support          neither on an SSA block nor a retainer
--   devices          needs device data (Atera, phase 2); inactive until then
-- keywords: a case-insensitive pattern matched against the client's service line
-- names and notes; a match means "already has it".
create table public.opportunity_products (
  key             text primary key,
  family          text not null,
  name            text not null,
  rule            text not null check (rule in ('missing','missing_if_m365','m365_elsewhere',
                    'email_filter','dmarc','hosting','seo','website','support','devices')),
  keywords        text not null default '',
  -- Pattern matched against the client's Timesheets work descriptions (last 6
  -- months). Repeated hits raise the gap even when the rule alone would not,
  -- with the matching entries as evidence ("what they keep calling us about").
  ticket_keywords text not null default '',
  pitch           text not null default '',
  unit_note       text not null default '',
  default_mrr     numeric,          -- £/month, null = price not set yet
  default_one_off numeric,          -- £ one-off, null = none / not set
  email_subject   text not null default '',
  email_body      text not null default '',
  sort            int not null default 100,
  active          boolean not null default true,
  modified_at     timestamptz not null default now()
);

create trigger opportunity_products_touch before update on public.opportunity_products
  for each row execute function public.touch_modified_at();
alter table public.opportunity_products enable row level security;
create policy opportunity_products_staff_all on public.opportunity_products
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Philip's answer for a client and product, so a gap stops being raised:
-- has (bought elsewhere / not visible to us), not_interested, not_applicable.
create table public.client_product_status (
  client_name text not null,
  product_key text not null references public.opportunity_products(key) on update cascade,
  status      text not null check (status in ('has','not_interested','not_applicable')),
  note        text not null default '',
  modified_at timestamptz not null default now(),
  primary key (client_name, product_key)
);

create trigger client_product_status_touch before update on public.client_product_status
  for each row execute function public.touch_modified_at();
alter table public.client_product_status enable row level security;
create policy client_product_status_staff_all on public.client_product_status
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Domains added by hand (the page also finds them from Clook invoices and SSA contacts).
create table public.client_domains (
  id          bigint generated always as identity primary key,
  client_name text not null,
  domain      text not null check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  created_at  timestamptz not null default now(),
  unique (client_name, domain)
);

alter table public.client_domains enable row level security;
create policy client_domains_staff_all on public.client_domains
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- Last result of each public check per domain: 'dns' (MX/SPF/DMARC/DKIM) or
-- 'pagespeed' (Google PageSpeed Insights, mobile). Cached so the page does not
-- re-check every domain on every visit.
create table public.client_signals (
  domain     text not null,
  kind       text not null check (kind in ('dns','pagespeed')),
  data       jsonb not null,
  checked_at timestamptz not null default now(),
  primary key (domain, kind)
);

alter table public.client_signals enable row level security;
create policy client_signals_staff_all on public.client_signals
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- The pipeline.
create table public.opportunities (
  id          bigint generated always as identity primary key,
  client_name text not null check (client_name <> ''),
  product_key text references public.opportunity_products(key) on update cascade,
  title       text not null check (title <> ''),
  status      text not null default 'idea' check (status in ('idea','proposed','won','lost')),
  mrr         numeric not null default 0,     -- £/month if won
  one_off     numeric not null default 0,     -- £ one-off if won
  evidence    text not null default '',
  next_step   text not null default '',
  owner       text not null default '',
  closed_at   timestamptz,                    -- set when won or lost
  created_at  timestamptz not null default now(),
  modified_at timestamptz not null default now()
);

create trigger opportunities_touch before update on public.opportunities
  for each row execute function public.touch_modified_at();
alter table public.opportunities enable row level security;
create policy opportunities_staff_all on public.opportunities
  for all to authenticated using (public.is_gecko_staff()) with check (public.is_gecko_staff());

-- The catalogue Gecko starts with. Prices left null are set by Philip on the
-- Products tab; known sell prices are noted in unit_note.
insert into public.opportunity_products
  (key, family, name, rule, keywords, pitch, unit_note, default_mrr, default_one_off, email_subject, email_body, sort, active)
values
('voxone', 'Communications', 'VoxOne hosted telephony', 'missing',
 'voxone|voip|telephon|phone system|3cx|sip',
 'Cloud phone system on any device; ready for the BT switch-off of old phone lines.',
 'Sell £15.00 per seat / month (cost £10.00)', null, null,
 'Your phone lines and the BT switch-off',
 $t$Hi {{first_name}},

BT is switching off the old copper phone network, with the final cut-over planned for January 2027. Businesses still on traditional lines need to move before then.

{{evidence}}

As a VoIP Unlimited partner we can move {{client}} onto VoxOne: the same numbers, calls on desk phones, mobiles and laptops, call recording and out-of-hours routing, all billed with your IT. {{price}}

Would a 15-minute call next week suit to look at what you have today?

{{sender}}$t$, 10, true),

('connectivity', 'Connectivity', 'Business connectivity (FTTP / SOGEA / Ethernet)', 'missing',
 'fttp|sogea|ethernet|broadband|leased line|fttc|connectivity|starlink',
 'Full-fibre broadband, SOGEA or a dedicated Ethernet circuit, managed with your IT.',
 'FTTP 1000/115 sell £52.60 / month (cost £42.60); SOGEA and Ethernet quoted per site', null, null,
 'Faster, managed connectivity for {{client}}',
 $t$Hi {{first_name}},

Your internet connection now carries your phones, Microsoft 365 and backups, so it matters more than ever.

{{evidence}}

Through VoIP Unlimited we can supply full-fibre (FTTP), SOGEA or a dedicated Ethernet circuit, with one point of contact when anything goes wrong: us. {{price}}

If you send me a recent bill I'll check what's available at your address and what it would cost.

{{sender}}$t$, 20, true),

('email_security', 'Security', 'Hornetsecurity 365 Total Protection', 'email_filter',
 'hornet|mimecast|proofpoint|barracuda|spam filter|email security',
 'Advanced spam, phishing and ransomware filtering for Microsoft 365, with email archiving.',
 'Per user / month', null, null,
 'Stopping phishing before it reaches {{client}}',
 $t$Hi {{first_name}},

Most attacks on small businesses start with an email. While checking your email setup we noticed:

{{evidence}}

Hornetsecurity 365 Total Protection sits in front of Microsoft 365 and stops phishing, spoofing and malicious attachments before they reach anyone, and keeps a searchable archive of every email. {{price}}

Happy to switch it on for a free trial so you can see what it catches.

{{sender}}$t$, 30, true),

('email_auth', 'Security', 'Email authentication set-up (SPF, DKIM, DMARC)', 'dmarc',
 'dmarc|dkim',
 'Stops criminals sending email that pretends to come from your domain; improves delivery.',
 'One-off set-up', null, null,
 'Protecting {{client}}''s email address from being faked',
 $t$Hi {{first_name}},

We ran a quick public check on your email domain and found:

{{evidence}}

Without these settings, anyone can send email that appears to come from you, and your genuine email is more likely to land in spam. We can put SPF, DKIM and DMARC in place and monitor them. {{price}}

{{sender}}$t$, 40, true),

('m365_backup', 'Backup', 'Microsoft 365 backup (Acronis)', 'missing_if_m365',
 '(o365|m365|365|sharepoint|onedrive|mailbox).{0,25}backup|backup.{0,25}(o365|m365|365|sharepoint)',
 'Daily backup of email, OneDrive, SharePoint and Teams, kept separately from Microsoft.',
 'Per user / month', null, null,
 'Is {{client}}''s Microsoft 365 data backed up?',
 $t$Hi {{first_name}},

A common misunderstanding: Microsoft keeps 365 running, but it doesn't back up your data the way most people expect. Deleted or encrypted email and files can be gone for good after a short retention window.

{{evidence}}

We can back up every mailbox, OneDrive, SharePoint site and Teams chat daily, stored separately in the UK, with restores handled by us. {{price}}

{{sender}}$t$, 50, true),

('endpoint', 'Security', 'Internet security + device backup', 'missing',
 'internet security|webroot|acronis|endpoint|defender|antivirus|backup',
 'Managed antivirus/DNS protection and backup for PCs and servers.',
 'Per device / month', null, null,
 'Protecting {{client}}''s computers',
 $t$Hi {{first_name}},

{{evidence}}

We can put managed security and backup on every PC and server: threats blocked and monitored by us, and files restorable if a machine fails or is hit by ransomware. {{price}}

{{sender}}$t$, 60, true),

('exclaimer', 'Productivity', 'Exclaimer email signatures', 'missing_if_m365',
 'exclaimer|signature',
 'Consistent, branded signatures on every email, managed centrally.',
 'Sell £1.40 per user / month', null, null,
 'Branded email signatures for {{client}}',
 $t$Hi {{first_name}},

{{evidence}}

With Exclaimer every email from {{client}} carries the same professional signature, with your logo, legal details and any promotion you want to run, on every device, managed by us. {{price}}

{{sender}}$t$, 70, true),

('keeper', 'Security', 'Keeper password manager', 'missing',
 'keeper|password manager',
 'Shared, encrypted password vault with breach alerts; a Cyber Essentials favourite.',
 'Per user / month', null, null,
 'Getting passwords out of spreadsheets at {{client}}',
 $t$Hi {{first_name}},

{{evidence}}

Keeper gives each person an encrypted vault and shared folders for team logins, warns you when a password turns up in a breach, and helps with Cyber Essentials. {{price}}

{{sender}}$t$, 80, true),

('m365', 'Microsoft 365', 'Microsoft 365 through Gecko', 'm365_elsewhere',
 'm365|microsoft 365|office 365|exchange|business (basic|standard|premium)',
 'Licences, support and security in one monthly bill from us.',
 'Business Standard sell £11.24 per user / month', null, null,
 'Simplifying {{client}}''s Microsoft 365',
 $t$Hi {{first_name}},

{{evidence}}

If we look after your licences too, you get one monthly bill, licences that move when people join or leave, and we can spot savings and security gaps as part of the service. {{price}}

{{sender}}$t$, 90, true),

('hosting', 'Web', 'Website hosting with Gecko', 'hosting',
 'hosting|web site|website',
 'Fast UK hosting, SSL, backups and updates looked after by us.',
 'Typical £199 / year', null, null,
 'Looking after {{client}}''s website',
 $t$Hi {{first_name}},

{{evidence}}

We host websites on fast UK servers with SSL, daily backups and updates included, so it's one less thing to think about. {{price}}

{{sender}}$t$, 100, true),

('seo', 'Web', 'SEO with Rank Math', 'seo',
 'seo|rank math',
 'Monthly search optimisation, as we do for ALS Locksmiths and Clarke Lane Engineering.',
 'Per month', null, null,
 'How {{client}} shows up on Google',
 $t$Hi {{first_name}},

We ran Google's own website check on your site:

{{evidence}}

We now look after search optimisation for local businesses such as ALS Locksmiths and Clarke Lane Engineering: fixing the technical issues Google flags, improving page titles and content, and reporting monthly on where you rank. {{price}}

{{sender}}$t$, 110, true),

('website', 'Web', 'Website refresh', 'website',
 '',
 'Faster, mobile-friendly, secure website.',
 'One-off, quoted', null, null,
 'A faster website for {{client}}',
 $t$Hi {{first_name}},

{{evidence}}

Most visitors now arrive on a phone, and Google ranks slow or insecure sites lower. We can refresh the site so it's fast, secure and easy to update. {{price}}

{{sender}}$t$, 120, true),

('support', 'Support', 'Support hours block (SSA) or retainer', 'support',
 'retainer|support',
 'Pre-paid support hours or a fixed monthly retainer: predictable cost, priority response.',
 'Hours block or monthly retainer', null, null,
 'Predictable IT support for {{client}}',
 $t$Hi {{first_name}},

{{evidence}}

A block of pre-paid support hours (or a fixed monthly retainer) gives you priority response and a predictable bill, and a monthly timesheet so you see exactly where the time goes. {{price}}

{{sender}}$t$, 130, true),

('windows11', 'Devices', 'Windows 11 upgrade / PC refresh', 'devices',
 '',
 'Windows 10 support ended 14 Oct 2025; move machines to Windows 11 or replace them.',
 'Per device, one-off', null, null,
 'Windows 10 machines at {{client}}',
 $t$Hi {{first_name}},

Microsoft stopped supporting Windows 10 on 14 October 2025, so machines still on it no longer get security fixes unless they're on the paid extended programme.

{{evidence}}

We can upgrade machines that are capable of Windows 11 and quote replacements for the rest. {{price}}

{{sender}}$t$, 140, false);

-- What clients keep calling about (Timesheets work descriptions).
update public.opportunity_products set ticket_keywords = v.k from (values
  ('email_security', 'phish|spam|spoof|scam email|suspicious email|junk|malicious|compromised|hacked'),
  ('email_auth',     'spoof|dmarc|spf|dkim|going to junk|landing in spam|rejected email|bounce'),
  ('keeper',         'password|locked out|login details|credentials|reset.{0,10}pass|mfa|authenticator'),
  ('connectivity',   'internet|broadband|wi-?fi|router|connection drop|slow connection|outage|bt openreach|fttp|sogea'),
  ('voxone',         'phone|handset|call forwarding|voicemail|telephon|landline|3cx|divert'),
  ('m365_backup',    'deleted (email|file|folder)|restore|recover|lost (email|file)|onedrive sync|sharepoint'),
  ('endpoint',       'virus|malware|ransom|antivirus|backup fail|hard drive|disk fail|slow (pc|laptop|computer)'),
  ('windows11',      'windows 10|win10|upgrade to windows 11|old (pc|laptop)|slow (pc|laptop|computer)|tpm'),
  ('exclaimer',      'signature'),
  ('website',        'website|web site|wordpress|domain|ssl certificate'),
  ('seo',            'google (listing|ranking|business)|seo|search ranking'),
  ('support',        '.')   -- any reactive work: volume is the signal for a support block
) as v(key, k) where opportunity_products.key = v.key;
