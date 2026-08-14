// Resolve a source's write policy from its own repo.
//
// Resolution: sources.local_path (DB) → <local_path>/gbrain.yml → the
// `write_policy:` block. The policy is version-controlled INSIDE the source
// repo on purpose: the rules belong to the repo that will reject the commit,
// not to the brain that happens to index it. A source with no local_path (pure
// DB source, mounted remote brain) has no policy and keeps legacy behavior.
//
// Cached in-process keyed by (path, mtimeMs, size) so a `put_page` burst does
// not re-read + re-parse the YAML per call, while an operator editing
// gbrain.yml sees the change on the next write without a restart.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { safeLoad as yamlSafeLoad } from 'js-yaml';
import type { BrainEngine } from '../engine.ts';
import { parseWritePolicy, WritePolicyParseError, type WritePolicyV1 } from './policy-v1.ts';

export interface LoadedWritePolicy {
  policy: WritePolicyV1;
  /** Absolute path of the gbrain.yml the policy came from. */
  path: string;
}

/** Why no policy is in force. Surfaced by `get_write_contract` so an agent can tell "no rules" from "misconfigured". */
export type NoPolicyReason =
  | 'no_source'
  | 'no_local_path'
  | 'no_gbrain_yml'
  | 'no_write_policy_block'
  | 'disabled';

export type WritePolicyResolution =
  | { status: 'active'; policy: WritePolicyV1; path: string }
  | { status: 'inactive'; reason: NoPolicyReason; path?: string }
  | { status: 'error'; error: string; path: string };

interface CacheEntry {
  mtimeMs: number;
  size: number;
  result: WritePolicyResolution;
}

const cache = new Map<string, CacheEntry>();

/** Test seam: force a resolution for a source id, bypassing DB + disk. */
let _override: ((sourceId: string) => WritePolicyResolution | undefined) | null = null;

export function __setWritePolicyOverrideForTests(
  fn: ((sourceId: string) => WritePolicyResolution | undefined) | null,
): void {
  _override = fn;
}

export function _resetWritePolicyCacheForTests(): void {
  cache.clear();
  _override = null;
}

/** Parse a gbrain.yml string and extract its write policy. Exported for tests. */
export function resolveWritePolicyFromYaml(content: string, path: string): WritePolicyResolution {
  let doc: unknown;
  try {
    doc = yamlSafeLoad(content);
  } catch (e) {
    return { status: 'error', error: `gbrain.yml is not valid YAML: ${(e as Error).message}`, path };
  }
  const root = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
  if (root.write_policy === undefined || root.write_policy === null) {
    return { status: 'inactive', reason: 'no_write_policy_block', path };
  }
  let policy: WritePolicyV1 | null;
  try {
    policy = parseWritePolicy(root.write_policy, path);
  } catch (e) {
    const msg = e instanceof WritePolicyParseError ? e.message : (e as Error).message;
    return { status: 'error', error: msg, path };
  }
  if (!policy) return { status: 'inactive', reason: 'no_write_policy_block', path };
  if (!policy.enabled) return { status: 'inactive', reason: 'disabled', path };
  return { status: 'active', policy, path };
}

async function sourceLocalPath(engine: BrainEngine, sourceId: string): Promise<string | null> {
  const rows = await engine.executeRaw<{ local_path: string | null }>(
    `SELECT local_path FROM sources WHERE id = $1 LIMIT 1`,
    [sourceId],
  );
  if (rows.length === 0) return null;
  return rows[0].local_path ?? null;
}

/**
 * Resolve the active write policy for a source.
 *
 * NEVER throws: a policy that cannot be loaded returns `status: 'error'`, and
 * the caller decides. `put_page` treats a load error as fail-CLOSED for the
 * policy check only when a policy file exists but is malformed — a source that
 * simply has no policy keeps working exactly as before.
 */
export async function loadWritePolicyForSource(
  engine: BrainEngine,
  sourceId: string | undefined,
): Promise<WritePolicyResolution> {
  if (!sourceId) return { status: 'inactive', reason: 'no_source' };
  if (_override) {
    const forced = _override(sourceId);
    if (forced) return forced;
  }

  let localPath: string | null = null;
  try {
    localPath = await sourceLocalPath(engine, sourceId);
  } catch {
    // Sources table unavailable (fresh brain, mid-migration). No policy, legacy behavior.
    return { status: 'inactive', reason: 'no_source' };
  }
  if (!localPath) return { status: 'inactive', reason: 'no_local_path' };

  const ymlPath = join(localPath, 'gbrain.yml');
  if (!existsSync(ymlPath)) return { status: 'inactive', reason: 'no_gbrain_yml', path: ymlPath };

  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(ymlPath);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    return { status: 'inactive', reason: 'no_gbrain_yml', path: ymlPath };
  }

  const cached = cache.get(ymlPath);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.result;

  let content: string;
  try {
    content = readFileSync(ymlPath, 'utf-8');
  } catch (e) {
    return { status: 'error', error: `cannot read gbrain.yml: ${(e as Error).message}`, path: ymlPath };
  }

  const result = resolveWritePolicyFromYaml(content, ymlPath);
  cache.set(ymlPath, { mtimeMs, size, result });
  return result;
}
