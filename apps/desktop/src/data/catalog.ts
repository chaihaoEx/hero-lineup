import type { Champion, ElementType, EquipmentSlot, Hero, LineupSystem, UnitStats } from "../types/domain";

export const elements: ElementType[] = ["火", "水", "土", "风", "光", "暗"];

export interface CatalogClass {
  id: string;
  name: string;
  /** Upstream skill eligibility group, e.g. fighter/spellcaster. */
  type: string;
  /** Class-owned skill family. It is displayed separately and cannot be replaced. */
  innateSkillFamily?: string;
  /** Number of elective skill slots unlocked by this class. */
  skillSlots: number;
  /** Upstream skl1Lv..skl4Lv values; zero means that the slot does not exist. */
  skillUnlockLevels: number[];
  /** Base classes cap skills at tier 3; promoted classes cap them at tier 4. */
  maxSkillLevel: 3 | 4;
  element: ElementType;
  /** Upstream `all` element used by Red Mage and Spellknight. */
  allElements?: boolean;
  color: string;
  spritePath?: string;
  /** Six equipment slots, each containing the accepted upstream item type codes. */
  slots: string[][];
  stats: UnitStats;
}

export interface CatalogChampion {
  id: string;
  name: string;
  classId: string;
  element: ElementType;
  spritePath?: string;
  teamSkillIds: string[];
  teamSkills: CatalogTeamSkill[];
  stats: UnitStats;
}

export interface CatalogTeamSkill {
  id: string;
  name: string;
  tier: number;
  spritePath?: string;
  effects: string[];
}

export interface CatalogQuest {
  id: string;
  name: string;
  mapName: string;
  /** Label shown in the first-stage map grid when it differs from the task title. */
  mapLabel?: string;
  mapKey: string;
  category: "普通冒险" | "黄金城" | "泰坦塔" | "快闪";
  difficulty: string;
  difficultyLevel: number;
  /** Stable online order for variants that share one difficulty level (Titan Tower). */
  variantOrder?: number;
  isBoss: boolean;
  maxMembers: number;
  /** Every possible barrier element; some quests randomly choose among several. */
  barrierElements?: ElementType[];
  barrierElement?: ElementType;
  barrierPower: number;
  spritePath?: string;
  /** Map/area art used by the first-stage picker and task card. */
  mapSpritePath?: string;
  /** Difficulty badge used by the second-stage picker and task card. */
  difficultySpritePath?: string;
  /** Optional layered background used by Titan Tower difficulty badges. */
  difficultyBackgroundPath?: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  itemType: string;
  typeName: string;
  tier: number;
  /** Upstream crafting unlock level; online uses it as the same-tier secondary order. */
  level?: number;
  sourceOrder?: number;
  restrictedClass?: string;
  spritePath?: string;
  attack?: number;
  defense?: number;
  health?: number;
  evasion?: number;
  critical?: number;
  /** Full five-step Star Forge base-stat multiplier from upgradeShiny1..5. */
  shinyMultiplier?: number;
  /** Transcend base-stat multiplier and flat bonuses from supgrade4..6. */
  transcendMultiplier?: number;
  transcendAttack?: number;
  transcendDefense?: number;
  transcendHealth?: number;
  transcendEvasion?: number;
  transcendCritical?: number;
  elements?: string;
  skill?: string;
  elementAffinity?: string;
  spiritAffinity?: string;
  /** Attachment permanently supplied by the item (`lTag2` / `lTag3`). */
  builtInElementId?: string;
  builtInSpiritId?: string;
}

export type EquipmentApplyField = "quality" | "shiny" | "transcendence" | "element" | "spirit";

/** Mirrors the online picker's “全部应用”: only equipped slots are changed and built-in enchants win. */
export function applyEquipmentFieldToAll(equipment: EquipmentSlot[], catalog: Catalog, source: EquipmentSlot, field: EquipmentApplyField): EquipmentSlot[] {
  return equipment.map((entry) => {
    if (!entry.itemId) return entry;
    const item = catalog.items.find((candidate) => candidate.id === entry.itemId);
    if (field === "element" && item?.builtInElementId) return entry;
    if (field === "spirit" && item?.builtInSpiritId) return entry;
    return { ...entry, [field]: source[field] };
  });
}

