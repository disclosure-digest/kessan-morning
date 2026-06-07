import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const TDNET_BASE = "https://www.release.tdnet.info/inbs/";

const outputRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");

const topix17ByIndustry33 = {
  "水産・農林業": "食品",
  "食料品": "食品",
  "鉱業": "エネルギー資源",
  "石油・石炭製品": "エネルギー資源",
  "建設業": "建設・資材",
  "金属製品": "建設・資材",
  "ガラス・土石製品": "建設・資材",
  "繊維製品": "素材・化学",
  "パルプ・紙": "素材・化学",
  "化学": "素材・化学",
  "医薬品": "医薬品",
  "ゴム製品": "自動車・輸送機",
  "輸送用機器": "自動車・輸送機",
  "鉄鋼": "鉄鋼・非鉄",
  "非鉄金属": "鉄鋼・非鉄",
  "機械": "機械",
  "電気機器": "電機・精密",
  "精密機器": "電機・精密",
  "その他製品": "情報通信・サービスその他",
  "情報・通信業": "情報通信・サービスその他",
  "サービス業": "情報通信・サービスその他",
  "電気・ガス業": "電力・ガス",
  "陸運業": "運輸・物流",
  "海運業": "運輸・物流",
  "空運業": "運輸・物流",
  "倉庫・運輸関連業": "運輸・物流",
  "卸売業": "商社・卸売",
  "小売業": "小売",
  "銀行業": "銀行",
  "証券、商品先物取引業": "金融（除く銀行）",
  "保険業": "金融（除く銀行）",
  "その他金融業": "金融（除く銀行）",
  "不動産業": "不動産"
};

const marketBaseImpact = {
  "東": 420,
  "プライム": 420,
  "Prime": 420,
  "スタンダード": 240,
  "Standard": 240,
  "グロース": 210,
  "Growth": 210,
  "札": 160,
  "名": 160,
  "福": 150
};

const topixSizeImpact = {
  Core30: 1000,
  Large70: 900,
  Mid400: 700,
  Small1: 500,
  Small2: 320,
  Micro: 180
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targetDate = process.argv[2] ?? yesterdayJst();
  const data = await fetchTdnetEarnings(targetDate);
  await saveEarningsData(data, outputRoot);
  const itemCount = data.companies.reduce((sum, company) => sum + company.items.length, 0);
  console.log(`TDnet ${targetDate}: ${data.meta.totalDisclosures} disclosures, ${itemCount} earnings disclosures`);
}

export async function fetchTdnetEarnings(targetDate) {
  const compactDate = targetDate.replaceAll("-", "");
  const rows = await fetchAllRows(compactDate);
  const earnings = rows.filter(isEarningsDisclosure);
  const metadata = await loadCompanyMetadata();
  return toAppData(targetDate, rows.length, earnings, metadata);
}

