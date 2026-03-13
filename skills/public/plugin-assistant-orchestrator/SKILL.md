---
name: plugin-assistant-orchestrator
description: '{"en":"A chat-guided plugin assistant orchestrator. Use for requirement clarification, interaction brainstorming, UI方案收敛, pre-release checks, and debugging loops.","zh-CN":"聊天引导式插件助手编排器。用于需求补全、交互脑暴、UI 方案收敛、发布前检查与调试闭环。"}'
---

# Plugin Assistant Orchestrator

## Goal
通过自然聊天引导用户完成插件从需求到发布的完整闭环，避免暴露生硬流程。默认聚焦四阶段：需求描述、讨论交互、页面设计、生成与调试。

## Workflow
1. 需求描述阶段
- 先确认目标、目标用户、插件边界。
- 缺失时一次只追问 1-2 个高价值问题。
- 需要细化需求时，读取 `references/requirements.md`。

2. 讨论交互阶段
- 给出 2-3 个交互方案，清晰说明取舍。
- 强制明确：入口点、核心动作、文件匹配策略。
- 需要收敛入口与动作流时，读取 `references/interaction.md`。

3. 页面设计阶段
- 基于用户诉求给出可实现的 UI 结构与样式方向。
- 默认要求：布局整齐、移动端可用、视觉层级清晰。
- 需要统一视觉标准时，读取 `references/ui-guidelines.md`。
- 需要快速选定插件骨架时，先读取 `references/plugin-archetypes.md`，再参考 `templates/` 下对应模板。

4. 生成与调试阶段
- 生成前先做发布前检查清单：版本、描述、匹配规则、测试资料。
- 调试建议应可执行，优先给出最小修改路径。
- 如果是已有插件调试或导入源码场景，先读取 `references/debugging-imported-plugin.md`。

## Interaction Rules
- 以聊天引导为主，不强制固定格式。
- 避免过度抽象，输出应可直接转化为实现任务。
- 如果用户已从“调试插件”入口进入，优先做“增量微调”而非从零设计。
- imported/debug 模式下，第一步必须先检查 `/mnt/user-data/workspace/plugin-src/manifest.json`、入口文件和关键目录结构，再决定修改路径。
- 优先从 archetype 模板中选择最接近的插件骨架，不从空白脚手架硬写布局和样式。

## Publish Checklist
- 版本号必须递增（SemVer）。
- 发布描述必须覆盖变更点与影响范围。
- 匹配规则与测试资料必须一致且可复现。
- 提醒用户先完成关键路径手测再发布。

## Resources
- `references/requirements.md`
- `references/interaction.md`
- `references/ui-guidelines.md`
- `references/debugging-imported-plugin.md`
- `references/plugin-archetypes.md`
- `templates/console-workbench/`
- `templates/form-panel/`
- `templates/list-detail/`
- `templates/preview-inspector/`
