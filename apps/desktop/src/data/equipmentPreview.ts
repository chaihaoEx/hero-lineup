import type { EquipmentSlot, Quality } from "../types/domain";
import type { CatalogItem } from "./catalog";

const qualityMultiplier: Record<Quality, number> = {
  普通: 1,
  优质: 1.25,
  高级: 1.5,
  史诗: 2,
  传说: 3,
};

export type EquipmentPreviewConfig = Pick<EquipmentSlot, "quality" | "shiny" | "transcendence">;

export interface EquipmentPreviewStats {
  attack: number;
  defense: number;
  health: number;
  evasion: number;
  critical: number;
  baseMultiplier: number;
}

/** Mirrors the archived web equipment helper for the item itself (before enchants). */
export function previewEquipmentStats(item: CatalogItem, config: EquipmentPreviewConfig): EquipmentPreviewStats {
  const transcended = config.transcendence > 0;
  const rawAttack = (item.attack ?? 0) + (transcended ? item.transcendAttack ?? 0 : 0);
  const rawDefense = (item.defense ?? 0) + (transcended ? item.transcendDefense ?? 0 : 0);
  const rawHealth = (item.health ?? 0) + (transcended ? item.transcendHealth ?? 0 : 0);
  const baseMultiplier = 1
    + (config.shiny ? (item.shinyMultiplier ?? 1) - 1 : 0)
    + (transcended ? (item.transcendMultiplier ?? 1) - 1 : 0);
  const rarity = qualityMultiplier[config.quality];

  return {
    attack: Math.round(rawAttack * rarity * baseMultiplier),
    defense: Math.round(rawDefense * rarity * baseMultiplier),
    health: Math.round(rawHealth * rarity * baseMultiplier),
    evasion: (item.evasion ?? 0) + (transcended ? item.transcendEvasion ?? 0 : 0),
    critical: (item.critical ?? 0) + (transcended ? item.transcendCritical ?? 0 : 0),
    baseMultiplier,
  };
}
