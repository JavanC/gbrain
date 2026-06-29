import type { BrainEngine } from './engine.ts';
import type { PageType } from './types.ts';
import {
  isAutoLinkEnabled,
  isAutoTimelineEnabled,
  parseTimelineEntries,
} from './link-extraction.ts';
import { runAutoLink } from './operations.ts';

export interface PostWriteEnrichmentResult {
  slug: string;
  source_id: string;
  auto_links?: {
    created: number;
    removed: number;
    errors: number;
    unresolved: unknown[];
  };
  auto_timeline?: { created: number };
  skipped?: 'page_not_found' | 'disabled';
}

export async function runPostWriteEnrichment(
  engine: BrainEngine,
  input: { slug: string; sourceId: string },
): Promise<PostWriteEnrichmentResult> {
  const base = { slug: input.slug, source_id: input.sourceId };
  const [linksEnabled, timelineEnabled] = await Promise.all([
    isAutoLinkEnabled(engine),
    isAutoTimelineEnabled(engine),
  ]);
  if (!linksEnabled && !timelineEnabled) {
    return { ...base, skipped: 'disabled' };
  }

  const page = await engine.getPage(input.slug, { sourceId: input.sourceId });
  if (!page) {
    return { ...base, skipped: 'page_not_found' };
  }

  const parsed = {
    type: page.type as PageType,
    compiled_truth: page.compiled_truth,
    timeline: page.timeline ?? '',
    frontmatter: page.frontmatter ?? {},
  };
  const result: PostWriteEnrichmentResult = base;

  if (linksEnabled) {
    result.auto_links = await runAutoLink(engine, input.slug, parsed, {
      sourceId: input.sourceId,
    });
  }
  if (timelineEnabled) {
    const entries = parseTimelineEntries(`${parsed.compiled_truth}\n${parsed.timeline}`);
    const batch = entries.map((entry) => ({
      slug: input.slug,
      date: entry.date,
      summary: entry.summary,
      detail: entry.detail || '',
      source_id: input.sourceId,
    }));
    result.auto_timeline = {
      created: batch.length > 0
        ? await engine.addTimelineEntriesBatch(batch, {
            auditSite: 'mcp.put_page.autolink',
          })
        : 0,
    };
  }
  return result;
}