export interface CatalogSkill {
  id: string;
  name: string;
  family: string;
  category?: string;
  tier: number;
  classes: string[];
  rarity: number;
  /** Element points required for this tier. */
  elements: number;
  rank: number;
  sourceOrder?: number;
  spritePath?: string;
  effects: string[];
  /** Numeric plus class-mechanic text shown under the fixed innate skill. */
  innateEffects?: string[];
}

export interface Catalog {
  schemaVersion: number;
  gameDataVersion: string;
  assetVersion: string;
  classes: CatalogClass[];
  champions: CatalogChampion[];
  quests: CatalogQuest[];
  items: CatalogItem[];
  skills: CatalogSkill[];
  counts: { classes: number; champions: number; quests: number; items: number; skills: number; sprites: number };
}

const defaultStats: UnitStats = { attack: 840, defense: 620, health: 4200, evasion: 10, crit: 15 };
/** Upstream class slot1..slot6 order: weapon, armor, gauntlets, helmet, boots, accessory. */
export const heroSlotNames: EquipmentSlot["slot"][] = ["武器", "身体", "手部", "头部", "脚部", "饰品"];
const legacyWrongSlotNames: EquipmentSlot["slot"][] = ["武器", "头部", "身体", "手部", "脚部", "饰品"];

/** Repairs builds saved by the early offline UI whose labels did not match slot1..slot6. */
export function normalizeHeroEquipmentSlots(hero: Hero): Hero {
  const current = hero.equipment.map((entry) => entry.slot);
  const isLegacyOrder = current.length === legacyWrongSlotNames.length
    && current.every((slot, index) => slot === legacyWrongSlotNames[index]);
  if (isLegacyOrder) {
    return { ...hero, equipment: hero.equipment.map((entry, index) => ({ ...entry, slot: heroSlotNames[index]! })) };
  }
  const bySlot = new Map(hero.equipment.map((entry) => [entry.slot, entry]));
  return {
    ...hero,
    equipment: heroSlotNames.map((slot) => ({
      ...(bySlot.get(slot) ?? { quality: "普通" as const, shiny: false, transcendence: 0 }),
      slot,
    })),
  };
}

/**
 * Canonical storage keeps the exact quest id and numeric difficulty. Rehydrate all
 * display fields from the active catalog so Titan variants and localized Flash
 * Quest names survive save/reload without duplicating presentation strings in SQLite.
 */
export function normalizeQuestPresentation(system: LineupSystem, catalog: Catalog): LineupSystem {
  const byId = new Map(catalog.quests.map((quest) => [quest.id, quest]));
  const championIds = new Set(catalog.champions.map((champion) => champion.id));
  return {
    ...system,
    taskGroups: system.taskGroups.map((group) => ({
      ...group,
      tasks: group.tasks.map((task) => {
        const quest = task.questId ? byId.get(task.questId) : undefined;
        let championSeen = false;
        const memberIds = task.memberIds.filter((id) => {
          if (!championIds.has(id)) return true;
          if (championSeen) return false;
          championSeen = true;
          return true;
        });
        return quest ? {
          ...task,
          memberIds,
          name: quest.name,
          map: quest.mapName,
          difficulty: quest.difficulty,
          maxMembers: quest.maxMembers,
        } : { ...task, memberIds };
      }),
    })),
  };
}

