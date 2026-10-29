import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { ALL_SOUNDS, MUSIC, SFX } from './manifest';

const AUDIO_DIR = fileURLToPath(new URL('../../public/audio/', import.meta.url));
const POWERUPS_DIR = fileURLToPath(new URL('../powerups/', import.meta.url));

test('manifest names are unique', () => {
  expect(new Set(ALL_SOUNDS).size).toBe(MUSIC.length + SFX.length);
});

test('every manifest sound has an mp3 in public/audio', () => {
  const missing = ALL_SOUNDS.filter((n) => !existsSync(`${AUDIO_DIR}${n}.mp3`));
  expect(missing).toEqual([]);
});

test('public/audio has no mp3 outside the manifest', () => {
  const files = existsSync(AUDIO_DIR) ? readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.mp3')) : [];
  const known = new Set<string>(ALL_SOUNDS.map((n) => `${n}.mp3`));
  expect(files.filter((f) => !known.has(f))).toEqual([]);
});

/** All non-test .ts files under a directory, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory()) out.push(...sources(`${p}/`));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

test('every sfx string literal in src/powerups is in the manifest', () => {
  const known = new Set<string>(ALL_SOUNDS);
  const used: string[] = [];
  for (const file of sources(POWERUPS_DIR)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bsfx\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) used.push(m[1]);
  }
  expect(used.length).toBeGreaterThan(5); // the scan really found the calls
  expect(used.filter((n) => !known.has(n))).toEqual([]);
});

test('docs/audio-assets.md describes every sound and nothing else', () => {
  const doc = readFileSync(fileURLToPath(new URL('../../../../docs/audio-assets.md', import.meta.url)), 'utf8');
  const sections = [...doc.matchAll(/^## ([a-z_]+)\.mp3\s*$/gm)].map((m) => m[1]);
  expect(sections.sort()).toEqual([...ALL_SOUNDS].sort());
});
