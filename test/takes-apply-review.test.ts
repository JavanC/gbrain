/**
 * Fork: `gbrain takes propose --apply-review <file.json>` applies a reviewed
 * batch through upstream's accept/reject core (the same coordinated takes_add
 * path `--accept` uses on a managed brain). A row that fails is reported and
 * the batch keeps going; the command exits 1 when any row failed.
 */
import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainEngine } from '../src/core/engine.ts';
import { runTakes } from '../src/commands/takes.ts';
import { parseTakesFence } from '../src/core/takes-fence.ts';
import { managedBrain } from './helpers/managed-brain.ts';
import { put } from './helpers/wave-fixture.ts';

async function insertProposal(engine: BrainEngine, slug: string, claim: string): Promise<number> {
  const rows = await engine.executeRaw<{ id: number }>(
    `INSERT INTO take_proposals (source_id, page_slug, content_hash, prompt_version, proposal_run_id,
       claim_text, kind, holder, weight, domain, model_id, status)
     VALUES ('default', $1, md5($2), 'test-v1', 'run-test', $2, 'bet', 'world', 0.7, NULL, 'test-model', 'pending')
     RETURNING id`, [slug, claim]);
  return Number(rows[0]!.id);
}

async function status(engine: BrainEngine, id: number): Promise<string> {
  const [row] = await engine.executeRaw<{ status: string }>('SELECT status FROM take_proposals WHERE id = $1', [id]);
  return row!.status;
}

/** Run the CLI, capturing stdout and turning process.exit into a recorded code. */
async function runCli(engine: BrainEngine, args: string[]): Promise<{ out: string; exitCode: number | null }> {
  const lines: string[] = [];
  const log = console.log, err = console.error, exit = process.exit;
  let exitCode: number | null = null;
  console.log = (...parts: unknown[]) => { lines.push(parts.map(String).join(' ')); };
  console.error = () => {};
  process.exit = ((code?: number) => { exitCode = code ?? 0; throw new Error('__exit__'); }) as never;
  try { await runTakes(engine, args); }
  catch (e) { if ((e as Error).message !== '__exit__') throw e; }
  finally { console.log = log; console.error = err; process.exit = exit; }
  return { out: lines.join('\n'), exitCode };
}

test('takes propose --apply-review accepts, rejects and leaves pending in one pass; a bad row is reported, not fatal', async () => {
  await managedBrain(async ({ engine, ctx, root }) => {
    const slug = 'companies/acme-example';
    await put(ctx, slug, 'About acme-example.', 'company');
    const accept = await insertProposal(engine, slug, 'Acme ships the widget by Q3');
    const reject = await insertProposal(engine, slug, 'Acme pivots to hardware');
    const pending = await insertProposal(engine, slug, 'Acme hires a CFO');
    const missing = 999_999;

    const review = join(root, '..', `review-${Date.now()}.json`);
    writeFileSync(review, JSON.stringify([
      { id: accept, decision: 'accept' },
      { id: reject, decision: 'reject' },
      { id: pending, decision: 'pending' },
      { id: missing, decision: 'accept' },
    ]));

    // Dry run changes nothing.
    const dry = await runCli(engine, ['propose', '--apply-review', review, '--dry-run', '--json', '--dir', root]);
    expect(JSON.parse(dry.out).dry_run).toBe(true);
    expect(await status(engine, accept)).toBe('pending');

    const real = await runCli(engine, ['propose', '--apply-review', review, '--json', '--dir', root]);
    const result = JSON.parse(real.out);
    expect(result.failures).toBe(1);
    expect(real.exitCode).toBe(1);
    expect(await status(engine, accept)).toBe('accepted');
    expect(await status(engine, reject)).toBe('rejected');
    expect(await status(engine, pending)).toBe('pending');
    expect(result.accepted.find((r: { id: number }) => r.id === missing).error).toBeTruthy();

    // The accepted claim landed in the managed file through the coordinator.
    const fence = parseTakesFence(readFileSync(join(root, `${slug}.md`), 'utf-8'));
    expect(fence.takes.map(t => t.claim)).toEqual(['Acme ships the widget by Q3']);
  });
}, 180_000);
