import { expect, test } from "@playwright/test";
import { assertOffline, openPreview } from "./helpers";

test.describe("浏览器预览中的主要离线工作流", () => {
  test("体系新建、保存、重载、复制与删除", async ({ page }) => {
    const remoteRequests = await openPreview(page);

    await page.getByRole("button", { name: "新增体系" }).click();
    await expect(page.getByRole("dialog", { name: "新增体系" })).toBeVisible();
    await page.getByLabel("新体系名称").fill("E2E 离线体系");
    await page.getByRole("button", { name: "创建", exact: true }).click();
    await expect(page.locator(".online-system-card.active > strong")).toHaveText("E2E 离线体系");
    await page.getByRole("button", { name: /保存当前体系/ }).click();
    await expect(page.getByRole("button", { name: "当前体系已保存" })).toBeVisible();

    await page.reload();
    await expect(page.locator(".online-system-card.active > strong")).toHaveText("E2E 离线体系");
    await page.locator(".local-maintenance summary").click();
    await page.getByRole("button", { name: "复制当前" }).click();
    await expect(page.locator(".online-system-card.active > strong")).toHaveText("E2E 离线体系（副本）");
    await page.getByRole("button", { name: /保存当前体系/ }).click();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "删除当前" }).click();
    await expect(page.locator(".online-system-card.active > strong")).toHaveText("E2E 离线体系");
    await assertOffline(remoteRequests);
  });

  test("英雄与勇士配装可以编辑并随当前体系保留", async ({ page }) => {
    const remoteRequests = await openPreview(page);

    await page.getByRole("button", { name: "添加英雄" }).click();
    await page.locator(".class-picker-grid button").first().click();
    await page.getByRole("button", { name: /空白模板/ }).click();
    await expect(page.locator(".unit-card")).toHaveCount(1);

    await page.locator(".unit-card").first().getByRole("button", { name: "配装" }).click();
    await page.getByTitle("点击改名").click();
    await page.getByLabel("英雄名称").fill("E2E 骑士");
    await page.getByLabel("英雄名称").press("Enter");
    await page.getByRole("button", { name: "武器装备槽" }).click();
    await page.getByRole("button", { name: "传奇", exact: true }).click();
    await page.getByRole("button", { name: "武器超越" }).click();
    await page.getByRole("button", { name: /T1 学徒短剑/ }).click();
    await page.getByRole("button", { name: /T4 .*余烬元素/ }).click();
    await page.getByRole("button", { name: /T14 比蒙精魂/ }).click();
    await page.getByRole("button", { name: "完成选择" }).click();
    await expect(page.getByLabel("自带技能 堡垒")).toBeVisible();
    await page.getByRole("button", { name: "技能 未选择" }).first().click();
    await page.getByRole("button", { name: "选择技能 裂痕" }).click();
    await expect(page.getByRole("button", { name: "技能 裂痕" })).toBeVisible();
    await expect(page.getByText("修改已实时同步到当前体系")).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(page.locator(".unit-card").filter({ hasText: "E2E 骑士" })).toContainText("E2E 骑士");
    await expect(page.getByTitle("学徒短剑")).toBeVisible();

    await page.getByRole("button", { name: /勇士阵容/ }).click();
    const champion = page.locator(".champion-card").first();
    await champion.getByRole("button", { name: /勇士配装/ }).click();
    await page.getByRole("button", { name: "勇士等级" }).click();
    await page.getByRole("option", { name: "45" }).click();
    await page.getByRole("button", { name: "勇士阶数" }).click();
    await page.getByRole("option", { name: "11+1", exact: true }).click();
    await expect(page.getByRole("button", { name: "使魔装备槽" })).toBeVisible();
    await expect(page.getByRole("button", { name: "光环装备槽" })).toBeVisible();
    await expect(page.getByText("修改已实时同步到当前体系")).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(champion.getByTitle(/Lv\.45 · Rank 12/)).toBeVisible();
    await assertOffline(remoteRequests);
  });

  test("英雄拖放载荷可以加入任务，固定 10000 次模拟展示进度和线上同款结果", async ({ page }) => {
    const remoteRequests = await openPreview(page);

    await page.getByRole("button", { name: "添加英雄" }).click();
    await page.locator(".class-picker-grid button").first().click();
    await page.getByRole("button", { name: /空白模板/ }).click();
    await page.getByRole("button", { name: /保存当前体系/ }).click();
    const secondHero = await page.evaluate(() => {
      const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1") ?? "[]") as Array<{ heroes: Array<{ id: string; name: string }> }>;
      return systems[0]?.heroes[0];
    });
    expect(secondHero).toBeTruthy();

    await page.getByRole("button", { name: /冒险任务/ }).click();
    await page.getByRole("button", { name: "创建第一个分组" }).click();
    const task = page.locator(".task-card").first();
    const transfer = await page.evaluateHandle(({ id }) => {
      const data = new DataTransfer();
      data.setData("application/x-zys-unit", id);
      return data;
    }, secondHero);
    await task.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(task.getByText(secondHero.name, { exact: true })).toBeVisible();
    await expect(task.getByTitle(`移除 ${secondHero.name}`)).toBeVisible();

    await task.getByRole("button", { name: "测试冒险" }).click();
    await expect(task.getByText(/模拟中 \d+%/)).toBeVisible();
    await expect(task.getByText("成功率: 87.400%")).toBeVisible();

    await task.getByRole("button", { name: "测试冒险" }).click();
    await expect(task.getByText(/模拟中 \d+%/)).toBeVisible();
    await expect(task.getByText("成功率: 87.400%")).toBeVisible();
    await task.getByRole("button", { name: "查看详情" }).click();
    await expect(task.getByText("browser-preview")).toBeVisible();
    await assertOffline(remoteRequests);
  });

  test("导入与导出入口在浏览器预览中明确停在桌面原生边界", async ({ page }) => {
    const remoteRequests = await openPreview(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: "sample.zyslineup",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"zyslineup","schemaVersion":1}'),
    });
    await expect(page.getByText("规范校验与持久化导入仅在桌面应用中可用")).toBeVisible();

    const exportError = page.waitForEvent("pageerror");
    await page.locator(".local-maintenance summary").click();
    await page.getByRole("button", { name: "导出体系" }).click();
    await expect(exportError).resolves.toHaveProperty("message", "规范校验与 checksum 导出仅在桌面应用中可用");
    test.info().annotations.push({
      type: "native-boundary",
      description: "浏览器 E2E 只证明导入/导出入口与原生边界；文件对话框、checksum、SQLite 和原子写入需 Tauri 集成测试证明。",
    });
    await assertOffline(remoteRequests);
  });
});
