# WS-1 死代码审计报告

> 审计日期：2026-03-16
> 审计范围：backend/src, frontend/src, 根目录, docs/

---

## 汇总

| 分类 | 可删除行数 | 文件数 | 风险 |
|------|-----------|-------|------|
| Backend 死代码 | ~1,069 | 12 | 低 |
| Frontend 死代码 | ~2,115 | 15 | 低 |
| 文档/配置垃圾 | ~200KB | 15+ | 低 |
| **合计** | **~3,184 行 + 200KB docs** | **42+** | |

---

## 一、Backend 死代码

### 1.1 空占位模块 [HIGH]

| 文件 | 行数 | 说明 |
|------|------|------|
| `backend/src/services/__init__.py` | 1 | 整个模块只有一行 docstring，无导出，无引用 |

### 1.2 未注册的 Gateway 路由 [HIGH]

这 4 个路由定义了完整的 API 端点，但 **从未在 `app.py` 中注册**，也不在 `_ROUTER_MODULES` 集合中。

| 文件 | 行数 | 端点 |
|------|------|------|
| `gateway/routers/system.py` | 40 | `/api/system/timezone`, `/api/system/sandbox-policy` |
| `gateway/routers/memory.py` | 114 | `/api/memory/write`, `/api/memory/query/explain`, `/api/memory/rebuild` |
| `gateway/routers/agent_tools.py` | 50 | `/api/agents/{agent_name}/tools` GET/PUT |
| `gateway/routers/subagent_runs.py` | 80 | `/api/subagent-runs` CRUD |

> **注意**: `system.py` 是 `src/system/timezone_service.py` (141行) 的唯一消费者。如果路由确认删除，`src/system/` 整个模块也可以一起删。

### 1.3 已被统一模块替代的 Community 工具 [HIGH]

这些是独立的工具包装器，已被 `web_search/tools.py` 和 `web_fetch/tools.py` 统一模块取代。

| 文件 | 行数 | 说明 |
|------|------|------|
| `community/tavily/tools.py` | 62 | Tavily 现在是 web_search 的内部 provider |
| `community/firecrawl/tools.py` | 73 | Firecrawl 现在是 web_search/web_fetch 的内部 provider |
| `community/jina_ai/tools.py` | 92 | JinaClient 被 web_fetch 直接使用，这个 tools.py 包装器无人引用 |

### 1.4 可能死亡的 Community 模块 [MEDIUM]

| 文件 | 行数 | 说明 |
|------|------|------|
| `community/infoquest/` (整个目录) | 374 | 仅在 config.example.yaml 中以注释形式出现，无运行时引用。可能是有意保留的可选 provider |

### 1.5 死函数/导出 [HIGH/MEDIUM]

| 文件 | 行数 | 说明 | 置信度 |
|------|------|------|--------|
| `utils/readability.py` → `Article.to_message()` | 25 | 零调用者，所有消费者用 `to_markdown()` | HIGH |
| `agents/checkpointer/provider.py` → `checkpointer_context()` | 17 | 无外部调用者 | MEDIUM |

---

## 二、Frontend 死代码

### 2.1 整个 Landing 页组件 [HIGH] -- 1,248 行

`frontend/src/components/landing/` 下 10 个文件从未被任何页面引用。根路由 `app/page.tsx` 直接 redirect 到聊天页。

```
components/landing/
├── hero.tsx                              (80)
├── header.tsx                            (75)
├── footer.tsx                            (19)
├── section.tsx                           (29)
├── progressive-skills-animation.tsx      (701)  ← 最大的死文件
└── sections/
    ├── whats-new-section.tsx             (63)
    ├── sandbox-section.tsx              (126)
    ├── case-study-section.tsx            (98)
    ├── skills-section.tsx                (28)
    └── community-section.tsx             (29)
```

### 2.2 原型页面 [HIGH] -- 347 行

| 文件 | 行数 | 说明 |
|------|------|------|
| `app/prototypes/scheduler-migration/page.tsx` | 347 | 硬编码 mock 数据的原型页，无任何导航指向它 |

### 2.3 未引用的组件 [HIGH]

| 文件 | 行数 | 说明 |
|------|------|------|
| `components/workspace/plugins/plugin-assistant-flow-panel.tsx` | 249 | 导出 `PluginAssistantFlowPanel`，零引用 |
| `components/workspace/inline-tip.tsx` | 112 | 导出 `InlineTip`，零引用 |
| `components/workspace/overscroll.tsx` | 17 | 导出 `Overscroll`，零引用 |

