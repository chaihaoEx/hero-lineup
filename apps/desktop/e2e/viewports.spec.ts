import { expect, test } from "@playwright/test";
import { assertOffline, installOfflineGuard } from "./helpers";

const viewports = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "compact-1024", width: 1024, height: 768 },
  { name: "narrow-390", width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`${viewport.name} 基本界面可渲染并可操作`, async ({ page }) => {
    const remoteRequests = await installOfflineGuard(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: "英雄体系搭配平台" })).toBeVisible();
    await expect(page.locator(".online-content")).toBeVisible();
    await expect(page.locator(".online-system-card.active > strong")).toBeVisible();
    await expect(page.getByRole("button", { name: /冒险任务/ })).toBeVisible();

    const dimensions = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth }));
    if (dimensions.contentWidth > dimensions.width) {
      test.info().annotations.push({
        type: "layout-observation",
        description: `${viewport.name} 使用应用当前的最小宽度布局，内容宽 ${dimensions.contentWidth}px、视口宽 ${dimensions.width}px。`,
      });
    }
    await assertOffline(remoteRequests);
  });
}

test("渲染后的 DOM 不包含远程资源地址", async ({ page }) => {
  const remoteRequests = await installOfflineGuard(page);
  await page.goto("/");
  await expect(page.locator(".online-system-card.active > strong")).toBeVisible();
  const remoteDomUrls = await page.locator("[src], [href]").evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute("src") ?? node.getAttribute("href") ?? "")
    .filter((value) => /^https?:\/\//.test(value)));
  expect(remoteDomUrls).toEqual([]);
  await assertOffline(remoteRequests);
});

test("体系卡与成员目录沿用线上响应式列数", async ({ page }) => {
  const remoteRequests = await installOfflineGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "添加分组" }).click();
  await page.locator(".task-card").first().getByRole("button", { name: "添加成员" }).click();
  const memberPicker = page.getByRole("dialog", { name: "选择成员添加到任务" });
  const samples = [
    { width: 390, system: 2, member: 4 },
    { width: 768, system: 3, member: 4 },
    { width: 1024, system: 4, member: 5 },
    { width: 1280, system: 4, member: 6 },
  ];
  for (const sample of samples) {
    await page.setViewportSize({ width: sample.width, height: 900 });
    await expect.poll(() => page.locator(".system-card-list").evaluate((grid) =>
      getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    )).toBe(sample.system);
    await expect.poll(() => memberPicker.locator(".member-picker-grid").evaluate((grid) =>
      getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    )).toBe(sample.member);
  }
  await assertOffline(remoteRequests);
});

test("地图和难度目录沿用线上响应式列数", async ({ page }) => {
  const remoteRequests = await installOfflineGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /冒险任务/ }).click();
  await page.getByRole("button", { name: "添加分组" }).click();
  await page.locator(".task-card").first().getByRole("button", { name: /切换地图/ }).click();
  const picker = page.getByRole("dialog", { name: "选择冒险任务" });
  const mapColumns = [
    { width: 390, expected: 4 },
    { width: 640, expected: 6 },
    { width: 768, expected: 6 },
    { width: 1024, expected: 8 },
    { width: 1280, expected: 10 },
  ];
  for (const sample of mapColumns) {
    await page.setViewportSize({ width: sample.width, height: 900 });
    await expect.poll(() => picker.locator(".quest-map-grid").evaluate((grid) =>
      getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    )).toBe(sample.expected);
  }

  await picker.locator(".quest-map-grid button").first().click();
  const difficultyColumns = [
    { width: 390, expected: 4 },
    { width: 640, expected: 6 },
    { width: 768, expected: 8 },
    { width: 1024, expected: 12 },
    { width: 1280, expected: 12 },
  ];
  for (const sample of difficultyColumns) {
    await page.setViewportSize({ width: sample.width, height: 900 });
    await expect.poll(() => picker.locator(".quest-difficulty-grid").evaluate((grid) =>
      getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    )).toBe(sample.expected);
  }
  await assertOffline(remoteRequests);
});
