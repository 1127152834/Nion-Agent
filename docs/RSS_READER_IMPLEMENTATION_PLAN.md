# RSS 阅读器实施计划

## 参考源码位置
Folo 源码已克隆到：`.folo-reference/`

## Phase 0: 文档发现 ✅

已完成 Folo 和 Nion-Agent 架构研究。

## Phase 1: 后端 RSS 基础设施

### 1.1 数据库模型
**文件**: `backend/src/database/models/rss.py` (新建)

**参考 Folo**: `.folo-reference/packages/internal/database/src/schemas/index.ts:9-147`

**复制模式**:
- feedsTable (lines 9-24): Feed 模型结构
- entriesTable (lines 85-111): Entry 模型结构
- summariesTable (lines 120-130): Summary 模型结构
- translationsTable (lines 132-147): Translation 模型结构

**实现**:
```python
# Feed 模型
class Feed(Base):
    id: str
    title: str
    url: str  # RSS feed URL
    site_url: str
    description: str
    image: str
    category: str
    created_at: datetime
    updated_at: datetime

# Entry 模型
class Entry(Base):
    id: str
    feed_id: str
    title: str
    url: str
    content: str  # HTML
    description: str
    author: str
    published_at: datetime
    read: bool
    starred: bool
    created_at: datetime
```

**验证**: 运行迁移，检查表创建

### 1.2 RSS 解析器
**文件**: `backend/src/services/rss_parser.py` (新建)

**参考 Folo**: `.folo-reference/packages/internal/store/src/modules/feed/store.ts:105-134`

**复制逻辑**:
```typescript
// Folo 的 feed 获取逻辑
async fetchFeedById({ id, url }: FeedQueryParams) {
  const res = await api().feeds.get({ id, url })
  const finalData = {
    ...res.data.feed,
    updatesPerWeek: res.data.analytics?.updatesPerWeek,
    subscriptionCount: res.data.analytics?.subscriptionCount,
    latestEntryPublishedAt: res.data.analytics?.latestEntryPublishedAt,
  }
  feedActions.upsertMany([finalData])
  return { ...res.data, ...feed }
}
```

**实现**:
```python
import feedparser

def parse_rss_feed(url: str) -> dict:
    """解析 RSS feed，返回 feed 元数据和 entries"""
    feed = feedparser.parse(url)

    return {
        'feed': {
            'title': feed.feed.title,
            'url': url,
            'site_url': feed.feed.link,
            'description': feed.feed.description,
            'image': feed.feed.image.href if hasattr(feed.feed, 'image') else None,
        },
        'entries': [
            {
                'title': entry.title,
                'url': entry.link,
                'content': entry.content[0].value if hasattr(entry, 'content') else entry.summary,
                'description': entry.summary,
                'author': entry.author if hasattr(entry, 'author') else None,
                'published_at': entry.published_parsed,
            }
            for entry in feed.entries
        ]
    }
```

**验证**: 测试解析 Hacker News RSS

### 1.3 API 端点
**文件**: `backend/src/gateway/routers/rss.py` (新建)

**参考 Nion-Agent**: `backend/src/gateway/routers/threads.py`

**端点列表**:
```python
POST   /api/rss/feeds              # 添加订阅源
GET    /api/rss/feeds              # 获取订阅源列表
GET    /api/rss/feeds/{feed_id}    # 获取单个订阅源
DELETE /api/rss/feeds/{feed_id}    # 删除订阅源
GET    /api/rss/entries            # 获取文章列表
GET    /api/rss/entries/{entry_id} # 获取单篇文章
PUT    /api/rss/entries/{entry_id} # 更新文章状态
POST   /api/rss/feeds/{feed_id}/refresh  # 刷新订阅源
```

**验证**: curl 测试所有端点

---

## Phase 2: 前端 RSS 阅读器 UI

### 2.1 路由结构
**文件**:
- `frontend/src/app/workspace/rss/layout.tsx` (新建)
- `frontend/src/app/workspace/rss/page.tsx` (新建)
- `frontend/src/app/workspace/rss/entries/page.tsx` (新建)
- `frontend/src/app/workspace/rss/entries/[entry_id]/page.tsx` (新建)

**参考 Nion-Agent**: `frontend/src/app/workspace/chats/` 结构

**验证**: 访问 `/workspace/rss`

