# 产物中心功能路线图

## 📋 文档概述

本文档规划了产物中心从 MVP 到完整功能的演进路线，包括产物分组、复合工作台等高级特性的设计方案。

---

## 🎯 MVP 回顾（Phase 0）

### 已实现功能
- ✅ 模型选择器：在输入框工具栏选择 AI 模型
- ✅ 产物中心 UI：右侧抽屉展示产物列表
- ✅ 工作台集成：点击产物打开对应工作台
- ✅ 类型匹配：基于文件扩展名匹配工作台插件

### 技术架构
```
InputBox
  ├─ ModelSelector (模型选择)
  └─ ArtifactCenterTrigger (产物中心触发器)

ArtifactCenter (Sheet)
  ├─ ArtifactFileList (产物列表)
  └─ WorkbenchModal (工作台模态框)
      └─ WorkbenchContainer
          └─ WorkbenchPlugin.render()
```

### 数据流
```
Thread.values.artifacts (string[])
  → ArtifactCenter
  → Click artifact
  → WorkbenchRegistry.findBestMatch(artifact)
  → WorkbenchPlugin
```

---

## 🚀 Phase 1: 产物分组（Artifact Grouping）

### 1.1 产品需求

**核心问题：** 如何识别一组相关的产物？

**场景示例：**
- 用户：「生成一篇关于 AI 的文章」
- AI 生成：
  - `article.md` - 文章正文
  - `cover.png` - 封面图片
  - `demo.mp4` - 演示视频
- **期望：** 这 3 个文件被识别为一组产物

**用户价值：**
- 减少产物列表混乱
- 快速定位相关文件
- 支持批量操作（下载、分享）

### 1.2 技术设计

#### 数据结构设计

```typescript
// 产物组元数据
interface ArtifactGroup {
  id: string;                    // 组 ID（UUID）
  name: string;                  // 组名称（如"AI 文章"）
  description?: string;          // 组描述
  artifacts: string[];           // 产物路径列表
  createdAt: number;             // 创建时间戳
  metadata?: {
    taskId?: string;             // 关联的任务 ID
    prompt?: string;             // 触发生成的 prompt
    tags?: string[];             // 标签
  };
}

// 扩展 Thread 状态
interface AgentThreadState {
  // ... 现有字段
  artifacts: string[];           // 保持向后兼容
  artifactGroups?: ArtifactGroup[];  // 新增：产物组
}
```

#### 分组识别策略

**策略 1：基于时间窗口（推荐用于 MVP+1）**
```typescript
// 在 5 分钟内生成的产物自动归为一组
const TIME_WINDOW = 5 * 60 * 1000; // 5 分钟

function autoGroupArtifacts(
  artifacts: Array<{ path: string; timestamp: number }>
): ArtifactGroup[] {
  const groups: ArtifactGroup[] = [];
  let currentGroup: string[] = [];
  let lastTimestamp = 0;

  for (const artifact of artifacts) {
    if (artifact.timestamp - lastTimestamp > TIME_WINDOW) {
      // 开始新组
      if (currentGroup.length > 0) {
        groups.push(createGroup(currentGroup));
      }
      currentGroup = [artifact.path];
    } else {
      // 加入当前组
      currentGroup.push(artifact.path);
    }
    lastTimestamp = artifact.timestamp;
  }

  if (currentGroup.length > 0) {
    groups.push(createGroup(currentGroup));
  }

  return groups;
}
```

**策略 2：基于 AI 意图识别（推荐用于 Phase 2）**
```typescript
// 后端在生成产物时标记组信息
interface ToolCallMetadata {
  groupId?: string;              // AI 生成时指定的组 ID
  groupName?: string;            // 组名称
  isGroupStart?: boolean;        // 是否开始新组
  isGroupEnd?: boolean;          // 是否结束当前组
}

// 示例：AI 在生成文章时的 tool call
{
  tool: "write-file",
  args: {
    path: "article.md",
    content: "...",
    metadata: {
      groupId: "article-20260305",
      groupName: "AI 文章",
      isGroupStart: true
    }
  }
}
```

