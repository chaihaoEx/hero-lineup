import type { AdventureTask, BuildTemplate, CalculatedSheet, CanonicalEquipment, CanonicalSystem, Champion, ChampionLoadout, Hero, LineupSystem, PartyUnit, Quality, SimulationProgress, SimulationResult, UnitStats } from "../types/domain";
import { previewCatalog, type Catalog } from "../data/catalog";

const STORAGE_KEY = "zys.hero-lineup.systems.v1";
const TEMPLATE_STORAGE_KEY = "zys.hero-lineup.templates.v1";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const slots = { "武器": "weapon", "头部": "head", "身体": "body", "手部": "hands", "脚部": "feet", "饰品": "accessory" } as const;
const reverseSlots = { weapon: "武器", head: "头部", body: "身体", hands: "手部", feet: "脚部", accessory: "饰品", familiar: "饰品", auraSong: "饰品" } as const;
const qualities = { "普通": "normal", "优质": "superior", "高级": "flawless", "史诗": "epic", "传说": "legendary" } as const;
const reverseQualities = { normal: "普通", superior: "优质", flawless: "高级", epic: "史诗", legendary: "传说" } as const;

export interface ContentStatus {
  source: "bundled" | "installed";
  appVersion: string;
  schemaVersion: number;
  gameDataVersion: string;
  simulatorVersion: string;
  assetVersion: string;
  minimumAppVersion: string;
  createdAt: string;
  files: number;
  totalBytes: number;
  statistics: Record<string, number>;
}

export interface DataPackageInstallResult {
  content: ContentStatus;
  verification: {
    filesChecked: number;
    jsonDocuments: number;
    totalBytes: number;
    warnings: string[];
  };
  staleSimulations: number;
}

const toEquipment = (equipment: LineupSystem["heroes"][number]["equipment"][number]): CanonicalEquipment => ({
  itemId: equipment.itemId ?? "", ...(equipment.name === undefined ? {} : { name: equipment.name }), slot: slots[equipment.slot], quality: qualities[equipment.quality],
  ...(equipment.element === undefined ? {} : { element: equipment.element }), ...(equipment.spirit === undefined ? {} : { spirit: equipment.spirit }), shiny: equipment.shiny,
  transcended: equipment.transcendence > 0, transcendence: equipment.transcendence,
});

const toChampionEquipment = (equipment: NonNullable<ChampionLoadout["familiarEquipment"]>, slot: "familiar" | "auraSong"): CanonicalEquipment => ({
  itemId: equipment.itemId ?? "", ...(equipment.name === undefined ? {} : { name: equipment.name }), slot,
  quality: qualities[equipment.quality], ...(equipment.element === undefined ? {} : { element: equipment.element }),
  ...(equipment.spirit === undefined ? {} : { spirit: equipment.spirit }), shiny: equipment.shiny,
  transcended: equipment.transcendence > 0, transcendence: equipment.transcendence,
});

const fromChampionEquipment = (equipment: CanonicalEquipment | undefined): ChampionLoadout["familiarEquipment"] => equipment ? ({
  ...(equipment.itemId ? { itemId: equipment.itemId } : {}), ...(equipment.name === undefined ? {} : { name: equipment.name }),
  quality: reverseQualities[equipment.quality] as Quality,
  ...(equipment.element === undefined ? {} : { element: equipment.element }), ...(equipment.spirit === undefined ? {} : { spirit: equipment.spirit }),
  shiny: equipment.shiny, transcendence: equipment.transcendence || (equipment.transcended ? 1 : 0),
}) : undefined;

