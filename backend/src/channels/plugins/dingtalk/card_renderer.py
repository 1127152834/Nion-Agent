from __future__ import annotations

from typing import Any


class DingTalkPairingCardRenderer:
    def build_pairing_prompt(
        self,
        *,
        request: dict[str, Any],
        reused: bool,
        invalid_pair_code: bool,
    ) -> str:
        code = str(request.get("code") or "").strip()
        header = "已收到你的消息，正在等待本地端审批授权。"
        if invalid_pair_code:
            header = "检测到配对码无效或过期，已自动创建新的审批申请。"
        elif reused:
            header = "检测到你已有待审批申请，已为你复用原申请。"

        lines = [
            "### Nion 授权中",
            "",
            header,
            "",
            "请在 Nion 桌面端进入：设置 → 渠道 → 钉钉，点击【批准】完成授权。",
            "",
        ]
        if code:
            lines.extend([
                f"申请标识：`{code}`",
                "",
            ])
        lines.append("授权成功后，你可以直接继续聊天，无需再次配对。")
        return "\n".join(lines)

    def build_pairing_approved_notice(self, workspace_label: str | None) -> str:
        normalized = (workspace_label or "").strip()
        if normalized:
            return (
                "配对成功，已授权接入 Nion。\n"
                f"当前绑定工作空间：{normalized}\n"
                "现在可以直接发送消息开始聊天。"
            )
        return "配对成功，已授权接入 Nion。现在可以直接发送消息开始聊天。"
