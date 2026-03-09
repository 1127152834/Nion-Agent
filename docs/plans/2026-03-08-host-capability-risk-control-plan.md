# 2026-03-08 主机权限与风险控制计划文档（Nion-Agent）

> 目标：在不破坏沙箱安全边界的前提下，支持受控主机能力（文件、应用、浏览器、消息发送），实现“默认安全 + 按需放权 + 全程可审计”。

## 一、对标基线（含源码逻辑）
### 1. OpenClaw（主对标）
- 分层工具策略：`tools.profile` + allow/deny + provider 级缩减，避免全量工具直暴露。参考 [docs/tools/index.md#L32](https://github.com/openclaw/openclaw/blob/main/docs/tools/index.md#L32)。
- 沙箱模式分级：`off | non-main | all`，并区分 scope/workspaceAccess。参考 [docs/gateway/sandboxing.md#L41](https://github.com/openclaw/openclaw/blob/main/docs/gateway/sandboxing.md#L41)。
- 危险命令默认 deny 并可精细 allow/deny：`DEFAULT_DANGEROUS_NODE_COMMANDS` 与命令白名单校验。参考 [src/gateway/node-command-policy.ts#L65](https://github.com/openclaw/openclaw/blob/main/src/gateway/node-command-policy.ts#L65)。
- 危险工具集中定义，避免策略漂移：`DEFAULT_GATEWAY_HTTP_TOOL_DENY`、`DANGEROUS_ACP_TOOL_NAMES`。参考 [src/security/dangerous-tools.ts#L1](https://github.com/openclaw/openclaw/blob/main/src/security/dangerous-tools.ts#L1)。
- 审批流：`exec.approval.requested -> exec.approval.resolve`，支持 allow once / always / deny。参考 [docs/tools/exec-approvals.md#L252](https://github.com/openclaw/openclaw/blob/main/docs/tools/exec-approvals.md#L252)。
- 安全审计 CLI：识别“配置有沙箱但实际未生效”“dangerous allowCommands”等。参考 [docs/gateway/security/index.md#L183](https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md#L183) 与 [src/security/audit-extra.sync.ts#L1012](https://github.com/openclaw/openclaw/blob/main/src/security/audit-extra.sync.ts#L1012)。

### 2. OpenHands（运行时隔离对标）
- Runtime 抽象明确区分 Docker/Local/Remote。
- 文档明确声明 Local Runtime 无隔离、等同主机权限。参考 [openhands/runtime/README.md#L121](https://github.com/All-Hands-AI/OpenHands/blob/main/openhands/runtime/README.md#L121)。
- SandboxConfig 将 host network、runtime env、user_id 等作为显式配置项。参考 [openhands/core/config/sandbox_config.py#L16](https://github.com/All-Hands-AI/OpenHands/blob/main/openhands/core/config/sandbox_config.py#L16)。

### 3. Open Interpreter（确认与自动运行对标）
- 默认执行前确认，可 `-y`/`auto_run=True` 跳过。参考 [README.md#L338](https://github.com/OpenInterpreter/open-interpreter/blob/main/README.md#L338)。
- Safe Mode 作为“风险缓解”而非“绝对安全”承诺。参考 [docs/SAFE_MODE.md#L1](https://github.com/OpenInterpreter/open-interpreter/blob/main/docs/SAFE_MODE.md#L1)。
- 终端执行链路中明确了 confirmation 与 safe_mode 扫描分支。参考 [terminal_interface.py#L187](https://github.com/OpenInterpreter/open-interpreter/blob/main/interpreter/terminal_interface/terminal_interface.py#L187)。

## 二、Nion 目标架构（决策版）
### 1. 双平面执行
- `Sandbox Plane`：默认平面，仅允许 `/mnt/user-data/**`。
- `Host Capability Plane`：受控主机平面，仅通过结构化能力调用，不开放裸主机 shell。
- 现有问题修复优先：桌面 txt 预览改为“授权导入后预览”，不直接放开 artifacts 读取主机绝对路径。

### 2. 权限模型（固定）
- `scope`：`host.fs.read`、`host.fs.write`、`host.app.automation`、`host.browser.automation`、`host.message.send`。
- `risk_level`：`low | medium | high`。
- `grant_mode`：`once | session | persistent`。
- `resource`：路径前缀、应用标识、域名白名单、联系人白名单。
- 默认策略：`deny-all`；未命中授权一律拒绝。

### 3. 高风险动作强制审批
- 高风险定义固定：外发消息、支付/订票、登录态操作、批量写入删除。
- 执行模型固定为两阶段：`prepare`（预览）-> `commit`（确认执行）。
- 确认票据必须 TTL + 一次性消费，复用现有 token 机制并扩展持久化授权。

## 三、实施计划（按阶段）
### 阶段 P0（先修当前问题，1 周）
1. 新增“主机文件导入”接口：`POST /api/threads/{thread_id}/host-files/import`，输入主机路径，输出线程内虚拟路径。
2. 前端 artifacts 预览失败时（路径不在 `/mnt/user-data`）提供“授权并导入”CTA，而非仅报错。
3. `present_files` 增加路径强校验，主机绝对路径不直接进入 artifact 列表。
4. 验收：桌面 txt 在授权后可预览；未授权时不可读且有明确交互引导。

### 阶段 P1（权限内核与能力网关，1-2 周）
1. 新增 `PolicyEngine` 与 `CapabilityGrantRepository`（SQLite，位于 `NION_HOME/security`）。
2. 新增 API：
- `POST /api/host-capabilities/evaluate`
- `POST /api/host-capabilities/approve`
- `POST /api/host-capabilities/execute`
- `GET /api/host-capabilities/grants`
- `DELETE /api/host-capabilities/grants/{id}`
3. Electron 新增受控 IPC：
- `desktop:host-fs:pick`
- `desktop:host-fs:read`
- `desktop:host-fs:write`
- `desktop:host-app:invoke`
4. 所有 host 执行前必须经过 evaluate/approve，拒绝旁路调用。

### 阶段 P2（工具层重构与安全收口，2 周）
1. 新增 `host_*` 工具族，逐步承接“微信回复、微博发布、订票、文档编辑”。
2. `bash` 工具降权为开发模式能力，默认关闭主机执行，仅保留沙箱执行。
3. `LocalSandbox` 增加路径硬边界校验，禁止越界路径。
4. 新增 `nion security audit`（对标 OpenClaw）：扫描配置风险、授权漂移、危险能力暴露。

### 阶段 P3（体验与治理，1 周）
1. 权限中心 UI：查看授权、撤销授权、查看最近高风险执行。
2. 审计中心 UI：按会话/能力/资源检索，支持导出。
3. 自动化策略分档：
- 手动模式：全部高风险都确认
- 守护模式：低风险自动，高风险确认
- 自动模式：仅对白名单目标自动执行

## 四、落地到当前代码库的修改面
- 路径边界与 artifact：  
[paths.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/config/paths.py)  
[artifacts.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/gateway/routers/artifacts.py)  
[present_file_tool.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/tools/builtins/present_file_tool.py)
- 沙箱与工具收口：  
[tools.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/sandbox/tools.py)  
[local_sandbox.py](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/backend/src/sandbox/local/local_sandbox.py)
- 桌面能力桥与权限入口：  
[preload.ts](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/desktop/electron/src/preload.ts)  
[main.ts](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/desktop/electron/src/main.ts)  
[artifact-file-detail.tsx](/Users/zhangtiancheng/Documents/项目/新项目/Nion-Agent/frontend/src/components/workspace/artifacts/artifact-file-detail.tsx)

## 五、测试与验收
- 单元测试：策略判定（allow/deny/require_confirmation）、TTL 过期、一次性票据消费。
- 单元测试：路径安全（`..`、符号链接逃逸、大小写/编码绕过）。
- 集成测试：未授权主机文件读取必拒绝；授权导入后可读。
- 集成测试：高风险动作必须两阶段执行，绕过 commit 必失败。
- E2E：读取桌面文件 -> 编辑 -> 保存；微信/微博“草稿+确认发送”；订票“预览订单+确认提交”。
- 回归测试：现有 `/mnt/user-data` 工作流与 artifacts 预览不退化。

## 六、默认假设
- 产品定位单机个人版，先不做多租户隔离。
- 持久授权默认 7 天失效；会话授权随会话结束失效。
- 任何外部发送与交易类动作默认高风险，必须人工确认。
- 若运行在非桌面环境（无 Electron host bridge），主机能力接口统一返回不可用。
