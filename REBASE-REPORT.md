# Rebase report: fork patchset → upstream v0.60.360.0

> 候選分支,非定版。需要判斷的地方標記為「待判」。

## 1. 上游目標
- 目標 tag:`v0.60.360.0`(`ea5ac03fe`,2026-10-22 01:08Z,fetch 時最新 tag)
- fork 來源:`origin/javan/rebase-v0.60`(0.60.102.1)
- merge-base:`5b5891069` = `v0.60.102.0`
- fork commits above merge-base:23;upstream commits since merge-base:5985

## 2. Fork patch 清單

23 個 fork commit 全部處理,0 個退役、0 個略過。另新增 4 個 `fix` commit:`59f736366`(policy 回報 ctx key)、`1f7a89d33`(上游較新的 verify gate)、`51973a38e`(上游新 contract 表 / golden)、`e2bbe380c`(被拒絕的寫入不算 funnel save)。

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

### 完整單元套件對照(補跑)— **放棄,環境跑不完**

四次嘗試全部被環境上限砍掉,沒有一次產出完整套件的對照數字:

| # | 做法 | 結果 |
|---|---|---|
| 1 | `unset DATABASE_URL; bun test`(單行程全檔) | 背景 2 小時上限被砍,無 EXIT;截斷前累計 187 個 `(fail)` |
| 2 | `GBRAIN_TEST_SHARD_TIMEOUT=3600 bun run test` | 4 個 shard **全部** `exit=124` / `WEDGED`;砍前 0–21 秒內都還有進度 → 是跑不完,不是卡死 |
| 3 | `SHARD_TIMEOUT=14400` | 起跑後發現自己在過期 commit 上(分支同時被推了 `51973a38e` 等),自行中止重啟 |
| 4 | `SHARD_TIMEOUT=14400`,在當時 tip | 跑約 20 分鐘後 run 撞 five_hour rate limit 中止(`is_error=true`,turns=52,duration=13434s) |

**結論:這個 4 核雲端沙箱跑不完本套件,不要再試第五次。** 完整套件要在 Mac mini 上跑
(SOP 實測約 29 分鐘),開 worktree、帶 `GBRAIN_TEST_SHARD_TIMEOUT=3600`,且**不要切
`~/gbrain` 的分支**(那個 checkout 是 `bun link` 生產環境)。

歸因結論仍然成立,因為它不依賴完整套件:第 5 節上半的逐檔對照已證明 **fork 獨有失敗 = 0**
(85 個有失敗的檔,每檔獨立行程,兩邊各跑一次)。完整套件只會補上「總數」,不會改變歸因。

## 6. 沒驗到什麼 / 待人判斷

### 沒驗到
- **Postgres E2E** — 寫本報告時全部沒跑(那個沙箱沒有 DATABASE_URL / docker)。**2026-10-29 部分補驗**:fork 的兩個已在本機 Postgres 上跑過並通過,`test/e2e/write-policy-postgres.test.ts` 與 `test/e2e/post-write-enrichment-postgres.test.ts`,5 pass / 0 fail(`DATABASE_URL=postgresql:///gbrain_test`,以文件指定的一次性 `GBRAIN_TEST_ALLOW_DATABASE_URL=1` opt-in 通過執行層 guard,未 export)。確認它確實連上 Postgres 而非靜默跳過:`gbrain_test` 被建出 151 張表,且生產 `gbrain` 的 live page 數不變。**上游需要 Postgres 的 golden(schema-catalog / doctor-json)仍然沒跑** —— 不在 fork 子集範圍內,不要把本項當成全部驗完。
- **preadmit cache 路徑沒有測試覆蓋**:`59f736366` 修的是只在 Postgres + `persistence.preadmit_cache` 開啟時才走的路徑(cached ctx 與 retry ctx)。修正是讀碼推論,沒有測試在該路徑上斷言 `policy` 回報存在,也沒驗證 policy refusal 在 retry 路徑的行為。
- `post-write-enrichment` 在新的 `runLinksTimelinePass` 簽名下(budgetLeft / log)沒有實機跑過 worker;只有單元測試(PGLite)。
- `--propose-include/-exclude/-limit` 與上游新增的「失敗頁後排 / 持有失敗頁」(GBRA-130 A-25)交互:沒有專門測試。上限計數只算 cache_hits + cache_misses,被上游 hold 的頁面是否計入沒有確認。
- 完整單元套件(`bun test` 全部)沒有完成過,只驗了 85 個檔;其餘 `.serial` / `.slow` 與未到達的檔沒有獨立跑。
- ~~沒有部署~~ — **2026-10-29 更正:已部署並在生產上跑了約一週**(見檔尾「進度」的更正段)。對真實 brain 的實際使用也已累積:`put_page` / `edit_page` / `add_timeline_entry` / `delete_page`(軟刪除)在 2026-10-27~29 多次成功,`trust confirm` 20 筆、`trust scan` 1150 筆。
  **仍然沒驗到的是 `dream` 與 `takes`** —— 這兩條路本報告寫作至今都沒有對真實 brain 跑過。
  另外在生產上發現一個與本次 rebase 無關的既有缺陷:`pages purge-deleted` 的物理 `DELETE` 一律失敗(42501,JAV-259);該 brain 歷史上從未成功 purge 過,不是本次升級造成。
