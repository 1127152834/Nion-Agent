(function () {
  const bridge = window.NionWorkbench;
  if (!bridge || typeof bridge.call !== "function") {
    document.body.innerHTML = "<pre style='padding:16px'>Workbench bridge unavailable</pre>";
    return;
  }

  const state = {
    path: bridge.artifactPath,
    mimeType: "image/png",
    tool: "select",
    color: "#ff2e63",
    size: 12,
    zoom: 1,
    panX: 0,
    panY: 0,
    drawing: false,
    startX: 0,
    startY: 0,
    pointerX: 0,
    pointerY: 0,
    baseSnapshot: null,
    history: [],
    historyIndex: -1,
    maxHistory: 80,
    largeImageScaled: false,
  };

  const refs = {};

  function $(id) {
    return document.getElementById(id);
  }

  function call(method, params) {
    return bridge.call(method, params || {});
  }

  function toast(message, type) {
    return call("toast", { message: message, type: type || "info" }).catch(function () {
      return undefined;
    });
  }

  function setStatus(text) {
    refs.statusText.textContent = text;
  }

  function pathName(path) {
    const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : path;
  }

  function dirName(path) {
    const normalized = String(path || "").replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    if (index <= 0) return "/mnt/user-data/outputs";
    return normalized.slice(0, index);
  }

  function extName(path) {
    const name = pathName(path);
    const index = name.lastIndexOf(".");
    return index > -1 ? name.slice(index + 1).toLowerCase() : "png";
  }

  function mimeFromExt(ext) {
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    if (ext === "bmp") return "image/bmp";
    if (ext === "gif") return "image/gif";
    return "image/png";
  }

  function setWarning(message) {
    if (!message) {
      refs.warning.classList.add("hidden");
      refs.warning.textContent = "";
      return;
    }
    refs.warning.classList.remove("hidden");
    refs.warning.textContent = message;
  }

  function applyStageTransform() {
    refs.stage.style.transform =
      "translate(" + state.panX + "px, " + state.panY + "px) scale(" + state.zoom + ")";
    refs.zoomInput.value = String(Math.round(state.zoom * 100));
  }

  function canvasPoint(event) {
    const rect = refs.mainCanvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) * refs.mainCanvas.width) / rect.width;
    const y = ((event.clientY - rect.top) * refs.mainCanvas.height) / rect.height;
    return {
      x: Math.max(0, Math.min(refs.mainCanvas.width, x)),
      y: Math.max(0, Math.min(refs.mainCanvas.height, y)),
    };
  }

  function pushHistory(label) {
    const dataUrl = refs.mainCanvas.toDataURL(state.mimeType || "image/png");
    const next = state.history.slice(0, state.historyIndex + 1);
    next.push({
      label: label,
      dataUrl: dataUrl,
      time: new Date().toLocaleTimeString(),
      width: refs.mainCanvas.width,
      height: refs.mainCanvas.height,
    });
    if (next.length > state.maxHistory) {
      next.shift();
    }
    state.history = next;
    state.historyIndex = next.length - 1;
    renderHistory();
  }

  function restoreHistory(index) {
    if (index < 0 || index >= state.history.length) return;
    const item = state.history[index];
    const image = new Image();
    image.onload = function () {
      const width = Number(item.width) || image.naturalWidth;
      const height = Number(item.height) || image.naturalHeight;

      if (refs.mainCanvas.width !== width || refs.mainCanvas.height !== height) {
        refs.mainCanvas.width = width;
        refs.mainCanvas.height = height;
        refs.overlayCanvas.width = width;
        refs.overlayCanvas.height = height;
      }

      refs.mainCtx.clearRect(0, 0, width, height);
      refs.mainCtx.drawImage(image, 0, 0, width, height);
      clearOverlay();
      state.historyIndex = index;
      renderHistory();
      setStatus("已切换到历史步骤: " + item.label);
    };
    image.src = item.dataUrl;
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    restoreHistory(state.historyIndex - 1);
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    restoreHistory(state.historyIndex + 1);
  }

  function renderHistory() {
    refs.historyList.innerHTML = "";
    for (let i = 0; i < state.history.length; i += 1) {
      const item = state.history[i];
      const node = document.createElement("button");
      node.className = "history-item" + (i === state.historyIndex ? " active" : "");
      node.textContent = (i + 1).toString() + ". " + item.label + " · " + item.time;
      node.addEventListener("click", function () {
        restoreHistory(i);
      });
      refs.historyList.appendChild(node);
    }
    refs.undoBtn.disabled = state.historyIndex <= 0;
    refs.redoBtn.disabled = state.historyIndex >= state.history.length - 1;
  }

  function clearOverlay() {
    refs.overlayCtx.clearRect(0, 0, refs.overlayCanvas.width, refs.overlayCanvas.height);
  }

  function drawLine(ctx, fromX, fromY, toX, toY, color, width, eraseMode) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    if (eraseMode) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
    }
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();
  }

  function drawMosaic(x, y, brushSize) {
    const size = Math.max(8, brushSize * 1.8);
    const left = Math.max(0, Math.floor(x - size / 2));
    const top = Math.max(0, Math.floor(y - size / 2));
    const width = Math.min(Math.floor(size), refs.mainCanvas.width - left);
    const height = Math.min(Math.floor(size), refs.mainCanvas.height - top);
    if (width < 2 || height < 2) return;

    const imageData = refs.mainCtx.getImageData(left, top, width, height);
    const data = imageData.data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] || 0;
      g += data[i + 1] || 0;
      b += data[i + 2] || 0;
      count += 1;
    }

    if (!count) return;
    const avgR = Math.round(r / count);
    const avgG = Math.round(g / count);
    const avgB = Math.round(b / count);

    refs.mainCtx.save();
    refs.mainCtx.fillStyle = "rgb(" + avgR + ", " + avgG + ", " + avgB + ")";
    refs.mainCtx.fillRect(left, top, width, height);
    refs.mainCtx.restore();
  }

  function drawArrow(ctx, startX, startY, endX, endY, color, width) {
    const angle = Math.atan2(endY - startY, endX - startX);
    const head = Math.max(10, width * 1.8);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function applyCrop(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(refs.mainCanvas.width, Math.max(x1, x2));
    const bottom = Math.min(refs.mainCanvas.height, Math.max(y1, y2));
    const width = Math.round(right - left);
    const height = Math.round(bottom - top);

    if (width < 8 || height < 8) {
      toast("截取区域过小", "error");
      return;
    }

    const temp = document.createElement("canvas");
    temp.width = width;
    temp.height = height;
    const tempCtx = temp.getContext("2d");
    tempCtx.drawImage(refs.mainCanvas, left, top, width, height, 0, 0, width, height);

    refs.mainCanvas.width = width;
    refs.mainCanvas.height = height;
    refs.overlayCanvas.width = width;
    refs.overlayCanvas.height = height;

    refs.mainCtx.drawImage(temp, 0, 0);
    clearOverlay();
    pushHistory("crop");
  }

  function renderShapePreview() {
    clearOverlay();
    if (!state.drawing) return;
    refs.overlayCtx.save();
    refs.overlayCtx.strokeStyle = state.color;
    refs.overlayCtx.lineWidth = Math.max(1, state.size);
    refs.overlayCtx.lineCap = "round";
    refs.overlayCtx.lineJoin = "round";

    if (state.tool === "rect" || state.tool === "crop") {
      const x = Math.min(state.startX, state.pointerX);
      const y = Math.min(state.startY, state.pointerY);
      const w = Math.abs(state.pointerX - state.startX);
      const h = Math.abs(state.pointerY - state.startY);
      refs.overlayCtx.strokeRect(x, y, w, h);
      if (state.tool === "crop") {
        refs.overlayCtx.fillStyle = "rgba(255, 255, 255, 0.18)";
        refs.overlayCtx.fillRect(x, y, w, h);
      }
    } else if (state.tool === "arrow") {
      drawArrow(refs.overlayCtx, state.startX, state.startY, state.pointerX, state.pointerY, state.color, state.size);
    }

    refs.overlayCtx.restore();
  }

  function onPointerDown(event) {
    if (!refs.mainCanvas.width || !refs.mainCanvas.height) return;
    const point = canvasPoint(event);
    state.drawing = true;
    state.startX = point.x;
    state.startY = point.y;
    state.pointerX = point.x;
    state.pointerY = point.y;

    if (state.tool === "text") {
      state.drawing = false;
      const text = window.prompt("输入文本", "");
      if (!text) return;
      refs.mainCtx.save();
      refs.mainCtx.fillStyle = state.color;
      refs.mainCtx.font = "600 " + Math.max(12, state.size + 8) + "px sans-serif";
      refs.mainCtx.fillText(text, point.x, point.y);
      refs.mainCtx.restore();
      pushHistory("text");
      return;
    }

    if (state.tool === "pen" || state.tool === "erase") {
      state.baseSnapshot = { x: point.x, y: point.y };
      return;
    }

    if (state.tool === "mosaic") {
      drawMosaic(point.x, point.y, state.size);
      state.baseSnapshot = { x: point.x, y: point.y };
      return;
    }

    if (state.tool === "pan") {
      state.baseSnapshot = {
        x: event.clientX,
        y: event.clientY,
        panX: state.panX,
        panY: state.panY,
      };
      return;
    }

    renderShapePreview();
  }

  function onPointerMove(event) {
    if (!state.drawing) return;
    const point = canvasPoint(event);
    state.pointerX = point.x;
    state.pointerY = point.y;

    if (state.tool === "pen" || state.tool === "erase") {
      drawLine(
        refs.mainCtx,
        state.baseSnapshot.x,
        state.baseSnapshot.y,
        point.x,
        point.y,
        state.color,
        Math.max(1, state.size),
        state.tool === "erase"
      );
      state.baseSnapshot = { x: point.x, y: point.y };
      return;
    }

    if (state.tool === "mosaic") {
      drawMosaic(point.x, point.y, state.size);
      state.baseSnapshot = { x: point.x, y: point.y };
      return;
    }

    if (state.tool === "pan") {
      const dx = event.clientX - state.baseSnapshot.x;
      const dy = event.clientY - state.baseSnapshot.y;
      state.panX = state.baseSnapshot.panX + dx;
      state.panY = state.baseSnapshot.panY + dy;
      applyStageTransform();
      return;
    }

    renderShapePreview();
  }

  function onPointerUp() {
    if (!state.drawing) return;
    state.drawing = false;

    if (state.tool === "pen" || state.tool === "erase" || state.tool === "mosaic") {
      pushHistory(state.tool);
      return;
    }

    if (state.tool === "rect") {
      clearOverlay();
      refs.mainCtx.save();
      refs.mainCtx.strokeStyle = state.color;
      refs.mainCtx.lineWidth = Math.max(1, state.size);
      refs.mainCtx.strokeRect(
        Math.min(state.startX, state.pointerX),
        Math.min(state.startY, state.pointerY),
        Math.abs(state.pointerX - state.startX),
        Math.abs(state.pointerY - state.startY)
      );
      refs.mainCtx.restore();
      pushHistory("rect");
      return;
    }

    if (state.tool === "arrow") {
      clearOverlay();
      drawArrow(refs.mainCtx, state.startX, state.startY, state.pointerX, state.pointerY, state.color, state.size);
      pushHistory("arrow");
      return;
    }

    if (state.tool === "crop") {
      clearOverlay();
      applyCrop(state.startX, state.startY, state.pointerX, state.pointerY);
      return;
    }
  }

  function loadImage() {
    setStatus("读取图片...");
    return call("readBinaryFile", { path: state.path })
      .then(function (payload) {
        state.mimeType = payload && payload.mimeType ? payload.mimeType : mimeFromExt(extName(state.path));

        return new Promise(function (resolve, reject) {
          const image = new Image();
          image.onload = function () {
            let width = image.naturalWidth;
            let height = image.naturalHeight;
            const pixels = width * height;
            state.largeImageScaled = false;

            if (pixels > 14000000 || width > 4200 || height > 4200) {
              const ratio = Math.min(4200 / width, 4200 / height);
              width = Math.max(1, Math.floor(width * ratio));
              height = Math.max(1, Math.floor(height * ratio));
              state.largeImageScaled = true;
            }

            refs.mainCanvas.width = width;
            refs.mainCanvas.height = height;
            refs.overlayCanvas.width = width;
            refs.overlayCanvas.height = height;

            refs.mainCtx.clearRect(0, 0, width, height);
            refs.mainCtx.drawImage(image, 0, 0, width, height);
            clearOverlay();

            if (state.largeImageScaled) {
              setWarning("大图已降级渲染以保证性能，导出时按当前画布分辨率输出。");
            } else {
              setWarning("");
            }

            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            applyStageTransform();
            pushHistory("origin");
            resolve();
          };
          image.onerror = function () {
            reject(new Error("Image decode failed"));
          };
          image.src = payload.dataUrl;
        });
      })
      .then(function () {
        setStatus("图片已加载");
      })
      .catch(function (err) {
        setStatus("图片加载失败");
        toast("加载图片失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  function saveOverwrite() {
    setStatus("保存中...");
    const dataUrl = refs.mainCanvas.toDataURL(state.mimeType || "image/png");
    call("writeBinaryFile", {
      path: state.path,
      dataUrl: dataUrl,
      mimeType: state.mimeType,
    })
      .then(function () {
        setStatus("保存成功");
        toast("已覆盖保存原图", "success");
      })
      .catch(function (err) {
        setStatus("保存失败");
        toast("保存失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  function exportAsNew() {
    const oldName = pathName(state.path);
    const ext = extName(oldName) || "png";
    const base = oldName.replace(/\.[^.]+$/, "");
    const nextName = window.prompt("导出文件名", base + "-edited." + ext);
    if (!nextName) return;

    const targetPath = dirName(state.path) + "/" + nextName;
    const mime = mimeFromExt(extName(nextName));
    const dataUrl = refs.mainCanvas.toDataURL(mime);

    setStatus("导出中...");
    call("writeBinaryFile", {
      path: targetPath,
      dataUrl: dataUrl,
      mimeType: mime,
    })
      .then(function () {
        setStatus("导出成功");
        toast("已导出: " + nextName, "success");
      })
      .catch(function (err) {
        setStatus("导出失败");
        toast("导出失败: " + (err && err.message ? err.message : err), "error");
      });
  }

  function bindEvents() {
    refs.toolbox.addEventListener("click", function (event) {
      const target = event.target;
      if (!target || !target.dataset || !target.dataset.tool) return;
      const tool = target.dataset.tool;
      state.tool = tool;

      const items = refs.toolbox.querySelectorAll(".tool");
      for (let i = 0; i < items.length; i += 1) {
        items[i].classList.remove("active");
      }
      target.classList.add("active");
      setStatus("当前工具: " + tool);
    });

    refs.colorInput.addEventListener("input", function () {
      state.color = refs.colorInput.value;
    });

    refs.sizeInput.addEventListener("input", function () {
      state.size = Number(refs.sizeInput.value) || 12;
    });

    refs.zoomInput.addEventListener("input", function () {
      state.zoom = Math.max(0.25, Math.min(3, Number(refs.zoomInput.value) / 100));
      applyStageTransform();
    });

    refs.undoBtn.addEventListener("click", undo);
    refs.redoBtn.addEventListener("click", redo);
    refs.saveBtn.addEventListener("click", saveOverwrite);
    refs.exportBtn.addEventListener("click", exportAsNew);

    refs.stageViewport.addEventListener("wheel", function (event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const next = state.zoom + (event.deltaY < 0 ? 0.08 : -0.08);
      state.zoom = Math.max(0.25, Math.min(3, next));
      applyStageTransform();
    });

    refs.stageViewport.addEventListener("mousedown", onPointerDown);
    refs.stageViewport.addEventListener("mousemove", onPointerMove);
    document.addEventListener("mouseup", onPointerUp);

    document.addEventListener("keydown", function (event) {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
      if ((event.ctrlKey || event.metaKey) && (key === "z" && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
      if ((event.ctrlKey || event.metaKey) && key === "s") {
        event.preventDefault();
        saveOverwrite();
      }
    });
  }

  function bindRefs() {
    refs.mainCanvas = $("mainCanvas");
    refs.overlayCanvas = $("overlayCanvas");
    refs.mainCtx = refs.mainCanvas.getContext("2d");
    refs.overlayCtx = refs.overlayCanvas.getContext("2d");
    refs.stage = $("stage");
    refs.stageViewport = $("stageViewport");
    refs.toolbox = $("toolbox");
    refs.historyList = $("historyList");
    refs.statusText = $("statusText");
    refs.warning = $("warning");
    refs.saveBtn = $("saveBtn");
    refs.exportBtn = $("exportBtn");
    refs.undoBtn = $("undoBtn");
    refs.redoBtn = $("redoBtn");
    refs.colorInput = $("colorInput");
    refs.sizeInput = $("sizeInput");
    refs.zoomInput = $("zoomInput");
  }

  function init() {
    bindRefs();
    bindEvents();
    applyStageTransform();
    loadImage();
  }

  init();
})();
