import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

test("renders online-style roster element badges and sorts same-class heroes by name", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  const first = systems[0]!.heroes[0]!;
  first.name = "骑士B";
  systems[0]!.heroes.push({ ...structuredClone(first), id: crypto.randomUUID(), name: "骑士A" });
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await waitFor(() => expect(document.querySelectorAll(".roster-element-badge")).toHaveLength(3));
  expect(document.querySelector(".champion-icon-card .roster-element-badge")).toHaveAttribute("alt", "light");
  expect(document.querySelector(".hero-icon-card .roster-element-badge")).toHaveAttribute("alt", "light");
  expect([...document.querySelectorAll(".hero-icon-card strong")].map((node) => node.textContent)).toEqual(["骑士A", "骑士B"]);
  expect(screen.getByRole("button", { name: "职业排序" })).toHaveClass("active");
  await user.click(screen.getByRole("button", { name: "元素排序" }));
  expect(screen.getByRole("button", { name: "元素排序" })).toHaveClass("active");
  expect([...document.querySelectorAll(".hero-icon-card strong")].map((node) => node.textContent)).toEqual(["骑士A", "骑士B"]);
});

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

test("matches online system-card deletion visibility and deletes the targeted card", async () => {
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<App />);
  await appReady();
  expect(screen.queryByRole("button", { name: /删除体系/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存当前体系" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "新增体系" }));
  await user.type(screen.getByLabelText("新体系名称"), "第二体系");
  await user.click(screen.getByRole("button", { name: /^创建$/ }));
  expect(screen.getAllByRole("button", { name: /删除体系/ })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "删除体系 默认体系" }));

  expect(confirm).toHaveBeenCalledWith("删除这个阵容体系吗？此操作不可恢复。");
  await waitFor(() => expect(screen.queryByText("默认体系", { selector: ".online-system-card > strong" })).not.toBeInTheDocument());
  expect(document.querySelector(".online-system-card.active > strong")).toHaveTextContent("第二体系");
  expect(screen.queryByRole("button", { name: /删除体系/ })).not.toBeInTheDocument();
});

test("explains why an online six-character system code cannot resolve offline", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "新增体系" }));
  await user.click(screen.getByRole("button", { name: "口令导入" }));
  await user.type(screen.getByLabelText("粘贴体系配置码"), "9UP4N1");
  await user.click(within(screen.getByRole("dialog", { name: "新增体系" })).getByRole("button", { name: "导入体系" }));
  expect(screen.getByRole("alert")).toHaveTextContent("只是一条服务器索引");
  expect(screen.getByRole("alert")).toHaveTextContent("完整离线口令");
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

test("matches online equipment statistics instead of opening the template manager", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();

  await user.click(within(document.getElementById("champions-section")!).getByRole("button", { name: "装备统计" }));
  const emptyDialog = screen.getByRole("dialog", { name: "勇士装备需求统计" });
  expect(within(emptyDialog).getByText("暂无装备需求")).toBeInTheDocument();
  await user.click(within(emptyDialog).getByRole("button", { name: "关闭" }));

  await user.click(screen.getByRole("button", { name: "配装" }));
  await user.click(screen.getByRole("button", { name: "武器装备槽" }));
  await user.click(screen.getByRole("button", { name: /学徒短剑/ }));
  await user.click(screen.getAllByRole("button", { name: "关闭" }).at(-1)!);
  await user.click(screen.getByRole("button", { name: /^关闭$/ }));

  await user.click(within(document.getElementById("heroes-section")!).getByRole("button", { name: "装备统计" }));
  const needsDialog = screen.getByRole("dialog", { name: "英雄装备需求统计" });
  expect(within(needsDialog).getByTitle("学徒短剑")).toBeInTheDocument();
  expect(within(needsDialog).getByText("需要：")).toBeInTheDocument();
  expect(within(needsDialog).getByText("1", { selector: ".equipment-need-counts b" })).toBeInTheDocument();
  const owned = within(needsDialog).getByRole("spinbutton", { name: "已有 学徒短剑 普通" });
  await user.clear(owned);
  await user.type(owned, "1");
  expect(within(needsDialog).getByText("(0)")).toHaveClass("complete");
  expect(localStorage.getItem("zys.hero-lineup.owned-equipment.v1")).toBeNull();
  await user.click(within(needsDialog).getByRole("button", { name: "关闭" }));
  await user.click(screen.getByRole("button", { name: /保存当前体系/ }));
  await waitFor(() => expect(localStorage.getItem("zys.hero-lineup.systems.v1")).toContain('"shortsword_普通":1'));
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
  expect(screen.getByText(/勇士之魂/)).toBeInTheDocument();
  const currentLevel = screen.getByRole("button", { name: "勇士等级" }).textContent;
  await user.click(screen.getByRole("button", { name: "勇士等级" }));
  await user.click(screen.getByRole("option", { name: new RegExp(`^${currentLevel}$`) }));
  expect(screen.queryByRole("listbox", { name: "勇士等级选项" })).not.toBeInTheDocument();
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

test("removes the online-style task group when its final task is deleted", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  expect(document.querySelectorAll(".task-card")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "删除任务分组" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "删除任务" }));
  expect(document.querySelectorAll(".task-card")).toHaveLength(0);
  expect(document.querySelectorAll(".task-group")).toHaveLength(0);
});