### 2.2 订阅源列表
**文件**: `frontend/src/components/rss/feed-list.tsx` (新建)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/feed-column/`

**复制 UI 模式**:
- 左侧边栏布局
- Feed 项显示：图标 + 标题 + 未读数徽章
- 添加订阅源对话框

**关键代码参考**:
- Feed 列表渲染逻辑
- 未读数计算和显示

**配色**: 使用 Nion-Agent 的 Radix UI 颜色变量

**验证**: 添加/删除订阅源

### 2.3 文章列表
**文件**: `frontend/src/components/rss/entry-list.tsx` (新建)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-column/`

**参考 Folo 分页逻辑**: `.folo-reference/packages/internal/store/src/modules/entry/store.ts:465-555`

**复制模式**:
```typescript
// Folo 的无限滚动实现
export const useEntries = ({
  level,
  id,
  view,
}: {
  level?: string
  id?: number | string
  view?: number
}) => {
  const { data, ...rest } = useInfiniteQuery({
    queryKey: ["entries", level, id, view],
    queryFn: async ({ pageParam }) => {
      const res = await api().entries.list({
        level,
        id,
        view,
        publishedAfter: pageParam,  // 游标分页
      })
      return res.data
    },
    getNextPageParam: (lastPage) => lastPage.cursor,
  })

  return { entries: data?.pages.flatMap(p => p.entries), ...rest }
}
```

**实现**:
- TanStack Query 的 useInfiniteQuery
- 游标分页（publishedAfter）
- 筛选器（全部/未读/已收藏）
- 卡片式布局

**配色**: 使用 Nion-Agent 配色

**验证**: 滚动加载更多

### 2.4 文章阅读器
**文件**: `frontend/src/components/rss/entry-reader.tsx` (新建)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx`

**复制关键模式**:

1. **ShadowDOM 隔离** (line 126):
```typescript
const shadowRoot = containerRef.current.attachShadow({ mode: 'open' })
shadowRoot.innerHTML = `
  <style>
    /* 文章样式 */
  </style>
  <div class="article-content">
    ${entry.content}
  </div>
`
```

2. **布局结构**:
- 左侧文章内容（60%）
- 右侧 AI 聊天面板（40%）
- 使用 `react-resizable-panels`

**参考 Nion-Agent**: `frontend/src/components/workspace/chats/chat-box.tsx` 的聊天面板

**配色**: 使用 Nion-Agent 配色

**验证**: 打开文章，内容正常显示

### 2.5 菜单集成
**文件**: `frontend/src/components/workspace/workspace-nav-menu.tsx` (修改)

**添加**:
```tsx
<SidebarMenuItem>
  <SidebarMenuButton asChild>
    <Link href="/workspace/rss/entries">
      <Newspaper className="h-4 w-4" />
      <span>资讯</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
```

**验证**: 点击菜单跳转

---

## Phase 3: AI 上下文集成

### 3.1 上下文块系统
**文件**: `frontend/src/core/rss/context.ts` (新建)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/ai-chat/store/slices/block.slice.ts`

**复制核心逻辑** (lines 27-199):
```typescript
// Folo 的 block 类型定义
export const BlockSliceAction = {
  SPECIAL_TYPES: {
    mainView: "main-view",
    mainEntry: "main-entry",
    mainFeed: "main-feed",
    unreadOnly: "unread-only",
  },
}

// 只允许一个 special type block
const addOrUpdateBlock = (block: Block) => {
  if (isSpecialType(block.type)) {
    // 移除其他 special type blocks
    const filtered = blocks.filter(b => !isSpecialType(b.type))
    return [...filtered, block]
  }
  return [...blocks, block]
}
```

**实现**:
```typescript
type ContextBlock = {
  id: string
  type: 'mainEntry' | 'mainFeed'
  value: string
  metadata?: {
    title?: string
    url?: string
    summary?: string
  }
}

export function useRSSContext() {
  const [blocks, setBlocks] = useState<ContextBlock[]>([])

  const addBlock = (block: ContextBlock) => {
    // 只保留一个 mainEntry/mainFeed
    setBlocks(prev => {
      const filtered = prev.filter(b => b.type !== block.type)
      return [...filtered, block]
    })
  }

  return { blocks, addBlock, removeBlock, clearBlocks }
}
```

**验证**: React DevTools 查看状态

