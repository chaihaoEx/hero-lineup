import type {
  AdventureTask,
  Champion,
  ChampionLoadout,
  CalculatedSheet,
  EquipmentSlot,
  Hero,
  LineupSystem,
  PartyUnit,
  SimulationResult,
} from "../types/domain";

export type ClipboardKind = "system" | "hero" | "champion-loadout";

interface ClipboardEnvelope {
  format: "zys-clipboard";
  version: 1;
  kind: ClipboardKind;
  exportedAt: string;
  payload: unknown;
}

const elements = new Set(["火", "水", "土", "风", "光", "暗"]);
const qualities = new Set(["普通", "优质", "高级", "史诗", "传说"]);
const slots = new Set(["武器", "头部", "身体", "手部", "脚部", "饰品"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}必须是对象`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}必须是非空字符串`);
  return value;
}

function finite(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new Error(`${label}必须是不小于 ${minimum} 的有限数字`);
  return value;
}

function validateStats(value: unknown): void {
  const stats = record(value, "属性");
  for (const key of ["attack", "defense", "health", "evasion", "crit"]) finite(stats[key], `属性.${key}`);
}

function validateEquipment(value: unknown): asserts value is EquipmentSlot[] {
  if (!Array.isArray(value) || value.length !== 6) throw new Error("英雄配装必须恰好包含六个装备槽");
  const found = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const equipment = record(entry, `装备槽 ${index + 1}`);
    const slot = string(equipment.slot, `装备槽 ${index + 1}.slot`);
    if (!slots.has(slot) || found.has(slot)) throw new Error("六个装备槽必须各出现一次");
    found.add(slot);
    if (typeof equipment.quality !== "string" || !qualities.has(equipment.quality)) throw new Error(`${slot}品质无效`);
    if (equipment.element !== undefined && typeof equipment.element !== "string") throw new Error(`${slot}元素附魔无效`);
    if (equipment.spirit !== undefined && typeof equipment.spirit !== "string") throw new Error(`${slot}精萃附魔无效`);
    if (typeof equipment.shiny !== "boolean") throw new Error(`${slot}闪耀值无效`);
    finite(equipment.transcendence, `${slot}超越等级`);
  }
}

export function validateHero(value: unknown): Hero {
  const hero = record(value, "英雄");
  if (hero.kind !== "hero") throw new Error("剪贴板内容不是英雄配置");
  for (const key of ["id", "name", "classId", "className"]) string(hero[key], `英雄.${key}`);
  if (typeof hero.element !== "string" || !elements.has(hero.element)) throw new Error("英雄元素无效");
  for (const key of ["level", "rank", "seed", "cardLevel"]) finite(hero[key], `英雄.${key}`);
  if (typeof hero.titan !== "boolean" || !Array.isArray(hero.skills) || hero.skills.some((skill) => typeof skill !== "string")) {
    throw new Error("英雄技能或泰坦标记无效");
  }
  validateStats(hero.stats);
  validateEquipment(hero.equipment);
  return structuredClone(value as Hero);
}

export function validateChampionLoadout(value: unknown): ChampionLoadout {
  const loadout = record(value, "勇士配装");
  for (const key of ["level", "rank", "cardLevel"]) finite(loadout[key], `勇士配装.${key}`);
  if (loadout.seed !== undefined) finite(loadout.seed, "勇士配装.seed");
  if (typeof loadout.familiar !== "string" || typeof loadout.aurasong !== "string") throw new Error("使魔或光环之歌必须是字符串");
  if (loadout.titan !== undefined && typeof loadout.titan !== "boolean") throw new Error("泰坦状态必须是布尔值");
  for (const [key, label] of [["familiarEquipment", "使魔"], ["auraSongEquipment", "光环之歌"]] as const) {
    if (loadout[key] === undefined) continue;
    const equipment = record(loadout[key], label);
    if (typeof equipment.quality !== "string" || !qualities.has(equipment.quality)) throw new Error(`${label}品质无效`);
    if (equipment.itemId !== undefined && typeof equipment.itemId !== "string") throw new Error(`${label}物品无效`);
    if (equipment.element !== undefined && typeof equipment.element !== "string") throw new Error(`${label}元素附魔无效`);
    if (equipment.spirit !== undefined && typeof equipment.spirit !== "string") throw new Error(`${label}精萃附魔无效`);
    if (typeof equipment.shiny !== "boolean") throw new Error(`${label}星能铸造值无效`);
    finite(equipment.transcendence, `${label}超越值`);
  }
  return { ...(structuredClone(loadout) as unknown as ChampionLoadout), seed: typeof loadout.seed === "number" ? loadout.seed : 0, titan: loadout.titan === true };
}

