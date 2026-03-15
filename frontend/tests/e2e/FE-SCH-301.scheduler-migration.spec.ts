import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page, type Route } from "@playwright/test";

const agentName = "Strategy Desk";

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function mockJson(body: unknown) {
  return async (route: Route) => {
    await fulfillJson(route, body);
  };
}

async function mockSchedulerNavigationApis(page: Page) {
  await page.route("**/api/scheduler/dashboard", mockJson({
    agent_count_with_tasks: 1,
    task_count: 2,
    success_rate_24h: 0.92,
    failed_task_count_24h: 1,
    agents: [
      {
        agent_name: agentName,
        task_count: 2,
        success_rate_24h: 0.92,
        failed_runs_24h: 1,
      },
    ],
  }));

  await page.route("**/api/default-agent/config", mockJson({
    name: "_default",
    description: "Default agent",
    model: "gpt-4.1",
    tool_groups: [],
    heartbeat_enabled: true,
    evolution_enabled: false,
    avatar_url: null,
  }));

  await page.route(`**/api/agents/${encodeURIComponent(agentName)}`, mockJson({
    name: agentName,
    description: "Deliver scheduled operating cadences and status summaries.",
    model: "gpt-4.1",
    tool_groups: ["research", "reporting"],
    heartbeat_enabled: true,
    evolution_enabled: false,
    avatar_url: null,
    soul: null,
  }));

  await page.route(`**/api/heartbeat/settings?agent_name=${encodeURIComponent(agentName)}`, mockJson({
    enabled: true,
    timezone: "Asia/Shanghai",
    templates: {},
  }));

  await page.route(`**/api/evolution/settings?agent_name=${encodeURIComponent(agentName)}`, mockJson({
    enabled: false,
    interval_hours: 24,
    auto_trigger: false,
  }));

  await page.route(`**/api/scheduler/tasks?agent_name=${encodeURIComponent(agentName)}`, mockJson([
    {
      id: "task-daily-report",
      agent_name: agentName,
      name: "Daily Ops Digest",
      description: "",
      mode: "workflow",
      trigger: {
        type: "cron",
        cron_expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
      },
      steps: [
        {
          id: "step-1",
          name: "default-step",
          agents: [
            {
              agent_name: agentName,
              prompt: "Summarize project health and blocked items.",
              timeout_seconds: 300,
              retry_on_failure: false,
              max_retries: 0,
            },
          ],
          parallel: false,
          depends_on: [],
        },
      ],
      max_concurrent_steps: 3,
      timeout_seconds: 3600,
      enabled: true,
      created_by: "workspace-user",
      created_at: "2026-03-12T01:00:00Z",
      last_run_at: "2026-03-13T01:00:00Z",
      next_run_at: "2026-03-14T01:00:00Z",
      status: "completed",
      last_result: null,
      last_error: null,
    },
  ]));

  await page.route("**/api/scheduler/tasks/*/history", mockJson([
    {
      run_id: "run-1",
      task_id: "task-daily-report",
      started_at: "2026-03-13T01:00:00Z",
      completed_at: "2026-03-13T01:00:30Z",
      status: "completed",
      success: true,
      result: null,
      error: null,
    },
  ]));
}

test("FE-SCH-301 prototype 长图可生成", async ({ page }) => {
  await page.goto("/prototypes/scheduler-migration");

  await expect(page.getByText(/调度看板|Scheduler dashboard/i).first()).toBeVisible();
  await expect(page.getByText(/任务名称|Task name/i).first()).toBeVisible();

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const screenshotPath = path.resolve(
    currentDir,
    "../../../reports/prototypes/scheduler-migration.png",
  );
  mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
});

test("FE-SCH-302 调度看板跳转到智能体设置 scheduler section", async ({ page }) => {
  await mockSchedulerNavigationApis(page);

  await page.goto("/workspace/scheduler");
  await page.getByRole("button", { name: /进入智能体定时任务|Open agent scheduler/i }).click();

  await expect(page).toHaveURL(
    new RegExp(`/workspace/agents/${encodeURIComponent(agentName)}/settings\\?section=scheduler`),
  );
  await expect(page.getByRole("button", { name: /新建任务|New task/i })).toBeVisible();
});
