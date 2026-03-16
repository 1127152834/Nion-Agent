# Nion-Agent 架构整改总方案

> **角色**：首席架构师 · 审计等级：生产级严格标准
> **执行团队**：3 名 P8 级开发人员，各自独立分支并行开发
> **日期**：2026-03-16

---

## 一、架构审计总览

### 当前系统画像

| 维度 | 现状 | 评级 | 目标 |
|------|------|------|------|
| **认证鉴权** | 零认证，CORS 全开 | 🔴 F | API Key + RBAC |
| **数据持久化** | 文件 JSON + SQLite 混用，无统一 DAL | 🟠 D | 统一 Repository 层 |
| **错误处理** | 无全局异常处理，响应格式不统一 | 🟠 D | 统一错误响应 + 全局 handler |
| **API 设计** | 无分页标准，无版本管理 | 🟡 C | 统一分页/排序/版本 |
| **前端测试** | 0 个测试文件 | 🔴 F | 关键路径 E2E + 单元测试 |
| **后端测试** | 93 文件 329 个测试 | 🟡 C | 补充集成测试 |
| **状态管理** | 38 个 React Context，Settings 页面 17-32 个 useState | 🟡 C | 精简 Context + form state 库 |
| **列表性能** | 零虚拟化，所有列表全量渲染 | 🟠 D | 关键列表虚拟化 |
| **前端 Error Boundary** | 仅 A2UI 卡片有 | 🟠 D | 路由级 + 功能级 boundary |
| **配置系统** | Pydantic 验证 + SQLite 版本控制 | 🟢 B | 保持，加强热重载 |
| **线程安全** | heartbeat store 有死锁 bug，9/10 单例无同步 | 🔴 F | RLock + 原子操作 |
| **文件上传** | 无大小限制，无类型白名单 | 🔴 F | 大小/类型验证 |
| **Electron IPC** | host-fs:read/write 无路径限制 | 🔴 F | 路径白名单 |
| **XSS 防护** | HTML artifact 内联渲染，无 CSP | 🟠 D | sandbox iframe + CSP |
| **类型安全** | 0 个 `any`/`as any` | 🟢 A | 保持 |
| **国际化** | 414 处硬编码中文绕过 i18n | 🔴 F | 全部走 i18n |
| **apiFetch 覆盖** | 仅 13 处使用，~100+ 处仍用 raw fetch | 🟠 D | 100% 迁移 |
| **前端路由错误** | 零 error.tsx / not-found.tsx | 🔴 F | 全路由覆盖 |
| **Gateway 绑定** | 默认 0.0.0.0 + 无认证 | 🔴 F | 默认 127.0.0.1 |

### 核心问题分类

#### P0 — 阻塞上线（必须立即修复）

1. **零认证系统**：任何人可访问所有 API，包括配置修改、模型密钥读取、文件操作
2. **heartbeat store 死锁 bug**：`append_log()` 使用 `threading.Lock`（不可重入），内部调用 `load_logs()` 再次获取同一锁 → **必然死锁**。scheduler/store.py 和 subagents/run_store.py 有 TOCTOU 竞态条件
3. **文件上传无大小限制**：`uploads.py` 的 `await file.read()` 直接将整个文件读入内存，攻击者可上传 GB 级文件耗尽内存
4. **Electron IPC 无路径限制**：`desktop:host-fs:read/write` 接受任意文件路径，可读取 `~/.ssh/id_rsa`、写入任意系统文件
5. **零前端测试 + 零 error.tsx**：无法保证回归安全，未处理异常显示 Next.js 默认错误页
6. **HTML artifact 内联渲染（XSS）**：`artifacts.py` 的 `HTMLResponse` 渲染用户生成的 HTML，可执行任意 JS

#### P1 — 严重影响质量

4. **数据层无抽象**：Store 实现直接在 router 中调用，业务逻辑和数据访问混合
5. **API 响应格式不统一**：有的返回 `{data}`，有的返回裸对象，有的返回 `{detail}`
6. **Settings 页面状态管理灾难**：单个页面 17-32 个 useState，无 form 库
7. **apiFetch 覆盖率仅 13%**：~100+ 处仍用 raw `fetch()`，每个 API 模块自行实现错误处理
8. **414 处硬编码中文**：16 个组件文件绕过 i18n 系统，英文用户看到中文
9. **Gateway 默认绑定 0.0.0.0**：结合零认证，暴露在网络上极危险
10. **9/10 配置单例无线程同步**：FastAPI async + 后台线程池环境下有数据竞争风险

#### P2 — 影响可维护性

8. **无 API 版本管理**：所有端点在 `/api/` 下，无法无损迭代
9. **分页标准缺失**：部分端点有 limit，无 offset/cursor，无总数
10. **前端无列表虚拟化**：消息列表、日志列表全量渲染
11. **bridge_service.py 3345 行**：Channel 系统核心文件过大

---

## 二、开发人员分工

### 分支策略

```
main
 ├── arch/dev1-backend-core     (DEV1: 后端核心层)
 ├── arch/dev2-frontend-core    (DEV2: 前端核心层)
 └── arch/dev3-infra-security   (DEV3: 基础设施与安全)
```

### 文件所有权边界（严格隔离，零冲突）

