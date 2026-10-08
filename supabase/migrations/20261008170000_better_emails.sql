-- Opportunity emails rewritten (Philip, 8 Oct 2026: "not very convincing… friendly tone,
-- emphasise why they should want these products in a passive, informative way, detail the
-- benefits"). Each email now stands on its own: a friendly opener, why it matters, the
-- benefits as a list, then only client-facing findings ({{#findings}}…{{/findings}}, see
-- fillTemplate) and the price when one is set ({{#price}}…{{/price}}).
--
-- Only templates still exactly as first seeded are replaced (matched by md5 of the old
-- body), so anything Philip has edited on the Products tab is left alone.

update public.opportunity_products p
   set email_subject = n.subject, email_body = n.body
  from (values
('voxone', '4a8bc513fc68f9251851f9b89e15406e',
 'Your phone lines and the 2027 switch-off',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

I wanted to give you an early heads-up about something that affects almost every UK business. Openreach is retiring the old copper phone network, and traditional phone lines are being switched off, with the final cut-over planned for January 2027. Anything still running on those lines will need to move to an internet-based service before then.

It's also a good moment to get a phone system that works the way people work now. VoxOne, from our partner VoIP Unlimited, gives you:

• Your existing phone numbers, kept exactly as they are
• Calls on desk phones, mobiles and laptops, so nobody is tied to their desk
• Voicemail to email, call recording and out-of-hours routing as standard
• Quick changes when people join, leave or move, handled by us
• One point of contact for your phones and your IT

{{#findings}}A couple of things we noticed:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

If it would help, I'm happy to have a quick 15-minute chat about what you have today and what a move would involve. There's no obligation at all.

{{sender}}$t$),

('connectivity', 'bd6707a864692e9ec8b633a4154a8c16',
 'Faster, more reliable internet for {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Your internet connection quietly does a lot of heavy lifting these days. Microsoft 365, phone calls, video meetings, backups and card payments all depend on it, so when it slows down or drops, the whole office feels it.

Through our partner VoIP Unlimited we can provide business-grade connections, from full-fibre broadband (FTTP) and SOGEA through to dedicated Ethernet lines for sites that can't afford downtime. The benefits:

• Faster, more consistent speeds, especially for uploads and video calls
• Business-grade support, with faults prioritised
• Ready for the 2027 switch-off of traditional phone lines
• Looked after by us, so if anything goes wrong you call us and we deal with the provider
• Often comparable to, or less than, what businesses pay today for slower services

{{#findings}}What we can see for {{client}}:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

If you can send over a recent bill, I'll check what's available at your address and come back with a simple side-by-side comparison.

{{sender}}$t$),

('email_security', 'f872186c47e6d559d41981f5b5fd45fc',
 'Keeping phishing emails away from {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Email is still the most common way criminals target small businesses, usually with convincing fake invoices, login pages or delivery notices. Microsoft 365's built-in filtering catches a lot, but the more convincing ones do get through, and it only takes one click.

{{#findings}}When we looked at your email setup, we noticed:
{{findings}}{{/findings}}

Hornetsecurity 365 Total Protection adds a dedicated layer of protection in front of your mailboxes:

• Phishing, impersonation and fake invoice emails stopped before anyone sees them
• Attachments and links checked for viruses and ransomware
• Spam kept out of the way, so inboxes stay clear
• Email encryption and company disclaimers available when you need them
• Set up and managed by us, with nothing new for your team to learn

{{#price}}{{price}}{{/price}}

We can switch it on as a free trial, so you can see exactly what it catches before deciding anything.

{{sender}}$t$),

('email_auth', '52992335c6364b37cc79a95de72e0549',
 'Protecting {{client}}''s email address from being copied',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

It's surprisingly easy for someone to send an email that looks as though it came from your own address, and criminals use this to send fake invoices to customers and suppliers in a company's name. Three settings on your domain, called SPF, DKIM and DMARC, prove which emails genuinely come from you.

{{#findings}}We ran a quick public check on your email domain and found:
{{findings}}{{/findings}}

Putting these in place means:

• Customers and suppliers are protected from fake emails using your name
• Your genuine emails are more likely to reach the inbox rather than spam
• You meet what Google and Microsoft now expect from businesses that send email
• It supports Cyber Essentials and shows customers you take security seriously

{{#price}}{{price}}{{/price}}

It's a behind-the-scenes job for us with no disruption to your email, and we keep an eye on the reports afterwards.

{{sender}}$t$),

('m365_backup', 'dad5ecc6d670c2725384ba765dc9158f',
 'Is {{client}}''s Microsoft 365 data backed up?',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

A very common assumption is that Microsoft backs up everything in Microsoft 365. In fact, Microsoft keeps the service running, but looking after the data itself is left to each business. Deleted emails and files are only kept for a limited time, and if ransomware or a compromised account changes files, those changes sync everywhere.

A dedicated Microsoft 365 backup gives you peace of mind:

• Every mailbox, OneDrive, SharePoint site and Teams backed up automatically, every day
• Copies kept separately from Microsoft, in UK data centres
• Restore a single email, a folder or a whole mailbox from a chosen date
• Protection against accidental deletion, ransomware and staff leaving
• Monitored by us, so nobody has to remember to check it

{{#findings}}Also worth knowing:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

Happy to talk you through how it works in ten minutes whenever suits.

{{sender}}$t$),

('endpoint', 'f7a6f9d8508ce0840c67bff90ffd092a',
 'Protecting {{client}}''s computers',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Laptops and PCs are where the work happens and, unfortunately, where most security problems start: a bad download, a malicious website, or a machine that fails without warning and takes its files with it.

Our managed security and backup covers each computer with:

• Protection against viruses, ransomware and dangerous websites
• Automatic backup, so files can be restored if a machine fails, is lost or is stolen
• Monitoring by us, so we often know about a problem before you do
• Help towards Cyber Essentials, which requires malware protection on every device

{{#findings}}Also worth knowing:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

It runs quietly in the background, so your team won't notice it until the day it's needed.

{{sender}}$t$),

('exclaimer', 'b7adf761d1e553015bcdff41af06f715',
 'Professional email signatures for everyone at {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Every email your team sends is a small piece of marketing, yet signatures tend to drift over time: old logos, missing phone numbers, different styles, or nothing at all when sending from a phone.

Exclaimer puts a consistent, professionally designed signature on every email, automatically:

• The same branded signature for everyone, with logo, contact details and legal information
• Works on every device, including phones and tablets, with nothing to set up on each one
• Space to promote an offer, event, award or review link to everyone you email
• New starters set up automatically, and changes go out to everyone at once
• Managed by us, so it's one less thing to look after

{{#findings}}Also worth knowing:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

If you like, we can mock up a sample signature with your branding so you can see how it would look.

{{sender}}$t$),

('keeper', '730c889405b7b9fb282ec5b0d2af5057',
 'A safer, simpler way to manage passwords at {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Most teams have more passwords than anyone can remember, so they end up reused, written down or kept in a spreadsheet. Weak and reused passwords are behind a large share of account break-ins.

Keeper makes the safe way the easy way:

• Each person gets their own encrypted vault, on their computer and phone
• Strong passwords created and filled in automatically
• Shared folders for team logins, with access removed straight away when someone leaves
• Alerts if a saved password appears in a data breach
• Supports the password requirements of Cyber Essentials

{{#findings}}Also worth knowing:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

We'd be happy to show you how it works; most people are comfortable with it within a day.

{{sender}}$t$),

('m365', '5fc05b3ede04621238fe48bea690fe6c',
 'Making Microsoft 365 simpler for {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Your team relies on Microsoft 365 every day. Many of our clients find it easier to have us look after the licences as well as the support, and it brings a few practical benefits:

• One monthly bill from us, with licences adjusted as people join or leave
• The right plan for each person, so you're not paying for features nobody uses
• Security settings reviewed and kept up to date as part of the service
• One point of contact for licensing, support and everything in between

{{#findings}}Also worth knowing:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

Nothing changes for your users: same email, same files, and the switch happens in the background. If you'd like, I'll put together a quick comparison with what you pay today.

{{sender}}$t$),

('hosting', 'd5cfa20ce3eb4738bf9ab28d1793ddc4',
 'Looking after {{client}}''s website',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Your website is often the first impression people get of {{client}}, so it should be quick, secure and always available, without you having to think about it.

Hosting with us includes:

• Fast, UK-based hosting
• An SSL certificate, so your site shows as secure in every browser
• Daily backups, so a bad update or a hack can be rolled back
• Updates and security checks looked after for you
• One point of contact for your website, email and IT

{{#findings}}Also worth knowing:
{{findings}}{{/findings}}

{{#price}}{{price}}{{/price}}

We handle the move from start to finish, with no downtime for your site.

{{sender}}$t$),

('seo', '53fb7ac45120980ef83cd4655a26d446',
 'Helping more customers find {{client}} on Google',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

When someone nearby searches for what you do, being on the first page of Google makes a real difference, as most people never look past it.

{{#findings}}We ran Google's own PageSpeed check on your website (scores out of 100), and it highlighted some areas that may be holding it back:
{{findings}}{{/findings}}

We now look after search optimisation for local businesses such as ALS Locksmiths and Clarke Lane Engineering. Each month we:

• Fix the technical issues Google flags, so your site is easy to find and quick to load
• Improve page titles, descriptions and content around the searches your customers make
• Keep an eye on how you rank for the searches that matter to you
• Send a short, plain-English report showing your progress

{{#price}}{{price}}{{/price}}

Happy to send over a short, free review of your site with the quick wins we'd tackle first.

{{sender}}$t$),

('website', '812d2c6beca0a44c58354594b03c8b64',
 'Giving {{client}}''s website a fresh look',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Most visitors now find businesses on a phone, and they decide within a few seconds whether to stay. Google also favours sites that are quick and secure.

{{#findings}}Google's PageSpeed check on your current site showed:
{{findings}}{{/findings}}

A refresh would give you:

• A modern design that looks great on phones, tablets and computers
• Faster loading, which keeps visitors on the page and helps your Google ranking
• Secure browsing (HTTPS) as standard
• Clear ways for customers to call, email or enquire
• Easy updates, done by you or by us

{{#price}}{{price}}{{/price}}

I'd be glad to share a few ideas and a quote, with no obligation.

{{sender}}$t$),

('support', '7ac0d91e013b7178f570debec2eca78c',
 'Predictable IT support for {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}, and thank you for continuing to trust us with your IT.

{{#findings}}Looking back over the last few months:
{{findings}}{{/findings}}

As we're helping on a fairly regular basis, I wanted to suggest a simpler way to work together: a block of prepaid support hours, or a fixed monthly plan. It gives you:

• A predictable cost you can budget for, with no surprise invoices
• Priority response when something goes wrong
• A monthly timesheet, so you can see exactly where the time goes
• Time for the proactive jobs (updates, checks and tidy-ups) that stop problems happening

{{#price}}{{price}}{{/price}}

Happy to talk through which option would suit you best.

{{sender}}$t$),

('windows11', '68597a3e8682711ad17562ac9df5c36e',
 'Windows 10 computers at {{client}}',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

Microsoft stopped supporting Windows 10 on 14 October 2025. Computers still running it no longer receive security updates unless they're enrolled in Microsoft's paid Extended Security Updates programme, which makes them an easier target and can affect Cyber Essentials.

{{#findings}}What we can see:
{{findings}}{{/findings}}

Moving to Windows 11 means:

• Security updates again, so machines stay protected
• Better built-in security and a faster, more modern experience
• Staying compliant with Cyber Essentials and insurers' expectations
• A planned upgrade done by us, at a time that suits you

{{#price}}{{price}}{{/price}}

We'll upgrade the machines that can run Windows 11 and suggest sensible replacements for any that can't.

{{sender}}$t$),

('ve_migration', 'd65e41dcef0ccb8b91f0adacd7ed3eb8',
 'Your phone system: moving from VoIP Exchange to VoxOne',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

I wanted to let you know about a change to your phone system. VoIP Unlimited are moving customers from their older VoIP Exchange platform to their newer VoxOne service, and they've told us that VoIP Exchange call recordings are no longer accessible and the mobile app has become unreliable.

{{#findings}}What you have today:
{{findings}}{{/findings}}

Moving to VoxOne gives you:

• All your existing numbers, kept exactly as they are
• Call recording that works, with recordings easy to find
• A reliable app for mobiles and laptops, so calls follow you wherever you are
• Voicemail to email, call queues and out-of-hours routing
• Lower seat prices on a contract: £15 a month on 36 months or £20 on 12 months, compared with £22 out of contract

We'll plan the move around you and handle it from start to finish, so your team keeps taking calls throughout.

Would a short call to go through your extensions and pick a date be useful?

{{sender}}$t$),

('vu_renewal', '5bfeb8a2320b17f2d32df4a18a8e887d',
 'A chance to save on {{client}}''s phone and internet',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

We keep an eye on your phone and internet services with VoIP Unlimited, and some are now out of contract or coming up for renewal.

{{#findings}}Here's what we can see:
{{findings}}{{/findings}}

Services left out of contract usually cost more than they need to. Reviewing them now means:

• Current pricing, which is often lower than what you pay today
• The option to upgrade, for example to a faster line, where it makes sense
• No disruption, as renewals happen in the background
• We do the comparing and the paperwork, so you don't have to chase anyone

Shall I put the options together for you?

{{sender}}$t$),

('it_services', '2b298dd0e8bcb14965f68a894d9c4a2c',
 'Looking after {{client}}''s IT as well',
 $t$Hi {{first_name}},

I hope all is well at {{client}}.

We already look after your phones and connectivity with VoIP Unlimited, so I thought it worth mentioning that IT support is the main part of what we do.

Many of our customers find it easier to have one trusted team for everything:

• One number to call for phones, internet and IT
• Microsoft 365 and email set up and looked after properly
• Backups and protection against viruses and ransomware
• Friendly, local support from people who know your business
• Flexible options, from a block of prepaid hours to a monthly plan

Would a short, no-obligation chat about how you handle IT today be useful?

{{sender}}$t$)
  ) as n(key, old_md5, subject, body)
 where p.key = n.key and md5(p.email_body) = n.old_md5;
