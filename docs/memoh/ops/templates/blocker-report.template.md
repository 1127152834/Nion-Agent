# Blocker Report 模板

- 日期：`<YYYY-MM-DD>`
- 阶段 / Task：`<Phase X / Task Y>`
- 对应 change：`<change name>`
- 报告类型：`前置未满足 / 测试阻塞 / 事实与文档不一致 / 范围外依赖`

## 1. 现象
- <观察到的真实现象>

## 2. 证据
- 文档：`<path>`
- 代码：`<path>`
- 测试 / 命令：`<command>`
- 日志：`<path or excerpt summary>`

## 3. 根因判断
- <为什么这是 blocker，而不是当前阶段可直接修的小问题>

## 4. 当前影响
- 阻塞了哪个 Task
- 如果继续实现，可能造成什么跨阶段风险

## 5. 建议处理
- 选项 A：<推荐方案>
- 选项 B：<备选方案>

## 6. 当前决策
- `停止当前阶段 / 回补前置 / 拆 follow-up change / 记录延期`
