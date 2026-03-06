# Codex 任务：实现产物中心 MVP + 模型选择器

## 📋 任务背景

我们正在为 Nion-Agent 前端添加两个核心功能：
1. **模型选择器**：在聊天输入框工具栏添加模型选择下拉框
2. **产物中心**：右侧抽屉式面板，展示当前对话的所有产物，支持点击打开对应工作台

这是一个 MVP 实现，采用渐进式策略，**不包含**产物分组、复合工作台等复杂功能。

## 🎯 核心需求

### 1. 模型选择器集成
- 在聊天输入框下方工具栏添加模型选择触发器
- 复用现有的 `ModelSelector*` 组件库（`/components/ai-elements/model-selector.tsx`）
- 从 `useModels()` hook 获取模型列表
- 从 `getLocalSettings().context.model_name` 读取当前选中模型
- 选择模型后调用 `saveLocalSettings()` 持久化到 localStorage

### 2. 产物中心 UI
- 创建右侧抽屉式产物中心（使用 shadcn/ui 的 `Sheet` 组件）
- 在输入框工具栏添加触发按钮（显示产物数量徽章）
- 支持快捷键 `Cmd/Ctrl + Shift + A` 打开/关闭
- 复用现有的 `ArtifactFileList` 组件展示产物列表

### 3. 产物工作台集成
- 点击产物时使用 `WorkbenchRegistry.findBestMatch()` 匹配插件
- 在模态框中集成 `WorkbenchContainer` 打开工作台
- 未匹配到插件时显示默认视图

## 📚 关键 API 和组件（已调研确认）

### Artifacts 系统
```typescript
// 数据结构
interface Artifact {
  path: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

// 获取产物列表
const artifacts = thread?.values?.artifacts || [];

// 加载产物内容
import { useArtifactContent } from "@/core/artifacts/hooks";
const { data: content } = useArtifactContent(artifactPath);

// 复用组件
import { ArtifactFileList } from "@/components/workspace/artifacts/artifact-file-list";
```

### Models 系统
```typescript
// 获取模型列表
import { useModels } from "@/core/models/hooks";
const { models, isLoading } = useModels();

// 持久化模型选择
import { getLocalSettings, saveLocalSettings } from "@/core/settings/local";
const settings = getLocalSettings();
saveLocalSettings({
  ...settings,
  context: {
    ...settings.context,
    model_name: selectedModelId,
  },
});

// 复用组件
import {
  ModelSelector,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorItem,
} from "@/components/ai-elements/model-selector";
```

### Workbench 系统
```typescript
// 匹配工作台插件
import { getWorkbenchRegistry } from "@/core/workbench/registry";
const registry = getWorkbenchRegistry();
const plugin = registry.findBestMatch(artifact);

// 集成工作台容器
import { WorkbenchContainer } from "@/components/workspace/artifacts/workbench-container";
<WorkbenchContainer filepath={artifactPath}>
  {/* 回退内容 */}
</WorkbenchContainer>
```

## 📂 文件结构

需要创建/修改的文件：

```
frontend/src/
├── components/workspace/
│   ├── input-box.tsx                          # 修改：添加模型选择器和产物中心按钮
│   └── artifact-center/                       # 新建目录
│       ├── artifact-center.tsx                # 新建：产物中心主组件
│       ├── workbench-modal.tsx                # 新建：工作台模态框
│       └── index.ts                           # 新建：导出
├── core/i18n/locales/
│   ├── zh-CN.ts                               # 修改：添加 artifactCenter 翻译
│   ├── en-US.ts                               # 修改：添加 artifactCenter 翻译
│   └── types.ts                               # 修改：添加 artifactCenter 类型
└── hooks/
    └── use-artifact-center.ts                 # 新建：产物中心状态管理 hook（可选）
```

## 🔧 实施步骤

### Phase 1: 模型选择器集成
1. 在 `input-box.tsx` 的 `PromptInputTools` 区域添加 `ModelSelectorTrigger`
2. 集成 `ModelSelector` 组件，使用 `useModels()` 获取数据
3. 实现模型选择处理函数，调用 `saveLocalSettings()` 持久化
4. 测试：选择模型后刷新页面，验证模型保持选中状态

### Phase 2: 产物中心 UI
1. 创建 `artifact-center/artifact-center.tsx`，使用 `Sheet` 组件
2. 在 `input-box.tsx` 添加产物中心触发按钮（带数量徽章）
3. 集成 `ArtifactFileList` 展示产物列表
4. 添加快捷键支持（`Cmd/Ctrl + Shift + A`）
5. 测试：打开产物中心，验证产物列表显示

### Phase 3: 产物工作台集成
1. 创建 `artifact-center/workbench-modal.tsx`，使用 `Dialog` 组件
2. 实现产物点击处理，调用 `registry.findBestMatch()`
3. 集成 `WorkbenchContainer` 到模态框
4. 测试：点击产物，验证工作台正确打开

### Phase 4: 国际化和优化
1. 在 `zh-CN.ts` 和 `en-US.ts` 添加翻译
2. 更新 `types.ts` 添加 `artifactCenter` 类型
3. 添加空状态提示和加载状态
4. 测试：切换语言，验证文本正确显示

## ⚠️ 重要约束

### 必须遵守
- ✅ **复用现有组件**：不要重新实现 `ModelSelector`、`ArtifactFileList`、`WorkbenchContainer`
- ✅ **使用现有 API**：不要修改 `WorkbenchRegistry` 的匹配逻辑
- ✅ **MVP 范围**：不要实现产物分组、复合工作台等复杂功能
- ✅ **在独立 worktree 中工作**：不要污染主项目代码

### 禁止操作
- ❌ 不要修改 `WorkbenchRegistry` 的核心逻辑
- ❌ 不要在产物中心添加编辑功能（只读，编辑在工作台中）
- ❌ 不要创建新的模型选择组件（复用现有的）
- ❌ 不要实现产物搜索/过滤功能（留到后续迭代）

## 🧪 验证清单

完成后请验证以下功能：

### 模型选择器
- [ ] 模型选择器显示在输入框工具栏
- [ ] 点击触发器打开模型列表
- [ ] 当前选中模型高亮显示
- [ ] 选择模型后更新 localStorage
- [ ] 刷新页面后模型选择保持

### 产物中心
- [ ] 点击按钮打开产物中心抽屉
- [ ] 产物列表显示当前对话的所有产物
- [ ] 产物数量徽章正确显示
- [ ] 快捷键 `Cmd/Ctrl + Shift + A` 生效
- [ ] 空状态显示"暂无产物"提示

### 工作台集成
- [ ] 点击产物打开工作台模态框
- [ ] 工作台正确加载产物内容
- [ ] 未匹配到插件时显示默认视图
- [ ] ESC 键关闭模态框

### 国际化
- [ ] 中文界面文本正确
- [ ] 英文界面文本正确
- [ ] 切换语言后文本更新

## 📖 参考文档

- **项目架构**：`/frontend/CLAUDE.md`
- **调研报告**：见上文"关键 API 和组件"部分
- **Workbench 系统**：`/frontend/src/core/workbench/`
- **现有产物组件**：`/frontend/src/components/workspace/artifacts/`

## 🚀 开始执行

请在独立的 git worktree 中执行此任务：

```bash
# 创建新的 worktree
git worktree add ../nion-artifact-center feature/artifact-center

# 切换到 worktree
cd ../nion-artifact-center

# 开始开发
pnpm dev
```

完成后提交代码并创建 PR 到 `main` 分支。

---

**任务优先级**：P0（高优先级）
**预计工作量**：4-6 小时
**交付标准**：所有验证清单项通过 ✅
