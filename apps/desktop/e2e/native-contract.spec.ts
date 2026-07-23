import { expect, test } from "@playwright/test";
import { assertOffline, installOfflineGuard } from "./helpers";

test("Tauri IPC 契约下可走通体系导出与导入前端路径", async ({ page }) => {
  await page.addInitScript(() => {
    type Invocation = { command: string; args: Record<string, unknown> };
    type Canonical = Record<string, unknown>;
    const state: { calls: Invocation[]; canonical?: Canonical; mode?: "cancel-export" | "fail-export" | "cancel-import" | "version-conflict" | "cancel-data" | "fail-data" } = { calls: [] };
    Object.assign(window, { __E2E_TAURI_STATE__: state });
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        // The real Tauri invoke API is asynchronous; this deterministic mock
        // resolves synchronously inside its async boundary for stable tests.
        // eslint-disable-next-line @typescript-eslint/require-await
        invoke: async (command: string, args: Record<string, unknown> = {}) => {
          state.calls.push({ command, args });
          if (command === "load_catalog") return {
            schemaVersion: 1,
            gameDataVersion: "e2e-native-contract",
            assetVersion: "e2e-native-contract",
            classes: [{
              id: "knight", name: "骑士", type: "fighter", innateSkillFamily: "c_knight", skillSlots: 3, element: "光", color: "#f4b942",
              slots: [["ws"], ["ah"], ["gh"], ["hh"], ["bh"], ["xs"]],
              stats: { attack: 840, defense: 620, health: 4200, evasion: 10, crit: 15 },
            }],
            champions: [],
            quests: [],
            items: [],
            skills: [],
            counts: { classes: 1, champions: 0, quests: 0, items: 0, skills: 0, sprites: 0 },
          };
          if (command === "list_systems") return [];
          if (command === "list_templates") return [];
          if (command === "save_system") {
            state.canonical = structuredClone(args.system as Canonical);
            return state.canonical;
          }
          if (command === "export_system") {
            if (state.mode === "fail-export") throw new Error("无法写入目标磁盘");
            state.canonical = structuredClone(args.system as Canonical);
            return JSON.stringify({ format: "zyslineup", checksumSha256: "mock-checksum", payload: state.canonical });
          }
          if (command === "pick_write_interchange") return state.mode !== "cancel-export";
          if (command === "pick_read_interchange") {
            if (state.mode === "cancel-import") return null;
            return JSON.stringify({ format: "zyslineup", checksumSha256: "mock-checksum" });
          }
          if (command === "import_systems") {
            if (state.mode === "version-conflict") throw new Error("数据版本不兼容：web-snapshot-old");
            if (!state.canonical) throw new Error("export_system must run before import_systems in this contract test");
            return [{ ...structuredClone(state.canonical), id: "imported-system", name: "已导入 E2E 体系" }];
          }
          if (command === "pick_install_data_package") {
            if (state.mode === "cancel-data") return null;
            if (state.mode === "fail-data") throw new Error("数据包校验失败，原数据未改变");
            throw new Error("data package mode was not configured");
          }
          throw new Error(`Unexpected Tauri command: ${command}`);
        },
      },
    });
  });

  const remoteRequests = await installOfflineGuard(page);
  await page.goto("/");
  await expect(page.locator(".online-system-card.active > strong")).toHaveText("默认体系");

  await page.getByRole("button", { name: /保存当前体系/ }).click();
  await page.locator(".local-maintenance summary").click();
  await page.getByRole("button", { name: "导出体系" }).click();
  await expect(page.getByText("体系已导出为跨平台文件")).toBeVisible();
  await page.getByRole("button", { name: "导入体系" }).click();
  await expect(page.locator(".online-system-card.active > strong")).toHaveText("已导入 E2E 体系");
  await expect(page.getByText("已导入并保存 1 个体系")).toBeVisible();
  await page.locator(".toast").click();

  const setMode = async (mode: "cancel-export" | "fail-export" | "cancel-import" | "version-conflict" | "cancel-data" | "fail-data" | null) => {
    await page.evaluate((nextMode) => {
      const state = (window as unknown as { __E2E_TAURI_STATE__: { mode?: string } }).__E2E_TAURI_STATE__;
      if (nextMode) state.mode = nextMode;
      else delete state.mode;
    }, mode);
  };

  await setMode("cancel-export");
  await page.getByRole("button", { name: "导出体系" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);

  await setMode("fail-export");
  await page.getByRole("button", { name: "导出体系" }).click();
  await expect(page.getByText("无法写入目标磁盘")).toBeVisible();
  await page.locator(".toast").click();

  const cardsBeforeCancelledImport = await page.locator(".online-system-card").count();
  await setMode("cancel-import");
  await page.getByRole("button", { name: "导入体系" }).click();
  await expect(page.locator(".online-system-card")).toHaveCount(cardsBeforeCancelledImport);
  await expect(page.locator(".toast")).toHaveCount(0);

  await setMode("version-conflict");
  await page.getByRole("button", { name: "导入体系" }).click();
  await expect(page.getByText("数据版本不兼容：web-snapshot-old")).toBeVisible();
  await expect(page.locator(".online-system-card")).toHaveCount(cardsBeforeCancelledImport);
  await page.locator(".toast").click();

  await setMode("cancel-data");
  await page.getByRole("button", { name: "更新本地数据" }).click();
  await expect(page.locator(".toast")).toHaveCount(0);

  await setMode("fail-data");
  await page.getByRole("button", { name: "更新本地数据" }).click();
  await expect(page.getByText("数据包校验失败，原数据未改变")).toBeVisible();

  const calls = await page.evaluate(() => (window as unknown as {
    __E2E_TAURI_STATE__: { calls: Array<{ command: string; args: Record<string, unknown> }> };
  }).__E2E_TAURI_STATE__.calls);
  expect(calls.map(({ command }) => command)).toEqual(expect.arrayContaining([
    "load_catalog", "list_systems", "save_system", "export_system",
    "pick_write_interchange", "pick_read_interchange", "import_systems",
  ]));
  expect(calls.find(({ command }) => command === "pick_write_interchange")?.args).toMatchObject({
    extension: "zyslineup",
    suggestedName: "默认体系",
  });
  expect(calls.find(({ command }) => command === "import_systems")?.args).toMatchObject({
    expectedGameDataVersion: "e2e-native-contract",
  });
  test.info().annotations.push({
    type: "contract-mock",
    description: "该测试证明 WebView→Tauri IPC 参数及 UI 状态流，不证明 Rust 命令、系统文件对话框、checksum 或 SQLite 的真实实现。",
  });
  await assertOffline(remoteRequests);
});
