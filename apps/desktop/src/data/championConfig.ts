import type { Catalog } from "./catalog";
import type { Champion, ChampionEquipmentConfig, ChampionLoadout, Quality } from "../types/domain";

interface OnlineChampionEquipment {
  itemId?: string | null;
  quality?: string;
  elementId?: string | null;
  spiritId?: string | null;
  shiny?: boolean;
  transcend?: boolean;
}

export interface OnlineChampionConfig {
  championId: string;
  level: number;
  rank: number;
  seedHp?: number;
  seedAtk?: number;
  seedDef?: number;
  isTitan?: boolean;
  cardLevel?: number;
  equipment?: {
    familiar?: OnlineChampionEquipment;
    aurasong?: OnlineChampionEquipment;
  };
}

const qualityFromOnline: Record<string, Quality> = {
  common: "普通",
  normal: "普通",
  uncommon: "优质",
  superior: "优质",
  flawless: "高级",
  epic: "史诗",
  legendary: "传说",
};
const qualityToOnline: Record<Quality, string> = {
  普通: "common",
  优质: "uncommon",
  高级: "flawless",
  史诗: "epic",
  传说: "legendary",
};

function decodePayload(configString: string): OnlineChampionConfig {
  const encoded = configString.trim().split(/\s+/).at(-1);
  if (!encoded) throw new Error("配置码缺少配置内容");
  try {
    const config = JSON.parse(decodeURIComponent(atob(encoded))) as OnlineChampionConfig;
    if (!config.championId || !Number.isFinite(config.level) || !Number.isFinite(config.rank)) throw new Error("字段缺失");
    return config;
  } catch {
    throw new Error("不是有效的线上勇士配置码");
  }
}

function fromOnlineEquipment(catalog: Catalog, source: OnlineChampionEquipment | undefined, itemType: "xf" | "xx"): ChampionEquipmentConfig | undefined {
  if (!source) return undefined;
  const item = source.itemId ? catalog.items.find((entry) => entry.id === source.itemId && entry.itemType === itemType) : undefined;
  return {
    ...(item ? { itemId: item.id, name: item.name } : {}),
    quality: qualityFromOnline[source.quality ?? "common"] ?? "普通",
    ...(source.elementId ? { element: source.elementId } : {}),
    ...(source.spiritId ? { spirit: source.spiritId } : {}),
    shiny: Boolean(source.shiny),
    transcendence: source.transcend ? 1 : 0,
  };
}

function toOnlineEquipment(source: ChampionEquipmentConfig | undefined, fallbackId: string): OnlineChampionEquipment {
  return {
    itemId: source?.itemId || fallbackId || null,
    quality: qualityToOnline[source?.quality ?? "普通"],
    elementId: source?.element ?? null,
    spiritId: source?.spirit ?? null,
    shiny: Boolean(source?.shiny),
    transcend: Boolean(source?.transcendence),
  };
}

export function importOnlineChampionConfig(catalog: Catalog, configString: string, champion: Champion): ChampionLoadout {
  const config = decodePayload(configString);
  const familiarEquipment = fromOnlineEquipment(catalog, config.equipment?.familiar, "xf");
  const auraSongEquipment = fromOnlineEquipment(catalog, config.equipment?.aurasong, "xx");
  return {
    level: Math.max(1, Math.min(50, config.level)),
    rank: Math.max(1, Math.min(71, config.rank)),
    seed: Math.max(0, Math.min(80, config.seedHp ?? 0)),
    cardLevel: Math.max(0, Math.min(3, config.cardLevel ?? 0)),
    titan: Boolean(config.isTitan),
    familiar: familiarEquipment?.itemId ?? champion.familiar ?? "",
    aurasong: auraSongEquipment?.itemId ?? champion.aurasong ?? "",
    ...(familiarEquipment ? { familiarEquipment } : {}),
    ...(auraSongEquipment ? { auraSongEquipment } : {}),
  };
}

export function encodeOnlineChampionConfig(champion: Champion, loadout: ChampionLoadout): string {
  const config: OnlineChampionConfig = {
    championId: champion.id,
    level: loadout.level,
    rank: loadout.rank,
    seedHp: loadout.seed,
    seedAtk: loadout.seed,
    seedDef: loadout.seed,
    isTitan: loadout.titan,
    cardLevel: loadout.cardLevel,
    equipment: {
      familiar: toOnlineEquipment(loadout.familiarEquipment, loadout.familiar),
      aurasong: toOnlineEquipment(loadout.auraSongEquipment, loadout.aurasong),
    },
  };
  return `【传奇智游社 | ${champion.name}勇士配置（请在英雄体系搭配平台勇士配装面板最上方粘贴导入）】\n${btoa(encodeURIComponent(JSON.stringify(config)))}`;
}