test("opens the quest picker before adding a task to an existing group", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  expect(document.querySelectorAll(".task-card")).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "添加任务" }));
  expect(screen.getByRole("dialog", { name: "选择冒险任务" })).toBeInTheDocument();
  expect(document.querySelectorAll(".task-card")).toHaveLength(1);
  const questDialog = screen.getByRole("dialog", { name: "选择冒险任务" });
  await user.click(within(questDialog).getByRole("button", { name: /咆哮森林/ }));
  await user.click(within(questDialog).getByRole("button", { name: /简单/ }));
  expect(screen.queryByRole("dialog", { name: "选择冒险任务" })).not.toBeInTheDocument();
  expect(document.querySelectorAll(".task-card")).toHaveLength(2);
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
  expect(groups[0]!.querySelectorAll(".task-card")).toHaveLength(1);
  expect(groups[1]!.querySelectorAll(".task-card")).toHaveLength(2);
  expect(groups[1]!.querySelector(".task-card")).toHaveAttribute("data-task-name", "咆哮森林 副本");
});

test("selects the online automatic, element and no-barrier modes", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  systems[0]!.heroes[0]!.stats.element = 80;
  systems[0]!.taskGroups[0]!.tasks[0]!.barrier = { 暗: 320, 光: 320, 土: 320 };
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  expect(document.querySelector(".task-barrier-meter")).toHaveTextContent("80/320");
  expect(document.querySelectorAll(".task-barrier-meter b")).toHaveLength(3);
  await user.click(screen.getByRole("button", { name: "元素屏障：自动" }));
  await user.click(screen.getByRole("option", { name: "光" }));
  expect(screen.getByRole("button", { name: "元素屏障：光" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "元素屏障：光" }));
  await user.click(screen.getByRole("option", { name: "无屏障" }));
  expect(screen.getByRole("button", { name: "元素屏障：无屏障" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加成员" })).toBeInTheDocument();
});

test("uses the online modal member catalog and group-scoped unassigned filter", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  const original = systems[0]!.taskGroups[0]!.tasks[0]!;
  systems[0]!.taskGroups[0]!.tasks.push({ ...structuredClone(original), id: crypto.randomUUID(), memberIds: [] });
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  const secondTask = document.querySelectorAll<HTMLElement>(".task-card")[1]!;
  await user.click(within(secondTask).getByRole("button", { name: "添加成员" }));
  const dialog = screen.getByRole("dialog", { name: "选择成员添加到任务" });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "仅未上阵成员" })).toHaveAttribute("aria-checked", "false");
  expect(within(dialog).queryByRole("button", { name: /骑士1/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: "仅未上阵成员" }));
  expect(screen.getByRole("switch", { name: "全部成员" })).toHaveAttribute("aria-checked", "true");
  expect(within(dialog).getByRole("button", { name: /骑士1/ })).toBeInTheDocument();
  expect(localStorage.getItem("heroLineup_taskMemberPickerAllMembers")).toBe("1");
});

