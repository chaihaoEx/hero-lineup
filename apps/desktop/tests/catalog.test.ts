import { describe, expect, it } from "vitest";
import { heroSlotNames, itemsForSlot, makeHero, normalizeHeroEquipmentSlots, previewCatalog, skillsForClass, type Catalog } from "../src/data/catalog";
import { previewEquipmentStats } from "../src/data/equipmentPreview";

describe("local catalog projections", () => {
  it("creates heroes from catalog stats and all six slot definitions", () => {
    const hero = makeHero(previewCatalog, "knight", 2);
    expect(hero.className).toBe("骑士");
    expect(hero.name).toBe("骑士2");
    expect(hero.equipment).toHaveLength(6);
    expect(hero.equipment.map((entry) => entry.slot)).toEqual(heroSlotNames);
    expect(hero.stats).toEqual(previewCatalog.classes[0]!.stats);
  });

  it("migrates the early offline slot labels without moving selected items", () => {
    const hero = makeHero(previewCatalog, "knight", 1);
    hero.equipment = ["武器", "头部", "身体", "手部", "脚部", "饰品"].map((slot, index) => ({
      slot: slot as typeof hero.equipment[number]["slot"], itemId: `item-${index + 1}`, quality: "普通", shiny: false, transcendence: 0,
    }));
    const migrated = normalizeHeroEquipmentSlots(hero);
    expect(migrated.equipment.map((entry) => entry.slot)).toEqual(["武器", "身体", "手部", "头部", "脚部", "饰品"]);
    expect(migrated.equipment.map((entry) => entry.itemId)).toEqual(["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"]);
  });

  it("filters equipment by the selected class slot and restriction", () => {
    const catalog: Catalog = {
      ...previewCatalog,
      items: [
        { id: "sword", name: "剑", itemType: "ws", typeName: "剑", tier: 1 },
        { id: "axe", name: "斧", itemType: "wa", typeName: "斧", tier: 1, restrictedClass: "barbarian" },
        { id: "armor", name: "甲", itemType: "ah", typeName: "重甲", tier: 1 },
      ],
    };
    expect(itemsForSlot(catalog, "knight", 0).map((item) => item.id)).toEqual(["sword"]);
    expect(itemsForSlot(catalog, "knight", 1).map((item) => item.id)).toEqual(["armor"]);
  });

  it("uses the class skill group while keeping the innate skill out of the picker", () => {
    expect(previewCatalog.classes[0]?.innateSkillFamily).toBe("c_knight");
    expect(previewCatalog.classes[0]?.skillSlots).toBe(3);
    expect(previewCatalog.classes[0]?.skillUnlockLevels).toEqual([5, 10, 23, 0]);
    expect(previewCatalog.classes[0]?.maxSkillLevel).toBe(3);
    expect(skillsForClass(previewCatalog, "knight").map((skill) => skill.id)).toEqual(["p_cleave1"]);
  });

  it("previews quality, Star Forge and Transcend with the archived web formula", () => {
    const item = previewCatalog.items.find((entry) => entry.id === "shortsword")!;
    expect(previewEquipmentStats(item, { quality: "普通", shiny: false, transcendence: 0 }).attack).toBe(16);
    expect(previewEquipmentStats(item, { quality: "优质", shiny: false, transcendence: 1 })).toMatchObject({
      attack: 25,
      defense: 1,
      baseMultiplier: 1.1,
    });
    expect(previewEquipmentStats({ ...item, shinyMultiplier: 1.25 }, { quality: "传说", shiny: true, transcendence: 1 })).toMatchObject({
      attack: 73,
      defense: 4,
      baseMultiplier: 1.35,
    });
  });
});