- Contract goldens(`bun run regen:all --goldens`)沒有重產;若 fork 的 op 影響這些 golden,只會在對應測試失敗時顯現(見第 5 節)。

### 待人判斷 — **2026-10-22 已由 Javan 裁決**

0. **`get_write_contract` / `validate_page` 的 read-trust 類別** → **維持 `labeled`**。
   改成 `text_free` 是放寬存取,而目前沒有連線因此被擋(沒有實際需求);`labeled` 等於未登錄時的
   執行期預設,維持它表示這次 rebase 對行為零影響。若日後有 thin client 讀不到契約,帶當時的
   錯誤訊息再改。
1. **`put_page` 被 policy 拒絕時仍記一次 `save` funnel event** → **已修**(`e2bbe380c`)。
   上游 ratchet 自己的註記是「a **committed** put_page records a save」
   (`scripts/module-size-limits.tsv` D8 funnel 列),所以這是回到上游語意,不是新增 fork 行為。
   `funnelSaveUnlessRefused` 放在 fork 自有的 `write-policy/mutation-gate.ts`,上游
   `ops/pages.ts` 的足跡仍是一行呼叫(淨 −1 行)。測試可鑑別:舊行為下失敗
   (`Expected - 0 / Received + 1`),修正後 25 pass / 0 fail;`bun run typecheck` EXIT=0。
   同檔另有 2 個失敗(`funnel-cli.test.ts`)經 stash 對照確認為 **pre-existing**。
2. **fork 的 key-files 頁搬出 `key-files/`** → **維持搬出**。壓縮上游列會增加每次 rebase 的
   衝突面,而 fork 自有頁的全部價值就是「上游 rebase 永不在它上面衝突」。
3. **`page-body-readers` 新增一列 `NONE`** → **接受此解釋**。`validate.ts` 讀的是 agent 送進來的
   payload 字串(必為 inline),不是儲存的 page row,所以不會遇到 segmented page 的
   `page_body_segmented`;註記已寫在該列。
4. **post-write-enrichment 的 `log` 接 `console.error`** → **接受**。stdout 留給資料是專案慣例,
   診斷走 stderr。代價是非結構化,將來要統計拒絕率得自己 parse log(目前無此需求)。
5. **verify 的 typecheck 在預設 120s 上限下逾時** → **不處理,降為已知環境事實**。這個 fork
   用分支交付、不開 PR、沒有 CI(`origin/master` 停在 0.37.8.0 且早已分岔),所以「CI 會不會
   逾時」是空問題;本機跑 verify 不會遇到,那是 4 核沙箱的時間問題。

## 7. 上游投稿檢查(2026-10-29)

專案頁 `projects/gbrain-fork-maintenance` 的「Open upstream contributions」要求每次 review
都檢查一輪。這次的結果:**沒有適合提 PR 的項目,一個都沒提。**

