// Composition layer: load policy → fetch the existing page → validate.
//
// `put_page` (the enforcing gate) and `validate_page` (the preflight) both call
// `runWritePolicyGate`, so a preflight PASS is a guarantee that the write will
// not be rejected for policy reasons.

import type { BrainEngine } from '../engine.ts';
import { loadWritePolicyForSource, type NoPolicyReason } from './load.ts';
import { validatePageAgainstPolicy, type ValidatePageResult } from './validate.ts';
import type { WritePolicyV1 } from './policy-v1.ts';

export type WritePolicyGateOutcome =
  /** Source declares no (enabled) policy — legacy behavior, caller writes as before. */
  | { status: 'no_policy'; reason: NoPolicyReason }
  /** A policy exists but could not be loaded. Fail-closed: the caller must NOT write. */
  | { status: 'policy_error'; error: string; path: string }
  /** Policy in force; `result` says whether the payload passes. */
  | { status: 'checked'; policy: WritePolicyV1; result: ValidatePageResult };

export interface WritePolicyGateInput {
  engine: BrainEngine;
  sourceId?: string | undefined;
  slug: string;
  content: string;
  now?: Date;
}

interface SlugCacheEntry {
  at: number;
  basenames: Set<string>;
}

const SLUG_CACHE_TTL_MS = 15_000;
const slugCache = new Map<string, SlugCacheEntry>();

export function _resetWritePolicySlugCacheForTests(): void {
  slugCache.clear();
}

/**
 * Bare-slug index for connection resolvability.
 *
 * A brain page slug is path-qualified (`concepts/foo`) while a
 * `connections[].id` is the bare tail (`foo`) — the same shape the repo lint
 * compares against filenames. One scoped scan per source, cached briefly:
 * `put_page` bursts share it, and a page created seconds ago is picked up on
 * the next window.
 */
async function knownBasenames(engine: BrainEngine, sourceId: string): Promise<Set<string>> {
  const cached = slugCache.get(sourceId);
  if (cached && Date.now() - cached.at < SLUG_CACHE_TTL_MS) return cached.basenames;

  const rows = await engine.executeRaw<{ slug: string }>(
    `SELECT slug FROM pages WHERE source_id = $1 AND deleted_at IS NULL`,
    [sourceId],
  );
  const basenames = new Set<string>();
  for (const row of rows) {
    if (typeof row.slug !== 'string') continue;
    basenames.add(row.slug);
    const tail = row.slug.split('/').pop();
    if (tail) basenames.add(tail);
  }
  slugCache.set(sourceId, { at: Date.now(), basenames });
  return basenames;
}

export async function runWritePolicyGate(input: WritePolicyGateInput): Promise<WritePolicyGateOutcome> {
  const { engine, sourceId, slug, content } = input;
  const resolution = await loadWritePolicyForSource(engine, sourceId);

  if (resolution.status === 'inactive') return { status: 'no_policy', reason: resolution.reason };
  if (resolution.status === 'error') {
    return { status: 'policy_error', error: resolution.error, path: resolution.path };
  }

  const policy = resolution.policy;

  // Scoped to the write target's own source: `put_page` writes to ctx.sourceId,
  // so a federated read grant must not widen what counts as "the existing page".
  const scope = sourceId ? { sourceId } : {};
  const existing = await engine.getPage(slug, scope);

  const result = await validatePageAgainstPolicy({
    policy,
    slug,
    content,
    existingFrontmatter: existing ? (existing.frontmatter ?? {}) : null,
    ...(input.now ? { now: input.now } : {}),
    ...(policy.connection_rules.require_resolvable !== 'off' && sourceId
      ? {
        resolveKnownSlugs: async (ids: string[]) => {
          const known = await knownBasenames(engine, sourceId);
          return new Set(ids.filter((id) => known.has(id)));
        },
      }
      : {}),
  });

  return { status: 'checked', policy, result };
}
