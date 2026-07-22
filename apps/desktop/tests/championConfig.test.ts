import { encodeOnlineChampionConfig, importOnlineChampionConfig } from "../src/data/championConfig";
import { catalogChampions, previewCatalog } from "../src/data/catalog";

test("round-trips the online champion configuration shape", () => {
  const champion = catalogChampions(previewCatalog)[0]!;
  const loadout = {
    level: 45,
    rank: 12,
    seed: 20,
    cardLevel: 3,
    titan: true,
    familiar: "",
    aurasong: "",
  };
  const encoded = encodeOnlineChampionConfig(champion, loadout);
  expect(encoded).toContain("勇士配置");
  expect(importOnlineChampionConfig(previewCatalog, encoded, champion)).toMatchObject(loadout);
});
