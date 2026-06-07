import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "edinet", "by-date");
const apiKey = process.env.EDINET_SUBSCRIPTION_KEY;
const targetDate = process.argv[2] ?? yesterdayJst();

if (!apiKey) {
  console.log("EDINET_SUBSCRIPTION_KEY is not set; skipping EDINET fetch.");
  process.exit(0);
}

const data = await fetchEdinetFilings(targetDate, apiKey);
await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, `${targetDate}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`EDINET ${targetDate}: ${data.filings.length} listed-company filings`);

async function fetchEdinetFilings(date, key) {
  const url = new URL("https://api.edinet-fsa.go.jp/api/v2/documents.json");
  url.searchParams.set("date", date);
  url.searchParams.set("type", "2");
  url.searchParams.set("Subscription-Key", key);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`EDINET fetch failed: ${response.status}`);
  const payload = await response.json();
  const results = Array.isArray(payload.results) ? payload.results : [];

  const filings = results
    .filter((item) => item.secCode)
    .map((item) => ({
      date,
      submitDateTime: item.submitDateTime ?? "",
      ticker: String(item.secCode).slice(0, 4),
      edinetCode: item.edinetCode ?? "",
      filerName: item.filerName ?? "",
      docID: item.docID ?? "",
      docTypeCode: item.docTypeCode ?? "",
      docDescription: item.docDescription ?? "",
      periodStart: item.periodStart ?? "",
      periodEnd: item.periodEnd ?? "",
      xbrlFlag: item.xbrlFlag ?? "",
      pdfFlag: item.pdfFlag ?? "",
      csvFlag: item.csvFlag ?? ""
    }))
    .sort((a, b) => String(b.submitDateTime).localeCompare(String(a.submitDateTime)));

  return {
    generatedAt: new Date().toISOString(),
    coverageThrough: date,
    dataSource: "EDINET official API v2",
    note: "PDF/XBRL download requires an EDINET API key. This archive stores metadata only.",
    filings
  };
}

function yesterdayJst() {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const now = new Date();
  const jstDate = new Date(`${formatter.format(now)}T00:00:00+09:00`);
  jstDate.setDate(jstDate.getDate() - 1);
  return formatter.format(jstDate);
}
