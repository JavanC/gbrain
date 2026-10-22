/**
 * Fork, JAV-248: the source write-policy gate covers `commit_page_upload`.
 *
 * 1. Protects: an agent cannot evade a source's write policy by sending the
 *    page through the upload path instead of `put_page`. An upload's body
 *    lives in a staging session, not in `intent.content`, so the gate has to
 *    read the staged text to judge it at all.
 * 2. Fails when: `src/core/ops/page-upload.ts` stops passing `writePolicy`, or
 *    `preparePageAdmission` stops resolving the staged body for the gate.
 *    Verified against the baseline: with the three source files reverted to
 *    f820159ff, the first test fails with `Expected: "policy_violation" /
 *    Received: undefined` — `commit_page_upload` committed a wholly-CJK page,
 *    because `runMutationWritePolicy` returns an empty outcome for a non-string
 *    content and `intent.content` is undefined for a staged body. So merely
 *    passing `writePolicy: true`, as the ticket first proposed, changed nothing.
 *    NOTE: only the FIRST test discriminates. The other three pass on that
 *    baseline too — tests 2 and 3 describe behavior that already worked, and
 *    test 4's "no created: on an upload" is true there for the wrong reason
 *    (the gate never ran at all). Test 4 is meaningful only alongside test 1,
 *    which proves the gate now runs on this path.
 * 3. Option A (the semantics chosen on the ticket): the staged body is CHECKED
 *    ONLY. A violation refuses; a pass stores the caller's bytes instead of the
 *    gate's normalized text, because an intent cannot carry both a `body_ref`
 *    and `content`. The last test pins that difference against `put_page`,
 *    which does take the normalized text.
 * 4. Runs on PGLite. No embedding, no model calls.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import type { BrainEngine } from '../src/core/engine.ts';
import type { GBrainConfig } from '../src/core/config.ts';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { operations, type OperationContext } from '../src/core/operations.ts';
import { __setWritePolicyOverrideForTests, parseWritePolicy } from '../src/core/write-policy/index.ts';

const op = (name: string) => operations.find(o => o.name === name)!;
const hex = (text: string) => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/**
 * `language_rules` supplies the refusal (severity defaults to error,
 * max_cjk_ratio to the chunker threshold). `server_managed.created` supplies a
 * NORMALIZATION, which is what makes the option-A test discriminate: a gate
 * whose output were written back would add `created:` to a staged upload too.
 */
const POLICY = parseWritePolicy({
  contract_version: '1',
  language_rules: { body: 'english_first' },
  server_managed: { created: { mode: 'set_on_create_preserve_on_update', value: 'date', timezone: 'Asia/Taipei' } },
}, 'test')!;

const CJK_BODY = '---\ntitle: X\ntype: note\n---\n\n這一整段都是中文內容，完全沒有英文的部分，所以會被政策拒絕。\n';
const EN_BODY = '---\ntitle: X\ntype: note\n---\n\nEnglish body that the policy admits.\n';

describe('write policy gates commit_page_upload (JAV-248)', () => {
  let engine: BrainEngine;
  let ctx: OperationContext;
  let n = 0;

  const call = async (name: string, params: Record<string, unknown>) =>
    await op(name).handler(ctx, params) as Record<string, any>;

  /** begin → one part → commit, returning commit's response. */
  const upload = async (slug: string, text: string) => {
    const begun = await call('begin_page_upload', {
      slug, mode: 'create', total_bytes: Buffer.byteLength(text), sha256: hex(text), request_id: randomUUID() });
    await call('upload_page_part', { upload_id: begun.upload_id, part: 0, text, part_sha256: hex(text) });
    return await call('commit_page_upload', { upload_id: begun.upload_id, request_id: randomUUID(), wait_ms: 30_000 });
  };

  const frontmatterOf = async (slug: string) =>
    ((await call('get_page', { slug, source_id: 'default', include_content: true })).content as string).split('---')[1] ?? '';

  /** The journal: a refused write must not leave a row here. */
  const journalRows = async (slug: string) => (await engine.executeRaw<{ n: number }>(
    'SELECT count(*)::int AS n FROM persistence_requests WHERE slug = $1', [slug]))[0]!.n;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
    await engine.executeRaw(`INSERT INTO oauth_clients(client_id,client_secret_hash,client_name,scope,source_id)
      VALUES('gate-a','fixture-hash','gate-client','read write','default') ON CONFLICT (client_id) DO NOTHING`);
    // Set once for the file: resetting the policy cache between tests makes the
    // next resolution miss this override, which silently un-gates later tests.
    __setWritePolicyOverrideForTests(() => ({ status: 'active', policy: POLICY, path: '/tmp/gbrain.yml' }));
    ctx = {
      engine, config: {} as GBrainConfig, logger: { info() {}, warn() {}, error() {} }, dryRun: false, remote: true,
      sourceId: 'default', transport: 'http', inboundFrameBytes: 1024 ** 2,
      auth: { token: 'fixture', clientId: 'gate-a', principal: { kind: 'oauth_client', id: 'gate-a' },
        scopes: ['read', 'write'], sourceId: 'default', allowedSources: ['default'] },
    } as unknown as OperationContext;
  }, 120_000);

  afterAll(async () => {
    __setWritePolicyOverrideForTests(null);
    await engine.disconnect();
  });

  test('a CJK body sent through the upload path is refused, and nothing is written', async () => {
    const slug = `notes/gate-cjk-${++n}`;
    const response = await upload(slug, CJK_BODY);

    expect(response.error).toBe('policy_violation');
    expect(response.written).toBe(false);
    expect((response.violations as Array<{ code: string }>).map(v => v.code)).toContain('body_language_not_english_first');

    // "Nothing was written" read from storage, not from the response.
    expect(await engine.readPageSnapshot(slug, { sourceId: 'default' })).toBeNull();
    expect(await journalRows(slug)).toBe(0);
  });

  test('put_page refuses the same body, so neither path is a way around the other', async () => {
    const response = await call('put_page', {
      slug: `notes/gate-cjk-put-${++n}`, content: CJK_BODY, request_id: randomUUID(), wait_ms: 30_000 });
    expect(response.error).toBe('policy_violation');
    expect(response.written).toBe(false);
  });

  test('an English body still commits through the upload path, so the gate is not refusing everything', async () => {
    const slug = `notes/gate-en-${++n}`;
    expect((await upload(slug, EN_BODY)).error).toBeUndefined();
    expect(await engine.readPageSnapshot(slug, { sourceId: 'default' })).not.toBeNull();
  });

  test('option A: put_page takes the gate\'s normalized frontmatter, a staged upload keeps the caller\'s', async () => {
    const viaPut = `notes/gate-norm-put-${++n}`;
    const viaUpload = `notes/gate-norm-up-${++n}`;

    await call('put_page', { slug: viaPut, content: EN_BODY, request_id: randomUUID(), wait_ms: 30_000 });
    expect((await upload(viaUpload, EN_BODY)).error).toBeUndefined();

    // put_page: the gate's server_managed field is written back.
    expect(await frontmatterOf(viaPut)).toContain('created:');
    // Upload: checked only, so the staged bytes stand and no created: appears.
    expect(await frontmatterOf(viaUpload)).not.toContain('created:');
  });
});
