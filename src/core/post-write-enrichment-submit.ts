import type { BrainEngine } from './engine.ts';
import { MinionQueue } from './minions/queue.ts';
import { isGatedOperation } from './write-policy/mutation-gate.ts';

export const POST_WRITE_ENRICHMENT_JOB = 'post-write-enrichment';
export const ASYNC_ENRICHMENT_CONFIG_KEY = 'writer.async_enrichment';

export async function isAsyncPostWriteEnrichmentEnabled(engine: BrainEngine): Promise<boolean> {
  const value = await engine.getConfig(ASYNC_ENRICHMENT_CONFIG_KEY);
  return value === 'true' || value === '1';
}

export async function submitPostWriteEnrichment(
  engine: BrainEngine,
  input: { slug: string; sourceId: string },
): Promise<{ queued: true; job_id: number }> {
  const queue = new MinionQueue(engine);
  const job = await queue.add(
    POST_WRITE_ENRICHMENT_JOB,
    { slug: input.slug, sourceId: input.sourceId },
    {
      max_attempts: 5,
      backoff_type: 'exponential',
      backoff_delay: 1_000,
      backoff_jitter: 0.2,
      timeout_ms: 120_000,
    },
  );
  return { queued: true, job_id: job.id };
}

/**
 * Fork: the submitPageMutation-side wrapper.
 *
 * Every page mutation funnels through `persistence/page-mutations.ts`, so the
 * enabled-check + fail-open wrapper lives here — fork-owned functions the
 * funnel calls, rather than a block inside a file upstream rewrites often.
 *
 * Never throws: the page is already durably written when this runs, so an
 * enrichment failure is reported, not raised.
 */
export async function queuePostWriteEnrichment(
  ctx: { engine: BrainEngine },
  sourceId: string,
  slug: string,
  replay = false,
): Promise<
  | { queued: true; job_id: number }
  | { skipped: 'disabled' | 'replay' }
  | { error: string }
> {
  try {
    if (!(await isAsyncPostWriteEnrichmentEnabled(ctx.engine))) return { skipped: 'disabled' };
    // A replay performed no new write, so it must not queue a second job —
    // but it still reports, because upstream's idempotency contract says a
    // repeated request returns the shape its original returned.
    if (replay) return { skipped: 'replay' };
    return await submitPostWriteEnrichment(ctx.engine, { slug, sourceId });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fork: `submitPageMutation`'s one call. Attaches `async_enrichment` to the
 * response of an untrusted (remote) put_page/capture. A replay reports the
 * same key its original reported but never queues a second job.
 */
export async function withPostWriteEnrichment(
  ctx: { engine: BrainEngine; remote?: boolean },
  operation: string,
  row: { source_id: string; slug: string | null },
  response: Record<string, unknown>,
  replay: boolean,
): Promise<Record<string, unknown>> {
  if (ctx.remote === false || !isGatedOperation(operation) || response.error || !row.slug) return response;
  return { ...response, async_enrichment: await queuePostWriteEnrichment(ctx, row.source_id, row.slug, replay) };
}
