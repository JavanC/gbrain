// Fork: the `post-write-enrichment` Minion job body.
//
// Upstream skips inline link/timeline extraction for remote writers and leaves
// the catch-up to the serve-resident maintenance sweep — which a
// `gbrain serve --http` deployment never runs on its own. The fork queues one
// job per remote put_page/capture (post-write-enrichment-submit.ts) and the
// job runs upstream's OWN link/timeline pass (sweep.ts:runLinksTimelinePass):
// the same extractor, endpoint resolution, managed-brain timeline publication,
// stale-edge reconciliation and watermark stamping the sweep uses. The pass
// selects the source's newest stale pages, so the page just written is picked
// up and any earlier miss is caught on the next job. Only the link/timeline
// pass runs — never the LLM-backed corpus ingest.
import type { BrainEngine } from './engine.ts';
import type { MinionHandler } from './minions/types.ts';
import type { SweepReport, SweepSkip } from './sweep.ts';

/** Stale pages one job may reconcile (the sweep's own default). */
export const POST_WRITE_ENRICHMENT_BATCH_LIMIT = 20;
/** Wall-clock budget per job; the pass stops between pages when exceeded. */
export const POST_WRITE_ENRICHMENT_BUDGET_MS = 60_000;
/** Recency window, matching the sweep default. */
export const POST_WRITE_ENRICHMENT_RECENT_DAYS = 7;

export interface PostWriteEnrichmentResult {
  slug: string;
  source_id: string;
  links_extracted: number;
  links_removed: number;
  timeline_extracted: number;
  skipped: SweepSkip[];
}

export async function runPostWriteEnrichment(
  engine: BrainEngine,
  input: { slug: string; sourceId: string },
): Promise<PostWriteEnrichmentResult> {
  const { runLinksTimelinePass } = await import('./sweep.ts');
  const started = Date.now();
  const deadline = started + POST_WRITE_ENRICHMENT_BUDGET_MS;
  const report: SweepReport = {
    corpusIngested: 0, factsReconciled: 0, linksExtracted: 0, linksRemoved: 0, timelineExtracted: 0,
    corpus_files: [], skipped: [], durationMs: 0,
  };
  const skip = (reason: string, count = 1): void => {
    if (count <= 0) return;
    const existing = report.skipped.find(s => s.reason === reason);
    if (existing) existing.count += count;
    else report.skipped.push({ reason, count });
  };
  await runLinksTimelinePass(engine, {
    sourceId: input.sourceId,
    batchLimit: POST_WRITE_ENRICHMENT_BATCH_LIMIT,
    cutoffIso: new Date(started - POST_WRITE_ENRICHMENT_RECENT_DAYS * 86_400_000).toISOString(),
    overBudget: () => Date.now() >= deadline,
    // Upstream v0.60.360: the pass also takes the remaining budget as a 0..1
    // fraction (the sweep's own shape) and a log sink for per-page refusals.
    budgetLeft: () => Math.max(0, deadline - Date.now()) / POST_WRITE_ENRICHMENT_BUDGET_MS,
    report,
    skip,
    log: (msg: string) => console.error(msg),
  });
  return {
    slug: input.slug,
    source_id: input.sourceId,
    links_extracted: report.linksExtracted,
    links_removed: report.linksRemoved,
    timeline_extracted: report.timelineExtracted,
    skipped: report.skipped,
  };
}

/** Registered by `registerBuiltinHandlers` (src/commands/jobs.ts). */
export function makePostWriteEnrichmentHandler(engine: BrainEngine): MinionHandler {
  return async (job) => {
    const slug = typeof job.data.slug === 'string' ? job.data.slug : '';
    const sourceId = typeof job.data.sourceId === 'string' ? job.data.sourceId : '';
    if (!slug || !sourceId) {
      throw new Error('post-write-enrichment requires data.slug and data.sourceId');
    }
    return runPostWriteEnrichment(engine, { slug, sourceId });
  };
}
