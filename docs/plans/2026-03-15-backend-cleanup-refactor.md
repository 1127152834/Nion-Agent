# Backend Cleanup + Refactor Implementation Plan (Nion-Agent)

> 本计划用于指导本次“backend 清理 + 重构”工作在隔离 worktree 分支中可控落地、可回滚推进。
>
> 执行分支: `codex/backend-cleanup-refactor-20260315`  
> 执行目录: `.worktrees/codex-backend-cleanup-refactor-20260315/`

**Goal:**  
1) 清理 `backend/` 下历史遗留的误放/噪声内容（尤其是误放的前端代码）。  
2) 在不回流 `config.yaml` 为运行时真源的前提下，做一次“后端工程结构与运行时路径策略”的小步重构，使 backend 更符合桌面端/服务端两用的长期演进方向。  

**Architecture (High Level):**  
- 后端仍保持现有的 Gateway + LangGraph Agent Runtime 架构，不引入 Harness/App 大拆分。  
- 配置以“页面设置 + Config Store（SQLite）”为真源；文档与实现保持一致。  
- 运行时数据目录策略调整为默认落到用户目录（`$HOME/.nion`），仅在显式设置 `NION_HOME` 时使用自定义路径。  

**Tech Stack:** Python 3.12 + FastAPI + LangGraph + `uv` + `pytest`，前端为 Next.js + TypeScript + pnpm。

---

## 关键约束
- 禁止将 `config.yaml` 重新变成运行时真源；任何配置读取都应以 Config Store 为主（SQLite）。  
- 品牌保持 Nion；避免引入 `nion` 命名或路径残留（已有历史兼容别名除外）。  
- 所有变更必须小步提交（每次修改后 commit），并在 commit message 中记录验证命令与结果摘要。  

## 当前现状（重构前）
1. `backend/` 下曾出现误放的前端代码目录 `backend/frontend/`（Embedding settings UI + API client）。  
2. `Paths.base_dir` 当前包含 “本地 dev 回落到 `cwd/.nion`（当 cwd 在 backend/）” 的策略，导致运行时数据可能写入仓库目录。  
3. 配置存储实现已是 SQLite Config Store，但文档仍残留 `config.yaml` 作为“主配置源”的叙述（需要纠正）。  

## 按提交拆分的执行计划
说明: 下面的“已完成/待执行”以本分支为准。每个任务对应 1 个本地提交，必要时再细拆。

### 已完成: Backend 清理与基础门禁
- `chore(git): ignore .worktrees to keep repo clean`
  - 目的: 避免 worktree 目录污染 git status。
- `sync(frontend): move embedding settings out of backend (delete backend/frontend)`
  - 目的: 移除 backend 中误放的前端代码；迁移到真正的 `frontend/src/...` 并通过 TS typecheck。
- `chore(backend): tighten .gitignore for local caches`
  - 目的: backend 局部忽略 `.pytest_cache/`、`.ruff_cache/`、`.venv.*` 等常见噪声目录。

### 待执行 1: `refactor(paths): default app data dir to $HOME/.nion (keep NION_HOME override)`
**Intent:**  
避免运行时数据默认写入仓库目录（例如 `backend/.nion`），降低误提交/误清理风险，并使桌面端与服务端路径策略一致。

**Implementation:**  
- 修改 `backend/src/config/paths.py`:
  - 删除/调整 `cwd/.nion` 的默认回落策略。
  - 保留 `NION_HOME` 环境变量覆盖能力（显式指定时仍可写入任意目录，含项目内目录）。  
- 新增/更新单测:
  - 覆盖 base_dir 优先级: `constructor base_dir` > `NION_HOME` > `$HOME/.nion`。

**Acceptance:**  
- 新开干净 checkout 并运行后端，不会在仓库内生成 `.nion/` 目录（除非显式设置 `NION_HOME`）。

**Verification:**  
- `cd backend && uv run pytest -q`

### 待执行 2: `docs(config): document Config Store + UI settings; deprecate config.yaml as source of truth`
**Intent:**  
文档必须与现实一致：运行时配置来自页面设置 + Config Store，而不是 `config.yaml`。

**Implementation:**  
- 更新以下文档的关键段落（不需要重写全文）:
  - `backend/docs/ARCHITECTURE.md`
  - `backend/docs/CONFIGURATION.md`
- 统一口径:
  - `config.yaml` 仅作为历史遗留/示例，不作为运行时真源。
  - 指向 Config Store（SQLite）及对应前端设置入口（如有）。

**Verification:**  
- `rg -n \"config\\.yaml\" backend/docs`（确保只在“历史/弃用/示例”语境出现）
- `cd backend && uv run pytest -q`

### 待执行 3（可选）: `refactor(imports): reduce package init side effects; remove test-time import mocks`
**Intent:**  
减少导入副作用与循环依赖，让测试不再依赖 `conftest.py` 的 `sys.modules` 预 mock 才能导入核心模块。

**Implementation (原则):**  
- 以“延迟导入 + 拆分模块边界”为主，不引入复杂抽象。  
- 优先级:
  1) 清晰的循环依赖链路（例如 subagents/executor 与 agents/lead_agent 之间）  
  2) `__init__.py` 里的重导出引发的导入时副作用  
- 最终目标:
  - `backend/tests/conftest.py` 不再需要注入 `sys.modules[\"src.subagents.executor\"]` 之类的 mock。

**Verification:**  
- `cd backend && uv run pytest -q`

## 最终验收门禁（本分支必须通过）
- 后端: `cd backend && uv run pytest -q`
- 前端: `pnpm -C frontend exec tsc --noEmit`

## 风险与回滚
- 路径策略变更可能影响本地开发者已有数据目录；需要在 README/文档中明确迁移方式:
  - 若需要仍写入项目内目录: `export NION_HOME=$(pwd)/backend/.nion`（或其他路径）  
- 回滚策略:
  - 每个任务 1 commit，可按 commit 粒度 `git revert` 回退，不做不可逆迁移。