判準沿用該頁記錄的 #4197 形狀:**one line, a pure defect, and a table of measured
before/after across every environment combination**。

| 候選 | 查證結果 | 結論 |
|---|---|---|
| JAV-258 空的 `storage.db_only: []` 讓整份 gbrain.yml 被退掉 | 搜過 `db_only` / `storage.db_only` / `db_tracked`,**沒有對應的上游 issue**。但上游 `src/core/storage-config.ts` 的 `hasUnresolvedDbOnlyDeclaration` docstring 明寫:*"Known false positive: an intentionally empty `db_only: []` also counts, since it resolves to the same empty config."*(確認於 upstream/master `968f73708`,2026-10-29 07:27) | **不提**。上游已知並刻意接受,這不是缺陷報告 |
| JAV-259 `purge-deleted` 撞 42501 | 上游 #7636(open, triage:bug-verified)已涵蓋同一個 guard | **不提**,會重複 |
| JAV-264 guard 函式 `search_path` 缺 `pg_temp` | 上游 #7632 已經在修 | **不提**,會重複 |
| 四條主線與上游現行機制的重疊 | **已於 2026-10-29 逐 patch 比對完畢(見下方「四條主線的重疊比對」)**。結論:四條都沒有被上游取代,其中兩條適合提 PR | **兩條可提**,見下 |

一個保留:JAV-258 上游記為「known false positive」,但實際破壞力比那句話暗示的大 ——
它讓**整份** `gbrain.yml` 被退掉,連 `storage.db_tracked` 一起,九個目錄全部失效。
這個「嚴重性落差」可以當 issue 提,但不符 #4197 形狀,2026-10-29 由 Javan 裁決**不提**。


### 四條主線的重疊比對(2026-10-29)

方法:`git diff upstream/master...HEAD -- src/`(30 檔、+2230 行)逐條對上上游的現行實作,
每個「上游沒有」的結論都跑過陽性對照(確認路徑存在、grep 在該檔會命中、同族 key 查得到)。

| 主線 | 上游現行機制 | 重疊 | 可提 PR? |
|---|---|---|---|
| **write-policy**(`src/core/write-policy/*`,9 檔) | `src/core/write-gate*`(6 檔 + migration v227)是**提示注入偵測器**,按 trust tier 路由、model-free pattern table,判 allow/flag/quarantine/reject | **零**。上游管「這段文字可不可信」,我們管「這頁的 frontmatter 合不合源的契約」(required_fields、type_path_rules、slug_rules、language_rules)。上游沒有 `ops/write-contract.ts`、沒有 `get_write_contract` / `validate_page` op | ❌ 太大。9 檔 2 千行、帶新 op 與新 config,不符 #4197 的 one-line-defect 形狀。要提得先拆成 proposal issue |
| **post-write-enrichment** | `enrichment-service.ts` + `minions/handlers/enrich.ts` 存在,但**沒有任何寫入路徑會排這個 job**(對照組:同三個檔 grep `page` 各 91/219/95 命中,所以不是 grep 失效) | 我們的 job **呼叫上游自己的** `sweep.ts:runLinksTimelinePass`,不是另一套實作 | ❌ **不提(2026-10-29 issue 查證後翻案)**。上游 **#5499**(closed/completed 2026-10-01)就是這個缺口的完整回報,結論是修 sweep 本身,不是改觸發方式:#5747(v0.60.11.0)修好 facts-fence pass,而 `sweep.ts:571-587` 現在也走 `publishManagedPageTimeline` / `maintenanceTransaction`,managed 寫入不再被拒。`serve --http` 不自掃是**刻意設計**,上游的答案是 host 跑 `gbrain sweep --once` cron。我們的 per-write job 是**另一種設計取向**(自動 vs 運維 cron),不是缺陷 —— 不符 #4197 形狀。先前一輪曾把這條列為「最強候選」,那是只讀了上游程式碼註解、沒查 issue 的結論 |
| **propose_takes 模型路由** | 上游 `models.dream.*` 已有 synthesize / extract_atoms / patterns / synthesize_verdict / triage;`phase-config-values.ts` 只給 propose_takes 一個 timeout key,**沒有 model key** | 我們的 `models.dream.propose_takes` 疊在上游 `opts.model ?? getChatModel()` 之上 | ✅ **第二候選**。完全照上游既有命名慣例補一個缺的格子;上游 `behavior-change-notice.ts` 的 `0.60.249.0` 顯示他們正在逐 phase 補這類路由,方向一致 |
| **takes --apply-review** | 上游 `acceptProposal` / `rejectProposal` 已是唯一的 queue→canonical 路徑,一次一個 id | 核心**是**上游的,我們只加批次化(讀 JSON 決策檔、部分失敗不中止、exit code 反映半套套用) | ⚠️ 可提但價值薄。純 UX 批次糖,不是缺陷修復;上游可能偏好自己設計 CLI 形狀 |

