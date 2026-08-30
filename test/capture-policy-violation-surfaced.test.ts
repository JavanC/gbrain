/**
 * `gbrain capture`'s result handling assumed put_page always returns the
 * success shape ({slug, status, chunks, write_through}). A source-scoped
 * write policy (src/core/write-policy/) rejects a non-conforming page by
 * RETURNING ({error, violations, hint}) rather than throwing — a normal
 * return value, by design, so callers can inspect machine-readable
 * violations. Falling through to the success-shaped receipt printer
 * silently dropped `error`/`violations`/`hint` and printed a bare
 * "written: false" / "status: unknown" with no indication of why.
 *
 * Reproduced live against production 2026-08-30 during the v0.47.4.1
 * upgrade smoke test: `gbrain capture` on a source with a required `tags`
 * field printed nothing but "status: unknown"; `gbrain call put_page` with
 * the same content surfaced the real policy_violation + fix.
 *
 * This covers both runCapture code paths that read a put_page-shaped
 * result: the local-install path (operations dispatch in-process) and the
 * thin-client path (unpackToolResult over the wire) — same bug, same fix,
 * both call sites.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';
import { runCapture } from '../src/commands/capture.ts';
import {
  _resetWritePolicyCacheForTests,
  _resetWritePolicySlugCacheForTests,
} from '../src/core/write-policy/index.ts';

const POLICY_YML = `
write_policy:
  version: 1
  enabled: true
  contract_version: "1"
  required_fields: [title, type, tags]
  non_empty_list_fields: [tags]
  type_path_rules:
    - prefix: inbox/
      types: any
  slug_rules:
    scope: known_prefixes
    known_prefixes: [inbox/]
`;

let engine: PGLiteEngine;
let repoDir: string;
let stderrLines: string[];
let stdoutLines: string[];
let exitCode: number | undefined;
const origError = console.error;
const origLog = console.log;
const origExit = process.exit;

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  repoDir = mkdtempSync(join(tmpdir(), 'gbrain-capture-policy-'));
  writeFileSync(join(repoDir, 'gbrain.yml'), POLICY_YML);
});

afterAll(async () => {
  await engine.disconnect();
  rmSync(repoDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetPgliteState(engine);
  _resetWritePolicyCacheForTests();
  _resetWritePolicySlugCacheForTests();
  await engine.executeRaw(
    `INSERT INTO sources (id, name, local_path) VALUES ($1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET local_path = EXCLUDED.local_path`,
    ['policed', repoDir],
  );
  stderrLines = [];
  stdoutLines = [];
  exitCode = undefined;
  console.error = (...args: unknown[]) => { stderrLines.push(args.join(' ')); };
  console.log = (...args: unknown[]) => { stdoutLines.push(args.join(' ')); };
  // runCapture calls process.exit(1) directly on a rejected write — throw
  // instead so the test can observe it without actually killing the runner.
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    exitCode = code;
    throw new Error('__process_exit__');
  }) as never;
});

afterEach(() => {
  console.error = origError;
  console.log = origLog;
  process.exit = origExit;
});

describe('gbrain capture surfaces a rejected write-policy gate', () => {
  test('missing required field: prints the violation + fix, exits 1, no bland "written: false"', async () => {
    await expect(
      runCapture(engine, ['Body with no frontmatter fields', '--slug', 'inbox/policy-miss', '--source', 'policed']),
    ).rejects.toThrow('__process_exit__');

    expect(exitCode).toBe(1);
    const combined = stderrLines.join('\n');
    expect(combined).toContain('policy_violation');
    // The actual violation (missing `tags`) must be named, not swallowed.
    expect(combined).toContain('tags');
    // Nothing printed as if the write had merely under-reported success.
    expect(stdoutLines.join('\n')).not.toContain('status:');
  });

  test('a conforming write still succeeds normally through the same path', async () => {
    // Positional content starting with '---' would be misread as an unknown
    // "--" flag by parseArgs and silently dropped (a separate, pre-existing
    // quirk) — use --file so the frontmatter-bearing body reaches runCapture
    // as content, same as a real `gbrain capture --file notes.md` call.
    const content = '---\ntitle: Policy OK\ntype: note\ntags:\n  - smoke\n---\n\nBody.\n';
    const filePath = join(repoDir, '..', 'policy-ok-input.md');
    writeFileSync(filePath, content);
    try {
      await runCapture(engine, ['--file', filePath, '--slug', 'inbox/policy-ok', '--source', 'policed']);
    } finally {
      rmSync(filePath, { force: true });
    }
    expect(exitCode).toBeUndefined();
    const page = await engine.getPage('inbox/policy-ok', { sourceId: 'policed' });
    expect(page).not.toBeNull();
  });
});