/** Used only by browser preview and tests; packaged applications always load the full Rust catalog. */
export const previewCatalog: Catalog = {
  schemaVersion: 1,
  gameDataVersion: "browser-preview",
  assetVersion: "browser-preview",
  classes: [{ id: "knight", name: "骑士", type: "fighter", innateSkillFamily: "c_knight", skillSlots: 3, skillUnlockLevels: [5, 10, 23, 0], maxSkillLevel: 3, element: "光", allElements: false, color: "#f4b942", slots: [["ws", "wa"], ["ah"], ["gh"], ["hh"], ["bh"], ["xs"]], stats: defaultStats }],
  champions: [{ id: "argon", name: "阿尔贡", classId: "knight", element: "光", teamSkillIds: ["argonleader1", "argonleader2", "argonleader3", "argonleader4"], teamSkills: [
    { id: "argonleader1", name: "勇气光环", tier: 1, effects: ["为小队 +10% 额外攻击力、+10% 额外防御力"] },
    { id: "argonleader2", name: "决心光环", tier: 2, effects: ["为小队 +20% 额外攻击力、+20% 额外防御力"] },
    { id: "argonleader3", name: "英雄光环", tier: 3, effects: ["为小队 +30% 额外攻击力、+30% 额外防御力"] },
    { id: "argonleader4", name: "圣骑光环", tier: 4, effects: ["为小队 +40% 额外攻击力、+40% 额外防御力"] },
  ], stats: defaultStats }],
  quests: [
    { id: "forest01", name: "咆哮森林", mapName: "咆哮森林", mapKey: "forest:normal", category: "普通冒险", difficulty: "简单", difficultyLevel: 0, isBoss: false, maxMembers: 4, barrierPower: 0, mapSpritePath: "Sprite/icon_global_questarea_forest_small.png", difficultySpritePath: "Sprite/icon_difficulty_easy.png" },
    ...(["alpha", "beta", "gamma", "delta", "epsilon", "terror"] as const).map((variant, variantOrder): CatalogQuest => ({
      id: `titantower01_${variant}`,
      name: "泰坦之塔1层",
      mapName: "泰坦之塔1层",
      mapLabel: "第1层",
      mapKey: "titantower:0",
      category: "泰坦塔",
      difficulty: ["阿尔法", "贝塔", "伽马", "德尔塔", "艾普斯龙", "奇异"][variantOrder]!,
      difficultyLevel: 0,
      variantOrder,
      isBoss: false,
      maxMembers: 3,
      barrierPower: 0,
      mapSpritePath: "Sprite/icon_global_questarea_titantower_small.png",
      difficultySpritePath: `Sprite/icon_global_titantower_${variant}_big.png`,
      difficultyBackgroundPath: "Sprite/icon_global_skill_bg_titan.png",
    })),
  ],
  items: [
    { id: "shortsword", name: "学徒短剑", itemType: "ws", typeName: "剑", tier: 1, level: 1, attack: 16, shinyMultiplier: 1, transcendMultiplier: 1.1, transcendAttack: 2, transcendDefense: 1, elementAffinity: "ember", spiritAffinity: "behemoth" },
    { id: "ember", name: "余烬元素", itemType: "z", typeName: "元素附魔", tier: 4, attack: 16, defense: 11, health: 3, elements: "fire+5" },
    { id: "behemoth", name: "比蒙精魂", itemType: "z", typeName: "精萃附魔", tier: 14, attack: 164, defense: 109, health: 33, skill: "i_behemoth" },
  ],
  skills: [
    { id: "c_knight1", name: "堡垒", family: "c_knight", tier: 1, classes: [], rarity: 0, elements: 0, rank: 0, effects: ["重甲防御 +40%"], innateEffects: ["+40% 防御"] },
    { id: "c_knight4", name: "无私英雄", family: "c_knight", tier: 4, classes: [], rarity: 0, elements: 150, rank: 0, effects: ["重甲防御 +75%"], innateEffects: ["+75% 防御"] },
    { id: "p_cleave1", name: "裂痕", family: "p_cleave", tier: 1, classes: ["fighter"], rarity: 0, elements: 0, rank: 16, effects: ["攻击 +30%", "生命 +10"] },
    { id: "p_cleave4", name: "狱火风暴", family: "p_cleave", tier: 4, classes: ["fighter"], rarity: 0, elements: 150, rank: 18, effects: ["攻击 +80%", "生命 +75"] },
  ],
  counts: { classes: 1, champions: 1, quests: 1, items: 3, skills: 4, sprites: 0 },
};

