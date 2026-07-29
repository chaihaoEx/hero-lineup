import type { CalculatedSheet, Champion, ChampionEquipmentConfig, ChampionLoadout, ElementType } from "../types/domain";
import { championElementValue, type Catalog, type CatalogChampion, type CatalogItem } from "./catalog";
import { elementFamily, previewEquipmentStats, resolveSpiritSkill } from "./equipmentPreview";

const elementToken: Record<ElementType, string> = {
  火: "fire",
  水: "water",
  土: "earth",
  风: "air",
  光: "light",
  暗: "dark",
};

function levelValue(start: number, atForty: number, atFifty: number, level: number): number {
  if (level <= 1) return Math.round(start);
  const clamped = Math.max(1, Math.min(50, level));
  if (clamped <= 40) {
    const increment = (atForty - start) / 100;
    const steps = clamped - 1;
    const weighted = Math.min(steps, 8)
      + 2 * Math.max(0, Math.min(steps, 19) - 8)
      + 3 * Math.max(0, Math.min(steps, 29) - 19)
      + 4 * Math.max(0, steps - 29);
    return Math.round(start + increment * weighted);
  }
  return Math.round(atForty + (atFifty - atForty) * ((clamped - 40) / 10));
}

function championBase(catalogChampion: CatalogChampion | undefined, champion: Champion, loadout: ChampionLoadout) {
  const calculation = catalogChampion?.calculation;
  const atForty = catalogChampion?.stats ?? champion.stats;
  const levelStats = calculation ? {
    health: levelValue(calculation.levelOne.health, atForty.health, calculation.levelFifty.health, loadout.level),
    attack: levelValue(calculation.levelOne.attack, atForty.attack, calculation.levelFifty.attack, loadout.level),
    defense: levelValue(calculation.levelOne.defense, atForty.defense, calculation.levelFifty.defense, loadout.level),
  } : {
    health: atForty.health,
    attack: atForty.attack,
    defense: atForty.defense,
  };
  const rankBonus = { health: 0, attack: 0, defense: 0 };
  if (calculation) {
    for (let index = 0; index < 11; index += 1) {
      if (loadout.rank < index + 2) continue;
      const multiplier = calculation.rankMultipliers[index] ?? 0;
      rankBonus.health += calculation.story.health * multiplier;
      rankBonus.attack += calculation.story.attack * multiplier;
      rankBonus.defense += calculation.story.defense * multiplier;
    }
    if (loadout.rank > 12) {
      const repeated = loadout.rank - 12;
      const multiplier = calculation.rankMultipliers[10] ?? 0;
      rankBonus.health += calculation.story.health * multiplier * repeated;
      rankBonus.attack += calculation.story.attack * multiplier * repeated;
      rankBonus.defense += calculation.story.defense * multiplier * repeated;
    }
  }
  let rankHealth = Math.floor(rankBonus.health);
  let rankAttack = Math.floor(rankBonus.attack);
  let rankDefense = Math.floor(rankBonus.defense);
  if (calculation && loadout.titan) {
    rankHealth = Math.floor((rankHealth + Math.floor(calculation.story.health * calculation.titanMultiplier)) * 1.5);
    rankAttack = Math.floor((rankAttack + Math.floor(calculation.story.attack * calculation.titanMultiplier)) * 1.5);
    rankDefense = Math.floor((rankDefense + Math.floor(calculation.story.defense * calculation.titanMultiplier)) * 1.5);
  }
  return {
    health: levelStats.health + rankHealth + loadout.seed,
    attack: levelStats.attack + rankAttack + loadout.seed * 4,
    defense: levelStats.defense + rankDefense + loadout.seed * 4,
    evasion: atForty.evasion,
    critical: atForty.crit,
    criticalDamage: atForty.criticalDamage ?? 200,
    aggro: atForty.aggro ?? 0,
    regeneration: atForty.regeneration ?? 0,
  };
}

function attachment(catalog: Catalog, id: string | undefined, kind: "element" | "spirit"): CatalogItem | undefined {
  if (!id) return undefined;
  return catalog.items.find((item) => item.id === id || item.name === id)
    ?? (kind === "element" ? catalog.items.find((item) => elementFamily(item) === id) : undefined);
}

