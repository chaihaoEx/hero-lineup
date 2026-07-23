import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { makeDefaultSystem, makeHero, previewCatalog } from "../src/data/catalog";
import { decodeOnlineHeroConfig } from "../src/data/heroCreationTemplates";
import { desktopBridge } from "../src/platform/bridge";

beforeEach(() => {
  localStorage.clear();
  const system = makeDefaultSystem(previewCatalog);
  const hero = makeHero(previewCatalog, "knight", 1);
  const quest = previewCatalog.quests[0]!;
  system.heroes = [hero];
  system.taskGroups = [{ id: crypto.randomUUID(), name: "日常冒险", tasks: [{
    id: crypto.randomUUID(), questId: quest.id, name: quest.name, map: quest.mapName, difficulty: quest.difficulty,
    maxMembers: quest.maxMembers, memberIds: [hero.id], barrier: {},
    config: { iterations: 10000, seed: 20260722, booster: false, elite: false, titanTower: false },
  }] }];
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify([system]));
});
afterEach(() => vi.restoreAllMocks());

async function appReady() {
  await screen.findByText("默认体系", { selector: ".online-system-card > strong" });
}

test("creates and persists a local system", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "编辑" }));
  expect(screen.getByRole("dialog", { name: "编辑体系" })).toBeInTheDocument();
  expect(screen.getByLabelText("体系名称")).toHaveAttribute("maxlength", "40");
  expect(screen.getByLabelText("体系描述")).toHaveAttribute("maxlength", "200");
  await user.clear(screen.getByLabelText("体系名称"));
  await user.type(screen.getByLabelText("体系名称"), "离线测试阵容");
  await user.click(screen.getByRole("radio", { name: /私有/ }));
  await user.click(screen.getByRole("button", { name: /^保存$/ }));
  expect(document.querySelector(".online-system-card p")).toHaveTextContent("私有");
  await user.click(screen.getByRole("button", { name: /保存当前体系/ }));
  await waitFor(() => expect(localStorage.getItem("zys.hero-lineup.systems.v1")).toContain("离线测试阵容"));
});

test("creates a system through the same two-tab dialog flow as online", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "新增体系" }));
  expect(screen.getByRole("dialog", { name: "新增体系" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "创建新体系" })).toHaveClass("active");
  expect(screen.getByRole("button", { name: "口令导入" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("新体系名称"), "线上流程体系");
  await user.type(screen.getByLabelText("新体系描述"), "由创建弹窗生成");
  await user.click(screen.getByRole("radio", { name: /私有（仅当前/ }));
  await user.click(screen.getByRole("button", { name: /^创建$/ }));
  expect(screen.queryByRole("dialog", { name: "新增体系" })).not.toBeInTheDocument();
  expect(document.querySelector(".online-system-card.active > strong")).toHaveTextContent("线上流程体系");
  expect(document.querySelector(".online-system-card.active p")).toHaveTextContent("私有");
});

test("uses a public system from the offline collection as an editable private copy", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "本地收藏" }));
  expect(screen.getByLabelText("搜索本地收藏")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "使用体系" }));
  expect(document.querySelectorAll(".online-system-card")).toHaveLength(2);
  expect(document.querySelector(".online-system-card.active > strong")).toHaveTextContent("默认体系");
  expect(document.querySelector(".online-system-card.active p")).toHaveTextContent("私有");
});

test("adds a hero and edits equipment", async () => {
  const user = userEvent.setup();
  const calculateHero = desktopBridge.calculateHero.bind(desktopBridge);
  vi.spyOn(desktopBridge, "calculateHero").mockImplementation(async (hero) => {
    const result = await calculateHero(hero);
    return hero.equipment.some((entry) => entry.itemId)
      ? { ...result, stats: { ...result.stats, attack: 999 } }
      : result;
  });
  render(<App />);
  await screen.findByText(/英雄阵容/, { selector: "h2" });
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  expect(screen.getAllByRole("button", { name: "全部应用" })).toHaveLength(3);
  await screen.findByText("修改已实时同步到当前体系");
  expect(screen.getByText("999")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: /^关闭$/ }));
  expect(screen.getByTitle("学徒短剑")).toBeInTheDocument();
});

test("updates equipment catalog attributes immediately when Transcend is toggled", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  const shortSword = screen.getByRole("button", { name: /学徒短剑/ });
  expect(shortSword).toHaveTextContent("⚔ +16");
  await user.click(screen.getByRole("button", { name: "武器超越" }));
  expect(shortSword).toHaveTextContent("超越 ×1.1");
  expect(shortSword).toHaveTextContent("⚔ +20");
  expect(shortSword).toHaveTextContent("◆ +1");
});

