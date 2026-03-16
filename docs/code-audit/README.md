# Nion-Agent 代码审计

> 目标：清理 AI 生成代码的技术债，建立可维护的代码基线。

## 审计工作流

| ID | 名称 | 风险 | 状态 |
|----|------|------|------|
| WS-1 | 死代码清理 | 低 | 已完成 (-32,782 行, 77 文件) |
| WS-2 | 重复与过度抽象 | 中 | 已完成 (-167 行重复, 19 文件) |
| WS-3 | 架构健康度 | 中 | 已完成 (workbench 拆分, runtime 合并, barrel exports) |
| WS-4 | 质量与可维护性 | 高 | 已完成 (大文件拆分, 日志规范化, 死依赖移除) |

## 代码规模基线（2026-03-16 审计后）

| 层 | 文件数 | 代码行数 |
|---|-------|---------|
| Backend (Python) | 258 | ~54,000 |
| Frontend (TS/TSX) | 392 | ~72,500 |
| Desktop (Electron) | 26 | ~少量 |
| **总计** | **676** | **~126,500** |

> 文件数略增是因为大文件拆分为多个小文件（models-section 3020行→4文件，input-box 2496行→4文件，workbench 2912行→6文件）。

## 报告索引

- [WS-1 死代码审计](./WS1-dead-code.md)
- [WS-2 & WS-3 实施计划](./WS2-WS3-plan.md)
- [WS-4 实施计划](./WS4-plan.md)

## 延后项（建议作为独立计划处理）

1. Settings 页面 useState 泛滥（5 个页面 17-28 个 useState）
2. bridge_service.py 3345 行（channels 子系统核心）
3. openviking_runtime.py 2214 行（记忆系统核心）
4. plugin assistant page 2118 行/32 useState
