import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runTakes } from '../src/commands/takes.ts';

type CapturedQuery = { sql: string; params: unknown[] };

function buildEngine(rows: Array<Record<string, unknown>>, captured: CapturedQuery[]) {
  return {
    executeRaw: async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
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
    const engine = buildEngine([], captured);

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
    expect(parsed.count).toBe(0);
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
    ], captured);

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
});
