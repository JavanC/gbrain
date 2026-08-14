/**
 * Source write policy end-to-end against a real engine.
 *
 * The unit tests prove the gate's verdicts; this file proves the CONSEQUENCES:
 *   - a rejected write leaves no page row behind
 *   - an accepted write lands the server-managed frontmatter in the database
 *   - a full-content replace can no longer drop `created`
 *   - a source without a policy is untouched by any of it
 *
 * The policy is read from a real gbrain.yml in a real directory registered as
 * the source's `local_path`, so the disk → DB → op wiring is covered too.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGLiteEngine } from '../../src/core/pglite-engine.ts';
import { resetPgliteState } from '../helpers/reset-pglite.ts';
import { operations } from '../../src/core/operations.ts';
import type { Operation, OperationContext } from '../../src/core/operations.ts';
import {
  _resetWritePolicyCacheForTests,
  _resetWritePolicySlugCacheForTests,
} from '../../src/core/write-policy/index.ts';

const put_page = operations.find((o) => o.name === 'put_page') as Operation;
const get_write_contract = operations.find((o) => o.name === 'get_write_contract') as Operation;

const POLICED = 'policed-brain';
const UNPOLICED = 'plain-brain';

const POLICY_YML = `
storage:
  db_tracked:
    - concepts/

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
      types: [concept, pattern]
    - prefix: inbox/
      types: any
  connection_rules:
    id_style: slug_only
    slug_pattern: kebab
    require_resolvable: warn
  slug_rules:
    require_known_prefix: true
`;

const GOOD = '---\ntitle: A Concept\ntype: concept\ntags:\n  - topic\n---\n\nCompiled truth body.\n';
const MISSING_FIELDS = '---\ntype: concept\n---\n\nBody.\n';
const WRONG_TYPE = '---\ntitle: A\ntype: person\ntags: [t]\n---\n\nBody.\n';

let engine: PGLiteEngine;
let repoDir: string;

function ctx(sourceId: string, overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    engine,
    config: { engine: 'pglite' } as never,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    dryRun: false,
    remote: true,
    sourceId,
    ...overrides,
  } as OperationContext;
}

beforeAll(async () => {
  engine = new PGLiteEngine();
  await engine.connect({});
  await engine.initSchema();
  repoDir = mkdtempSync(join(tmpdir(), 'gbrain-write-policy-'));
  writeFileSync(join(repoDir, 'gbrain.yml'), POLICY_YML);
});

afterAll(async () => {
  await engine.disconnect();
  rmSync(repoDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetPgliteState(engine);
  _resetWritePolicyCacheForTests();
  _resetWritePolicySlugCacheForTests();
  await engine.executeRaw(
    `INSERT INTO sources (id, name, local_path) VALUES ($1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET local_path = EXCLUDED.local_path`,
    [POLICED, repoDir],
  );
  await engine.executeRaw(
    `INSERT INTO sources (id, name, local_path) VALUES ($1, $1, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [UNPOLICED],
  );
});

afterEach(() => {
  _resetWritePolicyCacheForTests();
  _resetWritePolicySlugCacheForTests();
});

describe('write policy end-to-end (PGLite)', () => {
  test('the contract is discoverable from the source repo on disk', async () => {
    const contract = await get_write_contract.handler(ctx(POLICED), {}) as Record<string, unknown>;
    expect(contract).toMatchObject({ enforced: true, source_id: POLICED, contract_version: '1' });
    expect(contract.required_agent_fields).toEqual(['title', 'type', 'tags', 'created']);
  });

  test('a rejected write leaves NO page row behind', async () => {
    const res = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/ghost', content: MISSING_FIELDS,
    }) as Record<string, unknown>;

    expect(res.error).toBe('policy_violation');
    expect(res.written).toBe(false);
    expect(await engine.getPage('concepts/ghost', { sourceId: POLICED })).toBeNull();
    const rows = await engine.executeRaw<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pages WHERE source_id = $1`, [POLICED],
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  test('a wrong-directory type is rejected with the allowed list', async () => {
    const res = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/mistyped', content: WRONG_TYPE,
    }) as Record<string, unknown>;
    const violations = res.violations as Array<{ code: string; fix?: string }>;
    expect(violations.map((v) => v.code)).toContain('type_not_allowed_in_path');
    expect(violations.find((v) => v.code === 'type_not_allowed_in_path')!.fix).toContain('concept');
    expect(await engine.getPage('concepts/mistyped', { sourceId: POLICED })).toBeNull();
  });

  test('an accepted write lands server-managed frontmatter in the database', async () => {
    const res = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/real', content: GOOD,
    }) as Record<string, unknown>;

    expect(res.error).toBeUndefined();
    expect(res.policy).toMatchObject({ contract_version: '1', normalized: true });

    const page = await engine.getPage('concepts/real', { sourceId: POLICED });
    expect(page).not.toBeNull();
    expect(page!.title).toBe('A Concept');
    expect(page!.type).toBe('concept');
    // Server-filled, in the policy's timezone.
    expect(String(page!.frontmatter.created)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const tpeToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(String(page!.frontmatter.created)).toBe(tpeToday);
  });

  test('a full-content replace that omits `created` no longer drops it', async () => {
    await put_page.handler(ctx(POLICED), { slug: 'concepts/keeper', content: GOOD });
    await engine.executeRaw(
      `UPDATE pages SET frontmatter = '{"created":"2019-01-02"}'::jsonb WHERE slug = $1 AND source_id = $2`,
      ['concepts/keeper', POLICED],
    );

    const res = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/keeper',
      content: '---\ntitle: Rewritten\ntype: concept\ntags: [t]\n---\n\nNew body.\n',
    }) as Record<string, unknown>;

    expect(res.error).toBeUndefined();
    const page = await engine.getPage('concepts/keeper', { sourceId: POLICED });
    expect(page!.title).toBe('Rewritten');
    expect(page!.frontmatter.created).toBe('2019-01-02');
  });

  test('a source without a policy accepts what it always accepted', async () => {
    const res = await put_page.handler(ctx(UNPOLICED), {
      slug: 'whatever/loose', content: '---\ntitle: Loose\n---\n\nNo type, no tags.\n',
    }) as Record<string, unknown>;

    expect(res.error).toBeUndefined();
    expect(res.policy).toBeUndefined();
    expect(await engine.getPage('whatever/loose', { sourceId: UNPOLICED })).not.toBeNull();
  });

  test('policy enforcement does not leak across sources', async () => {
    // The very payload the policed source refuses is fine in the unpoliced one.
    const refused = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/x', content: MISSING_FIELDS,
    }) as Record<string, unknown>;
    const accepted = await put_page.handler(ctx(UNPOLICED), {
      slug: 'concepts/x', content: MISSING_FIELDS,
    }) as Record<string, unknown>;

    expect(refused.error).toBe('policy_violation');
    expect(accepted.error).toBeUndefined();
    expect(await engine.getPage('concepts/x', { sourceId: POLICED })).toBeNull();
    expect(await engine.getPage('concepts/x', { sourceId: UNPOLICED })).not.toBeNull();
  });

  test('a dangling connection warns but still writes (resolvability is the repo lint\'s call)', async () => {
    const content = '---\ntitle: A\ntype: concept\ntags: [t]\nconnections:\n  - id: not-yet-written\n---\n\nBody.\n';
    const res = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/forward-ref', content,
    }) as Record<string, unknown>;

    expect(res.error).toBeUndefined();
    const warnings = (res.policy as { warnings: Array<{ code: string }> }).warnings;
    expect(warnings.map((w) => w.code)).toContain('connection_unresolved');
    expect(await engine.getPage('concepts/forward-ref', { sourceId: POLICED })).not.toBeNull();
  });

  test('editing gbrain.yml takes effect on the next write, without a restart', async () => {
    const first = await put_page.handler(ctx(POLICED), {
      slug: 'concepts/toggle', content: WRONG_TYPE,
    }) as Record<string, unknown>;
    expect(first.error).toBe('policy_violation');

    writeFileSync(join(repoDir, 'gbrain.yml'), POLICY_YML.replace('types: [concept, pattern]', 'types: any'));
    try {
      const second = await put_page.handler(ctx(POLICED), {
        slug: 'concepts/toggle', content: WRONG_TYPE,
      }) as Record<string, unknown>;
      expect(second.error).toBeUndefined();
    } finally {
      writeFileSync(join(repoDir, 'gbrain.yml'), POLICY_YML);
      _resetWritePolicyCacheForTests();
    }
  });
});
