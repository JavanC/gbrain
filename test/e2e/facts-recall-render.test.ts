/**
 * v0.31 E2E — `gbrain recall --today` markdown render against real Postgres.
 * Mostly a parity check: same shape as the PGLite test, on PG.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, unlinkSync } from 'fs';
import { setupDB, teardownDB, hasDatabase, getEngine } from './helpers.ts';
import { renderToday } from '../../src/commands/recall.ts';
import { configPath } from '../../src/core/config.ts';

const RUN = hasDatabase();
const d = RUN ? describe : describe.skip;

beforeAll(async () => {
  if (!RUN) return;
  // run-e2e.sh shares one isolated HOME across files; earlier E2Es may write
  // a thin-client config there. This test exercises the local engine passed
  // to runRecall(), so clear the isolated file-plane config explicitly.
  const path = configPath();
  if (existsSync(path)) unlinkSync(path);
  await setupDB();
});
afterAll(async () => { if (RUN) await teardownDB(); });

d('gbrain recall --today (Postgres)', () => {
  test('renders markdown with kind icons', async () => {
    if (!RUN) return;
    const engine = getEngine();
    await engine.insertFact(
      { fact: 'render-event', kind: 'event', entity_slug: 'render-pg-e', source: 'test' },
      { source_id: 'default' },
    );
    await engine.insertFact(
      { fact: 'render-pref', kind: 'preference', entity_slug: 'render-pg-p', source: 'test' },
      { source_id: 'default' },
    );

    const rows = await engine.listFactsSince('default', new Date(0), { limit: 10 });
    const captured = renderToday(rows);

    expect(captured).toContain('Hot memory — ');
    expect(captured).toContain('📅');  // event icon
    expect(captured).toContain('🎯');  // preference icon
  });
});
