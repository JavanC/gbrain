/**
 * Source write-contract ops — the READ half of the source write policy.
 *
 * `get_write_contract` discloses what a source demands of a page;
 * `validate_page` preflights a payload against it without writing. The
 * enforcing half is the gate inside `put_page` (ops/pages.ts), and both halves
 * run the SAME validator (`validatePageAgainstPolicy`), so a preflight pass
 * guarantees the write is not policy-rejected and disclosure cannot drift from
 * enforcement.
 *
 * Peeled out of ops/pages.ts rather than added to it: that module sits at its
 * module-size ratchet ceiling and its own note asks the next growth to peel a
 * submodule. Keeping this here also means the fork's read-side surface lives
 * in a file upstream does not have, so it never conflicts on a rebase — only
 * the gate itself, which must live inside put_page, does.
 */

import type { Operation, OperationContext } from './contract.ts';

/**
 * Resolve which source a write-contract question is about, refusing to answer
 * for a source the caller has no grant on.
 *
 * Precedence mirrors sourceScopeOpts: an explicit `source_id` is honored only
 * when it is inside the caller's federated grant (or the caller is a trusted
 * local CLI); otherwise the caller's own scalar source answers.
 */
function resolveContractSourceId(
  ctx: OperationContext,
  requested: unknown,
): { sourceId: string } | { error: string; message: string } {
  const asked = typeof requested === 'string' && requested.trim() ? requested.trim() : null;
  const allowed = ctx.auth?.allowedSources;
  if (!asked) {
    if (ctx.sourceId) return { sourceId: ctx.sourceId };
    if (allowed && allowed.length === 1) return { sourceId: allowed[0] };
    return { sourceId: 'default' };
  }
  if (ctx.remote === false) return { sourceId: asked };
  if (allowed && allowed.length > 0) {
    if (allowed.includes(asked)) return { sourceId: asked };
  } else if (ctx.sourceId && asked === ctx.sourceId) {
    return { sourceId: asked };
  }
  return {
    error: 'source_not_permitted',
    message: `caller is not scoped to source "${asked}"`,
  };
}

const get_write_contract: Operation = {
  name: 'get_write_contract',
  description:
    'Return the page-write contract for a source: which frontmatter fields you must supply, which ' +
    'ones the server fills or preserves, which page types each directory accepts, the connection-id ' +
    'rules, and a copy-pasteable template. Call this ONCE before your first put_page to a source (and ' +
    'again when contract_version changes). Sources that declare no policy return enforced: false, ' +
    'meaning put_page accepts any well-formed markdown.',
  params: {
    source_id: {
      type: 'string',
      required: false,
      description: 'Source to describe. Defaults to the caller\'s own source; a source outside the caller\'s grant is refused.',
    },
  },
  scope: 'read',
  area: 'pages',
  handler: async (ctx, p) => {
    const resolved = resolveContractSourceId(ctx, p.source_id);
    if ('error' in resolved) return resolved;
    const { loadWritePolicyForSource, buildWriteContract, buildNoContract } = await import('../write-policy/index.ts');
    const resolution = await loadWritePolicyForSource(ctx.engine, resolved.sourceId);
    if (resolution.status === 'active') return buildWriteContract(resolved.sourceId, resolution.policy);
    if (resolution.status === 'error') {
      return buildNoContract(resolved.sourceId, 'policy_error', resolution.error);
    }
    return buildNoContract(resolved.sourceId, resolution.reason);
  },
  cliHints: { name: 'write-contract' },
};

const validate_page: Operation = {
  name: 'validate_page',
  description:
    'Preflight a put_page payload against the source write contract WITHOUT writing anything. Returns ' +
    'valid, machine-readable violations (each with a fix), and the normalized frontmatter the server ' +
    'would store. Same validator put_page runs, so a pass here means put_page will not reject the page.',
  params: {
    slug: { type: 'string', required: true, description: 'Page slug the content would be written to' },
    content: { type: 'string', required: true, description: 'Full markdown content with YAML frontmatter' },
  },
  scope: 'read',
  area: 'pages',
  handler: async (ctx, p) => {
    const slug = p.slug as string;
    const { runWritePolicyGate } = await import('../write-policy/index.ts');
    const gate = await runWritePolicyGate({
      engine: ctx.engine,
      ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
      slug,
      content: p.content as string,
    });
    if (gate.status === 'no_policy') {
      return {
        valid: true,
        enforced: false,
        slug,
        source_id: ctx.sourceId ?? null,
        reason: gate.reason,
        violations: [],
      };
    }
    if (gate.status === 'policy_error') {
      return {
        valid: false,
        enforced: true,
        slug,
        source_id: ctx.sourceId ?? null,
        error: 'write_policy_unavailable',
        message: gate.error,
        violations: [],
      };
    }
    return {
      valid: gate.result.valid,
      enforced: true,
      slug,
      source_id: ctx.sourceId ?? null,
      contract_version: gate.policy.contract_version,
      is_update: gate.result.is_update,
      violations: gate.result.violations,
      normalized: gate.result.normalized,
      normalized_frontmatter: gate.result.normalized_frontmatter,
    };
  },
  cliHints: { name: 'validate-page', positional: ['slug'], stdin: 'content' },
};

export const writeContractOperations: Operation[] = [get_write_contract, validate_page];
