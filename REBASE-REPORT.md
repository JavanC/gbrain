# Rebase report: fork patchset → upstream v0.60.360.0

> 候選分支,非定版。需要判斷的地方標記為「待判」。

## 1. 上游目標
- 目標 tag:`v0.60.360.0`(`ea5ac03fe`,2026-10-22 01:08Z,fetch 時最新 tag)
- fork 來源:`origin/javan/rebase-v0.60`(0.60.102.1)
- merge-base:`5b5891069` = `v0.60.102.0`
- fork commits above merge-base:23;upstream commits since merge-base:5985

## 2. Fork patch 清單

23 個 fork commit 全部處理,0 個退役、0 個略過。另新增 1 個修正 commit(`59f736366`)。

| fork commit | 新 commit | 結果 |
|---|---|---|
| f5870c620 write-policy gate | e02f30aa6 | 衝突已解(4 檔) |
| 92eef4315 parity fixture | ed975c26c | 乾淨 |
| 6e7b64f9b propose_takes model config | ff21434bf | 乾淨 |
| e26fd61d7 proposal cache vs fences | 8fb17abf5 | 乾淨 |
| f5f0d1601 post-write enrichment | c9eb1cc3e | 衝突已解 + 簽名適配 |
| 199d4d737 propose slug scoping | 03a105efe | 衝突已解(2 檔) |
| 4eb3991e6 | 19e434e7b | 乾淨 |
| b61331fec | 3503258f0 | 乾淨 |
| b0d8dbe45 | 08a37f22e | 乾淨 |
| 71363b115 | 95ac74eaa | 乾淨 |
| f0bcffee2 | e98fe9a34 | 乾淨 |
| 21d075711 capture refusal surfaced | bf0a2c910 | 乾淨 |
| 1f44cc4f4 takes --apply-review | c90cb41c2 | 衝突已解(help 文字) |
| 42a136e1f registry ratchets | 5aaf9b85f | 乾淨 |
| 3cff9872d body language rule | 1d9ce8c55 | 衝突已解(cjk.ts) |
| 189bc198c v0.51 contract adapt | 04de74174 | 乾淨 |
| c816d31f4 gate by outcome | f9644f96e | 乾淨 |
| 9926c841e put_pages gate / policy report | e326d0cbd + 修正 59f736366 | 乾淨套用,但有語意缺陷 → 另修 |
| 357f11653 propose_takes helpers | 314ad4c2f | 衝突已解(3 檔) |
| b2d42db59 key-files / catalogs / ratchets | d4a9e5506 | 衝突已解(6 檔,逐 hunk) |
| e90e765c8 v0.60.102.1 release | ca8df0033 | 重做為 v0.60.360.1 release |
| fddaf0b0f e2e fixtures | b4d515a69 | 乾淨 |
| 08604c125 apply-review e2e | 16b43a3c1 | 乾淨 |

「乾淨」只代表 git 沒報衝突,不代表語意正確;語意判斷見下方逐 commit 紀錄與第 3 節稽核。

### 逐 commit 衝突處理紀錄(含待判)

- f5870c620 → e02f30aa6: 4 衝突。operations.ts(並存上游 searchExactOperations)、page-batch.ts(上游新增 repeats + writePolicy)、pages.ts(保留上游 AGENT_CONTENT_PARAMS / 'Server-set' 描述 / assertLargePageAdmission / funnelPassThrough('save'),加 bypass_policy、previewWritePolicy、writePolicy:true)、page-mutations.ts(上游 preadmit cache 雙路 prepare:兩次 preparePageAdmission 都包 writePolicyRefusalResponse;input 型別加 writePolicy)。
  - 待判:policy refusal 是 resolve 出 response 而非 throw,所以 put_page 被拒時 funnelPassThrough('save') 仍會記一次 save funnel event。
