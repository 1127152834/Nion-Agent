(function () {
  const bridge = window.NionWorkbench;
  if (!bridge || typeof bridge.call !== "function") {
    document.body.innerHTML = "<pre style='padding:16px'>Workbench bridge unavailable</pre>";
    return;
  }

  const ROOT = "/mnt/user-data/workspace";
  const ALLOWED_PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);
  const state = {
    projectRoot: ROOT,
    packageManager: "pnpm",
    scripts: {},
    tabs: [],
    activeTabId: null,
    tree: null,
    treeQuery: "",
    build: {
      running: false,
      succeeded: false,
      sessionId: null,
      command: "",
    },
    dev: {
      running: false,
      sessionId: null,
      command: "",
    },
    previewMode: "preview",
    previewUrl: "",
    logs: [],
    streamStopBySession: new Map(),
    leftWidth: 280,
    rightWidth: 420,
    leftCollapsed: false,
    rightCollapsed: false,
  };

  const refs = {};

  function $(id) {
    return document.getElementById(id);
  }

  function apiCall(method, params) {
    return bridge.call(method, params || {});
  }

  function toast(message, type) {
    return apiCall("toast", { message, type: type || "info" }).catch(function () {
      return undefined;
    });
  }

  function setStatus(text) {
    refs.statusText.textContent = text;
  }

  function appendLog(line) {
    state.logs.push(line);
    if (state.logs.length > 600) {
      state.logs.splice(0, state.logs.length - 600);
    }
    refs.logs.textContent = state.logs.join("\n");
    refs.logs.scrollTop = refs.logs.scrollHeight;
  }

  function pathName(path) {
    const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
  }

  function extName(path) {
    const name = pathName(path);
    const idx = name.lastIndexOf(".");
    return idx > -1 ? name.slice(idx + 1).toLowerCase() : "";
  }

  function dirName(path) {
    const normalized = String(path || "").replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) return ROOT;
    return normalized.slice(0, idx);
  }

  function relativeFromRoot(path) {
    if (path.startsWith(ROOT + "/")) {
      return path.slice(ROOT.length + 1);
    }
    return path;
  }

  function shellQuote(input) {
    return "'" + String(input).replace(/'/g, "'\\''") + "'";
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
    const artifactPath = typeof bridge.artifactPath === "string" ? bridge.artifactPath : "";
    if (artifactPath && artifactPath.startsWith(ROOT)) {
      let cursor = artifactPath;
      if (!artifactPath.endsWith("/") && pathName(artifactPath).includes(".")) {
        cursor = dirName(artifactPath);
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

    let sequence = Promise.resolve(null);
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      sequence = sequence.then(function (found) {
        if (found) return found;
        return fileExists(candidate + "/package.json").then(function (exists) {
          return exists ? candidate : null;
        });
      });
    }
    return sequence.then(function (found) {
      return found || ROOT;
    });
  }

  function safePreviewUrl(raw) {
    const input = String(raw || "").trim();
    if (!input) return null;
    let value = input;
    if (!/^https?:\/\//i.test(value)) {
      value = "http://" + value;
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch (_err) {
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
    if (!matches || !matches.length) return null;
    for (let i = 0; i < matches.length; i += 1) {
      const safe = safePreviewUrl(matches[i]);
      if (safe) return safe;
    }
    return null;
  }

  function updatePreviewFrame(url) {
    if (!url) {
      refs.previewFrame.removeAttribute("src");
      return;
    }
    const safe = safePreviewUrl(url);
    if (!safe) {
      refs.previewError.style.display = "block";
      refs.previewError.textContent = "仅允许 localhost / 127.0.0.1 预览地址。";
      return;
    }
    refs.previewError.style.display = "none";
    refs.previewFrame.setAttribute("src", safe);
    refs.previewUrlInput.value = safe;
    state.previewUrl = safe;
  }

  function activeTab() {
    if (!state.activeTabId) return null;
    for (let i = 0; i < state.tabs.length; i += 1) {
      if (state.tabs[i].id === state.activeTabId) return state.tabs[i];
    }
    return null;
  }

  function updateButtons() {
    refs.buildBtn.textContent = state.build.succeeded ? "重新构建" : "构建";
    refs.buildBtn.disabled = state.build.running || !refs.buildCmd.value.trim();

    const startEnabled = state.build.succeeded && !!refs.devCmd.value.trim();
    refs.startBtn.disabled = state.dev.running ? false : !startEnabled;
    refs.startBtn.textContent = state.dev.running ? "停止预览" : "启动预览";
    refs.startBtn.className = state.dev.running ? "btn danger" : "btn";
  }

  function renderTabs() {
    refs.tabs.innerHTML = "";
    for (let i = 0; i < state.tabs.length; i += 1) {
      const tab = state.tabs[i];
      const tabEl = document.createElement("div");
      tabEl.className = "tab" + (tab.id === state.activeTabId ? " active" : "");
      tabEl.innerHTML =
        "<span>" +
        tab.name.replace(/</g, "&lt;") +
        (tab.dirty ? " *" : "") +
        "</span><button class='tab-close' title='关闭'>×</button>";
      tabEl.addEventListener("click", function () {
        state.activeTabId = tab.id;
        renderTabs();
        renderEditor();
      });
      tabEl.querySelector(".tab-close").addEventListener("click", function (event) {
        event.stopPropagation();
        closeTab(tab.id);
      });
      refs.tabs.appendChild(tabEl);
    }
  }

  function closeTab(tabId) {
    const next = [];
    for (let i = 0; i < state.tabs.length; i += 1) {
      if (state.tabs[i].id !== tabId) next.push(state.tabs[i]);
    }
    state.tabs = next;
    if (state.activeTabId === tabId) {
      state.activeTabId = next.length ? next[Math.max(0, next.length - 1)].id : null;
    }
    renderTabs();
    renderEditor();
  }

  function updateLineNumbers() {
    const value = refs.editor.value || "";
    const lines = value.split("\n").length;
    let output = "";
    for (let i = 1; i <= lines; i += 1) {
      output += i + "\n";
    }
    refs.lineNumbers.textContent = output;
    refs.lineNumbers.scrollTop = refs.editor.scrollTop;
  }

  function renderEditor() {
    const tab = activeTab();
    if (!tab) {
      refs.editor.value = "";
      refs.editor.disabled = true;
      refs.activeFileLabel.textContent = "未打开文件";
      updateLineNumbers();
      return;
    }
    refs.editor.disabled = false;
    refs.editor.value = tab.content;
    refs.activeFileLabel.textContent = tab.path;
    updateLineNumbers();
  }

  function updateActiveFromEditor() {
    const tab = activeTab();
    if (!tab) return;
    tab.content = refs.editor.value;
    tab.dirty = tab.content !== tab.saved;
    renderTabs();
    updateLineNumbers();
  }

  function saveActiveTab() {
    const tab = activeTab();
    if (!tab) {
      toast("没有可保存的文件", "info");
      return;
    }
    setStatus("保存中...");
    apiCall("writeFile", { path: tab.path, content: tab.content })
      .then(function () {
        tab.saved = tab.content;
        tab.dirty = false;
        renderTabs();
        setStatus("保存成功");
        toast("已保存 " + tab.name, "success");
      })
      .catch(function (err) {
        setStatus("保存失败");
        toast("保存失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  function builtInFormat(content, ext) {
    if (ext === "json") {
      try {
        return JSON.stringify(JSON.parse(content), null, 2) + "\n";
      } catch (_err) {
        return content;
      }
    }
    return String(content || "").replace(/\r\n/g, "\n");
  }

  function streamCommandSession(sessionId, onExit) {
    return bridge
      .startLogStream(sessionId, function (eventName, payload) {
        const text = payload && typeof payload.text === "string" ? payload.text : "";
        if (eventName === "stdout" || eventName === "stderr") {
          appendLog(text);
          const maybeUrl = extractPreviewUrl(text);
          if (maybeUrl) {
            updatePreviewFrame(maybeUrl);
          }
          return;
        }
        if (eventName === "exit") {
          if (typeof onExit === "function") {
            onExit(payload || {});
          }
        }
      })
      .then(function (stop) {
        state.streamStopBySession.set(sessionId, stop);
        return stop;
      });
  }

  function runBuild() {
    const command = refs.buildCmd.value.trim();
    if (!command || state.build.running) return;

    state.build.running = true;
    state.build.sessionId = null;
    setStatus("构建中...");
    appendLog("\n=== Build: " + command + " ===");
    updateButtons();

    apiCall("runCommand", {
      command: command,
      cwd: state.projectRoot,
      timeoutSeconds: 900,
    })
      .then(function (result) {
        state.build.sessionId = result.sessionId;
        return streamCommandSession(result.sessionId, function (payload) {
          const status = payload && payload.status ? payload.status : "failed";
          state.build.running = false;
          state.build.succeeded = status === "finished";
          state.build.sessionId = null;
          state.streamStopBySession.delete(result.sessionId);
          setStatus(state.build.succeeded ? "构建成功" : "构建失败");
          updateButtons();
        });
      })
      .catch(function (err) {
        state.build.running = false;
        state.build.succeeded = false;
        setStatus("构建失败");
        updateButtons();
        toast("构建命令执行失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  function stopDev() {
    if (!state.dev.sessionId) return Promise.resolve();
    const sid = state.dev.sessionId;
    return apiCall("stopCommand", { sessionId: sid })
      .catch(function () {
        return undefined;
      })
      .finally(function () {
        const stop = state.streamStopBySession.get(sid);
        state.streamStopBySession.delete(sid);
        if (typeof stop === "function") {
          stop();
        }
        state.dev.running = false;
        state.dev.sessionId = null;
        setStatus("预览服务已停止");
        updateButtons();
      });
  }

  function startDev() {
    const command = refs.devCmd.value.trim();
    if (!command) return;
    if (!state.build.succeeded) {
      toast("请先完成构建", "error");
      return;
    }
    setStatus("启动预览服务...");
    appendLog("\n=== Dev: " + command + " ===");

    apiCall("runCommand", {
      command: command,
      cwd: state.projectRoot,
      timeoutSeconds: 3600,
    })
      .then(function (result) {
        state.dev.running = true;
        state.dev.sessionId = result.sessionId;
        updateButtons();
        return streamCommandSession(result.sessionId, function () {
          state.dev.running = false;
          state.dev.sessionId = null;
          state.streamStopBySession.delete(result.sessionId);
          updateButtons();
          setStatus("预览服务已退出");
        });
      })
      .catch(function (err) {
        state.dev.running = false;
        state.dev.sessionId = null;
        setStatus("启动失败");
        updateButtons();
        toast("启动失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  function runFormat() {
    const tab = activeTab();
    if (!tab) return;

    const hasFormatScript = !!state.scripts.format;
    if (hasFormatScript) {
      const relPath = relativeFromRoot(tab.path);
      const command = state.packageManager + " run format -- " + shellQuote(relPath);
      setStatus("执行项目格式化...");
      appendLog("\n=== Format: " + command + " ===");
      apiCall("runCommand", {
        command: command,
        cwd: state.projectRoot,
        timeoutSeconds: 300,
      })
        .then(function (result) {
          return streamCommandSession(result.sessionId, function (payload) {
            const status = payload && payload.status ? payload.status : "failed";
            state.streamStopBySession.delete(result.sessionId);
            if (status === "finished") {
              apiCall("readFile", { path: tab.path })
                .then(function (latest) {
                  tab.content = latest;
                  tab.saved = latest;
                  tab.dirty = false;
                  renderTabs();
                  renderEditor();
                  setStatus("格式化完成");
                  toast("项目格式化成功", "success");
                })
                .catch(function () {
                  setStatus("格式化完成（读取失败）");
                });
            } else {
              const formatted = builtInFormat(tab.content, extName(tab.path));
              tab.content = formatted;
              refs.editor.value = formatted;
              updateActiveFromEditor();
              setStatus("项目格式化失败，已使用内置格式化");
              toast("项目格式化失败，已降级内置格式化", "error");
            }
          });
        })
        .catch(function () {
          const formatted = builtInFormat(tab.content, extName(tab.path));
          tab.content = formatted;
          refs.editor.value = formatted;
          updateActiveFromEditor();
          setStatus("内置格式化完成");
        });
      return;
    }

    tab.content = builtInFormat(tab.content, extName(tab.path));
    refs.editor.value = tab.content;
    updateActiveFromEditor();
    setStatus("内置格式化完成");
  }

  function findNext() {
    const term = refs.findInput.value;
    if (!term) return;
    const content = refs.editor.value;
    const from = refs.editor.selectionEnd || 0;
    let index = content.indexOf(term, from);
    if (index < 0) {
      index = content.indexOf(term, 0);
    }
    if (index >= 0) {
      refs.editor.focus();
      refs.editor.setSelectionRange(index, index + term.length);
      setStatus("找到匹配");
    } else {
      setStatus("未找到匹配");
    }
  }

  function replaceOne() {
    const findValue = refs.findInput.value;
    const replaceValue = refs.replaceInput.value;
    if (!findValue) return;
    const tab = activeTab();
    if (!tab) return;

    const start = refs.editor.selectionStart;
    const end = refs.editor.selectionEnd;
    if (refs.editor.value.slice(start, end) === findValue) {
      const before = refs.editor.value.slice(0, start);
      const after = refs.editor.value.slice(end);
      refs.editor.value = before + replaceValue + after;
      refs.editor.setSelectionRange(start, start + replaceValue.length);
      updateActiveFromEditor();
      setStatus("已替换当前匹配");
      return;
    }
    findNext();
  }

  function replaceAll() {
    const findValue = refs.findInput.value;
    const replaceValue = refs.replaceInput.value;
    if (!findValue) return;
    const tab = activeTab();
    if (!tab) return;
    refs.editor.value = refs.editor.value.split(findValue).join(replaceValue);
    updateActiveFromEditor();
    setStatus("已完成全部替换");
  }

  function createTreeNode(path, type) {
    return {
      name: pathName(path),
      path: path,
      type: type,
      expanded: true,
      children: [],
    };
  }

  function buildDirectoryTree(path, depth) {
    if (depth > 5) {
      return Promise.resolve(createTreeNode(path, "directory"));
    }
    const node = createTreeNode(path, "directory");
    return apiCall("readDir", { path: path })
      .then(function (entries) {
        const dirs = [];
        const files = [];
        for (let i = 0; i < entries.length; i += 1) {
          const item = entries[i];
          if (item.endsWith("/")) {
            dirs.push(item.slice(0, -1));
          } else {
            files.push(item);
          }
        }
        dirs.sort();
        files.sort();

        return Promise.all(
          dirs.map(function (dirPath) {
            return buildDirectoryTree(dirPath, depth + 1);
          })
        ).then(function (childrenDirs) {
          node.children = childrenDirs;
          for (let j = 0; j < files.length; j += 1) {
            node.children.push(createTreeNode(files[j], "file"));
          }
          return node;
        });
      })
      .catch(function () {
        return node;
      });
  }

  function hasVisibleChild(node, query) {
    if (!query) return true;
    const lowered = query.toLowerCase();
    if (node.name.toLowerCase().includes(lowered)) return true;
    if (!node.children || !node.children.length) return false;
    for (let i = 0; i < node.children.length; i += 1) {
      if (hasVisibleChild(node.children[i], query)) return true;
    }
    return false;
  }

  function renderTreeNode(node, depth) {
    if (!hasVisibleChild(node, state.treeQuery)) {
      return null;
    }
    const li = document.createElement("li");
    li.className = "tree-item";

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = 6 + depth * 12 + "px";

    if (node.type === "directory") {
      row.innerHTML = "<span>" + (node.expanded ? "▾" : "▸") + "</span><span>📁</span><span>" + node.name + "</span>";
      row.addEventListener("click", function () {
        node.expanded = !node.expanded;
        renderTree();
      });
      li.appendChild(row);
      if (node.expanded) {
        const ul = document.createElement("ul");
        ul.className = "tree-list tree-children";
        for (let i = 0; i < node.children.length; i += 1) {
          const child = renderTreeNode(node.children[i], depth + 1);
          if (child) ul.appendChild(child);
        }
        li.appendChild(ul);
      }
      return li;
    }

    if (node.path === state.activeTabId) {
      row.className += " active";
    }
    row.innerHTML = "<span>📄</span><span>" + node.name + "</span>";
    row.addEventListener("click", function () {
      openFile(node.path);
    });
    li.appendChild(row);
    return li;
  }

  function renderTree() {
    refs.treeContainer.innerHTML = "";
    if (!state.tree) {
      refs.treeContainer.innerHTML = "<div style='padding:8px;color:#6a6761;font-size:12px'>暂无文件</div>";
      return;
    }
    const ul = document.createElement("ul");
    ul.className = "tree-list";
    const rootNode = renderTreeNode(state.tree, 0);
    if (rootNode) {
      ul.appendChild(rootNode);
    }
    refs.treeContainer.appendChild(ul);
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
    setStatus("打开文件...");
    apiCall("readFile", { path: path })
      .then(function (content) {
        state.tabs.push({
          id: path,
          path: path,
          name: pathName(path),
          content: content,
          saved: content,
          dirty: false,
        });
        state.activeTabId = path;
        renderTabs();
        renderEditor();
        setStatus("已打开 " + pathName(path));
      })
      .catch(function (err) {
        toast("无法打开文件: " + (err && err.message ? err.message : err), "error");
      });
  }

  function loadProject() {
    return resolveProjectRoot().then(function (projectRoot) {
      state.projectRoot = projectRoot;
      return detectPackageManager(projectRoot).then(function (pm) {
        state.packageManager = pm;
        return apiCall("readFile", { path: projectRoot + "/package.json" })
        .then(function (raw) {
          let pkg = {};
          try {
            pkg = JSON.parse(raw);
          } catch (_err) {
            pkg = {};
          }
          state.scripts = pkg.scripts || {};
          const rootLabel =
            projectRoot === ROOT ? "前端工作台" : "前端项目 · " + projectRoot.slice(ROOT.length + 1);
          refs.projectBadge.textContent = rootLabel;

          const defaultBuild = state.scripts.build ? state.packageManager + " run build" : "";
          const devName = state.scripts.dev ? "dev" : state.scripts.start ? "start" : "";
          const defaultDev = devName ? state.packageManager + " run " + devName : "";

          return apiCall("persistState.get", { key: "frontend-workbench.commands" })
            .then(function (persisted) {
              refs.buildCmd.value = persisted && persisted.build ? persisted.build : defaultBuild;
              refs.devCmd.value = persisted && persisted.dev ? persisted.dev : defaultDev;
              state.build.command = refs.buildCmd.value;
              state.dev.command = refs.devCmd.value;
            })
            .catch(function () {
              refs.buildCmd.value = defaultBuild;
              refs.devCmd.value = defaultDev;
              state.build.command = refs.buildCmd.value;
              state.dev.command = refs.devCmd.value;
            });
        })
        .catch(function () {
          state.scripts = {};
          refs.projectBadge.textContent = "工作目录";
          refs.buildCmd.value = "";
          refs.devCmd.value = "";
          toast("未检测到 package.json，仍可用于代码浏览", "info");
        });
      });
    });
  }

  function saveCommandPreferences() {
    const payload = {
      build: refs.buildCmd.value.trim(),
      dev: refs.devCmd.value.trim(),
    };
    apiCall("persistState.set", { key: "frontend-workbench.commands", value: payload }).catch(function () {
      return undefined;
    });
  }

  function loadTree() {
    setStatus("加载目录树...");
    return buildDirectoryTree(ROOT, 0).then(function (tree) {
      state.tree = tree;
      renderTree();
      setStatus("目录树已加载");
    });
  }

  function setupResizer() {
    const splitLayout = refs.splitLayout;

    function apply() {
      splitLayout.style.setProperty("--left-width", state.leftCollapsed ? "0px" : state.leftWidth + "px");
      splitLayout.style.setProperty("--right-width", state.rightCollapsed ? "0px" : state.rightWidth + "px");
    }

    function beginDrag(side, event) {
      event.preventDefault();
      const startX = event.clientX;
      const startLeft = state.leftWidth;
      const startRight = state.rightWidth;

      function onMove(moveEvent) {
        const delta = moveEvent.clientX - startX;
        if (side === "left") {
          state.leftWidth = Math.min(520, Math.max(180, startLeft + delta));
          state.leftCollapsed = false;
        } else {
          state.rightWidth = Math.min(760, Math.max(320, startRight - delta));
          state.rightCollapsed = false;
        }
        apply();
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }

    refs.leftDivider.addEventListener("mousedown", function (event) {
      beginDrag("left", event);
    });
    refs.rightDivider.addEventListener("mousedown", function (event) {
      beginDrag("right", event);
    });

    refs.collapseLeftBtn.addEventListener("click", function () {
      state.leftCollapsed = !state.leftCollapsed;
      refs.collapseLeftBtn.textContent = state.leftCollapsed ? "展开" : "收起";
      apply();
    });

    refs.collapseRightBtn.addEventListener("click", function () {
      state.rightCollapsed = !state.rightCollapsed;
      refs.collapseRightBtn.textContent = state.rightCollapsed ? "展开" : "收起";
      apply();
    });

    apply();
  }

  function bindEvents() {
    refs.editor.addEventListener("input", updateActiveFromEditor);
    refs.editor.addEventListener("scroll", updateLineNumbers);

    refs.saveBtn.addEventListener("click", saveActiveTab);
    refs.formatBtn.addEventListener("click", runFormat);
    refs.findNextBtn.addEventListener("click", findNext);
    refs.replaceOneBtn.addEventListener("click", replaceOne);
    refs.replaceAllBtn.addEventListener("click", replaceAll);
    refs.refreshTreeBtn.addEventListener("click", loadTree);

    refs.buildBtn.addEventListener("click", runBuild);
    refs.startBtn.addEventListener("click", function () {
      if (state.dev.running) {
        stopDev();
      } else {
        startDev();
      }
    });

    refs.previewTabBtn.addEventListener("click", function () {
      state.previewMode = "preview";
      refs.previewPane.classList.remove("hidden");
      refs.logsPane.classList.add("hidden");
      refs.previewTabBtn.classList.add("active");
      refs.logsTabBtn.classList.remove("active");
    });

    refs.logsTabBtn.addEventListener("click", function () {
      state.previewMode = "logs";
      refs.previewPane.classList.add("hidden");
      refs.logsPane.classList.remove("hidden");
      refs.previewTabBtn.classList.remove("active");
      refs.logsTabBtn.classList.add("active");
    });

    refs.openPreviewBtn.addEventListener("click", function () {
      const safe = safePreviewUrl(refs.previewUrlInput.value);
      if (!safe) {
        refs.previewError.style.display = "block";
        refs.previewError.textContent = "仅允许本地 localhost/127.0.0.1 地址";
        return;
      }
      updatePreviewFrame(safe);
    });

    refs.previewUrlInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        refs.openPreviewBtn.click();
      }
    });

    refs.buildCmd.addEventListener("change", function () {
      saveCommandPreferences();
      updateButtons();
    });
    refs.devCmd.addEventListener("change", function () {
      saveCommandPreferences();
      updateButtons();
    });

    refs.treeSearch.addEventListener("input", function () {
      state.treeQuery = refs.treeSearch.value.trim();
      renderTree();
    });

    document.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActiveTab();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        refs.findInput.focus();
      }
    });
  }

  function bindRefs() {
    refs.splitLayout = $("splitLayout");
    refs.treeContainer = $("treeContainer");
    refs.treeSearch = $("treeSearch");
    refs.refreshTreeBtn = $("refreshTreeBtn");
    refs.tabs = $("tabs");
    refs.editor = $("editor");
    refs.lineNumbers = $("lineNumbers");
    refs.findInput = $("findInput");
    refs.replaceInput = $("replaceInput");
    refs.findNextBtn = $("findNextBtn");
    refs.replaceOneBtn = $("replaceOneBtn");
    refs.replaceAllBtn = $("replaceAllBtn");
    refs.activeFileLabel = $("activeFileLabel");
    refs.saveBtn = $("saveBtn");
    refs.formatBtn = $("formatBtn");
    refs.buildBtn = $("buildBtn");
    refs.startBtn = $("startBtn");
    refs.buildCmd = $("buildCmd");
    refs.devCmd = $("devCmd");
    refs.previewTabBtn = $("previewTabBtn");
    refs.logsTabBtn = $("logsTabBtn");
    refs.previewPane = $("previewPane");
    refs.logsPane = $("logsPane");
    refs.logs = $("logs");
    refs.previewUrlInput = $("previewUrlInput");
    refs.openPreviewBtn = $("openPreviewBtn");
    refs.previewFrame = $("previewFrame");
    refs.previewError = $("previewError");
    refs.projectBadge = $("projectBadge");
    refs.statusText = $("statusText");
    refs.leftDivider = $("leftDivider");
    refs.rightDivider = $("rightDivider");
    refs.collapseLeftBtn = $("collapseLeftBtn");
    refs.collapseRightBtn = $("collapseRightBtn");
  }

  function bootstrapOpenFile() {
    const path = bridge.artifactPath;
    if (!path || typeof path !== "string") {
      return;
    }
    if (path.endsWith("/") || !path.includes(".")) {
      return;
    }
    openFile(path);
  }

  function init() {
    bindRefs();
    bindEvents();
    setupResizer();

    setStatus("初始化中...");
    loadProject()
      .then(function () {
        updateButtons();
        return loadTree();
      })
      .then(function () {
        bootstrapOpenFile();
        setStatus("准备就绪");
      })
      .catch(function (err) {
        setStatus("初始化失败");
        toast("初始化失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  init();
})();
