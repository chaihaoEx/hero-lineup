import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const classesPath = resolve(projectRoot, "content/TextAsset/classes.json");
const outputPath = resolve(projectRoot, "apps/desktop/src/data/heroTemplates.generated.json");
const classes = JSON.parse(await readFile(classesPath, "utf8"));
const classIds = Object.keys(classes).sort();

const templateGroups = await Promise.all(classIds.map(async (heroClass) => {
  const endpoint = `https://cq-zys.cn/api/hero-lineup/hero-templates?heroClass=${encodeURIComponent(heroClass)}`;
  const response = await fetch(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${heroClass}: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.success || !Array.isArray(body.templates)) throw new Error(`${heroClass}: invalid response`);
  return body.templates.map(({ id, name, configString }) => ({ id, heroClass, name, configString }));
}));

const snapshot = {
  schemaVersion: 1,
  source: "archived-online-api",
  generatedAt: new Date().toISOString(),
  classCount: classIds.length,
  templates: templateGroups.flat().sort((left, right) => left.heroClass.localeCompare(right.heroClass) || left.name.localeCompare(right.name)),
};

await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Saved ${snapshot.templates.length} templates for ${snapshot.classCount} classes to ${outputPath}`);