- f5f0d1601: page-mutations.ts 衝突。上游 prior 路徑變成 withLiveSearchable(throwIfHeld(...)) 且有 preadmit 重試的第二條 prior 路徑 → 兩條都外包 withPostWriteEnrichment(...,true)。另:上游 runLinksTimelinePass 簽名新增 budgetLeft(0..1 分數)與 log,post-write-enrichment.ts 補上(log → console.error;sweep 預設是 no-op,這是判斷點)。
- 199d4d737: cycle.ts(並存上游 onPhaseStart #7241 + fork proposeInclude/Exclude/Limit);propose-takes.ts(上游新的 listCandidatePages 第 4 參數 types + ProposeTakesFailures 失敗頁後排序,fork 的 fetchLimit 視窗套在上游呼叫上)。
- 1f44cc4f4: takes.ts 只有 help 文字衝突,並存上游 --failed/--retry-failed 與 fork --apply-review;dispatch 自動合併,位置確認在上游 editFlags 檢查之後、--accept 之前。
- 3cff9872d: cjk.ts 上游把 isCJKDominant 改為一次掃描的 wordStats/statsAreCJKDominant;fork 的 cjkRatio 改以 wordStats 計算(同一實作、同一門檻),保留上游 isCJKDominant 不動。
- 9926c841e 乾淨套用,但在新架構下有語意缺陷:passedReports 以 ctx 物件為 key,上游 preadmit cache 用 {...ctx, engine: cached} 呼叫 prepare → 已接受寫入的 policy 回報在 preadmit_cache 開啟時被丟掉。另起修正 commit(preparedCtx)。
- 357f11653: cycle.ts(保留上游 onPhaseStart + fork 單行 propose*)、propose-takes.ts(scopedFetchLimit 套到上游 listCandidatePages(…, types) + failures 排序)、function-size-baseline.tsv(取上游列,ProposeTakesPhase.process 上游 430 +2 fork → 432;上游已刪除 patterns.ts 列,沿用)。
- b2d42db59(第一次嘗試用 --ours 弄丟東西的那個):逐 hunk 移植。operations.ts / pages.ts 以 HEAD(上游+已 pick)為底,手動套用 fork 的單行壓縮 hunk;KEY_FILES.md 取上游(上游已改寫整張表與下方章節),追加 fork 路由列一行;TOOL_CATALOG.md 與 cli-flag-registry.generated.ts 取目標 tag 版本後跑 generate-tool-catalog.ts / build:flag-registry 重產(結果:+get_write_contract/+validate_page、163 tools;dream +--propose-*、takes +--apply-review);module-size-limits.tsv 取上游,實測行數:jobs.ts 688(+1)、operations.ts 245(+1)、config.ts 2005(+2)、ops/pages.ts 730(+3),同列附 fork 註記;cycle.ts 3337 未超上游上限不動。check-module-size 通過。
- e90e765c8(release):不直接重放,改為新 release commit 0.60.360.1。15 個版本檔衝突全為版本字串;以上游為底重寫戳記並用 generate-plugin-tree / generate-template-repo 重產;CHANGELOG 以上游為底,fork 三個舊條目(0.60.102.1 / 0.51.0.1 / 0.48.5.1)插在原錨點前,另加 0.60.360.1 條目。check-bootstrap-tag / check-plugin-tree / check-bootstrap-templates 通過。

## 3. 整檔移除稽核

方法:對每個改動檔,把 `git diff -U0` 的移除行與新增行各做成 Counter 再相減(搬移的行互相抵消),剩下的是真的消失的行。
- **正向**(`v0.60.360.0..HEAD`):上游行在新分支消失。若同一行在 fork 自己的 `merge-base..javan/rebase-v0.60` 也被淨移除 → `INTENT`,否則 `SUSPECT` 逐一人工判斷。
- **反向**(`merge-base..javan/rebase-v0.60` 的 fork 淨新增行):逐行確認在 HEAD 該檔仍存在(含重數)。

結果:正向 20 INTENT / 31 SUSPECT,反向 38 MISSING。**逐項判斷後無疑似誤刪。**

| 類別 | 項目 | 判斷 |
|---|---|---|
| 版本戳記 | VERSION、package.json、openclaw / .codex / .claude plugin.json(含 variants)、BOOTSTRAP 戳記、plugin tree / template 戳記(正向 0.60.360.0、反向 0.60.102.1) | 刻意:改為 0.60.360.1 |
| generated | TOOL_CATALOG 總數行(161→163)、plugin/README op 數(182→184)、cli-flag-registry 的 dream / takes 列 | 刻意:由生成器重產,內容包含 fork 的新 flag/op |
| ratchet 列 | module-size-limits.tsv(jobs/operations/config/ops/pages)、function-size-baseline.tsv(ProposeTakesPhase.process) | 刻意:取上游列後依實測調高並附 fork 註記;fork 舊列(cycle.ts 3265 等)是對 v0.60.102 的數字,已作廢 |
| 被 fork 版本取代的上游行 | ops/pages.ts `submitPageMutation(... put_page ...)`、propose-takes.ts `listCandidatePages(..., pageLimit, ...)`、page-mutations.ts 的 submit/prepare 型別行、prepare 呼叫行、兩條 prior return 行 | 刻意:每行都有對應的「上游行 + fork 參數/包裝」新行(已人工逐行比對) |
| fork 行在新架構下改寫 | cjk.ts 的 cjkRatio 舊實作 8 行;propose-takes 的 `scopedFetchLimit` 呼叫行;pages.ts / page-mutations.ts 的 fork 舊行 | 刻意:語意已移植到上游新結構(cjkRatio 改用 wordStats;`withWritePolicyReport(ctx` → `(preparedCtx`,見修正 commit 59f736366) |
| INTENT(20 行) | takes.ts 兩個 import、propose-takes 的 run id / modelId / modelHint / contentHash 舊行、sweep.ts 兩個 export 化、operations.ts、page-batch.ts 等 | 刻意:fork 在舊分支同樣淨移除 |

<details><summary>原始輸出</summary>

```
# FORWARD (tag..HEAD net-removed lines)
SUSPECT	.claude-plugin/plugin.json	1	  "version": "0.60.360.0",
SUSPECT	.codex-plugin/plugin.json	1	  "version": "0.60.360.0",
SUSPECT	BOOTSTRAP_FOR_AGENTS.md	1	<!-- gbrain-runbook-stamp: 0.60.360.0 -->
SUSPECT	VERSION	1	0.60.360.0
SUSPECT	docs/TOOL_CATALOG.md	1	Every non-localOnly operation on the MCP surface: 161 tools across 25 areas. **Starter** marks membership in the ~40-op `starter` surface (`src/mcp/surface.ts`); **Gate** names the config key that mus
SUSPECT	openclaw.plugin.json	1	  "version": "0.60.360.0",
SUSPECT	package.json	1	  "version": "0.60.360.0",
SUSPECT	plugin-variants/gbrain-coding/.claude-plugin/plugin.json	1	  "version": "0.60.360.0",
SUSPECT	plugin-variants/gbrain-coding/.codex-plugin/plugin.json	1	  "version": "0.60.360.0",
SUSPECT	plugin-variants/gbrain-coding/README.md	1	<!-- gbrain-plugin-tree-stamp: 0.60.360.0 -->
SUSPECT	plugin-variants/gbrain-daily/.claude-plugin/plugin.json	1	  "version": "0.60.360.0",
SUSPECT	plugin-variants/gbrain-daily/.codex-plugin/plugin.json	1	  "version": "0.60.360.0",
SUSPECT	plugin-variants/gbrain-daily/README.md	1	<!-- gbrain-plugin-tree-stamp: 0.60.360.0 -->
SUSPECT	plugin/README.md	1	<!-- gbrain-plugin-tree-stamp: 0.60.360.0 -->
SUSPECT	plugin/README.md	1	The plugin's MCP server runs `gbrain serve --surface full` — 182
SUSPECT	scripts/function-size-baseline.tsv	1	src/core/cycle/propose-takes.ts	ProposeTakesPhase.process	430	seed: W5 baseline, refactor wave 1 (decomposition deferred to wave 2, plan D1); +2 #5958 (issue #5874): call_timeout_ms read and its per-p
SUSPECT	scripts/module-size-limits.tsv	1	src/commands/jobs.ts	687	ratchet	refactor wave 1 split target (W4 jobs, cut line); ceiling rationale: docs/architecture/key-files/commands-4.md entry for src/commands/jobs.ts; help lines: authorize-le
SUSPECT	scripts/module-size-limits.tsv	1	src/core/operations.ts	244	ratchet	+1 #7168: graphRankOperations import (ops/graph-rank.ts; spread shares the orphans line); peel target: containment sprint C4-C7; grown v0.46.26.0 megawave op wiring;
SUSPECT	scripts/module-size-limits.tsv	1	src/core/config.ts	2003	ratchet	+2 W5: search.page_rank_cut / page_rank_cut_factor KNOWN_CONFIG_KEYS rows (read in search/page-rank-cut.ts); +3 W3 confidence-gated reranking: search.reranker.gate / ga
SUSPECT	scripts/module-size-limits.tsv	1	src/core/ops/pages.ts	727	ratchet	crossed the unlisted 1500 cap in the fix wave: pack-vocabulary enforcement on capture (#4721) + get_page alias follow (#4275) landed together; next growth should peel
INTENT	src/commands/takes.ts	1	import { existsSync } from 'node:fs';
INTENT	src/commands/takes.ts	1	import type { BrainEngine } from '../core/engine.ts';
SUSPECT	src/core/cli-flag-registry.generated.ts	1	  'dream': ['--audit-rejects', '--brain', '--cancel-unmatched', '--date', '--dir', '--drain', '--dry-run', '--eval-run', '--force', '--from', '--help', '--input', '--install', '--json', '--limit', '--
SUSPECT	src/core/cli-flag-registry.generated.ts	1	  'takes': ['--about', '--accept', '--applied', '--apply', '--batch-size', '--before', '--brain', '--bucket-size', '--by', '--claim', '--date', '--dim', '--dir', '--domain', '--dry-run', '--embedding-
INTENT	src/core/cycle.ts	1	          const { result, duration_ms } = await timePhase(() => runPhaseProposeTakes(calibrationCtx, { dryRun, repoPath: brainDir ?? undefined, deadlineAtMs: opts.deadlineAtMs ?? null, once: opts.once
INTENT	src/core/cycle/propose-takes.ts	1	  /** Skip pages that already have a complete takes fence. Default: true. */
INTENT	src/core/cycle/propose-takes.ts	1	 * Compute the content_hash key for the idempotency cache. SHA-256 of the
INTENT	src/core/cycle/propose-takes.ts	1	 * page body suffices — page slug + prompt_version are separate columns in
INTENT	src/core/cycle/propose-takes.ts	1	 * the composite unique index.
INTENT	src/core/cycle/propose-takes.ts	1	  return createHash('sha256').update(pageBody).digest('hex');
INTENT	src/core/cycle/propose-takes.ts	1	    const proposalRunId = `propose-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomUUID().slice(0, 8)}`;
INTENT	src/core/cycle/propose-takes.ts	1	    const modelId = opts.model ?? getChatModel();
INTENT	src/core/cycle/propose-takes.ts	1	      tombstones_written: 0,
SUSPECT	src/core/cycle/propose-takes.ts	1	    const listed = await listCandidatePages(engine, scope, pageLimit, await proposeTakesTypes(engine));
INTENT	src/core/cycle/propose-takes.ts	1	          modelHint: opts.model,
INTENT	src/core/operations.ts	1	  ...persistenceOperations,
INTENT	src/core/ops/pages.ts	1	      return { dry_run: true, action: 'put_page', slug: p.slug };
SUSPECT	src/core/ops/pages.ts	1	    return submitPageMutation(ctx, { operation: 'put_page', params: p }).then(funnelPassThrough('save')).catch(error => rethrowNamingRevisionSource(ctx, sourceId, p, error));
INTENT	src/core/ops/pages.ts	1	    return submitPageMutation(ctx, { operation: 'capture', params: p });
INTENT	src/core/persistence/page-batch.ts	1	      prepared[index] = await preparePageAdmission(ctx, { operation: 'put_page', params,
SUSPECT	src/core/persistence/page-mutations.ts	1	  input: { operation: string; params: Record<string, unknown>; waitMs?: number; managedFileImport?: true; timelineSection?: TimelineSection; databaseOnly?: 'overwrite_restore' | 'detached';
SUSPECT	src/core/persistence/page-mutations.ts	1	  let prepared = await preparePageAdmission(cached ? { ...ctx, engine: cached } : ctx, { ...input, params });
SUSPECT	src/core/persistence/page-mutations.ts	1	  if (prepared.prior) return withLiveSearchable(ctx, throwIfHeld(pendingAwareResponse(ctx, await waitForWrite(ctx.engine, prepared.prior, ctx.config, waitMs())), false));
SUSPECT	src/core/persistence/page-mutations.ts	1	    prepared = await preparePageAdmission(ctx, { ...input, params: { ...params, request_id: prepared.admission.requestId } });
SUSPECT	src/core/persistence/page-mutations.ts	1	    if (prepared.prior) return withLiveSearchable(ctx, throwIfHeld(pendingAwareResponse(ctx, await waitForWrite(ctx.engine, prepared.prior, ctx.config, waitMs())), false));
INTENT	src/core/persistence/page-mutations.ts	1	  return { ...response, ...(prepared.typeWarning ? { type_warning: prepared.typeWarning } : {}), ...(prepared.slugAdvisory ? { slug_advisory: prepared.slugAdvisory } : {}) };
SUSPECT	src/core/persistence/page-mutations.ts	1	    databaseOnly?: 'overwrite_restore' | 'detached'; stagedBody?: true }
INTENT	src/core/sweep.ts	1	interface PassCtx {
INTENT	src/core/sweep.ts	1	async function runLinksTimelinePass(
SUSPECT	templates/bootstrap/template-repo/README.md	1	<!-- gbrain-template-stamp: 0.60.360.0 -->
INTENT	test/propose-takes.test.ts	1	    expect((runIdA as string).startsWith('propose-')).toBe(true);
# REVERSE (MB..fork net-added lines missing from HEAD)
MISSING	.claude-plugin/plugin.json	1	  "version": "0.60.102.1",
MISSING	.codex-plugin/plugin.json	1	  "version": "0.60.102.1",
MISSING	BOOTSTRAP_FOR_AGENTS.md	1	<!-- gbrain-runbook-stamp: 0.60.102.1 -->
MISSING	VERSION	1	0.60.102.1
MISSING	docs/TOOL_CATALOG.md	1	Every non-localOnly operation on the MCP surface: 142 tools across 23 areas. **Starter** marks membership in the ~40-op `starter` surface (`src/mcp/surface.ts`); **Gate** names the config key that mus
MISSING	openclaw.plugin.json	1	  "version": "0.60.102.1",
MISSING	package.json	1	  "version": "0.60.102.1",
MISSING	plugin-variants/gbrain-coding/.claude-plugin/plugin.json	1	  "version": "0.60.102.1",
MISSING	plugin-variants/gbrain-coding/.codex-plugin/plugin.json	1	  "version": "0.60.102.1",
MISSING	plugin-variants/gbrain-coding/README.md	1	<!-- gbrain-plugin-tree-stamp: 0.60.102.1 -->
MISSING	plugin-variants/gbrain-daily/.claude-plugin/plugin.json	1	  "version": "0.60.102.1",
MISSING	plugin-variants/gbrain-daily/.codex-plugin/plugin.json	1	  "version": "0.60.102.1",
MISSING	plugin-variants/gbrain-daily/README.md	1	<!-- gbrain-plugin-tree-stamp: 0.60.102.1 -->
MISSING	plugin/README.md	1	<!-- gbrain-plugin-tree-stamp: 0.60.102.1 -->
MISSING	scripts/function-size-baseline.tsv	1	src/core/cycle/propose-takes.ts	ProposeTakesPhase.process	431	seed: W5 baseline, refactor wave 1 (decomposition deferred to wave 2, plan D1); +2 #5958 (issue #5874): call_timeout_ms read and its per-p
MISSING	scripts/module-size-limits.tsv	1	src/commands/jobs.ts	667	ratchet	refactor wave 1 split target (W4 jobs, cut line); ceiling rationale: docs/architecture/key-files/commands-4.md entry for src/commands/jobs.ts; help lines: authorize-le
MISSING	scripts/module-size-limits.tsv	1	src/core/cycle.ts	3265	ratchet	+2 System One v1 S9: extract_facts phase tail runs the conflict sweep (ai/decide/sweep.ts) only when the slot is not off; +2 System One v1: purge phase prunes decision r
MISSING	scripts/module-size-limits.tsv	1	src/core/operations.ts	341	ratchet	peel target: containment sprint C4-C7; grown v0.46.26.0 megawave op wiring; +chat-connectors wiring (master merge); +5 v0.47 gmail-loops: loopsOperations spread + OP
MISSING	scripts/module-size-limits.tsv	1	src/core/config.ts	1900	ratchet	+8 #5988: sync.holds/hold_cap/hold_escalate_count/hold_escalate_pct/parser_regression key registration (read by persistence/sync-holds.ts); +3 agent operator wave A4: G
MISSING	scripts/module-size-limits.tsv	1	src/core/ops/pages.ts	674	ratchet	crossed the unlisted 1500 cap in the fix wave: pack-vocabulary enforcement on capture (#4721) + get_page alias follow (#4275) landed together; next growth should peel
MISSING	src/core/cjk.ts	1	  return cjkRatio(s) >= CJK_DENSITY_THRESHOLD;
MISSING	src/core/cjk.ts	1	 * CJK chars as a fraction of non-whitespace chars, 0 when there is no text.
MISSING	src/core/cjk.ts	1	 * Extracted so `isCJKDominant` and the write-policy language rule share ONE
MISSING	src/core/cjk.ts	1	 * implementation: a second copy would let the chunker's notion of "CJK-heavy"
MISSING	src/core/cjk.ts	1	 * drift away from the gate's, and the gate would then reject pages the
MISSING	src/core/cjk.ts	1	 * chunker treats as Latin (or the reverse).
MISSING	src/core/cjk.ts	1	  if (nonWhitespace === 0) return 0;
MISSING	src/core/cjk.ts	1	  return (cjkMatches ? cjkMatches.length : 0) / nonWhitespace;
MISSING	src/core/cli-flag-registry.generated.ts	1	  'dream': ['--audit-rejects', '--brain', '--cancel-unmatched', '--date', '--dir', '--drain', '--dry-run', '--eval-run', '--force', '--from', '--help', '--input', '--install', '--json', '--limit', '--
MISSING	src/core/cli-flag-registry.generated.ts	1	  'takes': ['--accept', '--apply-review', '--batch-size', '--before', '--brain', '--bucket-size', '--by', '--claim', '--dim', '--dir', '--domain', '--dry-run', '--embedding-dimensions', '--embedding-m
MISSING	src/core/cycle/propose-takes.ts	1	    const pages = await listCandidatePages(engine, scope, scopedFetchLimit(opts, pageLimit)); // Fork: wider window under slug scoping
MISSING	src/core/ops/pages.ts	1	    return submitPageMutation(ctx, { operation: 'put_page', params: p, writePolicy: true }).catch(error => rethrowNamingRevisionSource(ctx, sourceId, p, error));
MISSING	src/core/persistence/page-mutations.ts	1	  input: { operation: string; params: Record<string, unknown>; waitMs?: number; managedFileImport?: true; writePolicy?: true }): Promise<Record<string, unknown>> {
MISSING	src/core/persistence/page-mutations.ts	1	  try { prepared = await preparePageAdmission(ctx, { ...input, params }); }
MISSING	src/core/persistence/page-mutations.ts	1	    pendingAwareResponse(ctx, await waitForWrite(ctx.engine, prepared.prior, ctx.config, waitMs())), true);
MISSING	src/core/persistence/page-mutations.ts	1	  return withPostWriteEnrichment(ctx, input.operation, row, withWritePolicyReport(ctx, input.operation, // Fork: policy report + remote enrichment
MISSING	src/core/persistence/page-mutations.ts	1	  input: { operation: string; params: Record<string, unknown>; managedFileImport?: true; batch?: PageBatchMember; writePolicy?: true }
MISSING	templates/bootstrap/template-repo/README.md	1	<!-- gbrain-template-stamp: 0.60.102.1 -->
```
</details>

