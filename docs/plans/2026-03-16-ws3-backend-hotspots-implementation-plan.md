# WS3 Backend Hotspots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在不改变对外契约的前提下，对 backend 的热点超大文件做“小步可回滚”的可维护性治理：先做热点盘点与证据沉淀，再完成第一批低风险重构（优先 B 级），并保证门禁证据齐备。

**Architecture:** 采用“Characterization Tests + 内部抽取 + 薄化入口”的方式：先用现有测试钉住行为，再把 router/service 中的纯逻辑抽到可复用的小函数/小模块，减少单文件规模与耦合；每个提交可独立回滚，并在 `docs/优化记录/` 记录证据链、验证证据与回滚点。

**Tech Stack:** Backend `ruff` / `pytest` / `pytest-cov`（可选）/ `vulture`（仅线索）；辅助 `rg` / `find` / `wc -l` / `git log`；统一门禁优先 `make verify-backend`。

---

## 范围与约束（Scope Freeze）

### 范围（本阶段聚焦）

- 仅治理 `backend/`（优先 B 级模块与“对外契约不变”的内部抽取）。
- 优先目标：`backend/src/retrieval_models/service.py`（大文件且已有单测护城河）。
- 允许做“结构性重构但不改行为”：抽函数、拆小模块、收敛重复逻辑、补充 characterization tests。

### 非目标（本阶段明确不做）

- 不做 A 级核心域的大手术：Memory/OpenViking、Sandbox、Channels、Scheduler、Gateway 对外契约改动。
- 不做跨目录大搬家（只允许在同域内新增小模块并逐步迁移）。
- 不引入重型依赖或新框架（保持简单、可读、可 debug）。

---

## 产出物（本阶段必须交付）

- `docs/优化记录/2026-03-16-WS3-backend.md`：WS3 阶段执行记录（含热点清单、证据链、验证证据、回滚点）。
- `docs/plans/2026-03-16-ws3-backend-hotspots-implementation-plan.md`：本实施计划（本文件）。
- 至少 1 个“B 级热点文件”的可维护性重构提交（行为不变，测试通过，且可回滚）。

---

## Task 0: 初始化 WS3 优化记录文件（必做）

**Files:**
- Create: `docs/优化记录/2026-03-16-WS3-backend.md`
- Reference: `docs/优化记录/TEMPLATE.md`

**Step 1: 创建记录文件**

- 复制模板结构，填写：日期、Workstream、范围、风险等级、目标、关联计划（本文件 + 模块地图），并写清楚本阶段不做什么（Scope Freeze）。

**Step 2: 提交**

- 仅提交记录文件（不要混入代码改动）。

---

## Task 1: 生成 Backend 热点清单（证据沉淀，先不改代码）

**Files:**
- Modify: `docs/优化记录/2026-03-16-WS3-backend.md`

**Step 1: 生成“超大文件列表”（按行数）**

Run:

```bash
find backend/src -type f -name "*.py" -print0 | xargs -0 wc -l | sort -nr | head -n 40
```

Expected: 输出包含若干 500+ 行文件；将 Top 10 写入优化记录（含行数、路径、风险等级初判）。

**Step 2: 生成“高 churn 列表”（按最近提交触达次数）**

Run:

```bash
git log --since="90 days ago" --name-only --pretty=format: -- backend/src | sed '/^$/d' | sort | uniq -c | sort -nr | head -n 40
```

Expected: 输出前 40 个最常改动文件；将 Top 10 写入优化记录，并标注与“超大文件”是否重叠。

**Step 3: 提交记录更新**

- 只提交 `docs/优化记录/2026-03-16-WS3-backend.md`。

---

## Task 2: 选择首个重构目标并补齐护城河（Characterization Tests）

**Target:** `backend/src/retrieval_models/service.py`

**Files:**
- Modify: `backend/src/retrieval_models/service.py`
- Test: `backend/tests/test_retrieval_models_service.py`

**Step 1: 评估现有测试覆盖（最小检查）**

Run:

```bash
cd backend
pytest tests/test_retrieval_models_service.py -q
```

Expected: PASS（确认已有护城河）。

**Step 2: 补齐缺口（如需要）**

- 若发现本次准备抽取的逻辑没有任何测试覆盖，先新增 1-2 个 characterization tests（通过 public 方法验证输出/错误码），再开始抽取。

**Step 3: 提交（仅测试）**

- 若新增测试：仅提交测试文件（不要同时改实现），保持回滚粒度细。

---

## Task 3: 重构 build_status（拆小方法，行为不变）

**Files:**
- Modify: `backend/src/retrieval_models/service.py`
- Test: `backend/tests/test_retrieval_models_service.py`（必要时补齐）

**Step 1: 先加/补 characterization tests（如需）**

- 覆盖点建议：`build_status()` 的 packs/models_by_family 结构稳定性、normalization_applied 与持久化副作用（已有测试则不重复）。

**Step 2: 最小实现抽取**

建议抽取（保持私有方法、避免新抽象层）：

- `_maybe_normalize_and_persist(cfg, registry) -> bool`：封装 normalization + ConfigRepository 写回（现有行为保持）
- `_build_models_by_family(cfg, registry) -> dict[str, list[dict[str, Any]]]`
- `_build_packs_status(cfg, registry, active_pack_id, active_embedding, active_rerank) -> list[dict[str, Any]]`

**Step 3: 跑定向测试**

Run:

```bash
cd backend
pytest tests/test_retrieval_models_service.py::test_build_status_normalizes_mixed_local_config -v
pytest tests/test_retrieval_models_service.py -q
```

Expected: PASS

**Step 4: 提交（仅重构，行为不变）**

- Commit message 必须写明：无行为变化、验证命令与结果摘要、回滚方式。

---

## Task 4: WS3 阶段收尾（门禁 + 记录）

**Files:**
- Modify: `docs/优化记录/2026-03-16-WS3-backend.md`

**Step 1: 跑后端门禁（新鲜证据）**

Run:

```bash
make verify-backend
```

Expected: PASS

**Step 2: 更新优化记录**

- 写清楚：改了什么（点名方法/文件）、为什么、风险点、验证证据（命令 + 摘要）、回滚点（`git revert <sha>`）。

**Step 3: 提交（仅记录）**

- 只提交 `docs/优化记录/2026-03-16-WS3-backend.md` 的更新。

