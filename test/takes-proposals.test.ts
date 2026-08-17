import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTakes } from '../src/commands/takes.ts';

type CapturedQuery = { sql: string; params: unknown[] };

/**
 * `localPath` models the `sources.local_path` row the takes writer reads to
 * decide WHERE a page lives: a source with its own working tree files pages at
 * that tree's root, which is how this brain is actually laid out. Omit it and
 * the resolver falls back to the multi-source `.sources/<id>/` nesting, which
 * is correct behavior but not what these flat fixtures build.
 */
function buildEngine(
  rows: Array<Record<string, unknown>>,
  captured: CapturedQuery[],
  localPath?: string,
) {
  return {
    executeRaw: async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM sources')) return [{ local_path: localPath ?? null }];
      return rows;
    },
  } as any;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

describe('gbrain takes proposals', () => {
  test('lists pending proposals in a read-only review format', async () => {
    const captured: CapturedQuery[] = [];
    const engine = buildEngine([
      {
        id: 42,
        source_id: 'javan-brain',
        page_slug: 'projects/gbrain-operating-playbook-v1',
        proposed_at: '2026-06-06T01:02:03.000Z',
        proposal_run_id: 'propose-20260606010203-deadbeef',
        status: 'pending',
        claim_text: 'GBrain dream write phases should stay manual until review tooling is proven.',
        kind: 'take',
        holder: 'brain',
        weight: 0.7,
        domain: 'operations',
        model_id: 'openai:gpt-5.5',
        predicted_brier: 0.31,
        predicted_brier_bucket_n: 12,
      },
    ], captured);

    const out = await captureStdout(() => runTakes(engine, ['proposals', '--source-id', 'javan-brain']));

    expect(out).toContain('# Take proposals');
    expect(out).toContain('#42 projects/gbrain-operating-playbook-v1');
    expect(out).toContain('GBrain dream write phases should stay manual');
    expect(out).toContain('predicted_brier=0.310');
    expect(captured[0].sql).toContain('FROM take_proposals');
    expect(captured[0].sql).toContain('status = $1');
    expect(captured[0].params).toEqual(['pending', 'javan-brain', 50]);
  });

  test('supports propose --review alias with scoped filters and json output', async () => {
    const captured: CapturedQuery[] = [];
    const engine = buildEngine([{
      id: BigInt(7),
      source_id: 'javan-brain',
      page_slug: 'projects/example',
      proposed_at: '2026-06-06T01:02:03.000Z',
      proposal_run_id: 'propose-run',
      status: 'rejected',
      claim_text: 'Rejected proposal.',
      kind: 'take',
      holder: 'brain',
      weight: 0.5,
      domain: null,
      model_id: 'openai:gpt-5.5',
      predicted_brier: null,
      predicted_brier_bucket_n: null,
    }], captured);

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--review',
      '--status',
      'rejected',
      '--source-id',
      'javan-brain',
      '--page',
      'projects/example',
      '--run-id',
      'propose-run',
      '--who',
      'brain',
      '--kind',
      'take',
      '--limit',
      '7',
      '--json',
    ]));

    const parsed = JSON.parse(out) as { filters: Record<string, unknown>; count: number; proposals: unknown[] };
    expect(parsed.count).toBe(1);
    expect((parsed.proposals[0] as Record<string, unknown>).id).toBe('7');
    expect(parsed.filters).toMatchObject({
      status: 'rejected',
      source_id: 'javan-brain',
      page_slug: 'projects/example',
      run_id: 'propose-run',
      holder: 'brain',
      kind: 'take',
      limit: 7,
    });
    expect(captured[0].params).toEqual(['rejected', 'javan-brain', 'projects/example', 'propose-run', 'brain', 'take', 7]);
    expect(captured[0].sql).toContain('proposal_run_id = $4');
    expect(captured[0].sql).toContain('LIMIT $7');
  });

  test('previews accepting pending proposals without writing markdown', async () => {
    const brainDir = mkdtempSync(join(tmpdir(), 'gbrain-takes-proposals-'));
    mkdirSync(join(brainDir, 'projects'), { recursive: true });
    const pagePath = join(brainDir, 'projects/example.md');
    const originalBody = '# Example\n\nCompiled truth.\n';
    writeFileSync(pagePath, originalBody, 'utf8');
    const captured: CapturedQuery[] = [];
    const engine = buildEngine([
      {
        id: 101,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        content_hash: 'abc',
        prompt_version: 'v-test',
        proposed_at: '2026-06-06T01:02:03.000Z',
        proposal_run_id: 'propose-run',
        status: 'pending',
        claim_text: 'Scoped proposal review should precede promotion.',
        kind: 'take',
        holder: 'brain',
        weight: 0.75,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
    ], captured, brainDir);

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--accept',
      '101',
      '--dry-run',
      '--dir',
      brainDir,
      '--json',
    ]));

    const parsed = JSON.parse(out) as { dry_run: boolean; changes: Array<Record<string, unknown>>; skipped: unknown[] };
    expect(parsed.dry_run).toBe(true);
    expect(parsed.changes).toHaveLength(1);
    expect(parsed.changes[0]).toMatchObject({
      id: 101,
      page_slug: 'projects/example',
      row_num: 1,
      claim: 'Scoped proposal review should precede promotion.',
      source: 'gbrain:take_proposals#101',
    });
    expect(parsed.skipped).toEqual([]);
    expect(readFileSync(pagePath, 'utf8')).toBe(originalBody);
    expect(captured[0].sql).toContain('WHERE id IN ($1)');
    expect(captured[0].params).toEqual([101]);
  });

  test('accept without --dry-run writes markdown, DB takes, and updates proposal status', async () => {
    const brainDir = mkdtempSync(join(tmpdir(), 'gbrain-takes-proposals-'));
    mkdirSync(join(brainDir, 'projects'), { recursive: true });
    const pagePath = join(brainDir, 'projects/example.md');
    writeFileSync(pagePath, '# Example\n\nCompiled truth.\n', 'utf8');
    const captured: CapturedQuery[] = [];
    const addedTakes: Array<Record<string, unknown>> = [];
    const proposalRow = {
      id: 201,
      source_id: 'javan-brain',
      page_slug: 'projects/example',
      content_hash: 'abc',
      prompt_version: 'v-test',
      proposed_at: '2026-06-06T01:02:03.000Z',
      proposal_run_id: 'propose-run',
      status: 'pending',
      claim_text: 'Promoted take from proposal.',
      kind: 'take',
      holder: 'brain',
      weight: 0.8,
      domain: null,
      model_id: 'openai:gpt-5.5',
      predicted_brier: null,
      predicted_brier_bucket_n: null,
    };
    const engine = {
      executeRaw: async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM sources')) return [{ local_path: brainDir }];
        if (sql.includes('FROM take_proposals')) return [proposalRow];
        if (sql.includes('FROM pages')) return [{ id: 99 }];
        return [];
      },
      addTakesBatch: async (batch: Array<Record<string, unknown>>) => {
        addedTakes.push(...batch);
      },
    } as any;

    const out = await captureStdout(() => runTakes(engine, [
      'propose', '--accept', '201', '--dir', brainDir, '--json',
    ]));

    const parsed = JSON.parse(out) as { dry_run: boolean; promoted: Array<Record<string, unknown>> };
    expect(parsed.dry_run).toBe(false);
    expect(parsed.promoted).toHaveLength(1);
    expect(parsed.promoted[0]).toMatchObject({
      id: 201,
      page_slug: 'projects/example',
      row_num: 1,
      claim: 'Promoted take from proposal.',
      source: 'gbrain:take_proposals#201',
    });

    const body = readFileSync(pagePath, 'utf8');
    expect(body).toContain('## Takes');
    expect(body).toContain('Promoted take from proposal.');
    expect(body).toContain('gbrain:take_proposals#201');

    expect(addedTakes).toHaveLength(1);
    expect(addedTakes[0]).toMatchObject({ page_id: 99, row_num: 1, claim: 'Promoted take from proposal.' });

    const updateQuery = captured.find(c => c.sql.includes('UPDATE take_proposals'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.params[0]).toBe(201);
    expect(updateQuery!.params[1]).toBe(1);
    expect(updateQuery!.sql).toContain("status = 'accepted'");
  });

  test('accept promotes multiple proposals across pages in one call', async () => {
    const brainDir = mkdtempSync(join(tmpdir(), 'gbrain-takes-proposals-'));
    mkdirSync(join(brainDir, 'projects'), { recursive: true });
    mkdirSync(join(brainDir, 'wiki'), { recursive: true });
    writeFileSync(join(brainDir, 'projects/alpha.md'), '# Alpha\n', 'utf8');
    writeFileSync(join(brainDir, 'wiki/beta.md'), '# Beta\n', 'utf8');
    const captured: CapturedQuery[] = [];
    const addedTakes: Array<Record<string, unknown>> = [];
    const proposalRows = [
      {
        id: 301, source_id: 'javan-brain', page_slug: 'projects/alpha',
        content_hash: 'a', prompt_version: 'v1', proposed_at: '2026-06-06T01:00:00.000Z',
        proposal_run_id: 'run1', status: 'pending', claim_text: 'Alpha claim.',
        kind: 'take', holder: 'brain', weight: 0.7, domain: null,
        model_id: 'openai:gpt-5.5', predicted_brier: null, predicted_brier_bucket_n: null,
      },
      {
        id: 302, source_id: 'javan-brain', page_slug: 'wiki/beta',
        content_hash: 'b', prompt_version: 'v1', proposed_at: '2026-06-06T01:00:00.000Z',
        proposal_run_id: 'run1', status: 'pending', claim_text: 'Beta claim.',
        kind: 'fact', holder: 'brain', weight: 0.9, domain: null,
        model_id: 'openai:gpt-5.5', predicted_brier: null, predicted_brier_bucket_n: null,
      },
    ];
    const engine = {
      executeRaw: async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM sources')) return [{ local_path: brainDir }];
        if (sql.includes('FROM take_proposals')) return proposalRows;
        if (sql.includes('FROM pages')) return [{ id: 50 }];
        return [];
      },
      addTakesBatch: async (batch: Array<Record<string, unknown>>) => {
        addedTakes.push(...batch);
      },
    } as any;

    const out = await captureStdout(() => runTakes(engine, [
      'propose', '--accept', '301,302', '--dir', brainDir, '--json',
    ]));

    const parsed = JSON.parse(out) as { promoted: Array<Record<string, unknown>> };
    expect(parsed.promoted).toHaveLength(2);
    expect(addedTakes).toHaveLength(2);
    const updates = captured.filter(c => c.sql.includes('UPDATE take_proposals'));
    expect(updates).toHaveLength(2);

    expect(readFileSync(join(brainDir, 'projects/alpha.md'), 'utf8')).toContain('Alpha claim.');
    expect(readFileSync(join(brainDir, 'wiki/beta.md'), 'utf8')).toContain('Beta claim.');
  });

  test('accept dry-run skips non-pending proposals', async () => {
    const brainDir = mkdtempSync(join(tmpdir(), 'gbrain-takes-proposals-'));
    mkdirSync(join(brainDir, 'projects'), { recursive: true });
    writeFileSync(join(brainDir, 'projects/example.md'), '# Example\n', 'utf8');
    const captured: CapturedQuery[] = [];
    const engine = buildEngine([
      {
        id: 102,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        content_hash: 'abc',
        prompt_version: 'v-test',
        proposed_at: '2026-06-06T01:02:03.000Z',
        proposal_run_id: 'propose-run',
        status: 'accepted',
        claim_text: 'Already accepted.',
        kind: 'take',
        holder: 'brain',
        weight: 0.75,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
    ], captured);

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--accept',
      '102',
      '--dry-run',
      '--dir',
      brainDir,
      '--json',
    ]));

    const parsed = JSON.parse(out) as { changes: unknown[]; skipped: Array<Record<string, unknown>> };
    expect(parsed.changes).toEqual([]);
    expect(parsed.skipped).toEqual([{ id: 102, status: 'accepted', page_slug: 'projects/example' }]);
  });

  test('reject dry-run previews pending proposals without updating status', async () => {
    const captured: CapturedQuery[] = [];
    const engine = buildEngine([
      {
        id: 401,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        proposed_at: '2026-06-06T01:02:03.000Z',
        proposal_run_id: 'propose-run',
        status: 'pending',
        claim_text: 'Duplicate proposal should be rejected.',
        kind: 'take',
        holder: 'brain',
        weight: 0.75,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
    ], captured);

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--reject',
      '401',
      '--dry-run',
      '--json',
    ]));

    const parsed = JSON.parse(out) as { dry_run: boolean; rejected: Array<Record<string, unknown>>; skipped: unknown[] };
    expect(parsed.dry_run).toBe(true);
    expect(parsed.rejected).toEqual([{
      id: 401,
      source_id: 'javan-brain',
      page_slug: 'projects/example',
      claim: 'Duplicate proposal should be rejected.',
      status: 'pending',
    }]);
    expect(parsed.skipped).toEqual([]);
    expect(captured).toHaveLength(1);
    expect(captured[0].sql).toContain('FROM take_proposals');
  });

  test('reject updates pending proposal status', async () => {
    const captured: CapturedQuery[] = [];
    const proposalRow = {
      id: 402,
      source_id: 'javan-brain',
      page_slug: 'projects/example',
      proposed_at: '2026-06-06T01:02:03.000Z',
      proposal_run_id: 'propose-run',
      status: 'pending',
      claim_text: 'Rejected proposal.',
      kind: 'take',
      holder: 'brain',
      weight: 0.75,
      domain: null,
      model_id: 'openai:gpt-5.5',
      predicted_brier: null,
      predicted_brier_bucket_n: null,
    };
    const engine = {
      executeRaw: async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM sources')) return [{ local_path: brainDir }];
        if (sql.includes('FROM take_proposals')) return [proposalRow];
        return [];
      },
    } as any;

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--reject',
      '402',
      '--json',
    ]));

    const parsed = JSON.parse(out) as { dry_run: boolean; rejected: Array<Record<string, unknown>> };
    expect(parsed.dry_run).toBe(false);
    expect(parsed.rejected).toHaveLength(1);
    const update = captured.find(c => c.sql.includes('UPDATE take_proposals'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'rejected'");
    expect(update!.sql).toContain("acted_by = 'cli'");
    expect(update!.params).toEqual([402]);
  });

  test('apply-review dry-run splits accept reject and pending decisions', async () => {
    const brainDir = mkdtempSync(join(tmpdir(), 'gbrain-takes-proposals-'));
    mkdirSync(join(brainDir, 'projects'), { recursive: true });
    writeFileSync(join(brainDir, 'projects/example.md'), '# Example\n', 'utf8');
    const reviewPath = join(brainDir, 'review.json');
    writeFileSync(reviewPath, JSON.stringify([
      { id: 501, recommendation: 'accept', decision: 'accept' },
      { id: 502, recommendation: 'review', decision: 'reject' },
      { id: 503, recommendation: 'review', decision: 'pending' },
    ]), 'utf8');
    const captured: CapturedQuery[] = [];
    const rows = [
      {
        id: 501,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        content_hash: 'abc',
        prompt_version: 'v-test',
        proposed_at: '2026-06-06T01:02:03.000Z',
        proposal_run_id: 'propose-run',
        status: 'pending',
        claim_text: 'Accepted from review JSON.',
        kind: 'take',
        holder: 'brain',
        weight: 0.75,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
      {
        id: 502,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        proposed_at: '2026-06-06T01:02:04.000Z',
        proposal_run_id: 'propose-run',
        status: 'pending',
        claim_text: 'Rejected from review JSON.',
        kind: 'take',
        holder: 'brain',
        weight: 0.7,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
    ];
    const engine = {
      executeRaw: async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM sources')) return [{ local_path: brainDir }];
        if (sql.includes('FROM take_proposals') && params[0] === 501) return [rows[0]];
        if (sql.includes('FROM take_proposals') && params[0] === 502) return [rows[1]];
        return [];
      },
    } as any;

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--apply-review',
      reviewPath,
      '--dry-run',
      '--dir',
      brainDir,
      '--json',
    ]));

    const parsed = JSON.parse(out) as {
      requested: { accept: number[]; reject: number[]; pending: number[] };
      accept: { changes: unknown[] };
      reject: { changes: unknown[] };
    };
    expect(parsed.requested).toEqual({ accept: [501], reject: [502], pending: [503] });
    expect(parsed.accept.changes).toHaveLength(1);
    expect(parsed.reject.changes).toHaveLength(1);
    expect(readFileSync(join(brainDir, 'projects/example.md'), 'utf8')).not.toContain('Accepted from review JSON.');
  });

  test('apply-review writes accepted takes and rejects proposals', async () => {
    const brainDir = mkdtempSync(join(tmpdir(), 'gbrain-takes-proposals-'));
    mkdirSync(join(brainDir, 'projects'), { recursive: true });
    writeFileSync(join(brainDir, 'projects/example.md'), '# Example\n', 'utf8');
    const reviewPath = join(brainDir, 'review.json');
    writeFileSync(reviewPath, JSON.stringify([
      { id: 601, recommendation: 'accept', decision: 'accept' },
      { id: 602, recommendation: 'review', decision: 'reject' },
    ]), 'utf8');
    const captured: CapturedQuery[] = [];
    const addedTakes: Array<Record<string, unknown>> = [];
    const rows = [
      {
        id: 601,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        content_hash: 'abc',
        prompt_version: 'v-test',
        proposed_at: '2026-06-06T01:02:03.000Z',
        proposal_run_id: 'propose-run',
        status: 'pending',
        claim_text: 'Accepted from review JSON.',
        kind: 'take',
        holder: 'brain',
        weight: 0.75,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
      {
        id: 602,
        source_id: 'javan-brain',
        page_slug: 'projects/example',
        proposed_at: '2026-06-06T01:02:04.000Z',
        proposal_run_id: 'propose-run',
        status: 'pending',
        claim_text: 'Rejected from review JSON.',
        kind: 'take',
        holder: 'brain',
        weight: 0.7,
        domain: null,
        model_id: 'openai:gpt-5.5',
        predicted_brier: null,
        predicted_brier_bucket_n: null,
      },
    ];
    const engine = {
      executeRaw: async (sql: string, params: unknown[]) => {
        captured.push({ sql, params });
        if (sql.includes('FROM sources')) return [{ local_path: brainDir }];
        if (sql.includes('FROM take_proposals') && params[0] === 601) return [rows[0]];
        if (sql.includes('FROM take_proposals') && params[0] === 602) return [rows[1]];
        if (sql.includes('FROM pages')) return [{ id: 77 }];
        return [];
      },
      addTakesBatch: async (batch: Array<Record<string, unknown>>) => {
        addedTakes.push(...batch);
      },
    } as any;

    const out = await captureStdout(() => runTakes(engine, [
      'propose',
      '--apply-review',
      reviewPath,
      '--dir',
      brainDir,
      '--json',
    ]));

    const parsed = JSON.parse(out) as {
      accept: { promoted: unknown[] };
      reject: { rejected: unknown[] };
    };
    expect(parsed.accept.promoted).toHaveLength(1);
    expect(parsed.reject.rejected).toHaveLength(1);
    expect(readFileSync(join(brainDir, 'projects/example.md'), 'utf8')).toContain('Accepted from review JSON.');
    expect(addedTakes).toHaveLength(1);
    const updates = captured.filter(c => c.sql.includes('UPDATE take_proposals'));
    expect(updates).toHaveLength(2);
    expect(updates.some(c => c.sql.includes("status = 'accepted'"))).toBe(true);
    expect(updates.some(c => c.sql.includes("status = 'rejected'"))).toBe(true);
  });
});
