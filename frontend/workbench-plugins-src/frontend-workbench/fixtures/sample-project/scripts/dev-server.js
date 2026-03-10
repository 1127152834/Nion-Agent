const http = require("http");

const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Frontend Workbench Fixture</title>
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 0; background: #f7f6f1; color: #2b2a28; }
      main { max-width: 760px; margin: 48px auto; padding: 24px; background: #fff; border: 1px solid #ddd7cc; border-radius: 12px; }
      h1 { margin-top: 0; }
      code { background: #f0eee8; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Frontend Workbench</h1>
      <p>开发服务已启动，可在右侧预览窗口查看。</p>
      <p>当前地址：<code>http://localhost:${port}</code></p>
    </main>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});

server.listen(port, host, () => {
  console.log(`Frontend workbench fixture running at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
