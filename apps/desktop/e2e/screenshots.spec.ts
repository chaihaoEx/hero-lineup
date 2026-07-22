import { expect, test } from "@playwright/test";
import path from "node:path";
import { assertOffline, installOfflineGuard } from "./helpers";

const outputDirectory = path.resolve(import.meta.dirname, "../../../reference/screenshots");
const sizes = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "narrow-390x844", width: 390, height: 844 },
];

for (const size of sizes) {
  test(`生成 ${size.name} 离线界面验收截图`, async ({ page }) => {
    const remoteRequests = await installOfflineGuard(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.screenshot({
      path: path.join(outputDirectory, `local-${size.name}.png`),
      fullPage: true,
    });
    await assertOffline(remoteRequests);
  });
}

test("生成 Retina 2x 离线界面验收截图", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const remoteRequests = await installOfflineGuard(page);
  await page.goto("http://127.0.0.1:1420/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.screenshot({
    path: path.join(outputDirectory, "local-retina-1440x900@2x.png"),
    fullPage: true,
  });
  await assertOffline(remoteRequests);
  await context.close();
});

test("生成线上同款配装交互验收截图", async ({ page }) => {
  const remoteRequests = await installOfflineGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "添加英雄" }).click();
  await page.locator(".class-picker-grid button").first().click();
  await page.getByRole("button", { name: /空白模板/ }).click();
  await page.getByRole("button", { name: "配装", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /骑士1/ })).toBeVisible();
  await page.screenshot({ path: path.join(outputDirectory, "local-equipment-overview-1440x900.png") });
  await page.getByRole("button", { name: "武器装备槽" }).click();
  await expect(page.getByRole("dialog", { name: /装备选择 - 1/ })).toBeVisible();
  await page.screenshot({ path: path.join(outputDirectory, "local-equipment-picker-1440x900.png") });
  await page.getByRole("dialog", { name: /装备选择 - 1/ }).getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "技能槽 1 未选择" }).click();
  await expect(page.getByRole("dialog", { name: "选择技能" })).toBeVisible();
  await page.screenshot({ path: path.join(outputDirectory, "local-skill-picker-1440x900.png") });
  await assertOffline(remoteRequests);
});

test("生成体系创建与本地收藏验收截图", async ({ page }) => {
  const remoteRequests = await installOfflineGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "新增体系" }).click();
  await expect(page.getByRole("dialog", { name: "新增体系" })).toBeVisible();
  await page.screenshot({ path: path.join(outputDirectory, "local-system-create-1440x900.png") });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "本地收藏" }).click();
  await expect(page.getByLabel("搜索本地收藏")).toBeVisible();
  await page.screenshot({ path: path.join(outputDirectory, "local-collection-1440x900.png") });
  await assertOffline(remoteRequests);
});

test("生成冒险任务卡与强化道具弹窗验收截图", async ({ page }) => {
  const remoteRequests = await installOfflineGuard(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "创建第一个分组" }).click();
  await expect(page.locator(".task-card")).toBeVisible();
  await page.locator("#adventures-section").screenshot({ path: path.join(outputDirectory, "local-adventure-card-1440x900.png") });
  await page.getByRole("button", { name: "强化道具：无" }).click();
  await expect(page.getByRole("dialog", { name: "冒险强化道具" })).toBeVisible();
  await page.screenshot({ path: path.join(outputDirectory, "local-booster-picker-1440x900.png") });
  await assertOffline(remoteRequests);
});