export function toCanonicalSystem(system: LineupSystem): CanonicalSystem {
  const championIds = new Set(system.championIds);
  return {
    id: system.id, name: system.name, description: system.description, localPublic: system.localPublic, localTag: system.localTag,
    schemaVersion: system.schemaVersion, gameDataVersion: system.gameDataVersion,
    groups: system.taskGroups.map((group, sortOrder) => ({ id: group.id, name: group.name, sortOrder })),
    heroes: system.heroes.map((hero) => ({
      id: hero.id, classId: hero.classId, name: hero.name, level: hero.level, rank: hero.rank, seed: hero.seed,
      cardLevel: hero.cardLevel, className: hero.className, spritePath: hero.spritePath, element: hero.element,
      stats: hero.stats, titan: hero.titan, seedPoints: {}, equipment: hero.equipment.map(toEquipment),
      skillIds: hero.skills.filter(Boolean), cardLevels: {},
    })),
    champions: [...championIds].map((id) => {
      const loadout = system.championLoadouts[id] ?? { level: 1, rank: 1, seed: 0, cardLevel: 0, titan: false, familiar: "", aurasong: "" };
      return { id, loadoutPresent: Object.prototype.hasOwnProperty.call(system.championLoadouts, id), name: "", element: "", level: loadout.level, rank: loadout.rank, seed: loadout.seed, cardLevel: loadout.cardLevel, titan: loadout.titan,
        familiarId: loadout.familiarEquipment?.itemId ?? loadout.familiar, auraSongId: loadout.auraSongEquipment?.itemId ?? loadout.aurasong,
        ...(loadout.familiarEquipment ? { familiar: toChampionEquipment(loadout.familiarEquipment, "familiar") } : {}),
        ...(loadout.auraSongEquipment ? { auraSong: toChampionEquipment(loadout.auraSongEquipment, "auraSong") } : {}),
        stats: loadout.stats ?? { attack: 0, defense: 0, health: 0, evasion: 0, crit: 0 }, cardLevels: {} };
    }),
    equipmentOwnedCounts: system.equipmentOwnedCounts ?? { hero: {}, champion: {} },
    adventureTasks: system.taskGroups.flatMap((group) => group.tasks.map((task) => ({
      id: task.id, questId: task.questId ?? task.map, name: task.name, map: task.map, groupId: group.id,
      heroIds: task.memberIds.filter((id) => system.heroes.some((hero) => hero.id === id)),
      championIds: task.memberIds.filter((id) => championIds.has(id)), difficulty: ({ "简单": 1, "中等": 2, "困难": 3, "究极": 4, "泰坦之墓": 31 } as Record<string, number>)[task.difficulty]
        ?? Number(task.difficulty.match(/\d+/)?.[0] ?? 1),
      maxMembers: task.maxMembers, barrier: task.barrier, config: task.config, result: task.result,
      modifiers: [], simulation: task.result ? { result: task.result } : undefined,
    }))),
    createdAt: system.createdAt, updatedAt: system.updatedAt,
  };
}