## 4. src/commands/takes.ts 逐檔比對

- 上游 `merge-base..v0.60.360.0` 動過此檔的 commit 有 9 個:401c7c3cd(GBRA-130 A-25 失敗頁後排 / --failed / --retry-failed)、16948de68 / fae30e8d7 / 726d5f28d / 164feeb11(W7 forecast journal、takes journal、scorecard group_by、take horizons)、ae48f8b84 / d024e783f(W6 takes grades)、7833f7f40(embedding_query_prefix #3783)、fa39cccaa(rebuild 與 serve 共存 W9F item 8)。
- 上游在此區間淨新增 238 行:**HEAD 中缺 0 行**。
- 上游在此區間淨刪除的行:**在 HEAD 重新出現 0 行**(沒有把上游修正改回去)。
- 目標 tag 的行在 HEAD 消失的只有 2 行,都是 import 被擴充:`existsSync` → `existsSync, readFileSync`、`BrainEngine` → `BrainEngine, TakeKind`。
- `diff(merge-base..fork 對 takes.ts 的 +/- 行, v0.60.360.0..HEAD 對 takes.ts 的 +/- 行)` **完全相同**:fork 帶進的改動與上一代逐字一致(+201/-2),沒有多也沒有少。
- 唯一衝突是 help 文字,兩邊並存(上游 `--failed` / `--retry-failed`、fork `--apply-review`);`--apply-review` 的 dispatch 位於上游 editFlags 檢查之後、`--accept` 分支之前。

## 5. 測試對照

### bun run verify
- 第一次(預設每項 120s 上限):`EXIT=1`,`verify failed: 4/88` — `typecheck`(TIMED OUT after 120s)、`check:doc-history`(KEY_FILES.md 10183 > 10000 bytes)、`check:page-body-readers`(validate.ts:367)、`check:regen-all`(operation manifest stale)。
- 修正 commit `1f7a89d33` 後第二次(預設):`EXIT=1`,`verify failed: 1/88`,`Failed: typecheck`(TIMED OUT after 120s)。
- 第三次 `GBRAIN_VERIFY_TIMEOUT=400 bun run verify`:`EXIT=0`,`[verify-parallel] elapsed=196s | pass=88 fail=0 skip=0 | all checks green`(typecheck 182s)。typecheck 超時是 4 核沙箱的時間問題,不是型別錯誤;單獨跑 `bun run typecheck` 每次 rc=0。

### 單元測試
- 依指示執行 `bun test > /tmp/units.txt 2>&1`(單一行程、DATABASE_URL 未設定)。**跑了 2 小時仍未結束,被背景任務的時間上限(最大值)砍掉,沒有 exit code。** 被砍前到達 208 個測試檔,記錄到 85 個檔、222 個 `(fail)`。部分輸出保存在 `/tmp/claude-0/units-partial.txt`(沙箱內,不會保留)。
- 因為完整套件在這個環境跑不完,歸因改用:把這 85 個有失敗的檔,**每檔獨立一個 bun test 行程**,在本分支與乾淨上游 `v0.60.360.0` worktree 上各跑一次,比較失敗數(結果見下)。這只覆蓋「單行程 run 中已出現失敗的檔」,不是完整套件。

| 範圍 | fork(本分支,修正前 `1f7a89d33`) | 乾淨上游 `v0.60.360.0` | fork 獨有 |
|---|---|---|---|
| 85 個檔、每檔獨立行程 | 12 fail(4 檔) | 10 fail(2 檔) | 2 |

- 兩邊都失敗(環境性,上游本身就失敗):`test/bootstrap-dispatcher.serial.test.ts` 8 個(兩邊失敗的 test 名稱逐一相同)、`test/cli-thin-client-refusal-matrix.test.ts` 2 個(golden 期望 `ECONNREFUSED:` 字樣,這個 bun 1.4.2 / 沙箱給的錯誤字串沒有)。
- **fork 獨有 2 個,已修**(`51973a38e`):
  - `test/eligibility-registry.test.ts`:上游新的 ENG-14 read-trust 表要求每個 read op 都登錄;`get_write_contract` / `validate_page` 登錄為 `labeled`(= 未登錄 op 的執行期預設,行為不變)。
  - `test/cli-goldens.test.ts`:`--tools-json` golden 多出兩個 op 與 `bypass_policy`(刻意的變化,只對這個檔用 `GBRAIN_TEST_UPDATE_GOLDENS=1` 重產)。
  - 修正後這兩個檔重跑:8/8、3/3 pass。修正後 fork 失敗數 = 10 = 乾淨上游。
- 單行程 run 的 222 個失敗,在每檔獨立行程下除上述 12 個外全部消失 → 是單一 `bun test` 行程內跨檔共享狀態的污染(上游自己的 fast loop 本來就分片跑),不是 fork 造成。但**沒有在乾淨上游上跑同樣的單行程 run**(時間不夠),所以這個說法沒有對照組。
- 上一代參考數字(對 0.60.102):fork 112 / 乾淨上游 114、fork 獨有 0。本次數字口徑不同(85 個檔的子集),不能直接比較。

## 6. 沒驗到什麼 / 待人判斷

### 沒驗到
- **Postgres E2E 全部沒跑**(這個沙箱沒有 DATABASE_URL / docker),包括 fork 的 `test/e2e/write-policy-postgres.test.ts`、`test/e2e/post-write-enrichment-postgres.test.ts`,以及上游需要 Postgres 的 golden(schema-catalog / doctor-json)。
- **preadmit cache 路徑沒有測試覆蓋**:`59f736366` 修的是只在 Postgres + `persistence.preadmit_cache` 開啟時才走的路徑(cached ctx 與 retry ctx)。修正是讀碼推論,沒有測試在該路徑上斷言 `policy` 回報存在,也沒驗證 policy refusal 在 retry 路徑的行為。
- `post-write-enrichment` 在新的 `runLinksTimelinePass` 簽名下(budgetLeft / log)沒有實機跑過 worker;只有單元測試(PGLite)。
- `--propose-include/-exclude/-limit` 與上游新增的「失敗頁後排 / 持有失敗頁」(GBRA-130 A-25)交互:沒有專門測試。上限計數只算 cache_hits + cache_misses,被上游 hold 的頁面是否計入沒有確認。
- 完整單元套件(`bun test` 全部)沒有完成過,只驗了 85 個檔;其餘 `.serial` / `.slow` 與未到達的檔沒有獨立跑。
- 沒有部署、沒有對真實 brain 跑過 dream / takes / put_page。
- Contract goldens(`bun run regen:all --goldens`)沒有重產;若 fork 的 op 影響這些 golden,只會在對應測試失敗時顯現(見第 5 節)。

### 待人判斷
0. **`get_write_contract` 的 read-trust 類別**:它只回傳 repo `gbrain.yml` 裡的政策,不回儲存的記憶文字,大概可以是 `text_free`(對有 trust floor 的連線放寬)。目前保守登錄為 `labeled`(與未登錄時相同)。`validate_page` 會讀既有頁的 frontmatter,保持 `labeled`。
1. **put_page 被 policy 拒絕時仍記一次 `save` funnel event**:上游的 `funnelPassThrough('save')` 套在 `submitPageMutation` 的結果上,而 fork 的拒絕是 resolve 成 `{error, written:false}` response 而非 throw。是否要在拒絕時跳過 funnel 計數,需要決定。
2. **fork 的 key-files 頁搬出 `key-files/`**:上游 `KEY_FILES.md` 在 v0.60.360.0 已是 9983/10000 bytes,且 `test/docs-navigation.test.ts` 要求每個 `key-files/*.md` 都在索引中出現,所以無法再加路由列。目前搬到 `docs/architecture/fork-write-policy.md`、由 fork 自有的 guide 連結。替代方案是壓縮某條上游列騰出空間(會增加 rebase 衝突面)。
3. **page-body-readers 新增一列 `NONE`**:上游 ratchet 規定「新 reader 不給 row」,但 `NONE` 的定義是「這個名字不是 page body」。validate.ts 讀的是 agent 送進來的 payload 字串(必為 inline),不是儲存的 page row,所以用 NONE + 註記。是否接受此解釋需要判斷。
4. **post-write-enrichment 的 `log` 接到 `console.error`**:sweep 本身預設是 no-op;選 stderr 是為了在 worker log 看得到 per-page 拒絕。
5. **verify 的 typecheck 在預設 120s 上限下逾時**(4 核沙箱);400s 下全綠。CI 機器上是否會逾時未知。

## 進度
- 已重放:23/23(全部已 push)+ 3 個 `fix(rebase-v0.60.360)` 修正 commit:`59f736366`(policy 回報 ctx key)、`1f7a89d33`(verify 新 gate)、`51973a38e`(新 contract 表 / golden)。
- 未處理:無。
- 分支:`javan/rebase-v0.60.360`,版本 `0.60.360.1`,基於 `v0.60.360.0`。未開 PR、未部署、未動 `master` / `javan/rebase-v0.60`。
