// Fork addition: the source write-policy gate's two call sites.
//
// Upstream v0.51.0.0 funnelled every page mutation (put_page, capture,
// delete_page, takes_*, add_timeline_entry) through
// `persistence/page-mutations.ts:submitPageMutation`. The gate used to live
// inline in the put_page op handler; keeping it there would have left it
// blind to capture and would have re-conflicted on every upstream rebase.
//
// It lives here instead so the fork's footprint in upstream files is a few
// small calls rather than a 60-line block inside a file upstream rewrites
// often. Since upstream v0.60 split admission into `preparePageAdmission`
// (shared by put_page, capture and every put_pages member) and started routing
// sync imports and internal repairs through `put_page`, the gate runs there
// but only when the OP entry point opts in with `writePolicy: true` — agent
// payloads are judged; the repo's own files and maintenance rewrites are not.
import type { OperationContext } from '../operations.ts';
import { OperationError } from '../ops/contract.ts';
import type { PolicyViolation } from './index.ts';
import { recordFunnelEvent } from '../funnel.ts';

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
          suggestion: 'Nothing was written. Call get_write_contract for this source\'s field contract, fix the frontmatter, then retry (validate_page checks without writing).',
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

/**
 * A refused write, thrown from `preparePageAdmission` so every lane that
 * prepares a page (put_page, capture, each put_pages member) stops before
 * admission. `submitPageMutation` turns it back into the plain
 * `{ error, written: false, ... }` response; a put_pages member reports it as
 * its refusal (toJSON carries the violations).
 */
export class WritePolicyRefusal extends OperationError {
  constructor(readonly response: Record<string, unknown>) {
    super('invalid_params',
      typeof response.message === 'string' ? response.message : 'The source write policy refused this page; nothing was written.',
      typeof response.suggestion === 'string' ? response.suggestion : 'Call get_write_contract for this source, fix the page, then retry.');
    this.name = 'WritePolicyRefusal';
  }

  override toJSON() {
    return { ...super.toJSON(), ...this.response, code: String(this.response.error) };
  }
}

/**
 * The passing gate's report, handed from `preparePageAdmission` (where the
 * gate runs) to `submitPageMutation` (where the response is built) without
 * widening upstream's prepare return type. Keyed by the call's ctx object.
 */
const passedReports = new WeakMap<object, PolicyReport>();

/** Gate a prepared page intent in place: throws on refusal, applies normalized content on pass. */
export async function applyMutationWritePolicy(
  ctx: OperationContext,
  input: { sourceId: string | undefined; slug: string; intent: Record<string, unknown>; bypass?: unknown },
): Promise<void> {
  passedReports.delete(ctx);
  const outcome = await runMutationWritePolicy(ctx, {
    sourceId: input.sourceId, slug: input.slug, content: input.intent.content, bypass: input.bypass });
  if (outcome.rejection) throw new WritePolicyRefusal(outcome.rejection);
  if (outcome.content !== undefined) input.intent.content = outcome.content;
  if (outcome.report) passedReports.set(ctx, outcome.report);
}

/** `submitPageMutation`'s response: add `policy` (contract satisfied + warnings) when the gate passed this call. */
export function withWritePolicyReport(ctx: object, operation: string, response: Record<string, unknown>): Record<string, unknown> {
  const report = isGatedOperation(operation) ? passedReports.get(ctx) : undefined;
  passedReports.delete(ctx);
  return report ? { ...response, policy: report } : response;
}

/** `submitPageMutation`'s catch: a policy refusal becomes the response; anything else is rethrown. */
export function writePolicyRefusalResponse(error: unknown): Record<string, unknown> {
  if (error instanceof WritePolicyRefusal) return error.response;
  throw error;
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

/**
 * Fork: upstream's `funnelPassThrough('save')` counts every settled put_page,
 * but a policy refusal RESOLVES as a response (`{ error, written: false }`)
 * instead of throwing — so a blocked write would be recorded as a save and the
 * funnel would conflate attempts with commits. Upstream's own intent is
 * "a committed put_page records a save" (module-size-limits.tsv, D8 funnel),
 * so count only what committed. Lives here, with the gate's other call sites,
 * to keep the fork's footprint in upstream files to one call.
 */
export function funnelSaveUnlessRefused<T>(result: T): T {
  const refused = typeof result === 'object' && result !== null
    && (result as { error?: unknown }).error !== undefined;
  if (!refused) recordFunnelEvent('save');
  return result;
}
