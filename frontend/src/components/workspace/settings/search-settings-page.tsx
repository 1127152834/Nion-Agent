"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ExternalLinkIcon,
  GripVerticalIcon,
  Loader2Icon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfigEditor } from "@/components/workspace/settings/use-config-editor";
import { getBackendBaseURL } from "@/core/config";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

import { ConfigValidationErrors } from "./config-validation-errors";
import { ConfigSaveBar } from "./configuration/config-save-bar";
import { asArray, asNumber, asString, cloneConfig, type ConfigDraft } from "./configuration/shared";
import { SettingsSection } from "./settings-section";

type SearchKind = "web_search" | "web_fetch";

type SearchSettings = {
  provider_configs?: Record<string, unknown>;
  web_search?: {
    providers?: string[];
    max_results?: number;
  };
  web_fetch?: {
    providers?: string[];
    timeout_seconds?: number;
  };
};

type ProviderCatalogField =
  | {
      id: string;
      type: "string" | "secret";
      label: string;
      required?: boolean;
      placeholder?: string;
      help?: string;
      multiline?: boolean;
      multilineRows?: number;
      parseAsStringList?: boolean;
    }
  | {
      id: string;
      type: "number";
      label: string;
      required?: boolean;
      min?: number;
      max?: number;
      placeholder?: string;
      help?: string;
    }
  | {
      id: string;
      type: "select";
      label: string;
      required?: boolean;
      options: Array<{ label: string; value: string }>;
      help?: string;
    };

type ProviderCatalogItem = {
  id: string;
  name: string;
  descriptionEn: string;
  descriptionZh: string;
  kind: SearchKind;
  builtin: boolean;
  docsUrl?: string;
  configId?: string | null;
  probeId?: string | null;
  requires?: string[];
  configFields?: ProviderCatalogField[];
};

type WebProviderProbePayload = {
  provider:
    | "tavily"
    | "jina"
    | "searxng"
    | "brave"
    | "metaso"
    | "serpapi"
    | "serper"
    | "bing"
    | "google_cse"
    | "firecrawl"
    | "browserless";
  api_key?: string | null;
  base_url?: string | null;
  cx?: string | null;
  engine?: string | null;
  timeout_seconds?: number;
  max_results?: number;
};

type WebProviderProbeResponse = {
  status: "ok" | "degraded";
  error_code?: string;
  result?: {
    message?: string;
  };
};

type SearchSettingsUIText = {
  title: string;
  description: string;
  loadFailed: string;
  legacyHint: string;
  btnMigrate: string;
  tabSearch: string;
  tabFetch: string;
  optionsTitle: string;
  maxResultsLabel: string;
  timeoutLabel: string;
  enabledTitle: string;
  enabledSubtitle: string;
  availableTitle: string;
  availableSubtitle: string;
  dialogEditDescription: string;
  dialogEnableDescription: string;
  builtinBadge: string;
  statusNotConfigured: string;
  statusTesting: string;
  statusUntested: string;
  statusConnected: string;
  statusFailed: string;
  btnConfigure: string;
  btnTest: string;
  btnDone: string;
  btnCancel: string;
  btnEnable: string;
  btnTestConnection: string;
  btnShow: string;
  btnHide: string;
  docsHint: string;
  openDocs: string;
  noExtraConfig: string;
  toastMissingFields: (fields: string) => string;
  toastProbeUnsupported: string;
  toastProbeConnected: string;
  toastProbeFailed: string;
  toastProbeFailedWithReason: (reason: string) => string;
  tooltipDrag: string;
};

const BUILTIN_PROVIDER_BY_KIND: Record<SearchKind, string> = {
  web_search: "searxng_public",
  web_fetch: "direct",
};

