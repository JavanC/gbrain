/**
 * Op-layer contract for the source write policy:
 *   get_write_contract → discoverability (and its source-scope refusal)
 *   validate_page      → preflight, writes nothing
 *   put_page           → the gate: a violation writes NOTHING
 *
 * The "writes nothing" claim is proven structurally: the engine handed to
 * put_page throws on every method except the two the gate itself needs, so any
 * write path reaching the engine fails the test rather than passing silently.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { registerLocalWriter } from '../src/core/persistence/identity.ts';
import { submitPageMutation } from '../src/core/persistence/page-mutations.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __setFunnelPathForTests, enableFunnel } from '../src/core/funnel.ts';
import { operations } from '../src/core/operations.ts';
import type { Operation, OperationContext } from '../src/core/operations.ts';
import type { BrainEngine } from '../src/core/engine.ts';
import type { Page } from '../src/core/types.ts';
import {
  __setWritePolicyOverrideForTests,
  _resetWritePolicyCacheForTests,
  _resetWritePolicySlugCacheForTests,
  parseWritePolicy,
} from '../src/core/write-policy/index.ts';

const put_page = operations.find((o) => o.name === 'put_page') as Operation;
const validate_page = operations.find((o) => o.name === 'validate_page') as Operation;
const get_write_contract = operations.find((o) => o.name === 'get_write_contract') as Operation;
const put_pages = operations.find((o) => o.name === 'put_pages') as Operation;

const POLICY = parseWritePolicy({
  contract_version: '4',
  required_fields: ['title', 'type', 'tags', 'created'],
  non_empty_list_fields: ['tags'],
  server_managed: {
    created: { mode: 'set_on_create_preserve_on_update', value: 'date', timezone: 'Asia/Taipei' },
  },
  type_path_rules: [
    { prefix: 'concepts/', types: ['concept', 'pattern'] },
    { prefix: 'inbox/', types: 'any' },
  ],
  connection_rules: { id_style: 'slug_only', slug_pattern: 'kebab', require_resolvable: 'off' },
  slug_rules: { require_known_prefix: true },
  template_markdown: '---\ntitle: T\n---\n',
}, 'test')!;

const GOOD = '---\ntitle: A Concept\ntype: concept\ntags:\n  - topic\n---\n\nBody.\n';
const BAD = '---\ntype: person\ntags: []\n---\n\nBody.\n';

/**
 * Engine that permits only what the policy gate legitimately reads. Any write
 * path (putPage, upsertChunks, …) explodes — that is the assertion.
 */
function guardedEngine(existing: Partial<Page> | null = null): BrainEngine {
  const allowed: Record<string, unknown> = {
    getPage: async () => (existing ? ({ frontmatter: {}, ...existing } as Page) : null),
    executeRaw: async () => [],
  };
  return new Proxy({} as BrainEngine, {
    get(_t, prop: string) {
      if (prop in allowed) return allowed[prop];
      return () => { throw new Error(`engine.${prop} must not be called on a rejected write`); };
    },
  });
}

function ctx(overrides: Partial<OperationContext> = {}): OperationContext {
  return {
    engine: guardedEngine(),
    config: { engine: 'postgres' } as never,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as never,
    dryRun: false,
    remote: true,
    sourceId: 'brain-a',
    ...overrides,
  } as OperationContext;
}

// --- real-engine fixture for the write path -------------------------------
//
// Upstream v0.51 routes every page mutation through submitPageMutation, which
// bootstraps persistence metadata (brain identity, local writer, request
// identity) BEFORE any operation-specific logic — the write-policy gate
// included. The guarded proxy above therefore cannot serve the REAL write
// path any more; it only serves reads and dry-run previews.
//
// The write-path tests get a real PGLite engine instead, and prove the
// "writes nothing" claim by its OUTCOME (no page row afterwards) rather than
// by the absence of engine method calls. That is the stronger assertion: the
// old proxy proved a call sequence, and a call sequence is exactly what
// upstream is free to change underneath the fork.
let realEngine: PGLiteEngine;
const WRITE_SOURCE = 'brain-a';

