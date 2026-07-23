export type ElementType = "火" | "水" | "土" | "风" | "光" | "暗";
export type Quality = "普通" | "优质" | "高级" | "史诗" | "传说";

export interface EquipmentSlot {
  slot: "武器" | "头部" | "身体" | "手部" | "脚部" | "饰品";
  itemId?: string | undefined;
  name?: string | undefined;
  quality: Quality;
  /** Local enchant item id (legacy data may still contain a Chinese element name). */
  element?: string | undefined;
  spirit?: string | undefined;
  shiny: boolean;
  transcendence: number;
}

export interface UnitStats {
  attack: number;
  defense: number;
  health: number;
  evasion: number;
  crit: number;
  /** Live calculated element power used by adventure barriers. */
  element?: number | undefined;
  aggro?: number | undefined;
  criticalDamage?: number | undefined;
}

export interface Hero {
  id: string;
  kind: "hero";
  name: string;
  classId: string;
  className: string;
  spritePath?: string | undefined;
  element: ElementType;
  level: number;
  rank: number;
  seed: number;
  titan: boolean;
  cardLevel: number;
  skills: string[];
  equipment: EquipmentSlot[];
  stats: UnitStats;
}

export interface Champion {
  id: string;
  kind: "champion";
  name: string;
  classId?: string | undefined;
  spritePath?: string | undefined;
  element: ElementType;
  level: number;
  rank: number;
  cardLevel: number;
  familiar?: string | undefined;
  aurasong?: string | undefined;
  stats: UnitStats;
}

export interface ChampionLoadout {
  level: number;
  rank: number;
  seed: number;
  cardLevel: number;
  titan: boolean;
  familiar: string;
  aurasong: string;
  familiarEquipment?: ChampionEquipmentConfig | undefined;
  auraSongEquipment?: ChampionEquipmentConfig | undefined;
  stats?: UnitStats | undefined;
}

export interface ChampionEquipmentConfig {
  itemId?: string | undefined;
  name?: string | undefined;
  quality: Quality;
  element?: string | undefined;
  spirit?: string | undefined;
  shiny: boolean;
  transcendence: number;
}

export interface CalculationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  itemId?: string | undefined;
  slot?: string | undefined;
}

export interface CalculatedSheet {
  stats: {
    health: number; attack: number; defense: number; evasion: number; critical: number;
    criticalDamage: number; aggro: number; elementValue: number;
  };
  issues: CalculationIssue[];
  applied: Record<string, unknown>;
}

export type PartyUnit = Hero | Champion;

export interface SimulationConfig {
  iterations: 1000 | 10000;
  seed: number;
  booster: boolean;
  boosterLevel?: 0 | 1 | 2 | 3 | undefined;
  elite: boolean;
  eliteKind?: "none" | "agile" | "huge" | "dire" | "wealthy" | "epic" | undefined;
  /** Online selectedElement: undefined=automatic quest barrier, force=no barrier. */
  selectedElement?: "fire" | "water" | "earth" | "air" | "light" | "dark" | "force" | undefined;
  titanTower: boolean;
  xpBooster?: 0 | 1 | 2 | 3 | undefined;
  tombCurseBooster?: 0 | 1 | 2 | 3 | undefined;
  adventureMasteryXp?: boolean | undefined;
  guildXpBoost?: boolean | undefined;
  eventXpBoost?: boolean | undefined;
  towerModifiers?: string[] | undefined;
  towerModifierElements?: Record<string, string> | undefined;
  tombFloor?: number | undefined;
}

export interface SimulationAttemptResult {
  iterations: number;
  successRate: number;
  averageTurns: number;
  minTurns: number;
  maxTurns: number;
  memberResults: Array<{
    id: string;
    survivalRate: number;
    averageDamage: number;
    averageRemainingHealth: number;
  }>;
}

export interface SimulationResult {
  iterations?: number;
  successRate: number;
  averageTurns: number;
  minTurns: number;
  maxTurns: number;
  survivalRate: number;
  averageDamage: number;
  averageRemainingHealth: number;
  memberResults?: SimulationAttemptResult["memberResults"];
  firstAttempt?: SimulationAttemptResult | undefined;
  secondAttempt?: SimulationAttemptResult | undefined;
  hasSecondAttempt?: boolean | undefined;
  overallMemberResults?: Array<{ id: string; survivalRate: number }> | undefined;
  simulatorVersion: string;
  gameDataVersion: string;
  completedAt: string;
  stale?: boolean;
}

