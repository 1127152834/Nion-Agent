export const DESKTOP_SUPPORTED_LOCALES = ["en-US", "zh-CN"] as const;
export type DesktopLocale = (typeof DESKTOP_SUPPORTED_LOCALES)[number];

export interface StartupStageCopy {
  message: string;
  detail: string;
  percent: number;
}

export interface DesktopStartupCopy {
  windowTitle: string;
  startupLoadingAriaLabel: string;
  startupBrandTitle: string;
  startupCompanionLabel: string;
  startupSlogans: readonly string[];
  startupStateInit: string;
  startupDetailInit: string;
  startupLogInitMessage: string;
  startupLogInitDetail: string;
  startupProgressAriaLabel: string;
  startupProgressLabel: string;
  startupDoneMessage: string;
  startupDoneDetail: string;
  startupErrorTitle: string;
  startupErrorSummary: string;
  startupErrorDependencySummary: string;
  startupErrorPortSummary: string;
  startupErrorCodePrefix: string;
  startupErrorCodeUnknown: string;
  startupEngineVersionPrefix: string;
  startupStages: Record<string, StartupStageCopy>;
}

const DESKTOP_STARTUP_I18N: Record<DesktopLocale, DesktopStartupCopy> = {
  "zh-CN": {
    windowTitle: "一念 Nion",
    startupLoadingAriaLabel: "Nion 启动加载页",
    startupBrandTitle: "Nion",
    startupCompanionLabel: "你的全能AI伙伴",
    startupSlogans: [
      "一念之间，万事即达。",
      "你的独特AI智能助手，懂你所想，为你而行。",
      "告别繁琐操作，只需一个念头。",
      "工作与生活，皆可轻松托付。",
      "你开口即指令，Nion即行动。",
      "把复杂留给系统，把专注留给你。"
    ],
    startupStateInit: "初始化运行环境",
    startupDetailInit: "正在检测本地依赖与系统服务…",
    startupLogInitMessage: "初始化核心模块",
    startupLogInitDetail: "等待启动信号",
    startupProgressAriaLabel: "启动进度",
    startupProgressLabel: "加载中",
    startupDoneMessage: "启动完成",
    startupDoneDetail: "服务已就绪，正在进入工作区",
    startupErrorTitle: "启动失败",
    startupErrorSummary: "启动过程中出现错误，请查看日志后重试。",
    startupErrorDependencySummary: "缺少 uv 或 pnpm 依赖，请安装后重试。",
    startupErrorPortSummary: "启动端口被占用，请释放后重试。",
    startupErrorCodePrefix: "错误码: ",
    startupErrorCodeUnknown: "unknown",
    startupEngineVersionPrefix: "ENGINE VERSION",
    startupStages: {
      "runtime.assign-ports": {
        message: "分配本地端口",
        detail: "为前端、网关和 LangGraph 选择可用端口",
        percent: 0.24
      },
      "runtime.check-dependencies": {
        message: "检查运行依赖",
        detail: "验证 uv、pnpm 与必要命令可用",
        percent: 0.42
      },
      "runtime.start.langgraph": {
        message: "启动 Agent 引擎",
        detail: "正在拉起 LangGraph 服务",
        percent: 0.62
      },
      "runtime.start.gateway": {
        message: "启动 API 网关",
        detail: "正在拉起 127.0.0.1 网关服务",
        percent: 0.78
      },
      "runtime.start.frontend": {
        message: "启动前端界面",
        detail: "正在加载本地桌面 UI 服务",
        percent: 0.92
      }
    }
  },
  "en-US": {
    windowTitle: "Nion",
    startupLoadingAriaLabel: "Nion startup loading page",
    startupBrandTitle: "Nion",
    startupCompanionLabel: "Your All-in-One AI Companion",
    startupSlogans: [
      "From one thought to done.",
      "Your personal AI partner, built to act.",
      "Skip tedious steps. Keep your focus.",
      "Work and life, handled with ease.",
      "You ask. Nion executes.",
      "Leave complexity to the system."
    ],
    startupStateInit: "Initializing runtime",
    startupDetailInit: "Checking local dependencies and services…",
    startupLogInitMessage: "Initializing core modules",
    startupLogInitDetail: "Waiting for startup signal",
    startupProgressAriaLabel: "Startup progress",
    startupProgressLabel: "Loading",
    startupDoneMessage: "Startup completed",
    startupDoneDetail: "Services are ready. Entering workspace",
    startupErrorTitle: "Startup failed",
    startupErrorSummary: "Startup encountered an error. Check logs and retry.",
    startupErrorDependencySummary: "Missing uv or pnpm dependencies. Install them and retry.",
    startupErrorPortSummary: "Required startup ports are occupied. Free the ports and retry.",
    startupErrorCodePrefix: "Error code: ",
    startupErrorCodeUnknown: "unknown",
    startupEngineVersionPrefix: "ENGINE VERSION",
    startupStages: {
      "runtime.assign-ports": {
        message: "Assigning local ports",
        detail: "Selecting available ports for frontend, gateway and LangGraph",
        percent: 0.24
      },
      "runtime.check-dependencies": {
        message: "Checking dependencies",
        detail: "Verifying uv, pnpm and required commands",
        percent: 0.42
      },
      "runtime.start.langgraph": {
        message: "Starting Agent engine",
        detail: "Launching LangGraph service",
        percent: 0.62
      },
      "runtime.start.gateway": {
        message: "Starting API gateway",
        detail: "Launching local gateway on 127.0.0.1",
        percent: 0.78
      },
      "runtime.start.frontend": {
        message: "Starting frontend UI",
        detail: "Loading local desktop UI service",
        percent: 0.92
      }
    }
  }
};

export function normalizeDesktopLocale(locale: string | null | undefined): DesktopLocale {
  const normalized = (locale ?? "").trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  return "en-US";
}

export function getDesktopStartupCopy(locale: DesktopLocale): DesktopStartupCopy {
  return DESKTOP_STARTUP_I18N[locale];
}

export function resolveStartupStageCopy(
  locale: DesktopLocale,
  stage: string
): StartupStageCopy | null {
  return getDesktopStartupCopy(locale).startupStages[stage] ?? null;
}
