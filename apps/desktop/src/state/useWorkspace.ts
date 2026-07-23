import { useCallback, useEffect, useMemo, useState } from "react";
import { catalogChampions, championElementValue, makeDefaultSystem, makeHero, normalizeHeroEquipmentSlots, normalizeQuestPresentation, type Catalog, type CatalogQuest } from "../data/catalog";
import { desktopBridge } from "../platform/bridge";
import type { AdventureTask, ChampionLoadout, Hero, LineupSystem, PartyUnit, SimulationResult, TaskGroup } from "../types/domain";

const clone = <T,>(value: T): T => structuredClone(value);
const MAX_ADVENTURE_TASKS = 48;
const taskCount = (system: LineupSystem) => system.taskGroups.reduce((sum, group) => sum + group.tasks.length, 0);
const barrierForQuest = (quest: CatalogQuest | undefined): AdventureTask["barrier"] => {
  if (!quest || quest.barrierPower <= 0) return {};
  const elements = quest.barrierElements?.length ? quest.barrierElements : quest.barrierElement ? [quest.barrierElement] : [];
  return Object.fromEntries(elements.map((element) => [element, quest.barrierPower])) as AdventureTask["barrier"];
};

export function useWorkspace(catalog: Catalog) {
  const [systems, setSystems] = useState<LineupSystem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void desktopBridge.listSystems().then((loaded) => {
      const migrated = loaded.some((system) => system.heroes.some((hero) => hero.equipment.map((entry) => entry.slot).join(",") === "武器,头部,身体,手部,脚部,饰品"));
      const completeChampionIds = catalog.champions.map((champion) => champion.id);
      const championRosterMigrated = loaded.some((system) => completeChampionIds.some((id) => !system.championIds.includes(id)));
      const emptyGroupMigrated = loaded.some((system) => system.taskGroups.some((group) => group.tasks.length === 0));
      const initial = (loaded.length ? loaded : [makeDefaultSystem(catalog)]).map((system) => normalizeQuestPresentation({
        ...system,
        localPublic: system.localPublic ?? true,
        heroes: system.heroes.map(normalizeHeroEquipmentSlots),
        championIds: completeChampionIds,
        taskGroups: system.taskGroups.filter((group) => group.tasks.length > 0),
      }, catalog));
      setSystems(initial);
      setActiveId(initial[0]!.id);
      setDirty(!loaded.length || migrated || championRosterMigrated || emptyGroupMigrated);
      setLoading(false);
    });
  }, [catalog]);

  const active = useMemo(() => systems.find((system) => system.id === activeId) ?? systems[0], [activeId, systems]);

  const updateActive = useCallback((updater: (system: LineupSystem) => LineupSystem) => {
    setSystems((current) => current.map((system) => system.id === activeId ? updater(clone(system)) : system));
    setDirty(true);
  }, [activeId]);

  const save = useCallback(async () => {
    if (!active) return;
    const saved = normalizeQuestPresentation(await desktopBridge.saveSystem(active), catalog);
    setSystems((current) => current.map((system) => system.id === saved.id ? saved : system));
    setDirty(false);
  }, [active, catalog]);

  const createSystem = useCallback((metadata?: { name?: string; description?: string; localPublic?: boolean }) => {
    const next = makeDefaultSystem(catalog);
    next.name = metadata?.name?.trim() || `新体系 ${systems.length + 1}`;
    next.description = metadata?.description ?? "";
    next.localPublic = metadata?.localPublic ?? true;
    next.heroes = [];
    next.taskGroups = [];
    setSystems((current) => [...current, next]);
    setActiveId(next.id);
    setDirty(true);
  }, [catalog, systems.length]);

  const importSystem = useCallback((source: LineupSystem) => {
    const now = new Date().toISOString();
    const next: LineupSystem = normalizeQuestPresentation({
      ...clone(source),
      id: crypto.randomUUID(),
      localPublic: false,
      localTag: "收藏",
      heroes: source.heroes.map(normalizeHeroEquipmentSlots),
      championIds: catalog.champions.map((champion) => champion.id),
      createdAt: now,
      updatedAt: now,
    }, catalog);
    setSystems((current) => [...current, next]);
    setActiveId(next.id);
    setDirty(true);
    return next;
  }, [catalog]);

  const duplicateSystem = useCallback(() => {
    if (!active) return;
    const next = clone(active);
    next.id = crypto.randomUUID();
    next.name = `${active.name}（副本）`;
    next.createdAt = new Date().toISOString();
    setSystems((current) => [...current, next]);
    setActiveId(next.id);
    setDirty(true);
  }, [active]);

  const deleteActive = useCallback(async () => {
    if (!active) return;
    await desktopBridge.deleteSystem(active.id);
    const remaining = systems.filter((system) => system.id !== active.id);
    const next = remaining.length ? remaining : [makeDefaultSystem(catalog)];
    setSystems(next);
    setActiveId(next[0]!.id);
    setDirty(!remaining.length);
  }, [active, catalog, systems]);

  const addHero = useCallback((classId: string, preset?: Hero) => updateActive((system) => {
    if (system.heroes.length >= 41) return system;
    system.heroes.push(normalizeHeroEquipmentSlots(preset ?? makeHero(catalog, classId, system.heroes.length + 1)));
    return system;
  }), [catalog, updateActive]);

  const updateHero = useCallback((hero: Hero) => updateActive((system) => {
    system.heroes = system.heroes.map((entry) => entry.id === hero.id ? hero : entry);
    return system;
  }), [updateActive]);

  const updateChampionLoadout = useCallback((id: string, loadout: ChampionLoadout) => updateActive((system) => {
    system.championLoadouts ??= {};
    system.championLoadouts[id] = loadout;
    return system;
  }), [updateActive]);

  const deleteHero = useCallback((id: string) => updateActive((system) => {
    system.heroes = system.heroes.filter((hero) => hero.id !== id);
    system.taskGroups.forEach((group) => group.tasks.forEach((task) => { task.memberIds = task.memberIds.filter((member) => member !== id); }));
    return system;
  }), [updateActive]);

  const duplicateHero = useCallback((hero: Hero): Hero | undefined => {
    if (!active || active.heroes.length >= 41) return undefined;
    const names = new Set(active.heroes.map((entry) => entry.name));
    let number = active.heroes.filter((entry) => entry.classId === hero.classId).length + 1;
    while (names.has(`${hero.className}${number}`)) number += 1;
    const next = { ...clone(hero), id: crypto.randomUUID(), name: `${hero.className}${number}` };
    updateActive((system) => { system.heroes.push(next); return system; });
    return next;
  }, [active, updateActive]);

  const toggleChampion = useCallback((id: string) => updateActive((system) => {
    system.championIds = system.championIds.includes(id)
      ? system.championIds.filter((entry) => entry !== id)
      : [...system.championIds, id];
    return system;
  }), [updateActive]);

  const addGroup = useCallback(() => updateActive((system) => {
    if (taskCount(system) >= MAX_ADVENTURE_TASKS) return system;
    const quest = catalog.quests.find((entry) => entry.id === "space04") ?? catalog.quests[0];
    const task: AdventureTask = {
      id: crypto.randomUUID(), questId: quest?.id, name: quest?.name ?? "新冒险", map: quest?.mapName ?? "未指定",
      difficulty: quest?.difficulty ?? "简单", maxMembers: quest?.maxMembers ?? 4, memberIds: [],
      barrier: barrierForQuest(quest),
      config: { iterations: 10000, seed: Date.now(), booster: false, boosterLevel: 0, elite: false, titanTower: false },
    };
    system.taskGroups.push({ id: crypto.randomUUID(), name: `任务分组 ${system.taskGroups.length + 1}`, tasks: [task] });
    return system;
  }), [catalog, updateActive]);

  const moveGroup = useCallback((groupId: string, direction: -1 | 1) => updateActive((system) => {
    const index = system.taskGroups.findIndex((group) => group.id === groupId);
    const target = index + direction;
    if (index >= 0 && target >= 0 && target < system.taskGroups.length) {
      [system.taskGroups[index], system.taskGroups[target]] = [system.taskGroups[target]!, system.taskGroups[index]!];
    }
    return system;
  }), [updateActive]);

  const updateGroup = useCallback((group: TaskGroup) => updateActive((system) => {
    system.taskGroups = system.taskGroups.map((entry) => entry.id === group.id ? group : entry);
    return system;
  }), [updateActive]);

  const deleteGroup = useCallback((groupId: string) => updateActive((system) => {
    system.taskGroups = system.taskGroups.filter((entry) => entry.id !== groupId);
    return system;
  }), [updateActive]);

  const addTask = useCallback((groupId: string, quest: CatalogQuest) => updateActive((system) => {
    if (taskCount(system) >= MAX_ADVENTURE_TASKS) return system;
    const group = system.taskGroups.find((entry) => entry.id === groupId);
    group?.tasks.push({
      id: crypto.randomUUID(), questId: quest.id, name: quest.name, map: quest.mapName,
      difficulty: quest.difficulty, maxMembers: quest.maxMembers, memberIds: [],
      barrier: barrierForQuest(quest),
      config: { iterations: 10000, seed: Date.now(), booster: false, boosterLevel: 0, elite: false, titanTower: quest.category === "泰坦塔" },
    });
    return system;
  }), [updateActive]);

  const duplicateTask = useCallback((groupId: string, task: AdventureTask) => updateActive((system) => {
    if (taskCount(system) >= MAX_ADVENTURE_TASKS) return system;
    const group = system.taskGroups.find((entry) => entry.id === groupId);
    group?.tasks.push({ ...clone(task), id: crypto.randomUUID(), name: `${task.name} 副本`, result: undefined });
    return system;
  }), [updateActive]);

  const deleteTask = useCallback((groupId: string, taskId: string) => updateActive((system) => {
    const group = system.taskGroups.find((entry) => entry.id === groupId);
    if (group) group.tasks = group.tasks.filter((task) => task.id !== taskId);
    system.taskGroups = system.taskGroups.filter((entry) => entry.tasks.length > 0);
    return system;
  }), [updateActive]);

  const moveTask = useCallback((sourceGroupId: string, taskId: string, targetGroupId: string, targetIndex: number) => updateActive((system) => {
    const source = system.taskGroups.find((entry) => entry.id === sourceGroupId);
    const target = system.taskGroups.find((entry) => entry.id === targetGroupId);
    const sourceIndex = source?.tasks.findIndex((task) => task.id === taskId) ?? -1;
    if (!source || !target || sourceIndex < 0) return system;
    const [task] = source.tasks.splice(sourceIndex, 1);
    if (!task) return system;
    const adjustedIndex = source === target && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    target.tasks.splice(Math.max(0, Math.min(adjustedIndex, target.tasks.length)), 0, task);
    if (source !== target && source.tasks.length === 0) {
      system.taskGroups = system.taskGroups.filter((group) => group.id !== sourceGroupId);
    }
    return system;
  }), [updateActive]);

  const replaceActive = useCallback((replacement: LineupSystem) => updateActive((system) => normalizeQuestPresentation({
    ...clone(replacement),
    heroes: replacement.heroes.map(normalizeHeroEquipmentSlots),
    championIds: catalog.champions.map((champion) => champion.id),
    id: system.id,
    createdAt: system.createdAt,
    updatedAt: new Date().toISOString(),
  }, catalog)), [catalog, updateActive]);

  const dropUnit = useCallback((groupId: string, taskId: string, unitId: string) => updateActive((system) => {
    const task = system.taskGroups.find((entry) => entry.id === groupId)?.tasks.find((entry) => entry.id === taskId);
    if (task && !task.memberIds.includes(unitId) && task.memberIds.length < task.maxMembers) task.memberIds.push(unitId);
    return system;
  }), [updateActive]);

  const removeUnit = useCallback((groupId: string, taskId: string, unitId: string) => updateActive((system) => {
    const task = system.taskGroups.find((entry) => entry.id === groupId)?.tasks.find((entry) => entry.id === taskId);
    if (task) task.memberIds = task.memberIds.filter((id) => id !== unitId);
    return system;
  }), [updateActive]);

  const setTaskResult = useCallback((taskId: string, result: SimulationResult) => updateActive((system) => {
    system.taskGroups.forEach((group) => group.tasks.forEach((task) => { if (task.id === taskId) task.result = result; }));
    return system;
  }), [updateActive]);

  const updateTask = useCallback((groupId: string, next: AdventureTask) => updateActive((system) => {
    const group = system.taskGroups.find((entry) => entry.id === groupId);
    if (group) group.tasks = group.tasks.map((task) => task.id === next.id ? next : task);
    return system;
  }), [updateActive]);

  const units = useMemo<PartyUnit[]>(() => active
    ? [...active.heroes, ...catalogChampions(catalog).map((champion) => {
      const loadout = active.championLoadouts?.[champion.id];
      return {
        ...champion,
        ...(loadout ?? {}),
        stats: {
          ...champion.stats,
          ...(loadout?.stats ?? {}),
          element: loadout?.stats?.element ?? championElementValue(loadout?.rank ?? champion.rank),
        },
      };
    })]
    : [], [active, catalog]);

  return {
    systems, setSystems, active, activeId, setActiveId, dirty, setDirty, loading, updateActive, save,
    createSystem, importSystem, duplicateSystem, deleteActive, addHero, updateHero, updateChampionLoadout, deleteHero, duplicateHero,
    toggleChampion, addGroup, moveGroup, updateGroup, deleteGroup, addTask, duplicateTask, deleteTask, moveTask,
    dropUnit, removeUnit, setTaskResult, updateTask, replaceActive, units,
  };
}
