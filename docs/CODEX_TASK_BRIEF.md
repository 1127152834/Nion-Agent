# RSS 阅读器开发任务简报

## 任务背景

我们正在将 Folo (https://github.com/RSSNext/Follow) 的 RSS 阅读器功能移植到 Nion-Agent 系统中，作为一个新的菜单模块。

**核心目标**：
1. 让用户可以便捷地订阅和阅读 RSS 资讯
2. 在文章阅读页面中与 AI 聊天（基于文章上下文）
3. 支持文本选择后直接问 AI
4. 复刻 Folo 的核心业务逻辑和 UI/UX，但适配到 Nion-Agent 的技术栈

**重要约束**：
- ❌ 不使用 Folo 的 API，所有数据都是系统内部的
- ❌ 不实现社交功能（趋势、热度、社区数据等）
- ❌ 暂不考虑离线功能
- ✅ 使用 Nion-Agent 的配色系统（Radix UI）
- ✅ 适配到 Nion-Agent 的技术栈（Next.js + LangGraph）

## 技术栈对比

### Folo 原始技术栈
- React 19 + Vite + Electron
- Zustand + Jotai + TanStack Query
- Vercel AI SDK
- SQLite + Drizzle ORM
- Tailwind CSS (Apple UIKit tokens)

### Nion-Agent 目标技术栈
- Next.js 16 + React 19
- TanStack Query + localStorage
- LangGraph SDK（不是 Vercel AI SDK）
- 后端 API（不是 SQLite）
- Tailwind CSS 4 (Radix UI tokens)

## 参考资源

### 1. Folo 源码参考
位置：`.folo-reference/`（已克隆到项目根目录）

**关键文件索引**：
- 数据模型：`.folo-reference/packages/internal/database/src/schemas/index.ts:9-147`
- Feed 获取：`.folo-reference/packages/internal/store/src/modules/feed/store.ts:105-134`
- Entry 分页：`.folo-reference/packages/internal/store/src/modules/entry/store.ts:465-555`
- 文章布局：`.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx`
- 上下文块：`.folo-reference/apps/desktop/layer/renderer/src/modules/ai-chat/store/slices/block.slice.ts:27-199`
- 文本选择：`.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx:61-87`

### 2. 实施计划
位置：`docs/RSS_READER_IMPLEMENTATION_PLAN.md`

包含 6 个阶段的详细实施步骤，每个阶段都标注了要参考的 Folo 源码位置。

### 3. Nion-Agent 架构参考
- 前端路由：`frontend/src/app/workspace/chats/`
- 后端路由：`backend/src/gateway/routers/threads.py`
- 聊天组件：`frontend/src/components/workspace/chats/chat-box.tsx`
- 线程 hooks：`frontend/src/core/threads/hooks.ts`
- Agent 实现：`backend/src/agents/lead_agent/agent.py`

## 执行要求

### 工作环境
**必须在新的 git worktree 中执行任务**，避免污染主项目代码：

```bash
# 创建新的 worktree
git worktree add ../nion-agent-rss-feature feature/rss-reader

# 在 worktree 中工作
cd ../nion-agent-rss-feature
```

### 实施顺序
按照 `docs/RSS_READER_IMPLEMENTATION_PLAN.md` 中的 6 个阶段依次执行：

1. **Phase 1: 后端 RSS 基础设施**（2-3天）
   - 数据库模型
   - RSS 解析器（使用 Python feedparser）
   - API 端点
   - 后台刷新任务

2. **Phase 2: 前端 RSS 阅读器 UI**（3-4天）
   - 路由结构
   - 订阅源列表
   - 文章列表（无限滚动）
   - 文章阅读器（ShadowDOM 隔离）
   - 菜单集成

3. **Phase 3: AI 上下文集成**（1-2天）
   - 上下文块系统
   - 自动添加文章上下文
   - 传递到 LangGraph
   - 后端处理上下文

4. **Phase 4: 文本选择 AI**（1天）
   - 文本选择检测
   - AI 工具栏
   - 集成到聊天系统

5. **Phase 5: 增强 AI 功能**（2-3天）
   - 思维链展示
   - AI 摘要
   - AI 翻译
   - 收藏功能

6. **Phase 6: 验证和优化**（1-2天）
   - 端到端测试
   - UI/UX 优化
   - 性能优化

### 关键原则

1. **参考而非复制**：理解 Folo 的业务逻辑和 UI 模式，然后用 Nion-Agent 的技术栈重新实现
2. **适配技术栈**：
   - Zustand/Jotai → TanStack Query + useState
   - Vercel AI SDK → LangGraph SDK
   - SQLite → 后端 API
   - Apple UIKit tokens → Radix UI tokens
3. **保持简洁**：只实现核心功能，不要过度工程化
4. **配色一致**：使用 Nion-Agent 现有的 Radix UI 颜色变量
5. **验证每个阶段**：每完成一个阶段，运行测试确认功能正常

### 验证清单

每个阶段完成后，必须验证：
- [ ] 代码编译通过（TypeScript 无错误）
- [ ] 功能正常工作（手动测试）
- [ ] UI 使用 Nion-Agent 配色
- [ ] 没有引入新的依赖冲突
- [ ] Git commit 记录清晰

## 交付物

完成后应该有：
1. 后端 RSS API 端点（`backend/src/gateway/routers/rss.py`）
2. 前端 RSS 阅读器页面（`frontend/src/app/workspace/rss/`）
3. RSS 相关组件（`frontend/src/components/rss/`）
4. AI 上下文集成（修改现有 threads hooks）
5. 完整的端到端测试通过
6. 清晰的 Git commit 历史

## 开始执行

请按照以下步骤开始：

1. 创建新的 worktree：`git worktree add ../nion-agent-rss-feature feature/rss-reader`
2. 切换到 worktree：`cd ../nion-agent-rss-feature`
3. 阅读实施计划：`docs/RSS_READER_IMPLEMENTATION_PLAN.md`
4. 从 Phase 1 开始执行
5. 每完成一个阶段，commit 一次
6. 遇到问题时，参考 `.folo-reference/` 中的源码

祝顺利！
