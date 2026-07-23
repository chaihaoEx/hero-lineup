import { makeDefaultSystem, makeHero, previewCatalog } from "../src/data/catalog";
import {
  decodeClipboard, encodeClipboard, exportLineupPng, exportSimulationPng,
} from "../src/utils/localTransfer";

describe("local clipboard and PNG transfer", () => {
  afterEach(() => vi.restoreAllMocks());

  const filledSystem = () => {
    const system = makeDefaultSystem(previewCatalog);
    const hero = makeHero(previewCatalog, "knight", 1);
    const quest = previewCatalog.quests[0]!;
    system.heroes = [hero];
    system.taskGroups = [{ id: crypto.randomUUID(), name: "测试分组", tasks: [{ id: crypto.randomUUID(), questId: quest.id, name: quest.name, map: quest.mapName, difficulty: quest.difficulty, maxMembers: quest.maxMembers, memberIds: [hero.id], barrier: {}, config: { iterations: 1000, seed: 1, booster: false, elite: false, titanTower: false } }] }];
    return system;
  };

  it("rejects malformed six-slot hero data and duplicate task members", () => {
    const system = filledSystem();
    const heroEnvelope = JSON.parse(encodeClipboard("hero", system.heroes[0])) as { payload: { equipment: unknown[] } };
    heroEnvelope.payload.equipment.pop();
    expect(() => decodeClipboard(JSON.stringify(heroEnvelope), "hero")).toThrow("恰好包含六个装备槽");

    const task = system.taskGroups[0]!.tasks[0]!;
    task.memberIds.push(task.memberIds[0]!);
    expect(() => decodeClipboard(encodeClipboard("system", system), "system")).toThrow("不能重复上阵成员");
  });

  it("rejects a task containing more than one champion", () => {
    const system = filledSystem();
    system.championIds = ["argon", "other-champion"];
    system.taskGroups[0]!.tasks[0]!.memberIds = ["argon", "other-champion"];
    expect(() => decodeClipboard(encodeClipboard("system", system), "system")).toThrow("每个任务最多上阵 1 名勇士");
  });

  it("encodes lineup and simulation downloads as image/png files", async () => {
    const context = {
      fillStyle: "", font: "", fillRect: vi.fn(), fillText: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["png"], { type: "image/png" })));
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:offline-png") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function captureDownload(this: HTMLAnchorElement) { downloads.push(this.download); });

    const system = filledSystem();
    await exportLineupPng(system, system.heroes);
    const task = system.taskGroups[0]!.tasks[0]!;
    const result = {
      successRate: 88, averageTurns: 7, minTurns: 4, maxTurns: 12, survivalRate: 91,
      averageDamage: 1234, averageRemainingHealth: 567, simulatorVersion: "test-sim",
      gameDataVersion: system.gameDataVersion, completedAt: "2026-07-22T00:00:00Z",
    };
    await exportSimulationPng(task, result, system.heroes);

    expect(toBlob).toHaveBeenCalledTimes(2);
    expect(toBlob.mock.calls.every((call) => call[1] === "image/png")).toBe(true);
    expect(downloads).toEqual(["默认体系-阵容.png", `${task.name}-模拟结果.png`]);
  });
});