function equipmentConfig(itemId: string | undefined, configured: ChampionEquipmentConfig | undefined): ChampionEquipmentConfig | undefined {
  if (configured) return configured;
  if (!itemId) return undefined;
  return { itemId, quality: "普通", shiny: false, transcendence: 0 };
}

export function calculateChampionPreview(
  catalog: Catalog,
  champion: Champion,
  loadout: ChampionLoadout,
  titanTower = false,
): CalculatedSheet {
  const catalogChampion = catalog.champions.find((entry) => entry.id === champion.id);
  const base = championBase(catalogChampion, champion, loadout);
  const equipment = { health: 0, attack: 0, defense: 0, evasion: 0, critical: 0, elementValue: 0 };
  const flat = { health: 0, attack: 0, defense: 0, evasion: 0, critical: 0, criticalDamage: 0, aggro: 0, regeneration: 0 };
  const percent = { health: 0, attack: 0, defense: 0 };
  const configs = [
    equipmentConfig(loadout.familiar, loadout.familiarEquipment),
    equipmentConfig(loadout.aurasong, loadout.auraSongEquipment),
  ];
  for (const config of configs) {
    if (!config?.itemId) continue;
    const item = catalog.items.find((candidate) => candidate.id === config.itemId || candidate.name === config.itemId);
    if (!item) continue;
    const elementItem = attachment(catalog, item.builtInElementId ?? config.element, "element");
    const spiritItem = attachment(catalog, item.builtInSpiritId ?? config.spirit, "spirit");
    const preview = previewEquipmentStats(item, config, {
      elementItem,
      spiritItem,
      skills: catalog.skills,
      unitElement: elementToken[champion.element],
      titanTower,
    });
    equipment.health += preview.health;
    equipment.attack += preview.attack;
    equipment.defense += preview.defense;
    equipment.evasion += preview.evasion * 100;
    equipment.critical += preview.critical * 100;
    equipment.elementValue += preview.elementValue;
    const spiritSkill = resolveSpiritSkill(item, spiritItem, catalog.skills);
    const modifier = spiritSkill?.modifiers;
    if (!modifier) continue;
    flat.health += modifier.healthFlat;
    flat.attack += modifier.attackFlat;
    flat.defense += modifier.defenseFlat;
    flat.evasion += modifier.evasion * 100;
    flat.critical += modifier.critical * 100;
    flat.criticalDamage += modifier.criticalDamage * 100;
    flat.aggro += modifier.aggro;
    flat.regeneration += modifier.regeneration;
    percent.health += modifier.health;
    percent.attack += modifier.attack;
    percent.defense += modifier.defense;
  }
  const combined = {
    health: base.health + equipment.health + flat.health,
    attack: base.attack + equipment.attack + flat.attack,
    defense: base.defense + equipment.defense + flat.defense,
  };
  const cardPercent = [0, 0.05, 0.1, 0.25][Math.min(loadout.cardLevel, 3)] ?? 0;
  const cardAttack = combined.attack * (1 + cardPercent);
  const cardDefense = combined.defense * (1 + cardPercent);
  return {
    stats: {
      health: Math.round(combined.health * (1 + percent.health) * (1 + cardPercent)),
      attack: Math.floor(cardAttack * (1 + percent.attack)),
      defense: Math.floor(cardDefense * (1 + percent.defense)),
      baseDefense: cardDefense,
      evasion: base.evasion + equipment.evasion + flat.evasion,
      critical: base.critical + equipment.critical + flat.critical,
      criticalDamage: (base.criticalDamage + flat.criticalDamage) / 100,
      aggro: base.aggro + flat.aggro,
      elementValue: championElementValue(loadout.rank) + equipment.elementValue,
      regeneration: base.regeneration + flat.regeneration,
    },
    issues: [],
    applied: {
      source: "browser-champion-preview",
      equipmentCount: configs.filter((config) => config?.itemId).length,
      equipmentFormula: "reference-quality-element-spirit-rank-card",
      titanTower,
    },
  };
}
