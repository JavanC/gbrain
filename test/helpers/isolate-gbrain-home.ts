/**
 * Per-FILE isolation of `GBRAIN_HOME`, for tests whose behavior depends on the
 * embedding column resolved from the config FILE.
 *
 * Why not a global preload: setting `GBRAIN_HOME` process-wide reaches further
 * than it looks. `configDir()` reads it BEFORE falling back to `homedir()`, so
 * every test that spawns the CLI with `{...process.env, HOME: tmp}` inherits it
 * and silently ignores its own temp HOME; and several suites got materially
 * slower or hung outright when their engine setup lost the operator's config.
 * The blast radius across ~250 files was not worth it. Isolate the files that
 * actually need it.
 *
 * What leaks without this: `test/helpers/legacy-embedding-preload.ts` pins the
 * GATEWAY to OpenAI/1536, but `search/embedding-column.ts::resolveEmbeddingColumn`
 * resolves the active column from `loadConfig()` — the config FILE. On a machine
 * whose brain runs a non-default provider (e.g. a 1280-d one), the column
 * resolves to 1280 while the stubbed query embedding is 1536. `searchVector`
 * then fails the dimension check, `hybridSearch` swallows it via its fail-open
 * catch, and the test silently takes the keyword-only fallback — skipping the
 * reranker / cross-modal / intent-gate branches it exists to pin. Green in CI
 * (no config file), red on a developer machine.
 *
 * Usage — call at MODULE SCOPE, before the file's own imports of gbrain code
 * run any config read:
 *
 *   import { isolateGbrainHome } from '../helpers/isolate-gbrain-home.ts';
 *   isolateGbrainHome();
 *
 * Restores the previous value on process exit. Files that manage
 * `GBRAIN_HOME` themselves per-test should NOT call this.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let applied = false;

export function isolateGbrainHome(): string {
  if (applied) return process.env.GBRAIN_HOME!;
  const prev = process.env.GBRAIN_HOME;
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-test-home-'));
  process.env.GBRAIN_HOME = dir;
  applied = true;
  process.on('exit', () => {
    if (prev === undefined) delete process.env.GBRAIN_HOME;
    else process.env.GBRAIN_HOME = prev;
  });
  return dir;
}
