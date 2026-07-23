import type { CatalogItem } from "./catalog";
import type { ChampionLoadout, Hero, Quality } from "../types/domain";

export type EquipmentNeedCategory = "equipment" | "elementEnchant" | "spiritEnchant";

export interface EquipmentNeed {
  item: CatalogItem;
  quality: Quality;
  category: EquipmentNeedCategory;
  requiredCount: number;
}

export type OwnedEquipmentCounts = Record<string, number | "">;

const categoryOrder: Record<EquipmentNeedCategory, number> = {
  equipment: 1,
  elementEnchant: 2,
  spiritEnchant: 3,
};

const qualityOrder: Record<Quality, number> = {
  普通: 1,
  优质: 2,
  高级: 3,
  史诗: 4,
  传说: 5,
};

export const equipmentNeedCategoryLabel: Record<EquipmentNeedCategory, string> = {
  equipment: "装备",
  elementEnchant: "元素附魔",
  spiritEnchant: "精萃附魔",
};

export function ownedEquipmentKey(itemId: string, quality: Quality): string {
  return `${itemId}_${quality}`;
}

export function equipmentNeedKey(category: EquipmentNeedCategory, itemId: string, quality: Quality): string {
  return `${category}_${itemId}_${quality}`;
}

export function normalizeOwnedCount(value: unknown): number | "" {
  if (value === "") return "";
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function numericOwnedCount(counts: OwnedEquipmentCounts, itemId: string, quality: Quality): number {
  const value = counts[ownedEquipmentKey(itemId, quality)];
  return value === "" || value === undefined ? 0 : normalizeOwnedCount(value) || 0;
}

export function collectEquipmentNeeds(
  kind: "hero" | "champion",
  heroes: Hero[],
  championLoadouts: Record<string, ChampionLoadout>,
  items: CatalogItem[],
): EquipmentNeed[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const grouped = new Map<string, EquipmentNeed>();
  const add = (itemId: string | undefined, quality: Quality, category: EquipmentNeedCategory) => {
    if (!itemId) return;
    const item = itemById.get(itemId);
    if (!item) return;
    const key = equipmentNeedKey(category, itemId, quality);
    const current = grouped.get(key);
    if (current) current.requiredCount += 1;
    else grouped.set(key, { item, quality, category, requiredCount: 1 });
  };

  if (kind === "hero") {
    heroes.forEach((hero) => hero.equipment.forEach((slot) => {
      add(slot.itemId, slot.quality, "equipment");
      add(slot.element, slot.quality, "elementEnchant");
      add(slot.spirit, slot.quality, "spiritEnchant");
    }));
  } else {
    Object.values(championLoadouts).forEach((loadout) => {
      const equipment: Array<ChampionLoadout["familiarEquipment"]> = [
        loadout.familiarEquipment ?? (loadout.familiar ? {
          itemId: loadout.familiar, quality: "普通", shiny: false, transcendence: 0,
        } : undefined),
        loadout.auraSongEquipment ?? (loadout.aurasong ? {
          itemId: loadout.aurasong, quality: "普通", shiny: false, transcendence: 0,
        } : undefined),
      ];
      equipment.forEach((slot) => {
        if (!slot) return;
        add(slot.itemId, slot.quality, "equipment");
        add(slot.element, slot.quality, "elementEnchant");
        add(slot.spirit, slot.quality, "spiritEnchant");
      });
    });
  }

  return [...grouped.values()].sort((left, right) =>
    categoryOrder[left.category] - categoryOrder[right.category]
    || qualityOrder[right.quality] - qualityOrder[left.quality]
    || right.item.tier - left.item.tier
    || left.item.name.localeCompare(right.item.name));
}
