import { expect, test } from "@playwright/test";
import { assertOffline, installOfflineGuard } from "./helpers";

test("Tauri IPC 契约下可走通体系导出与导入前端路径", async ({ page }) => {
  await page.addInitScript(() => {
    type Invocation = { command: string; args: Record<string, unknown> };
    type Canonical = Record<string, unknown>;
    const state: { calls: Invocation[]; canonical?: Canonical } = { calls: [] };
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
            state.canonical = structuredClone(args.system as Canonical);
            return JSON.stringify({ format: "zyslineup", checksumSha256: "mock-checksum", payload: state.canonical });
          }
          if (command === "pick_write_interchange") return true;
          if (command === "pick_read_interchange") return JSON.stringify({ format: "zyslineup", checksumSha256: "mock-checksum" });
          if (command === "import_systems") {
            if (!state.canonical) throw new Error("export_system must run before import_systems in this contract test");
            return [{ ...structuredClone(state.canonical), id: "imported-system", name: "已导入 E2E 体系" }];
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