beforeAll(async () => {
  realEngine = new PGLiteEngine();
  await realEngine.connect({});
  await realEngine.initSchema();
  await registerLocalWriter(realEngine, 'cli');
  await realEngine.executeRaw(
    `INSERT INTO sources (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [WRITE_SOURCE, 'Policed brain'],
  );
}, 120_000);

afterAll(async () => { await realEngine?.disconnect(); });

/** A context whose writes actually reach upstream's mutation funnel. */
function writeCtx(overrides: Partial<OperationContext> = {}): OperationContext {
  return ctx({ engine: realEngine as unknown as BrainEngine, sourceId: WRITE_SOURCE, ...overrides });
}

/** The gate's core promise: a rejected write leaves no page behind. */
async function expectNoPage(slug: string): Promise<void> {
  const rows = await realEngine.executeRaw<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM pages WHERE source_id = $1 AND slug = $2', [WRITE_SOURCE, slug]);
  expect(rows[0]?.n ?? 0).toBe(0);
}

function withPolicy(policyFor: Record<string, 'active' | 'error' | 'none'>) {
  __setWritePolicyOverrideForTests((sourceId) => {
    const kind = policyFor[sourceId];
    if (kind === 'active') return { status: 'active', policy: POLICY, path: '/tmp/gbrain.yml' };
    if (kind === 'error') return { status: 'error', error: 'write_policy.version: 9', path: '/tmp/gbrain.yml' };
    if (kind === 'none') return { status: 'inactive', reason: 'no_write_policy_block' };
    return undefined;
  });
}

afterEach(() => {
  __setWritePolicyOverrideForTests(null);
  _resetWritePolicyCacheForTests();
  _resetWritePolicySlugCacheForTests();
});

describe('get_write_contract', () => {
  test('returns the enforced contract for a source that declares one', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await get_write_contract.handler(ctx(), {}) as Record<string, unknown>;
    expect(res).toMatchObject({
      enforced: true,
      source_id: 'brain-a',
      contract_version: '4',
      required_agent_fields: ['title', 'type', 'tags', 'created'],
    });
    expect(res.server_managed).toMatchObject({ created: expect.stringContaining('Asia/Taipei') });
    expect(res.template_markdown).toBeTruthy();
    expect((res.usage as string[]).join(' ')).toContain('validate_page');
  });

  test('a source with no policy reports enforced: false with a reason', async () => {
    withPolicy({ 'brain-a': 'none' });
    const res = await get_write_contract.handler(ctx(), {});
    expect(res).toMatchObject({ enforced: false, reason: 'no_write_policy_block', contract_version: null });
  });

  test('a broken policy is reported as policy_error, not as "no rules"', async () => {
    withPolicy({ 'brain-a': 'error' });
    const res = await get_write_contract.handler(ctx(), {}) as Record<string, unknown>;
    expect(res).toMatchObject({ enforced: false, reason: 'policy_error' });
    expect(res.error).toContain('version');
  });

  test('the contract mirrors the policy — every rule the gate enforces is disclosed', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await get_write_contract.handler(ctx(), {}) as Record<string, unknown>;
    expect(res.type_path_rules).toEqual(POLICY.type_path_rules.map((r) => ({ prefix: r.prefix, types: r.types })));
    expect(res.connection_rules).toEqual(POLICY.connection_rules);
    expect(res.slug_rules).toEqual(POLICY.slug_rules);
  });

  describe('source scoping', () => {
    test('a remote caller cannot ask about a source outside its grant', async () => {
      withPolicy({ 'brain-a': 'active', 'brain-b': 'active' });
      const res = await get_write_contract.handler(ctx(), { source_id: 'brain-b' });
      expect(res).toMatchObject({ error: 'source_not_permitted' });
    });

    test('a federated caller may ask about any source in its grant', async () => {
      withPolicy({ 'brain-b': 'active' });
      const c = ctx({ sourceId: undefined, auth: { allowedSources: ['brain-b', 'brain-c'] } as never });
      const res = await get_write_contract.handler(c, { source_id: 'brain-b' });
      expect(res).toMatchObject({ enforced: true, source_id: 'brain-b' });
    });

    test('a federated caller is still refused a source outside the grant', async () => {
      withPolicy({ 'brain-z': 'active' });
      const c = ctx({ sourceId: undefined, auth: { allowedSources: ['brain-b'] } as never });
      const res = await get_write_contract.handler(c, { source_id: 'brain-z' });
      expect(res).toMatchObject({ error: 'source_not_permitted' });
    });

    test('a trusted local caller may inspect any source', async () => {
      withPolicy({ 'brain-b': 'active' });
      const res = await get_write_contract.handler(ctx({ remote: false }), { source_id: 'brain-b' });
      expect(res).toMatchObject({ enforced: true, source_id: 'brain-b' });
    });
  });
});

describe('validate_page', () => {
  test('reports violations without writing', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await validate_page.handler(ctx(), { slug: 'concepts/x', content: BAD }) as Record<string, unknown>;
    expect(res.valid).toBe(false);
    const violations = res.violations as Array<{ code: string; field?: string }>;
    expect(violations.map((v) => v.code)).toContain('missing_required_field');
    expect(violations.map((v) => v.code)).toContain('type_not_allowed_in_path');
  });

  test('a conforming page passes and shows the normalization the server would apply', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await validate_page.handler(ctx(), { slug: 'concepts/x', content: GOOD }) as Record<string, unknown>;
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe(true);
    expect((res.normalized_frontmatter as Record<string, unknown>).created).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('an unpoliced source validates as unenforced rather than failing', async () => {
    withPolicy({ 'brain-a': 'none' });
    const res = await validate_page.handler(ctx(), { slug: 'anything', content: 'no frontmatter' });
    expect(res).toMatchObject({ valid: true, enforced: false, reason: 'no_write_policy_block' });
  });

  test('preflight and gate agree — the same payload, the same verdict', async () => {
    withPolicy({ 'brain-a': 'active' });
    const pre = await validate_page.handler(ctx(), { slug: 'concepts/x', content: BAD }) as Record<string, unknown>;
    const write = await put_page.handler(writeCtx(), { slug: 'concepts/x', content: BAD }) as Record<string, unknown>;
    expect(pre.valid).toBe(false);
    expect(write.error).toBe('policy_violation');
    expect(write.violations).toEqual(pre.violations);
  });
});

describe('put_page gate', () => {
  test('a refused write is not recorded as a funnel save', async () => {
    // The gate resolves a refusal as a response instead of throwing, so the
    // funnel's pass-through would otherwise count a blocked write as a commit.
    withPolicy({ 'brain-a': 'active' });
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-wp-funnel-'));
    const path = join(dir, 'funnel.jsonl');
    try {
      __setFunnelPathForTests(path);
      enableFunnel();
      const res = await put_page.handler(writeCtx(), { slug: 'concepts/x', content: BAD }) as Record<string, unknown>;
      expect(res.error).toBe('policy_violation');
      const events = readFileSync(path, 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { event: string }).event);
      expect(events).toEqual(['enabled']);
    } finally {
      __setFunnelPathForTests(null);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a violation returns machine-readable errors and writes nothing', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await put_page.handler(writeCtx(), { slug: 'concepts/x', content: BAD }) as Record<string, unknown>;
    expect(res).toMatchObject({
      error: 'policy_violation',
      written: false,
      slug: 'concepts/x',
      source_id: 'brain-a',
      contract_version: '4',
    });
    expect(res.suggestion).toContain('get_write_contract');
    // The claim in this test's name, proven by outcome.
    await expectNoPage('concepts/x');
  });

  test('a slug outside the source\'s directories is refused', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await put_page.handler(writeCtx(), { slug: 'scratch/x', content: GOOD }) as Record<string, unknown>;
    expect(res.error).toBe('policy_violation');
    expect((res.violations as Array<{ code: string }>).map((v) => v.code)).toContain('slug_outside_known_prefix');
  });

  test('a path-qualified connection id is refused', async () => {
    withPolicy({ 'brain-a': 'active' });
    const content = '---\ntitle: A\ntype: concept\ntags: [t]\nconnections:\n  - id: concepts/other\n---\n\nBody.\n';
    const res = await put_page.handler(writeCtx(), { slug: 'concepts/x', content }) as Record<string, unknown>;
    expect((res.violations as Array<{ code: string }>).map((v) => v.code)).toContain('connection_id_not_slug_only');
  });

  test('an unloadable policy fails CLOSED — no write, and the reason is explicit', async () => {
    withPolicy({ 'brain-a': 'error' });
    const res = await put_page.handler(writeCtx(), { slug: 'concepts/x', content: GOOD }) as Record<string, unknown>;
    expect(res).toMatchObject({ error: 'write_policy_unavailable', written: false });
    // Filesystem paths are local-only detail.
    expect(res.policy_path).toBeUndefined();
    const local = await put_page.handler(writeCtx({ remote: false }), { slug: 'concepts/x', content: GOOD }) as Record<string, unknown>;
    expect(local.policy_path).toBe('/tmp/gbrain.yml');
  });

  test('a conforming page passes the gate and reports the contract it satisfied', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await put_page.handler(ctx({ dryRun: true }), { slug: 'concepts/x', content: GOOD }) as Record<string, unknown>;
    expect(res.dry_run).toBe(true);
    expect(res.policy).toMatchObject({ contract_version: '4', normalized: true });
  });

  test('a dry run surfaces the same rejection a real write would', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await put_page.handler(ctx({ dryRun: true }), { slug: 'concepts/x', content: BAD }) as Record<string, unknown>;
    expect(res.error).toBe('policy_violation');
    expect(res.dry_run).toBeUndefined();
  });

  // Upstream v0.60 added put_pages, which prepares each member through the same
  // preparePageAdmission funnel. Without the gate there, a remote agent could
  // sidestep the contract by batching.
  test('each put_pages member is gated the same way — a refused page writes nothing', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await put_pages.handler(writeCtx(), {
      request_id: randomUUID(),
      pages: [{ slug: 'concepts/batch-bad', content: BAD }],
    });
    expect(JSON.stringify(res)).toContain('policy_violation');
    await expectNoPage('concepts/batch-bad');
  });

  // Upstream v0.60 also routes sync imports and internal repairs through
  // put_page. Those submit without the op-level opt-in and must not be judged:
  // the repo's own files are governed by its lint, not by the gate.
  test('an internal put_page submission (no op-level opt-in) is not judged', async () => {
    withPolicy({ 'brain-a': 'active' });
    const res = await submitPageMutation(writeCtx({ remote: false }), {
      operation: 'put_page', params: { slug: 'concepts/internal-rewrite', content: BAD },
    });
    expect(res.error).not.toBe('policy_violation');
    expect(res.violations).toBeUndefined();
    // And it actually landed — the gate did not silently swallow it either.
    const rows = await realEngine.executeRaw<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM pages WHERE source_id = $1 AND slug = $2', [WRITE_SOURCE, 'concepts/internal-rewrite']);
    expect(rows[0]?.n ?? 0).toBe(1);
  });

  describe('bypass_policy trust gate', () => {
    test('a remote caller cannot bypass the gate', async () => {
      withPolicy({ 'brain-a': 'active' });
      const res = await put_page.handler(writeCtx({ remote: true }), {
        slug: 'concepts/x', content: BAD, bypass_policy: true,
      }) as Record<string, unknown>;
      expect(res.error).toBe('policy_violation');
    });

    test('a trusted local caller may bypass it (backlog repair)', async () => {
      withPolicy({ 'brain-a': 'active' });
      // Bypassing skips the gate entirely, so the write proceeds into the
      // engine — which this guarded engine refuses. Reaching the engine IS the
      // proof the gate was skipped.
      const p = put_page.handler(ctx({ remote: false, dryRun: true }), {
        slug: 'concepts/x', content: BAD, bypass_policy: true,
      });
      await expect(p).resolves.toMatchObject({ dry_run: true, slug: 'concepts/x' });
    });
  });

  describe('backward compatibility', () => {
    test('a source with no policy is unaffected', async () => {
      withPolicy({ 'brain-a': 'none' });
      const res = await put_page.handler(ctx({ dryRun: true }), {
        slug: 'literally/anything', content: 'no frontmatter at all',
      }) as Record<string, unknown>;
      expect(res).toMatchObject({ dry_run: true, slug: 'literally/anything' });
      expect(res.policy).toBeUndefined();
    });

    test('an engine with no sources table degrades to legacy behavior', async () => {
      // No override: the real loader runs and the guarded engine's executeRaw
      // returns no rows → no local_path → no policy.
      const res = await put_page.handler(ctx({ dryRun: true }), {
        slug: 'whatever', content: 'stub',
      }) as Record<string, unknown>;
      expect(res.dry_run).toBe(true);
    });
  });
});