test("matches online immediate equipment updates and reuses filters for an empty slot", async () => {
  const user = userEvent.setup();
  const calculate = vi.spyOn(desktopBridge, "calculateHero");
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await waitFor(() => expect(calculate).toHaveBeenCalled());
  calculate.mockClear();
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  await waitFor(() => expect(calculate).toHaveBeenCalled());
  expect(calculate.mock.calls.at(-1)?.[0].equipment[0]).toMatchObject({ itemId: "shortsword", transcendence: 0 });

  calculate.mockClear();
  await user.click(screen.getByRole("button", { name: "武器超越" }));
  await waitFor(() => expect(calculate).toHaveBeenCalled());
  expect(calculate.mock.calls.at(-1)?.[0].equipment[0]).toMatchObject({ itemId: "shortsword", transcendence: 1 });

  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: "身体装备槽" }));
  expect(screen.getByRole("button", { name: "身体超越" })).toHaveClass("active");
});

test("shows online affinity badges when the selected equipment matches both attachments", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  await user.click(screen.getByRole("button", { name: /余烬元素/ }));
  await user.click(screen.getByRole("button", { name: /比蒙精魂/ }));
  expect(screen.getAllByRole("button", { name: "全部应用" })).toHaveLength(5);
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  expect(screen.getByTitle("元素附魔获得 50% 亲和加成")).toHaveTextContent("元素亲和");
  expect(screen.getByTitle("精萃附魔获得 50% 亲和加成")).toHaveTextContent("精萃亲和");
});

test("clones the current hero and navigates circularly like the online editor", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  expect(screen.getByTitle("点击改名")).toHaveTextContent("骑士1");
  await user.click(screen.getByRole("button", { name: "克隆" }));
  await waitFor(() => expect(screen.getByTitle("点击改名")).toHaveTextContent("骑士2"));
  await user.click(screen.getByRole("button", { name: "上一个英雄" }));
  await waitFor(() => expect(screen.getByTitle("点击改名")).toHaveTextContent("骑士1"));
  await user.click(screen.getByRole("button", { name: "上一个英雄" }));
  await waitFor(() => expect(screen.getByTitle("点击改名")).toHaveTextContent("骑士2"));
  await user.click(screen.getByRole("button", { name: "下一个英雄" }));
  await waitFor(() => expect(screen.getByTitle("点击改名")).toHaveTextContent("骑士1"));
});

test("persists equipment and calculated attributes even when validation reports an error", async () => {
  const user = userEvent.setup();
  vi.spyOn(desktopBridge, "calculateHero").mockImplementation((hero) => Promise.resolve({
    stats: { health: 333, attack: hero.equipment.some((entry) => entry.itemId) ? 777 : 100, defense: 222, evasion: 4, critical: 5, criticalDamage: 2, aggro: 0, elementValue: 0 },
    issues: hero.equipment.some((entry) => entry.itemId)
      ? [{ severity: "error", code: "test_invalid", message: "测试校验提示", slot: "武器" }]
      : [],
    applied: {},
  }));
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  await screen.findByText(/修改已同步；存在未计入属性的无效配置/);
  expect(screen.getByText("777")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: /^关闭$/ }));
  expect(screen.getByTitle("学徒短剑")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "配装" }));
  expect(await screen.findByText("777")).toBeInTheDocument();
});

test("uses online hero skill unlock levels and discrete selectors", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "英雄等级" }));
  await user.click(screen.getByRole("option", { name: "1" }));
  expect(screen.getByRole("button", { name: /技能 5级解锁/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /技能 10级解锁/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /技能 23级解锁/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "收藏卡牌" }));
  const cardOptions = screen.getByRole("listbox", { name: "收藏卡牌选项" });
  expect([...cardOptions.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(["0", "1", "2", "3"]);
});

test("matches online skill replacement by hiding families used in other slots", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getAllByRole("button", { name: "技能 未选择" })[0]!);
  await user.click(screen.getByRole("button", { name: "选择技能 裂痕" }));

  await user.click(screen.getAllByRole("button", { name: "技能 未选择" })[0]!);
  expect(screen.queryByRole("button", { name: "选择技能 裂痕" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清空技能" })).not.toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);

  await user.click(screen.getByRole("button", { name: "技能 裂痕" }));
  expect(screen.getByRole("button", { name: "选择技能 裂痕" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "清空技能" })).not.toBeInTheDocument();
});

test("shows champion soul, full rank range, team skill and full equipment controls", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "勇士配装 阿尔贡" }));
  expect(screen.getByText(/固定团队技能/)).toBeInTheDocument();
  expect(screen.getByText("勇士之魂")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "勇士阶数" }));
  expect(screen.getByRole("option", { name: "11+60" })).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: "11+60" }));
  await user.click(screen.getByRole("button", { name: "使魔装备槽" }));
  expect(screen.getByRole("heading", { name: "装备选择 - 使魔" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "全部应用" })).not.toBeInTheDocument();
  expect(screen.getByText("星能铸造")).toBeInTheDocument();
  expect(screen.getByText("超越")).toBeInTheDocument();
  expect(screen.getByText("元素附魔")).toBeInTheDocument();
  expect(screen.getByText("精萃附魔")).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: "光环装备槽" }));
  expect(screen.getByRole("heading", { name: "装备选择 - 光环" })).toBeInTheDocument();
});

