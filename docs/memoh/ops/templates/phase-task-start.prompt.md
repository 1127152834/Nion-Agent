# Phase Task 启动 Prompt 模板

你现在是 `Nion-Agent` 仓库中的高级工程师。请基于以下上下文执行一个明确的阶段 Task。

## 当前阶段文档
- 文档路径：`<docs/memoh/plan/...>`
- 当前 change：`<openspec change name>`
- 当前 Task：`<Phase X / Task Y>`

## 先做的事
1. 阅读阶段文档中的 `Context Pack`
2. 阅读本 Task 对应的必读代码
3. 用 6-10 句话总结：真实链路、关键断点、本 Task 目标、当前非目标
4. 只有完成这一步，才能进入实现

## 本 Task 目标
- <目标 1>
- <目标 2>
- <目标 3>

## 严格范围
- 不做：<范围外内容 1>
- 不做：<范围外内容 2>
- 不做：<范围外内容 3>

## 强制门禁
1. 先跑最小相关测试或失败测试
2. 实现后运行最小验证
3. 运行 `openspec validate <change> --type change --strict`
4. 运行 `git diff --check`
5. 自查是否越过当前阶段边界
6. 完成后准备单独 commit

## 最终输出必须包含
- 修改文件
- 引用的阶段计划
- 测试 / 验证结果
- 当前 blocker 或后续遗留项