test("allows only one champion per task while keeping heroes available", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  systems[0]!.heroes.push({ ...structuredClone(systems[0]!.heroes[0]!), id: crypto.randomUUID(), name: "骑士2" });
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /冒险任务/ }));
  const task = document.querySelector<HTMLElement>(".task-card")!;
  await user.click(within(task).getByRole("button", { name: "添加成员" }));
  let dialog = screen.getByRole("dialog", { name: "选择成员添加到任务" });
  await user.click(within(dialog).getByRole("button", { name: /阿尔贡/ }));
  await user.click(within(task).getByRole("button", { name: "添加成员" }));
  dialog = screen.getByRole("dialog", { name: "选择成员添加到任务" });
  expect(within(dialog).queryByText("阿尔贡")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: /骑士2/ })).toBeInTheDocument();
});

test("mirrors the online map, booster and elite selection flows", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /切换地图/ }));
  expect(screen.getByRole("dialog", { name: "选择冒险任务" })).toBeInTheDocument();
  expect(["普通冒险", "黄金城", "泰坦塔", "快闪"].map((name) => screen.getByRole("button", { name }))).toHaveLength(4);
  const questDialog = screen.getByRole("dialog", { name: "选择冒险任务" });
  await user.click(within(questDialog).getByRole("button", { name: /咆哮森林/ }));
  expect(within(questDialog).getByRole("button", { name: /简单/ })).toBeInTheDocument();
  await user.click(within(questDialog).getByRole("button", { name: /简单/ }));
  await user.click(screen.getByRole("button", { name: "强化道具：无" }));
  await user.click(screen.getByRole("button", { name: /超级威力强化品/ }));
  expect(screen.getByRole("button", { name: "强化道具：超级威力强化品" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "精英怪：无" }));
  await user.click(screen.getByRole("option", { name: "巨大" }));
  expect(screen.getByRole("button", { name: "精英怪：巨大" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /切换地图/ }));
  await user.click(screen.getByRole("button", { name: "泰坦塔" }));
  await user.click(screen.getByRole("button", { name: /第1层/ }));
  await user.click(within(screen.getByRole("dialog", { name: "选择冒险任务" })).getByRole("button", { name: /阿尔法/ }));
  const task = document.querySelector<HTMLElement>(".task-card")!;
  expect(within(task).getByRole("button", { name: "强化道具：超级威力强化品" })).toBeInTheDocument();
  expect(within(task).queryByRole("button", { name: /精英怪/ })).not.toBeInTheDocument();
  expect(within(task).queryByText("元素屏障")).not.toBeInTheDocument();
  expect(within(task).queryByText("泰坦塔", { selector: "label" })).not.toBeInTheDocument();

  await user.click(within(task).getByRole("button", { name: /切换地图/ }));
  await user.click(screen.getByRole("button", { name: "普通冒险" }));
  await user.click(screen.getByRole("button", { name: /咆哮森林/ }));
  await user.click(screen.getByRole("button", { name: /简单/ }));
  expect(within(task).getByRole("button", { name: "精英怪：无" })).toBeInTheDocument();
  expect(within(task).getByRole("button", { name: "强化道具：超级威力强化品" })).toBeInTheDocument();
});

test("invalidates an old simulation result when a task option changes", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  systems[0]!.taskGroups[0]!.tasks[0]!.result = {
    iterations: 10000, successRate: 88, averageTurns: 3, minTurns: 2, maxTurns: 5,
    survivalRate: 90, averageDamage: 100, averageRemainingHealth: 200,
    simulatorVersion: "old", gameDataVersion: previewCatalog.gameDataVersion, completedAt: new Date().toISOString(),
  };
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "强化道具：无" }));
  await user.click(screen.getAllByRole("button", { name: /威力强化品$/ })[0]!);
  expect(screen.queryByRole("button", { name: "查看详情" })).not.toBeInTheDocument();
});

