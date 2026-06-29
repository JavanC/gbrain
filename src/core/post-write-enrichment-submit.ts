import type { BrainEngine } from './engine.ts';
import { MinionQueue } from './minions/queue.ts';

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
 * Upstream v0.51.0.0 funnelled every page mutation through
 * `persistence/page-mutations.ts`, so the enabled-check + fail-open wrapper
 * that used to sit inline in the put_page handler lives here instead — one
 * fork-owned function the funnel calls, rather than a block inside a file
 * upstream rewrites often.
 *
 * Never throws: the page is already durably written when this runs, so an
 * enrichment failure is reported, not raised.
 */
export async function queuePostWriteEnrichment(
  ctx: { engine: BrainEngine },
  sourceId: string,
  slug: string,
): Promise<
  | { queued: true; job_id: number }
  | { skipped: 'disabled' }
  | { error: string }
> {
  try {
    if (!(await isAsyncPostWriteEnrichmentEnabled(ctx.engine))) return { skipped: 'disabled' };
    return await submitPostWriteEnrichment(ctx.engine, { slug, sourceId });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