export function fromCanonicalSystem(system: CanonicalSystem): LineupSystem {
  const taskGroups = [...system.groups].sort((a, b) => a.sortOrder - b.sortOrder).map((group) => ({
    id: group.id, name: group.name,
    tasks: system.adventureTasks.filter((task) => task.groupId === group.id).map((task) => ({
      id: task.id, questId: task.questId, name: task.name, map: task.map,
      difficulty: (["简单", "简单", "中等", "困难", "究极"][task.difficulty] ?? `难度${task.difficulty}`),
      maxMembers: task.maxMembers, memberIds: [...task.heroIds, ...task.championIds], barrier: task.barrier,
      config: task.config, result: task.result,
    })),
  }));
  return {
    id: system.id, name: system.name, description: system.description, localPublic: system.localPublic,
    localTag: (system.localTag === "示例" || system.localTag === "收藏") ? system.localTag : "本地",
    heroes: system.heroes.map((hero) => ({
      id: hero.id, kind: "hero", name: hero.name, classId: hero.classId, className: hero.className,
      spritePath: hero.spritePath, element: (hero.element || "光") as LineupSystem["heroes"][number]["element"],
      level: hero.level, rank: hero.rank, seed: hero.seed, titan: hero.titan, cardLevel: hero.cardLevel,
      skills: [...hero.skillIds], stats: hero.stats,
      equipment: hero.equipment.map((equipment) => ({ ...(equipment.itemId ? { itemId: equipment.itemId } : {}), ...(equipment.name === undefined ? {} : { name: equipment.name }),
        slot: reverseSlots[equipment.slot], quality: reverseQualities[equipment.quality] as Quality,
        ...(equipment.element === undefined ? {} : { element: equipment.element as LineupSystem["heroes"][number]["element"] }), ...(equipment.spirit === undefined ? {} : { spirit: equipment.spirit }),
        shiny: equipment.shiny, transcendence: equipment.transcendence || (equipment.transcended ? 1 : 0) })),
    })),
    championIds: system.champions.map((champion) => champion.id),
    championLoadouts: Object.fromEntries(system.champions.filter((champion) => champion.loadoutPresent).map((champion) => [champion.id, {
      level: champion.level, rank: champion.rank, seed: champion.seed, cardLevel: champion.cardLevel, titan: champion.titan,
      familiar: champion.familiarId, aurasong: champion.auraSongId,
      ...(champion.familiar ? { familiarEquipment: fromChampionEquipment(champion.familiar) } : {}),
      ...(champion.auraSong ? { auraSongEquipment: fromChampionEquipment(champion.auraSong) } : {}), stats: champion.stats,
    }])),
    equipmentOwnedCounts: system.equipmentOwnedCounts ?? { hero: {}, champion: {} },
    taskGroups, createdAt: system.createdAt, updatedAt: system.updatedAt,
    schemaVersion: system.schemaVersion, gameDataVersion: system.gameDataVersion,
  };
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

function previewSheet(stats: UnitStats): CalculatedSheet {
  return {
    stats: { health: stats.health, attack: stats.attack, defense: stats.defense, evasion: stats.evasion,
      critical: stats.crit, criticalDamage: 2, aggro: 0, elementValue: 0 },
    issues: [], applied: { source: "browser-preview" },
  };
}

export const desktopBridge = {
  isDesktop: isTauri,

  async loadCatalog(): Promise<Catalog> {
    if (isTauri()) return invoke<Catalog>("load_catalog");
    return previewCatalog;
  },

  async getContentStatus(): Promise<ContentStatus | null> {
    if (!isTauri()) return null;
    return invoke<ContentStatus>("get_content_status");
  },

  /** Opens the native file picker and atomically installs a verified local `.zysdata` package. */
  async installDataPackage(): Promise<DataPackageInstallResult | null> {
    if (!isTauri()) throw new Error("离线数据包安装仅在桌面应用中可用");
    return invoke<DataPackageInstallResult | null>("pick_install_data_package");
  },

  async listSystems(): Promise<LineupSystem[]> {
    if (isTauri()) return (await invoke<CanonicalSystem[]>("list_systems")).map(fromCanonicalSystem);
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LineupSystem[]) : [];
  },

  async saveSystem(system: LineupSystem): Promise<LineupSystem> {
    const saved = { ...system, updatedAt: new Date().toISOString() };
    if (isTauri()) return fromCanonicalSystem(await invoke<CanonicalSystem>("save_system", { system: toCanonicalSystem(saved) }));
    const systems = await this.listSystems();
    const index = systems.findIndex((entry) => entry.id === saved.id);
    if (index >= 0) systems[index] = saved;
    else systems.push(saved);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(systems));
    return saved;
  },

  async deleteSystem(id: string): Promise<void> {
    if (isTauri()) return invoke<void>("delete_system", { id });
    const systems = (await this.listSystems()).filter((entry) => entry.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(systems));
  },

  async listTemplates(): Promise<BuildTemplate[]> {
    if (isTauri()) return invoke<BuildTemplate[]>("list_templates");
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BuildTemplate[]) : [];
  },

  async saveTemplate(template: BuildTemplate): Promise<BuildTemplate> {
    const saved = { ...template, updatedAt: new Date().toISOString() };
    if (isTauri()) return invoke<BuildTemplate>("save_template", { template: saved });
    const templates = await this.listTemplates();
    const index = templates.findIndex((entry) => entry.id === saved.id);
    if (index >= 0) templates[index] = saved;
    else templates.push(saved);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    return saved;
  },

  async deleteTemplate(id: string): Promise<void> {
    if (isTauri()) return invoke<void>("delete_template", { id });
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify((await this.listTemplates()).filter((entry) => entry.id !== id)));
  },

  async calculateHero(hero: Hero): Promise<CalculatedSheet> {
    if (!isTauri()) return previewSheet(hero.stats);
    return invoke<CalculatedSheet>("calculate_hero_build", { build: {
      id: hero.id, classId: hero.classId, name: hero.name, level: hero.level, rank: hero.rank,
      seed: hero.seed, cardLevel: hero.cardLevel, className: hero.className, spritePath: hero.spritePath,
      element: hero.element, stats: hero.stats, titan: hero.titan, seedPoints: {},
      equipment: hero.equipment.map(toEquipment), skillIds: hero.skills.filter(Boolean), cardLevels: {},
    } });
  },

  async calculateChampion(champion: Champion, loadout: ChampionLoadout): Promise<CalculatedSheet> {
    if (!isTauri()) return previewSheet(loadout.stats ?? champion.stats);
    const equipment = (itemId: string, slot: "familiar" | "auraSong"): CanonicalEquipment => ({ itemId, slot, quality: "normal", shiny: false, transcended: false, transcendence: 0 });
    const familiar = loadout.familiarEquipment ? toChampionEquipment(loadout.familiarEquipment, "familiar") : (loadout.familiar ? equipment(loadout.familiar, "familiar") : undefined);
    const auraSong = loadout.auraSongEquipment ? toChampionEquipment(loadout.auraSongEquipment, "auraSong") : (loadout.aurasong ? equipment(loadout.aurasong, "auraSong") : undefined);
    return invoke<CalculatedSheet>("calculate_champion_build", { build: {
      id: champion.id, loadoutPresent: true, name: champion.name, classId: champion.classId,
      spritePath: champion.spritePath, element: champion.element, level: loadout.level, rank: loadout.rank, seed: loadout.seed,
      cardLevel: loadout.cardLevel, titan: loadout.titan, familiarId: familiar?.itemId ?? loadout.familiar, auraSongId: auraSong?.itemId ?? loadout.aurasong,
      stats: loadout.stats ?? champion.stats,
      ...(familiar ? { familiar } : {}), ...(auraSong ? { auraSong } : {}), cardLevels: {},
    } });
  },

  async exportSystems(systems: LineupSystem[]): Promise<string> {
    if (systems.length !== 1) throw new Error(".zyslineup 每个文件只能包含一个体系");
    if (isTauri()) return invoke<string>("export_system", { system: toCanonicalSystem(systems[0]!) });
    throw new Error("规范校验与 checksum 导出仅在桌面应用中可用");
  },

  async importSystems(payload: string, expectedGameDataVersion: string): Promise<LineupSystem[]> {
    if (isTauri()) return (await invoke<CanonicalSystem[]>("import_systems", { payload, expectedGameDataVersion })).map(fromCanonicalSystem);
    throw new Error("规范校验与持久化导入仅在桌面应用中可用");
  },

  async exportBackup(gameDataVersion: string): Promise<string> {
    if (!isTauri()) throw new Error("完整备份仅在桌面应用中可用");
    return invoke<string>("export_backup_file", { gameDataVersion });
  },

  async restoreBackup(payload: string, expectedGameDataVersion: string, confirmed: boolean): Promise<LineupSystem[]> {
    if (!isTauri()) throw new Error("完整备份恢复仅在桌面应用中可用");
    return (await invoke<CanonicalSystem[]>("restore_backup_file", { payload, expectedGameDataVersion, confirmed })).map(fromCanonicalSystem);
  },

  async saveInterchange(payload: string, suggestedName: string, extension: "zyslineup" | "zysbackup"): Promise<boolean> {
    if (!isTauri()) return false;
    return invoke<boolean>("pick_write_interchange", { payload, suggestedName, extension });
  },

  async openInterchange(extension: "zyslineup" | "zysbackup"): Promise<string | null> {
    if (!isTauri()) return null;
    return invoke<string | null>("pick_read_interchange", { extension });
  },

  async simulate(
    task: AdventureTask,
    units: PartyUnit[],
    onProgress: (progress: SimulationProgress) => void,
    signal: AbortSignal,
    systemId?: string,
  ): Promise<SimulationResult> {
    if (isTauri()) {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<SimulationProgress>(`simulation-progress:${task.id}`, ({ payload }) => onProgress(payload));
      const abort = () => void invoke("cancel_simulation", { taskId: task.id });
      signal.addEventListener("abort", abort, { once: true });
      try {
        return await invoke<SimulationResult>("start_simulation", { request: { task, units, systemId } });
      } finally {
        signal.removeEventListener("abort", abort);
        unlisten();
      }
    }

    const steps = 25;
    for (let step = 1; step <= steps; step += 1) {
      if (signal.aborted) throw new DOMException("模拟已取消", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 16));
      onProgress({ taskId: task.id, completed: Math.round((task.config.iterations * step) / steps), total: task.config.iterations, phase: "running" });
    }
    return {
      iterations: task.config.iterations,
      successRate: 87.4, averageTurns: 8.6, minTurns: 5, maxTurns: 17, survivalRate: 92.1,
      averageDamage: 18640, averageRemainingHealth: 2830, simulatorVersion: "browser-preview",
      gameDataVersion: "offline-preview-1", completedAt: new Date().toISOString(),
      memberResults: units.map((unit, index) => ({
        id: unit.id, survivalRate: Math.max(0, 94.6 - index * 2.1),
        averageDamage: Math.round(18640 / Math.max(1, units.length) * (1 + index * 0.08)),
        averageRemainingHealth: Math.round(2830 / Math.max(1, units.length) * (1 - index * 0.06)),
      })),
    };
  },

  async assetUrl(relativePath: string): Promise<string> {
    const safe = relativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
    if (safe.split("/").includes("..")) throw new Error("资源路径不能包含上级目录");
    if (!isTauri()) return `/offline-assets/${safe}`;
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    const absolute = await invoke<string>("resolve_content_asset", { relativePath: safe });
    return convertFileSrc(absolute, "asset");
  },
};