function validateTask(value: unknown): void {
  const task = record(value, "任务");
  for (const key of ["id", "name", "map", "difficulty"]) string(task[key], `任务.${key}`);
  finite(task.maxMembers, "任务.maxMembers", 1);
  if (!Array.isArray(task.memberIds) || task.memberIds.some((id) => typeof id !== "string")) throw new Error("任务成员列表无效");
  if (new Set(task.memberIds).size !== task.memberIds.length) throw new Error("同一任务中不能重复上阵成员");
  if (task.memberIds.length > (task.maxMembers as number)) throw new Error("任务成员数超过最大人数");
  const barrier = record(task.barrier, "任务屏障");
  for (const [element, power] of Object.entries(barrier)) {
    if (!elements.has(element)) throw new Error(`未知屏障元素：${element}`);
    finite(power, `${element}屏障`);
  }
  record(task.config, "模拟配置");
}

export function validateSystem(value: unknown): LineupSystem {
  const system = record(value, "体系");
  for (const key of ["id", "name", "description", "localTag", "createdAt", "updatedAt", "gameDataVersion"]) {
    if (typeof system[key] !== "string") throw new Error(`体系.${key}必须是字符串`);
  }
  finite(system.schemaVersion, "体系.schemaVersion", 1);
  if (!Array.isArray(system.heroes) || !Array.isArray(system.championIds) || !Array.isArray(system.taskGroups)) throw new Error("体系阵容或任务分组无效");
  system.heroes.forEach(validateHero);
  if (system.championIds.some((id) => typeof id !== "string") || new Set(system.championIds).size !== system.championIds.length) {
    throw new Error("勇士阵容包含无效或重复 ID");
  }
  record(system.championLoadouts, "勇士配装集合");
  for (const loadout of Object.values(system.championLoadouts as Record<string, unknown>)) validateChampionLoadout(loadout);
  for (const value of system.taskGroups) {
    const group = record(value, "任务分组");
    string(group.id, "任务分组.id");
    string(group.name, "任务分组.name");
    if (!Array.isArray(group.tasks)) throw new Error("任务分组.tasks必须是数组");
    group.tasks.forEach(validateTask);
  }
  return structuredClone(value as LineupSystem);
}

export function encodeClipboard(kind: ClipboardKind, payload: unknown): string {
  return JSON.stringify({ format: "zys-clipboard", version: 1, kind, exportedAt: new Date().toISOString(), payload } satisfies ClipboardEnvelope, null, 2);
}

export function decodeClipboard(text: string, expectedKind: "system"): LineupSystem;
export function decodeClipboard(text: string, expectedKind: "hero"): Hero;
export function decodeClipboard(text: string, expectedKind: "champion-loadout"): ChampionLoadout;
export function decodeClipboard(text: string, expectedKind: ClipboardKind): LineupSystem | Hero | ChampionLoadout {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("剪贴板内容不是有效 JSON"); }
  const envelope = record(parsed, "剪贴板数据");
  if (envelope.format !== "zys-clipboard" || envelope.version !== 1) throw new Error("不支持的剪贴板格式或版本");
  if (envelope.kind !== expectedKind) throw new Error(`剪贴板类型不匹配，期望 ${expectedKind}`);
  if (expectedKind === "system") return validateSystem(envelope.payload);
  if (expectedKind === "hero") return validateHero(envelope.payload);
  return validateChampionLoadout(envelope.payload);
}

export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("无法访问剪贴板，请检查系统权限");
}

export async function readClipboard(): Promise<string | null> {
  if (navigator.clipboard?.readText) return navigator.clipboard.readText();
  return window.prompt("请粘贴从英雄体系搭配导出的配置 JSON：");
}

