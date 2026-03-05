#!/bin/bash
# Electron 模式验证脚本

set -e

echo "=========================================="
echo "  Electron 模式验证"
echo "=========================================="
echo ""

# 1. 检查目录结构
echo "1. 检查目录结构..."
if [ ! -d "desktop/electron" ]; then
  echo "  ✗ desktop/electron 目录不存在"
  exit 1
fi
echo "  ✓ 目录结构正确"
echo ""

# 2. 检查依赖
echo "2. 检查依赖..."
cd desktop/electron
if [ ! -d "node_modules" ]; then
  echo "  ✗ 依赖未安装，运行: pnpm install"
  exit 1
fi
echo "  ✓ 依赖已安装"
echo ""

# 3. 编译 TypeScript
echo "3. 编译 TypeScript..."
pnpm run build
if [ ! -f "dist/main.js" ]; then
  echo "  ✗ 编译失败"
  exit 1
fi
echo "  ✓ 编译成功"
echo ""

# 4. 检查核心文件
echo "4. 检查核心文件..."
REQUIRED_FILES=(
  "dist/main.js"
  "dist/preload.js"
  "dist/process-manager.js"
  "dist/paths.js"
  "dist/health.js"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "  ✗ 缺少文件: $file"
    exit 1
  fi
done
echo "  ✓ 所有核心文件存在"
echo ""

echo "=========================================="
echo "  ✓ Electron 模式验证通过"
echo "=========================================="
echo ""
echo "提示：运行 'pnpm run dev' 启动 Electron 应用"
