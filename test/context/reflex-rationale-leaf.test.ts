/**
 * Pins the import shape that keeps `logDeliveredReflexPointers` correct.
 *
 * That function must register its pending write SYNCHRONOUSLY — behind a
 * dynamic `import()` the registration lands a microtask late, and anything
 * draining immediately after (a CLI exit path, a test awaiting the sink) sees
 * an empty pending set and drops the event. So `retrieval-reflex.ts` statically
 * imports `volunteer-events.ts`.
 *
 * That is only safe while volunteer-events.ts does NOT statically import
 * retrieval-reflex.ts back. It used to: it pulled `reflexPointerRationale` from
 * there, closing a runtime cycle that ESM happened to tolerate. The template
 * now lives in the leaf `reflex-rationale.ts`, which both sides import.
 *
 * Without this test the cycle comes back the first time someone reaches for
 * anything else in retrieval-reflex.ts from volunteer-events.ts, and nothing
 * fails loudly when they do.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const CONTEXT_DIR = join(import.meta.dir, '..', '..', 'src', 'core', 'context');
const read = (f: string) => readFileSync(join(CONTEXT_DIR, f), 'utf8');

/**
 * Strip comments before pattern-matching on code. Both files DISCUSS the
 * dynamic-import bug in prose, so a naive search finds the very string the
 * assertion is trying to prove absent.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Runtime (value) imports only — `import type` and inline `import('…')` types erase. */
function runtimeImportSources(src: string): string[] {
  const out: string[] = [];
  const re = /^import\s+(?!type\s)([^;]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of stripComments(src).matchAll(re)) out.push(m[2]);
  return out;
}

describe('reflex rationale lives in a leaf module (no runtime import cycle)', () => {
  test('volunteer-events does not import retrieval-reflex at runtime', () => {
    const sources = runtimeImportSources(read('volunteer-events.ts'));
    expect(sources).not.toContain('./retrieval-reflex.ts');
  });

  test('retrieval-reflex imports volunteer-events statically, not dynamically', () => {
    const src = read('retrieval-reflex.ts');
    expect(runtimeImportSources(src)).toContain('./volunteer-events.ts');
    // The dynamic form is the bug this arrangement exists to prevent. Checked
    // against comment-stripped source — the file explains that bug in prose,
    // and the prose contains the exact string being ruled out.
    expect(stripComments(src)).not.toMatch(
      /import\(\s*['"]\.\/volunteer-events\.ts['"]\s*\)/,
    );
  });

  test('both sides take the template from the leaf', () => {
    for (const f of ['retrieval-reflex.ts', 'volunteer-events.ts']) {
      expect(runtimeImportSources(read(f))).toContain('./reflex-rationale.ts');
    }
  });

  test('the leaf imports nothing — that is what makes it a leaf', () => {
    expect(runtimeImportSources(read('reflex-rationale.ts'))).toEqual([]);
  });

  test('the template still produces the rationale callers expect', async () => {
    const { reflexPointerRationale } = await import(
      '../../src/core/context/reflex-rationale.ts'
    );
    expect(reflexPointerRationale({ arm: 'alias', display: 'Acme Corp' })).toBe(
      'alias match "Acme Corp"',
    );
  });

  test('retrieval-reflex still re-exports it for existing callers', async () => {
    const m = await import('../../src/core/context/retrieval-reflex.ts');
    expect(typeof m.reflexPointerRationale).toBe('function');
  });
});
