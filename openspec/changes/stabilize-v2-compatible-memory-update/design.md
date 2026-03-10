## Context

当前 `Memory Core` 骨架已经建立，默认 provider 为 `v2-compatible`，上层 prompt 注入、memory write gating 和 memory 只读接口都已通过 provider 访问 legacy 记忆数据。但桌面端真实运行日志显示，兼容写回链路虽然已被正常触发，仍频繁因为 updater 对模型输出过于严格地依赖一次裸 `json.loads(...)` 而失败。

桌面端真实验证路径如下：

- 记忆文件：`~/Library/Application Support/com.nion.desktop/nion/memory.json`
- 运行日志：`~/Library/Application Support/com.nion.desktop/nion/logs/langgraph.log`

这次热修只解决兼容层稳定性与最小可感知读取，不进入 `Phase 3` 的结构化存储。

## Goals / Non-Goals

**Goals:**
- 让 `MemoryUpdater` 能兼容解析常见非严格 JSON 输出
- 让解析失败时保留已有长期记忆并输出可诊断日志
- 在现有 summary 注入基础上，为高置信 facts 提供最小可感知注入
- 保持 `Phase 1` 的读写 gating 行为不变
- 用最小自动化测试锁住热修行为

**Non-Goals:**
- 不实现 `StructuredFsRuntime`
- 不引入 `overview / manifest / day-files`
- 不新增 provider 管理平面或维护 API
- 不更换 memory 模型或增加新配置字段
- 不引入 semantic retrieval 或向量召回
- 不做 Soul / Heartbeat / Evolution 相关改动

## Decisions

1. **本次是兼容层稳定性热修，不是 `Phase 3`**
   - 继续复用当前 `MemoryMiddleware -> Queue -> Updater -> memory.json` 主路径。
   - 理由：先修复 legacy 基线，避免后续迁移建立在坏基线之上。

2. **解析回退链固定为三段**
   - `json.loads(...)`
   - 去除 code fence 与对象提取后再次 JSON 解析
   - `yaml.safe_load(...)` 解析近似 JSON / YAML 对象
   - 理由：覆盖当前日志中最常见的模型输出变体，同时避免引入新的复杂解析框架。

3. **解析成功后统一做最小结构归一化**
   - 自动补齐 `user`、`history`、`newFacts`、`factsToRemove` 的缺失结构。
   - 只接受顶层 `dict` 对象。
   - 理由：减少兼容输出格式差异对后续更新逻辑的影响。

4. **解析失败只记录日志，不改写 memory 文件**
   - 日志必须包含 `thread_id`、模型名和截断后的响应片段。
   - 理由：当前失败信息不足以区分 fenced JSON、说明性前后缀和真正坏响应。

5. **facts 注入采用最小可感知增强，而不是 retrieval 重构**
   - 继续保留现有 summary 注入；追加一个 `Key Facts` 区块。
   - 仅使用已持久化 facts，按 `confidence` 降序、`createdAt` 新到旧排序，最多注入 10 条。
   - 理由：解决“已记住但下一轮不容易感知”的最小体验断裂，同时严格留在 `Phase 2` 边界内。

6. **不新增第三方依赖**
   - 优先复用仓库已有 `PyYAML`。
   - 理由：保持桌面端与本地运行时轻量依赖原则。

## Risks / Trade-offs

- 这次热修仍然建立在“模型输出结构化文本再解析”的旧思路上，不是长期最优架构。
- `yaml.safe_load` 会提高兼容性，但不等于彻底解决结构化输出稳定性问题；如果默认模型持续产生极不稳定文本，后续仍可能需要专用 structured output 或 dedicated memory model。
- facts 注入增强的是“可感知性”，不是 semantic retrieval；后续 `Phase 3+` 仍应重新设计结构化读取与维护能力。

## Migration Plan

1. 完成热修阶段文档与 OpenSpec 四件套。
2. 先补 updater 与 provider 的失败测试。
3. 实现集中解析函数、日志增强和 prompt 收紧。
4. 实现高置信 facts 的最小注入。
5. 跑相关测试、OpenSpec validate 与 diff 检查。
6. 回写阶段文档进展说明，明确哪些内容仍留给 `Phase 3+`。

## Open Questions

- 本次无阻塞性 open question。
- 若实施中发现仅靠解析加固不足以让默认模型稳定产生可用更新结果，则记录 follow-up：`memory update structured output / dedicated model`，不在本次热修中扩阶段实现。
