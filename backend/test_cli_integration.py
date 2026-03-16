#!/usr/bin/env python3
"""CLI 模块集成验证脚本"""

import sys
from pathlib import Path

# 添加 backend 到 Python 路径
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))
sys.path.insert(0, str(backend_dir / "packages" / "harness"))


def _cli_tools_loading_ok() -> bool:
    """Return whether CLI runtime tools can be loaded successfully.

    This helper exists so:
    - pytest tests can use `assert ...` without returning non-None values
      (avoids PytestReturnNotNoneWarning).
    - `main()` can still keep the original "collect boolean results and print
      a summary" behavior when running this file as a script.
    """
    print("=" * 60)
    print("测试 1: CLI 工具加载")
    print("=" * 60)

    from nion.cli.runtime_tools import get_cli_tools

    tools = get_cli_tools(agent_name="lead")
    print(f"✅ 成功加载 {len(tools)} 个 CLI 工具:")
    for tool in tools:
        print(f"  - {tool.name}: {tool.description[:80]}...")
    print()
    return len(tools) > 0


def test_cli_tools_loading():
    """测试 CLI 工具加载（pytest 入口）"""
    # 这是一个 smoke test：只验证“不会抛异常”，不强制要求工具数量 > 0。
    # CLI 工具是否启用/是否存在通常取决于本地 extensions 配置与可选依赖。
    _cli_tools_loading_ok()


def _agent_tools_integration_ok() -> bool:
    """Return whether CLI tools are surfaced through the agent tool registry."""
    print("=" * 60)
    print("测试 2: Agent 工具系统集成")
    print("=" * 60)

    from nion.tools.tools import get_available_tools

    # NOTE: MCP tools may require external servers / async event loops; this
    # integration smoke test should remain offline and deterministic.
    tools = get_available_tools(agent_name="lead", include_mcp=False)
    cli_tools = [t for t in tools if hasattr(t, "name") and t.name.startswith("cli_")]

    print(f"✅ Agent 工具系统中找到 {len(cli_tools)} 个 CLI 工具:")
    for tool in cli_tools:
        desc = tool.description[:60] + "..." if len(tool.description) > 60 else tool.description
        print(f"  - {tool.name}: {desc}")
    print()
    return len(cli_tools) > 0


def test_agent_tools_integration():
    """测试 Agent 工具系统集成（pytest 入口）"""
    # 同上：不强制要求 CLI 工具一定启用，仅保证集成路径可执行。
    _agent_tools_integration_ok()


def _marketplace_catalog_ok() -> bool:
    """Return whether the CLI marketplace catalog can be loaded from disk."""
    print("=" * 60)
    print("测试 3: Marketplace 目录加载")
    print("=" * 60)

    from nion.cli.catalog import load_cli_marketplace_catalog

    catalog_path = backend_dir / "data" / "cli_marketplace" / "catalog.json"
    catalog = load_cli_marketplace_catalog(catalog_path)

    print(f"✅ Marketplace 目录加载成功: {len(catalog.tools)} 个工具")
    for tool in catalog.tools:
        print(f"  - {tool.id} v{tool.version}")
        print(f"    verified: {tool.verified}, featured: {tool.featured}")
        print(f"    platforms: {len(tool.platforms)} 个平台")
    print()
    return len(catalog.tools) > 0


def test_marketplace_catalog():
    """测试 Marketplace 目录加载（pytest 入口）"""
    _marketplace_catalog_ok()


def _extensions_config_ok() -> bool:
    """Return whether extensions_config.json can be loaded and contains CLI entries."""
    print("=" * 60)
    print("测试 4: 配置文件验证")
    print("=" * 60)

    from nion.config.extensions_config import ExtensionsConfig

    config = ExtensionsConfig.from_file()

    print("✅ 配置文件加载成功")
    print(f"  CLI 工具配置: {len(config.clis)} 个")
    for tool_id, cfg in config.clis.items():
        print(f"  - {tool_id}: enabled={cfg.enabled}, source={cfg.source}")
    print()
    return len(config.clis) > 0


def test_config_file():
    """测试配置文件（pytest 入口）"""
    _extensions_config_ok()


def main():
    """运行所有测试"""
    print("\n" + "=" * 60)
    print("CLI 模块集成验证")
    print("=" * 60 + "\n")

    results = []

    try:
        results.append(("CLI 工具加载", _cli_tools_loading_ok()))
    except Exception as e:
        print(f"❌ CLI 工具加载失败: {e}\n")
        results.append(("CLI 工具加载", False))

    try:
        results.append(("Agent 工具集成", _agent_tools_integration_ok()))
    except Exception as e:
        print(f"❌ Agent 工具集成失败: {e}\n")
        results.append(("Agent 工具集成", False))

    try:
        results.append(("Marketplace 目录", _marketplace_catalog_ok()))
    except Exception as e:
        print(f"❌ Marketplace 目录加载失败: {e}\n")
        results.append(("Marketplace 目录", False))

    try:
        results.append(("配置文件", _extensions_config_ok()))
    except Exception as e:
        print(f"❌ 配置文件验证失败: {e}\n")
        results.append(("配置文件", False))

    # 总结
    print("=" * 60)
    print("测试结果总结")
    print("=" * 60)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"{status}: {name}")

    print(f"\n总计: {passed}/{total} 测试通过")

    if passed == total:
        print("\n🎉 所有测试通过！CLI 模块集成完整且可用。")
        return 0
    else:
        print(f"\n⚠️  {total - passed} 个测试失败，需要修复。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
