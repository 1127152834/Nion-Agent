# RSS模块与Folo项目对齐实施计划

## Phase 0: 文档发现与API清单

### Folo项目核心组件（已验证）

**3D角色系统**
- 文件: `apps/desktop/layer/renderer/src/modules/ai-chat/components/3d-models/AISplineLoader.tsx`
- 依赖: `@splinetool/react-spline` (^4.0.0)
- 核心API:
  ```typescript
  <Spline scene={splineUrl} onLoad={handleLoad} />
  app.findObjectByName("Folo Character_V3")
  head.rotation.x / head.rotation.y // 鼠标跟踪旋转
  ```

**聊天消息组件**
- 文件: `apps/desktop/layer/renderer/src/modules/ai-chat/components/message/AIChatMessage.tsx`
- 依赖: `react-markdown`, `remark-gfm`, `react-syntax-highlighter`
- 关键功能: Markdown渲染、代码高亮、复制按钮、Token使用显示

**动画系统**
- 依赖: `framer-motion` (^12.0.0)
- 模式: `motion.div` + `AnimatePresence` + `variants`

**状态管理**
- 依赖: `jotai` (^2.10.6)
- 模式: `atom()` + `useAtom()` + `useAtomValue()`

### Nion-Agent系统能力（已验证）

**Agent系统**
- API文件: `frontend/src/core/agents/api.ts`
- 接口: `listAgents()`, `getAgent()`, `createAgent()`, `updateAgent()`, `deleteAgent()`
- Agent结构:
  ```typescript
  interface Agent {
    name: string;
    description: string;
    model: string | null;
    tool_groups: string[] | null;
    soul?: string | null; // 人设定义
  }
  ```

**聊天基础设施**
- Hook: `useThreadStream()` (frontend/src/core/threads/hooks.ts)
- 返回: `{ thread, sendMessage, optimisticMessages }`
- 后端: LangGraph线程架构 + 中间件链

**主题系统**
- 文件: `frontend/src/styles/globals.css`
- 颜色空间: oklch
- CSS变量: `--primary`, `--background`, `--foreground` 等

**当前RSS助手**
- 文件: `frontend/src/components/rss/assistant/floating-entry-assistant.tsx`
- 宽度: 520px 固定定位
- 已集成: useThreadStream()

### 禁用API（反模式防护）

❌ 不存在的API:
- Folo的 `useAIChat()` - 需要用 `useThreadStream()` 替代
- Folo的 `@follow/shared/jotai` - 需要用标准 `jotai` 替代
- Folo的 `useEntryReadHistory()` - 需要自行实现或简化

---

## Phase 1: 3D角色系统集成

### 任务1.1: 安装Spline依赖
```bash
cd frontend && pnpm add @splinetool/react-spline@^4.0.0
```

### 任务1.2: 复制3D角色组件
**源文件**: Folo的 `AISplineLoader.tsx`
**目标**: `frontend/src/components/rss/assistant/ai-character-3d.tsx`

**复制内容**:
- 完整的 `AISplineLoader` 组件逻辑
- `calculateHeadRotation` 函数
- `clamp` 工具函数
- 鼠标跟踪事件监听器

**必须修改**:
- Spline场景URL改为系统配置路径
- 角色对象名称改为 `"Reading Assistant Character"`
- 移除Folo特定的样式类，使用Tailwind

### 任务1.3: 主题适配
在 `globals.css` 中添加:
```css
.ai-character-container {
  background: oklch(var(--background));
  border: 1px solid oklch(var(--border));
}
```

**验证清单**:
- [ ] 3D角色正常加载
- [ ] 鼠标移动时头部跟随旋转
- [ ] 角色颜色与系统主题一致
- [ ] 无控制台错误

---

## Phase 2: 聊天UI组件迁移

### 任务2.1: 安装Markdown依赖
```bash
cd frontend && pnpm add react-markdown remark-gfm react-syntax-highlighter @types/react-syntax-highlighter
```

### 任务2.2: 创建消息组件
**源文件**: Folo的 `AIChatMessage.tsx`
**目标**: `frontend/src/components/rss/assistant/assistant-message.tsx`

**复制内容**:
- Markdown渲染配置
- 代码块高亮逻辑
- 复制按钮组件
- 消息容器布局

**必须修改**:
- 颜色方案改为 `oklch(var(--primary))` 等系统变量
- 移除Token使用显示（简化版不需要）
- 移除Folo的 `cn()` 工具，使用系统的 `@/lib/utils`

### 任务2.3: 创建输入框组件
**目标**: `frontend/src/components/rss/assistant/assistant-input.tsx`

**复制Folo模式**:
- Textarea自动高度调整
- 发送按钮状态管理
- 快捷键支持（Enter发送，Shift+Enter换行）

**集成系统API**:
```typescript
const { sendMessage } = useThreadStream(threadId);
const handleSend = () => sendMessage(inputValue);
```