test("shows online-style overall, first-attempt and conditional second-attempt results", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  const heroId = systems[0]!.heroes[0]!.id;
  vi.spyOn(desktopBridge, "simulate").mockResolvedValue({
    iterations: 10000,
    successRate: 84.375,
    averageTurns: 8.25,
    minTurns: 5,
    maxTurns: 12,
    survivalRate: 81,
    averageDamage: 4200,
    averageRemainingHealth: 160,
    firstAttempt: {
      iterations: 10000,
      successRate: 75,
      averageTurns: 8.25,
      minTurns: 5,
      maxTurns: 12,
      memberResults: [{ id: heroId, survivalRate: 70, averageDamage: 4200, averageRemainingHealth: 160 }],
    },
    secondAttempt: {
      iterations: 2500,
      successRate: 37.5,
      averageTurns: 7.5,
      minTurns: 4,
      maxTurns: 11,
      memberResults: [{ id: heroId, survivalRate: 45, averageDamage: 4700, averageRemainingHealth: 190 }],
    },
    hasSecondAttempt: true,
    overallMemberResults: [{ id: heroId, survivalRate: 81 }],
    simulatorVersion: "test-retry",
    gameDataVersion: previewCatalog.gameDataVersion,
    completedAt: new Date().toISOString(),
  });
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: "测试冒险" }));
  await user.click(await screen.findByRole("button", { name: "查看详情" }));
  const dialog = screen.getByRole("dialog", { name: "冒险模拟详情" });
  expect(within(dialog).getByText("总体成功率")).toBeInTheDocument();
  expect(dialog.querySelector(".simulation-overall-summary > strong")).toHaveTextContent("84.375%");
  expect(within(dialog).getByRole("heading", { name: "第一次尝试" })).toBeInTheDocument();
  expect(within(dialog).getByRole("heading", { name: "第二次尝试" })).toBeInTheDocument();
  expect(within(dialog).getByText("2,500")).toBeInTheDocument();
});

test("uses the online two-stage Titan Tower floor and variant flow", async () => {
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /切换地图/ }));
  await user.click(screen.getByRole("button", { name: "泰坦塔" }));
  await user.click(screen.getByRole("button", { name: /第1层/ }));
  const picker = screen.getByRole("dialog", { name: "选择冒险任务" });
  for (const variant of ["阿尔法", "贝塔", "伽马", "德尔塔", "艾普斯龙", "奇异"]) {
    expect(within(picker).getByRole("button", { name: new RegExp(variant) })).toBeInTheDocument();
  }
  await user.click(within(picker).getByRole("button", { name: /奇异/ }));
  expect(screen.queryByRole("dialog", { name: "选择冒险任务" })).not.toBeInTheDocument();
  const task = document.querySelector<HTMLElement>(".task-card")!;
  expect(task).toHaveTextContent("泰坦之塔1层");
  expect(within(task).getByLabelText("奇异")).toBeInTheDocument();
  expect(within(task).getByAltText("第1层")).toHaveAttribute("src", expect.stringContaining("icon_global_questarea_titantower_small"));
});

test("shows the online Titan modifier count and enforces one entry per family", async () => {
  const towerCatalog = structuredClone(previewCatalog);
  towerCatalog.quests.filter((quest) => quest.category === "泰坦塔").forEach((quest) => { quest.towerModifierLimit = 2; });
  towerCatalog.questModifiers = [
    { id: "powerful", family: "powerful", name: "强力", description: "怪物攻击提高", minTowerTier: 0, maxTowerTier: 0, minTowerFloor: 0, maxTowerFloor: 0 },
    { id: "mythical", family: "powerful", name: "神话", description: "同家族高级词条", minTowerTier: 0, maxTowerTier: 0, minTowerFloor: 0, maxTowerFloor: 0 },
    { id: "swift", family: "swift", name: "迅捷", description: "怪物速度提高", minTowerTier: 0, maxTowerTier: 0, minTowerFloor: 0, maxTowerFloor: 0 },
  ];
  vi.spyOn(desktopBridge, "loadCatalog").mockResolvedValue(towerCatalog);
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  await user.click(screen.getByRole("button", { name: /切换地图/ }));
  await user.click(screen.getByRole("button", { name: "泰坦塔" }));
  await user.click(screen.getByRole("button", { name: /第1层/ }));
  await user.click(within(screen.getByRole("dialog", { name: "选择冒险任务" })).getByRole("button", { name: /阿尔法/ }));
  await user.click(screen.getByRole("button", { name: "词条：0/2" }));
  const modifiers = screen.getByRole("dialog", { name: "选择词条 0/2" });
  await user.click(within(modifiers).getByRole("button", { name: /强力/ }));
  expect(within(modifiers).getByRole("button", { name: /神话/ })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "选择词条 1/2" })).toBeInTheDocument();
  await user.click(within(modifiers).getByRole("button", { name: /迅捷/ }));
  expect(screen.getByRole("heading", { name: "选择词条 2/2" })).toBeInTheDocument();
});

