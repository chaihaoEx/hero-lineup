import { makeHero, previewCatalog, type CatalogClass } from "../src/data/catalog";
import { onlineHeroElementOrder, sortHeroesLikeOnline } from "../src/data/heroSorting";

const hero = (name: string, classId: string, element: CatalogClass["element"]) => ({
  ...makeHero(previewCatalog, "knight", 1),
  id: name,
  name,
  classId,
  className: classId,
  element,
});

const classes: CatalogClass[] = [
  { ...previewCatalog.classes[0]!, id: "soldier", name: "士兵", element: "土" },
  { ...previewCatalog.classes[0]!, id: "knight", name: "骑士", element: "光" },
  { ...previewCatalog.classes[0]!, id: "ranger", name: "游侠", element: "风" },
  { ...previewCatalog.classes[0]!, id: "swordmaster", name: "武士", element: "水" },
  { ...previewCatalog.classes[0]!, id: "mage", name: "法师", element: "火" },
  { ...previewCatalog.classes[0]!, id: "sorcerer", name: "魔法师", element: "暗" },
  { ...previewCatalog.classes[0]!, id: "redmage", name: "魔法剑士", element: "光", allElements: true },
];

test("matches the online light-dark-fire-water-earth-air-all element order", () => {
  expect(onlineHeroElementOrder).toEqual(["光", "暗", "火", "水", "土", "风"]);
  const shuffled = [
    hero("游侠1", "ranger", "风"), hero("士兵1", "soldier", "土"),
    hero("魔法剑士1", "redmage", "光"), hero("法师1", "mage", "火"),
    hero("骑士1", "knight", "光"), hero("魔法师1", "sorcerer", "暗"),
    hero("武士1", "swordmaster", "水"),
  ];
  expect(sortHeroesLikeOnline(shuffled, classes, "element").map((entry) => entry.name))
    .toEqual(["骑士1", "魔法师1", "法师1", "武士1", "士兵1", "游侠1", "魔法剑士1"]);
});

test("uses class directory order and then localized hero name as online tie breakers", () => {
  const shuffled = [
    hero("士兵B", "soldier", "土"), hero("骑士A", "knight", "光"),
    hero("士兵A", "soldier", "土"), hero("骑士B", "knight", "光"),
  ];
  expect(sortHeroesLikeOnline(shuffled, classes, "class").map((entry) => entry.name))
    .toEqual(["士兵A", "士兵B", "骑士A", "骑士B"]);
  expect(sortHeroesLikeOnline(shuffled, classes, "element").map((entry) => entry.name))
    .toEqual(["骑士A", "骑士B", "士兵A", "士兵B"]);
});
