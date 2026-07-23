import { decodeOnlineHeroConfig, decodeOnlineHeroTemplate, encodeOnlineHeroConfig, importOnlineHeroConfig, makeHeroFromOnlineTemplate, templatesForClass } from "../src/data/heroCreationTemplates";
import { previewCatalog } from "../src/data/catalog";

function catalogForTemplate() {
  const template = templatesForClass("spellknight")[0]!;
  const config = decodeOnlineHeroTemplate(template);
  const equipment = Object.values(config.equipment ?? {});
  return {
    ...previewCatalog,
    classes: [{ ...previewCatalog.classes[0]!, id: "spellknight", name: "咒术骑士", type: "spellcaster", skillSlots: 4, skillUnlockLevels: [5, 10, 23, 35], slots: equipment.map((_, index) => [`template-slot-${index}`]) }],
    items: equipment.map((entry, index) => ({ id: entry.itemId!, name: entry.itemId!, itemType: `template-slot-${index}`, typeName: "模板装备", tier: 16 })),
    skills: (config.skills ?? []).map((id, index) => ({ id, name: id, family: `template-family-${index}`, tier: 1, classes: ["spellcaster"], rarity: 0, elements: 0, rank: index, effects: [] })),
  };
}

test("bundles the online hero template snapshot for fully offline creation", () => {
  const template = templatesForClass("spellknight")[0];
  expect(template).toBeDefined();
  const config = decodeOnlineHeroTemplate(template!);
  expect(config.heroClass).toBe("spellknight");
  expect(config.equipment).toHaveProperty("slot1");
});

test("creates a fresh local hero while preserving the online template loadout", () => {
  const template = templatesForClass("spellknight")[0]!;
  const catalog = catalogForTemplate();
  const hero = makeHeroFromOnlineTemplate(catalog, template, 1);
  const config = decodeOnlineHeroTemplate(template);
  expect(hero.id).not.toBe(config.heroId);
  expect(hero.classId).toBe("spellknight");
  expect(hero.level).toBe(config.level);
  expect(hero.skills).toEqual(config.skills);
  expect(hero.equipment[0]?.itemId).toBe(config.equipment?.slot1?.itemId);
  expect(hero.equipment[0]?.slot).toBe("武器");
  expect(hero.equipment[1]?.slot).toBe("身体");
});

test("round-trips an online-compatible configuration code without changing the hero identity", () => {
  const catalog = catalogForTemplate();
  const source = makeHeroFromOnlineTemplate(catalog, templatesForClass("spellknight")[0]!, 1);
  const encoded = encodeOnlineHeroConfig(source);
  expect(decodeOnlineHeroConfig(encoded).heroName).toBe(source.name);
  const existing = { ...source, id: "local-stable-id", name: "导入前" };
  const imported = importOnlineHeroConfig(catalog, encoded, existing);
  expect(imported.id).toBe("local-stable-id");
  expect(imported.name).toBe("导入前");
});

test("normalizes locked and duplicate-category skills like the online importer", () => {
  const baseCatalog = catalogForTemplate();
  const catalog = { ...baseCatalog, skills: baseCatalog.skills.map((skill, index) => ({
    ...skill, ...(index < 2 ? { category: "shared-category" } : {}),
  })) };
  const source = makeHeroFromOnlineTemplate(catalog, templatesForClass("spellknight")[0]!, 1);
  source.level = 40;
  source.skills = [catalog.skills[0]!.id, catalog.skills[1]!.id];
  const deduplicated = importOnlineHeroConfig(catalog, encodeOnlineHeroConfig(source), source);
  expect(deduplicated.skills.slice(0, 2)).toEqual([catalog.skills[0]!.id, ""]);

  source.level = 1;
  const locked = importOnlineHeroConfig(catalog, encodeOnlineHeroConfig(source), source);
  expect(locked.skills.every((skill) => skill === "")).toBe(true);
});
