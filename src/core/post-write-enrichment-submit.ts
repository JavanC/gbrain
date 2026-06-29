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
