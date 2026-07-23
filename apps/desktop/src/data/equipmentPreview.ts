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

export interface EquipmentPreviewAttachments {
  elementItem?: CatalogItem | undefined;
  spiritItem?: CatalogItem | undefined;
}

/** Mirrors the archived web equipment helper for the item itself (before enchants). */
export function previewEquipmentStats(item: CatalogItem, config: EquipmentPreviewConfig, attachments: EquipmentPreviewAttachments = {}): EquipmentPreviewStats {
  const transcended = config.transcendence > 0;
  const rawAttack = (item.attack ?? 0) + (transcended ? item.transcendAttack ?? 0 : 0);
  const rawDefense = (item.defense ?? 0) + (transcended ? item.transcendDefense ?? 0 : 0);
  const rawHealth = (item.health ?? 0) + (transcended ? item.transcendHealth ?? 0 : 0);
  const baseMultiplier = 1
    + (config.shiny ? (item.shinyMultiplier ?? 1) - 1 : 0)
    + (transcended ? (item.transcendMultiplier ?? 1) - 1 : 0);
  const rarity = qualityMultiplier[config.quality];

  const attachmentStat = (core: CatalogItem | undefined, stat: "attack" | "defense" | "health", raw: number, builtInId: string | undefined, affinity: string | undefined, elemental: boolean) => {
    if (!core) return 0;
    const coreId = core.id;
    const matches = builtInId === coreId || affinity?.split(/[;,]/).map((value) => value.trim()).some((value) => value === coreId || (elemental && value === "all"));
    return Math.min(raw, Math.floor((core[stat] ?? 0) * (matches ? 1.5 : 1)));
  };
  const attachmentAttack = attachmentStat(attachments.elementItem, "attack", rawAttack, item.builtInElementId, item.elementAffinity, true)
    + attachmentStat(attachments.spiritItem, "attack", rawAttack, item.builtInSpiritId, item.spiritAffinity, false);
  const attachmentDefense = attachmentStat(attachments.elementItem, "defense", rawDefense, item.builtInElementId, item.elementAffinity, true)
    + attachmentStat(attachments.spiritItem, "defense", rawDefense, item.builtInSpiritId, item.spiritAffinity, false);
  const attachmentHealth = attachmentStat(attachments.elementItem, "health", rawHealth, item.builtInElementId, item.elementAffinity, true)
    + attachmentStat(attachments.spiritItem, "health", rawHealth, item.builtInSpiritId, item.spiritAffinity, false);
  return {
    attack: Math.round((rawAttack * rarity + attachmentAttack) * baseMultiplier),
    defense: Math.round((rawDefense * rarity + attachmentDefense) * baseMultiplier),
    health: Math.round((rawHealth * rarity + attachmentHealth) * baseMultiplier),
    evasion: (item.evasion ?? 0) + (transcended ? item.transcendEvasion ?? 0 : 0),
    critical: (item.critical ?? 0) + (transcended ? item.transcendCritical ?? 0 : 0),
    baseMultiplier,
  };
}
