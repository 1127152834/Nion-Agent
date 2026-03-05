"""Static discover data source for curated RSS resources."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DiscoverSource:
    id: str
    title: str
    feed_url: str
    site_url: str
    description: str
    category: str
    language: str
    tags: tuple[str, ...]
    featured: bool = False


@dataclass(frozen=True)
class DiscoverCategory:
    id: str
    label: str


_CATEGORIES: tuple[DiscoverCategory, ...] = (
    DiscoverCategory(id="all", label="全部"),
    DiscoverCategory(id="programming", label="编程"),
    DiscoverCategory(id="ai", label="AI"),
    DiscoverCategory(id="design", label="设计"),
    DiscoverCategory(id="product", label="产品"),
    DiscoverCategory(id="news", label="新闻"),
    DiscoverCategory(id="finance", label="财经"),
    DiscoverCategory(id="science", label="科学"),
    DiscoverCategory(id="chinese", label="中文精选"),
)

_SOURCES: tuple[DiscoverSource, ...] = (
    DiscoverSource(
        id="hn-frontpage",
        title="Hacker News Front Page",
        feed_url="https://hnrss.org/frontpage",
        site_url="https://news.ycombinator.com/",
        description="Hacker News 首页热门讨论，适合追踪技术与创业热点。",
        category="programming",
        language="en",
        tags=("startup", "engineering", "community"),
        featured=True,
    ),
    DiscoverSource(
        id="lobsters",
        title="Lobsters",
        feed_url="https://lobste.rs/rss",
        site_url="https://lobste.rs/",
        description="高质量技术社区，聚焦编程实践与系统设计。",
        category="programming",
        language="en",
        tags=("engineering", "architecture"),
    ),
    DiscoverSource(
        id="github-changelog",
        title="GitHub Changelog",
        feed_url="https://github.blog/changelog/feed/",
        site_url="https://github.blog/changelog/",
        description="GitHub 产品与平台更新动态。",
        category="programming",
        language="en",
        tags=("github", "platform", "devtools"),
    ),
    DiscoverSource(
        id="stack-overflow-blog",
        title="Stack Overflow Blog",
        feed_url="https://stackoverflow.blog/feed/",
        site_url="https://stackoverflow.blog/",
        description="开发者生态趋势、工程实践与职业成长内容。",
        category="programming",
        language="en",
        tags=("developer", "career", "engineering"),
    ),
    DiscoverSource(
        id="devto",
        title="DEV Community",
        feed_url="https://dev.to/feed",
        site_url="https://dev.to/",
        description="开发者社区文章流，覆盖多语言与工程主题。",
        category="programming",
        language="en",
        tags=("community", "web", "backend"),
    ),
    DiscoverSource(
        id="google-ai-blog",
        title="Google AI Blog",
        feed_url="https://blog.google/technology/ai/rss/",
        site_url="https://blog.google/technology/ai/",
        description="Google 官方 AI 研究与产品进展。",
        category="ai",
        language="en",
        tags=("llm", "research", "product"),
        featured=True,
    ),
    DiscoverSource(
        id="openai-blog",
        title="OpenAI News",
        feed_url="https://openai.com/news/rss.xml",
        site_url="https://openai.com/news/",
        description="OpenAI 产品发布与研究进展。",
        category="ai",
        language="en",
        tags=("llm", "ai-agent", "research"),
        featured=True,
    ),
    DiscoverSource(
        id="anthropic-news",
        title="Anthropic News",
        feed_url="https://www.anthropic.com/news/rss.xml",
        site_url="https://www.anthropic.com/news",
        description="Anthropic 模型发布与安全研究内容。",
        category="ai",
        language="en",
        tags=("llm", "safety", "claude"),
    ),
    DiscoverSource(
        id="huggingface-blog",
        title="Hugging Face Blog",
        feed_url="https://huggingface.co/blog/feed.xml",
        site_url="https://huggingface.co/blog",
        description="开源 AI 模型、工具与教程。",
        category="ai",
        language="en",
        tags=("open-source", "ml", "model"),
    ),
    DiscoverSource(
        id="towards-data-science",
        title="Towards Data Science",
        feed_url="https://towardsdatascience.com/feed",
        site_url="https://towardsdatascience.com/",
        description="数据科学与机器学习实战文章。",
        category="ai",
        language="en",
        tags=("ml", "data-science", "python"),
    ),
    DiscoverSource(
        id="smashing-magazine",
        title="Smashing Magazine",
        feed_url="https://www.smashingmagazine.com/feed/",
        site_url="https://www.smashingmagazine.com/",
        description="设计与前端体验深度文章。",
        category="design",
        language="en",
        tags=("ui", "ux", "frontend"),
        featured=True,
    ),
    DiscoverSource(
        id="css-tricks",
        title="CSS-Tricks",
        feed_url="https://css-tricks.com/feed/",
        site_url="https://css-tricks.com/",
        description="前端 CSS/JS 技巧与现代 Web 开发内容。",
        category="design",
        language="en",
        tags=("css", "frontend", "web"),
    ),
    DiscoverSource(
        id="dribbble-popular",
        title="Dribbble Popular",
        feed_url="https://dribbble.com/shots/popular.rss",
        site_url="https://dribbble.com/",
        description="设计灵感流，查看热门视觉作品。",
        category="design",
        language="en",
        tags=("visual", "inspiration", "ui"),
    ),
    DiscoverSource(
        id="a-list-apart",
        title="A List Apart",
        feed_url="https://alistapart.com/main/feed/",
        site_url="https://alistapart.com/",
        description="长期关注网页设计与前端架构。",
        category="design",
        language="en",
        tags=("web", "design-system", "frontend"),
    ),
    DiscoverSource(
        id="lenny-newsletter",
        title="Lenny's Newsletter",
        feed_url="https://www.lennysnewsletter.com/feed",
        site_url="https://www.lennysnewsletter.com/",
        description="产品增长、PM 体系和团队实践。",
        category="product",
        language="en",
        tags=("product", "growth", "pm"),
        featured=True,
    ),
    DiscoverSource(
        id="product-hunt",
        title="Product Hunt",
        feed_url="https://www.producthunt.com/feed",
        site_url="https://www.producthunt.com/",
        description="每日新品与产品趋势。",
        category="product",
        language="en",
        tags=("startup", "product", "launch"),
    ),
    DiscoverSource(
        id="mindtheproduct",
        title="Mind the Product",
        feed_url="https://www.mindtheproduct.com/feed/",
        site_url="https://www.mindtheproduct.com/",
        description="产品管理实战与组织经验。",
        category="product",
        language="en",
        tags=("pm", "team", "strategy"),
    ),
    DiscoverSource(
        id="nytimes-world",
        title="NYTimes World",
        feed_url="https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
        site_url="https://www.nytimes.com/section/world",
        description="国际新闻主流资讯源。",
        category="news",
        language="en",
        tags=("world", "news", "politics"),
    ),
    DiscoverSource(
        id="guardian-world",
        title="The Guardian World",
        feed_url="https://www.theguardian.com/world/rss",
        site_url="https://www.theguardian.com/world",
        description="全球新闻、社会与政策报道。",
        category="news",
        language="en",
        tags=("world", "news"),
    ),
    DiscoverSource(
        id="bbc-world",
        title="BBC World",
        feed_url="https://feeds.bbci.co.uk/news/world/rss.xml",
        site_url="https://www.bbc.com/news/world",
        description="BBC 国际新闻快讯。",
        category="news",
        language="en",
        tags=("world", "breaking"),
    ),
    DiscoverSource(
        id="coindesk",
        title="CoinDesk",
        feed_url="https://www.coindesk.com/arc/outboundfeeds/rss/",
        site_url="https://www.coindesk.com/",
        description="加密资产与区块链产业新闻。",
        category="finance",
        language="en",
        tags=("crypto", "blockchain", "market"),
    ),
    DiscoverSource(
        id="economist-finance",
        title="The Economist Finance & economics",
        feed_url="https://www.economist.com/finance-and-economics/rss.xml",
        site_url="https://www.economist.com/finance-and-economics",
        description="宏观经济与金融分析。",
        category="finance",
        language="en",
        tags=("macro", "economy", "analysis"),
    ),
    DiscoverSource(
        id="nature-news",
        title="Nature News",
        feed_url="https://www.nature.com/nature.rss",
        site_url="https://www.nature.com/",
        description="Nature 期刊科学新闻与研究动态。",
        category="science",
        language="en",
        tags=("research", "science", "paper"),
        featured=True,
    ),
    DiscoverSource(
        id="arxiv-cs",
        title="arXiv Computer Science",
        feed_url="https://rss.arxiv.org/rss/cs",
        site_url="https://arxiv.org/list/cs/recent",
        description="计算机科学预印本论文更新。",
        category="science",
        language="en",
        tags=("paper", "computer-science", "research"),
    ),
    DiscoverSource(
        id="ruanyifeng-blog",
        title="阮一峰的网络日志",
        feed_url="https://www.ruanyifeng.com/blog/atom.xml",
        site_url="https://www.ruanyifeng.com/blog/",
        description="高质量中文技术博客与周刊。",
        category="chinese",
        language="zh",
        tags=("中文", "编程", "周刊"),
        featured=True,
    ),
    DiscoverSource(
        id="sspai",
        title="少数派",
        feed_url="https://sspai.com/feed",
        site_url="https://sspai.com/",
        description="效率工具、数字生活与工作方式。",
        category="chinese",
        language="zh",
        tags=("中文", "效率", "产品"),
    ),
    DiscoverSource(
        id="36kr",
        title="36氪",
        feed_url="https://36kr.com/feed",
        site_url="https://36kr.com/",
        description="创业、科技与商业新闻。",
        category="chinese",
        language="zh",
        tags=("中文", "创业", "新闻"),
    ),
    DiscoverSource(
        id="ifanr",
        title="爱范儿",
        feed_url="https://www.ifanr.com/feed",
        site_url="https://www.ifanr.com/",
        description="消费电子、AI 与科技趋势。",
        category="chinese",
        language="zh",
        tags=("中文", "科技", "ai"),
    ),
    DiscoverSource(
        id="infoq-cn",
        title="InfoQ 中国",
        feed_url="https://www.infoq.cn/feed",
        site_url="https://www.infoq.cn/",
        description="软件架构、后端与工程实践内容。",
        category="chinese",
        language="zh",
        tags=("中文", "架构", "工程"),
    ),
)


def list_categories() -> list[DiscoverCategory]:
    return list(_CATEGORIES)


def list_sources(
    *,
    keyword: str | None = None,
    category: str | None = None,
    limit: int = 60,
) -> list[DiscoverSource]:
    normalized_keyword = (keyword or "").strip().lower()
    normalized_category = (category or "all").strip().lower()

    items = list(_SOURCES)
    if normalized_category and normalized_category != "all":
        items = [item for item in items if item.category == normalized_category]

    if normalized_keyword:
        def _matches(source: DiscoverSource) -> bool:
            haystack = " ".join(
                [
                    source.title,
                    source.description,
                    source.category,
                    source.language,
                    source.site_url,
                    source.feed_url,
                    *source.tags,
                ],
            ).lower()
            return normalized_keyword in haystack

        items = [item for item in items if _matches(item)]

    items.sort(
        key=lambda item: (
            not item.featured,
            item.category,
            item.title.lower(),
        ),
    )
    return items[: max(1, min(limit, 200))]