**策略 3：基于文件名前缀（简单但有效）**
```typescript
// 相同前缀的文件自动归组
// 例如：article-text.md, article-cover.png, article-demo.mp4
function groupByPrefix(artifacts: string[]): ArtifactGroup[] {
  const prefixMap = new Map<string, string[]>();

  for (const path of artifacts) {
    const filename = path.split('/').pop() || '';
    const prefix = filename.split('-')[0] || filename.split('.')[0];

    if (!prefixMap.has(prefix)) {
      prefixMap.set(prefix, []);
    }
    prefixMap.get(prefix)!.push(path);
  }

  return Array.from(prefixMap.entries())
    .filter(([_, paths]) => paths.length > 1) // 只保留多文件组
    .map(([prefix, paths]) => createGroup(paths, prefix));
}
```

#### API 设计

```typescript
// 后端 API
POST /api/threads/{thread_id}/artifact-groups
{
  "name": "AI 文章",
  "artifacts": ["article.md", "cover.png", "demo.mp4"],
  "metadata": {
    "prompt": "生成一篇关于 AI 的文章"
  }
}

GET /api/threads/{thread_id}/artifact-groups
// 返回：ArtifactGroup[]

PUT /api/threads/{thread_id}/artifact-groups/{group_id}
// 更新组信息（重命名、添加/移除产物）

DELETE /api/threads/{thread_id}/artifact-groups/{group_id}
// 删除组（产物本身不删除）
```

```typescript
// 前端 hooks
import { useArtifactGroups } from "@/core/artifacts/hooks";

const {
  groups,              // ArtifactGroup[]
  isLoading,
  createGroup,         // (name, artifacts) => Promise<ArtifactGroup>
  updateGroup,         // (groupId, updates) => Promise<void>
  deleteGroup,         // (groupId) => Promise<void>
  addToGroup,          // (groupId, artifactPath) => Promise<void>
  removeFromGroup,     // (groupId, artifactPath) => Promise<void>
} = useArtifactGroups(threadId);
```

### 1.3 UI 设计

#### 产物列表视图

```
┌─────────────────────────────────────┐
│ 产物中心                    [×]      │
├─────────────────────────────────────┤
│                                     │
│ 📁 AI 文章 (3)              [···]   │
│   ├─ 📄 article.md                  │
│   ├─ 🖼️ cover.png                   │
│   └─ 🎬 demo.mp4                    │
│                                     │
│ 📁 数据分析报告 (2)          [···]   │
│   ├─ 📊 report.xlsx                 │
│   └─ 📈 chart.png                   │
│                                     │
│ 📄 独立文件                          │
│   └─ 📄 notes.txt                   │
│                                     │
└─────────────────────────────────────┘
```

#### 交互设计

**分组操作：**
- 点击组名：展开/折叠组
- 右键组名：重命名、删除组、下载全部
- 拖拽产物：在组之间移动产物
- 多选产物：批量创建组

**产物操作：**
- 单击产物：打开工作台
- 右键产物：下载、移除、移动到其他组

#### 组件结构

```typescript
// 新组件
<ArtifactCenter>
  <ArtifactGroupList>
    <ArtifactGroup group={group}>
      <ArtifactGroupHeader />
      <ArtifactGroupItems>
        <ArtifactItem />
      </ArtifactGroupItems>
    </ArtifactGroup>
  </ArtifactGroupList>

  <UngroupedArtifacts>
    <ArtifactItem />
  </UngroupedArtifacts>
</ArtifactCenter>
```

### 1.4 实施计划

**Step 1: 数据层（1-2 天）**
- [ ] 扩展 `AgentThreadState` 添加 `artifactGroups` 字段
- [ ] 实现后端 API（创建、查询、更新、删除组）
- [ ] 实现前端 hooks（`useArtifactGroups`）

**Step 2: 自动分组逻辑（1 天）**
- [ ] 实现基于时间窗口的自动分组
- [ ] 在产物生成时自动创建组
- [ ] 添加配置项：启用/禁用自动分组

**Step 3: UI 实现（2-3 天）**
- [ ] 创建 `ArtifactGroup` 组件
- [ ] 实现展开/折叠动画
- [ ] 实现拖拽排序和移动
- [ ] 添加右键菜单

**Step 4: 测试和优化（1 天）**
- [ ] 测试大量产物的性能
- [ ] 测试分组边界情况
- [ ] 优化动画和交互

**总计：5-7 天**

---

## 🎨 Phase 2: 复合工作台（Composite Workbench）

### 2.1 产品需求

**核心问题：** 如何在一个工作台中同时编辑多个相关产物？

**场景示例：**
- 用户：「生成一篇小红书笔记」
- AI 生成：
  - `note.md` - 笔记文本
  - `cover.jpg` - 封面图
  - `images/1.jpg, 2.jpg` - 配图