export interface AdventureTask {
  id: string;
  questId?: string | undefined;
  name: string;
  map: string;
  difficulty: string;
  maxMembers: number;
  memberIds: string[];
  barrier: Partial<Record<ElementType, number>>;
  config: SimulationConfig;
  result?: SimulationResult | undefined;
  gameDataVersion?: string | undefined;
}

export interface TaskGroup {
  id: string;
  name: string;
  tasks: AdventureTask[];
}

export interface LineupSystem {
  id: string;
  name: string;
  description: string;
  /** Offline equivalent of the web public flag: visible in the local collection only. */
  localPublic: boolean;
  localTag: "本地" | "示例" | "收藏";
  heroes: Hero[];
  championIds: string[];
  championLoadouts: Record<string, ChampionLoadout>;
  /** Online-compatible owned inventory, keyed by `${itemId}_${quality}` for each roster kind. */
  equipmentOwnedCounts?: {
    hero: Record<string, number | "">;
    champion: Record<string, number | "">;
  } | undefined;
  taskGroups: TaskGroup[];
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  gameDataVersion: string;
}

export interface BuildTemplate {
  id: string;
  name: string;
  classId?: string | undefined;
  build: {
    kind: "hero" | "champion-loadout";
    payload: Hero | ChampionLoadout;
  };
  updatedAt: string;
}

export interface ExportEnvelope {
  format: "zyslineup";
  schemaVersion: number;
  gameDataVersion: string;
  appVersion: string;
  exportedAt: string;
  systems: LineupSystem[];
}

export interface CanonicalVersions {
  appVersion: string; gameDataVersion: string; simulatorVersion: string; assetVersion: string;
}

export interface CanonicalEquipment {
  itemId: string; name?: string | undefined; slot: "weapon" | "head" | "body" | "hands" | "feet" | "accessory" | "familiar" | "auraSong";
  quality: "normal" | "superior" | "flawless" | "epic" | "legendary"; element?: string | undefined; spirit?: string | undefined;
  shiny: boolean; transcended: boolean; transcendence: number;
}

export interface CanonicalHero {
  id: string; classId: string; name: string; level: number; rank: number; seed: number; cardLevel: number;
  className: string; spritePath?: string | undefined; element: string; stats: UnitStats; titan: boolean;
  seedPoints: Record<string, number>; equipment: CanonicalEquipment[]; skillIds: string[]; cardLevels: Record<string, number>;
}

export interface CanonicalChampion {
  id: string; loadoutPresent: boolean; name: string; classId?: string | undefined; spritePath?: string | undefined; element: string; level: number; rank: number;
  seed: number; cardLevel: number; titan: boolean; familiarId: string; auraSongId: string; stats: UnitStats;
  cardLevels: Record<string, number>; familiar?: CanonicalEquipment | undefined; auraSong?: CanonicalEquipment | undefined;
}

export interface CanonicalTask {
  id: string; questId: string; name: string; map: string; groupId?: string | undefined; heroIds: string[]; championIds: string[];
  difficulty: number; maxMembers: number; barrier: Record<string, number>; config: SimulationConfig;
  result?: SimulationResult | undefined; modifiers: string[]; simulation?: Record<string, unknown> | undefined;
}

export interface CanonicalSystem {
  id: string; name: string; description: string; localPublic: boolean; localTag: string; schemaVersion: number;
  gameDataVersion: string; groups: { id: string; name: string; sortOrder: number }[]; heroes: CanonicalHero[];
  champions: CanonicalChampion[];
  equipmentOwnedCounts?: { hero: Record<string, number | "">; champion: Record<string, number | ""> } | undefined;
  adventureTasks: CanonicalTask[]; createdAt: string; updatedAt: string;
}

export interface SimulationProgress {
  taskId: string;
  completed: number;
  total: number;
  phase: "queued" | "running" | "complete" | "cancelled";
}