test("supports drag payload into an adventure task", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText(/英雄阵容/, { selector: "h2" });
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  const dropzone = document.querySelector<HTMLElement>(".task-card")!;
  const transfer = { getData: () => "missing-id", setData: () => {}, effectAllowed: "copy", dropEffect: "copy" };
  fireEvent.drop(dropzone, { dataTransfer: transfer });
  expect(screen.getByTitle("移除 骑士1")).toBeInTheDocument();
});

test("contains no remote runtime URLs", async () => {
  render(<App />);
  await appReady();
  const runtimeUrls = [...document.querySelectorAll<HTMLElement>("[src], [href]")]
    .map((node) => node.getAttribute("src") ?? node.getAttribute("href") ?? "")
    .filter((value) => /^https?:\/\//.test(value));
  expect(runtimeUrls).toEqual([]);
});

test("deletes a task group and all of its tasks after confirmation", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  expect(document.querySelectorAll(".task-card")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "删除任务分组" }));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("其中 1 个任务"));
  expect(screen.getByText("还没有任务分组")).toBeInTheDocument();
  expect(document.querySelectorAll(".task-card")).toHaveLength(0);
});

test("reorders task cards within and across groups using the task drag payload", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  await user.click(screen.getByRole("button", { name: "复制任务" }));

  const makeTransfer = () => {
    const values = new Map<string, string>();
    const types: string[] = [];
    return {
      types,
      effectAllowed: "move",
      dropEffect: "move",
      setData(type: string, value: string) { values.set(type, value); if (!types.includes(type)) types.push(type); },
      getData(type: string) { return values.get(type) ?? ""; },
    };
  };
  let cards = [...document.querySelectorAll<HTMLElement>(".task-card")];
  const within = makeTransfer();
  fireEvent.dragStart(cards[1]!, { dataTransfer: within });
  fireEvent.drop(cards[0]!, { dataTransfer: within });
  cards = [...document.querySelectorAll<HTMLElement>(".task-card")];
  expect(cards[0]).toHaveAttribute("data-task-name", "咆哮森林 副本");

  await user.click(screen.getByRole("button", { name: "添加分组" }));
  let groups = [...document.querySelectorAll<HTMLElement>(".task-group")];
  const secondGroupTask = groups[1]!.querySelector<HTMLElement>(".task-card")!;
  const across = makeTransfer();
  fireEvent.dragStart(cards[0]!, { dataTransfer: across });
  fireEvent.drop(secondGroupTask, { dataTransfer: across });
  groups = [...document.querySelectorAll<HTMLElement>(".task-group")];
  expect(groups[0]).toHaveTextContent("1 个任务");
  expect(groups[1]).toHaveTextContent("2 个任务");
  expect(groups[1]!.querySelector(".task-card")).toHaveAttribute("data-task-name", "咆哮森林 副本");
});

test("selects the online automatic, element and no-barrier modes", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  systems[0]!.taskGroups[0]!.tasks[0]!.barrier = { 火: 3200, 暗: 75 };
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  await user.click(screen.getByRole("button", { name: "元素屏障：自动" }));
  await user.click(screen.getByRole("option", { name: "火" }));
  expect(screen.getByRole("button", { name: "元素屏障：火" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "元素屏障：火" }));
  await user.click(screen.getByRole("option", { name: "无屏障" }));
  expect(screen.getByRole("button", { name: "元素屏障：无屏障" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加成员" })).toBeInTheDocument();
});

test("mirrors the online map, booster and elite selection flows", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /切换地图/ }));
  expect(screen.getByRole("dialog", { name: "选择冒险任务" })).toBeInTheDocument();
  expect(["普通冒险", "黄金城", "泰坦塔", "快闪"].map((name) => screen.getByRole("button", { name }))).toHaveLength(4);
  await user.click(screen.getByRole("button", { name: "咆哮森林" }));
  expect(screen.getByRole("button", { name: "简单" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "简单" }));
  await user.click(screen.getByRole("button", { name: "强化道具：无" }));
  await user.click(screen.getByRole("button", { name: /超级威力强化品/ }));
  expect(screen.getByRole("button", { name: "强化道具：超级威力强化品" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "精英怪：无" }));
  await user.click(screen.getByRole("option", { name: "巨大" }));
  expect(screen.getByRole("button", { name: "精英怪：巨大" })).toBeInTheDocument();
});

