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
(待做)

## 4. src/commands/takes.ts 逐檔比對
(待做)

## 5. 測試對照
(待做)

## 6. 沒驗到什麼
(待做)

## 進度
- 已重放:23/23(加 1 個修正 commit)。全部已 push。
- 未處理:無。稽核與測試進行中(第 3–6 節)。