test("removes and blocks members whose element is disabled by a Titan modifier", async () => {
  const towerCatalog = structuredClone(previewCatalog);
  const titanQuest = towerCatalog.quests.find((quest) => quest.category === "泰坦塔")!;
  titanQuest.towerModifierLimit = 2;
  towerCatalog.questModifiers = [
    { id: "ignoreelement", family: "ignoreelement", name: "元素禁令", description: "禁用一个元素", minTowerTier: 0, maxTowerTier: 0, minTowerFloor: 0, maxTowerFloor: 0 },
  ];
  vi.spyOn(desktopBridge, "loadCatalog").mockResolvedValue(towerCatalog);
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  const fireHero = systems[0]!.heroes[0]!;
  fireHero.name = "火焰骑士";
  fireHero.element = "火";
  const waterHero = { ...structuredClone(fireHero), id: crypto.randomUUID(), name: "潮汐骑士", element: "水" as const };
  systems[0]!.heroes.push(waterHero);
  const taskState = systems[0]!.taskGroups[0]!.tasks[0]!;
  Object.assign(taskState, {
    questId: titanQuest.id,
    name: titanQuest.name,
    map: titanQuest.mapName,
    difficulty: titanQuest.difficulty,
    maxMembers: titanQuest.maxMembers,
    memberIds: [fireHero.id],
    config: { ...taskState.config, titanTower: true, towerModifiers: [], towerModifierElements: {} },
  });
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));

  const user = userEvent.setup();
  render(<App />);
  await appReady();
  const task = document.querySelector<HTMLElement>(".task-card")!;
  expect(within(task).getByTitle("移除 火焰骑士")).toBeInTheDocument();
  await user.click(within(task).getByRole("button", { name: "词条：0/2" }));
  await user.click(within(screen.getByRole("dialog", { name: "选择词条 0/2" })).getByRole("button", { name: /元素禁令/ }));
  expect(within(task).queryByTitle("移除 火焰骑士")).not.toBeInTheDocument();

  await user.click(within(task).getByRole("button", { name: "添加成员" }));
  const memberPicker = screen.getByRole("dialog", { name: "选择成员添加到任务" });
  expect(within(memberPicker).queryByRole("button", { name: /火焰骑士/ })).not.toBeInTheDocument();
  expect(within(memberPicker).getByRole("button", { name: /潮汐骑士/ })).toBeInTheDocument();
});

test("reveals XP boosters and the three online XP toggles only for an XP-to-attack artifact", async () => {
  const xpCatalog = structuredClone(previewCatalog);
  xpCatalog.items.push({ id: "magehat", name: "学者帽", itemType: "hh", typeName: "帽子", tier: 15, skill: "a_artifactmagehat" });
  xpCatalog.skills.push({ id: "a_artifactmagehat", name: "导师之帽", family: "a_artifactmagehat", tier: 1, classes: [], rarity: 0, elements: 0, rank: 0, effects: [], xpToAttack: 0.5 });
  vi.spyOn(desktopBridge, "loadCatalog").mockResolvedValue(xpCatalog);
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  systems[0]!.heroes[0]!.equipment[0]!.itemId = "magehat";
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  expect(screen.getByText("经验加成")).toBeInTheDocument();
  expect(screen.getByTitle("冒险精通 +20%经验 (+10%攻击)")).toHaveClass("active");
  expect(screen.getByTitle("公会经验强化 +25%经验 (+12.5%攻击)")).toHaveClass("active");
  expect(screen.getByTitle("小活动经验 +25%经验 (+12.5%攻击)")).not.toHaveClass("active");
  await user.click(screen.getByRole("button", { name: "强化道具：无" }));
  expect(screen.getByText("经验强化")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /超级经验强化品/ }));
  expect(screen.getByRole("button", { name: "强化道具：超级经验强化品" })).toBeInTheDocument();
});

