import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dataRoot = resolve(appRoot, "data");
const byDateRoot = resolve(dataRoot, "by-date");

const files = (await readdir(byDateRoot))
  .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
  .sort();

const dates = [];
const counts = {};

for (const file of files) {
  const date = file.replace(".json", "");
  const data = JSON.parse(await readFile(resolve(byDateRoot, file), "utf8"));
  const itemCount = (data.companies ?? []).reduce((sum, company) => sum + (company.items ?? []).length, 0);
  dates.push(date);
  counts[date] = itemCount;
}

await writeFile(resolve(dataRoot, "coverage.json"), `${JSON.stringify({
  earliest: dates[0] ?? null,
  latest: dates.at(-1) ?? null,
  dates,
  counts
}, null, 2)}\n`, "utf8");

console.log(`coverage: ${dates[0] ?? "-"} to ${dates.at(-1) ?? "-"} (${dates.length} days)`);
