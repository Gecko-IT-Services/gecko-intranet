# Vendor marks: whose product is it

Jack, 10 Oct 2026: "use these logos within the app to show me or my dad when a product is Google related,
Microsoft related, etc. Add these where appropriate and tasteful… feel free to edit them."

## What it is
A small logo (14px high, full colour) beside a product's name. Six vendors: Microsoft, Google, VoxOne,
Hornetsecurity, Acronis, Webroot (OpenText).

## Where
- **In front of a name that stands alone**: Opportunities › Products (each product), Pipeline (stickies and
  the list), Gaps › a client's gaps, and the email line of a client's checks ("Email example.com: Google"),
  which is the one place the app already knew Microsoft from Google.
- **Behind a name in a column**, so the names still line up: service lines (Profitability and the client
  page), a client's opportunities, Analytics › Ahead (the row per product).
- A service line in the `m365` category is Microsoft's whatever it is called.

## Not marked, on purpose
- Page titles. An Acronis mark after "Backup Status" was tried and taken off the same day (Jack: "not
  very tasteful"): marks belong beside a product's name, not in a page's header.
- The Gaps map's column heads (the label is turned on its side; a turned logo is worse than none).
- Clients › Licences: every row is Microsoft, so a mark on each says nothing.
- Gap chips on a closed client card: six chips with logos is clutter; the open card has them.
- Vendors with no logo supplied (Exclaimer, Keeper, Atera, VoIP Unlimited, Clook, Xero): no mark is better
  than a wrong one.

## How a product gets its mark
`src/core/vendors.js`, from the words in the name (`vendorsFor`), in the order they are named:
"Microsoft 365 backup (Acronis)" gets Microsoft then Acronis. A product added or renamed on the Products tab
picks its mark up with no code change.

Jack, same day: "Acronis can be used anywhere for backups and OpenText anywhere antivirus, AV or Webroot is
said (within reason)." So the plain words count: "backup" / "backups" / "back-up" is Acronis; "antivirus",
"internet security", "Webroot", and in capitals only "AV" and "IS" (the latter only before + & /, as in the
service line "IS + Backup") are Webroot. Whole words: "Backupify" and "travel" get nothing.

Names that only look like a vendor's are tested (`tests/vendors.mjs`): "Hornetsecurity 365 Total Protection"
is not Microsoft ("365" alone does not count) and "VoIP Exchange" is not Microsoft Exchange.

Rejected: a `vendor` column on `opportunity_products` and a picker on the Products tab. Service lines and
opportunity titles are free text, so the words would have to be read anyway.

## The images (`src/assets/vendors/`, about 16 KB in all)
- `microsoft.svg`: the four squares only, without the wordmark, redrawn as four rectangles.
- `google.svg`: the G as supplied.
- `acronis.svg`: the inverted symbol (white A on navy), so it reads on both themes. The plain navy A
  disappears on the dark theme.
- `voxone.png`: the pink handset cut out of the wordmark. The wordmark's dark letters are unreadable at this
  size and invisible on the dark theme.
- `hornetsecurity.png`: the hornet only. The supplied file's wordmark is white.
- `opentext.png`: the blue "ot" tile, scaled to 64px.

Not used: the Microsoft wordmark, the full VoxOne and Acronis wordmarks.

The marks are decorative (`alt=""`, the name beside them says it); the `title` gives the vendor on hover.

## Checked
Preview harness, light and dark, 1440×900: Products, Pipeline board, Gaps (client card with a Google email
check), client page › Services, Profitability lines, Analytics › Ahead. All 29 test files pass.