### 2.4 注释掉的插件 [HIGH]

| 文件 | 行数 | 说明 |
|------|------|------|
| `plugins/example-image-viewer.tsx` | 58 | 在 `plugins/index.ts` 中 import 和注册都被注释掉 |

### 2.5 未使用的 Hook/导出 [HIGH]

| 文件 | 行数 | 说明 |
|------|------|------|
| `core/uploads/hooks.ts` → `useUploadedFiles` | ~79 | 定义了完整 hook 但从未被任何组件导入 |
| `server/better-auth/client.ts` | 5 | 导出 `authClient` 和 `Session`，零引用 |

### 2.6 确认存活（不删）

- **Mock API** (`app/mock/api/`): 520 行，通过 `?mock=true` URL 参数使用，是离线/演示模式
- **Scheduler 组件**: 被 scheduler 页面和 agent settings 引用
- **Citations 组件**: 被 3 个消息/artifact 组件引用
- **所有 core/ 小模块**: 均有实际引用

---

## 三、文档与配置垃圾

### 3.1 可直接删除 [HIGH]

| 路径 | 说明 |
|------|------|
| `CODEX_TASK.md` | 一次性 Codex 任务指令，功能已实现 |
| `IMPLEMENTATION_SUMMARY.md` | 完成报告，分支已合并 |
| `.rollback-backups/` | ~350KB git 追踪的二进制备份，git 历史已保留一切 |
| `.folo-reference/` | 空目录占位符 |
| `docs/CHAT_MODULE_MIGRATION_PLAN.md` | 迁移已完成 |
| `docs/CLAUDE_PROMPT_WORKBENCH_PLUGIN_CLOSURE.md` | 一次性 prompt |
| `docs/CODEX_PROMPT.md` | 一次性 prompt |
| `docs/CONFIG_MIGRATION_DELIVERY.md` | 迁移已完成 |
| `docs/CONFIG_MIGRATION_FINAL.md` | 迁移已完成 |
| `docs/CONFIG_MIGRATION_PLAN.md` | 迁移已完成 |
| `docs/RETRIEVAL_MODELS_REIMPLEMENTATION_PLAN.md` | 已执行 |
| `docs/WORKING_DIRECTORY_IMPLEMENTATION_PLAN.md` | 38KB，已执行 |

### 3.2 建议归档（你确认后删） [MEDIUM]

| 路径 | 说明 |
|------|------|
| `docs/memoh/` (整个目录) | 迁移规划目录，phases 4-7 大部分已实现。README 中有断链 |
| `scripts/memoh/` | memoh 迁移的脚本工具 |
| `docs/EMBEDDING_UI_OPTIMIZATION_PLAN.md` | 检查是否已执行 |
| `docs/SCHEDULED_TASKS_PLAN.md` | 检查实现状态 |
| `docs/CLI_INTERACTIVE_MODE.md` | 可能仍在开发中 |
| `docs/MEMORY_SYSTEM_CODEX_GUIDE.md` | 记忆系统参考 |
| `docs/ARTIFACT_CENTER_ROADMAP.md` | 部分实现的路线图 |

### 3.3 保留

| 路径 | 说明 |
|------|------|
| `ELECTRON.md` | 桌面端运维文档，仍然准确 |
| `CONTRIBUTING.md` | 贡献者指南，路径引用正确 |
| `docs/plans/` | 活跃的规划目录 |
| `docs/优化记录/` | 活跃的优化记录 |
| `docs/product-design/` | 产品设计参考 |
| `docs/code-audit/` | 当前审计工作 |

---

## 四、执行建议

### 阶段 A：安全删除（HIGH 置信度，零风险）

1. 删除 Backend 空模块和未注册路由
2. 删除 Frontend landing 组件、原型页、未引用组件
3. 删除过期文档和配置垃圾

**预计削减：~3,200 行代码 + ~250KB 文档**

### 阶段 B：需确认后删除（MEDIUM 置信度）

1. `community/infoquest/` -- 是否还需要作为可选 provider?
2. `docs/memoh/` -- 迁移是否已全部完成?
3. 未注册路由对应的服务模块 (`src/system/`) -- 是意外遗漏还是有意不注册?

### 阶段 C：进入 WS-2（重复与过度抽象审计）

死代码清理完成后，进入下一个工作流。
