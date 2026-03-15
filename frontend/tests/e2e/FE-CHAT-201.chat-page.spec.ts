import { expect, test } from "@playwright/test";

test("FE-CHAT-201 聊天页面可加载并输入消息草稿", async ({ page }) => {
  await page.goto("/workspace/chats/new");
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();
  await input.fill("draft from playwright");
  await expect(input).toHaveValue("draft from playwright");
});