**維護結論:四條都要繼續扛,但只有一條適合提 PR。**

- 沒有任何一條被上游取代,所以下次 rebase 的 patch 數不變。
- **可提:只剩 propose_takes 的 model key。** post-write-enrichment 在查過 issue 之後翻案(見上表)。
- 風險最低的是 post-write-enrichment:它重用上游自己的 pass,而上游的 host-cron 方案已經可用,
  所以哪天想丟掉它,改設一條 `gbrain sweep --once` cron 就能等價替代。
- 風險最高的是 write-policy(9 檔獨立子系統,上游 write-gate 若往 frontmatter 契約方向長就會撞上)。

**方法教訓:讀上游程式碼不等於查過上游 issue。** 上表第一版把 post-write-enrichment 評為
「最強候選」,憑的是上游 op description 裡自承的缺口;一查 issue 就看到 #5499 已經完整回報、
已經修、而且修的是另一個地方。專案頁的「提之前先確認有沒有相關 issue」就是為了擋這個。


### 方法註記

第一輪搜尋用了五個多詞查詢(例如 `write policy frontmatter required fields`),**五個全部零命中**。
`gh search` 的多詞是 AND,幾乎不可能全中。用一個已知會命中的詞當控制組驗過搜尋工具正常之後,
改用單詞重查就有結果了。**零命中不等於上游沒有** —— 先驗證工具,再相信負面結果。

## 進度
- 已重放:23/23(全部已 push)+ 5 個 `fix` commit:`59f736366`(policy 回報 ctx key)、`1f7a89d33`(verify 新 gate)、`51973a38e`(新 contract 表 / golden)、`e2bbe380c`(拒絕不算 funnel save,2026-10-22 裁決後補)、`9109b76b8`(gate `commit_page_upload` 的 staged page body,JAV-248,2026-10-23 —— 本報告原寫「4 個」,漏了這筆)。
- 第 6 節六個待判斷項**已全部裁決**(見該節)。完整套件對照**放棄**(雲端環境跑不完,見第 5 節),歸因結論不受影響。
- 未處理:無。
- 分支:`javan/rebase-v0.60.360`,版本 `0.60.360.1`,基於 `v0.60.360.0`。未開 PR、未動 `master` / `javan/rebase-v0.60`。
- **2026-10-29 更正:已部署。** 上一行原本寫「未部署」。那是 2026-10-22 16:40 的狀態,部署發生在那之後而本報告沒跟上 —— 這句過時陳述在 2026-10-29 誤導過一個 session,使它準備去執行一個不存在的部署。現況證據(當日獨立查核,兩個 session 交叉確認):
  - `gbrain --version` → `0.60.360.1`
  - `which gbrain` → `~/.bun/bin/gbrain`,symlink 到工作區的 `src/cli.ts`。**所以切換本 repo 的分支即生效,沒有另外的「部署」動作**
  - `http://127.0.0.1:3131/health` → `version` / `installed_version` 皆 `0.60.360.1`,`restart_pending: false`
  - `gbrain apply-migrations --dry-run` → schemaVer 264 / latest 264,pending 空
  - DB `config.version` = 264;origin 與本機 HEAD 皆 `9109b76b8`
  - rollback 路徑:`gbrain-pre-promote-0.60.360-quiesced-20261022-221903.dump` + 分支 `javan/rebase-v0.60`