test("enforces the online 48-adventure limit across add group, add task and clone controls", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  const original = systems[0]!.taskGroups[0]!.tasks[0]!;
  systems[0]!.taskGroups[0]!.tasks = Array.from({ length: 48 }, (_, index) => ({ ...structuredClone(original), id: crypto.randomUUID(), name: `任务${index + 1}` }));
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  expect(screen.getByRole("heading", { name: "冒险任务 (48/48)" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加分组" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "添加任务" })).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "复制任务" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
});

test("copies and validates clipboard system and hero configurations", async () => {
  let clipboardText = "";
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: vi.fn((value: string) => { clipboardText = value; return Promise.resolve(); }),
    readText: vi.fn(() => Promise.resolve(clipboardText)),
  } });
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "复制配置" }));
  await waitFor(() => expect(clipboardText).toContain("zys-clipboard"));
  const systemEnvelope = JSON.parse(clipboardText) as { format: string; kind: string; payload: { name: string } };
  expect(systemEnvelope).toMatchObject({ format: "zys-clipboard", kind: "system" });
  systemEnvelope.payload.name = "剪贴板导入体系";
  clipboardText = JSON.stringify(systemEnvelope);
  await user.click(screen.getByRole("button", { name: "粘贴配置" }));
  expect(screen.getByText("剪贴板导入体系", { selector: ".online-system-card > strong" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "配装" }));
  clipboardText = "";
  await user.click(screen.getByRole("button", { name: "复制配装" }));
  await waitFor(() => expect(clipboardText).toContain("英雄配置"));
  const heroConfig = decodeOnlineHeroConfig(clipboardText);
  expect(heroConfig.heroClass).toBe("knight");
  heroConfig.heroName = "剪贴板英雄";
  heroConfig.level = 37;
  clipboardText = `线上配置\n${btoa(encodeURIComponent(JSON.stringify(heroConfig)))}`;
  await user.click(screen.getByRole("button", { name: "粘贴导入" }));
  expect(screen.getByTitle("点击改名")).toHaveTextContent("骑士1");
  expect(screen.getByRole("button", { name: "英雄等级" })).toHaveTextContent("37");
  await screen.findByText("修改已实时同步到当前体系");
  await user.click(screen.getByRole("button", { name: /^关闭$/ }));
  expect(screen.getAllByText("骑士1").length).toBeGreaterThan(0);
});

test("treats an ordinary Rust cancellation error as a recoverable UI state", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  vi.spyOn(desktopBridge, "simulate").mockRejectedValueOnce(new Error("simulation cancelled by user"));
  await user.click(screen.getByRole("button", { name: "测试冒险" }));
  expect(await screen.findByText("模拟已取消，可重新开始")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "测试冒险" })).toBeEnabled();
});

test("shows the online-style full member configuration in simulation details", async () => {
  const user = userEvent.setup();
  vi.spyOn(desktopBridge, "simulate").mockResolvedValueOnce({
    iterations: 10000, successRate: 100, averageTurns: 1, minTurns: 1, maxTurns: 1,
    survivalRate: 100, averageDamage: 9251, averageRemainingHealth: 764,
    simulatorVersion: "test-simulator", gameDataVersion: previewCatalog.gameDataVersion, completedAt: new Date().toISOString(),
  });
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  await user.click(screen.getByRole("button", { name: "测试冒险" }));
  await user.click(await screen.findByRole("button", { name: "查看详情" }));
  const dialog = screen.getByRole("dialog", { name: "冒险模拟详情" });
  expect(dialog).toHaveTextContent("自带技能");
  expect(dialog).toHaveTextContent("技能 4");
  expect(dialog).toHaveTextContent("卡片等级");
  expect(dialog).toHaveTextContent("点击职业图标导出配置码");
  expect(screen.getByRole("button", { name: "复制图片" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载图片" })).toBeInTheDocument();
  expect(dialog.querySelectorAll(".simulation-config-equipment > div")).toHaveLength(6);
});

test("saves, applies and deletes a local equipment template", async () => {
  const user = userEvent.setup();
  vi.spyOn(window, "prompt").mockReturnValue("骑士黄金模板");
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: "保存为模板" }));
  await waitFor(() => expect(localStorage.getItem("zys.hero-lineup.templates.v1")).toContain("骑士黄金模板"));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.selectOptions(screen.getByLabelText("英雄配装模板"), screen.getByRole("option", { name: "骑士黄金模板" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  expect(screen.getByRole("button", { name: /学徒短剑/ })).toHaveClass("selected");
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: "关闭" }));
  await user.click(screen.getByRole("button", { name: "配装模板" }));
  expect(screen.getByText("骑士黄金模板")).toBeInTheDocument();
  await user.click(screen.getByLabelText("删除模板 骑士黄金模板"));
  await waitFor(() => expect(localStorage.getItem("zys.hero-lineup.templates.v1")).not.toContain("骑士黄金模板"));
});
