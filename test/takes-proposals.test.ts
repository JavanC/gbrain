import { describe, expect, test } from 'bun:test';
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
});
