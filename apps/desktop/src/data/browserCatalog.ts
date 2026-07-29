import type {
  Catalog,
  CatalogItem,
  CatalogQuest,
  CatalogSkill,
} from "./catalog";
import type { ElementType, UnitStats } from "../types/domain";

type Raw = Record<string, unknown>;

const CONTENT_ROOT = "/offline-assets";
const classOrder = [
  "soldier", "mercenary", "barbarian", "chieftain", "knight", "lord",
  "ranger", "warden", "swordmaster", "daimyo", "berserker", "jarl",
  "darkknight", "deathknight", "thief", "trickster", "monk", "mastermonk",
  "musketeer", "conquistador", "wanderer", "pathfinder", "ninja", "sensei",
  "dancer", "acrobat", "velite", "praetorian", "mage", "archmage", "cleric",
  "bishop", "druid", "archdruid", "sorcerer", "warlock", "redmage",
  "spellknight", "geomancer", "astramancer", "chronomancer", "timekeeper",
];

const asRecord = (value: unknown): Raw => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};
const asText = (value: unknown, fallback = ""): string => typeof value === "string" ? value : fallback;
const asBool = (value: unknown): boolean => value === true;
const optional = <K extends string, T>(key: K, value: T | undefined): Partial<Record<K, T>> => value === undefined ? {} : { [key]: value } as Record<K, T>;
const numeric = (value: Raw, key: string): number => {
  const entry = value[key];
  if (typeof entry === "number") return Number.isFinite(entry) ? entry : 0;
  if (typeof entry === "string") return Number(entry) || 0;
  return 0;
};
const split = (value: unknown): string[] => asText(value).split(",").map((entry) => entry.trim()).filter(Boolean);
const element = (value: unknown): ElementType => ({
  fire: "火", water: "水", earth: "土", air: "风", dark: "暗",
  light: "光", gold: "光", all: "光",
} as Record<string, ElementType>)[asText(value)] ?? "光";
const elementColor = (value: ElementType): string => ({
  火: "#e96362", 水: "#4594dc", 土: "#9a7a52", 风: "#3fa982", 暗: "#7759c6", 光: "#f4b942",
})[value];
const compact = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
const stats = (value: Raw): UnitStats => ({
  attack: Math.round(Math.max(numeric(value, "maxAtk40"), numeric(value, "maxAtk"))),
  defense: Math.round(Math.max(numeric(value, "maxDef40"), numeric(value, "maxDef"))),
  health: Math.round(Math.max(numeric(value, "maxHp40"), numeric(value, "maxHp"))),
  evasion: numeric(value, "evasion") * 100,
  crit: numeric(value, "critical") * 100,
  aggro: numeric(value, "aggro"),
  criticalDamage: numeric(value, "critMult") * 100,
});
const statUpgrade = (value: unknown): number => {
  const match = asText(value).match(/^stat\+([\d.]+)$/);
  return match ? Number(match[1]) || 0 : 0;
};
const skillModifiers = (value: Raw) => ({
  item: numeric(value, "item"),
  attack: numeric(value, "atk"),
  defense: numeric(value, "def"),
  health: numeric(value, "hp"),
  attackFlat: numeric(value, "atkAbs"),
  defenseFlat: numeric(value, "defAbs"),
  healthFlat: numeric(value, "hpAbs"),
  evasion: numeric(value, "evasion"),
  critical: numeric(value, "critical"),
  criticalDamage: numeric(value, "critMult"),
  aggro: numeric(value, "aggro"),
  regeneration: numeric(value, "regen"),
});

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${CONTENT_ROOT}/${path}`);
  if (!response.ok) throw new Error(`无法加载完整本地目录：${path} (${response.status})`);
  return response.json() as Promise<T>;
}

function skillEffects(value: Raw): string[] {
  const effects: string[] = [];
  const item = numeric(value, "item");
  if (item) {
    const types = asText(value.itemTypes);
    const label = asBool(value.affectItselfOnly)
      ? "附魔本装备全属性"
      : types === "*" ? "所有装备攻防血" : types === "xs" ? "盾防御" : types.split(",").every((kind) => kind.startsWith("w")) ? "武器攻击" : "装备属性";
    effects.push(`${label} +${compact(item * 100)}%`);
    if (asText(value.questRestriction) === "titantower") effects.push("泰坦之塔/墓 +100%");
  }
  const elemental = numeric(value, "elementalItemCoreStatMultiplier");
  if (elemental) effects.push(`从自带元素的装备上获得+${compact(elemental * 100)}%攻防血属性加成`);
  for (const [key, label] of [["atk", "攻击"], ["def", "防御"], ["hp", "生命"], ["evasion", "回避"], ["critical", "暴击率"], ["critMult", "暴击伤害"], ["xp", "经验"]] as const) {
    const amount = numeric(value, key);
    if (amount) effects.push(`${label} +${compact(amount * 100)}%`);
  }
  for (const [key, label] of [["aggro", "威胁度"], ["regen", "回复"]] as const) {
    const amount = numeric(value, key);
    if (amount) effects.push(`${label} +${compact(amount)}`);
  }
  for (const [key, label] of [["atkAbs", "攻击"], ["defAbs", "防御"], ["hpAbs", "生命"]] as const) {
    const amount = numeric(value, key);
    if (amount) effects.push(`${label} +${compact(amount)}`);
  }
  return effects.length ? effects : ["无效果"];
}

function expressionFactor(expression: unknown, prefix: string): number | undefined {
  const raw = asText(expression);
  if (!raw.startsWith(prefix)) return undefined;
  const value = Number(raw.slice(prefix.length));
  return value > 0 ? value : undefined;
}

function itemUpgradeStats(value: Raw) {
  let shinyMultiplier = 1;
  for (let index = 1; index <= 5; index += 1) {
    shinyMultiplier *= expressionFactor(value[`upgradeShiny${index}`], "baseStats*") ?? 1;
  }
  const result = {
    shinyMultiplier, transcendMultiplier: 1, transcendAttack: 0, transcendDefense: 0,
    transcendHealth: 0, transcendEvasion: 0, transcendCritical: 0,
  };
  for (let index = 4; index <= 6; index += 1) {
    const expression = value[`supgrade${index}`];
    const multiplier = expressionFactor(expression, "baseStats*");
    if (multiplier) {
      result.transcendMultiplier *= multiplier;
      continue;
    }
    for (const [prefix, key] of [["atk+", "transcendAttack"], ["def+", "transcendDefense"], ["hp+", "transcendHealth"], ["eva+", "transcendEvasion"], ["crit+", "transcendCritical"]] as const) {
      const amount = expressionFactor(expression, prefix);
      if (amount) result[key] += amount;
    }
  }
  return result;
}

function titanVariant(id: string): { name: string; order: number } {
  const name = id.split("_").at(-1) ?? "alpha";
  return { name, order: ["alpha", "beta", "gamma", "delta", "epsilon", "terror"].indexOf(name) };
}

const titanLabel = (variant: string, tomb: boolean): string => {
  const labels = tomb
    ? { alpha: "阿尔法之墓", beta: "测试墓穴", gamma: "伽马墓", delta: "德尔塔墓穴", epsilon: "伊普西隆墓", terror: "恐怖墓穴" }
    : { alpha: "阿尔法", beta: "贝塔", gamma: "伽马", delta: "德尔塔", epsilon: "艾普斯龙", terror: "奇异" };
  return (labels as Record<string, string>)[variant] ?? (tomb ? "泰坦之墓" : "未知");
};

export async function loadBrowserCatalog(): Promise<Catalog> {
  const [manifest, classesRaw, championsRaw, questsRaw, itemsRaw, skillsRaw, modifiersRaw, typeDict, textFile] = await Promise.all([
    fetchJson<Raw>("manifest.json"),
    fetchJson<Raw>("TextAsset/classes.json"),
    fetchJson<Raw>("TextAsset/heroes.json"),
    fetchJson<Raw>("TextAsset/quests.json"),
    fetchJson<Raw>("TextAsset/items.json"),
    fetchJson<Raw>("TextAsset/skills.json"),
    fetchJson<Raw>("TextAsset/qmodifiers.json"),
    fetchJson<Raw>("TextAsset/items_type_dict.json"),
    fetchJson<{ texts: Record<string, string> }>("TextAsset/texts_zh.json"),
  ]);
  const texts = textFile.texts;
  const localized = (keys: string[], fallback: string): string => keys.map((key) => texts[key]).find((entry): entry is string => typeof entry === "string") ?? fallback;
  const spriteFiles = Array.isArray(manifest.files)
    ? manifest.files.map((entry) => asText(asRecord(entry).path)).filter((path) => path.startsWith("Sprite/"))
    : [];
  const spriteByLower = new Map(spriteFiles.map((path) => [path.toLowerCase(), path]));
  const chooseSprite = (candidates: string[], prefix: string): string | undefined => {
    for (const candidate of candidates) {
      const exact = spriteByLower.get(`sprite/${candidate}`.toLowerCase());
      if (exact) return exact;
    }
    const wanted = `sprite/${prefix}`.toLowerCase();
    return spriteFiles.find((path) => path.toLowerCase().startsWith(wanted));
  };

  const classes = Object.entries(classesRaw).map(([id, raw]) => {
    const value = asRecord(raw);
    const classElement = element(value.element);
    const maxSkillLevel: 3 | 4 = value.titanClass === null ? 4 : 3;
    return {
      id,
      name: localized([`class_${id}_name`], id),
      type: asText(value.type, id),
      ...optional("innateSkillFamily", asText(value.innate) || undefined),
      skillSlots: [1, 2, 3, 4].filter((index) => numeric(value, `skl${index}Lv`) > 0).length,
      skillUnlockLevels: [1, 2, 3, 4].map((index) => numeric(value, `skl${index}Lv`)),
      maxSkillLevel,
      element: classElement,
      allElements: value.element === "all",
      color: elementColor(classElement),
      ...optional("spritePath", chooseSprite([`icon_global_class_${id}.png`, `icon_global_class_${id}_128.png`], id)),
      slots: [1, 2, 3, 4, 5, 6].map((index) => split(value[`slot${index}`])),
      stats: stats(value),
    };
  }).sort((left, right) => classOrder.indexOf(left.id) - classOrder.indexOf(right.id));

  const champions = Object.entries(championsRaw)
    .filter(([id, raw]) => !asBool(asRecord(raw).isTempHero) || id === "leather" || id === "king")
    .map(([id, raw]) => {
      const value = asRecord(raw);
      const teamSkillIds = [1, 2, 3, 4].map((index) => asText(value[`skill${index}`])).filter(Boolean);
      return {
        id,
        name: id === "leather" ? "塔马什" : id === "king" ? "莱茵霍尔德" : localized([`${id}_name`], id),
        classId: asText(value.class),
        element: element(value.element),
        ...optional("spritePath", chooseSprite([`icon_global_${id}.png`], `icon_global_${id}`)),
        teamSkillIds,
        teamSkills: teamSkillIds.map((skillId) => {
          const modifier = asRecord(modifiersRaw[skillId]);
          return {
            id: skillId,
            name: localized([`hero_skill_${skillId}_name`], skillId),
            tier: numeric(modifier, "tier"),
            ...optional("spritePath", chooseSprite([`icon_global_skill_hero_${skillId}.png`], `icon_global_skill_hero_${skillId}`)),
            effects: [localized([`hero_skill_${skillId}_effect`], "勇士固定团队效果")],
          };
        }),
        stats: stats(value),
        calculation: {
          levelOne: {
            health: numeric(value, "hp"),
            attack: numeric(value, "atk"),
            defense: numeric(value, "def"),
          },
          levelFifty: {
            health: numeric(value, "maxHp50"),
            attack: numeric(value, "maxAtk50"),
            defense: numeric(value, "maxDef50"),
          },
          story: {
            health: numeric(value, "storyHp"),
            attack: numeric(value, "storyAtk"),
            defense: numeric(value, "storyDef"),
          },
          rankMultipliers: Array.from({ length: 11 }, (_, index) => statUpgrade(value[`upg${String(index + 1).padStart(2, "0")}`])),
          titanMultiplier: statUpgrade(value.upgTitan),
        },
        index: numeric(value, "index"),
      };
    })
    .sort((left, right) => left.index - right.index);

  const quests: Array<CatalogQuest & { mapOrder: number }> = Object.entries(questsRaw).map(([id, raw], sourceOrder) => {
    const value = asRecord(raw);
    const family = asText(value.family, id);
    const difficultyLevel = numeric(value, "difficultyLvl");
    const isBoss = asBool(value.isBoss);
    const isFlash = asBool(value.isFlash);
    const category: CatalogQuest["category"] = family === "goldcity" ? "黄金城" : family === "titantower" || asBool(value.isTitan) ? "泰坦塔" : isFlash ? "快闪" : "普通冒险";
    const baseMapName = localized(isFlash ? [`fq_${family}_name`, `${family}_name`] : [`${family}_name`], family);
    const variant = titanVariant(id);
    const tomb = difficultyLevel === 30;
    const mapName = category === "泰坦塔" ? (tomb ? "泰坦之墓" : `泰坦之塔${difficultyLevel + 1}层`) : baseMapName;
    const difficulty = category === "泰坦塔" ? titanLabel(variant.name, tomb) : category === "黄金城" ? `难度${difficultyLevel + 1}` : ["简单", "中等", "困难", "究极"][difficultyLevel] ?? "究极";
    const suffix = ["easy", "medium", "hard", "extreme"][difficultyLevel] ?? "extreme";
    const mapSpriteCandidates = category === "泰坦塔"
      ? [tomb ? "icon_global_questarea_titantomb_small.png" : "icon_global_questarea_titantower_small.png"]
      : [isBoss ? `${family}_boss.png` : `icon_global_questarea_${family}_small.png`];
    const explicitName = localized([`${id}_name`], "");
    const barrierElements = split(value.element).map(element);
    return {
      id,
      name: explicitName || (category === "泰坦塔" ? `${mapName} · ${difficulty}` : `${mapName}${isBoss ? " (Boss)" : ""}`),
      mapName,
      ...optional("mapLabel", category === "泰坦塔" ? (tomb ? "泰坦之墓" : `第${difficultyLevel + 1}层`) : undefined),
      mapKey: category === "泰坦塔" ? `titantower:${difficultyLevel}` : `${family}:${isBoss ? "boss" : "normal"}`,
      category,
      difficulty,
      difficultyLevel,
      variantOrder: Math.max(0, variant.order),
      isBoss,
      maxMembers: Math.min(6, Math.max(1, numeric(value, "party") || 4)),
      barrierElements,
      ...optional("barrierElement", barrierElements[0]),
      barrierPower: numeric(value, "barrierPower"),
      ...optional("spritePath", chooseSprite(mapSpriteCandidates, family)),
      ...optional("mapSpritePath", chooseSprite(mapSpriteCandidates, family)),
      ...optional("difficultySpritePath", category === "泰坦塔"
        ? chooseSprite([`icon_global_titantower_${variant.name}_big.png`], `icon_global_titantower_${variant.name}_big`)
        : chooseSprite([`icon_difficulty_${category === "黄金城" ? difficultyLevel + 1 : suffix}.png`], "icon_difficulty")),
      ...optional("difficultyBackgroundPath", category === "泰坦塔" ? chooseSprite(["icon_global_skill_bg_titan.png"], "icon_global_skill_bg_titan") : undefined),
      towerModifierLimit: numeric(value, "miniboss"),
      isTitanTomb: id.startsWith("titantower_tomb_"),
      mapOrder: numeric(value, "index") || sourceOrder,
    };
  });
  const categoryOrder = { 普通冒险: 0, 黄金城: 1, 泰坦塔: 2, 快闪: 3 };
  quests.sort((left, right) => categoryOrder[left.category] - categoryOrder[right.category] || left.mapOrder - right.mapOrder || (left.variantOrder ?? 0) - (right.variantOrder ?? 0));

  const items: CatalogItem[] = Object.entries(itemsRaw).flatMap(([id, raw], sourceOrder) => {
    const value = asRecord(raw);
    const itemType = asText(value.type);
    if (!itemType) return [];
    const translationKey = asText(typeDict[itemType], itemType);
    return [{
      id,
      name: localized([`${id}_name`], id),
      itemType,
      typeName: localized([translationKey], itemType),
      tier: numeric(value, "tier"),
      level: numeric(value, "level"),
      sourceOrder,
      ...optional("restrictedClass", asText(value.restrict) || undefined),
      ...optional("spritePath", chooseSprite([`${id}.png`], id)),
      attack: numeric(value, "atk"),
      defense: numeric(value, "def"),
      health: numeric(value, "hp"),
      evasion: numeric(value, "eva"),
      critical: numeric(value, "crit"),
      ...itemUpgradeStats(value),
      ...optional("elements", asText(value.elements) || undefined),
      ...optional("skill", asText(value.skill) || undefined),
      ...optional("elementAffinity", asText(value.elementAffinity) || undefined),
      ...optional("spiritAffinity", asText(value.spiritAffinity) || undefined),
      ...optional("builtInElementId", asText(value.lTag2) || undefined),
      ...optional("builtInSpiritId", asText(value.lTag3) || undefined),
    }];
  }).sort((left, right) => left.tier - right.tier || left.name.localeCompare(right.name, "zh-CN"));

  const skills: CatalogSkill[] = Object.entries(skillsRaw).map(([id, raw], sourceOrder) => {
    const value = asRecord(raw);
    const family = asText(value.family, id);
    return {
      id,
      name: localized([`skill_${id}_name`], id),
      family,
      ...optional("category", asText(value.category) || undefined),
      tier: numeric(value, "tier"),
      classes: split(value.classes),
      rarity: numeric(value, "rarity"),
      elements: numeric(value, "elements"),
      rank: numeric(value, "rank"),
      sourceOrder,
      ...optional("spritePath", chooseSprite([`icon_global_skill_${family}.png`], family)),
      effects: skillEffects(value),
      innateEffects: skillEffects(value),
      xpToAttack: numeric(value, "xpToAtk"),
      modifiers: skillModifiers(value),
    };
  }).sort((left, right) => left.family.localeCompare(right.family) || left.tier - right.tier || left.name.localeCompare(right.name, "zh-CN"));

  const questModifiers = Object.entries(modifiersRaw).flatMap(([id, raw]) => {
    const value = asRecord(raw);
    if (!asBool(value.isTower) || (asText(value.modifierProvider) && asText(value.modifierProvider) !== "miniboss") || ["agile", "huge", "dire", "wealthy", "epic"].includes(id)) return [];
    const family = asText(value.family, id);
    return [{
      id,
      family,
      name: localized([`${id}_name`], id),
      description: localized([`${id}_desc`], ""),
      ...optional("spritePath", chooseSprite([`icon_tomb_modifier_${family.toLowerCase()}.png`], "icon_tomb_modifier_default")),
      ...optional("classes", asText(value.classes) || undefined),
      minTowerTier: numeric(value, "minTowerTier"),
      maxTowerTier: numeric(value, "maxTowerTier"),
      minTowerFloor: numeric(value, "minTowerFloor"),
      maxTowerFloor: numeric(value, "maxTowerFloor"),
    }];
  });
  const statistics = asRecord(manifest.statistics);
  return {
    schemaVersion: numeric(manifest, "schemaVersion") || 1,
    gameDataVersion: asText(manifest.gameDataVersion, "bundled"),
    assetVersion: asText(manifest.assetVersion, "bundled"),
    classes,
    champions,
    quests,
    items,
    skills,
    questModifiers,
    counts: {
      classes: numeric(statistics, "classes") || classes.length,
      champions: champions.length,
      quests: numeric(statistics, "quests") || quests.length,
      items: numeric(statistics, "items") || items.length,
      skills: numeric(statistics, "skills") || skills.length,
      sprites: spriteFiles.length,
    },
  };
}