### 3.2 自动添加文章上下文
**文件**: `frontend/src/components/rss/entry-reader.tsx` (修改)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/EntryContent.tsx:102-112`

**复制模式**:
```typescript
const { addOrUpdateBlock, removeBlock } = useBlockActions()

useEffect(() => {
  addOrUpdateBlock({
    id: BlockSliceAction.SPECIAL_TYPES.mainEntry,
    type: "mainEntry",
    value: entryId,
  })

  return () => {
    removeBlock(BlockSliceAction.SPECIAL_TYPES.mainEntry)
  }
}, [addOrUpdateBlock, entryId, removeBlock])
```

**实现**:
```typescript
const { addBlock, removeBlock } = useRSSContext()

useEffect(() => {
  addBlock({
    id: 'mainEntry',
    type: 'mainEntry',
    value: entryId,
    metadata: {
      title: entry.title,
      url: entry.url,
      summary: entry.description,
    }
  })

  return () => removeBlock('mainEntry')
}, [entryId])
```

**验证**: 打开文章，检查 context

### 3.3 传递上下文到 LangGraph
**文件**: `frontend/src/core/threads/hooks.ts` (修改)

**修改**: `useSubmitThread` 函数

**实现**:
```typescript
const { blocks } = useRSSContext()

const submitMessage = async (content: string) => {
  const metadata = {
    rss_context: blocks.map(block => ({
      type: block.type,
      entry_id: block.value,
      title: block.metadata?.title,
      url: block.metadata?.url,
      summary: block.metadata?.summary,
    }))
  }

  await client.threads.messages.create(threadId, {
    content,
    metadata,
  })
}
```

**验证**: 后端日志查看 metadata

### 3.4 后端处理上下文
**文件**: `backend/src/agents/lead_agent/agent.py` (修改)

**实现**:
```python
if 'rss_context' in message.metadata:
    rss_context = message.metadata['rss_context']

    for block in rss_context:
        if block['type'] == 'mainEntry':
            entry = get_entry_by_id(block['entry_id'])

            # 添加到系统提示
            context_prompt = f"""
            用户正在阅读文章：
            标题：{entry.title}
            链接：{entry.url}
            摘要：{entry.description}

            如果用户的问题与这篇文章相关，请基于文章内容回答。
            """
            # 添加到 AI 上下文
```

**验证**: 问 AI "总结这篇文章"

---

## Phase 4: 文本选择 AI

### 4.1 文本选择检测
**文件**: `frontend/src/components/rss/entry-reader.tsx` (修改)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx:61-87`

**复制逻辑**:
```typescript
const handleTextSelection = useCallback(() => {
  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()

  if (selectedText && selectedText.length > 0) {
    const range = selection.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    setTextSelection({
      selectedText,
      timestamp: Date.now(),
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
    })
  } else {
    setTextSelection(null)
  }
}, [])

useEffect(() => {
  document.addEventListener('mouseup', handleTextSelection)
  return () => document.removeEventListener('mouseup', handleTextSelection)
}, [handleTextSelection])
```

**验证**: 选中文本，console 查看状态

### 4.2 AI 工具栏
**文件**: `frontend/src/components/rss/text-selection-toolbar.tsx` (新建)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx:147-152`

**UI 参考**:
- 浮动工具栏
- 出现在选中文本上方
- 按钮：问 AI、翻译、总结

**使用 Nion-Agent 组件**:
- Button from `@/components/ui/button`
- Tooltip from `@/components/ui/tooltip`

**配色**: Nion-Agent 配色

**验证**: 工具栏位置正确

### 4.3 集成聊天
**文件**: `frontend/src/components/rss/entry-reader.tsx` (修改)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx:73-87`

**复制逻辑**:
```typescript
const handleAskAI = useCallback((selectionEvent?: TextSelectionEvent) => {
  const pendingSelection = selectionEvent ?? textSelection
  if (!pendingSelection?.selectedText) return

  queueSelectedTextInsertion({
    text: pendingSelection.selectedText,
    sourceEntryId: entryId,
    timestamp: pendingSelection.timestamp,
  })

  setAIPanelVisibility(true)
  handleSelectionClear()
}, [entryId, handleSelectionClear, textSelection])
```

**实现**:
```typescript
const handleAskAI = (text: string) => {
  setChatPanelOpen(true)
  submitMessage(`关于这段文字："${text}"，请解释一下。`)
  setTextSelection(null)
}
```

