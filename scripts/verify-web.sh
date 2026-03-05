#!/bin/bash
# Web 模式验证脚本

set -e

echo "=========================================="
echo "  Web 模式验证"
echo "=========================================="
echo ""

# 1. 检查前端依赖
echo "1. 检查前端依赖..."
cd frontend
if [ ! -d "node_modules" ]; then
  echo "  ✗ 前端依赖未安装，运行: pnpm install"
  exit 1
fi
echo "  ✓ 前端依赖已安装"
echo ""

# 2. 检查后端依赖
echo "2. 检查后端依赖..."
cd ../backend
if [ ! -d ".venv" ]; then
  echo "  ✗ 后端依赖未安装，运行: uv sync"
  exit 1
fi
echo "  ✓ 后端依赖已安装"
echo ""

# 3. 检查配置文件
echo "3. 检查配置文件..."
cd ..
if [ ! -f "config.yaml" ]; then
  echo "  ✗ config.yaml 不存在"
  exit 1
fi
echo "  ✓ 配置文件存在"
echo ""

echo "=========================================="
echo "  ✓ Web 模式验证通过"
echo "=========================================="
echo ""
echo "提示：运行 'make dev' 启动 Web 服务"
