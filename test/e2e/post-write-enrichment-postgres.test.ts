import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasDatabase, setupDB, teardownDB, getEngine } from './helpers.ts';
import { operations, type OperationContext } from '../../src/core/operations.ts';
import { MinionQueue } from '../../src/core/minions/queue.ts';
import { MinionWorker } from '../../src/core/minions/worker.ts';
import { registerBuiltinHandlers } from '../../src/commands/jobs.ts';
import { resetGateway } from '../../src/core/ai/gateway.ts';

const describeE2E = hasDatabase() ? describe : describe.skip;
const putPage = operations.find((op) => op.name === 'put_page')!;

describeE2E('post-write enrichment queue on Postgres', () => {
  beforeAll(async () => {
    await setupDB();
    resetGateway();
  });

  afterAll(async () => {
    resetGateway();
    await teardownDB();
  });

  test('remote put_page queues and a persistent-worker handler enriches links and timeline', async () => {
    const engine = getEngine();
    await engine.setConfig('auto_link', 'true');
    await engine.setConfig('auto_timeline', 'true');
    await engine.setConfig('writer.async_enrichment', 'true');
    // put_page throws storage_error on any un-written page including
    // repo_not_found, so the source needs a REAL directory on disk.
    const alphaLocalPath = mkdtempSync(join(tmpdir(), 'gbrain-post-write-enrichment-pg-'));
    await engine.executeRaw(
      `INSERT INTO sources (id, name, local_path)
       VALUES ('alpha', 'alpha', $1)
       ON CONFLICT (id) DO UPDATE SET local_path = EXCLUDED.local_path`,
      [alphaLocalPath],
    );
    await engine.putPage('concepts/async-pg-target', {
      type: 'concept',
      title: 'Target',
      compiled_truth: 'Target body',
      timeline: '',
      frontmatter: {},
    }, { sourceId: 'alpha' });

    const ctx: OperationContext = {
      engine,
      config: { engine: 'postgres' },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      dryRun: false,
      remote: true,
      sourceId: 'alpha',
    };
    const result = await putPage.handler(ctx, {
      slug: 'concepts/async-pg-source',
      content: [
        '---',
        'type: concept',
        'title: Source',
        '---',
        '',
        'References [Target](concepts/async-pg-target).',
        '',
        '## Timeline',
        '- **2026-06-29** | Postgres async enrichment shipped.',
      ].join('\n'),
    }) as { async_enrichment: { queued: boolean; job_id: number } };
    expect(result.async_enrichment.queued).toBe(true);

    const queue = new MinionQueue(engine);
    const queued = await queue.getJob(result.async_enrichment.job_id);
    const worker = new MinionWorker(engine, { queue: 'test' });
    await registerBuiltinHandlers(worker, engine, { quiet: true });
    const handler = (worker as unknown as {
      handlers: Map<string, (job: unknown) => Promise<unknown>>;
    }).handlers.get('post-write-enrichment')!;
    await handler({
      data: queued!.data,
      signal: new AbortController().signal,
      job: queued,
      updateProgress: async () => {},
    });

    expect((await engine.getLinks('concepts/async-pg-source', { sourceId: 'alpha' }))
      .map((link) => link.to_slug)).toContain('concepts/async-pg-target');
    expect((await engine.getTimeline('concepts/async-pg-source', { sourceId: 'alpha' }))
      .map((entry) => entry.summary)).toContain('Postgres async enrichment shipped.');
  }, 30_000);
});
