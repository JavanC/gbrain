/**
 * Engine-parity check for the write-policy gate on real Postgres.
 *
 * The gate's own SQL is small (a `sources.local_path` lookup + `getPage` +
 * the connection-resolvability slug scan), but "small" is exactly the shape
 * that has slipped past PGLite before — PGLite hides driver-level differences.
 * This pins the three claims that matter on the production engine:
 * rejection leaves no row, acceptance stores the server-managed frontmatter,
 * and a replace does not drop it.
 *
 * Gated on DATABASE_URL; skipped in the default local run.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresEngine } from '../../src/core/postgres-engine.ts';
import { assertSafeE2eDatabaseUrl } from '../helpers/db-guard.ts';
import { operations } from '../../src/core/operations.ts';
import type { Operation, OperationContext } from '../../src/core/operations.ts';
import {
  _resetWritePolicyCacheForTests,
  _resetWritePolicySlugCacheForTests,
} from '../../src/core/write-policy/index.ts';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl;

if (skip) test.skip('write-policy Postgres parity skipped (DATABASE_URL unset)', () => {});

const put_page = operations.find((o) => o.name === 'put_page') as Operation;
const validate_page = operations.find((o) => o.name === 'validate_page') as Operation;

const SOURCE = 'write-policy-pg-fixture';
const POLICY_YML = `
write_policy:
  version: 1
  enabled: true
  contract_version: "1"
  required_fields: [title, type, tags, created]
  non_empty_list_fields: [tags]
  server_managed:
    created:
      mode: set_on_create_preserve_on_update
      value: date
      timezone: Asia/Taipei
  type_path_rules:
    - prefix: concepts/
      types: [concept]
  connection_rules:
    id_style: slug_only
    slug_pattern: kebab
    require_resolvable: warn
  slug_rules:
    require_known_prefix: true
`;

const GOOD = '---\ntitle: PG Concept\ntype: concept\ntags:\n  - topic\n---\n\nBody.\n';
const BAD = '---\ntype: concept\n---\n\nBody.\n';

describe.skipIf(skip)('write policy on Postgres', () => {
  let engine: PostgresEngine;
  let repoDir: string;

  function ctx(): OperationContext {
    return {
      engine,
      config: { engine: 'postgres' } as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
      dryRun: false,
      remote: true,
      sourceId: SOURCE,
    } as OperationContext;
  }

  beforeAll(async () => {
    repoDir = mkdtempSync(join(tmpdir(), 'gbrain-write-policy-pg-'));
    writeFileSync(join(repoDir, 'gbrain.yml'), POLICY_YML);
    engine = new PostgresEngine();
    assertSafeE2eDatabaseUrl(databaseUrl!);
    await engine.connect({ database_url: databaseUrl! });
    await engine.initSchema();
    await engine.executeRaw('DELETE FROM pages WHERE source_id = $1', [SOURCE]);
    await engine.executeRaw('DELETE FROM sources WHERE id = $1', [SOURCE]);
    await engine.executeRaw(
      'INSERT INTO sources (id, name, local_path) VALUES ($1, $1, $2)',
      [SOURCE, repoDir],
    );
    _resetWritePolicyCacheForTests();
    _resetWritePolicySlugCacheForTests();
  });

  afterAll(async () => {
    if (engine) {
      await engine.executeRaw('DELETE FROM pages WHERE source_id = $1', [SOURCE]);
      await engine.executeRaw('DELETE FROM sources WHERE id = $1', [SOURCE]);
      await engine.disconnect();
    }
    rmSync(repoDir, { recursive: true, force: true });
    _resetWritePolicyCacheForTests();
    _resetWritePolicySlugCacheForTests();
  });

  test('the policy loads from the source repo through the Postgres sources row', async () => {
    const res = await validate_page.handler(ctx(), { slug: 'concepts/pg', content: BAD }) as Record<string, unknown>;
    expect(res.enforced).toBe(true);
    expect(res.valid).toBe(false);
  });

  test('a rejected write leaves no row', async () => {
    const res = await put_page.handler(ctx(), { slug: 'concepts/pg-ghost', content: BAD }) as Record<string, unknown>;
    expect(res.error).toBe('policy_violation');
    const rows = await engine.executeRaw<{ n: string }>(
      'SELECT COUNT(*) AS n FROM pages WHERE source_id = $1 AND slug = $2',
      [SOURCE, 'concepts/pg-ghost'],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  test('an accepted write stores server-managed frontmatter as real jsonb', async () => {
    const res = await put_page.handler(ctx(), { slug: 'concepts/pg-real', content: GOOD }) as Record<string, unknown>;
    expect(res.error).toBeUndefined();

    // Read the column through a jsonb operator, not through the app layer —
    // a double-encoded jsonb string scalar would fail this, not the app read.
    const rows = await engine.executeRaw<{ created: string | null }>(
      `SELECT frontmatter->>'created' AS created FROM pages WHERE source_id = $1 AND slug = $2`,
      [SOURCE, 'concepts/pg-real'],
    );
    expect(rows[0].created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('a full-content replace preserves the stored created date', async () => {
    await engine.executeRaw(
      `UPDATE pages SET frontmatter = jsonb_set(frontmatter, '{created}', '"2018-03-04"')
       WHERE source_id = $1 AND slug = $2`,
      [SOURCE, 'concepts/pg-real'],
    );
    const res = await put_page.handler(ctx(), {
      slug: 'concepts/pg-real',
      content: '---\ntitle: Rewritten\ntype: concept\ntags: [t]\n---\n\nNew body.\n',
    }) as Record<string, unknown>;
    expect(res.error).toBeUndefined();

    const rows = await engine.executeRaw<{ created: string | null; title: string }>(
      `SELECT frontmatter->>'created' AS created, title FROM pages WHERE source_id = $1 AND slug = $2`,
      [SOURCE, 'concepts/pg-real'],
    );
    expect(rows[0].title).toBe('Rewritten');
    expect(rows[0].created).toBe('2018-03-04');
  });
});
