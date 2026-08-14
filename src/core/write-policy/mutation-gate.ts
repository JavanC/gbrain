// Fork addition: the source write-policy gate's two call sites.
//
// Upstream v0.51.0.0 funnelled every page mutation (put_page, capture,
// delete_page, takes_*, add_timeline_entry) through
// `persistence/page-mutations.ts:submitPageMutation`. The gate used to live
// inline in the put_page op handler; keeping it there would have left it
// blind to capture and would have re-conflicted on every upstream rebase.
//
// It lives here instead so the fork's footprint in upstream files is two
// small calls — one in submitPageMutation (real writes) and one in the
// put_page handler's dry-run branch (previews) — rather than a 60-line block
// inside a file upstream rewrites often.
import type { OperationContext } from '../operations.ts';
import type { PolicyViolation } from './index.ts';

export interface PolicyReport {
  contract_version: string;
  normalized: boolean;
  warnings: PolicyViolation[];
}

export interface GateOutcome {
  /** Set when the write must be refused. Nothing has been written. */
  rejection?: Record<string, unknown>;
  /** Set when a policy applied and the payload passed. */
  report?: PolicyReport;
  /** Normalized content, when the gate rewrote it. */
  content?: string;
}

/** Operations whose payload is a full markdown page the contract can judge. */
const GATED_OPERATIONS = new Set(['put_page', 'capture']);

export function isGatedOperation(operation: string): boolean {
  return GATED_OPERATIONS.has(operation);
}

/**
 * Run the source's write policy over a page payload.
 *
 * Fail-CLOSED: a source that declares a policy we cannot parse gets no
 * writes. Degrading to "no rules" would hand the caller a green light for
 * pages the repo will later refuse, which is the exact failure this gate
 * exists to remove.
 *
 * Sources with no policy behave exactly as they always have.
 */
export async function runMutationWritePolicy(
  ctx: OperationContext,
  input: { sourceId: string | undefined; slug: string; content: unknown; bypass?: unknown },
): Promise<GateOutcome> {
  if (typeof input.content !== 'string') return {};
  // bypass is LOCAL CLI ONLY; a remote caller cannot opt out of its contract.
  if (ctx.remote === false && input.bypass === true) return {};

  const { runWritePolicyGate } = await import('./index.ts');
  const gate = await runWritePolicyGate({
    engine: ctx.engine,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    slug: input.slug,
    content: input.content,
  });

  if (gate.status === 'policy_error') {
    return {
      rejection: {
        error: 'write_policy_unavailable',
        slug: input.slug,
        written: false,
        message: `source "${input.sourceId ?? 'default'}" declares a write policy that failed to load: ${gate.error}`,
        // The filesystem path is local-only detail.
        ...(ctx.remote === false ? { policy_path: gate.path } : {}),
      },
    };
  }

  if (gate.status === 'checked') {
    if (!gate.result.valid) {
      return {
        rejection: {
          error: 'policy_violation',
          slug: input.slug,
          written: false,
          source_id: input.sourceId ?? null,
          contract_version: gate.policy.contract_version,
          violations: gate.result.violations,
          hint: 'Nothing was written. Call get_write_contract for this source\'s field contract, fix the frontmatter, then retry (validate_page checks without writing).',
        },
      };
    }
    return {
      content: gate.result.normalized_content,
      report: {
        contract_version: gate.policy.contract_version,
        normalized: gate.result.normalized,
        warnings: gate.result.violations.filter((v) => v.severity === 'warning'),
      },
    };
  }

  return {};
}

/** Dry-run preview: surface the same rejection a real write would produce. */
export async function previewWritePolicy(
  ctx: OperationContext,
  p: Record<string, unknown>,
): Promise<GateOutcome> {
  const slug = typeof p.slug === 'string' ? p.slug.toLowerCase() : '';
  if (!slug) return {};
  const { pageMutationSource } = await import('../persistence/page-mutations.ts');
  return runMutationWritePolicy(ctx, {
    sourceId: pageMutationSource(ctx, p, 'put_page'),
    slug,
    content: p.content,
    bypass: p.bypass_policy,
  });
}