const PROVIDER_CATALOG: ProviderCatalogItem[] = [
  {
    id: "searxng_public",
    name: "SearXNG (Public)",
    descriptionEn: "Built-in fallback provider. No key required.",
    descriptionZh: "内置兜底服务，无需 API Key。",
    kind: "web_search",
    builtin: true,
    configId: null,
    probeId: null,
  },
  {
    id: "searxng_custom",
    name: "SearXNG (Custom)",
    descriptionEn: "Use your own SearXNG instance.",
    descriptionZh: "使用你自建的 SearXNG 实例。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://docs.searxng.org/",
    configId: "searxng_custom",
    probeId: "searxng",
    requires: ["base_url"],
    configFields: [
      {
        id: "base_url",
        type: "string",
        label: "Base URL",
        required: true,
        placeholder: "https://your-searxng.example.com",
      },
      {
        id: "public_instances",
        type: "string",
        label: "Public instances",
        placeholder: "https://search.example.com",
        help: "可选。每行一个 URL。",
        multiline: true,
        multilineRows: 4,
        parseAsStringList: true,
      },
      {
        id: "engines",
        type: "string",
        label: "Engines",
        placeholder: "google,bing",
      },
      {
        id: "timeout_seconds",
        type: "number",
        label: "Timeout (seconds)",
        min: 1,
        max: 60,
        placeholder: "10",
      },
    ],
  },
  {
    id: "tavily",
    name: "Tavily",
    descriptionEn: "Web search API optimized for AI agents.",
    descriptionZh: "适合 AI Agent 的 Web 搜索 API。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://tavily.com/",
    configId: "tavily",
    probeId: "tavily",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$TAVILY_API_KEY",
      },
    ],
  },
  {
    id: "brave",
    name: "Brave Search",
    descriptionEn: "Brave Search API.",
    descriptionZh: "Brave 搜索 API。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://brave.com/search/api/",
    configId: "brave",
    probeId: "brave",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$BRAVE_API_KEY",
      },
    ],
  },
  {
    id: "metaso",
    name: "秘塔搜索 (MetaSo)",
    descriptionEn: "MetaSo search provider.",
    descriptionZh: "秘塔搜索服务。",
    kind: "web_search",
    builtin: false,
    configId: "metaso",
    probeId: "metaso",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$METASO_API_KEY",
      },
      {
        id: "base_url",
        type: "string",
        label: "Base URL",
        placeholder: "https://api.ecn.ai",
        help: "可选。默认使用 https://api.ecn.ai。",
      },
    ],
  },
  {
    id: "serpapi",
    name: "SerpAPI",
    descriptionEn: "Google/Bing SERP via SerpAPI.",
    descriptionZh: "通过 SerpAPI 获取搜索结果。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://serpapi.com/",
    configId: "serpapi",
    probeId: "serpapi",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$SERPAPI_API_KEY",
      },
      {
        id: "engine",
        type: "select",
        label: "Engine",
        options: [
          { label: "Google", value: "google" },
          { label: "Bing", value: "bing" },
        ],
        help: "可选。默认 google。",
      },
    ],
  },
  {
    id: "serper",
    name: "Serper",
    descriptionEn: "Google Search API via Serper.dev.",
    descriptionZh: "Serper.dev 搜索 API。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://serper.dev/",
    configId: "serper",
    probeId: "serper",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$SERPER_API_KEY",
      },
    ],
  },
  {
    id: "bing",
    name: "Bing Web Search",
    descriptionEn: "Microsoft Bing Web Search API.",
    descriptionZh: "微软 Bing 搜索 API。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://learn.microsoft.com/bing/search-apis/bing-web-search/",
    configId: "bing",
    probeId: "bing",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$BING_API_KEY",
      },
    ],
  },
  {
    id: "google_cse",
    name: "Google CSE",
    descriptionEn: "Google Custom Search JSON API.",
    descriptionZh: "Google 自定义搜索（CSE）API。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://developers.google.com/custom-search/v1/overview",
    configId: "google_cse",
    probeId: "google_cse",
    requires: ["api_key", "cx"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$GOOGLE_API_KEY",
      },
      {
        id: "cx",
        type: "string",
        label: "Search Engine ID (cx)",
        required: true,
        placeholder: "012345678901234567890:abcdefg",
      },
    ],
  },
  {
    id: "firecrawl",
    name: "Firecrawl (Search)",
    descriptionEn: "Firecrawl search API.",
    descriptionZh: "Firecrawl 搜索 API。",
    kind: "web_search",
    builtin: false,
    docsUrl: "https://docs.firecrawl.dev/",
    configId: "firecrawl",
    probeId: "firecrawl",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$FIRECRAWL_API_KEY",
      },
      {
        id: "base_url",
        type: "string",
        label: "Base URL",
        placeholder: "https://api.firecrawl.dev",
        help: "可选。默认使用 https://api.firecrawl.dev。",
      },
    ],
  },
  {
    id: "direct",
    name: "Direct Fetch",
    descriptionEn: "Built-in fallback provider. Fetch content directly.",
    descriptionZh: "内置兜底服务，直接抓取网页内容。",
    kind: "web_fetch",
    builtin: true,
    configId: null,
    probeId: null,
  },
  {
    id: "jina",
    name: "Jina AI Reader",
    descriptionEn: "Fetch and convert pages using Jina Reader.",
    descriptionZh: "通过 Jina Reader 抓取并转换网页内容。",
    kind: "web_fetch",
    builtin: false,
    docsUrl: "https://jina.ai/reader",
    configId: "jina",
    probeId: "jina",
    requires: [],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        placeholder: "$JINA_API_KEY",
        help: "可选。无 Key 也可用，但会有速率限制。",
      },
      {
        id: "timeout_seconds",
        type: "number",
        label: "Timeout (seconds)",
        min: 1,
        max: 60,
        placeholder: "10",
      },
    ],
  },
  {
    id: "firecrawl_scrape",
    name: "Firecrawl (Scrape)",
    descriptionEn: "Scrape and return markdown via Firecrawl.",
    descriptionZh: "通过 Firecrawl 抓取网页并返回 Markdown。",
    kind: "web_fetch",
    builtin: false,
    docsUrl: "https://docs.firecrawl.dev/",
    configId: "firecrawl",
    probeId: "firecrawl",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$FIRECRAWL_API_KEY",
      },
      {
        id: "base_url",
        type: "string",
        label: "Base URL",
        placeholder: "https://api.firecrawl.dev",
        help: "可选。默认使用 https://api.firecrawl.dev。",
      },
    ],
  },
  {
    id: "browserless",
    name: "Browserless",
    descriptionEn: "Fetch rendered HTML via Browserless.",
    descriptionZh: "通过 Browserless 获取渲染后的 HTML。",
    kind: "web_fetch",
    builtin: false,
    docsUrl: "https://www.browserless.io/",
    configId: "browserless",
    probeId: "browserless",
    requires: ["api_key"],
    configFields: [
      {
        id: "api_key",
        type: "secret",
        label: "API Key",
        required: true,
        placeholder: "$BROWSERLESS_API_KEY",
      },
      {
        id: "base_url",
        type: "string",
        label: "Base URL",
        placeholder: "https://chrome.browserless.io",
        help: "可选。自建 Browserless 时填写你的 base URL。",
      },
    ],
  },
];

function getCatalog(kind: SearchKind) {
  return PROVIDER_CATALOG.filter((item) => item.kind === kind);
}

function getProviderMeta(kind: SearchKind, providerId: string): ProviderCatalogItem | null {
  return getCatalog(kind).find((item) => item.id === providerId) ?? null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asString(item).trim()).filter(Boolean);
}

function splitStringList(text: string): string[] {
  const raw = text
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  const uniq: string[] = [];
  for (const item of raw) {
    if (!uniq.includes(item)) {
      uniq.push(item);
    }
  }
  return uniq;
}

function normalizeProvidersList(providers: string[], builtinId: string): string[] {
  const cleaned = providers.map((item) => item.trim()).filter(Boolean);
  const uniq: string[] = [];
  for (const item of cleaned) {
    if (!uniq.includes(item)) {
      uniq.push(item);
    }
  }
  if (!uniq.includes(builtinId)) {
    uniq.push(builtinId);
  }
  return uniq;
}

