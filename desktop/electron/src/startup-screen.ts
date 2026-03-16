const STAGE_LABELS: Record<string, string> = {
  "runtime.assign-ports": "读取端口配置",
  "runtime.check-ports": "检查端口状态",
  "runtime.check-dependencies": "检查系统依赖",
  "runtime.start.langgraph": "启动 AI 引擎",
  "runtime.start.gateway": "启动网关服务",
  "runtime.recover.pending-runs": "恢复运行状态",
  "runtime.start.frontend": "启动前端服务",
};

const STAGE_ORDER = Object.keys(STAGE_LABELS);

export function renderStartupLoadingHtml(): string {
  const stageItems = STAGE_ORDER.map(
    (id) => `<li id="stage-${id.replaceAll(".", "-")}" class="stage pending">
      <span class="icon">○</span>
      <span class="label">${STAGE_LABELS[id]}</span>
    </li>`
  ).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Nion 启动中</title>
    <style>
      :root {
        --bg: #0b1020;
        --card: rgba(255,255,255,0.08);
        --stroke: rgba(255,255,255,0.16);
        --text: rgba(255,255,255,0.92);
        --muted: rgba(255,255,255,0.55);
        --accent: #7ae1ff;
        --accent2: #6dffb1;
        --danger: #ff5a70;
      }
      html, body {
        height: 100%; margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
          "Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
        background: radial-gradient(1200px 700px at 20% 10%, rgba(122,225,255,0.22), transparent 60%),
          radial-gradient(900px 600px at 80% 20%, rgba(109,255,177,0.16), transparent 55%),
          var(--bg);
        color: var(--text);
        -webkit-app-region: drag;
      }
      .wrap { height:100%; display:grid; place-items:center; }
      .card {
        width: min(420px,90%);
        border: 1px solid var(--stroke);
        background: linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.06));
        backdrop-filter: blur(12px);
        border-radius: 18px;
        padding: 28px 28px 24px;
        box-shadow: 0 22px 70px rgba(0,0,0,0.35);
      }
      .logo {
        font-size: 22px; font-weight: 800; letter-spacing: 0.3px;
        background: linear-gradient(135deg, var(--accent), var(--accent2));
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        margin-bottom: 4px;
      }
      .sub { font-size: 13px; color: var(--muted); margin-bottom: 20px; }
      ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .stage { display: flex; align-items: center; gap: 10px; font-size: 13px; }
      .icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
      .label { color: var(--muted); transition: color 0.2s; }
      .stage.running .label { color: var(--text); }
      .stage.success .label { color: var(--text); }
      .stage.failed .label { color: var(--danger); }
      .stage.running .icon { animation: spin 1s linear infinite; display:inline-block; }
      .err { margin-top: 16px; font-size: 12px; color: var(--danger); white-space: pre-wrap; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="logo">Nion</div>
        <div class="sub">正在启动服务，请稍候…</div>
        <ul>${stageItems}</ul>
        <div class="err" id="err"></div>
      </div>
    </div>
    <script>
      const ICONS = { pending: '○', running: '◌', success: '✓', failed: '✗' };

      function getEl(stage) {
        return document.getElementById('stage-' + stage.replaceAll('.', '-'));
      }

      window.electronAPI.onStartupStage(function(data) {
        const el = getEl(data.stage);
        if (!el) return;
        const icon = el.querySelector('.icon');
        const label = el.querySelector('.label');
        el.className = 'stage ' + (
          data.status === 'started' ? 'running' :
          data.status === 'success' ? 'success' :
          data.status === 'failed'  ? 'failed'  : 'pending'
        );
        icon.textContent = (
          data.status === 'started' ? ICONS.running :
          data.status === 'success' ? ICONS.success :
          data.status === 'failed'  ? ICONS.failed  : ICONS.pending
        );
        if (data.status === 'failed' && data.error) {
          document.getElementById('err').textContent = data.error;
        }
      });
    </script>
  </body>
</html>`;
}
