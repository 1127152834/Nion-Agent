import { expect, test } from "@playwright/test";

test("FE-SYNC-202 聊天列表页搜索过滤与线程列表一致", async ({ page }) => {
  await page.route("**/threads/search**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          thread_id: "thread-alpha",
          updated_at: "2026-03-10T12:00:00Z",
          values: {
            title: "Alpha roadmap",
            messages: [{ type: "human", content: "hello" }],
          },
        },
        {
          thread_id: "thread-beta",
          updated_at: "2026-03-11T12:00:00Z",
          values: {
            title: "Beta release",
            messages: [{ type: "human", content: "world" }],
          },
        },
      ]),
    });
  });

  await page.goto("/workspace/chats");
  const searchbox = page.getByRole("searchbox");
  await expect(searchbox).toBeVisible();

  const alphaResultLink = page.getByRole("link", { name: /Alpha roadmap .*ago/i });
  const betaResultLink = page.getByRole("link", { name: /Beta release .*ago/i });
  await expect(alphaResultLink).toBeVisible();
  await expect(betaResultLink).toBeVisible();

  await searchbox.fill("beta");
  await expect(betaResultLink).toBeVisible();
  await expect(alphaResultLink).toHaveCount(0);
});
