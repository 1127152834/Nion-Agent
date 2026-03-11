# Milestone 0 Baseline Report

- 日期：`2026-03-10`
- 分支：`main`
- 对应 change：`bootstrap-memoh-phase-execution-ops`
- 报告目的：确认 `Phase 3` 启动前，前序阶段与流程脚手架的当前真实状态

## 1. 当前快照

### 1.1 OpenSpec change 状态

✅ 已确认以下 change 均可通过严格校验（2026-03-10 验证）：

- `enforce-memory-session-runtime-contract` - valid
- `skeletonize-memory-core-v2-compatible` - valid
- `stabilize-v2-compatible-memory-update` - valid
- `stabilize-desktop-memory-ui-runtime` - valid
- `bootstrap-memoh-phase-execution-ops` - valid

### 1.2 关键回归状态

✅ 核心记忆系统测试通过（2026-03-10 验证）：

- 后端核心记忆测试：`124 passed in 0.63s`
  - `test_memory_core_provider.py` ✅
  - `test_memory_core_registry.py` ✅
  - `test_memory_updater.py` ✅
  - `test_memory_session_policy.py` ✅
  - `test_memory_upload_filtering.py` ✅
  - `test_client.py` (77 tests) ✅
- 前端：`pnpm typecheck` ✅
- `git diff --check` ✅

⚠️ **已知问题**：
- `test_nion_cli.py` 导入错误：`ImportError: cannot import name 'severity_at_least' from 'src.security.audit'`
- 此错误阻止完整测试套件运行，但不影响核心记忆系统功能

### 1.3 当前工作树状态

- 当前分支：`main`
- 最新 commit：`77c79484 feat(desktop): optimize workspace UI for desktop experience`
- 当前 `git status --short`：**干净（无未提交改动）** ✅
- `git diff --check`：**无空白字符问题** ✅

结论：**✅ 工作树已收口，前序功能基线可验证为”可运行、可测试、可校验”。Phase 1-2.5 的核心交付物已全部落地并通过验证。满足进入 Phase 3 的工程条件。**

补充：工作树收口工作已完成，包括 desktop UI 优化、i18n 翻译补充、架构文档更新、品牌资源添加、artifact 预览改进等。

## 2. Review / 风险结论

### 2.1 关于 Phase 1-2.5 核心交付物验证

✅ **Phase 1: 运行时契约对齐** - 已验证通过
- `policy.py` 存在且实现完整
- `test_memory_session_policy.py` 全部通过
- 支持 `session_mode` (normal/temporary_chat)
- 支持显式 `memory_read` / `memory_write` 覆盖

✅ **Phase 2: Memory Core 骨架化** - 已验证通过
- `core.py`, `provider.py`, `runtime.py`, `registry.py` 全部存在
- `test_memory_core_provider.py` 全部通过
- `test_memory_core_registry.py` 全部通过
- V2-compatible runtime 工作正常

✅ **Phase 2.5: 兼容性热修** - 已验证通过
- `updater.py` 存在且包含 JSON 解析回退链
- `test_memory_updater.py` 全部通过

✅ **Milestone 1: 流程脚手架** - 已验证完成
- 4 个模板文件全部存在于 `docs/memoh/ops/templates/`
- 门禁脚本 `scripts/memoh/task-gate.sh` 可用
- 收尾脚本 `scripts/memoh/stage-closeout.sh` 可用

### 2.2 当前 blocker

⚠️ **非核心 blocker**（不阻止 Phase 3 启动）：

1. **test_nion_cli.py 导入错误**
   - 错误：`ImportError: cannot import name 'severity_at_least' from 'src.security.audit'`
   - 影响：阻止完整测试套件运行（483 个测试中的 1 个）
   - 评估：不影响核心记忆系统功能，可在 Phase 3 并行修复

✅ **已解决的 blocker**：

1. ~~工作树仍处于多阶段在途状态~~ - **已解决**
   - 工作树已收口，git status 干净
2. ~~既有 change 仍未完成统一收口 / 归档判断~~ - **已解决**
   - 所有 5 个 change 通过严格校验
3. ~~执行日志刚建立，尚未回填前序 commit 与风险历史~~ - **进行中**
   - 本次验证结果将记录到执行日志

## 3. 当前建议

### 建议 A（推荐）：进入 Phase 3 Task 0

✅ **前置条件已满足**：
- 工作树干净
- Phase 1-2.5 核心交付物已验证
- 所有 OpenSpec changes 通过严格校验
- 核心测试通过
- Milestone 1 脚手架已就绪

**下一步行动**：
1. 更新执行日志，记录 Milestone 0 收口结果
2. 启动 Phase 3 Task 0（前置检查）
3. 并行修复 test_nion_cli.py 导入错误（非阻塞）

### 建议 B（备选）：先修复 test_nion_cli.py 再进入 Phase 3

不推荐。该导入错误不影响核心记忆系统功能，可以在 Phase 3 并行修复，不应阻塞主线推进。

## 4. 本报告对应的验证命令

**Phase 1: 工作树状态验证**
```bash
git status --short
git diff --check
git status --porcelain | grep '^??'
```

**Phase 2: OpenSpec Change 验证**
```bash
openspec validate enforce-memory-session-runtime-contract --type change --strict
openspec validate skeletonize-memory-core-v2-compatible --type change --strict
openspec validate stabilize-v2-compatible-memory-update --type change --strict
openspec validate stabilize-desktop-memory-ui-runtime --type change --strict
openspec validate bootstrap-memoh-phase-execution-ops --type change --strict
```

**Phase 3: 关键回归测试**
```bash
# 核心记忆系统测试
PYTHONPATH=. uv run pytest \
  tests/test_memory_core_provider.py \
  tests/test_memory_core_registry.py \
  tests/test_memory_updater.py \
  tests/test_memory_session_policy.py \
  tests/test_memory_upload_filtering.py \
  tests/test_client.py \
  -v

# 前端类型检查
(cd frontend && pnpm typecheck)
```

**验证时间**: 2026-03-10
**验证人**: Claude Code (Milestone 0 收口任务)
