/* Vendor marks: a small logo beside a product's name, so what is Microsoft's, Google's, VoxOne's and
   so on reads at a glance. Design: docs/superpowers/specs/2026-10-10-vendor-marks-design.md

   A vendor is recognised from the words in the name (a service line, a catalogue product, an
   opportunity's title), so a product added or renamed on the Products tab picks its mark up without
   a code change. The images are in src/assets/vendors/. No top-level window access.

   Each vendor has `words` (any case) and, where a word is only safe as it is properly written,
   `exact` (case as typed: "Teams" the product, not "teams"; "AV", not the "av" in a sentence).
   Besides its own names a vendor owns the plain word for what Gecko sells of it (Jack, 10 Oct 2026):
   a backup is Acronis, antivirus is Webroot, a password manager is Keeper, SEO is Rank Math, email
   filtering is Hornetsecurity, VoIP is VoxOne, email signatures are Exclaimer. */

export const VENDORS = [
  { key: 'microsoft', label: 'Microsoft', file: 'microsoft.svg',
    words: /microsoft|\b[mo]365\b|\boffice ?365\b|\bwindows\b|sharepoint|onedrive|\bazure\b|\bintune\b|\bentra\b|\bbusiness (basic|standard|premium)\b/i,
    exact: /\b(Teams|Outlook|Exchange|Defender|Copilot)\b/ },
  { key: 'google', label: 'Google', file: 'google.svg',
    words: /google|\bg ?suite\b|\bgmail\b|\bchromebooks?\b/i },
  { key: 'voxone', label: 'VoxOne', file: 'voxone.png',
    words: /\bvox ?one\b|\bvoip\b/i },
  { key: 'hornetsecurity', label: 'Hornetsecurity', file: 'hornetsecurity.png',
    words: /\bhornet ?(security)?\b|\btotal protection\b|\b(e-?mail|spam) ?(security|filter(ing|s)?)\b/i },
  { key: 'acronis', label: 'Acronis', file: 'acronis.svg',
    words: /acronis|\bback-?ups?\b|\bcyber protect\b/i },
  { key: 'opentext', label: 'Webroot (OpenText)', file: 'opentext.png',
    words: /webroot|opentext|\banti-?virus\b|\binternet security\b|\bendpoint (protection|security)\b|\bdns protection\b/i,
    exact: /\bAV\b|\bIS\b(?=\s*[+&\/])/ },   // "IS" only as a service line has it: "IS + Backup"
  { key: 'keeper', label: 'Keeper', file: 'keeper.svg',
    words: /\bkeeper\b|\bpassword (manager|vault)\b/i },
  { key: 'exclaimer', label: 'Exclaimer', file: 'exclaimer.svg',
    words: /exclaimer|\bsignatures?\b/i },
  { key: 'rankmath', label: 'Rank Math', file: 'rankmath.svg',
    words: /\brank ?math\b/i,
    exact: /\bSEO\b/ },
];

/* Phrases that hold a vendor's word and are not that vendor's: VoIP Exchange is VoIP Unlimited's older
   platform (not Microsoft Exchange, and not VoxOne), and VoIP Unlimited is the supplier, whose customers
   may only have a line from it. Blanked out before matching. */
const NOT_A_VENDOR = /\bvoip (exchange|unlimited)\b/gi;

/* One name rarely belongs to more than three; past that the logos stop helping. */
const MOST = 3;

/** An opportunity's title is "Product — Client": the part to read for a vendor is the product. */
export function productPart(title) {
  return String(title ?? '').split(' — ')[0];
}

/** The vendors named in `text`, in the order they are named. */
export function vendorsFor(text) {
  const s = String(text ?? '').replace(NOT_A_VENDOR, m => ' '.repeat(m.length));
  const first = v => Math.min(...[v.words, v.exact].filter(Boolean).map(r => s.search(r)).filter(at => at >= 0));   // Infinity when unnamed
  return VENDORS.map(v => [first(v), v]).filter(([at]) => at < Infinity).sort((a, b) => a[0] - b[0]).slice(0, MOST).map(([, v]) => v);
}

/**
 * The marks as markup. They go in front of a name that stands alone (a heading, a sticky) and, with
 * `after`, behind a name in a column, so the names in the column still line up. The name beside them
 * says the same thing, so they are decorative.
 */
export function vendorMarks(text, after = false) {
  return vendorsFor(text).map(v =>
    `<img class="vendor-mark${after ? ' after' : ''}" src="src/assets/vendors/${v.file}" alt="" title="${v.label}" height="14" loading="lazy" decoding="async">`).join('');
}