- **期望：** 在「小红书工作台」中同时编辑文本和图片

**用户价值：**
- 统一的编辑体验
- 实时预览最终效果
- 减少窗口切换

### 2.2 技术设计

#### 复合工作台接口

```typescript
// 扩展 WorkbenchPlugin 接口
interface CompositeWorkbenchPlugin extends WorkbenchPlugin {
  // 标识这是一个复合工作台
  isComposite: true;

  // 可以处理的产物类型组合
  canHandleGroup(artifacts: Artifact[]): boolean | number;

  // 渲染复合视图
  renderComposite(context: CompositeWorkbenchContext): ReactNode;

  // 生命周期钩子
  onGroupMount?(context: CompositeWorkbenchContext): void;
  onGroupSave?(artifacts: Map<string, string>): Promise<void>;
  onGroupClose?(): void;
}

// 复合工作台上下文
interface CompositeWorkbenchContext extends WorkbenchContext {
  // 多个产物
  artifacts: Artifact[];

  // 读取任意产物
  readArtifact(path: string): Promise<string>;

  // 写入任意产物
  writeArtifact(path: string, content: string): Promise<void>;

  // 批量操作
  readAllArtifacts(): Promise<Map<string, string>>;
  writeAllArtifacts(contents: Map<string, string>): Promise<void>;
}
```

#### 工作台匹配逻辑升级

```typescript
// 扩展 WorkbenchRegistry
class WorkbenchRegistry {
  // 现有方法：单个产物匹配
  findBestMatch(artifact: Artifact): WorkbenchPlugin | null;

  // 新增方法：产物组匹配
  findBestMatchForGroup(artifacts: Artifact[]): CompositeWorkbenchPlugin | null {
    const candidates = Array.from(this.plugins.values())
      .filter(p => 'isComposite' in p && p.isComposite)
      .map(plugin => ({
        plugin: plugin as CompositeWorkbenchPlugin,
        priority: plugin.canHandleGroup(artifacts),
      }))
      .filter(({ priority }) => typeof priority === 'number' && priority > 0)
      .sort((a, b) => (b.priority as number) - (a.priority as number));

    return candidates[0]?.plugin ?? null;
  }
}
```

#### 示例：小红书工作台

```typescript
// 小红书工作台插件
const xiaohongshuWorkbench: CompositeWorkbenchPlugin = {
  id: 'xiaohongshu-workbench',
  name: '小红书工作台',
  version: '1.0.0',
  isComposite: true,

  // 单个产物匹配（回退）
  canHandle(artifact: Artifact): boolean {
    return artifact.path.includes('xiaohongshu') ||
           artifact.metadata?.type === 'xiaohongshu';
  },

  // 产物组匹配
  canHandleGroup(artifacts: Artifact[]): number {
    // 检查是否包含小红书笔记的典型组合
    const hasMarkdown = artifacts.some(a => a.path.endsWith('.md'));
    const hasImages = artifacts.some(a => /\.(jpg|png|jpeg)$/i.test(a.path));

    if (hasMarkdown && hasImages) {
      return 90; // 高优先级
    }

    // 检查元数据标记
    const hasXhsTag = artifacts.some(a =>
      a.metadata?.type === 'xiaohongshu' ||
      a.metadata?.groupType === 'xiaohongshu'
    );

    if (hasXhsTag) {
      return 95; // 更高优先级
    }

    return false;
  },

  // 渲染复合视图
  renderComposite(context: CompositeWorkbenchContext) {
    return <XiaohongshuEditor context={context} />;
  },

  // 保存所有产物
  async onGroupSave(artifacts: Map<string, string>) {
    // 批量保存逻辑
    for (const [path, content] of artifacts) {
      await this.context.writeFile(path, content);
    }
  },
};

// 小红书编辑器组件
function XiaohongshuEditor({ context }: { context: CompositeWorkbenchContext }) {
  const [markdown, setMarkdown] = useState('');
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    // 加载所有产物
    context.readAllArtifacts().then(contents => {
      const mdFile = Array.from(contents.keys()).find(k => k.endsWith('.md'));
      if (mdFile) {
        setMarkdown(contents.get(mdFile) || '');
      }

      const imageFiles = Array.from(contents.keys())
        .filter(k => /\.(jpg|png|jpeg)$/i.test(k));
      setImages(imageFiles);
    });
  }, [context]);

  return (
    <div className="flex h-full">
      {/* 左侧：文本编辑器 */}
      <div className="w-1/2 border-r">
        <MarkdownEditor
          value={markdown}
          onChange={setMarkdown}
        />
      </div>

      {/* 右侧：图片管理 + 预览 */}
      <div className="w-1/2 flex flex-col">
        <ImageGallery images={images} />
        <XiaohongshuPreview
          markdown={markdown}
          images={images}
        />
      </div>
    </div>
  );
}
```

