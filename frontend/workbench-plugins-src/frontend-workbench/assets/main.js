(function () {
  const bridge = window.NionWorkbench;
  if (!bridge || typeof bridge.call !== "function") {
    document.body.innerHTML = "<pre style='padding:16px'>Workbench bridge unavailable</pre>";
    return;
  }

  const ROOT = "/mnt/user-data";
  const PREVIEW_TIMEOUT_MS = 120000;
  const PREVIEW_PORT_START = 14900;
  const PREVIEW_PORT_MAX = 15999;
  const MOBILE_BREAKPOINT = 900;
  const SIDEBAR_MIN_PERCENT = 16;
  const SIDEBAR_MAX_PERCENT = 72;
  const SIDEBAR_MIN_PX = 180;
  const EDITOR_MIN_PX = 300;
  const ALLOWED_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

  const state = {
    viewMode: "code",
    projectRoot: ROOT,
    packageManager: "pnpm",
    scripts: {},
    buildCommand: "",
    deployCommand: "",
    deployScriptName: "",
    detectedScriptPort: null,
    previewPort: PREVIEW_PORT_START,

    treeRoot: null,
    treeQuery: "",
    loadingTree: false,
    sidebarOpen: true,
    sidebarOpenPersisted: null,
    sidebarWidthPercent: 26,

    tabs: [],
    activeTabId: null,

    deviceMode: "desktop",
    previewUrl: "",
    previewSessionId: null,
    previewStreamStop: null,

    consoleOpen: false,
    logs: [],
    logSeq: 0,
  };

  let previewEnsurePromise = null;
  let wasMobileViewport = window.innerWidth <= MOBILE_BREAKPOINT;

  const refs = {};

  function $(id) {
    return document.getElementById(id);
  }

  function apiCall(method, params) {
    return bridge.call(method, params || {});
  }

  function toast(message, type) {
    return apiCall("toast", { message: message, type: type || "info" }).catch(function () {
      return undefined;
    });
  }

  function escapeHtml(raw) {
    return String(raw || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function nowTime() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return h + ":" + m + ":" + s;
  }

  function normalizePath(path) {
    return String(path || "").replace(/\\/g, "/");
  }

  function pathName(path) {
    const parts = normalizePath(path).split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
  }

  function dirName(path) {
    const normalized = normalizePath(path);
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return ROOT;
    return normalized.slice(0, idx);
  }

  function extName(path) {
    const name = pathName(path);
    const idx = name.lastIndexOf(".");
    if (idx < 0) return "";
    return name.slice(idx + 1).toLowerCase();
  }

  function activeTab() {
    if (!state.activeTabId) {
      return null;
    }
    for (let i = 0; i < state.tabs.length; i += 1) {
      if (state.tabs[i].id === state.activeTabId) {
        return state.tabs[i];
      }
    }
    return null;
  }

  function addLog(type, message) {
    const normalizedType = type === "error" || type === "success" ? type : "info";
    state.logSeq += 1;
    state.logs.push({
      id: "log-" + state.logSeq,
      type: normalizedType,
      message: String(message || ""),
      time: nowTime(),
    });
    if (state.logs.length > 500) {
      state.logs.splice(0, state.logs.length - 500);
    }
    renderLogs();
  }

  function renderLogs() {
    const errorCount = state.logs.filter(function (item) {
      return item.type === "error";
    }).length;
    refs.consoleErrorCount.textContent = String(errorCount);

    if (!state.logs.length) {
      refs.consoleLogs.innerHTML = "<div class='console-empty'>暂无日志...</div>";
      return;
    }

    refs.consoleLogs.innerHTML = state.logs
      .map(function (item) {
        const copyBtn =
          item.type === "error"
            ? "<button class='log-copy' data-copy='" + escapeHtml(item.id) + "' type='button'>复制</button>"
            : "";
        return (
          "<div class='log-row " +
          escapeHtml(item.type) +
          "'>" +
          "<span class='log-time'>" +
          escapeHtml(item.time) +
          "</span>" +
          "<span class='log-msg'>" +
          escapeHtml(item.message) +
          "</span>" +
          copyBtn +
          "</div>"
        );
      })
      .join("");

    refs.consoleLogs.scrollTop = refs.consoleLogs.scrollHeight;

    const copyButtons = refs.consoleLogs.querySelectorAll("[data-copy]");
    for (let i = 0; i < copyButtons.length; i += 1) {
      copyButtons[i].addEventListener("click", function (event) {
        const id = event.currentTarget && event.currentTarget.getAttribute("data-copy");
        if (!id) return;
        const logItem = state.logs.find(function (item) {
          return item.id === id;
        });
        if (!logItem) return;
        navigator.clipboard
          .writeText(logItem.message)
          .then(function () {
            toast("错误日志已复制", "success");
          })
          .catch(function () {
            toast("复制失败", "error");
          });
      });
    }
  }

  function updateConsoleState() {
    refs.consolePanel.classList.toggle("hidden", !state.consoleOpen);
    refs.consoleToggleBtn.setAttribute("aria-expanded", state.consoleOpen ? "true" : "false");
    refs.consoleToggleArrow.textContent = state.consoleOpen ? "▾" : "▴";
  }

  function showPreviewLoading() {
    refs.previewLoading.classList.remove("hidden");
  }

  function hidePreviewLoading() {
    refs.previewLoading.classList.add("hidden");
  }

  function updateViewMode() {
    const isCode = state.viewMode === "code";
    refs.codeModeBtn.classList.toggle("active", isCode);
    refs.previewModeBtn.classList.toggle("active", !isCode);
    refs.codeModeBtn.setAttribute("aria-selected", isCode ? "true" : "false");
    refs.previewModeBtn.setAttribute("aria-selected", isCode ? "false" : "true");
    refs.codeView.classList.toggle("hidden", !isCode);
    refs.previewView.classList.toggle("hidden", isCode);
  }

  function updateDeviceMode() {
    refs.previewDeviceFrame.classList.remove("desktop", "tablet", "mobile");
    refs.previewDeviceFrame.classList.add(state.deviceMode);

    if (state.deviceMode === "desktop") {
      refs.deviceMenuBtn.textContent = "🖥";
    } else if (state.deviceMode === "tablet") {
      refs.deviceMenuBtn.textContent = "📱";
    } else {
      refs.deviceMenuBtn.textContent = "📲";
    }

    apiCall("persistState.set", {
      key: "frontend-workbench.preview.deviceMode",
      value: state.deviceMode,
    }).catch(function () {
      return undefined;
    });
  }

  function clampSidebarPercent(rawPercent) {
    const normalizedRaw = Number.isFinite(Number(rawPercent)) ? Number(rawPercent) : 26;
    const rect = refs.codeMain.getBoundingClientRect();
    const width = rect && rect.width > 0 ? rect.width : 0;

    let minPercent = SIDEBAR_MIN_PERCENT;
    let maxPercent = SIDEBAR_MAX_PERCENT;
    if (width > 0) {
      minPercent = Math.max(minPercent, (SIDEBAR_MIN_PX / width) * 100);
      maxPercent = Math.min(maxPercent, ((width - EDITOR_MIN_PX) / width) * 100);
      if (!Number.isFinite(maxPercent)) {
        maxPercent = SIDEBAR_MAX_PERCENT;
      }
    }

    if (maxPercent < minPercent) {
      maxPercent = minPercent;
    }

    return Math.max(minPercent, Math.min(maxPercent, normalizedRaw));
  }

  function applySidebarWidthPercent(rawPercent) {
    const clamped = clampSidebarPercent(rawPercent);
    state.sidebarWidthPercent = clamped;
    refs.codeMain.style.setProperty("--sidebar-width-percent", clamped.toFixed(2) + "%");
  }

  function persistSidebarState() {
    apiCall("persistState.set", {
      key: "frontend-workbench.sidebar.widthPercent",
      value: state.sidebarWidthPercent,
    }).catch(function () {
      return undefined;
    });

    apiCall("persistState.set", {
      key: "frontend-workbench.sidebar.open",
      value: state.sidebarOpen,
    }).catch(function () {
      return undefined;
    });
  }

  function updateSidebarState() {
    refs.explorerToggleBtn.classList.toggle("active", state.sidebarOpen);
    refs.explorerToggleBtn.setAttribute("aria-pressed", state.sidebarOpen ? "true" : "false");
    refs.codeView.classList.toggle("sidebar-collapsed", !state.sidebarOpen);
    if (state.sidebarOpen) {
      applySidebarWidthPercent(state.sidebarWidthPercent);
    }
  }

  function applyInitialSidebarState() {
    wasMobileViewport = window.innerWidth <= MOBILE_BREAKPOINT;
    if (typeof state.sidebarOpenPersisted === "boolean") {
      state.sidebarOpen = state.sidebarOpenPersisted;
    } else {
      state.sidebarOpen = !wasMobileViewport;
    }
    applySidebarWidthPercent(state.sidebarWidthPercent);
    updateSidebarState();
  }

  function fileExists(path) {
    return apiCall("readFile", { path: path }).then(
      function () {
        return true;
      },
      function () {
        return false;
      }
    );
  }

  function detectPackageManager(projectRoot) {
    return Promise.all([
      fileExists(projectRoot + "/pnpm-lock.yaml"),
      fileExists(projectRoot + "/yarn.lock"),
      fileExists(projectRoot + "/package-lock.json"),
    ]).then(function (result) {
      if (result[0]) return "pnpm";
      if (result[1]) return "yarn";
      if (result[2]) return "npm";
      return "pnpm";
    });
  }

  function resolveProjectRoot() {
    const candidates = [];
    const artifactPath = typeof bridge.artifactPath === "string" ? normalizePath(bridge.artifactPath) : "";
    if (artifactPath && artifactPath.startsWith(ROOT)) {
      let cursor = artifactPath;
      if (/\.[^/]+$/.test(cursor)) {
        cursor = dirName(cursor);
      }
      while (cursor && cursor.startsWith(ROOT)) {
        candidates.push(cursor);
        if (cursor === ROOT) break;
        const parent = dirName(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    }

    if (!candidates.includes(ROOT)) {
      candidates.push(ROOT);
    }

    let chain = Promise.resolve(null);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      chain = chain.then(function (found) {
        if (found) return found;
        return fileExists(candidate + "/package.json").then(function (exists) {
          return exists ? candidate : null;
        });
      });
    }

    return chain.then(function (found) {
      return found || ROOT;
    });
  }

  function parsePortFromScript(script) {
    const source = String(script || "").trim();
    if (!source) return null;

    const patterns = [
      /(?:^|\s)--port(?:\s|=)(\d{2,5})(?=\D|$)/i,
      /(?:^|\s)-p(?:\s|=)(\d{2,5})(?=\D|$)/i,
      /(?:^|\s)PORT=(\d{2,5})(?=\D|$)/i,
    ];

    for (let i = 0; i < patterns.length; i += 1) {
      const match = source.match(patterns[i]);
      if (!match || !match[1]) continue;
      const port = Number(match[1]);
      if (Number.isInteger(port) && port >= 1 && port <= 65535) {
        return port;
      }
    }
    return null;
  }

  function resolvePortAndCommands(scripts, packageManager) {
    const buildCommand = scripts.build ? packageManager + " run build" : "";

    let deployScriptName = "";
    if (scripts.start) {
      deployScriptName = "start";
    } else if (scripts.preview) {
      deployScriptName = "preview";
    } else if (scripts.dev) {
      deployScriptName = "dev";
    }

    const deployCommand = deployScriptName ? packageManager + " run " + deployScriptName : "";

    let port = null;
    if (deployScriptName) {
      port = parsePortFromScript(scripts[deployScriptName]);
    }

    if (!port) {
      const keys = ["dev", "start", "preview"];
      for (let i = 0; i < keys.length; i += 1) {
        const val = scripts[keys[i]];
        port = parsePortFromScript(val);
        if (port) break;
      }
    }

    return {
      buildCommand: buildCommand,
      deployCommand: deployCommand,
      deployScriptName: deployScriptName,
      detectedScriptPort: port || null,
    };
  }

  function sanitizePreviewUrl(raw) {
    const input = String(raw || "").trim();
    if (!input) return null;

    let value = input;
    if (!/^https?:\/\//i.test(value)) {
      value = "http://" + value;
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch (_error) {
      return null;
    }

    if (!ALLOWED_PREVIEW_HOSTS.has(parsed.hostname)) {
      return null;
    }

    if (parsed.hostname === "0.0.0.0") {
      parsed.hostname = "localhost";
    }

    return parsed.toString();
  }

  function extractPreviewUrl(text) {
    const line = String(text || "");
    const regex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s]*)?/ig;
    const matches = line.match(regex);
    if (!matches || !matches.length) {
      return null;
    }
    for (let i = 0; i < matches.length; i += 1) {
      const safe = sanitizePreviewUrl(matches[i]);
      if (safe) return safe;
    }
    return null;
  }

  function setPreviewFrameUrl(url, reason) {
    const safe = sanitizePreviewUrl(url);
    if (!safe) {
      addLog("error", "预览地址非法：" + String(url || ""));
      return;
    }

    state.previewUrl = safe;
    refs.previewFrame.setAttribute("src", safe);

    if (reason) {
      addLog("info", "预览地址：" + safe + "（" + reason + "）");
    }

    apiCall("persistState.set", {
      key: "frontend-workbench.preview.url",
      value: safe,
    }).catch(function () {
      return undefined;
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isPortOccupied(port) {
    const probeUrl = "http://127.0.0.1:" + String(port) + "/__nion_port_probe__?t=" + String(Date.now());
    return fetch(probeUrl, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    })
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  function findAvailablePreviewPort(startPort) {
    let port = Math.max(1, Number(startPort) || PREVIEW_PORT_START);

    function scan() {
      if (port > PREVIEW_PORT_MAX) {
        throw new Error("未找到可用预览端口（扫描范围 " + PREVIEW_PORT_START + "-" + PREVIEW_PORT_MAX + "）");
      }
      return isPortOccupied(port).then(function (occupied) {
        if (!occupied) {
          return port;
        }
        port += 1;
        return scan();
      });
    }

    return scan();
  }

  function resolvePreviewPort() {
    return findAvailablePreviewPort(PREVIEW_PORT_START).then(function (port) {
      state.previewPort = port;
      addLog("info", "预览端口已分配：" + String(port));
      return port;
    });
  }

  function buildDeployCommandWithPort(port) {
    if (!state.deployScriptName) {
      return "";
    }
    const base = state.packageManager + " run " + state.deployScriptName;
    return "PORT=" + String(port) + " " + base + " -- --port " + String(port);
  }

  function waitUntilPreviewReachable(getUrl, timeoutMs) {
    const startedAt = Date.now();

    function loop() {
      const currentUrl = sanitizePreviewUrl(getUrl());
      if (!currentUrl) {
        if (Date.now() - startedAt >= timeoutMs) {
          return Promise.reject(new Error("预览地址不可用"));
        }
        return delay(600).then(loop);
      }

      return fetch(currentUrl, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
      })
        .then(function () {
          return currentUrl;
        })
        .catch(function () {
          if (Date.now() - startedAt >= timeoutMs) {
            throw new Error("预览服务启动超时");
          }
          return delay(800).then(loop);
        });
    }

    return loop();
  }

  function addCommandOutput(logPrefix, eventName, text) {
    if (!text) return;
    const lines = String(text)
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const maybeUrl = extractPreviewUrl(line);
      if (maybeUrl) {
        setPreviewFrameUrl(maybeUrl, "日志发现地址");
      }

      if (eventName === "stderr") {
        addLog("error", logPrefix + line);
      } else {
        addLog("info", logPrefix + line);
      }
    }
  }

  function streamCommandUntilExit(sessionId, logPrefix) {
    return new Promise(function (resolve, reject) {
      let stopFn = null;
      let settled = false;

      function done(result) {
        if (settled) return;
        settled = true;
        if (typeof stopFn === "function") {
          try {
            stopFn();
          } catch (_error) {
            // ignore
          }
        }
        resolve(result);
      }

      bridge
        .startLogStream(sessionId, function (eventName, payload) {
          const text = payload && typeof payload.text === "string" ? payload.text : "";
          if ((eventName === "stdout" || eventName === "stderr") && text) {
            addCommandOutput(logPrefix, eventName, text);
          }
          if (eventName === "exit") {
            const status = payload && typeof payload.status === "string" ? payload.status : "unknown";
            done({ status: status });
          }
        })
        .then(function (stop) {
          stopFn = stop;
        })
        .catch(function (err) {
          reject(err);
        });
    });
  }

  function runBuildIfNeeded() {
    if (!state.buildCommand) {
      addLog("info", "未定义 build 脚本，跳过编译步骤");
      return Promise.resolve();
    }

    addLog("info", "开始编译：" + state.buildCommand);
    return apiCall("runCommand", {
      command: state.buildCommand,
      cwd: state.projectRoot,
      timeoutSeconds: 1200,
    })
      .then(function (result) {
        return streamCommandUntilExit(result.sessionId, "[build] ").then(function (exit) {
          if (exit.status !== "finished") {
            throw new Error("编译失败，退出状态：" + exit.status);
          }
          addLog("success", "编译完成");
        });
      });
  }

  function clearPreviewSessionState() {
    state.previewSessionId = null;
    if (typeof state.previewStreamStop === "function") {
      try {
        state.previewStreamStop();
      } catch (_error) {
        // ignore
      }
    }
    state.previewStreamStop = null;
  }

  function stopPreviewSession() {
    if (!state.previewSessionId) {
      clearPreviewSessionState();
      return Promise.resolve();
    }

    const sid = state.previewSessionId;
    return apiCall("stopCommand", { sessionId: sid })
      .catch(function () {
        return undefined;
      })
      .finally(function () {
        clearPreviewSessionState();
        addLog("info", "预览服务已停止");
      });
  }

  function startPreviewSession() {
    if (!state.deployScriptName) {
      return Promise.reject(new Error("未找到可执行的部署脚本（start/preview/dev）"));
    }

    return stopPreviewSession()
      .then(function () {
        return resolvePreviewPort();
      })
      .then(function (port) {
        const deployCommand = buildDeployCommandWithPort(port);
        if (!deployCommand) {
          throw new Error("构建部署命令失败");
        }
        state.deployCommand = deployCommand;
        addLog("info", "开始部署：" + deployCommand);
        return apiCall("runCommand", {
          command: deployCommand,
          cwd: state.projectRoot,
          timeoutSeconds: 7200,
        });
      })
      .then(function (result) {
        state.previewSessionId = result.sessionId;
        return bridge.startLogStream(result.sessionId, function (eventName, payload) {
          const text = payload && typeof payload.text === "string" ? payload.text : "";
          if ((eventName === "stdout" || eventName === "stderr") && text) {
            addCommandOutput("[serve] ", eventName, text);
          }
          if (eventName === "exit") {
            const status = payload && typeof payload.status === "string" ? payload.status : "unknown";
            if (status === "finished") {
              addLog("info", "预览服务已退出");
            } else {
              addLog("error", "预览服务异常退出：" + status);
            }
            clearPreviewSessionState();
          }
        });
      })
      .then(function (stop) {
        state.previewStreamStop = stop;
        addLog("success", "部署进程已启动");
      });
  }

  function ensurePreviewReady(trigger) {
    if (previewEnsurePromise) {
      return previewEnsurePromise;
    }

    const alreadyRunning = Boolean(state.previewSessionId);
    if (alreadyRunning && state.previewUrl) {
      setPreviewFrameUrl(state.previewUrl, "复用已启动服务");
      return Promise.resolve();
    }

    addLog("info", "开始准备预览（触发：" + trigger + "）");

    previewEnsurePromise = runBuildIfNeeded()
      .then(function () {
        return startPreviewSession();
      })
      .then(function () {
        const inferred = "http://localhost:" + state.previewPort;
        return waitUntilPreviewReachable(function () {
          return state.previewUrl || inferred;
        }, PREVIEW_TIMEOUT_MS)
          .then(function (reachableUrl) {
            setPreviewFrameUrl(reachableUrl, "服务已就绪");
            addLog("success", "预览服务已就绪，正在打开页面");
          })
          .catch(function () {
            setPreviewFrameUrl(state.previewUrl || inferred, "等待超时，继续尝试加载");
            addLog("error", "预览服务启动超时，请检查构建日志");
          });
      })
      .catch(function (err) {
        const detail = err && err.message ? err.message : String(err || "未知错误");
        addLog("error", "预览准备失败：" + detail);
        toast("预览准备失败：" + detail, "error");
        throw err;
      })
      .finally(function () {
        previewEnsurePromise = null;
      });

    return previewEnsurePromise;
  }

  function renderTabs() {
    if (!state.tabs.length) {
      refs.tabs.innerHTML = "";
      refs.editorEmpty.classList.remove("hidden");
      refs.editorShell.classList.add("hidden");
      refs.editor.value = "";
      refs.lineNumbers.textContent = "";
      return;
    }

    refs.editorEmpty.classList.add("hidden");
    refs.editorShell.classList.remove("hidden");

    refs.tabs.innerHTML = state.tabs
      .map(function (tab) {
        return (
          "<button class='tab " +
          (tab.id === state.activeTabId ? "active" : "") +
          "' data-tab='" +
          escapeHtml(tab.id) +
          "' type='button'>" +
          "<span class='tab-name'>" +
          escapeHtml(tab.name + (tab.dirty ? " *" : "")) +
          "</span>" +
          "<span class='tab-close' data-close='" +
          escapeHtml(tab.id) +
          "'>×</span>" +
          "</button>"
        );
      })
      .join("");

    const tabButtons = refs.tabs.querySelectorAll("[data-tab]");
    for (let i = 0; i < tabButtons.length; i += 1) {
      tabButtons[i].addEventListener("click", function (event) {
        const id = event.currentTarget && event.currentTarget.getAttribute("data-tab");
        if (!id) return;
        state.activeTabId = id;
        renderTabs();
        renderEditor();
      });
    }

    const closeButtons = refs.tabs.querySelectorAll("[data-close]");
    for (let i = 0; i < closeButtons.length; i += 1) {
      closeButtons[i].addEventListener("click", function (event) {
        event.stopPropagation();
        const id = event.currentTarget && event.currentTarget.getAttribute("data-close");
        if (!id) return;
        closeTab(id);
      });
    }
  }

  function updateLineNumbers() {
    const value = refs.editor.value || "";
    const count = Math.max(1, value.split("\n").length);
    const rows = [];
    for (let i = 1; i <= count; i += 1) {
      rows.push(String(i));
    }
    refs.lineNumbers.textContent = rows.join("\n") + "\n";
    refs.lineNumbers.scrollTop = refs.editor.scrollTop;
  }

  function renderEditor() {
    const tab = activeTab();
    if (!tab) {
      refs.editor.value = "";
      refs.editor.disabled = true;
      updateLineNumbers();
      return;
    }
    refs.editor.disabled = false;
    refs.editor.value = tab.content;
    updateLineNumbers();
  }

  function closeTab(tabId) {
    state.tabs = state.tabs.filter(function (item) {
      return item.id !== tabId;
    });
    if (state.activeTabId === tabId) {
      state.activeTabId = state.tabs.length ? state.tabs[state.tabs.length - 1].id : null;
    }
    renderTabs();
    renderEditor();
  }

  function markActiveTabDirty() {
    const tab = activeTab();
    if (!tab) return;
    tab.content = refs.editor.value;
    tab.dirty = tab.content !== tab.saved;
    renderTabs();
    updateLineNumbers();
  }

  function saveTab(tab, reason) {
    if (!tab || !tab.dirty) {
      return Promise.resolve(false);
    }
    return apiCall("writeFile", {
      path: tab.path,
      content: tab.content,
    })
      .then(function () {
        tab.saved = tab.content;
        tab.dirty = false;
        renderTabs();
        const msg = "已保存 " + tab.name + (reason ? "（" + reason + "）" : "");
        toast(msg, "success");
        addLog("success", msg);
        return true;
      })
      .catch(function (err) {
        const detail = err && err.message ? err.message : String(err || "未知错误");
        const msg = "保存失败 " + tab.name + "：" + detail;
        toast(msg, "error");
        addLog("error", msg);
        return false;
      });
  }

  function saveActiveTab(reason) {
    return saveTab(activeTab(), reason);
  }

  function createTreeNode(path, kind) {
    return {
      id: normalizePath(path),
      path: normalizePath(path),
      name: pathName(path),
      type: kind,
      open: true,
      children: [],
    };
  }

  function sortTreeNodes(nodes) {
    nodes.sort(function (a, b) {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  function readDirectoryTree(path, depth) {
    const node = createTreeNode(path, "folder");
    if (depth > 7) {
      node.open = false;
      return Promise.resolve(node);
    }

    return apiCall("readDir", { path: path })
      .then(function (entries) {
        const children = [];
        const nested = [];

        for (let i = 0; i < entries.length; i += 1) {
          const entry = normalizePath(entries[i]);
          if (entry.endsWith("/")) {
            const dirPath = entry.slice(0, -1);
            if (dirPath.endsWith("/node_modules") || dirPath.includes("/.git")) {
              continue;
            }
            nested.push(
              readDirectoryTree(dirPath, depth + 1).then(function (child) {
                children.push(child);
              })
            );
          } else {
            if (entry.includes("/.git/")) {
              continue;
            }
            children.push(createTreeNode(entry, "file"));
          }
        }

        return Promise.all(nested).then(function () {
          sortTreeNodes(children);
          node.children = children;
          return node;
        });
      })
      .catch(function () {
        return node;
      });
  }

  function toggleFolderById(node, id) {
    if (!node) return false;
    if (node.id === id && node.type === "folder") {
      node.open = !node.open;
      return true;
    }
    if (!node.children || !node.children.length) {
      return false;
    }
    for (let i = 0; i < node.children.length; i += 1) {
      if (toggleFolderById(node.children[i], id)) {
        return true;
      }
    }
    return false;
  }

  function shouldRenderNode(node, query) {
    if (!query) return true;
    const lower = query.toLowerCase();
    if (node.name.toLowerCase().includes(lower)) return true;
    if (!node.children || !node.children.length) return false;
    for (let i = 0; i < node.children.length; i += 1) {
      if (shouldRenderNode(node.children[i], query)) {
        return true;
      }
    }
    return false;
  }

  function renderTreeNode(node, depth) {
    if (!shouldRenderNode(node, state.treeQuery)) {
      return "";
    }

    const indent = "<span class='tree-indent' style='width:" + Math.min(depth * 12, 120) + "px'></span>";

    if (node.type === "folder") {
      let html =
        "<li class='tree-item'>" +
        "<button class='tree-row " +
        (node.open ? "folder-open" : "") +
        "' type='button' data-folder='" +
        escapeHtml(node.id) +
        "'>" +
        indent +
        "<span class='tree-symbol'>" +
        (node.open ? "▾" : "▸") +
        "</span>" +
        "<span class='tree-symbol tree-folder'>📁</span>" +
        "<span class='tree-name'>" +
        escapeHtml(node.name) +
        "</span>" +
        "</button>";

      if (node.open && node.children && node.children.length) {
        html += "<ul class='tree-list'>";
        for (let i = 0; i < node.children.length; i += 1) {
          html += renderTreeNode(node.children[i], depth + 1);
        }
        html += "</ul>";
      }

      html += "</li>";
      return html;
    }

    return (
      "<li class='tree-item'>" +
      "<button class='tree-row " +
      (state.activeTabId === node.id ? "active" : "") +
      "' type='button' data-file='" +
      escapeHtml(node.id) +
      "'>" +
      indent +
      "<span class='tree-symbol'> </span>" +
      "<span class='tree-symbol'>📄</span>" +
      "<span class='tree-name'>" +
      escapeHtml(node.name) +
      "</span>" +
      "</button>" +
      "</li>"
    );
  }

  function bindTreeEvents() {
    const folderButtons = refs.treeContainer.querySelectorAll("[data-folder]");
    for (let i = 0; i < folderButtons.length; i += 1) {
      folderButtons[i].addEventListener("click", function (event) {
        const id = event.currentTarget && event.currentTarget.getAttribute("data-folder");
        if (!id) return;
        toggleFolderById(state.treeRoot, id);
        renderTree();
      });
    }

    const fileButtons = refs.treeContainer.querySelectorAll("[data-file]");
    for (let i = 0; i < fileButtons.length; i += 1) {
      fileButtons[i].addEventListener("click", function (event) {
        const path = event.currentTarget && event.currentTarget.getAttribute("data-file");
        if (!path) return;
        openFile(path);
      });
    }
  }

  function renderTree() {
    if (!state.treeRoot) {
      refs.treeContainer.innerHTML = "";
      refs.treeEmpty.textContent = state.loadingTree ? "正在加载目录..." : "暂无可展示文件";
      refs.treeEmpty.classList.remove("hidden");
      return;
    }

    refs.treeEmpty.classList.add("hidden");
    refs.treeContainer.innerHTML = "<ul class='tree-list'>" + renderTreeNode(state.treeRoot, 0) + "</ul>";
    bindTreeEvents();
  }

  function loadTree() {
    state.loadingTree = true;
    renderTree();

    return readDirectoryTree(ROOT, 0)
      .then(function (tree) {
        state.treeRoot = tree;
      })
      .catch(function (err) {
        const detail = err && err.message ? err.message : String(err || "未知错误");
        addLog("error", "目录加载失败：" + detail);
      })
      .finally(function () {
        state.loadingTree = false;
        renderTree();
      });
  }

  function openFile(path) {
    for (let i = 0; i < state.tabs.length; i += 1) {
      if (state.tabs[i].id === path) {
        state.activeTabId = path;
        renderTabs();
        renderEditor();
        return;
      }
    }

    apiCall("readFile", { path: path })
      .then(function (content) {
        state.tabs.push({
          id: path,
          path: path,
          name: pathName(path),
          ext: extName(path),
          content: content,
          saved: content,
          dirty: false,
        });
        state.activeTabId = path;
        renderTabs();
        renderEditor();
        renderTree();
      })
      .catch(function (err) {
        const detail = err && err.message ? err.message : String(err || "未知错误");
        addLog("error", "打开文件失败：" + detail);
      });
  }

  function loadProjectInfo() {
    return resolveProjectRoot()
      .then(function (projectRoot) {
        state.projectRoot = projectRoot;
        return detectPackageManager(projectRoot).then(function (pm) {
          state.packageManager = pm;
          return apiCall("readFile", { path: projectRoot + "/package.json" })
            .then(function (raw) {
              let pkg = {};
              try {
                pkg = JSON.parse(raw);
              } catch (_error) {
                pkg = {};
              }
              state.scripts = pkg && pkg.scripts ? pkg.scripts : {};
            })
            .catch(function () {
              state.scripts = {};
            })
            .then(function () {
              const resolved = resolvePortAndCommands(state.scripts, state.packageManager);
              state.buildCommand = resolved.buildCommand;
              state.deployCommand = resolved.deployCommand;
              state.deployScriptName = resolved.deployScriptName;
              state.detectedScriptPort = resolved.detectedScriptPort;

              addLog("info", "项目目录：" + state.projectRoot);
              if (state.detectedScriptPort) {
                addLog("info", "脚本声明端口：" + String(state.detectedScriptPort));
              }
              addLog("info", "预览端口策略：从 " + String(PREVIEW_PORT_START) + " 开始探测可用端口");
            });
        });
      });
  }

  function bootstrapOpenFile() {
    const artifactPath = typeof bridge.artifactPath === "string" ? normalizePath(bridge.artifactPath) : "";
    if (!artifactPath || !artifactPath.startsWith(ROOT) || !/\.[^/]+$/.test(artifactPath)) {
      return;
    }
    openFile(artifactPath);
  }

  function bindEvents() {
    refs.codeModeBtn.addEventListener("click", function () {
      state.viewMode = "code";
      updateViewMode();
    });

    refs.previewModeBtn.addEventListener("click", function () {
      state.viewMode = "preview";
      updateViewMode();
      showPreviewLoading();
      ensurePreviewReady("点击预览").catch(function () {
        return undefined;
      });
    });

    refs.explorerToggleBtn.addEventListener("click", function () {
      state.sidebarOpen = !state.sidebarOpen;
      updateSidebarState();
      persistSidebarState();
    });

    refs.sidebarDivider.addEventListener("pointerdown", function (event) {
      if (!state.sidebarOpen || event.button !== 0) {
        return;
      }
      const rect = refs.codeMain.getBoundingClientRect();
      if (!rect || rect.width <= 0) {
        return;
      }

      const startPercent = state.sidebarWidthPercent;
      const startX = event.clientX;
      refs.sidebarDivider.classList.add("dragging");
      document.body.classList.add("resizing-sidebar");

      const onMove = function (moveEvent) {
        const deltaPx = moveEvent.clientX - startX;
        const nextPercent = startPercent + (deltaPx / rect.width) * 100;
        applySidebarWidthPercent(nextPercent);
      };

      const onUp = function () {
        refs.sidebarDivider.classList.remove("dragging");
        document.body.classList.remove("resizing-sidebar");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        persistSidebarState();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    refs.refreshTreeBtn.addEventListener("click", function () {
      addLog("info", "触发目录刷新");
      loadTree();
    });

    refs.treeSearchInput.addEventListener("input", function () {
      state.treeQuery = refs.treeSearchInput.value.trim();
      renderTree();
    });

    refs.editor.addEventListener("input", markActiveTabDirty);
    refs.editor.addEventListener("scroll", updateLineNumbers);
    refs.editor.addEventListener("blur", function () {
      saveActiveTab("失焦自动保存");
    });

    refs.deviceMenuBtn.addEventListener("click", function () {
      refs.deviceMenu.classList.toggle("hidden");
    });

    const deviceItems = refs.deviceMenu.querySelectorAll("[data-mode]");
    for (let i = 0; i < deviceItems.length; i += 1) {
      deviceItems[i].addEventListener("click", function (event) {
        const mode = event.currentTarget && event.currentTarget.getAttribute("data-mode");
        if (mode !== "desktop" && mode !== "tablet" && mode !== "mobile") {
          return;
        }
        state.deviceMode = mode;
        updateDeviceMode();
        refs.deviceMenu.classList.add("hidden");
      });
    }

    document.addEventListener("click", function (event) {
      const target = event.target;
      if (!target || !(target instanceof Element)) {
        return;
      }
      if (!refs.devicePickerWrap.contains(target)) {
        refs.deviceMenu.classList.add("hidden");
      }
    });

    refs.previewRefreshBtn.addEventListener("click", function () {
      showPreviewLoading();
      if (!state.previewUrl) {
        ensurePreviewReady("点击刷新").catch(function () {
          return undefined;
        });
        return;
      }
      refs.previewFrame.removeAttribute("src");
      setTimeout(function () {
        refs.previewFrame.setAttribute("src", state.previewUrl);
        addLog("info", "预览已刷新");
      }, 30);
    });

    refs.previewOpenBtn.addEventListener("click", function () {
      if (!state.previewUrl) {
        return;
      }
      apiCall("openPreview", { url: state.previewUrl }).catch(function () {
        window.open(state.previewUrl, "_blank", "noopener,noreferrer");
      });
      addLog("info", "已在新窗口打开预览");
    });

    refs.previewFrame.addEventListener("load", function () {
      hidePreviewLoading();
      if (state.previewUrl) {
        addLog("success", "预览页面加载完成");
      }
    });

    refs.previewFrame.addEventListener("error", function () {
      if (state.previewUrl) {
        addLog("error", "预览页面加载失败：" + state.previewUrl);
      }
    });

    refs.consoleToggleBtn.addEventListener("click", function () {
      state.consoleOpen = !state.consoleOpen;
      updateConsoleState();
      apiCall("persistState.set", {
        key: "frontend-workbench.console.open",
        value: state.consoleOpen,
      }).catch(function () {
        return undefined;
      });
    });

    window.addEventListener("resize", function () {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      if (mobile !== wasMobileViewport) {
        wasMobileViewport = mobile;
        state.sidebarOpen = !mobile;
        persistSidebarState();
      }
      applySidebarWidthPercent(state.sidebarWidthPercent);
      updateSidebarState();
    });

    document.addEventListener("keydown", function (event) {
      const key = String(event.key || "").toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        saveActiveTab("快捷键保存");
      }
    });

    window.addEventListener("beforeunload", function () {
      if (state.previewSessionId) {
        apiCall("stopCommand", { sessionId: state.previewSessionId }).catch(function () {
          return undefined;
        });
      }
      if (typeof state.previewStreamStop === "function") {
        try {
          state.previewStreamStop();
        } catch (_error) {
          // ignore
        }
      }
    });
  }

  function bindRefs() {
    refs.codeModeBtn = $("codeModeBtn");
    refs.previewModeBtn = $("previewModeBtn");

    refs.codeView = $("codeView");
    refs.previewView = $("previewView");

    refs.explorerToggleBtn = $("explorerToggleBtn");
    refs.codeMain = $("codeMain");
    refs.sidebar = $("sidebar");
    refs.sidebarDivider = $("sidebarDivider");

    refs.refreshTreeBtn = $("refreshTreeBtn");
    refs.treeSearchInput = $("treeSearchInput");
    refs.treeContainer = $("treeContainer");
    refs.treeEmpty = $("treeEmpty");

    refs.tabs = $("tabs");
    refs.editorEmpty = $("editorEmpty");
    refs.editorShell = $("editorShell");
    refs.lineNumbers = $("lineNumbers");
    refs.editor = $("editor");

    refs.previewToolbar = $("previewToolbar");
    refs.devicePickerWrap = $("devicePickerWrap");
    refs.deviceMenuBtn = $("deviceMenuBtn");
    refs.deviceMenu = $("deviceMenu");

    refs.previewDeviceFrame = $("previewDeviceFrame");
    refs.previewFrame = $("previewFrame");
    refs.previewLoading = $("previewLoading");
    refs.previewRefreshBtn = $("previewRefreshBtn");
    refs.previewOpenBtn = $("previewOpenBtn");

    refs.consoleToggleBtn = $("consoleToggleBtn");
    refs.consoleErrorCount = $("consoleErrorCount");
    refs.consoleToggleArrow = $("consoleToggleArrow");
    refs.consolePanel = $("consolePanel");
    refs.consoleLogs = $("consoleLogs");
  }

  function loadPersistedState() {
    return Promise.all([
      apiCall("persistState.get", {
        key: "frontend-workbench.preview.deviceMode",
      }).catch(function () {
        return null;
      }),
      apiCall("persistState.get", {
        key: "frontend-workbench.console.open",
      }).catch(function () {
        return null;
      }),
      apiCall("persistState.get", {
        key: "frontend-workbench.preview.url",
      }).catch(function () {
        return null;
      }),
      apiCall("persistState.get", {
        key: "frontend-workbench.sidebar.widthPercent",
      }).catch(function () {
        return null;
      }),
      apiCall("persistState.get", {
        key: "frontend-workbench.sidebar.open",
      }).catch(function () {
        return null;
      }),
    ]).then(function (result) {
      const persistedDeviceMode = result[0];
      const persistedConsoleOpen = result[1];
      const persistedPreviewUrl = result[2];
      const persistedSidebarWidthPercent = result[3];
      const persistedSidebarOpen = result[4];

      if (persistedDeviceMode === "desktop" || persistedDeviceMode === "tablet" || persistedDeviceMode === "mobile") {
        state.deviceMode = persistedDeviceMode;
      }
      if (typeof persistedConsoleOpen === "boolean") {
        state.consoleOpen = persistedConsoleOpen;
      }
      if (typeof persistedPreviewUrl === "string" && sanitizePreviewUrl(persistedPreviewUrl)) {
        state.previewUrl = sanitizePreviewUrl(persistedPreviewUrl);
      }
      const parsedSidebarWidthPercent = Number(persistedSidebarWidthPercent);
      if (Number.isFinite(parsedSidebarWidthPercent)) {
        state.sidebarWidthPercent = parsedSidebarWidthPercent;
      }
      if (typeof persistedSidebarOpen === "boolean") {
        state.sidebarOpenPersisted = persistedSidebarOpen;
      }
    });
  }

  function init() {
    bindRefs();
    bindEvents();

    loadPersistedState()
      .then(function () {
        applyInitialSidebarState();
        updateViewMode();
        updateDeviceMode();
        updateConsoleState();
        renderLogs();

        addLog("info", "Frontend Workbench 初始化完成");

        return Promise.all([loadProjectInfo(), loadTree()]);
      })
      .then(function () {
        bootstrapOpenFile();
      })
      .catch(function (err) {
        const detail = err && err.message ? err.message : String(err || "未知错误");
        addLog("error", "初始化失败：" + detail);
      });
  }

  init();
})();
