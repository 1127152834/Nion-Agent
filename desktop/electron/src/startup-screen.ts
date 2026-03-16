import { getDesktopStartupCopy, type DesktopLocale } from "./i18n";

export interface StartupLoadingHtmlContext {
  locale: DesktopLocale;
  appVersion: string;
  startupLogoDataUri: string | null;
}

/**
 * Startup loading page used before the runtime/frontend UI is ready.
 *
 * NOTE:
 * - This HTML is intentionally rendered as a data URL for resilience (no external asset deps).
 * - The main process updates the UI via window.__updateBootstrap/__showBootstrapFailure hooks.
 */
export function renderStartupLoadingHtml(context: StartupLoadingHtmlContext): string {
  const text = getDesktopStartupCopy(context.locale);
  const startupSlogans = text.startupSlogans;
  const randomSloganIndex = Math.floor(Math.random() * startupSlogans.length);
  const startupSlogan = startupSlogans[randomSloganIndex];

  const startupLogoMarkup = context.startupLogoDataUri
    ? `<img class="brand-logo-image" src="${context.startupLogoDataUri}" alt="Nion logo" />`
    : `<span class="brand-logo-fallback">N</span>`;

  const brandKickerClass = context.locale === "zh-CN" ? "brand-kicker cjk" : "brand-kicker";

  return `<!doctype html>
<html lang="${context.locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${text.windowTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #faf9f6;
        --ink-strong: #23344f;
        --ink-main: #5f6f85;
        --ink-subtle: #909bad;
        --line: #e3e5ea;
        --blue: #3f7bf2;
        --blue-dark: #2f69de;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
      }

      body {
        margin: 0;
        overflow: hidden;
        user-select: none;
        -webkit-user-select: none;
        font-family: "Inter", "SF Pro Display", "PingFang SC", "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--ink-strong);
      }

      .loading-root {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }

      .bg-radial {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(circle at 50% 45%, rgba(59, 130, 246, 0.05), transparent 70%);
      }

      .brand-zone {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        margin-bottom: 82px;
      }

      .brand-logo-wrap {
        position: relative;
        width: 80px;
        height: 80px;
        border-radius: 24px;
        display: grid;
        place-items: center;
        margin-bottom: 22px;
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0.3));
        border: 1px solid rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(20px) saturate(165%);
        -webkit-backdrop-filter: blur(20px) saturate(165%);
        box-shadow:
          0 16px 34px rgba(33, 52, 79, 0.18),
          inset 0 1px 0 rgba(255, 255, 255, 0.68),
          inset 0 -10px 18px rgba(210, 222, 239, 0.36);
      }

      .brand-logo-wrap::before {
        content: "";
        position: absolute;
        inset: -26px;
        border-radius: 999px;
        pointer-events: none;
        background: radial-gradient(circle, rgba(59, 130, 246, 0.16), rgba(59, 130, 246, 0));
        animation: breathe 5s ease-in-out infinite;
      }

      .brand-logo-wrap::after {
        content: "";
        position: absolute;
        inset: 2px;
        border-radius: 22px;
        pointer-events: none;
        background: linear-gradient(160deg, rgba(255, 255, 255, 0.45), rgba(255, 255, 255, 0.08));
      }

      .brand-logo-image {
        width: 46px;
        height: 46px;
        object-fit: contain;
        filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.2));
      }

      .brand-logo-fallback {
        width: 46px;
        height: 46px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        font-size: 24px;
        font-weight: 700;
        color: #ffffff;
        background: linear-gradient(145deg, rgba(59, 130, 246, 0.8), rgba(59, 130, 246, 0.5));
      }

      .brand-title {
        margin: 0;
        font-size: 54px;
        line-height: 1.05;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .brand-kicker {
        margin-top: 16px;
        font-size: 13px;
        line-height: 1;
        letter-spacing: 0.14em;
        color: var(--ink-subtle);
      }

      .brand-kicker.cjk {
        letter-spacing: 0.06em;
        font-size: 15px;
        font-weight: 500;
      }

      .brand-slogan {
        margin: 18px 0 0;
        font-size: 18px;
        line-height: 1.4;
        color: #5d708b;
        text-align: center;
      }

      .runtime-panel {
        position: relative;
        z-index: 1;
        width: min(620px, calc(100vw - 42px));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .state-line {
        width: 100%;
        text-align: center;
        font-size: 16px;
        line-height: 1.35;
        font-weight: 600;
        color: #5d6d84;
      }

      .detail-line {
        margin-top: -2px;
        width: 100%;
        text-align: center;
        font-size: 13px;
        line-height: 1.4;
        color: #909bad;
      }

      .log-mask {
        width: 100%;
        height: 56px;
        overflow: hidden;
        mask-image: linear-gradient(to bottom, transparent, black 40%, black 60%, transparent);
        -webkit-mask-image: linear-gradient(to bottom, transparent, black 40%, black 60%, transparent);
      }

      .log-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        transition: transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1);
      }

      .log-item {
        height: 28px;
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 13px;
        line-height: 1;
        font-weight: 500;
        color: #626f82;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .log-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(59, 130, 246, 0.66);
        flex: 0 0 auto;
      }

      .progress-wrap {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .progress-track {
        width: 100%;
        height: 2px;
        border-radius: 999px;
        background: rgba(31, 41, 55, 0.1);
        overflow: hidden;
        position: relative;
      }

      .progress-bar {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        width: 0%;
        background: var(--blue);
        transition: width 320ms ease;
      }

      .progress-glow {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        width: 70px;
        background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.45), transparent);
        animation: shimmer 2.5s linear infinite;
      }

      .progress-meta {
        width: 100%;
        display: flex;
        justify-content: space-between;
        padding: 0 2px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 10px;
        line-height: 1;
        font-weight: 700;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: rgba(100, 116, 139, 0.75);
      }

      .engine-meta {
        position: fixed;
        bottom: 34px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 8px;
        line-height: 1;
        letter-spacing: 0.3em;
        font-weight: 300;
        text-transform: uppercase;
        color: rgba(100, 116, 139, 0.38);
        pointer-events: none;
      }

      .error-panel {
        position: fixed;
        left: 50%;
        bottom: 88px;
        transform: translateX(-50%);
        width: min(560px, calc(100vw - 20px));
        background: rgba(255, 247, 247, 0.96);
        border: 1px solid rgba(220, 149, 149, 0.5);
        border-radius: 14px;
        box-shadow: 0 20px 40px rgba(108, 63, 63, 0.12);
        padding: 14px 14px 12px;
        z-index: 3;
      }

      .hidden {
        display: none;
      }

      .error-title {
        margin: 0;
        font-size: 18px;
        line-height: 1.2;
        font-weight: 700;
        color: #7f2d2d;
      }

      .error-summary {
        margin-top: 7px;
        font-size: 14px;
        line-height: 1.4;
        color: #6a4545;
      }

      .error-detail {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.4;
        color: #7e5e5e;
        white-space: pre-wrap;
      }

      .error-meta {
        margin-top: 8px;
        font-size: 11px;
        color: #8a6a6a;
      }

      .error-actions {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      button {
        border: 0;
        border-radius: 8px;
        padding: 7px 11px;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }

      button[disabled] {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-primary {
        background: #2f69de;
        color: #fff;
      }

      .btn-secondary {
        background: #e5e7eb;
        color: #374151;
      }

      .btn-danger {
        background: #9f2f2f;
        color: #fff;
      }

      @keyframes shimmer {
        0% {
          transform: translateX(-100%);
        }
        100% {
          transform: translateX(200%);
        }
      }

      @keyframes breathe {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.1;
        }
        50% {
          transform: scale(1.15);
          opacity: 0.25;
        }
      }

      @media (max-width: 680px) {
        .brand-zone {
          margin-bottom: 68px;
        }

        .brand-title {
          font-size: 42px;
        }

        .brand-slogan {
          font-size: 15px;
          margin-top: 14px;
        }

        .runtime-panel {
          width: min(620px, calc(100vw - 20px));
        }
      }
    </style>
  </head>
  <body>
    <div class="bg-radial" aria-hidden="true"></div>

    <main id="loadingScreen" class="loading-root" aria-label="${text.startupLoadingAriaLabel}">
      <section class="brand-zone">
        <div class="brand-logo-wrap" aria-hidden="true">
          ${startupLogoMarkup}
        </div>
        <h1 class="brand-title">${text.startupBrandTitle}</h1>
        <span class="${brandKickerClass}">${text.startupCompanionLabel}</span>
        <p class="brand-slogan" id="brandSlogan">${startupSlogan}</p>
      </section>

      <section class="runtime-panel">
        <div id="stateLine" class="state-line">${text.startupStateInit}</div>
        <div id="detailLine" class="detail-line">${text.startupDetailInit}</div>

        <div class="log-mask">
          <div id="logContainer" class="log-container"></div>
        </div>

        <div class="progress-wrap">
          <div class="progress-track" data-role="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="${text.startupProgressAriaLabel}">
            <div id="progressBar" class="progress-bar"></div>
            <div class="progress-glow" aria-hidden="true"></div>
          </div>
          <div class="progress-meta">
            <span>${text.startupProgressLabel}</span>
            <span id="progressText">0%</span>
          </div>
        </div>
      </section>

      <section id="errorPanel" class="error-panel hidden" aria-live="polite" aria-atomic="true">
        <h2 id="errorTitle" class="error-title">${text.startupErrorTitle}</h2>
        <div id="errorSummary" class="error-summary"></div>
        <div id="errorDetail" class="error-detail"></div>
        <div id="errorActions" class="error-actions"></div>
        <div id="errorMeta" class="error-meta"></div>
      </section>

      <div class="engine-meta">${text.startupEngineVersionPrefix} ${context.appVersion}</div>
    </main>

    <script>
      const loadingScreenEl = document.getElementById("loadingScreen");
      const errorPanelEl = document.getElementById("errorPanel");
      const stateLineEl = document.getElementById("stateLine");
      const detailLineEl = document.getElementById("detailLine");
      const progressBarEl = document.getElementById("progressBar");
      const progressTextEl = document.getElementById("progressText");
      const progressTrackEl = document.querySelector('[data-role="progress-track"]');
      const logContainerEl = document.getElementById("logContainer");
      const errorTitleEl = document.getElementById("errorTitle");
      const errorSummaryEl = document.getElementById("errorSummary");
      const errorDetailEl = document.getElementById("errorDetail");
      const errorActionsEl = document.getElementById("errorActions");
      const errorMetaEl = document.getElementById("errorMeta");

      const LOG_LINE_HEIGHT = 28;
      const MAX_VISIBLE_LOGS = 2;
      const MAX_LOG_ITEMS = 12;

      const startupStateInit = ${JSON.stringify(text.startupStateInit)};
      const startupDetailInit = ${JSON.stringify(text.startupDetailInit)};
      const startupLogInitMessage = ${JSON.stringify(text.startupLogInitMessage)};
      const startupLogInitDetail = ${JSON.stringify(text.startupLogInitDetail)};
      const startupErrorTitle = ${JSON.stringify(text.startupErrorTitle)};
      const startupErrorCodePrefix = ${JSON.stringify(text.startupErrorCodePrefix)};
      const startupErrorCodeUnknown = ${JSON.stringify(text.startupErrorCodeUnknown)};
      const startupAttemptPrefix = ${JSON.stringify(text.startupAttemptPrefix)};
      const startupAttemptSuffix = ${JSON.stringify(text.startupAttemptSuffix)};
      const startupActionFallback = ${JSON.stringify(text.startupActionFallback)};

      const logs = [];
      let latestPercent = 0;

      const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

      const setModeLoading = () => {
        loadingScreenEl?.classList.remove("hidden");
        errorPanelEl?.classList.add("hidden");
      };

      const setModeError = () => {
        loadingScreenEl?.classList.remove("hidden");
        errorPanelEl?.classList.remove("hidden");
      };

      const setButtonsDisabled = (disabled) => {
        if (!errorActionsEl) return;
        for (const node of errorActionsEl.querySelectorAll("button")) {
          node.disabled = Boolean(disabled);
        }
      };

      const renderLogs = () => {
        if (!logContainerEl) return;
        logContainerEl.textContent = "";

        for (const text of logs) {
          const row = document.createElement("div");
          row.className = "log-item";

          const dot = document.createElement("span");
          dot.className = "log-dot";

          const content = document.createElement("span");
          content.textContent = text;

          row.appendChild(dot);
          row.appendChild(content);
          logContainerEl.appendChild(row);
        }

        const offset = Math.max(0, logs.length - MAX_VISIBLE_LOGS) * LOG_LINE_HEIGHT;
        logContainerEl.style.transform = "translateY(-" + offset + "px)";
      };

      const appendLog = (message, detail) => {
        const content = [message, detail].filter(Boolean).join(" · ");
        if (!content) return;
        if (logs[logs.length - 1] === content) return;
        logs.push(content);
        if (logs.length > MAX_LOG_ITEMS) {
          logs.splice(0, logs.length - MAX_LOG_ITEMS);
        }
        renderLogs();
      };

      const renderProgress = (percent) => {
        const normalized = clamp(percent, 0, 1);
        if (progressBarEl) {
          progressBarEl.style.width = (normalized * 100).toFixed(1) + "%";
        }
        if (progressTextEl) {
          progressTextEl.textContent = Math.round(normalized * 100) + "%";
        }
        if (progressTrackEl) {
          progressTrackEl.setAttribute("aria-valuenow", String(Math.round(normalized * 100)));
        }
      };

      window.__resetBootstrapStatus = () => {
        setModeLoading();
        logs.length = 0;
        latestPercent = 0;
        if (stateLineEl) stateLineEl.textContent = startupStateInit;
        if (detailLineEl) detailLineEl.textContent = startupDetailInit;
        appendLog(startupLogInitMessage, startupLogInitDetail);
        renderProgress(0);
      };

      window.__updateBootstrap = (payload) => {
        setModeLoading();
        const message = payload?.message || "";
        const detail = payload?.detail || "";
        if (stateLineEl && message) {
          stateLineEl.textContent = message;
        }
        if (detailLineEl) {
          detailLineEl.textContent = detail;
        }
        if (typeof payload?.percent === "number") {
          latestPercent = Math.max(latestPercent, clamp(payload.percent, 0, 1));
          renderProgress(latestPercent);
        }
        appendLog(message, detail);
      };

      window.__showBootstrapFailure = async (payload) => {
        setModeError();
        if (errorTitleEl) errorTitleEl.textContent = payload?.title || startupErrorTitle;
        if (errorSummaryEl) errorSummaryEl.textContent = payload?.summary || "";
        if (errorDetailEl) errorDetailEl.textContent = payload?.detail || "";
        if (errorMetaEl) {
          const codeText = payload?.code
            ? startupErrorCodePrefix + payload.code
            : startupErrorCodePrefix + startupErrorCodeUnknown;
          const attemptText = payload?.attempt
            ? startupAttemptPrefix + payload.attempt + startupAttemptSuffix
            : "";
          errorMetaEl.textContent = [codeText, attemptText].filter(Boolean).join(" | ");
        }

        if (!errorActionsEl) return;
        errorActionsEl.innerHTML = "";

        const actions = Array.isArray(payload?.actions) ? payload.actions : [];
        for (const action of actions) {
          const button = document.createElement("button");
          button.textContent = action?.label || action?.id || startupActionFallback;
          const kind = action?.kind || "secondary";
          button.className =
            kind === "primary" ? "btn-primary" : kind === "danger" ? "btn-danger" : "btn-secondary";

          button.onclick = async () => {
            setButtonsDisabled(true);
            try {
              const result = await window.electronAPI?.startupRecovery?.(action.id);
              if (result?.statusMessage && errorDetailEl) {
                errorDetailEl.textContent = result.statusMessage;
              }
            } catch (error) {
              if (errorDetailEl) {
                errorDetailEl.textContent = String(error);
              }
            } finally {
              setButtonsDisabled(false);
            }
          };

          errorActionsEl.appendChild(button);
        }
      };

      window.__resetBootstrapStatus();
    </script>
  </body>
</html>`;
}

