#!/usr/bin/env node
/**
 * Generates preview/pwa/ — an installable copy of the portal served from a
 * subdirectory of the same GitHub Pages site.
 *
 * Why this exists: the portal cannot be shipped as an installable app without
 * a real-device test, and there is nowhere to run that test. Pages serves the
 * repository root, so deploying to the live URL to test it is the same act as
 * shipping it. A subdirectory gives a genuinely installable HTTPS URL while the
 * live index.html stays untouched.
 *
 * Generated rather than hand-copied because the sign-in flow may need changing
 * between test rounds, and a stale copy would test the wrong code.
 *
 * BEFORE THIS WORKS: the preview URL must be registered as a SPA redirect URI
 * on the Entra app registration. Without it, sign-in fails with AADSTS50011 and
 * the test says nothing about standalone behaviour.
 *
 * Usage:  node tools/build-preview.mjs
 * Delete: rm -rf preview/    (once the question is settled either way)
 */

import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(REPO, 'preview/pwa');

const PROD_URI = 'https://gecko-it-services.github.io/gecko-intranet/';
const PREVIEW_URI = 'https://gecko-it-services.github.io/gecko-intranet/preview/pwa/';

const html = await readFile(resolve(REPO, 'index.html'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(REPO, 'manifest.webmanifest'), 'utf8'));

/* ── index.html ────────────────────────────────────────────────────────── */

const needle = `REDIRECT_URI: '${PROD_URI}'`;
if (!html.includes(needle)) {
  throw new Error(
    `CONFIG.REDIRECT_URI is not the expected production URI — refusing to guess.\n` +
    `Expected to find: ${needle}`
  );
}

let out = html.replace(needle, `REDIRECT_URI: '${PREVIEW_URI}'`);

// A banner, so nobody mistakes an installed preview for the real portal.
out = out.replace(
  '</head>',
  `<style>
  body::after {
    content: 'PREVIEW BUILD — not the live portal';
    position: fixed; inset: auto 0 0 0; z-index: 99999;
    padding: 4px max(8px, env(safe-area-inset-right,0px))
             calc(4px + env(safe-area-inset-bottom,0px))
             max(8px, env(safe-area-inset-left,0px));
    background: #7a2d0e; color: #fff;
    font: 600 11px/1.4 ui-monospace, monospace;
    letter-spacing: .06em; text-align: center; pointer-events: none;
  }
</style>
</head>`
);

await mkdir(OUT, { recursive: true });
await writeFile(resolve(OUT, 'index.html'), out);

/* ── manifest ──────────────────────────────────────────────────────────── */

manifest.start_url = PREVIEW_URI;
manifest.scope = PREVIEW_URI;
manifest.name = `${manifest.name} (Preview)`;
manifest.short_name = 'Gecko Preview';

await writeFile(
  resolve(OUT, 'manifest.webmanifest'),
  JSON.stringify(manifest, null, 2) + '\n'
);

/* ── icons (referenced relatively by the manifest) ─────────────────────── */

for (const icon of manifest.icons) {
  await copyFile(resolve(REPO, icon.src), resolve(OUT, icon.src));
}

/* ── src/ (ES modules index.html requests at runtime) ──────────────────── */

// Without this the preview 404s on src/main.js, no section registers itself,
// and a device test reports the Projects board broken when it simply never ran.
await cp(resolve(REPO, 'src'), resolve(OUT, 'src'), { recursive: true });

console.log(`preview/pwa built → ${PREVIEW_URI}`);
console.log('Register that URI as a SPA redirect URI in Entra before testing.');
