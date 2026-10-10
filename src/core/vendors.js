/* Vendor marks: a small logo beside a product's name, so what is Microsoft's, Google's, VoxOne's and
   so on reads at a glance. Design: docs/superpowers/specs/2026-10-10-vendor-marks-design.md

   A vendor is recognised from the words in the name (a service line, a catalogue product, an
   opportunity's title), so a product added or renamed on the Products tab picks its mark up without
   a code change. The images are in src/assets/vendors/. No top-level window access. */

export const VENDORS = [
  { key: 'microsoft',      label: 'Microsoft',          file: 'microsoft.svg',      match: /microsoft|\b[mo]365\b|office 365|\bwindows (10|11)\b|sharepoint|onedrive|\bintune\b|\bentra\b/i },
  { key: 'google',         label: 'Google',             file: 'google.svg',         match: /google|g suite|gmail/i },
  { key: 'voxone',         label: 'VoxOne',             file: 'voxone.png',         match: /vox ?one/i },
  { key: 'hornetsecurity', label: 'Hornetsecurity',     file: 'hornetsecurity.png', match: /hornet/i },
  // Gecko's backups are Acronis and its antivirus is Webroot (Jack, 10 Oct 2026), so the plain words count too.
  // "AV" and "IS" only in capitals, and "IS" only as it is typed on a service line ("IS + Backup").
  { key: 'acronis',        label: 'Acronis',            file: 'acronis.svg',        match: /acronis|\bback-?ups?\b/i },
  { key: 'opentext',       label: 'Webroot (OpenText)', file: 'opentext.png',       match: /[Ww]ebroot|[Oo]pen[Tt]ext|[Aa]nti-?[Vv]irus|[Ii]nternet [Ss]ecurity|\bAV\b|\bIS\b(?=\s*[+&\/])/ },
];

/** The vendors named in `text`, in the order they are named. */
export function vendorsFor(text) {
  const s = String(text ?? '');
  return VENDORS.map(v => [s.search(v.match), v]).filter(([at]) => at >= 0).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
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