**验证**: 选中文本 → 问 AI → 聊天面板打开

---

## Phase 5: 增强 AI 功能

### 5.1 思维链展示
**文件**: `frontend/src/components/workspace/messages/message-item.tsx` (修改)

**参考 Folo**: `.folo-reference/apps/desktop/layer/renderer/src/modules/ai-chat/components/displays/AIChainOfThought.tsx`

**复制 UI 模式** (lines 79-98):
```typescript
<div className="reasoning-container">
  <div className="reasoning-header">
    <span>思考中...</span>
    <ShinyText />
  </div>
  <div className="reasoning-content">
    {currentReasoning}
  </div>
</div>
```

**使用 Nion-Agent 组件**:
- Collapsible from `@/components/ui/collapsible`

**配色**: Nion-Agent 配色

**验证**: 查看思维链展示

### 5.2 AI 摘要
**文件**: `frontend/src/components/rss/entry-reader.tsx` (修改)

**后端**: `backend/src/gateway/routers/rss.py` (修改)

**实现**:
```python
@router.post("/entries/{entry_id}/summarize")
async def summarize_entry(entry_id: str):
    entry = get_entry_by_id(entry_id)

    # 检查缓存
    existing = get_summary(entry_id)
    if existing:
        return existing

    # 生成摘要
    summary = await generate_summary(entry.content)
    save_summary(entry_id, summary)

    return summary
```

**验证**: 生成摘要

### 5.3 AI 翻译
**文件**: `frontend/src/components/rss/entry-reader.tsx` (修改)

**后端**: `backend/src/gateway/routers/rss.py` (修改)

**实现**: 类似摘要功能

**验证**: 切换语言

### 5.4 收藏功能
**文件**: `frontend/src/components/rss/entry-list.tsx` (修改)

**实现**:
- 星标图标
- 切换收藏状态
- 收藏筛选

**验证**: 收藏文章

---

## Phase 6: 验证和优化

### 6.1 端到端测试
- [ ] 添加订阅源
- [ ] 刷新获取文章
- [ ] 文章列表分页
- [ ] 标记已读/收藏
- [ ] 打开文章
- [ ] 文本选择 AI
- [ ] AI 理解文章上下文
- [ ] 生成摘要
- [ ] 翻译
- [ ] 思维链展示

### 6.2 UI/UX 优化
- 加载状态（骨架屏）
- 错误提示（Toast）
- 空状态
- 响应式设计
- 暗色模式

### 6.3 性能优化
- 虚拟滚动
- 图片懒加载
- 缓存策略
- 数据库索引

---

## 实施顺序

1. Phase 1: 后端基础设施（2-3 天）
2. Phase 2: 前端 UI（3-4 天）
3. Phase 3: AI 上下文集成（1-2 天）
4. Phase 4: 文本选择 AI（1 天）
5. Phase 5: 增强功能（2-3 天）
6. Phase 6: 测试优化（1-2 天）

**总计**: 约 10-15 天

---

## 关键参考文件索引

### Folo 核心文件
- Feed 数据模型: `.folo-reference/packages/internal/database/src/schemas/index.ts:9-147`
- Feed 获取逻辑: `.folo-reference/packages/internal/store/src/modules/feed/store.ts:105-134`
- Entry 分页逻辑: `.folo-reference/packages/internal/store/src/modules/entry/store.ts:465-555`
- 文章布局: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx`
- 上下文块系统: `.folo-reference/apps/desktop/layer/renderer/src/modules/ai-chat/store/slices/block.slice.ts:27-199`
- 文章上下文注入: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/EntryContent.tsx:102-112`
- 文本选择: `.folo-reference/apps/desktop/layer/renderer/src/modules/entry-content/components/layouts/ArticleLayout.tsx:61-87`
- 思维链展示: `.folo-reference/apps/desktop/layer/renderer/src/modules/ai-chat/components/displays/AIChainOfThought.tsx:79-98`

### Nion-Agent 参考文件
- 路由结构: `frontend/src/app/workspace/chats/`
- API 路由: `backend/src/gateway/routers/threads.py`
- 聊天面板: `frontend/src/components/workspace/chats/chat-box.tsx`
- 线程 hooks: `frontend/src/core/threads/hooks.ts`
- Agent 实现: `backend/src/agents/lead_agent/agent.py`
