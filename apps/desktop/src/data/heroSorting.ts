import type { CatalogClass } from "./catalog";
import type { Hero } from "../types/domain";

export type HeroSortMode = "class" | "element";

/** Exact `Hs` order used by the archived online HeroLineup roster sorter. */
export const onlineHeroElementOrder: Hero["element"][] = ["光", "暗", "火", "水", "土", "风"];

export function sortHeroesLikeOnline(heroes: Hero[], classes: CatalogClass[], mode: HeroSortMode): Hero[] {
  const classOrder = new Map(classes.map((entry, index) => [entry.id, index]));
  const classById = new Map(classes.map((entry) => [entry.id, entry]));
  const elementOrder = (hero: Hero) => {
    if (classById.get(hero.classId)?.allElements) return onlineHeroElementOrder.length;
    const index = onlineHeroElementOrder.indexOf(hero.element);
    return index < 0 ? onlineHeroElementOrder.length + 1 : index;
  };
  return [...heroes].sort((left, right) => {
    if (mode === "element") {
      const elementDifference = elementOrder(left) - elementOrder(right);
      if (elementDifference) return elementDifference;
    }
    const classDifference = (classOrder.get(left.classId) ?? classes.length)
      - (classOrder.get(right.classId) ?? classes.length);
    return classDifference || left.name.localeCompare(right.name);
  });
}