**验证清单**:
- [ ] Markdown正确渲染（标题、列表、代码块）
- [ ] 代码高亮正常工作
- [ ] 复制按钮功能正常
- [ ] 输入框自动调整高度
- [ ] 消息发送成功

---

## Phase 3: 动画系统实现

### 任务3.1: 安装Framer Motion
```bash
cd frontend && pnpm add framer-motion@^12.0.0
```

### 任务3.2: 复制动画变体
**源文件**: Folo的消息组件动画配置
**目标**: `frontend/src/components/rss/assistant/animations.ts`

**复制内容**:
```typescript
export const messageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 }
};

export const characterVariants = {
  idle: { scale: 1 },
  thinking: { scale: [1, 1.05, 1], transition: { repeat: Infinity } }
};
```

### 任务3.3: 应用动画到组件
在 `assistant-message.tsx` 中:
```typescript
import { motion, AnimatePresence } from 'framer-motion';
import { messageVariants } from './animations';

<AnimatePresence>
  <motion.div variants={messageVariants} initial="initial" animate="animate">
    {/* 消息内容 */}
  </motion.div>
</AnimatePresence>
```

**验证清单**:
- [ ] 消息出现时有淡入+上移动画
- [ ] 消息消失时有淡出动画
- [ ] 角色在思考时有呼吸动画
- [ ] 动画流畅无卡顿

---

## Phase 4: 阅读助手Agent创建

### 任务4.1: 定义助手人设
**目标**: `backend/src/agents/souls/reading_assistant.md`

**内容模板**:
```markdown
# 阅读助手人设

你是一个充满好奇心的阅读助手，名叫Folo。你有以下特点：

## 性格特征
- 热爱探索和学习新知识
- 对用户的问题充满兴趣，会主动深入研究
- 有自己的观点和看法，不只是复述信息
- 善于从多个角度分析问题

## 行为模式
- 遇到不确定的信息会主动搜索验证
- 会引用具体的来源和证据
- 善于用类比和例子解释复杂概念
- 会提出启发性的后续问题

## 回答风格
- 简洁但不失深度
- 结构清晰（使用标题、列表）
- 适当使用emoji增加亲和力
- 避免过于正式或机械的语气
```

### 任务4.2: 创建专用Agent
使用系统API创建:
```typescript
const readingAssistant = await createAgent({
  name: "reading_assistant",
  description: "RSS阅读助手 - 帮助用户理解和探索文章内容",
  model: "claude-opus-4-6",
  tool_groups: ["web_search", "web_fetch", "memory"],
  soul: readingSoulContent
});
```

### 任务4.3: 集成到RSS助手组件
在 `floating-entry-assistant.tsx` 中:
```typescript
const READING_ASSISTANT_AGENT = "reading_assistant";

const { thread, sendMessage } = useThreadStream(threadId, {
  agent: READING_ASSISTANT_AGENT
});
```

**验证清单**:
- [ ] Agent成功创建
- [ ] 人设文件正确加载
- [ ] 工具组正确配置（搜索、抓取、记忆）
- [ ] 助手回答符合人设特征

---

## Phase 5: 完整UI组装

### 任务5.1: 重构浮动助手组件
**文件**: `frontend/src/components/rss/assistant/floating-entry-assistant.tsx`

**新结构**:
```typescript
<div className="fixed right-4 top-20 w-[520px] h-[calc(100vh-6rem)]">
  {/* 3D角色区域 */}
  <AICharacter3D className="h-48" />

  {/* 聊天区域 */}
  <div className="flex-1 overflow-y-auto">
    <AnimatePresence>
      {messages.map(msg => (
        <AssistantMessage key={msg.id} message={msg} />
      ))}
    </AnimatePresence>
  </div>

  {/* 输入区域 */}
  <AssistantInput onSend={handleSend} />
</div>
```

### 任务5.2: 状态管理迁移
使用Jotai替代现有状态:
```typescript
import { atom, useAtom } from 'jotai';

const assistantOpenAtom = atom(false);
const currentEntryAtom = atom<string | null>(null);

export function useAssistant() {
  const [isOpen, setOpen] = useAtom(assistantOpenAtom);
  const [entryId, setEntryId] = useAtom(currentEntryAtom);
  return { isOpen, setOpen, entryId, setEntryId };
}
```

### 任务5.3: 响应式布局
添加移动端适配:
```css
@media (max-width: 768px) {
  .floating-assistant {
    width: 100vw;
    right: 0;
    top: 0;
    height: 100vh;
  }
}
```

**验证清单**:
- [ ] 所有组件正确组装
- [ ] 布局在不同屏幕尺寸下正常
- [ ] 状态管理正常工作
- [ ] 无样式冲突

---

## Phase 6: 功能增强与集成

