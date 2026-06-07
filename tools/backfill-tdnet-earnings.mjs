import { fetchTdnetEarnings, saveEarningsData } from "./fetch-tdnet-earnings.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const firstArg = process.argv[2] ?? "45";
const secondArg = process.argv[3] ?? yesterdayJst();

const dates = /^\d{4}-\d{2}-\d{2}$/.test(firstArg)
  ? dateRangeInclusive(firstArg, secondArg)
  : trailingDates(secondArg, Number(firstArg));

for (const date of dates) {
  const data = await fetchTdnetEarnings(date);
  const items = data.companies.reduce((sum, company) => sum + company.items.length, 0);
  const existingItems = await existingItemCount(date);
  if (items === 0 && existingItems > 0) {
    console.log(`${date}: keeping existing ${existingItems} earnings disclosures`);
    continue;
  }
  await saveEarningsData(data, undefined, { writeLatest: false });
  console.log(`${date}: ${items} earnings disclosures`);
}

async function existingItemCount(date) {
  try {
    const raw = await readFile(resolve(appRoot, "data", "by-date", `${date}.json`), "utf8");
    const data = JSON.parse(raw);
    return (data.companies ?? []).reduce((sum, company) => sum + (company.items ?? []).length, 0);
  } catch {
    return 0;
  }
}

function trailingDates(end, daysBack) {
  const dates = [];
  const cursor = parseDate(end);
  for (let i = 0; i < daysBack; i += 1) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return dates;
}

function dateRangeInclusive(start, end) {
  const dates = [];
  const cursor = parseDate(start);
  const last = parseDate(end);
  while (cursor <= last) {
    dates.push(formatDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function parseDate(value) {
  return new Date(`${value}T00:00:00+09:00`);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function yesterdayJst() {
  const now = new Date();
  const jstDate = parseDate(formatDate(now));
  jstDate.setDate(jstDate.getDate() - 1);
  return formatDate(jstDate);
}
