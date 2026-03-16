# WS2 Frontend：Lint 降噪与可维护性小步治理（Warnings -> 0）

**日期**：2026-03-16  
**Workstream**：WS2 Frontend  
**范围**：frontend  
**风险等级**：C（仅治理 lint 噪声与测试类型标注；不改业务契约）  
**目标**：稳定性 / 可维护性 / 质量提升  
**关联计划**：
- `docs/plans/2026-03-16-repo-optimization-design.md`
- `docs/plans/2026-03-16-module-map.md`
**关联提交**：352db3b5..557fce6d  

## 背景

`frontend` 的 `eslint` 在门禁中长期存在 warning。虽然 warning 不会阻断构建，但会显著降低信噪比，导致：

- 真正的 lint error 更容易被淹没
- Review 时难以判断新增问题与历史遗留
- 新人不确定哪些 warning 能忽略、哪些必须修

因此 WS2 先从“确定无行为变化”的 lint 降噪入手，把 warnings 清零，为后续更高风险的组件拆分与逻辑收敛铺路。

## 本阶段策略与约束

- 只处理 **确定无行为变化** 的 lint 噪声（unused props/disable、effect cleanup 引用稳定化、测试类型标注）。
- 不引入新抽象、不改动对外契约、不做大范围格式化。
- 每个改动点都用本仓库门禁命令给出验证证据，并保持可回滚（`git revert`）。

## 变更清单（按类别）

- 未使用变量/注释清理（无行为变化）：
  - 移除未使用的解构字段（`timezoneSettingsHref`）
  - 删除无效的 `eslint-disable-next-line no-console`
  - 将未使用回调参数 `err` 改为 `_err`
- Effect cleanup 稳定化（无预期行为变化）：
  - 在 effect 内捕获 `ref.current` 到局部变量，避免 cleanup 读取“可能变化的 ref.current”触发 react-hooks 警告
- 测试文件类型标注降噪（无行为变化）：
  - 移除 `vi.importActual` 的 `typeof import(...)` 内联类型注解
  - 对 `react` mock 场景改为显式引入 React，避免 `unknown` 类型导致 typecheck 失败

## 删除/迁移/冻结证据链（若适用）

本阶段无删除/迁移/冻结动作（仅 lint 降噪与测试类型标注治理）。

## 验证证据（必须）

- Run: `cd frontend && pnpm run lint`
  - Result: PASS（0 errors, 0 warnings）
- Run: `cd frontend && pnpm run typecheck`
  - Result: PASS
- Run: `cd frontend && pnpm run test:unit`
  - Result: PASS（22 files / 53 tests）

## 产出与指标

- `eslint` warnings：9 -> 0
- 产出：为后续 WS2/WS3 的“热点组件拆分与逻辑收敛”提供更干净的质量反馈面

## 风险点与回滚点

- 风险：低（不涉及运行时行为变更；影响范围仅限 lint 与测试文件类型标注）
- 回滚点：
  - `git revert 557fce6d`
  - `git revert 7ccf96fb`
  - `git revert ef031f2d`

## 遗留问题与下一步

- 下一步建议：
  - WS2-1：基于 `frontend/src/components/workspace` 的热点文件做“拆大文件 + 降耦合 + 补单测”
  - WS2-2：对 `frontend/src/core/*` 的高风险域先补护城河测试，再做内部重构（不改契约）