### 2.3 UI 设计

#### 工作台选择器

当点击产物组时，如果有多个工作台可用：

```
┌─────────────────────────────────────┐
│ 选择工作台                           │
├─────────────────────────────────────┤
│                                     │
│ ● 小红书工作台 (推荐)                │
│   统一编辑文本和图片                 │
│                                     │
│ ○ 分别打开                           │
│   在各自的工作台中编辑               │
│                                     │
│ [ 取消 ]              [ 打开 ]      │
└─────────────────────────────────────┘
```

#### 复合工作台布局

```
┌─────────────────────────────────────────────────────────┐
│ 小红书工作台 - AI 文章                          [−][□][×] │
├─────────────────────────────────────────────────────────┤
│ [保存] [导出] [预览]                                     │
├──────────────────────┬──────────────────────────────────┤
│                      │                                  │
│  # AI 的未来         │  ┌────────────────────────────┐  │
│                      │  │                            │  │
│  人工智能正在...      │  │      [封面图预览]          │  │
│                      │  │                            │  │
│  ## 核心技术         │  └────────────────────────────┘  │
│  - 机器学习          │                                  │
│  - 深度学习          │  图片 (3)                        │
│                      │  ┌───┐ ┌───┐ ┌───┐             │
│  ![图片](1.jpg)      │  │ 1 │ │ 2 │ │ 3 │             │
│                      │  └───┘ └───┘ └───┘             │
│                      │                                  │
│  文本编辑器          │  实时预览                        │
│                      │                                  │
└──────────────────────┴──────────────────────────────────┘
```

### 2.4 实施计划

**Step 1: 接口扩展（1 天）**
- [ ] 扩展 `WorkbenchPlugin` 接口添加复合工作台支持
- [ ] 实现 `CompositeWorkbenchContext`
- [ ] 扩展 `WorkbenchRegistry.findBestMatchForGroup()`

**Step 2: 工作台容器升级（2 天）**
- [ ] 创建 `CompositeWorkbenchContainer` 组件
- [ ] 实现产物组加载逻辑
- [ ] 实现批量保存逻辑

**Step 3: 工作台选择器（1 天）**
- [ ] 创建工作台选择对话框
- [ ] 实现「分别打开」回退逻辑

**Step 4: 示例工作台（3-4 天）**
- [ ] 实现小红书工作台（作为参考实现）
- [ ] 文档：复合工作台开发指南

**Step 5: 测试和优化（1 天）**
- [ ] 测试多产物加载性能
- [ ] 测试保存冲突处理
- [ ] 优化内存占用

**总计：8-10 天**

---

## 🔮 Phase 3: 高级特性

### 3.1 产物搜索和过滤

**功能：**
- 按文件名搜索
- 按文件类型过滤
- 按创建时间排序
- 按产物组过滤

**实现：**
```typescript
<ArtifactCenter>
  <SearchBar
    placeholder="搜索产物..."
    onSearch={handleSearch}
  />
  <FilterBar>
    <TypeFilter types={['markdown', 'image', 'video']} />
    <SortDropdown options={['最新', '最旧', '名称']} />
  </FilterBar>
  <ArtifactList />
</ArtifactCenter>
```

### 3.2 产物版本控制

**功能：**
- 保存产物的历史版本
- 查看版本差异
- 回滚到历史版本

**数据结构：**
```typescript
interface ArtifactVersion {
  id: string;
  artifactPath: string;
  content: string;
  timestamp: number;
  author: 'user' | 'ai';
  message?: string;
}
```

### 3.3 产物分享和导出

**功能：**
- 生成产物分享链接
- 导出产物组为 ZIP
- 导出为 PDF/HTML

**API：**
```typescript
POST /api/artifacts/share
{
  "artifactPaths": ["article.md", "cover.png"],
  "expiresIn": 86400  // 24 小时
}
// 返回：{ shareUrl: "https://..." }

POST /api/artifacts/export
{
  "artifactPaths": ["article.md", "cover.png"],
  "format": "zip" | "pdf" | "html"
}
// 返回：{ downloadUrl: "https://..." }
```