function deriveLegacySearchSettings(config: ConfigDraft): SearchSettings {
  const tools = asArray(config.tools);
  const webSearchTool = tools.find((tool) => asString(tool.name).trim() === "web_search") ?? null;
  const webFetchTool = tools.find((tool) => asString(tool.name).trim() === "web_fetch") ?? null;

  const providerConfigs: Record<string, unknown> = {};

  const webSearchExtra = webSearchTool ?? {};
  const legacyProvider = asString(webSearchExtra.provider).trim().toLowerCase();
  const legacyMaxResults = asNumber(webSearchExtra.max_results, 5);
  const legacyTavilyKey = asString(webSearchExtra.api_key).trim();
  const legacySearxngBaseUrl = asString(webSearchExtra.searxng_base_url).trim();
  const legacySearxngEngines = asString(webSearchExtra.searxng_engines).trim();
  const legacySearxngTimeout = asNumber(webSearchExtra.searxng_timeout, 10);
  const legacySearxngPool = webSearchExtra.searxng_public_instances;

  if (legacyTavilyKey) {
    providerConfigs.tavily = { api_key: legacyTavilyKey };
  }
  if (legacySearxngBaseUrl || legacySearxngEngines || legacySearxngTimeout || legacySearxngPool) {
    const publicInstances = Array.isArray(legacySearxngPool)
      ? (legacySearxngPool as unknown[]).map((item) => asString(item).trim()).filter(Boolean)
      : typeof legacySearxngPool === "string"
        ? splitStringList(legacySearxngPool)
        : [];
    providerConfigs.searxng_custom = {
      ...(legacySearxngBaseUrl ? { base_url: legacySearxngBaseUrl } : {}),
      ...(legacySearxngEngines ? { engines: legacySearxngEngines } : {}),
      ...(legacySearxngTimeout ? { timeout_seconds: legacySearxngTimeout } : {}),
      ...(publicInstances.length > 0 ? { public_instances: publicInstances } : {}),
    };
  }

  const derivedWebSearchProviders: string[] = [];
  const hasTavily = Boolean(legacyTavilyKey);
  const hasCustomSearxng = Boolean(legacySearxngBaseUrl);
  if (legacyProvider === "tavily") {
    derivedWebSearchProviders.push("tavily");
  } else if (legacyProvider === "searxng") {
    if (hasCustomSearxng) {
      derivedWebSearchProviders.push("searxng_custom");
    }
  } else {
    // auto or unknown: best-effort preference (tavily -> searxng_custom -> searxng_public)
    if (hasTavily) {
      derivedWebSearchProviders.push("tavily");
    } else if (hasCustomSearxng) {
      derivedWebSearchProviders.push("searxng_custom");
    }
  }

  const webFetchExtra = webFetchTool ?? {};
  const legacyFetchTimeout = asNumber(webFetchExtra.timeout, 10);
  const legacyJinaKey = asString(webFetchExtra.api_key).trim();
  if (legacyJinaKey) {
    providerConfigs.jina = { api_key: legacyJinaKey };
  }

  return {
    provider_configs: providerConfigs,
    web_search: {
      providers: normalizeProvidersList(derivedWebSearchProviders, BUILTIN_PROVIDER_BY_KIND.web_search),
      max_results: legacyMaxResults > 0 ? legacyMaxResults : 5,
    },
    web_fetch: {
      providers: normalizeProvidersList(["jina"], BUILTIN_PROVIDER_BY_KIND.web_fetch),
      timeout_seconds: legacyFetchTimeout > 0 ? legacyFetchTimeout : 10,
    },
  };
}

function readSearchSettings(config: ConfigDraft): SearchSettings | null {
  if (!Object.prototype.hasOwnProperty.call(config, "search_settings")) {
    return null;
  }
  const raw = config.search_settings;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as SearchSettings;
}

function ensureSearchSettings(config: ConfigDraft): SearchSettings {
  const existing = readSearchSettings(config);
  if (existing) {
    return existing;
  }
  const derived = deriveLegacySearchSettings(config);
  config.search_settings = derived;
  return derived;
}

function getProvidersFromSettings(settings: SearchSettings, kind: SearchKind): string[] {
  if (kind === "web_search") {
    return asStringArray(settings.web_search?.providers);
  }
  return asStringArray(settings.web_fetch?.providers);
}

function setProvidersToSettings(settings: SearchSettings, kind: SearchKind, providers: string[]) {
  if (kind === "web_search") {
    settings.web_search = {
      ...(settings.web_search ?? {}),
      providers,
    };
    return;
  }
  settings.web_fetch = {
    ...(settings.web_fetch ?? {}),
    providers,
  };
}

function getProviderConfigs(settings: SearchSettings): Record<string, unknown> {
  const raw = settings.provider_configs;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  return {};
}

function setProviderConfigs(settings: SearchSettings, configs: Record<string, unknown>) {
  settings.provider_configs = configs;
}

function isProviderConfigured(item: ProviderCatalogItem, providerConfigs: Record<string, unknown>): boolean {
  if (item.builtin) {
    return true;
  }
  if (!item.configId) {
    return true;
  }
  const raw = providerConfigs[item.configId];
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const requires = item.requires ?? [];
  if (item.id === "jina") {
    // Jina works without key; treat as configured.
    return true;
  }
  if (item.id === "searxng_custom") {
    const baseUrl = asString(cfg.base_url).trim();
    return Boolean(baseUrl);
  }
  return requires.every((key) => {
    const value = cfg[key];
    if (typeof value === "string") {
      return Boolean(value.trim());
    }
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    return Boolean(value);
  });
}

function getMissingRequiredFields(item: ProviderCatalogItem, providerConfigs: Record<string, unknown>): string[] {
  if (item.builtin || !item.configId) {
    return [];
  }
  if (item.id === "jina") {
    return [];
  }
  const raw = providerConfigs[item.configId];
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (item.id === "searxng_custom") {
    const baseUrl = asString(cfg.base_url).trim();
    return baseUrl ? [] : ["base_url"];
  }
  const requires = item.requires ?? [];
  return requires.filter((key) => {
    const value = cfg[key];
    if (typeof value === "string") {
      return !value.trim();
    }
    if (typeof value === "number") {
      return !Number.isFinite(value);
    }
    return !value;
  });
}

function SortableProviderRow({
  id,
  children,
  disabled,
}: {
  id: string;
  children: (props: {
    setActivatorRef: (node: HTMLElement | null) => void;
    listeners: Record<string, unknown>;
    attributes: Record<string, unknown>;
    isDragging: boolean;
  }) => React.ReactNode;
  disabled?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging ? "opacity-60" : "")}
    >
      {children({
        setActivatorRef: setActivatorNodeRef,
        listeners: listeners as unknown as Record<string, unknown>,
        attributes: attributes as unknown as Record<string, unknown>,
        isDragging,
      })}
    </div>
  );
}