| 开发人员 | 独占目录 | 禁止触碰 |
|---------|---------|---------|
| **DEV1** | `backend/src/gateway/`, `backend/src/config/`, `backend/src/heartbeat/`, `backend/src/evolution/`, `backend/src/scheduler/`, `backend/src/processlog/`, `backend/tests/` | frontend/, desktop/ |
| **DEV2** | `frontend/src/core/`, `frontend/src/components/`, `frontend/src/app/`, `frontend/src/hooks/`, `frontend/package.json` | backend/, desktop/ |
| **DEV3** | `backend/src/agents/`, `backend/src/channels/`, `backend/src/sandbox/`, `backend/src/mcp/`, `backend/src/tools/`, `backend/src/models/`, `desktop/`, 项目根目录配置 | frontend/src/components/ |

**共享接口契约**：DEV1 定义 API 响应类型 → DEV2 在前端对齐 → DEV3 实现安全层。API 类型定义文件（`backend/src/gateway/schemas/`）由 DEV1 创建，DEV3 的认证中间件和 DEV2 的前端类型都依赖它。

---

## 三、里程碑与集成计划

### Phase 1（Week 1-2）：基础设施加固

| DEV | 任务 | 产出 |
|-----|------|------|
| DEV1 | 统一 API 响应格式 + 全局异常处理 | `schemas/`, exception handlers |
| DEV2 | Error Boundary 体系 + form state 库引入 | 路由级/功能级 boundary |
| DEV3 | API Key 认证中间件 + 安全审计修复 | auth middleware, CORS 收紧 |

### Phase 2（Week 3-4）：核心层重构

| DEV | 任务 | 产出 |
|-----|------|------|
| DEV1 | Repository 层抽象 + 统一分页 | `backend/src/gateway/repositories/` |
| DEV2 | Settings 页面 form state 迁移 + 列表虚拟化 | react-hook-form 集成 |
| DEV3 | Channel bridge_service 拆分 + Agent 系统可观测性 | 日志/指标/追踪 |

### Phase 3（Week 5-6）：质量提升

| DEV | 任务 | 产出 |
|-----|------|------|
| DEV1 | API 集成测试 + 分页/排序标准化 | pytest-httpx 测试套件 |
| DEV2 | 前端 E2E 测试 + 大文件拆分 | Playwright 测试套件 |
| DEV3 | 性能基准测试 + 部署文档 | 负载测试报告 |

### 集成检查点

- **每周五**：三个分支同时向 `arch/integration` 合并，运行全量测试
- **每个 Phase 结束**：架构师 code review，通过后合并到 main
- **冲突解决规则**：接口契约（`schemas/`）变更需三方同步，由 DEV1 主导

---

## 四、技术规范

### 4.1 统一 API 响应格式

```python
# 所有成功响应
{
    "data": <payload>,
    "meta": {
        "total": 100,        # 列表端点必须
        "limit": 20,         # 列表端点必须
        "offset": 0,         # 列表端点必须
        "version": "v1"
    }
}

# 所有错误响应
{
    "error": {
        "code": "RESOURCE_NOT_FOUND",
        "message": "Agent 'foo' not found",
        "details": {}        # 可选
    }
}
```

### 4.2 认证方案

```
Phase 1: API Key (Header: X-API-Key)
  - 单用户场景足够
  - 配置在 config.yaml 中
  - 不认证的端点：/health, /api/config (GET only)

Phase 2 (未来): OAuth 2.0 / JWT
  - 多用户场景
  - 基于 better-auth (frontend/server/ 已有占位)
```

### 4.3 前端 Form State 标准

```typescript
// 所有 Settings 页面统一使用 react-hook-form + zod
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

const schema = z.object({ ... });
const form = useForm({ resolver: zodResolver(schema) });
```

### 4.4 Error Boundary 层级

```
App (全局 fallback)
 └── WorkspaceLayout (路由级)
      ├── ChatPage (功能级 — 消息流)
      ├── SettingsPage (功能级 — 设置表单)
      └── PluginPage (功能级 — 插件系统)
```

---

## 五、详细实施方案

- [DEV1 后端核心层重构方案](./DEV1-backend-core.md)
- [DEV2 前端核心层重构方案](./DEV2-frontend-core.md)
- [DEV3 基础设施与安全方案](./DEV3-infra-security.md)

---

## 六、验收标准

### 必须达成

- [ ] 所有 API 端点需认证后才可访问
- [ ] API 响应格式 100% 统一（0 个裸对象响应）
- [ ] 全局异常处理覆盖所有未捕获异常
- [ ] 前端 Error Boundary 覆盖所有路由
- [ ] Settings 页面 useState 从 17-32 降到 ≤3
- [ ] 后端测试覆盖所有 router（≥80% 行覆盖率）
- [ ] 前端 E2E 覆盖核心用户流程（聊天、设置、Agent）
- [ ] 无 1000+ 行单文件（当前还剩 6 个超 1000 行）

### 质量指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 后端测试数 | 329 | ≥500 |
| 前端测试数 | 0 | ≥50 E2E + ≥100 单元 |
| API 响应统一率 | ~30% | 100% |
| 超 1000 行文件 (前端) | 12 | ≤3 |
| 超 1000 行文件 (后端) | 8 | ≤3 |
| Settings useState 总数 | ~130 | ≤30 |
