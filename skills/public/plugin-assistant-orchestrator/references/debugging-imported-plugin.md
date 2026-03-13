# Imported Plugin Debugging

适用时机：从“调试插件”入口进入，或当前会话是 imported/debug 模式。

## 第一步必须做什么
- 读取 `/mnt/user-data/workspace/plugin-src/manifest.json`
- 找到 `entry`
- 识别关键目录：`assets/`、`docs/`、`fixtures/`、主脚本/样式文件

## 调试原则
- 先解释当前插件怎么工作，再建议改哪里。
- 优先做增量修改，不重建工程结构。
- 如果用户说“调整这个插件”，默认基于现有源码改，而不是重新生成。

## 反馈格式
- 当前入口文件
- 当前关键资源文件
- 建议最小修改点
- 修改后如何验证
