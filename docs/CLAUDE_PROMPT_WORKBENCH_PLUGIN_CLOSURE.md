# 工作台/产物中心插件化闭环改造

---

## 你的角色

你是接手该仓库的新工程师。你不知道历史上下文，所以请严格按本文档执行，不要先入为主做大改。

---

## 任务背景

这是 Nion-Agent 项目。`产物中心(Artifact Center)` 和 `工作台(Workbench)` 是核心能力，不能删除、不能弱化。

产品最初目标是插件化工作台：
- 在设置中有“插件管理”入口。
- 支持上传压缩包（`.nwp`）给工作台扩展能力。
- 插件可以启停、卸载、持久化。

现状是“部分插件化已实现，但关键链路未闭环”。

---

## 强约束（必须遵守）

1. 不得删除或弱化核心功能：
- 产物中心
- 产物工作台
- 工作目录（Working Directory）

2. 不得恢复“文件按钮”及其冲突逻辑：
- 当前产品约束是“工作目录已覆盖文件能力”，不要再加回独立文件按钮。

3. 保持“新对话阶段不展示产物中心，不请求 artifact-groups”的行为不回退。

4. 仓库当前有未提交改动，禁止回滚无关改动。

---

## 已核验现状（请以代码事实为准）

### A. 插件基础设施存在

- 插件类型与接口：`frontend/src/core/workbench/types.ts`
- 注册中心：`frontend/src/core/workbench/registry.ts`
- 包加载与安装：`frontend/src/core/workbench/loader.ts`
- hooks：`frontend/src/core/workbench/hooks.ts`
- SDK 上下文：`frontend/src/core/workbench/sdk.ts`
- 工作台容器：`frontend/src/components/workspace/artifacts/workbench-container.tsx`

### B. 内置插件存在且启动时会加载

- 内置插件初始化：`frontend/src/plugins/index.ts`
- 全局挂载初始化器：`frontend/src/components/plugin-initializer.tsx`
- 布局中已接入：`frontend/src/app/layout.tsx`

### C. 设置页中的插件管理组件“存在但不可达”

- 页面组件存在：`frontend/src/components/workspace/settings/workbench-plugins-page.tsx`
- 但设置导航和渲染未接入该页：`frontend/src/components/workspace/settings/settings-dialog.tsx`

### D. `.nwp` 上传能力存在，但只是前端本地安装

- 上传入口在插件页：`workbench-plugins-page.tsx`
- 存储使用 IndexedDB：`loader.ts`（`nion-workbench-plugins`）
- 后端无 workbench 插件管理 API（仅 channels 下有 dingtalk 插件概念）

### E. 已安装插件生命周期不闭环

- 启动时仅注册 built-in 插件，未看到自动恢复“已安装插件”流程。
- 开关启停只改内存 registry，未写回 IndexedDB metadata，刷新后可能丢失。

### F. SDK 与后端 artifacts 接口契约不一致

- SDK 提供 `writeFile/deleteFile/listFiles`（PUT/DELETE/GET dir 查询）
- 网关当前 artifacts 路由只有 GET 文件读取：`backend/src/gateway/routers/artifacts.py`

### G. “通过技能创建插件”跳转疑似死链路

- 插件页跳转：`/workspace/chats/new?mode=workbench-plugin`
- 现有 mode 处理只识别 `mode=skill`：`frontend/src/components/workspace/chats/use-chat-mode.ts`

---

## 本次要达成的目标（按优先级）

### P0（必须完成）

1. 让设置中可访问“工作台插件管理”页面。
2. 实现已安装插件的启动恢复：
- 应用启动时读取 installed metadata
- 对 `enabled=true` 的插件自动加载并注册
3. 修复插件启停持久化：
- 开关状态必须写回 IndexedDB
- 刷新后状态保持一致
4. 保证回归不破坏：
- 新对话不显示产物中心按钮
- 新对话不触发 artifact-groups 请求
- 工作目录入口保持可用

### P1（强烈建议完成）

5. 处理 `mode=workbench-plugin` 入口：
- 要么补齐对应引导逻辑
- 要么改为现有可用路径并更新文案
6. 处理 SDK-后端契约不一致：
- 推荐补齐后端 list/write/delete 路由并加路径安全校验
- 若本轮不做后端，必须在前端 SDK 降级，避免误导插件（显式报错、能力标注）

### P2（可后续）

7. 插件安全隔离增强（当前动态 import Blob，建议至少规划 Worker/Sandbox）。

---

## 建议实施步骤

1. 接入设置页入口
- 修改 `settings-dialog.tsx` 的 section 定义与渲染分支
- 挂载 `WorkbenchPluginsPage`

2. 建立插件启动恢复逻辑
- 在 `PluginInitializer` 或独立 bootstrap 中加入：
  - `listInstalledPlugins()`
  - `registerInstalled(installed)`
  - 对 enabled 插件 `loadInstalledPlugin + register`
- 注意异常隔离：单个插件加载失败不影响其他插件和主应用

3. 补齐启停持久化
- 在 `loader.ts` 提供 metadata 更新函数（如 `updateInstalledPluginMetadata`）
- 在 `useTogglePlugin` 中调用持久化而非只改内存对象

4. 处理 `mode=workbench-plugin`
- 在 `useSpecificChatMode` 增加该模式分支，注入合适的初始 prompt
- 或统一到 `mode=skill` 并修正跳转来源

5. 对齐 SDK 与后端能力
- 若补后端：新增 artifacts list/write/delete API 并保证路径安全
- 若不补后端：收敛 SDK 类型与方法，避免声明存在但实际不可用

---

## 验收标准（DoD）

1. 设置页能看到并打开“工作台插件管理”。
2. 上传 `.nwp` 后可立即生效。
3. 刷新页面后：
- 插件仍在“已安装”列表
- 启用状态保持
- enabled 插件可继续匹配渲染
4. 禁用插件后刷新，插件不会被匹配。
5. 新对话页：
- 产物中心按钮不出现
- 无 artifact-groups 请求
6. 工作目录入口仍在聊天页头部可用。
7. 若保留 `writeFile/deleteFile/listFiles`，对应后端接口实际可用；否则前端 SDK 能力声明与实现一致。

---

## 建议验证命令

在仓库根目录执行：

```bash
cd frontend && pnpm run check
```

如涉及后端接口改动，再执行：

```bash
cd backend && make test
cd backend && make lint
```

---

## 需要重点避免的错误

1. 误删 `产物中心` 或 `工作台` 相关组件。
2. 重新引入“文件按钮”相关功能。
3. 只改 UI 文案，不补真实生命周期逻辑。
4. 在有未提交改动的前提下回滚他人代码。

---

## 交付物要求

1. 代码改动。
2. 简短变更说明：
- 改了哪些文件
- 每项改动解决了哪个目标
- 还剩哪些风险或未完成项
3. 验证结果：
- 执行了哪些命令
- 是否全部通过

