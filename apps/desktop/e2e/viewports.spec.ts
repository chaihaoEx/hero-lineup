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
