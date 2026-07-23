import { describe, expect, it } from "vitest";
import { collectEquipmentNeeds, normalizeOwnedCount, numericOwnedCount, ownedEquipmentKey } from "../src/data/equipmentNeeds";
import type { CatalogItem } from "../src/data/catalog";
import type { Hero } from "../src/types/domain";

const item = (id: string, name: string, tier: number): CatalogItem => ({
  id, name, tier, itemType: "test", typeName: "测试",
});

const items = [
  item("sword", "短剑", 4),
  item("helm", "头盔", 12),
  item("fire", "火元素", 1),
  item("spirit", "比蒙精魂", 1),
];

const hero: Hero = {
  id: "hero-1", kind: "hero", name: "英雄", classId: "knight", className: "骑士",
  element: "光", level: 40, rank: 1, seed: 0, titan: false, cardLevel: 0, skills: [],
  stats: { attack: 1, defense: 1, health: 1, evasion: 0, crit: 0 },
  equipment: [
    { slot: "武器", itemId: "sword", quality: "传说", element: "fire", spirit: "spirit", shiny: false, transcendence: 0 },
    { slot: "头部", itemId: "helm", quality: "普通", element: "fire", shiny: false, transcendence: 0 },
    { slot: "身体", itemId: "sword", quality: "普通", shiny: false, transcendence: 0 },
    { slot: "手部", quality: "普通", shiny: false, transcendence: 0 },
    { slot: "脚部", quality: "普通", shiny: false, transcendence: 0 },
    { slot: "饰品", quality: "普通", shiny: false, transcendence: 0 },
  ],
};

describe("online equipment requirements", () => {
  it("separates category and quality, inheriting slot quality for enchants", () => {
    const needs = collectEquipmentNeeds("hero", [hero], {}, items);
    expect(needs.map((entry) => [entry.category, entry.item.id, entry.quality, entry.requiredCount])).toEqual([
      ["equipment", "sword", "传说", 1],
      ["equipment", "helm", "普通", 1],
      ["equipment", "sword", "普通", 1],
      ["elementEnchant", "fire", "传说", 1],
      ["elementEnchant", "fire", "普通", 1],
      ["spiritEnchant", "spirit", "传说", 1],
    ]);
  });

  it("counts every configured champion loadout and includes its enchants", () => {
    const needs = collectEquipmentNeeds("champion", [], {
      alpha: {
        level: 40, rank: 1, seed: 0, cardLevel: 0, titan: false, familiar: "sword", aurasong: "",
        familiarEquipment: { itemId: "sword", quality: "史诗", element: "fire", spirit: "spirit", shiny: false, transcendence: 0 },
      },
      beta: {
        level: 40, rank: 1, seed: 0, cardLevel: 0, titan: false, familiar: "sword", aurasong: "",
        familiarEquipment: { itemId: "sword", quality: "史诗", shiny: false, transcendence: 0 },
      },
    }, items);
    expect(needs.map((entry) => [entry.category, entry.item.id, entry.requiredCount])).toEqual([
      ["equipment", "sword", 2],
      ["elementEnchant", "fire", 1],
      ["spiritEnchant", "spirit", 1],
    ]);
  });

  it("shares owned inventory by item and quality, not requirement category", () => {
    const key = ownedEquipmentKey("fire", "传说");
    expect(numericOwnedCount({ [key]: 3 }, "fire", "传说")).toBe(3);
    expect(numericOwnedCount({ [key]: 3 }, "fire", "普通")).toBe(0);
    expect(normalizeOwnedCount("4.9")).toBe(4);
    expect(normalizeOwnedCount("-2")).toBe(0);
    expect(normalizeOwnedCount("")).toBe("");
  });
});