function safeFilename(value: string): string {
  const withoutControlCharacters = [...value].map((character) => character.charCodeAt(0) < 32 ? "-" : character).join("");
  return withoutControlCharacters.replace(/[\\/:*?"<>|]/g, "-").trim() || "英雄体系";
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d");
  if (!context) throw new Error("当前系统无法创建 PNG 画布");
  context.fillStyle = "#f3f5fa";
  context.fillRect(0, 0, width, height);
  return [output, context];
}

function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size = 22, color = "#24304a", weight = 400): void {
  context.fillStyle = color;
  context.font = `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  context.fillText(value, x, y);
}

function card(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(x, y, width, height, 18);
  context.fill();
}

async function downloadCanvas(output: HTMLCanvasElement, filename: string): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => {
    if (value?.type === "image/png") resolve(value);
    else reject(new Error("PNG 编码失败"));
  }, "image/png"));
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${safeFilename(filename)}.png`;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export async function exportLineupPng(system: LineupSystem, units: PartyUnit[]): Promise<void> {
  const rows = Math.max(system.heroes.length, system.championIds.length, 1);
  const [output, context] = canvas(1400, Math.max(700, 300 + rows * 82));
  context.fillStyle = "#282249";
  context.fillRect(0, 0, 1400, 168);
  text(context, "英雄体系搭配 · 完全离线版", 70, 68, 24, "#b9b4f4", 600);
  text(context, system.name, 70, 120, 42, "#ffffff", 700);
  text(context, system.description || "未填写体系说明", 70, 205, 21, "#77819b");
  text(context, `英雄 ${system.heroes.length} · 勇士 ${system.championIds.length} · 数据 ${system.gameDataVersion}`, 70, 245, 18, "#6255d9", 600);
  card(context, 60, 280, 620, rows * 76 + 90);
  card(context, 720, 280, 620, rows * 76 + 90);
  text(context, "英雄阵容", 92, 330, 27, "#343c56", 700);
  text(context, "勇士阵容", 752, 330, 27, "#343c56", 700);
  system.heroes.forEach((hero, index) => {
    const y = 382 + index * 76;
    text(context, hero.name, 92, y, 22, "#2d3650", 650);
    text(context, `${hero.className} · ${hero.element} · Lv.${hero.level} · Rank ${hero.rank}`, 92, y + 27, 15, "#77819b");
    text(context, `攻击 ${hero.stats.attack}  防御 ${hero.stats.defense}  生命 ${hero.stats.health}`, 350, y + 13, 15, "#59647d");
  });
  system.championIds.forEach((id, index) => {
    const unit = units.find((entry) => entry.id === id);
    const y = 382 + index * 76;
    text(context, unit?.name ?? id, 752, y, 22, "#2d3650", 650);
    if (unit) text(context, `${unit.element} · Lv.${unit.level} · Rank ${unit.rank} · 卡片 ${unit.cardLevel}`, 752, y + 27, 15, "#77819b");
  });
  text(context, `生成时间 ${new Date().toLocaleString()}`, 70, output.height - 38, 14, "#929aad");
  await downloadCanvas(output, `${system.name}-阵容`);
}

export async function exportHeroPng(hero: Hero, sheet?: CalculatedSheet): Promise<void> {
  const stats = sheet?.stats ?? { ...hero.stats, critical: hero.stats.crit, criticalDamage: 0, aggro: 0, elementValue: 0 };
  const [output, context] = canvas(1080, 760);
  context.fillStyle = "#282249";
  context.fillRect(0, 0, output.width, 168);
  text(context, "英雄配装模拟 · 完全离线版", 58, 60, 22, "#b9b4f4", 600);
  text(context, hero.name, 58, 112, 38, "#ffffff", 700);
  text(context, `${hero.className} · ${hero.element} · Lv.${hero.level} · 种子 ${hero.seed} · 卡片 ${hero.cardLevel}`, 58, 210, 19, "#646f88", 600);
  card(context, 48, 240, 984, 150);
  const metrics: Array<[string, string | number]> = [["生命", stats.health], ["攻击", stats.attack], ["防御", stats.defense], ["暴击", `${stats.critical}%`], ["回避", `${stats.evasion}%`], ["元素", stats.elementValue]];
  metrics.forEach(([label, value], index) => {
    const x = 78 + (index % 3) * 315;
    const y = 285 + Math.floor(index / 3) * 62;
    text(context, String(label), x, y, 14, "#81899b");
    text(context, typeof value === "number" ? value.toLocaleString() : value, x + 80, y, 23, "#30394e", 700);
  });
  text(context, "六槽装备", 58, 440, 25, "#343c56", 700);
  hero.equipment.forEach((equipment, index) => {
    const x = 58 + (index % 3) * 330;
    const y = 476 + Math.floor(index / 3) * 105;
    card(context, x, y, 300, 82);
    text(context, equipment.slot, x + 18, y + 28, 14, "#7a8295", 600);
    text(context, equipment.name || "未装备", x + 18, y + 56, 19, equipment.name ? "#343c56" : "#a4a9b5", 650);
    if (equipment.name) text(context, `${equipment.quality}${equipment.shiny ? " · 星能" : ""}${equipment.transcendence ? " · 超越" : ""}`, x + 160, y + 56, 12, "#685bd4", 600);
  });
  text(context, `生成时间 ${new Date().toLocaleString()}`, 58, 710, 13, "#929aad");
  await downloadCanvas(output, `${hero.name}-英雄配装`);
}

export async function exportChampionPng(champion: Champion, loadout: ChampionLoadout, sheet?: CalculatedSheet): Promise<void> {
  const stats = sheet?.stats ?? { ...(loadout.stats ?? champion.stats), critical: loadout.stats?.crit ?? champion.stats.crit, criticalDamage: 0, aggro: 0, elementValue: 0 };
  const [output, context] = canvas(980, 620);
  context.fillStyle = "#282249";
  context.fillRect(0, 0, output.width, 158);
  text(context, "勇士配装模拟 · 完全离线版", 54, 58, 21, "#b9b4f4", 600);
  text(context, champion.name, 54, 110, 38, "#ffffff", 700);
  text(context, `${champion.element} · Lv.${loadout.level} · 阶数 ${loadout.rank} · 种子 ${loadout.seed} · 卡片 ${loadout.cardLevel}`, 54, 200, 18, "#646f88", 600);
  card(context, 44, 228, 892, 142);
  const metrics: Array<[string, string | number]> = [["生命", stats.health], ["攻击", stats.attack], ["防御", stats.defense], ["暴击", `${stats.critical}%`], ["回避", `${stats.evasion}%`], ["元素", stats.elementValue]];
  metrics.forEach(([label, value], index) => {
    const x = 72 + (index % 3) * 285;
    const y = 270 + Math.floor(index / 3) * 58;
    text(context, label, x, y, 14, "#81899b");
    text(context, typeof value === "number" ? value.toLocaleString() : value, x + 72, y, 22, "#30394e", 700);
  });
  text(context, "勇士专属装备", 54, 420, 24, "#343c56", 700);
  [["使魔", loadout.familiarEquipment?.name || loadout.familiar], ["光环之歌", loadout.auraSongEquipment?.name || loadout.aurasong]].forEach(([label, value], index) => {
    const x = 54 + index * 444;
    card(context, x, 452, 410, 90);
    text(context, label!, x + 20, 482, 14, "#7a8295", 600);
    text(context, value || "未装备", x + 20, 520, 21, value ? "#343c56" : "#a4a9b5", 650);
  });
  text(context, `生成时间 ${new Date().toLocaleString()}`, 54, 584, 13, "#929aad");
  await downloadCanvas(output, `${champion.name}-勇士配装`);
}

export async function exportSimulationPng(task: AdventureTask, result: SimulationResult, members: PartyUnit[]): Promise<void> {
  const [output, context] = canvas(1200, 760);
  context.fillStyle = "#282249";
  context.fillRect(0, 0, 1200, 170);
  text(context, "冒险模拟结果", 64, 72, 26, "#b9b4f4", 600);
  text(context, task.name, 64, 126, 40, "#ffffff", 700);
  text(context, `${task.map} · ${task.difficulty} · ${task.config.iterations.toLocaleString()} 次`, 64, 215, 20, "#77819b");
  const metrics: Array<[string, string]> = [
    ["成功率", `${result.successRate}%`], ["平均回合", String(result.averageTurns)], ["存活率", `${result.survivalRate}%`],
    ["回合范围", `${result.minTurns} – ${result.maxTurns}`], ["平均伤害", result.averageDamage.toLocaleString()], ["平均剩余生命", result.averageRemainingHealth.toLocaleString()],
  ];
  metrics.forEach(([label, value], index) => {
    const x = 64 + (index % 3) * 370;
    const y = 260 + Math.floor(index / 3) * 145;
    card(context, x, y, 330, 112);
    text(context, value, x + 25, y + 48, 30, "#347b60", 700);
    text(context, label, x + 25, y + 80, 16, "#7a8496");
  });
  text(context, `队伍：${members.map((member) => member.name).join("、") || "无成员"}`, 64, 575, 20, "#505a72", 600);
  text(context, `模拟器 ${result.simulatorVersion} · 数据 ${result.gameDataVersion}`, 64, 624, 16, "#77819b");
  text(context, `完成时间 ${new Date(result.completedAt).toLocaleString()}`, 64, 665, 16, "#929aad");
  if (result.stale) text(context, "注意：数据版本已变化，此结果需要重新模拟", 64, 710, 17, "#a26d16", 650);
  await downloadCanvas(output, `${task.name}-模拟结果`);
}
