import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { operations, type OperationContext } from '../src/core/operations.ts';
import { MinionQueue } from '../src/core/minions/queue.ts';
import { MinionWorker } from '../src/core/minions/worker.ts';
import { registerBuiltinHandlers } from '../src/commands/jobs.ts';
import { resetGateway } from '../src/core/ai/gateway.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let engine: PGLiteEngine;
// put_page throws storage_error for any un-written page, and since v0.48.x a
// source whose local_path does not exist resolves to `repo_not_found` rather
// than the by-design DB-only `no_repo_configured`. So the source needs a REAL
// directory on disk — same fix the Postgres sibling e2e already carries.
let alphaLocalPath: string;
const putPage = operations.find((op) => op.name === 'put_page')!;

function remoteCtx(): OperationContext {
  return {
    engine,
    config: { engine: 'pglite' },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    dryRun: false,
    remote: true,
    sourceId: 'alpha',
  };
}

beforeAll(async () => {
  alphaLocalPath = mkdtempSync(join(tmpdir(), 'gbrain-post-write-enrichment-'));
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
});

beforeEach(async () => {
  resetGateway();
  await engine.executeRaw('DELETE FROM minion_jobs');
  await engine.executeRaw("DELETE FROM pages WHERE slug LIKE 'concepts/async-enrich-%'");
  await engine.setConfig('auto_link', 'true');
  await engine.setConfig('auto_timeline', 'true');
  await engine.setConfig('writer.async_enrichment', 'true');
  await engine.executeRaw(
    `INSERT INTO sources (id, name, local_path)
     VALUES ('alpha', 'alpha', $1)
     ON CONFLICT (id) DO UPDATE SET local_path = EXCLUDED.local_path`,
    [alphaLocalPath],
  );
  await engine.putPage('concepts/async-enrich-target', {
    type: 'concept',
    title: 'Target',
    compiled_truth: 'Target body',
    timeline: '',
    frontmatter: {},
  }, { sourceId: 'alpha' });
});

afterAll(async () => {
  await engine.disconnect();
  resetGateway();
});

describe('remote put_page asynchronous enrichment', () => {
  test('queues a source-scoped job and the handler enriches the latest DB page', async () => {
    const result = await putPage.handler(remoteCtx(), {
      slug: 'concepts/async-enrich-source',
      content: [
        '---',
        'type: concept',
        'title: Source',
        '---',
        '',
        'References [Target](concepts/async-enrich-target).',
        '',
        '## Timeline',
        '- **2026-06-29** | Async enrichment shipped.',
      ].join('\n'),
    }) as {
      auto_links: { skipped: string };
      auto_timeline: { skipped: string };
      async_enrichment: { queued: boolean; job_id: number };
    };

    // toMatchObject, not toEqual: upstream ships an explanatory `hint`
    // alongside `skipped` and may add more. What this test asserts is that a
    // remote write does NOT reconcile inline — not the payload's exact shape.
    expect(result.auto_links).toMatchObject({ skipped: 'remote' });
    expect(result.auto_timeline).toMatchObject({ skipped: 'remote' });
    expect(result.async_enrichment.queued).toBe(true);

    const queue = new MinionQueue(engine);
    const queued = await queue.getJob(result.async_enrichment.job_id);
    expect(queued).toMatchObject({
      name: 'post-write-enrichment',
      status: 'waiting',
      data: { slug: 'concepts/async-enrich-source', sourceId: 'alpha' },
    });

    const worker = new MinionWorker(engine, { queue: 'test' });
    await registerBuiltinHandlers(worker, engine, { quiet: true });
    const handler = (worker as unknown as {
      handlers: Map<string, (job: unknown) => Promise<unknown>>;
    }).handlers.get('post-write-enrichment');
    expect(handler).toBeDefined();

    const enriched = await handler!({
      data: queued!.data,
      signal: new AbortController().signal,
      job: queued,
      updateProgress: async () => {},
    }) as {
      auto_links: { created: number };
      auto_timeline: { created: number };
    };

    expect(enriched.auto_links.created).toBeGreaterThanOrEqual(0);
    expect(enriched.auto_timeline.created).toBe(1);
    expect((await engine.getLinks('concepts/async-enrich-source', { sourceId: 'alpha' }))
      .map((link) => link.to_slug)).toContain('concepts/async-enrich-target');
    expect((await engine.getTimeline('concepts/async-enrich-source', { sourceId: 'alpha' }))
      .map((entry) => entry.summary)).toContain('Async enrichment shipped.');
  });

  test('feature gate leaves remote writes safe when no worker is configured', async () => {
    await engine.setConfig('writer.async_enrichment', 'false');
    const result = await putPage.handler(remoteCtx(), {
      slug: 'concepts/async-enrich-disabled',
      content: '---\ntype: concept\ntitle: Disabled\n---\n\nNo queue.',
    }) as { async_enrichment: { skipped: string } };

    expect(result.async_enrichment).toEqual({ skipped: 'disabled' });
    expect((await new MinionQueue(engine).getJobs({
      name: 'post-write-enrichment',
    }))).toHaveLength(0);
  });
});
