import type { EquipmentSlot, Quality } from "../types/domain";
import type { CatalogItem, CatalogSkill } from "./catalog";

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
  elementValue: number;
  baseMultiplier: number;
  spiritSkillId?: string | undefined;
}

export interface EquipmentPreviewAttachments {
  elementItem?: CatalogItem | undefined;
  spiritItem?: CatalogItem | undefined;
  skills?: CatalogSkill[] | undefined;
  unitElement?: string | undefined;
  titanTower?: boolean | undefined;
}

export interface AttachmentPreviewStats {
  attack: number;
  defense: number;
  health: number;
  elementValue: number;
  hasAffinity: boolean;
}

export function elementFamily(item: CatalogItem | undefined): string | undefined {
  return item?.elements?.match(/^(\w+)\+/)?.[1];
}

export function hasElementAffinity(item: CatalogItem, attachment: CatalogItem | undefined): boolean {
  if (attachment && item.builtInElementId === attachment.id) return true;
  const family = elementFamily(attachment);
  if (!family) return false;
  const affinity = item.elementAffinity?.split(",").map((value) => value.trim()) ?? [];
  return affinity.includes(family) || affinity.includes("all");
}

export function hasSpiritAffinity(item: CatalogItem, attachment: CatalogItem | undefined): boolean {
  if (!attachment) return false;
  return item.builtInSpiritId === attachment.id
    || Boolean(item.spiritAffinity?.split(",").map((value) => value.trim()).includes(attachment.id));
}

export function previewAttachmentStats(
  item: CatalogItem,
  attachment: CatalogItem | undefined,
  kind: "element" | "spirit",
  config?: Pick<EquipmentPreviewConfig, "transcendence">,
  unitElement?: string,
): AttachmentPreviewStats {
  if (!attachment) return { attack: 0, defense: 0, health: 0, elementValue: 0, hasAffinity: false };
  const transcended = (config?.transcendence ?? 0) > 0;
  const rawAttack = (item.attack ?? 0) + (transcended ? item.transcendAttack ?? 0 : 0);
  const rawDefense = (item.defense ?? 0) + (transcended ? item.transcendDefense ?? 0 : 0);
  const rawHealth = (item.health ?? 0) + (transcended ? item.transcendHealth ?? 0 : 0);
  const hasAffinity = kind === "element" ? hasElementAffinity(item, attachment) : hasSpiritAffinity(item, attachment);
  const multiplier = hasAffinity ? 1.5 : 1;
  const contribution = (stat: "attack" | "defense" | "health", raw: number) =>
    Math.min(raw, Math.floor((attachment[stat] ?? 0) * multiplier));
  const family = kind === "element" ? elementFamily(attachment) : undefined;
  const baseElementValue = Number(attachment.elements?.match(/^\w+\+(\d+)/)?.[1] ?? 0);
  const affinities = item.elementAffinity?.split(",").map((value) => value.trim()) ?? [];
  const directElementAffinity = kind === "element"
    && Boolean(attachment && (item.builtInElementId === attachment.id || (family && affinities.includes(family))));
  const allElementAffinity = kind === "element" && affinities.includes("all");
  const affinityBonus = directElementAffinity ? (attachment.tier < 12 ? 5 : 10) : allElementAffinity ? 5 : 0;
  return {
    attack: contribution("attack", rawAttack),
    defense: contribution("defense", rawDefense),
    health: contribution("health", rawHealth),
    elementValue: family && (unitElement === family || unitElement === "all") ? baseElementValue + affinityBonus : 0,
    hasAffinity,
  };
}

export function resolveSpiritSkill(
  item: CatalogItem,
  spiritItem: CatalogItem | undefined,
  skills: CatalogSkill[] | undefined,
): CatalogSkill | undefined {
  if (!spiritItem?.skill || !skills) return undefined;
  const skillId = hasSpiritAffinity(item, spiritItem) ? `${spiritItem.skill}_plus` : spiritItem.skill;
  return skills.find((skill) => skill.id === skillId)
    ?? skills.find((skill) => skill.id === spiritItem.skill);
}

/** Mirrors the archived web equipment helper, including core enchants and item-scoped spirit effects. */
export function previewEquipmentStats(item: CatalogItem, config: EquipmentPreviewConfig, attachments: EquipmentPreviewAttachments = {}): EquipmentPreviewStats {
  const transcended = config.transcendence > 0;
  const rawAttack = (item.attack ?? 0) + (transcended ? item.transcendAttack ?? 0 : 0);
  const rawDefense = (item.defense ?? 0) + (transcended ? item.transcendDefense ?? 0 : 0);
  const rawHealth = (item.health ?? 0) + (transcended ? item.transcendHealth ?? 0 : 0);
  const baseMultiplier = 1
    + (config.shiny ? (item.shinyMultiplier ?? 1) - 1 : 0)
    + (transcended ? (item.transcendMultiplier ?? 1) - 1 : 0);
  const rarity = qualityMultiplier[config.quality];
  const element = previewAttachmentStats(item, attachments.elementItem, "element", config, attachments.unitElement);
  const spirit = previewAttachmentStats(item, attachments.spiritItem, "spirit", config, attachments.unitElement);
  const spiritSkill = resolveSpiritSkill(item, attachments.spiritItem, attachments.skills);
  const itemPercent = attachments.titanTower && spiritSkill?.id.startsWith("i_tomb")
    ? 1
    : spiritSkill?.modifiers?.item ?? 0;
  const scaled = (value: number, stat: "attack" | "defense" | "health") => {
    const withUpgrades = Math.round(value * baseMultiplier);
    return stat === "health"
      ? Math.round(withUpgrades * (1 + itemPercent))
      : Math.floor(withUpgrades * (1 + itemPercent));
  };
  return {
    attack: scaled(Math.round(rawAttack * rarity) + element.attack + spirit.attack, "attack"),
    defense: scaled(Math.round(rawDefense * rarity) + element.defense + spirit.defense, "defense"),
    health: scaled(Math.round(rawHealth * rarity) + element.health + spirit.health, "health"),
    evasion: (item.evasion ?? 0) + (transcended ? item.transcendEvasion ?? 0 : 0),
    critical: (item.critical ?? 0) + (transcended ? item.transcendCritical ?? 0 : 0),
    elementValue: element.elementValue,
    baseMultiplier,
    ...(spiritSkill ? { spiritSkillId: spiritSkill.id } : {}),
  };
}
