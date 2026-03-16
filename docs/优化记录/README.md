# 代码优化记录（Nion-Agent）

本目录用于沉淀 **代码治理/重构/清理无效代码** 的“执行记录”，它关注的是：

- 每个阶段做了什么
- 产出了什么结果
- 证据链是什么（验证命令与结果、删除依据、风险与回滚点）

它与 `docs/plans/` 的区别：

- `docs/plans/`：写“计划与方案”（准备怎么做）。
- `docs/优化记录/`：写“实际执行与成果”（做了什么、结果如何）。

## 记录规则（强制）

- 每个优化 workstream（例如 WS0/WS1/WS2）至少维护 1 份记录文件。
- 合并到 `main` 前，必须确保对应记录文件已更新，且包含本阶段的验证证据与回滚方式。

## 命名约定（推荐）

为避免并发冲突，建议每条 workstream 各自维护独立文件：

- `YYYY-MM-DD-WS0-guardrails.md`
- `YYYY-MM-DD-WS1-hygiene.md`
- `YYYY-MM-DD-WS2-frontend.md`
- `YYYY-MM-DD-WS3-backend.md`
- `YYYY-MM-DD-WS4-core-domains.md`

如果同一条 workstream 跨越多个阶段，也可以继续在同一文件内按里程碑追加小节（保持顺序即可）。

## 模板

请按模板撰写：[`TEMPLATE.md`](./TEMPLATE.md)

