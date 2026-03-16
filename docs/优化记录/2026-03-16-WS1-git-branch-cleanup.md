# WS1 Repo Hygiene：清理无用本地分支与 worktrees（降低分支噪声）

**日期**：2026-03-16  
**Workstream**：WS1 Repo Hygiene  
**范围**：git branches / git worktrees（仅本地）  
**风险等级**：D（不改代码；但属于不可逆的仓库操作，需要证据链与回滚线索）  
**目标**：可维护性 / 体量控制  
**关联计划**：`docs/plans/2026-03-16-repo-optimization-design.md`  
**关联提交**：N/A（本阶段主要为 git housekeeping；仅文档沉淀会产生 commit）  

## 背景

仓库在多轮并发 workstream 与试验过程中积累了大量本地分支与 worktree：

- 分支过多会显著降低信噪比，影响新成员理解与日常切分支效率。
- 部分分支虽然 `--no-merged`，但其 patch 已通过 cherry-pick/等价提交进入 `main`，属于“历史遗留指针”，保留价值低。
- 部分 worktree 已无未提交改动，属于可回收的磁盘占用与噪声来源。

因此需要做一次“可审计的本地分支清理”，只删除真正无用的分支，并留下可恢复线索。

## 本阶段策略与约束（证据链）

仅清理本地（local）分支，不直接删除远端（origin）分支；远端删除需要额外确认。

删除判定必须满足以下之一：

1. **已合并进 main**：`git merge-base --is-ancestor <branch> main` 为真（或 `git branch --merged main` 包含该分支）。
2. **未合并但无独立价值**：`git cherry main <branch>` 中 `+`（unique patches）数量为 0，说明其提交 patch 已等价进入 `main`，该分支仅是“重复指针”。  
   - 注意：这种分支用 `git branch -D` 删除（因为 git 无法判定“已合并”）。

此外，worktree 清理必须满足：

- `git -C <worktree> status --porcelain` 为空（无未提交改动、无未跟踪文件），避免误删工作目录。

## 执行结果（本地）

### 1) 已删除的本地分支（不再需要保留）

已合并/或 patch 等价已进入 `main`：

- `codex/backend-ruff-cleanup-20260316-main`（was `15c8a87f`）
- `codex/bootstrap-soul-core-20260316`（was `f358ab71`）
- `codex/frontend-eslint-cleanup-20260316-main`（was `554668cd`）
- `codex/openviking-context-fs`（was `c8710f5d`）
- `codex/openviking-context-fs-impl-20260316`（was `fc8e7e7e`）
- `codex/ws3-backend-hotspots-main-sync-20260316`（was `2b114cbd`）
- `wip/main-dirty-20260316`（was `82856db1`）
- `codex/backup-main-before-drop-workflow-20260316`（was `c4d9718e`）
- `codex/fix-default-agent-memory-diagnostics`（was `99a201dc`）
- `codex/ws0-guardrails-20260316-main`（was `5e90fc22`）
- `codex/backend-dir-refactor-20260316`（was `b3270f78`）
- `codex/evolution-heartbeat-closure-fix`（was `0f462cf4`）
- `codex/hold-main-worktree-20260316`（was `3ae25943`）
- `codex/mcp-persistence-modal-20260316`（was `a747972e`）
- `codex/frontend-eslint-cleanup-20260316`（was `557fce6d`）
- `codex/ws0-guardrails-20260316`（was `352db3b5`）
- `codex/ws1-hygiene-candidates-20260316`（was `6ba1f531`）
- `codex/ws3-backend-hotspots-20260316`（was `41c4a4db`）

### 2) 已移除的 worktrees（目录回收）

在确认无改动后，移除以下 worktree 目录（均为本仓库内部 `.worktrees/` 或历史临时 worktree 路径）：

- `.worktrees/codex-backend-dir-refactor-20260316`
- `Nion-Agent.wt/evolution-heartbeat-closure-fix`（如存在）
- `.worktrees/codex-frontend-eslint-cleanup-20260316`
- `.worktrees/codex-bootstrap-soul-core-20260316`
- `.worktrees/codex-mcp-persistence-modal-20260316`
- `.worktrees/codex-ws0-guardrails-20260316`
- `.worktrees/codex-ws1-hygiene-candidates-20260316`
- `.worktrees/codex-ws3-backend-hotspots-20260316`

## 当前保留的分支（原因）

清理后本地仅保留：

- `main`：主干
- `codex/backend-ruff-cleanup-20260316`：仍有未提交改动（worktree 内 `status --porcelain` 非空），不能删除
- `codex/openviking-context-fs-task1-20260316`：存在 `git cherry` 的 `+` 提交（unique patches > 0），不能删除
- `estimated-marmoset`：外部 worktree（不在本仓库目录内），默认不动；如确认不用可再专项清理

## 验证证据（必须）

本阶段采用的证据链命令（示例）：

- 分支与 worktree 盘点：`git worktree list`、`git branch --merged main`、`git branch --no-merged main`
- “是否为重复指针”判定：`git cherry main <branch>`（关注 `+` 数量）
- worktree 安全检查：`git -C <worktree> status --porcelain` 必须为空

## 回滚/恢复线索

分支删除后如需恢复（仅限本地），可使用“原分支最后 SHA”重新创建分支指针：

```bash
git branch <branch-name> <sha>
```

例如：

```bash
git branch codex/ws0-guardrails-20260316 352db3b5
```

> 说明：对于 `git cherry` 判定为“patch 已进入 main”的分支，即使不恢复分支指针，也不会丢失主干能力；恢复更多是为了追溯历史与审计。

## 遗留问题与下一步

- 是否需要同步删除 GitHub `origin` 上的已合并远端分支：需要明确删除范围与审批（建议仅限 `origin/codex/*` 且仅删除已合并到 `origin/main` 的分支）。
- 待 `codex/backend-ruff-cleanup-20260316` 的未提交改动处理完（提交并合并或丢弃）后，再回收对应 worktree 与分支。