### 3.4 产物标签系统

**功能：**
- 为产物添加自定义标签
- 按标签过滤产物
- 标签自动建议

**数据结构：**
```typescript
interface Artifact {
  path: string;
  content?: string;
  metadata?: {
    tags?: string[];  // 新增
  };
}
```

### 3.5 产物模板系统

**功能：**
- 保存产物组为模板
- 从模板创建新产物
- 模板市场

**示例：**
```typescript
// 保存为模板
POST /api/artifact-templates
{
  "name": "小红书笔记模板",
  "description": "包含文本和图片的小红书笔记",
  "artifacts": [
    { "path": "note.md", "content": "# 标题\n\n内容..." },
    { "path": "cover.jpg", "content": "..." }
  ]
}

// 从模板创建
POST /api/threads/{thread_id}/artifacts/from-template
{
  "templateId": "xiaohongshu-note-template"
}
```

---

## 📊 功能优先级矩阵

| 功能 | 用户价值 | 实现复杂度 | 优先级 | 预计工期 |
|------|---------|-----------|--------|---------|
| 产物分组 | 高 | 中 | P0 | 5-7 天 |
| 复合工作台 | 高 | 高 | P1 | 8-10 天 |
| 搜索和过滤 | 中 | 低 | P2 | 2-3 天 |
| 版本控制 | 中 | 高 | P3 | 5-7 天 |
| 分享和导出 | 中 | 中 | P2 | 3-4 天 |
| 标签系统 | 低 | 低 | P3 | 2-3 天 |
| 模板系统 | 低 | 中 | P4 | 4-5 天 |

---

## 🎯 推荐实施顺序

### 第一阶段（MVP 后 2-3 周）
1. **产物分组**（P0）- 解决产物混乱问题
2. **搜索和过滤**（P2）- 提升可用性

### 第二阶段（MVP 后 1-2 个月）
3. **复合工作台**（P1）- 提供高级编辑体验
4. **分享和导出**（P2）- 增强协作能力

### 第三阶段（MVP 后 3-4 个月）
5. **版本控制**（P3）- 提供安全保障
6. **标签系统**（P3）- 增强组织能力

### 第四阶段（按需）
7. **模板系统**（P4）- 提升效率

---

## 🚫 反模式和注意事项

### 产物分组
- ❌ 不要强制所有产物都必须在组中（允许独立产物）
- ❌ 不要自动分组过于激进（给用户控制权）
- ❌ 不要在分组时修改产物路径（保持路径稳定）

### 复合工作台
- ❌ 不要让复合工作台过于复杂（保持简单）
- ❌ 不要强制使用复合工作台（提供「分别打开」选项）
- ❌ 不要在复合工作台中实现所有功能（专注核心场景）

### 性能
- ❌ 不要一次性加载所有产物内容（按需加载）
- ❌ 不要在列表中渲染大文件预览（使用缩略图）
- ❌ 不要频繁保存（使用防抖）

---

## 📚 参考资料

### 类似产品
- **Notion**：页面分组和数据库视图
- **Figma**：多文件协作和组件系统
- **VS Code**：工作区和多文件编辑
- **Obsidian**：笔记链接和图谱

### 技术参考
- **拖拽排序**：`@dnd-kit/core`
- **虚拟列表**：`react-window` 或 `@tanstack/react-virtual`
- **文件预览**：`react-pdf`, `react-image-lightbox`
- **版本对比**：`diff` 或 `monaco-editor` 的 diff 功能

---

## 📝 总结

本路线图规划了产物中心从 MVP 到完整功能的演进路径：

1. **MVP（已完成）**：基础产物列表 + 工作台集成
2. **Phase 1（5-7 天）**：产物分组 - 解决混乱问题
3. **Phase 2（8-10 天）**：复合工作台 - 提供高级体验
4. **Phase 3（按需）**：搜索、版本、分享等高级特性

**核心原则：**
- 渐进式实现，每个阶段都可独立交付
- 用户价值优先，避免过度设计
- 保持简单，专注核心场景
- 向后兼容，不破坏现有功能

**下一步行动：**
1. 等待 MVP 完成并收集用户反馈
2. 根据反馈调整 Phase 1 的优先级
3. 开始 Phase 1 的详细设计和开发
