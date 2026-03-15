import { expect, test, type Page } from "@playwright/test";

type ConfigDraft = Record<string, unknown>;

type ConfigUpdateRequest = {
  version?: string;
  config?: ConfigDraft;
  yaml_text?: string;
};

function createConfigResponse(version: string, config: ConfigDraft) {
  return {
    version,
    source_path: "/tmp/config.db",
    yaml_text: "title:\n  enabled: true\n",
    config,
  };
}

async function mockCommonConfigEndpoints(page: Page) {
  await page.route("**/api/config/schema", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sections: {},
        order: [],
      }),
    });
  });

  await page.route("**/api/config/runtime-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        process_name: "frontend-e2e",
        source_kind: "config_store",
        tools_count: 0,
        loaded_tools: [],
        runtime_processes: {},
        is_in_sync: true,
        warnings: [],
      }),
    });
  });
}

async function openSessionPolicySettings(page: Page) {
  await page.goto("/workspace/chats/new?settings=sessionPolicy");
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("FE-SET-201 设置页保存成功后状态收敛", async ({ page }) => {
  await mockCommonConfigEndpoints(page);

  let currentVersion = "v1";
  let currentConfig: ConfigDraft = { title: { enabled: true } };
  let putCalls = 0;
  let lastPutBody: ConfigUpdateRequest | null = null;

  await page.route("**/api/config", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createConfigResponse(currentVersion, currentConfig)),
      });
      return;
    }

    if (method === "PUT") {
      putCalls += 1;
      const requestBody = route.request().postDataJSON() as ConfigUpdateRequest;
      lastPutBody = requestBody;
      currentVersion = "v2";
      currentConfig = requestBody.config ?? {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...createConfigResponse(currentVersion, currentConfig),
          warnings: [],
        }),
      });
      return;
    }

    await route.continue();
  });

  await openSessionPolicySettings(page);

  const dialog = page.getByRole("dialog");
  const titleSwitch = dialog.getByRole("switch").first();
  const saveButton = dialog.getByRole("button", { name: /^(保存|Save)$/ }).first();

  await expect(titleSwitch).toHaveAttribute("aria-checked", "true");
  await titleSwitch.click();
  await expect(titleSwitch).toHaveAttribute("aria-checked", "false");
  await expect(saveButton).toBeEnabled();

  await saveButton.click();

  await expect.poll(() => putCalls).toBe(1);
  await expect(saveButton).toBeDisabled();
  await expect(titleSwitch).toHaveAttribute("aria-checked", "false");
  const savedBody = lastPutBody as ConfigUpdateRequest | null;
  expect(savedBody?.version).toBe("v1");
  expect(
    (savedBody?.config as { title?: { enabled?: boolean } })?.title?.enabled,
  ).toBe(false);
});

test("FE-SET-202 设置保存遇到 409 时回读服务端配置", async ({ page }) => {
  await mockCommonConfigEndpoints(page);

  let getConfigCalls = 0;
  let putCalls = 0;

  await page.route("**/api/config", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      getConfigCalls += 1;
      const serverConfig = getConfigCalls === 1
        ? createConfigResponse("v1", { title: { enabled: true } })
        : createConfigResponse("v2", { title: { enabled: true }, suggestions: { model_name: "server-model" } });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(serverConfig),
      });
      return;
    }

    if (method === "PUT") {
      putCalls += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            message: "version conflict",
            current_version: "v2",
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  await openSessionPolicySettings(page);

  const dialog = page.getByRole("dialog");
  const titleSwitch = dialog.getByRole("switch").first();
  const saveButton = dialog.getByRole("button", { name: /^(保存|Save)$/ }).first();

  await expect(titleSwitch).toHaveAttribute("aria-checked", "true");
  await titleSwitch.click();
  await expect(titleSwitch).toHaveAttribute("aria-checked", "false");

  await saveButton.click();

  await expect.poll(() => putCalls).toBe(1);
  await expect.poll(() => getConfigCalls).toBeGreaterThanOrEqual(2);
  await expect(titleSwitch).toHaveAttribute("aria-checked", "true");
  await expect(saveButton).toBeDisabled();
});

test("FE-SET-203 设置保存失败时保留脏状态并允许重试", async ({ page }) => {
  await mockCommonConfigEndpoints(page);

  let putCalls = 0;

  await page.route("**/api/config", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createConfigResponse("v1", { title: { enabled: true } })),
      });
      return;
    }

    if (method === "PUT") {
      putCalls += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            message: "internal error",
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  await openSessionPolicySettings(page);

  const dialog = page.getByRole("dialog");
  const titleSwitch = dialog.getByRole("switch").first();
  const saveButton = dialog.getByRole("button", { name: /^(保存|Save)$/ }).first();

  await titleSwitch.click();
  await expect(titleSwitch).toHaveAttribute("aria-checked", "false");
  await expect(saveButton).toBeEnabled();

  await saveButton.click();
  await expect.poll(() => putCalls).toBe(1);
  await expect(saveButton).toBeEnabled();
  await expect(titleSwitch).toHaveAttribute("aria-checked", "false");

  await saveButton.click();
  await expect.poll(() => putCalls).toBe(2);
  await expect(saveButton).toBeEnabled();
});
