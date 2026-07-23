import templateSnapshot from "./heroTemplates.generated.json";
import { heroSlotNames, itemsForSlot, makeHero, skillsForClass, type Catalog } from "./catalog";
import type { Hero, Quality } from "../types/domain";

export interface OnlineHeroTemplate {
  id: string;
  heroClass: string;
  name: string;
  configString: string;
}

interface OnlineEquipmentConfig {
  itemId?: string;
  quality?: string;
  elementId?: string;
  spiritId?: string;
  shiny?: boolean;
  transcended?: boolean;
  transcendence?: number;
}

export interface OnlineHeroConfig {
  heroId?: string;
  heroName?: string;
  heroClass: string;
  level: number;
  seedHp?: number;
  seedAtk?: number;
  seedDef?: number;
  cardLevel?: number;
  skills?: string[];
  equipment?: Record<string, OnlineEquipmentConfig>;
}

const qualityMap: Record<string, Quality> = {
  common: "普通",
  normal: "普通",
  uncommon: "优质",
  superior: "优质",
  flawless: "高级",
  epic: "史诗",
  legendary: "传说",
};
const onlineQualityMap: Record<Quality, string> = {
  普通: "common",
  优质: "uncommon",
  高级: "flawless",
  史诗: "epic",
  传说: "legendary",
};

export const bundledHeroTemplates = templateSnapshot.templates as OnlineHeroTemplate[];
export const heroTemplateSnapshotDate = templateSnapshot.generatedAt;

export function templatesForClass(classId: string): OnlineHeroTemplate[] {
  return bundledHeroTemplates.filter((template) => template.heroClass === classId);
}

export function decodeOnlineHeroTemplate(template: OnlineHeroTemplate): OnlineHeroConfig {
  const config = decodeOnlineHeroConfig(template.configString);
  if (config.heroClass !== template.heroClass) throw new Error(`模板“${template.name}”职业不匹配`);
  return config;
}

export function decodeOnlineHeroConfig(configString: string): OnlineHeroConfig {
  const encoded = configString.trim().split(/\s+/).at(-1);
  if (!encoded) throw new Error("配置码缺少配置内容");
  try {
    const config = JSON.parse(decodeURIComponent(atob(encoded))) as OnlineHeroConfig;
    if (!config.heroClass || !Number.isFinite(config.level)) throw new Error("字段缺失");
    return config;
  } catch {
    throw new Error("不是有效的线上英雄配置码");
  }
}

function applyConfig(catalog: Catalog, config: OnlineHeroConfig, hero: Hero): Hero {
  const equipment = heroSlotNames.map((slot, slotIndex) => {
    const source = config.equipment?.[`slot${slotIndex + 1}`];
    const allowedItems = itemsForSlot(catalog, hero.classId, slotIndex);
    const item = source?.itemId ? allowedItems.find((entry) => entry.id === source.itemId) : undefined;
    return {
      slot,
      ...(item ? { itemId: item.id } : {}),
      ...(item ? { name: item.name } : {}),
      quality: qualityMap[source?.quality ?? "normal"] ?? "普通",
      ...(source?.elementId ? { element: source.elementId } : {}),
      ...(source?.spiritId ? { spirit: source.spiritId } : {}),
      shiny: Boolean(source?.shiny),
      transcendence: source?.transcendence ?? (source?.transcended ? 1 : 0),
    };
  });
  const heroClass = catalog.classes.find((entry) => entry.id === hero.classId);
  const selectableFamilies = new Set(skillsForClass(catalog, hero.classId).map((skill) => skill.family));
  const skillSlots = heroClass?.skillSlots ?? 4;
  const usedFamilies = new Set<string>();
  const usedCategories = new Set<string>();
  const skills = Array.from({ length: skillSlots }, (_, index) => {
    const id = config.skills?.[index];
    const skill = id ? catalog.skills.find((entry) => entry.id === id) : undefined;
    const category = skill?.category;
    const unlockLevel = heroClass?.skillUnlockLevels[index] ?? 0;
    if (!skill || !selectableFamilies.has(skill.family) || unlockLevel === 0 || config.level < unlockLevel
      || usedFamilies.has(skill.family) || Boolean(category && usedCategories.has(category))) return "";
    usedFamilies.add(skill.family);
    if (category) usedCategories.add(category);
    return skill.id;
  });
  return {
    ...hero,
    level: Math.max(1, Math.min(50, config.level || hero.level)),
    seed: Math.max(0, Math.min(80, config.seedHp ?? 0)),
    cardLevel: Math.max(0, Math.min(3, config.cardLevel ?? 0)),
    skills,
    equipment,
  };
}

export function makeHeroFromOnlineTemplate(catalog: Catalog, template: OnlineHeroTemplate, index: number): Hero {
  const config = decodeOnlineHeroTemplate(template);
  return applyConfig(catalog, config, makeHero(catalog, template.heroClass, index));
}

export function importOnlineHeroConfig(catalog: Catalog, configString: string, existing: Hero): Hero {
  const config = decodeOnlineHeroConfig(configString);
  return applyConfig(catalog, config, existing);
}

export function encodeOnlineHeroConfig(hero: Hero): string {
  const equipment = Object.fromEntries(hero.equipment.map((entry, index) => [`slot${index + 1}`, {
    ...(entry.itemId ? { itemId: entry.itemId } : {}),
    quality: onlineQualityMap[entry.quality],
    ...(entry.element ? { elementId: entry.element } : {}),
    ...(entry.spirit ? { spiritId: entry.spirit } : {}),
    shiny: entry.shiny,
    ...(entry.transcendence ? { transcended: true, transcendence: entry.transcendence } : {}),
  }]));
  const config: OnlineHeroConfig = {
    heroId: hero.id,
    heroName: hero.name,
    heroClass: hero.classId,
    level: hero.level,
    seedHp: hero.seed,
    seedAtk: hero.seed,
    seedDef: hero.seed,
    cardLevel: hero.cardLevel,
    skills: hero.skills,
    equipment,
  };
  return `【传奇智游社 | ${hero.className}英雄配置（可在英雄体系搭配平台英雄配装面板导入）】\n${btoa(encodeURIComponent(JSON.stringify(config)))}`;
}