test("trims champions first and clears the old result when a new map has fewer party slots", async () => {
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  const first = systems[0]!.heroes[0]!;
  const second = { ...structuredClone(first), id: crypto.randomUUID(), name: "骑士2" };
  const third = { ...structuredClone(first), id: crypto.randomUUID(), name: "骑士3" };
  systems[0]!.heroes.push(second, third);
  const taskState = systems[0]!.taskGroups[0]!.tasks[0]!;
  taskState.memberIds = [first.id, second.id, third.id, "argon"];
  taskState.result = {
    successRate: 99, averageTurns: 1, minTurns: 1, maxTurns: 1, survivalRate: 100,
    averageDamage: 1, averageRemainingHealth: 1, simulatorVersion: "old", gameDataVersion: previewCatalog.gameDataVersion,
    completedAt: new Date().toISOString(),
  };
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  render(<App />);
  await appReady();
  const task = document.querySelector<HTMLElement>(".task-card")!;
  expect(within(task).getByRole("button", { name: "查看详情" })).toBeInTheDocument();
  expect(within(task).getByTitle("移除 阿尔贡")).toBeInTheDocument();

  await user.click(within(task).getByRole("button", { name: /切换地图/ }));
  await user.click(screen.getByRole("button", { name: "泰坦塔" }));
  await user.click(screen.getByRole("button", { name: /第1层/ }));
  await user.click(screen.getByRole("button", { name: /阿尔法/ }));

  expect(task.querySelectorAll(".online-party-member")).toHaveLength(3);
  expect(within(task).queryByTitle("移除 阿尔贡")).not.toBeInTheDocument();
  expect(within(task).queryByRole("button", { name: "查看详情" })).not.toBeInTheDocument();
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
  const exportDialog = screen.getByRole("dialog", { name: "导出口令" });
  expect(exportDialog).toBeInTheDocument();
  await user.click(within(exportDialog).getByRole("button", { name: "复制口令" }));
  await waitFor(() => expect(clipboardText).toContain("zys-clipboard"));
  await user.click(within(exportDialog).getByRole("button", { name: "关闭" }));
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
  const systems = JSON.parse(localStorage.getItem("zys.hero-lineup.systems.v1")!) as ReturnType<typeof makeDefaultSystem>[];
  systems[0]!.taskGroups[0]!.tasks[0]!.memberIds.push("argon");
  localStorage.setItem("zys.hero-lineup.systems.v1", JSON.stringify(systems));
  const user = userEvent.setup();
  vi.spyOn(desktopBridge, "simulate").mockResolvedValueOnce({
    iterations: 10000, successRate: 100, averageTurns: 1, minTurns: 1, maxTurns: 1,
    survivalRate: 100, averageDamage: 9251, averageRemainingHealth: 764,
    memberResults: [
      { id: systems[0]!.heroes[0]!.id, survivalRate: 100, averageDamage: 5100, averageRemainingHealth: 420 },
      { id: "argon", survivalRate: 98, averageDamage: 4151, averageRemainingHealth: 344 },
    ],
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
  expect(dialog).toHaveTextContent("收藏卡牌");
  expect(dialog).toHaveTextContent("勇士之魂");
  expect(dialog).toHaveTextContent("点击职业图标导出配置码");
  expect(screen.getByRole("button", { name: "复制图片" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载图片" })).toBeInTheDocument();
  expect(dialog.querySelectorAll(".simulation-member-summary article")).toHaveLength(2);
  expect(dialog.querySelectorAll(".simulation-config-card")).toHaveLength(2);
  expect(dialog.querySelectorAll(".simulation-config-equipment > div")).toHaveLength(8);

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write: vi.fn().mockRejectedValue(new Error("permission denied")) },
  });
  await user.click(screen.getByRole("button", { name: "复制图片" }));
  expect(screen.getByText("复制失败，请使用下载功能")).toBeInTheDocument();
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
