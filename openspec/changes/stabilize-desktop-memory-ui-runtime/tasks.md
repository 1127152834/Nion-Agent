## 1. OpenSpec 与热修文档

- [ ] 新增阶段文档 `docs/memoh/plan/2026-03-10-phase-2-desktop-memory-ui-alignment.md`
- [ ] 完成 `stabilize-desktop-memory-ui-runtime` 的 `proposal.md`
- [ ] 完成 `stabilize-desktop-memory-ui-runtime` 的 `design.md`
- [ ] 完成 `stabilize-desktop-memory-ui-runtime` 的 `tasks.md`
- [ ] 完成 `specs/memory-ui-runtime-alignment/spec.md`
- [ ] 运行 `openspec validate stabilize-desktop-memory-ui-runtime --type change --strict`

## 2. 桌面前端运行时对齐

- [ ] 在开发态 Electron 启动前清理 `frontend/.next/dev` 与 `frontend/.next/cache`
- [ ] 保持当前记忆设置页只走 `/api/memory`
- [ ] 明确不为旧 UI 补 `/api/memory/overview|items|timeline` 等接口

## 3. 启动防呆与健康探测

- [ ] 为前端启动记录本次日志起始偏移
- [ ] 在前端 HTTP 可访问后探测 `/workspace/chats/new`
- [ ] 若主工作区返回 5xx / 404，则让桌面启动显式失败
- [ ] 若本次启动新增日志中出现明显前端编译阻塞，则让桌面启动显式失败
- [ ] 输出“已执行 dev 前端缓存清理 / workspace 健康检查”的诊断日志

## 4. 测试、手测、验证、回写

- [ ] 运行 `cd frontend && pnpm typecheck`
- [ ] 运行 `cd backend && uv run pytest tests/test_memory_updater.py tests/test_memory_core_provider.py tests/test_memory_session_policy.py -q`
- [ ] 运行 `git diff --check`
- [ ] 手测桌面开发态 `/workspace/chats/new` 可用
- [ ] 手测“设置 → 记忆”显示已有长期记忆
- [ ] 手测期间确认 `gateway.log` 中不再持续出现旧 memory 扩展接口的 `400`