### 任务6.1: 上下文感知
在发送消息时自动附加文章上下文:
```typescript
const handleSend = async (message: string) => {
  const context = {
    entryTitle: currentEntry.title,
    entryUrl: currentEntry.url,
    selectedText: window.getSelection()?.toString()
  };

  const enrichedMessage = `
文章: ${context.entryTitle}
链接: ${context.entryUrl}
${context.selectedText ? `选中文本: ${context.selectedText}` : ''}

问题: ${message}
  `;

  await sendMessage(enrichedMessage);
};
```

### 任务6.2: 搜索增强
确保Agent配置包含web_search工具组，使其能主动搜索:
```typescript
// 在人设中强调
"当遇到需要最新信息或验证的内容时，你应该主动使用搜索工具。"
```

### 任务6.3: 记忆集成
利用系统Memory v2能力:
```typescript
// Agent自动记录用户的阅读偏好和历史问题
tool_groups: ["web_search", "web_fetch", "memory"]
```

**验证清单**:
- [ ] 助手能感知当前阅读的文章
- [ ] 助手会主动搜索相关信息
- [ ] 助手能记住用户的阅读偏好
- [ ] 上下文正确传递

---

## Phase 7: 本地化与配色

### 任务7.1: 添加中文翻译
**文件**: `frontend/src/core/i18n/locales/zh-CN.ts`

```typescript
rss: {
  assistant: {
    title: "阅读助手",
    placeholder: "问我任何关于这篇文章的问题...",
    thinking: "思考中...",
    searching: "搜索相关信息...",
    empty: "开始对话，我会帮你深入理解这篇文章"
  }
}
```

### 任务7.2: 主题变量应用
确保所有颜色使用系统变量:
```typescript
// ✅ 正确
className="bg-primary text-primary-foreground"

// ❌ 错误
className="bg-blue-500 text-white"
```

### 任务7.3: 暗色模式测试
验证在 `dark` 模式下所有组件正常显示。

**验证清单**:
- [ ] 所有文本已本地化
- [ ] 颜色使用系统主题变量
- [ ] 暗色模式下无可读性问题
- [ ] 无硬编码颜色

---

## Phase 8: 最终验证

### 验证8.1: 功能测试
- [ ] 3D角色加载并响应鼠标
- [ ] 消息发送和接收正常
- [ ] Markdown和代码高亮正常
- [ ] 动画流畅
- [ ] Agent回答符合人设
- [ ] 主动搜索功能工作
- [ ] 上下文感知正确

### 验证8.2: 性能测试
- [ ] 3D角色加载时间 < 2秒
- [ ] 消息渲染无卡顿
- [ ] 动画帧率 > 30fps
- [ ] 内存使用合理

### 验证8.3: 反模式检查
使用Grep检查禁用API:
```bash
grep -r "useAIChat" frontend/src/components/rss/
grep -r "@follow/shared" frontend/src/components/rss/
grep -r "useEntryReadHistory" frontend/src/components/rss/
```
应该无结果。

### 验证8.4: 代码质量
```bash
cd frontend && pnpm lint
cd frontend && pnpm type-check
```

### 验证8.5: 用户测试
- [ ] 打开RSS文章详情页
- [ ] 点击阅读助手
- [ ] 提问："这篇文章的主要观点是什么？"
- [ ] 验证助手是否主动搜索相关信息
- [ ] 验证回答是否有个性和深度

---

## 实施注意事项

### 复制优先原则
- 直接复制Folo的组件逻辑，不要重写
- 只修改API调用和样式变量
- 保持原有的交互逻辑

### 依赖版本控制
- 使用与Folo相同的主版本号
- 记录所有新增依赖到 `package.json`

### 渐进式集成
- 每个Phase独立可测试
- 完成一个Phase后再开始下一个
- 遇到问题立即回退到上一个稳定状态

### 文档同步
- 更新 `AGENTS.md` 记录新Agent
- 更新 `README.md` 说明新功能
- 创建 `docs/RSS_ASSISTANT_GUIDE.md` 用户指南

---

## 预期成果

完成后，RSS模块将拥有：
1. ✅ 与Folo完全一致的3D角色和动画效果
2. ✅ 相同的聊天UI风格（使用系统配色）
3. ✅ 简化的Q&A功能（无需完整对话历史）
4. ✅ 增强的Agent能力（主动搜索、记忆、个性化）
5. ✅ 固定的阅读助手人设（有观点、有性格）

## 技术栈对比

| 组件 | Folo | Nion-Agent |
|------|------|------------|
| 3D渲染 | @splinetool/react-spline | ✅ 相同 |
| 动画 | framer-motion | ✅ 相同 |
| 状态 | jotai | ✅ 相同 |
| Markdown | react-markdown | ✅ 相同 |
| 聊天后端 | 自定义 | LangGraph + Agent系统 |
| 主题 | CSS变量 | oklch + CSS变量 |
| AI能力 | 基础LLM | Agent + 工具组 + 人设 |
