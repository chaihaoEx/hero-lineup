import { describe, expect, it } from "vitest";
import { calculateChampionPreview } from "../src/data/championPreview";
import { previewEquipmentStats } from "../src/data/equipmentPreview";
import { previewCatalog, type Catalog, type CatalogItem, type CatalogSkill } from "../src/data/catalog";
import type { Champion, ChampionLoadout } from "../src/types/domain";

const tyrannosaurus: CatalogItem = {
  id: "trex",
  name: "霸王龙",
  itemType: "familiar",
  typeName: "使魔",
  tier: 15,
  attack: 1545,
  health: 154,
  elementAffinity: "earth",
  spiritAffinity: "dinosaur",
};

const extremeFire: CatalogItem = {
  id: "extreme-fire",
  name: "极炎元素",
  itemType: "z",
  typeName: "元素附魔",
  tier: 15,
  attack: 164,
  health: 33,
  elements: "fire+45",
};

const tomb: CatalogItem = {
  id: "tomb",
  name: "墓生灵",
  itemType: "z",
  typeName: "精萃附魔",
  tier: 15,
  attack: 200,
  health: 40,
  skill: "i_tomb",
};

const tombSkill: CatalogSkill = {
  id: "i_tomb",
  name: "墓生灵",
  family: "i_tomb",
  tier: 1,
  classes: [],
  rarity: 0,
  elements: 0,
  rank: 0,
  effects: ["附魔本装备全属性加成 20%"],
  modifiers: {
    item: 0.2,
    attack: 0,
    defense: 0,
    health: 0,
    attackFlat: 0,
    defenseFlat: 0,
    healthFlat: 0,
    evasion: 0,
    critical: 0,
    criticalDamage: 0,
    aggro: 0,
    regeneration: 0,
  },
};

const champion: Champion = {
  id: "argon",
  kind: "champion",
  name: "阿尔贡",
  element: "土",
  level: 40,
  rank: 11,
  cardLevel: 0,
  stats: { health: 742, attack: 3129, defense: 4368, evasion: 0, crit: 0 },
};

const loadout: ChampionLoadout = {
  level: 40,
  rank: 11,
  seed: 0,
  cardLevel: 0,
  titan: false,
  familiar: "trex",
  aurasong: "",
  familiarEquipment: {
    itemId: "trex",
    quality: "高级",
    element: "extreme-fire",
    spirit: "tomb",
    shiny: false,
    transcendence: 0,
  },
};

const catalog: Catalog = {
  ...previewCatalog,
  champions: [{ id: "argon", name: "阿尔贡", element: "土", classId: "", teamSkillIds: [], teamSkills: [], stats: champion.stats }],
  items: [tyrannosaurus, extremeFire, tomb],
  skills: [tombSkill],
};

describe("reference champion equipment preview", () => {
  it("matches the reference T-Rex card after quality, cores and Tomb's item multiplier", () => {
    expect(previewEquipmentStats(tyrannosaurus, loadout.familiarEquipment!, {
      elementItem: extremeFire,
      spiritItem: tomb,
      skills: [tombSkill],
      unitElement: "earth",
    })).toMatchObject({ attack: 3218, health: 365 });
  });

  it("adds the complete configured item result to the champion sheet", () => {
    const sheet = calculateChampionPreview(catalog, champion, loadout);
    expect(sheet.stats).toMatchObject({ health: 1107, attack: 6347, defense: 4368 });
  });
});
