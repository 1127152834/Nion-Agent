# Review Fix Prompt 模板

你现在要修复一个已经明确指出的 review finding。

## 输入
- 阶段文档：`<docs/memoh/plan/...>`
- 当前 change：`<change name>`
- finding：`<标题>`
- 位置：`<file:line>`
- 优先级：`<P0/P1/P2>`

## 要求
1. 先确认 finding 是否成立，并说明根因
2. 只修这条 finding 以及它直接带来的必要测试
3. 不顺手扩大为下一阶段改造
4. 修复后跑最小相关测试
5. 跑 `openspec validate <change> --type change --strict`
6. 跑 `git diff --check`
7. 以单独 commit 提交，并在执行日志中登记这次修复

## 最终输出
- finding 是否成立
- 修复范围
- 测试结果
- 是否仍有残余风险