export async function saveEarningsData(data, root = outputRoot, options = {}) {
  const writeLatest = options.writeLatest ?? true;
  await mkdir(resolve(root, "by-date"), { recursive: true });
  if (writeLatest) {
    await writeFile(resolve(root, "latest.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  await writeFile(resolve(root, "by-date", `${data.coverageThrough}.json`), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function fetchAllRows(date) {
  const allRows = [];

  for (let page = 1; page <= 20; page += 1) {
    const html = await fetchPage(date, page);
    if (!html || !html.includes("kjTitle")) break;

    const pageRows = parseRows(html);
    if (pageRows.length === 0) break;
    allRows.push(...pageRows);

    const nextPage = `I_list_${String(page + 1).padStart(3, "0")}_${date}.html`;
    if (!html.includes(nextPage)) break;
  }

  return allRows;
}

async function fetchPage(date, page) {
  const pageId = String(page).padStart(3, "0");
  const url = `${TDNET_BASE}I_list_${pageId}_${date}.html`;
  const response = await fetch(url);
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`TDnet fetch failed: ${response.status} ${url}`);
  return response.text();
}

function parseRows(html) {
  const rowPattern = /<tr>\s*<td[^>]*kjTime[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*kjCode[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*kjName[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*kjTitle[^>]*>[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*kjXbrl[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*kjPlace[^>]*>([\s\S]*?)<\/td>/g;
  return [...html.matchAll(rowPattern)].map((match) => {
    const xbrlHtml = match[6];
    const xbrlHref = xbrlHtml.match(/href="([^"]+)"/)?.[1] ?? "";
    return {
      time: clean(match[1]),
      code: clean(match[2]).slice(0, 4),
      companyName: clean(match[3]),
      title: clean(match[5]),
      pdfUrl: absoluteUrl(match[4]),
      xbrlUrl: xbrlHref ? absoluteUrl(xbrlHref) : "",
      market: clean(match[7])
    };
  });
}

function isEarningsDisclosure(row) {
  return [
    "決算短信",
    "決算説明",
    "決算補足",
    "決算資料",
    "Financial Results"
  ].some((keyword) => row.title.toLowerCase().includes(keyword.toLowerCase()));
}

async function loadCompanyMetadata() {
  try {
    const raw = await readFile(resolve(outputRoot, "company-metadata.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.companies ?? {};
  } catch {
    return {};
  }
}

function toAppData(date, totalDisclosures, disclosures, metadata) {
  const companies = new Map();

  for (const disclosure of disclosures) {
    const companyMetadata = metadata[disclosure.code] ?? {};
    const industry33 = companyMetadata.industry33 ?? companyMetadata.industry ?? "未分類";
    const industry17 = companyMetadata.industry17 ?? topix17ByIndustry33[industry33] ?? "未分類";
    const impact = calculateMarketImpact(disclosure, companyMetadata);

    if (!companies.has(disclosure.code)) {
      companies.set(disclosure.code, {
        ticker: disclosure.code,
        name: companyMetadata.name ?? disclosure.companyName,
        tdnetName: disclosure.companyName,
        market: companyMetadata.market ?? disclosure.market,
        industry: industry17,
        industry17,
        industry33,
        marketCap: companyMetadata.marketCap ?? null,
        topixSize: companyMetadata.topixSize ?? null,
        marketImpactScore: impact.score,
        impactRankReason: impact.reason,
        overallSignal: "neutral",
        brief: `${date} にTDnetで開示された決算関連資料です。`,
        items: []
      });
    } else {
      const company = companies.get(disclosure.code);
      if (impact.score > Number(company.marketImpactScore ?? 0)) {
        company.marketImpactScore = impact.score;
        company.impactRankReason = impact.reason;
      }
    }

    const importance = estimateImportance(disclosure, impact.score);
    const documentKind = documentKindForTitle(disclosure.title);
    const documents = [
      { label: documentKind.label, url: disclosure.pdfUrl }
    ];
    companies.get(disclosure.code).items.push({
      date,
      time: disclosure.time,
      type: "earnings",
      documentKind: documentKind.value,
      documentKindLabel: documentKind.label,
      importance,
      title: disclosure.title,
      summary: `${disclosure.time} TDnet開示。原文リンクから決算短信・決算資料を確認できます。`,
      sourceName: "TDnet",
      sourceUrl: disclosure.pdfUrl,
      documents
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    coverageThrough: date,
    dataSource: "TDnet public disclosure list + company metadata",
    summary: `${date} にTDnetで開示された決算関連資料を一覧化しました。`,
    meta: {
      totalDisclosures,
      earningsDisclosures: disclosures.length,
      metadataSource: "data/company-metadata.json when available",
      industryScheme: "TOPIX 17 sectors",
      impactScore: "marketCap if available, otherwise TOPIX size / market segment / disclosure title proxy"
    },
    companies: [...companies.values()]
  };
}

function calculateMarketImpact(disclosure, metadata) {
  if (Number.isFinite(Number(metadata.marketCap)) && Number(metadata.marketCap) > 0) {
    const score = Math.round(Math.log10(Number(metadata.marketCap)) * 80);
    return { score, reason: "時価総額データから算出" };
  }

  if (metadata.topixSize && topixSizeImpact[metadata.topixSize]) {
    return { score: topixSizeImpact[metadata.topixSize], reason: `TOPIX規模区分 ${metadata.topixSize} を代理変数として使用` };
  }

  const marketKey = Object.keys(marketBaseImpact).find((key) => disclosure.market.includes(key) || String(metadata.market ?? "").includes(key));
  const base = marketBaseImpact[marketKey] ?? 120;
  const titleBonus = materialityBonus(disclosure.title);
  return {
    score: base + titleBonus,
    reason: `時価総額未取得のため、市場区分${marketKey ? `（${marketKey}）` : ""}と開示表題を代理変数として使用`
  };
}

function materialityBonus(title) {
  let bonus = 0;
  if (/業績予想|通期予想|修正|上方|下方|見通し/.test(title)) bonus += 120;
  if (/配当|自己株式|株主還元/.test(title)) bonus += 80;
  if (/訂正/.test(title)) bonus += 50;
  if (/決算短信/.test(title)) bonus += 30;
  if (/Financial Results/i.test(title)) bonus += 20;
  return bonus;
}

function estimateImportance(disclosure, impactScore) {
  const material = materialityBonus(disclosure.title);
  if (impactScore >= 650 || material >= 120) return "high";
  if (impactScore >= 300 || material >= 50) return "medium";
  return "low";
}

function documentLabel(title) {
  return documentKindForTitle(title).label;
}

function documentKindForTitle(title) {
  if (/決算短信|Financial Results/i.test(title)) return { value: "summary", label: "決算短信" };
  if (/決算説明/.test(title)) return { value: "presentation", label: "決算説明資料" };
  if (/補足|Supplementary/i.test(title)) return { value: "supplement", label: "補足資料" };
  if (/決算資料/.test(title)) return { value: "materials", label: "決算資料" };
  return { value: "other", label: "その他決算資料" };
}

function absoluteUrl(href) {
  return new URL(href, TDNET_BASE).href;
}

function clean(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function yesterdayJst() {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const now = new Date();
  const jstDate = new Date(formatter.format(now));
  jstDate.setDate(jstDate.getDate() - 1);
  return formatter.format(jstDate);
}