function ProviderStatusBadge({
  item,
  configured,
  probe,
  probing,
  text,
}: {
  item: ProviderCatalogItem;
  configured: boolean;
  probe: WebProviderProbeResponse | null;
  probing: boolean;
  text: SearchSettingsUIText;
}) {
  if (item.builtin) {
    return (
      <Badge variant="secondary" className="bg-muted text-foreground/80">
        {text.builtinBadge}
      </Badge>
    );
  }
  if (!configured) {
    return (
      <Badge variant="outline" className="border-amber-200 text-amber-700">
        {text.statusNotConfigured}
      </Badge>
    );
  }
  if (probing) {
    return (
      <Badge variant="outline" className="border-sky-200 text-sky-700">
        {text.statusTesting}
      </Badge>
    );
  }
  if (!probe) {
    return (
      <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
        {text.statusUntested}
      </Badge>
    );
  }
  if (probe.status === "ok") {
    return (
      <Badge variant="outline" className="border-emerald-200 text-emerald-700">
        {text.statusConnected}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-destructive/30 text-destructive">
      {text.statusFailed}
    </Badge>
  );
}

function ProviderConfigDialog({
  open,
  onOpenChange,
  item,
  mode = "edit",
  config,
  onChange,
  onTest,
  onEnable,
  testResult,
  testing,
  disabled = false,
  text,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ProviderCatalogItem;
  mode?: "edit" | "enable";
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onTest: () => void;
  onEnable?: () => void;
  testResult: WebProviderProbeResponse | null;
  testing: boolean;
  disabled?: boolean;
  text: SearchSettingsUIText;
}) {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const fields = item.configFields ?? [];
  const isEnableMode = mode === "enable";
  const canEnable = isEnableMode && Boolean(onEnable) && testResult?.status === "ok" && !disabled && !testing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>
            {isEnableMode ? text.dialogEnableDescription : text.dialogEditDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {item.docsUrl ? (
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="text-muted-foreground">{text.docsHint}</div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => window.open(item.docsUrl, "_blank", "noreferrer")}
                >
                  {text.openDocs} <ExternalLinkIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : null}

          {fields.length === 0 ? (
            <div className="text-muted-foreground text-sm">
              {text.noExtraConfig}
            </div>
          ) : (
            <div className="space-y-3">
              {fields.map((field) => {
                const raw = config[field.id];
                const value =
                  field.type === "number"
                    ? typeof raw === "number"
                      ? String(raw)
                      : typeof raw === "string"
                        ? raw
                        : ""
                    : asString(raw);
                const required = Boolean(field.required);
                const label = required ? `${field.label} *` : field.label;

                if (field.type === "select") {
                  const currentValue = asString(config[field.id]).trim();
                  const selectValue = currentValue.length > 0
                    ? currentValue
                    : field.options[0]?.value ?? "";
                  return (
                    <div key={field.id} className="space-y-1.5">
                      <Label>{label}</Label>
                      <Select
                        value={selectValue}
                        onValueChange={(next) => {
                          onChange({ ...config, [field.id]: next });
                        }}
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={field.options[0]?.label ?? "请选择"} />
                        </SelectTrigger>
                        <SelectContent>
                          {field.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {field.help ? (
                        <div className="text-muted-foreground text-xs">{field.help}</div>
                      ) : null}
                    </div>
                  );
                }

                const isSecret = field.type === "secret";
                const supportsMultiline = field.type === "string" || field.type === "secret";
                const isMultiline = supportsMultiline && Boolean(field.multiline);
                const inputType = isSecret
                  ? showSecrets[field.id]
                    ? "text"
                    : "password"
                  : "text";

                return (
                  <div key={field.id} className="space-y-1.5">
                    <Label>{label}</Label>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {field.type === "number" ? (
                          <Input
                            type="number"
                            value={value}
                            placeholder={field.placeholder}
                            min={field.min}
                            max={field.max}
                            disabled={disabled}
                            onChange={(e) => {
                              const nextRaw = e.target.value;
                              const nextValue = nextRaw.trim() === "" ? "" : Number(nextRaw);
                              onChange({ ...config, [field.id]: Number.isFinite(nextValue) ? nextValue : nextRaw });
                            }}
                          />
                        ) : isMultiline ? (
                          <Textarea
                            rows={supportsMultiline ? field.multilineRows ?? 4 : 4}
                            value={value}
                            placeholder={field.placeholder}
                            disabled={disabled}
                            onChange={(e) => onChange({ ...config, [field.id]: e.target.value })}
                          />
                        ) : (
                          <Input
                            type={inputType}
                            value={value}
                            placeholder={field.placeholder}
                            disabled={disabled}
                            onChange={(e) => onChange({ ...config, [field.id]: e.target.value })}
                          />
                        )}
                      </div>
                      {isSecret ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() =>
                            setShowSecrets((prev) => ({ ...prev, [field.id]: !prev[field.id] }))
                          }
                        >
                          {showSecrets[field.id] ? text.btnHide : text.btnShow}
                        </Button>
                      ) : null}
                    </div>
                    {field.help ? (
                      <div className="text-muted-foreground text-xs">{field.help}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {testResult ? (
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-xs",
                testResult.status === "ok"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              {testResult.result?.message ??
                (testResult.status === "ok" ? text.toastProbeConnected : text.toastProbeFailed)}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || testing}
            onClick={onTest}
          >
            {testing ? (
              <>
                <Loader2Icon className="mr-2 size-3.5 animate-spin" />
                {text.btnTestConnection}
              </>
            ) : (
              text.btnTestConnection
            )}
          </Button>
          {isEnableMode ? (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={disabled || testing}
                onClick={() => onOpenChange(false)}
              >
                {text.btnCancel}
              </Button>
              <Button
                type="button"
                disabled={!canEnable}
                onClick={() => {
                  if (!onEnable) {
                    return;
                  }
                  onEnable();
                }}
              >
                {text.btnEnable}
              </Button>
            </>
          ) : (
            <Button type="button" disabled={disabled} onClick={() => onOpenChange(false)}>
              {text.btnDone}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function probeWebProvider(payload: WebProviderProbePayload): Promise<WebProviderProbeResponse> {
  const response = await fetch(`${getBackendBaseURL()}/api/tools/test-web-provider`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = (isJson ? await response.json() : null) as unknown;
  if (!response.ok) {
    const message =
      typeof data === "object" && data && "detail" in data
        ? (() => {
          const detail = (data as Record<string, unknown>).detail;
          return typeof detail === "string" && detail.trim() ? detail : "request failed";
        })()
        : `request failed with status ${response.status}`;
    return {
      status: "degraded",
      error_code: "tool_provider_unreachable",
      result: { message },
    };
  }
  return data as WebProviderProbeResponse;
}

export function SearchSettingsPage() {
  const { t, locale } = useI18n();
  const copy = (t.settings as unknown as { searchSettingsPage?: Record<string, string> }).searchSettingsPage ?? {};
  const isZh = locale.startsWith("zh");
  const fb = (zh: string, en: string) => (isZh ? zh : en);
  const tr = (key: string, fallback: string) => {
    const value = copy[key];
    return typeof value === "string" && value.trim() ? value : fallback;
  };
  const missingFieldsTemplate = tr("toastMissingFields", fb("缺少必填字段：{fields}", "Missing required fields: {fields}"));
  const probeFailedTemplate = tr(
    "toastProbeFailedWithReason",
    fb("连接失败：{reason}", "Connection failed: {reason}"),
  );
  const text: SearchSettingsUIText = {
    title: tr("title", fb("搜索设置", "Search settings")),
    description: tr(
      "description",
      fb("配置 Web Search 与 Web Fetch 的服务优先级、密钥与兜底策略。", "Configure provider priority, credentials, and fallback."),
    ),
    loadFailed: tr("loadFailed", fb("加载配置失败", "Failed to load config")),
    legacyHint: tr(
      "legacyHint",
      fb(
        "当前未检测到 search_settings，页面使用历史工具配置进行展示。点击右侧“写入并保存”会将当前展示的配置写入 search_settings。",
        "search_settings is not found. This page is showing legacy tool config. Click \"Write & save\" to persist search_settings.",
      ),
    ),
    btnMigrate: tr("btnMigrate", fb("写入并保存", "Write & save")),
    tabSearch: tr("tabSearch", "Web Search"),
    tabFetch: tr("tabFetch", "Web Fetch"),
    optionsTitle: tr("optionsTitle", fb("行为参数", "Options")),
    maxResultsLabel: tr("maxResultsLabel", fb("最大结果数", "Max results")),
    timeoutLabel: tr("timeoutLabel", fb("超时（秒）", "Timeout (seconds)")),
    enabledTitle: tr("enabledTitle", fb("已启用服务", "Enabled providers")),
    enabledSubtitle: tr("enabledSubtitle", fb("拖拽排序决定优先级，越靠前越优先。", "Drag to reorder priority. Top runs first.")),
    availableTitle: tr("availableTitle", fb("可用服务", "Available providers")),
    availableSubtitle: tr(
      "availableSubtitle",
      fb(
        "打开开关后需先完成配置并测试连接，通过后才能启用。",
        "Toggle on to configure and test connection before enabling.",
      ),
    ),
    dialogEditDescription: tr(
      "dialogEditDescription",
      fb("修改配置后，你可以点击“测试连接”验证可用性。", "After editing, click \"Test connection\" to validate availability."),
    ),
    dialogEnableDescription: tr(
      "dialogEnableDescription",
      fb("请先完成配置并测试连接，通过后再点击“启用”。", "Configure and test connection before enabling."),
    ),
    builtinBadge: tr("builtinBadge", fb("内置兜底", "Built-in fallback")),
    statusNotConfigured: tr("statusNotConfigured", fb("未配置", "Not configured")),
    statusTesting: tr("statusTesting", fb("测试中", "Testing")),
    statusUntested: tr("statusUntested", fb("未测试", "Untested")),
    statusConnected: tr("statusConnected", fb("已连接", "Connected")),
    statusFailed: tr("statusFailed", fb("失败", "Failed")),
    btnConfigure: tr("btnConfigure", fb("配置", "Configure")),
    btnTest: tr("btnTest", fb("测试", "Test")),
    btnDone: tr("btnDone", fb("完成", "Done")),
    btnCancel: tr("btnCancel", fb("取消", "Cancel")),
    btnEnable: tr("btnEnable", fb("启用", "Enable")),
    btnTestConnection: tr("btnTestConnection", fb("测试连接", "Test connection")),
    btnShow: tr("btnShow", fb("显示", "Show")),
    btnHide: tr("btnHide", fb("隐藏", "Hide")),
    docsHint: tr("docsHint", fb("配置说明与密钥获取：", "Docs and key setup:")),
    openDocs: tr("openDocs", fb("打开文档", "Open docs")),
    noExtraConfig: tr("noExtraConfig", fb("该服务无需额外配置。", "No extra configuration required.")),
    toastMissingFields: (fields) => missingFieldsTemplate.replaceAll("{fields}", fields),
    toastProbeUnsupported: tr("toastProbeUnsupported", fb("该服务不支持连通性测试", "This provider does not support probe")),
    toastProbeConnected: tr("toastProbeConnected", fb("已连接", "Connected")),
    toastProbeFailed: tr("toastProbeFailed", fb("连接失败", "Connection failed")),
    toastProbeFailedWithReason: (reason) => probeFailedTemplate.replaceAll("{reason}", reason),
    tooltipDrag: tr("tooltipDrag", fb("拖拽排序", "Drag to reorder")),
  };

  const {
    draftConfig,
    validationErrors,
    validationWarnings,
    isLoading,
    error,
    dirty,
    disabled,
    saving,
    onConfigChange,
    onDiscard,
    onSave,
    onSaveConfig,
  } = useConfigEditor({
    prepareConfig: (config) => {
      // Only enforce invariants if search_settings already exists.
      if (!Object.prototype.hasOwnProperty.call(config, "search_settings")) {
        return config;
      }
      const raw = (config as Record<string, unknown>).search_settings;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return config;
      }
      const settings = raw as SearchSettings;
      const providerConfigs = getProviderConfigs(settings);
      if (Object.keys(providerConfigs).length > 0) {
        setProviderConfigs(settings, providerConfigs);
      }

      const webSearchProviders = normalizeProvidersList(
        getProvidersFromSettings(settings, "web_search"),
        BUILTIN_PROVIDER_BY_KIND.web_search,
      );
      const webFetchProviders = normalizeProvidersList(
        getProvidersFromSettings(settings, "web_fetch"),
        BUILTIN_PROVIDER_BY_KIND.web_fetch,
      );
      setProvidersToSettings(settings, "web_search", webSearchProviders);
      setProvidersToSettings(settings, "web_fetch", webFetchProviders);

      settings.web_search = {
        ...(settings.web_search ?? {}),
        max_results: asNumber(settings.web_search?.max_results, 5),
      };
      settings.web_fetch = {
        ...(settings.web_fetch ?? {}),
        timeout_seconds: asNumber(settings.web_fetch?.timeout_seconds, 10),
      };
      return config;
    },
  });

  const storedSettings = useMemo(() => readSearchSettings(draftConfig), [draftConfig]);
  const derivedLegacySettings = useMemo(() => {
    if (storedSettings) {
      return null;
    }
    return deriveLegacySearchSettings(draftConfig);
  }, [draftConfig, storedSettings]);

  const effectiveSettings: SearchSettings = storedSettings ?? derivedLegacySettings ?? {};
  const activeSearchProviders = normalizeProvidersList(
    getProvidersFromSettings(effectiveSettings, "web_search"),
    BUILTIN_PROVIDER_BY_KIND.web_search,
  );
  const activeFetchProviders = normalizeProvidersList(
    getProvidersFromSettings(effectiveSettings, "web_fetch"),
    BUILTIN_PROVIDER_BY_KIND.web_fetch,
  );

  const providerConfigs = getProviderConfigs(effectiveSettings);

  const [activeTab, setActiveTab] = useState<SearchKind>("web_search");
  const [activeConfigProvider, setActiveConfigProvider] = useState<ProviderCatalogItem | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [configDialogMode, setConfigDialogMode] = useState<"edit" | "enable">("edit");
  const [probeResultByProvider, setProbeResultByProvider] = useState<Record<string, WebProviderProbeResponse | null>>(
    {},
  );
  const [probingByProvider, setProbingByProvider] = useState<Record<string, boolean>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const enabledProviders = activeTab === "web_search" ? activeSearchProviders : activeFetchProviders;
  const allProviders = useMemo(() => getCatalog(activeTab), [activeTab]);
  const availableProviders = useMemo(
    () => allProviders.filter((item) => !item.builtin && !enabledProviders.includes(item.id)),
    [allProviders, enabledProviders],
  );

  const updateSettings = (mutator: (settings: SearchSettings) => void) => {
    const next = cloneConfig(draftConfig);
    const settings = ensureSearchSettings(next);
    mutator(settings);
    onConfigChange(next);
  };

  const migrateLegacyToConfig = async () => {
    if (!derivedLegacySettings) {
      return;
    }
    const next = cloneConfig(draftConfig);
    (next as Record<string, unknown>).search_settings = cloneConfig(derivedLegacySettings);
    await onSaveConfig(next);
  };

  const reorderProviders = (kind: SearchKind, nextProviders: string[]) => {
    updateSettings((settings) => {
      const normalized = normalizeProvidersList(nextProviders, BUILTIN_PROVIDER_BY_KIND[kind]);
      setProvidersToSettings(settings, kind, normalized);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || String(active.id) === String(over.id)) {
      return;
    }
    const current = enabledProviders;
    const oldIndex = current.indexOf(String(active.id));
    const newIndex = current.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    reorderProviders(activeTab, arrayMove(current, oldIndex, newIndex));
  };

  const toggleProvider = (kind: SearchKind, providerId: string, enabled: boolean) => {
    updateSettings((settings) => {
      const current = getProvidersFromSettings(settings, kind);
      const builtinId = BUILTIN_PROVIDER_BY_KIND[kind];
      let next = [...current];
      next = next.filter((id) => id !== providerId);
      if (enabled) {
        next.unshift(providerId);
      }
      next = normalizeProvidersList(next, builtinId);
      setProvidersToSettings(settings, kind, next);
    });
  };

  const removeProvider = (kind: SearchKind, providerId: string) => {
    const meta = getProviderMeta(kind, providerId);
    if (meta?.builtin) {
      return;
    }
    updateSettings((settings) => {
      const current = getProvidersFromSettings(settings, kind);
      const builtinId = BUILTIN_PROVIDER_BY_KIND[kind];
      const next = normalizeProvidersList(
        current.filter((id) => id !== providerId),
        builtinId,
      );
      setProvidersToSettings(settings, kind, next);
    });
  };

  const openProviderDialog = (item: ProviderCatalogItem) => {
    if (item.builtin) {
      return;
    }
    setConfigDialogMode("edit");
    setActiveConfigProvider(item);
    setConfigDialogOpen(true);
  };

  const startEnableProvider = (item: ProviderCatalogItem) => {
    if (item.builtin) {
      return;
    }
    setConfigDialogMode("enable");
    setActiveConfigProvider(item);
    setConfigDialogOpen(true);
  };

  const updateProviderConfig = (providerId: string, configPatch: Record<string, unknown>) => {
    const configId = PROVIDER_CATALOG.find((entry) => entry.id === providerId)?.configId ?? providerId;
    // Invalidate cached probe results once config is edited.
    setProbeResultByProvider((prev) => {
      const next = { ...prev };
      for (const entry of PROVIDER_CATALOG) {
        const entryConfigId = entry.configId ?? entry.id;
        if (entryConfigId === configId) {
          next[entry.id] = null;
        }
      }
      return next;
    });
    updateSettings((settings) => {
      const configs = { ...getProviderConfigs(settings) };
      if (configId) {
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(configPatch)) {
          if (value === "" || value === null || value === undefined) {
            continue;
          }
          next[key] = value;
        }
        // Normalize string-list fields if present.
        const meta = PROVIDER_CATALOG.find((entry) => entry.id === providerId);
        const fields = meta?.configFields ?? [];
        for (const field of fields) {
          if (field.type === "string" && field.parseAsStringList) {
            const raw = configPatch[field.id];
            if (typeof raw === "string") {
              next[field.id] = splitStringList(raw);
            } else if (Array.isArray(raw)) {
              next[field.id] = raw;
            }
          }
        }
        configs[configId] = next;
      }
      setProviderConfigs(settings, configs);
    });
  };

  const handleProbe = async (item: ProviderCatalogItem) => {
    if (item.builtin) {
      return;
    }
    const configs = providerConfigs;
    const configId = item.configId ?? item.id;
    const rawCfg = configId ? configs[configId] : null;
    const cfg = rawCfg && typeof rawCfg === "object" && !Array.isArray(rawCfg) ? (rawCfg as Record<string, unknown>) : {};
    const missing = getMissingRequiredFields(item, configs);
    if (missing.length > 0) {
      toast(text.toastMissingFields(missing.join(", ")));
      return;
    }
    if (!item.probeId) {
      toast(text.toastProbeUnsupported);
      return;
    }
    const defaultTimeout = item.kind === "web_fetch" ? timeoutSeconds : 10;
    const payload: WebProviderProbePayload = {
      provider: item.probeId as WebProviderProbePayload["provider"],
      api_key: typeof cfg.api_key === "string" ? cfg.api_key : null,
      base_url: typeof cfg.base_url === "string" ? cfg.base_url : null,
      cx: typeof cfg.cx === "string" ? cfg.cx : null,
      engine: typeof cfg.engine === "string" ? cfg.engine : null,
      timeout_seconds: asNumber(cfg.timeout_seconds, defaultTimeout),
      max_results: 1,
    };
    setProbingByProvider((prev) => ({ ...prev, [item.id]: true }));
    try {
      const result = await probeWebProvider(payload);
      setProbeResultByProvider((prev) => ({ ...prev, [item.id]: result }));
      if (result.status === "ok") {
        toast(result.result?.message ?? text.toastProbeConnected);
      } else {
        toast(result.result?.message ?? text.toastProbeFailed);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProbeResultByProvider((prev) => ({
        ...prev,
        [item.id]: { status: "degraded", error_code: "tool_provider_unreachable", result: { message } },
      }));
      toast(text.toastProbeFailedWithReason(message));
    } finally {
      setProbingByProvider((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const maxResults = asNumber(effectiveSettings.web_search?.max_results, 5);
  const timeoutSeconds = asNumber(effectiveSettings.web_fetch?.timeout_seconds, 10);

  const updateSearchOption = (kind: SearchKind, value: number) => {
    updateSettings((settings) => {
      if (kind === "web_search") {
        settings.web_search = {
          ...(settings.web_search ?? {}),
          max_results: value,
        };
        return;
      }
      settings.web_fetch = {
        ...(settings.web_fetch ?? {}),
        timeout_seconds: value,
      };
    });
  };

  const title = text.title;
  const description = text.description;

  const tabSearch = text.tabSearch;
  const tabFetch = text.tabFetch;

  const enabledTitle = text.enabledTitle;
  const enabledSubtitle = text.enabledSubtitle;
  const availableTitle = text.availableTitle;
  const availableSubtitle = text.availableSubtitle;
  const optionsTitle = text.optionsTitle;

  const renderProviderDescription = (item: ProviderCatalogItem) => {
    return locale.startsWith("zh") ? item.descriptionZh : item.descriptionEn;
  };

  const activeConfigProviderConfig = useMemo(() => {
    if (!activeConfigProvider) {
      return null;
    }
    const configs = providerConfigs;
    const configId = activeConfigProvider.configId ?? activeConfigProvider.id;
    const raw = configId ? configs[configId] : null;
    const cfg = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const next: Record<string, unknown> = { ...cfg };
    // Expand array -> multiline for list fields
    for (const field of activeConfigProvider.configFields ?? []) {
      if (field.type === "string" && field.parseAsStringList) {
        const rawValue = next[field.id];
        if (Array.isArray(rawValue)) {
          next[field.id] = (rawValue as unknown[]).map((item) => String(item)).join("\n");
        }
      }
    }
    return next;
  }, [activeConfigProvider, providerConfigs]);

  return (
    <SettingsSection title={title} description={description}>
      <div className="space-y-6">
        <section className="space-y-3 rounded-lg border p-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">{t.common.loading}</div>
          ) : error ? (
            <div className="text-destructive text-sm">
              {error instanceof Error ? error.message : text.loadFailed}
            </div>
          ) : (
            <div className="space-y-4">
              {!storedSettings && derivedLegacySettings ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">{text.legacyHint}</div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={disabled || saving}
                      onClick={() => void migrateLegacyToConfig()}
                    >
                      {text.btnMigrate}
                    </Button>
                  </div>
                </div>
              ) : null}

              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SearchKind)}>
                <TabsList>
                  <TabsTrigger value="web_search">{tabSearch}</TabsTrigger>
                  <TabsTrigger value="web_fetch">{tabFetch}</TabsTrigger>
                </TabsList>

                <TabsContent value="web_search" className="space-y-4">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-sm font-medium">{optionsTitle}</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>{text.maxResultsLabel}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={String(maxResults)}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            updateSearchOption("web_search", Number.isFinite(next) ? next : maxResults);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-medium">{enabledTitle}</div>
                      <div className="text-muted-foreground text-xs">{enabledSubtitle}</div>
                    </div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={activeSearchProviders} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                          {activeSearchProviders.map((providerId) => {
                            const item = getProviderMeta("web_search", providerId);
                            const meta: ProviderCatalogItem = item ?? {
                              id: providerId,
                              name: providerId,
                              descriptionEn: "",
                              descriptionZh: "",
                              kind: "web_search",
                              builtin: false,
                              configId: providerId,
                              probeId: providerId,
                            };
                            const configured = isProviderConfigured(meta, providerConfigs);
                            const probe = probeResultByProvider[providerId] ?? null;
                            const probing = Boolean(probingByProvider[providerId]);
                            return (
                              <SortableProviderRow key={providerId} id={providerId} disabled={disabled}>
                                {({ setActivatorRef, listeners, attributes }) => (
                                  <div className="rounded-md border px-3 py-2.5">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex min-w-0 items-start gap-2">
                                        <button
                                          type="button"
                                          ref={setActivatorRef}
                                          className={cn(
                                            "mt-0.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
                                            disabled ? "cursor-not-allowed opacity-50" : "cursor-grab",
                                          )}
                                          {...attributes}
                                          {...listeners}
                                          aria-label={text.tooltipDrag}
                                          disabled={disabled}
                                        >
                                          <GripVerticalIcon className="size-4" />
                                        </button>
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            <div className="text-sm font-medium">{meta.name}</div>
                                            <ProviderStatusBadge
                                              item={meta}
                                              configured={configured}
                                              probe={probe}
                                              probing={probing}
                                              text={text}
                                            />
                                          </div>
                                          <div className="text-muted-foreground mt-0.5 text-xs">
                                            {renderProviderDescription(meta) || meta.id}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex shrink-0 items-center gap-1">
                                        {!meta.builtin ? (
                                          <>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="secondary"
                                              disabled={disabled}
                                              onClick={() => openProviderDialog(meta)}
                                            >
                                              <Settings2Icon className="mr-1.5 size-3.5" />
                                              {text.btnConfigure}
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="secondary"
                                              disabled={disabled || probing}
                                              onClick={() => void handleProbe(meta)}
                                            >
                                              {text.btnTest}
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              disabled={disabled}
                                              onClick={() => removeProvider("web_search", providerId)}
                                            >
                                              <Trash2Icon className="size-4" />
                                            </Button>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </SortableProviderRow>
                            );
                          })}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-medium">{availableTitle}</div>
                      <div className="text-muted-foreground text-xs">{availableSubtitle}</div>
                    </div>
                    <div className="space-y-2">
                      {availableProviders.map((item) => {
                        const enabled = activeSearchProviders.includes(item.id);
                        return (
                          <div key={item.id} className="rounded-md border px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium">{item.name}</div>
                                  {item.docsUrl ? (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      disabled={disabled}
                                      onClick={() => window.open(item.docsUrl, "_blank", "noreferrer")}
                                      aria-label="docs"
                                    >
                                      <ExternalLinkIcon className="size-4" />
                                    </Button>
                                  ) : null}
                                </div>
                                <div className="text-muted-foreground mt-0.5 text-xs">
                                  {renderProviderDescription(item)}
                                </div>
                              </div>
                              <Switch
                                checked={enabled}
                                disabled={disabled}
                                aria-label={item.name}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    return;
                                  }
                                  startEnableProvider(item);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="web_fetch" className="space-y-4">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-sm font-medium">{optionsTitle}</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>{text.timeoutLabel}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          value={String(timeoutSeconds)}
                          disabled={disabled}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            updateSearchOption("web_fetch", Number.isFinite(next) ? next : timeoutSeconds);
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-medium">{enabledTitle}</div>
                      <div className="text-muted-foreground text-xs">{enabledSubtitle}</div>
                    </div>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                      <SortableContext items={activeFetchProviders} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                          {activeFetchProviders.map((providerId) => {
                            const item = getProviderMeta("web_fetch", providerId);
                            const meta: ProviderCatalogItem = item ?? {
                              id: providerId,
                              name: providerId,
                              descriptionEn: "",
                              descriptionZh: "",
                              kind: "web_fetch",
                              builtin: false,
                              configId: providerId,
                              probeId: providerId,
                            };
                            const configured = isProviderConfigured(meta, providerConfigs);
                            const probe = probeResultByProvider[providerId] ?? null;
                            const probing = Boolean(probingByProvider[providerId]);
                            return (
                              <SortableProviderRow key={providerId} id={providerId} disabled={disabled}>
                                {({ setActivatorRef, listeners, attributes }) => (
                                  <div className="rounded-md border px-3 py-2.5">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex min-w-0 items-start gap-2">
                                        <button
                                          type="button"
                                          ref={setActivatorRef}
                                          className={cn(
                                            "mt-0.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
                                            disabled ? "cursor-not-allowed opacity-50" : "cursor-grab",
                                          )}
                                          {...attributes}
                                          {...listeners}
                                          aria-label={text.tooltipDrag}
                                          disabled={disabled}
                                        >
                                          <GripVerticalIcon className="size-4" />
                                        </button>
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            <div className="text-sm font-medium">{meta.name}</div>
                                            <ProviderStatusBadge
                                              item={meta}
                                              configured={configured}
                                              probe={probe}
                                              probing={probing}
                                              text={text}
                                            />
                                          </div>
                                          <div className="text-muted-foreground mt-0.5 text-xs">
                                            {renderProviderDescription(meta) || meta.id}
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex shrink-0 items-center gap-1">
                                        {!meta.builtin ? (
                                          <>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="secondary"
                                              disabled={disabled}
                                              onClick={() => openProviderDialog(meta)}
                                            >
                                              <Settings2Icon className="mr-1.5 size-3.5" />
                                              {text.btnConfigure}
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="secondary"
                                              disabled={disabled || probing}
                                              onClick={() => void handleProbe(meta)}
                                            >
                                              {text.btnTest}
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="ghost"
                                              disabled={disabled}
                                              onClick={() => removeProvider("web_fetch", providerId)}
                                            >
                                              <Trash2Icon className="size-4" />
                                            </Button>
                                          </>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </SortableProviderRow>
                            );
                          })}
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <div className="text-sm font-medium">{availableTitle}</div>
                      <div className="text-muted-foreground text-xs">{availableSubtitle}</div>
                    </div>
                    <div className="space-y-2">
                      {availableProviders.map((item) => {
                        const enabled = activeFetchProviders.includes(item.id);
                        return (
                          <div key={item.id} className="rounded-md border px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium">{item.name}</div>
                                  {item.docsUrl ? (
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      disabled={disabled}
                                      onClick={() => window.open(item.docsUrl, "_blank", "noreferrer")}
                                      aria-label="docs"
                                    >
                                      <ExternalLinkIcon className="size-4" />
                                    </Button>
                                  ) : null}
                                </div>
                                <div className="text-muted-foreground mt-0.5 text-xs">
                                  {renderProviderDescription(item)}
                                </div>
                              </div>
                              <Switch
                                checked={enabled}
                                disabled={disabled}
                                aria-label={item.name}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    return;
                                  }
                                  startEnableProvider(item);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <ConfigValidationErrors errors={validationErrors} warnings={validationWarnings} />
              <ConfigSaveBar
                dirty={dirty}
                disabled={disabled}
                saving={saving}
                onDiscard={onDiscard}
                onSave={() => {
                  void onSave();
                }}
              />
            </div>
          )}
        </section>

        {activeConfigProvider ? (
          <ProviderConfigDialog
            open={configDialogOpen}
            onOpenChange={(open) => {
              setConfigDialogOpen(open);
              if (!open) {
                setActiveConfigProvider(null);
                setConfigDialogMode("edit");
              }
            }}
            item={activeConfigProvider}
            mode={configDialogMode}
            disabled={disabled}
            testing={Boolean(probingByProvider[activeConfigProvider.id])}
            testResult={probeResultByProvider[activeConfigProvider.id] ?? null}
            config={activeConfigProviderConfig ?? {}}
            onChange={(nextConfig) => updateProviderConfig(activeConfigProvider.id, nextConfig)}
            onTest={() => void handleProbe(activeConfigProvider)}
            onEnable={() => {
              const probe = probeResultByProvider[activeConfigProvider.id] ?? null;
              if (probe?.status !== "ok") {
                return;
              }
              toggleProvider(activeConfigProvider.kind, activeConfigProvider.id, true);
              setConfigDialogOpen(false);
              setActiveConfigProvider(null);
              setConfigDialogMode("edit");
            }}
            text={text}
          />
        ) : null}
      </div>
    </SettingsSection>
  );
}
