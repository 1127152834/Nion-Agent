# Phase 2 热修：`v2-compatible` 记忆写回稳定性与最小可感知读取

> **定位：** 这是 `Phase 2` 完成后的兼容层稳定性热修，不是新的正式阶段，也不是 `Phase 3` 提前实施。
>
> **一句话目标：** 修复当前 `MemoryMiddleware -> Queue -> Updater -> memory.json` 兼容路径里“已触发但写不进去”的真实故障，并补齐已保存高置信 facts 的最小注入可见性，让 legacy 基线重新可用且可验证。

## 1. 问题诊断

当前桌面端真实长期记忆文件位于：

- `~/Library/Application Support/com.nion.desktop/nion/memory.json`

真实运行日志显示：

- `MemoryMiddleware` 已经在正常会话后触发入队
- `MemoryUpdateQueue` 已经在 30 秒 debounce 后处理更新
- `MemoryUpdater` 已经实际调用模型尝试生成更新结果
- 但更新结果经常不是严格 JSON，导致 `json.loads(...)` 失败
- 一旦解析失败，本轮长期记忆更新会被整体丢弃，因此页面 Memory 不出现新增偏好，下一轮 prompt 也拿不到对应记忆

这说明当前问题不是“没有记忆系统”，而是“兼容写回链路经常在解析阶段失败”。

## 2. 为什么现在修

之所以要在 `Phase 3` 之前先修这个问题，是因为 `Phase 3` 已明确把当前 `memory.json` 路线当作：

- legacy 兼容基线
- 结构化存储迁移前的事实来源之一
- 回滚路径
- 页面手测与验收时的对照基线

如果当前兼容路径本身处于“写回经常失败”的状态，那么：

- `Phase 3` 的迁移没有可信输入基线
- 结构化存储切换失败后也没有可信回退基线
- 页面手测会持续出现“模型说记住了，但系统没有真正记住”的体验断裂

因此这次热修是为后续阶段扫清运行时基线问题，而不是偏离升级路线。

## 3. 本次目标

本次热修只做以下三件事：

1. 恢复当前 `v2-compatible` 写回链路的可用性
2. 提升已保存偏好 facts 的最小 prompt 注入可感知性
3. 保持 `Phase 1` 的 `session_mode / memory_read / memory_write` 语义不变

达成后，系统应至少满足：

- 普通会话说“记住：我最喜欢 Python，不喜欢 Java”后，长期记忆能成功写入
- 页面 Memory 能看到新增 summary 或 facts
- 下一轮普通会话里，助手能利用已保存偏好进行回答
- `temporary_chat` 仍默认读开写关

## 4. 非目标

本次热修明确不做以下内容：

- 不做 `Phase 3` 的 `Structured FS Memory`
- 不做 `overview / manifest / day-files`
- 不做 `usage / compact / rebuild` 正式维护 API
- 不做 provider 管理平面或多 provider 切换
- 不做 retrieval / embedding / rerank 重构
- 不做 Soul / Heartbeat / Evolution
- 不更换 `memory.json` / `agents/{name}/memory.json` 数据格式
- 不新增前端设置项

## 5. 实施范围

本次热修的代码范围固定为：

- `backend/src/agents/memory/updater.py`
  - 引入集中解析函数
  - 增加兼容解析回退链
  - 增强失败日志可诊断性
- `backend/src/agents/memory/prompt.py`
  - 轻量收紧 `MEMORY_UPDATE_PROMPT`
  - 在现有 summary 注入后追加最小 `Key Facts` 区块
- `backend/tests/test_memory_updater.py`
  - 覆盖 fenced JSON、前后缀文本、YAML/近似 JSON、完全失败不覆盖旧文件
- `backend/tests/test_memory_core_provider.py`
  - 覆盖高置信 facts 注入与 `memory_read=false` gating
- `backend/tests/test_memory_session_policy.py`
  - 回归 Phase 1 语义
- `backend/tests/test_memory_upload_filtering.py`
  - 回归上传过滤

OpenSpec 本次单独使用 change：

- `stabilize-v2-compatible-memory-update`

不复用 `skeletonize-memory-core-v2-compatible`，避免把“骨架化”与“稳定性热修”混成一个 change。

## 6. 验收方式

### 自动化验收

- `uv run pytest tests/test_memory_updater.py tests/test_memory_core_provider.py tests/test_memory_session_policy.py tests/test_memory_upload_filtering.py -q`
- `openspec validate stabilize-v2-compatible-memory-update --type change --strict`
- `git diff --check`

### 手工验收

1. **普通会话写入**
   - 在普通会话中输入“记住：我最喜欢 Python，不喜欢 Java”
   - 等待超过 30 秒 debounce
   - 桌面端检查 `~/Library/Application Support/com.nion.desktop/nion/memory.json` 已更新
   - Memory 页面出现对应 summary 或 facts

2. **普通会话读取**
   - 新开普通会话，询问“你记得我喜欢什么语言 / 不喜欢什么语言吗”
   - 回答能利用已保存的偏好

3. **禁写保护**
   - `temporary_chat` 或 `memory_write=false` 时，不产生新的长期记忆落盘

4. **禁读保护**
   - `memory_read=false` 时，回答中不利用长期记忆


## 7. 当前进展

- 已建立 OpenSpec change：`stabilize-v2-compatible-memory-update`
- 已为 `MemoryUpdater` 加入兼容解析回退链与失败诊断日志
- 已为默认注入上下文补齐高置信 `Key Facts` 最小可感知增强
- 已补齐对应自动化测试，并保持 `Phase 1` 读写 gating 回归通过