export function championElementValue(rank: number): number {
  if (rank <= 4) return 0;
  if (rank === 5) return 15;
  if (rank <= 7) return 30;
  if (rank === 8) return 45;
  if (rank === 9) return 60;
  if (rank <= 11) return 80;
  if (rank <= 13) return 90;
  if (rank <= 15) return 100;
  if (rank <= 19) return 110;
  return 125;
}

export function catalogChampions(catalog: Catalog): Champion[] {
  return catalog.champions.map((entry) => ({
    id: entry.id, kind: "champion", name: entry.name, classId: entry.classId,
    element: entry.element, spritePath: entry.spritePath,
    level: 40, rank: 11, cardLevel: 0, stats: { ...entry.stats, element: championElementValue(11) },
  }));
}

export function itemsForSlot(catalog: Catalog, classId: string, slotIndex: number): CatalogItem[] {
  const acceptedTypes = catalog.classes.find((entry) => entry.id === classId)?.slots[slotIndex] ?? [];
  return catalog.items.filter((item) => acceptedTypes.includes(item.itemType)
    && (!item.restrictedClass || item.restrictedClass.split(",").map((value) => value.trim()).includes(classId)));
}

/** One level-1 card per selectable family, following the upstream class/type wildcard rules. */
export function skillsForClass(catalog: Catalog, classId: string): CatalogSkill[] {
  const heroClass = catalog.classes.find((entry) => entry.id === classId);
  if (!heroClass) return [];
  return catalog.skills.filter((skill) => skill.tier === 1
    && skill.family !== heroClass.innateSkillFamily
    && (skill.classes.includes("*") || skill.classes.includes(heroClass.id) || skill.classes.includes(heroClass.type)))
    .sort((left, right) => right.rarity - left.rarity || (right.sourceOrder ?? right.rank) - (left.sourceOrder ?? left.rank));
}

/** Online hides skills whose family or non-empty category is already used by another slot. */
export function skillsForSlot(catalog: Catalog, classId: string, selectedIds: string[], slotIndex: number): CatalogSkill[] {
  const used = selectedIds.flatMap((id, index) => index === slotIndex ? [] : catalog.skills.filter((skill) => skill.id === id));
  const usedFamilies = new Set(used.map((skill) => skill.family));
  const usedCategories = new Set(used.flatMap((skill) => skill.category ? [skill.category] : []));
  return skillsForClass(catalog, classId).filter((skill) => !usedFamilies.has(skill.family) && (!skill.category || !usedCategories.has(skill.category)));
}

export function makeHero(catalog: Catalog, classId = catalog.classes[0]?.id ?? "knight", index = 1): Hero {
  const heroClass = catalog.classes.find((entry) => entry.id === classId) ?? catalog.classes[0];
  if (!heroClass) throw new Error("本地职业目录为空");
  return {
    id: crypto.randomUUID(), kind: "hero", name: `${heroClass.name}${index}`,
    classId: heroClass.id, className: heroClass.name, element: heroClass.element,
    spritePath: heroClass.spritePath,
    level: 40, rank: 1, seed: 0, titan: false, cardLevel: 0, skills: [],
    equipment: heroSlotNames.map((slot) => ({ slot, quality: "普通", shiny: false, transcendence: 0 })),
    stats: { ...heroClass.stats },
  };
}

export function makeDefaultSystem(catalog: Catalog): LineupSystem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), name: "默认体系", description: "我的离线英雄搭配方案", localPublic: true, localTag: "本地",
    heroes: [], championIds: catalog.champions.map((champion) => champion.id), championLoadouts: {}, taskGroups: [],
    createdAt: now, updatedAt: now, schemaVersion: 1, gameDataVersion: catalog.gameDataVersion,
  };
}
