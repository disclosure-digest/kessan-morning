const state = {
  data: null,
  edinetData: null,
  latestData: null,
  coverage: null,
  dateMode: "single",
  selectedDate: "",
  rangeStart: "",
  rangeEnd: "",
  loadedSource: "",
  importance: "all",
  documentKind: "all",
  industry: "all",
  market: "all",
  sort: "impact-desc",
  groupByIndustry: false,
  loading: false
};

const labels = {
  earnings: "決算情報",
  high: "高",
  medium: "中",
  low: "低"
};

const STORAGE_KEY = "daily-company-intel-view";

const elements = {
  meta: document.querySelector("#meta"),
  date: document.querySelector("#dateInput"),
  dateStatus: document.querySelector("#dateStatus"),
  today: document.querySelector("#todayButton"),
  clearDate: document.querySelector("#clearDateButton"),
  rangeToggle: document.querySelector("#rangeToggle"),
  rangeControls: document.querySelector("#rangeControls"),
  rangeStart: document.querySelector("#rangeStartInput"),
  rangeEnd: document.querySelector("#rangeEndInput"),
  filterToggle: document.querySelector("#filterToggleButton"),
  controlPanel: document.querySelector(".control-panel"),
  importance: document.querySelector("#importanceFilter"),
  documentKind: document.querySelector("#documentKindFilter"),
  industry: document.querySelector("#industryFilter"),
  market: document.querySelector("#marketFilter"),
  sort: document.querySelector("#sortSelect"),
  groupIndustry: document.querySelector("#groupIndustryToggle"),
  title: document.querySelector("#pageTitle"),
  overview: document.querySelector("#overview"),
  items: document.querySelector("#items"),
  refresh: document.querySelector("#refreshButton")
};

async function loadData() {
  restoreViewState();
  state.latestData = await fetchJson("./data/latest.json");
  state.coverage = await fetchJson("./data/coverage.json").catch(() => null);
  const newestDate = state.latestData.coverageThrough ?? newestItemDate(state.latestData);
  if (!state.selectedDate && state.dateMode === "single") state.selectedDate = newestDate;
  if (!state.rangeStart) state.rangeStart = state.selectedDate || newestDate;
  if (!state.rangeEnd) state.rangeEnd = state.rangeStart;
  syncDateControls();
  if (state.coverage?.earliest) elements.date.min = state.coverage.earliest;
  if (state.coverage?.latest) elements.date.max = state.coverage.latest;
  for (const input of [elements.rangeStart, elements.rangeEnd]) {
    if (state.coverage?.earliest) input.min = state.coverage.earliest;
    if (state.coverage?.latest) input.max = state.coverage.latest;
  }
  await loadSelectedDate();
}

async function loadSelectedDate() {
  state.loadedSource = "";

  if (state.dateMode === "all") {
    setLoading(true);
    try {
      state.data = await loadArchiveRange(state.coverage?.earliest, state.coverage?.latest);
      state.loadedSource = "全期間アーカイブ";
    } finally {
      state.edinetData = null;
      setLoading(false);
    }
    return;
  }

  if (state.dateMode === "range") {
    const start = state.rangeStart || state.selectedDate;
    const end = state.rangeEnd || start;
    setLoading(true);
    try {
      state.data = await loadArchiveRange(start, end);
      state.loadedSource = "期間アーカイブ";
    } finally {
      state.edinetData = null;
      setLoading(false);
    }
    return;
  }

  if (!state.selectedDate) {
    state.dateMode = "all";
    syncDateControls();
    state.data = await loadArchiveRange(state.coverage?.earliest, state.coverage?.latest);
    state.loadedSource = "全期間アーカイブ";
    state.edinetData = null;
    populateFilterOptions();
    render();
    return;
  }

  setLoading(true);
  try {
    try {
      state.data = await fetchJson(`./data/by-date/${state.selectedDate}.json`);
      state.loadedSource = "日付別アーカイブ";
    } catch {
      try {
        state.data = await fetchJson(`/api/earnings?date=${encodeURIComponent(state.selectedDate)}`);
        state.loadedSource = "TDnet API";
      } catch {
      state.data = emptyDataForDate(state.selectedDate);
      state.loadedSource = "未生成";
      }
    }
  } finally {
    state.edinetData = await fetchJson(`./data/edinet/by-date/${state.selectedDate}.json`).catch(() => null);
    setLoading(false);
  }
}

async function loadArchiveRange(start, end) {
  const dates = archivedDatesBetween(start, end);
  const datasets = await Promise.all(dates.map((date) =>
    fetchJson(`./data/by-date/${date}.json`).catch(() => emptyDataForDate(date))
  ));
  return mergeDateDatasets(datasets, start, end);
}

function archivedDatesBetween(start, end) {
  const dates = state.coverage?.dates ?? [];
  if (!start || !end) return dates;
  const [from, to] = [start, end].sort();
  return dates.filter((date) => date >= from && date <= to);
}

function mergeDateDatasets(datasets, start, end) {
  const companies = new Map();
  let totalDisclosures = 0;
  let earningsDisclosures = 0;

  for (const dataset of datasets) {
    const total = Number(dataset?.meta?.totalDisclosures);
    const earnings = Number(dataset?.meta?.earningsDisclosures);
    if (Number.isFinite(total)) totalDisclosures += total;
    if (Number.isFinite(earnings)) earningsDisclosures += earnings;

    for (const company of dataset?.companies ?? []) {
      const key = company.ticker || company.name;
      const existing = companies.get(key);
      if (!existing) {
        companies.set(key, { ...company, items: [...(company.items ?? [])] });
      } else {
        existing.items.push(...(company.items ?? []));
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    coverageThrough: rangeLabel(start, end),
    dataSource: "Date archives",
    summary: `${rangeLabel(start, end)} の取得済み決算関連開示です。`,
    meta: { totalDisclosures, earningsDisclosures },
    companies: [...companies.values()]
  };
}

async function fetchJson(path) {
  const response = await fetch(`${path}${path.includes("?") ? "&" : "?"}ts=${Date.now()}`);
  if (!response.ok) throw new Error(`${path} could not be loaded`);
  return response.json();
}

function setLoading(isLoading) {
  state.loading = isLoading;
  for (const control of [elements.date, elements.today, elements.clearDate, elements.refresh, elements.rangeToggle, elements.rangeStart, elements.rangeEnd]) {
    control.disabled = isLoading;
  }

  if (isLoading) {
    elements.dateStatus.textContent = `${state.selectedDate} の開示データを取得しています...`;
    elements.items.innerHTML = `<p class="empty">TDnetまたは日付別アーカイブから決算一覧を読み込んでいます。</p>`;
  } else {
    syncDateControls();
    populateFilterOptions();
    render();
  }
}

function emptyDataForDate(date) {
  return {
    generatedAt: new Date().toISOString(),
    coverageThrough: date,
    dataSource: "No archive",
    summary: `${date} の日付別データはまだ生成されていません。`,
    meta: { totalDisclosures: "-", earningsDisclosures: 0 },
    companies: []
  };
}

function baseRows() {
  return (state.data?.companies ?? []).flatMap((company) =>
    (company.items ?? [])
      .filter((item) => item.type === "earnings")
      .filter((item) => itemInActiveDateScope(item))
      .map((item) => ({ company, item }))
  );
}

function itemInActiveDateScope(item) {
  if (state.dateMode === "all") return true;
  if (state.dateMode === "range") {
    const [from, to] = [state.rangeStart || "", state.rangeEnd || state.rangeStart || ""].sort();
    return !item.date || (item.date >= from && item.date <= to);
  }
  return !state.selectedDate || item.date === state.selectedDate;
}

function earningsRows() {
  return sortRows(baseRows().filter(({ company, item }) => {
    const industry = company.industry17 || company.industry || "未分類";
    const market = company.market || "未分類";
    return (state.importance === "all" || item.importance === state.importance)
      && (state.documentKind === "all" || normalizeDocumentKind(item) === state.documentKind)
      && (state.industry === "all" || industry === state.industry)
      && (state.market === "all" || market === state.market);
  }));
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (state.sort === "impact-desc") return numericDesc(a.company.marketImpactScore, b.company.marketImpactScore) || fallbackSort(a, b);
    if (state.sort === "time-desc") return disclosureDateTime(b).localeCompare(disclosureDateTime(a));
    if (state.sort === "time-asc") return disclosureDateTime(a).localeCompare(disclosureDateTime(b));
    if (state.sort === "code-asc") return String(a.company.ticker).localeCompare(String(b.company.ticker));
    if (state.sort === "company-asc") return a.company.name.localeCompare(b.company.name, "ja");
    return fallbackSort(a, b);
  });
}

function numericDesc(a, b) {
  const left = Number(a);
  const right = Number(b);
  const leftOk = Number.isFinite(left);
  const rightOk = Number.isFinite(right);
  if (leftOk && rightOk) return right - left;
  if (leftOk) return -1;
  if (rightOk) return 1;
  return 0;
}

function fallbackSort(a, b) {
  return disclosureDateTime(b).localeCompare(disclosureDateTime(a))
    || String(a.company.ticker).localeCompare(String(b.company.ticker));
}

function disclosureDateTime(row) {
  return `${row.item.date ?? ""} ${row.item.time ?? ""}`;
}

function populateFilterOptions() {
  const rows = baseRows();
  fillSelect(elements.industry, "すべての業種", unique(rows.map(({ company }) => company.industry17 || company.industry || "未分類")), state.industry);
  fillSelect(elements.market, "すべての市場", unique(rows.map(({ company }) => company.market || "未分類")).sort(marketCompare), state.market);
}

function fillSelect(select, allLabel, values, selectedValue) {
  const current = values.includes(selectedValue) ? selectedValue : "all";
  select.innerHTML = `<option value="all">${allLabel}</option>${values.map((value) =>
    `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`
  ).join("")}`;
  select.value = current;
  if (select === elements.industry) state.industry = current;
  if (select === elements.market) state.market = current;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function marketCompare(a, b) {
  return marketRank(a) - marketRank(b) || a.localeCompare(b, "ja");
}

function marketRank(market) {
  const value = String(market ?? "");
  if (value.includes("プライム") || /Prime/i.test(value)) return 1;
  if (value.includes("スタンダード") || /Standard/i.test(value)) return 2;
  if (value.includes("グロース") || /Growth/i.test(value)) return 3;
  if (value.includes("PRO")) return 4;
  if (value.includes("未分類") || value === "-") return 99;
  return 10;
}

function render() {
  const rows = earningsRows();
  const companies = new Set(rows.map((row) => row.company.ticker));
  const industries = new Set(rows.map(({ company }) => company.industry17 || company.industry || "未分類"));
  const kinds = new Set(rows.map(({ item }) => item.documentKindLabel || documentKindLabel(normalizeDocumentKind(item))));

  elements.meta.textContent = `更新: ${formatDateTime(state.data?.generatedAt)} / 対象: ${state.data?.coverageThrough ?? "-"}`;
  elements.dateStatus.textContent = dateStatusText(rows, companies.size);
  elements.title.textContent = `${activeDateLabel()} / ${rows.length}件`;
  renderCalendar();
  elements.overview.innerHTML = `
    <div class="metric"><span>会社数</span><strong>${companies.size}</strong></div>
    <div class="metric"><span>決算件数</span><strong>${rows.length}</strong></div>
    <div class="metric"><span>業種数</span><strong>${industries.size}</strong></div>
    <div class="metric"><span>資料種別</span><strong>${kinds.size}</strong></div>
    <div class="metric"><span>全開示</span><strong>${escapeHtml(state.data?.meta?.totalDisclosures ?? "-")}</strong></div>
  `;

  elements.items.innerHTML = rows.length
    ? renderRows(rows)
    : emptyMessage();
  elements.items.innerHTML += renderEdinetSection();
  bindQuickDateButtons();
}

function renderCalendar() {
  const container = document.querySelector("#calendarGrid");
  if (!container || !state.coverage?.dates?.length) {
    if (container) container.innerHTML = "";
    return;
  }

  const latest = state.coverage.latest;
  const latestDate = parseLocalDate(latest);
  const startDate = new Date(latestDate);
  startDate.setDate(startDate.getDate() - 27);
  const days = [];
  const available = new Set(state.coverage.dates);
  const counts = state.coverage.counts ?? {};

  for (let offset = 0; offset < 28; offset += 1) {
    const cursor = new Date(startDate);
    cursor.setDate(startDate.getDate() + offset);
    const date = formatLocalDate(cursor);
    const day = cursor.getDate();
    const count = counts[date] ?? null;
    const hasArchive = available.has(date);
    const hasItems = Number(count) > 0;
    const selected = dateIsSelected(date);
    const intensity = countIntensity(count);
    const classes = [
      "calendar-day",
      hasArchive ? "has-archive" : "no-archive",
      hasItems ? "has-items" : "no-items",
      intensity,
      selected ? "selected" : ""
    ].join(" ");
    days.push(`<button type="button" class="${classes}" data-date="${date}" ${hasArchive ? "" : "disabled"} title="${date} ${count ?? "未取得"}件">${day}</button>`);
  }

  container.innerHTML = `
    <div class="calendar-head">
      <div>
        <div class="calendar-title">直近4週間</div>
        <div class="calendar-subtitle">${escapeHtml(calendarModeLabel())}</div>
      </div>
      <div class="calendar-legend">
        <span><i class="dot low"></i>少</span>
        <span><i class="dot mid"></i>中</span>
        <span><i class="dot high"></i>多</span>
        <span><i class="dot none"></i>なし</span>
      </div>
    </div>
    <div class="calendar-weekdays"><span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span></div>
    <div class="calendar-days">${days.join("")}</div>
  `;

  container.querySelectorAll(".calendar-day.has-archive").forEach((button) => {
    button.addEventListener("click", async () => {
      handleCalendarDate(button.dataset.date);
      await loadSelectedDate();
    });
  });
}

function handleCalendarDate(date) {
  if (state.dateMode !== "range") {
    state.dateMode = "single";
    state.selectedDate = date;
    syncDateControls();
    persistViewState();
    return;
  }

  if (!state.rangeStart || state.rangeEnd) {
    state.rangeStart = date;
    state.rangeEnd = "";
  } else {
    state.rangeEnd = date;
    [state.rangeStart, state.rangeEnd] = [state.rangeStart, state.rangeEnd].sort();
  }
  state.selectedDate = state.rangeEnd || state.rangeStart;
  syncDateControls();
  persistViewState();
}

function dateIsSelected(date) {
  if (state.dateMode === "all") return false;
  if (state.dateMode === "range") {
    const [from, to] = [state.rangeStart || "", state.rangeEnd || state.rangeStart || ""].sort();
    return Boolean(from) && date >= from && date <= to;
  }
  return date === state.selectedDate;
}

function calendarModeLabel() {
  if (state.dateMode === "range") return `期間指定: ${rangeLabel(state.rangeStart, state.rangeEnd || state.rangeStart)}`;
  if (state.dateMode === "all") return "全期間表示中";
  return `単日: ${state.selectedDate || "-"}`;
}

function countIntensity(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return "count-none";
  if (value >= 100) return "count-high";
  if (value >= 30) return "count-mid";
  return "count-low";
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyMessage() {
  if (state.loadedSource === "未生成") {
    const range = state.coverage?.earliest && state.coverage?.latest
      ? `現在の取得済み範囲は ${escapeHtml(state.coverage.earliest)} から ${escapeHtml(state.coverage.latest)} です。`
      : "";
    return `<div class="empty-state"><p>この日付のアーカイブはまだ生成されていません。${range}</p></div>`;
  }
  const previous = previousDateWithItems();
  const action = previous
    ? `<button class="quick-date-button" type="button" data-date="${escapeAttribute(previous)}">${escapeHtml(previous)} の発表を見る</button>`
    : "";
  return `
    <div class="empty-state">
      <p>${escapeHtml(activeDateLabel())} に表示できる決算関連開示はありません。</p>
      ${action}
    </div>
  `;
}

function previousDateWithItems() {
  const counts = state.coverage?.counts ?? {};
  const pivot = state.dateMode === "all" ? state.coverage?.latest : (state.selectedDate || state.rangeStart || state.coverage?.latest);
  return Object.entries(counts)
    .filter(([date, count]) => Number(count) > 0 && (!pivot || date < pivot))
    .map(([date]) => date)
    .sort()
    .at(-1) ?? "";
}

function bindQuickDateButtons() {
  elements.items.querySelectorAll(".quick-date-button").forEach((button) => {
    button.addEventListener("click", async () => {
      state.dateMode = "single";
      state.selectedDate = button.dataset.date;
      persistViewState();
      syncDateControls();
      await loadSelectedDate();
    });
  });
}

function renderRows(rows) {
  if (!state.groupByIndustry) return rows.map(renderEarningsCard).join("");

  const groups = new Map();
  for (const row of rows) {
    const industry = row.company.industry17 || row.company.industry || "未分類";
    if (!groups.has(industry)) groups.set(industry, []);
    groups.get(industry).push(row);
  }

  return [...groups.entries()].map(([industry, groupRows]) => `
    <section class="industry-group">
      <h3>${escapeHtml(industry)} <span>${groupRows.length}件</span></h3>
      ${groupRows.map(renderEarningsCard).join("")}
    </section>
  `).join("");
}

function dateStatusText(rows, companyCount) {
  return `${activeDateLabel()}: ${companyCount} 社 / ${rows.length} 件（${state.loadedSource || "-"}）`;
}

function renderEarningsCard({ company, item }) {
  const documents = documentLinks(item);
  const industry = company.industry17 || company.industry || "未分類";
  const industryClass = industryColorClass(industry);
  const topixClass = topixStrengthClass(company.topixSize);
  const impactClass = impactStrengthClass(company.marketImpactScore);
  const businessBrief = companyBusinessBrief(company);

  return `
    <article class="item earnings-card">
      <div class="item-header">
        <div>
          <p class="company-meta">${escapeHtml(companyMetaLine(company, item))}</p>
          <h3>${escapeHtml(company.name)}</h3>
        </div>
        <span class="tag ${escapeAttribute(item.importance)}">${escapeHtml(labels[item.importance] ?? item.importance ?? "-")}</span>
      </div>
      <div class="tags">
        <span class="tag industry-tag ${industryClass}">${escapeHtml(industry)}</span>
        <span class="tag kind-tag">${escapeHtml(item.documentKindLabel || documentKindLabel(normalizeDocumentKind(item)))}</span>
        <span class="tag topix-tag ${topixClass}">TOPIX ${escapeHtml(company.topixSize ?? "-")}</span>
        <span class="tag impact-tag ${impactClass}">インパクト ${escapeHtml(company.marketImpactScore ?? "-")}</span>
      </div>
      <div class="business-brief">
        <span>事業ブリーフ</span>
        <p>${escapeHtml(businessBrief)}</p>
      </div>
      <h4>${escapeHtml(item.title ?? "決算発表")}</h4>
      <p class="filing-summary">${escapeHtml(item.summary ?? company.brief ?? "")}</p>
      ${company.impactRankReason ? `<p class="source">順位根拠: ${escapeHtml(company.impactRankReason)}</p>` : ""}
      <div class="document-links">${documents}</div>
    </article>
  `;
}

function companyBusinessBrief(company) {
  const explicit = company.businessBrief || company.businessSummary || company.businessDescription;
  if (explicit) return explicit;

  const industry = company.industry17 || company.industry || "未分類";
  return industryBriefTemplates[industry] || `${industry}領域で事業を展開。主な収益源や具体的な事業内容は、EDINET要約を取得後に補完します。`;
}

const industryBriefTemplates = {
  "食品": "食品・飲料、加工食品、外食向け商材など生活必需品に近い領域を展開。原材料価格、価格改定、販売数量が業績の見どころになりやすい。",
  "エネルギー資源": "資源開発、燃料販売、発電燃料、エネルギー関連サービスなどを展開。資源価格や為替、需給環境の影響を受けやすい。",
  "建設・資材": "建設、土木、住宅、建材、設備工事などインフラ・不動産投資に関わる事業を展開。受注残、資材価格、人件費が重要になりやすい。",
  "素材・化学": "化学品、樹脂、繊維、紙・パルプなど産業向け素材を供給。市況、原燃料価格、稼働率、製品ミックスが収益を左右しやすい。",
  "医薬品": "医薬品、医療関連製品、研究開発、ライセンス収入などを中心に展開。新薬開発、薬価、特許、海外販売が焦点になりやすい。",
  "自動車・輸送機": "完成車、部品、二輪、輸送機器などモビリティ関連製品を手がける。生産台数、為替、部品供給、電動化投資が見どころになりやすい。",
  "鉄鋼・非鉄": "鉄鋼、非鉄金属、金属加工品など産業素材を供給。金属市況、エネルギーコスト、需要産業の稼働状況が業績に効きやすい。",
  "機械": "産業機械、工作機械、設備機器、FA関連など企業の設備投資を支える製品を展開。受注動向と中国・北米など地域別需要が焦点。",
  "電機・精密": "電子機器、精密機器、半導体関連、計測機器など技術系製品を展開。半導体サイクル、部材需給、研究開発投資が注目点。",
  "情報通信・サービスその他": "IT、通信、メディア、人材、広告、各種サービスなどを展開。利用者数、契約単価、広告需要、システム投資が見どころになりやすい。",
  "電力・ガス": "電力、ガス、エネルギー供給など公共性の高いインフラ事業を展開。燃料費調整、電力需要、設備投資、規制動向が重要。",
  "運輸・物流": "鉄道、陸運、海運、空運、倉庫など人流・物流を支える事業を展開。輸送量、運賃、燃料費、人件費が業績を左右しやすい。",
  "商社・卸売": "商品流通、卸売、トレーディング、事業投資などを通じて幅広い産業をつなぐ。市況、投資先利益、在庫評価が見どころ。",
  "小売": "店舗やECを通じて消費者向けの商品・サービスを販売。既存店売上、客数、客単価、在庫、値引き率が業績確認の軸になりやすい。",
  "銀行": "預金、貸出、決済、金融仲介などを中心に展開。金利環境、貸出残高、利ざや、与信費用が決算を見るうえで重要。",
  "金融（除く銀行）": "証券、保険、リース、カード、投資など銀行以外の金融サービスを展開。市場環境、運用収益、手数料、信用コストが焦点。",
  "不動産": "不動産の開発、賃貸、管理、売買仲介などを展開。物件売却、賃料、空室率、金利、開発パイプラインが見どころになりやすい。"
};

const industry17Order = [
  "食品",
  "エネルギー資源",
  "建設・資材",
  "素材・化学",
  "医薬品",
  "自動車・輸送機",
  "鉄鋼・非鉄",
  "機械",
  "電機・精密",
  "情報通信・サービスその他",
  "電力・ガス",
  "運輸・物流",
  "商社・卸売",
  "小売",
  "銀行",
  "金融（除く銀行）",
  "不動産"
];

function industryColorClass(industry) {
  const index = industry17Order.indexOf(industry);
  return `industry-${index >= 0 ? index + 1 : 0}`;
}

function topixStrengthClass(topixSize) {
  const normalized = String(topixSize ?? "").trim();
  const rank = {
    Core30: 5,
    Large70: 4,
    Mid400: 3,
    Small1: 2,
    Small2: 1
  }[normalized] ?? 0;
  return `topix-${rank}`;
}

function impactStrengthClass(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value <= 0) return "impact-0";
  if (value >= 900) return "impact-5";
  if (value >= 700) return "impact-4";
  if (value >= 500) return "impact-3";
  if (value >= 400) return "impact-2";
  return "impact-1";
}

function activeDateLabel() {
  if (state.dateMode === "all") return "全期間";
  if (state.dateMode === "range") return rangeLabel(state.rangeStart, state.rangeEnd || state.rangeStart);
  return state.selectedDate || "全期間";
}

function rangeLabel(start, end) {
  if (!start && !end) return "全期間";
  if (!end || start === end) return start || end || "全期間";
  const [from, to] = [start, end].sort();
  return `${from}〜${to}`;
}

function companyMetaLine(company, item) {
  const parts = [];
  if (state.dateMode !== "single" && item.date) parts.push(item.date);
  if (item.time) parts.push(item.time);
  parts.push(company.ticker);
  if (company.market) parts.push(company.market);
  return parts.filter(Boolean).join(" / ");
}

function renderEdinetSection() {
  const filings = state.edinetData?.filings ?? [];
  if (!filings.length) return "";

  return `
    <section class="edinet-section">
      <div class="section-heading">
        <p class="eyebrow">EDINET</p>
        <h3>EDINET提出書類 <span>${filings.length}件</span></h3>
      </div>
      <div class="edinet-list">
        ${filings.map(renderEdinetFiling).join("")}
      </div>
    </section>
  `;
}

function renderEdinetFiling(filing) {
  return `
    <article class="edinet-item">
      <div>
        <p class="company-meta">${escapeHtml(filing.submitDateTime)} / ${escapeHtml(filing.ticker)} / ${escapeHtml(filing.edinetCode)}</p>
        <h4>${escapeHtml(filing.filerName)}</h4>
        <p>${escapeHtml(filing.docDescription || filing.docTypeCode || "提出書類")}</p>
      </div>
      <div class="tags">
        ${filing.periodEnd ? `<span class="tag">対象期末 ${escapeHtml(filing.periodEnd)}</span>` : ""}
        ${filing.pdfFlag === "1" ? `<span class="tag medium">PDF</span>` : ""}
      </div>
    </article>
  `;
}

function documentLinks(item) {
  const docs = Array.isArray(item.documents) ? [...item.documents] : [];
  if (item.sourceUrl && !docs.some((doc) => doc.url === item.sourceUrl)) {
    docs.unshift({ label: item.sourceName || "原文", url: item.sourceUrl });
  }

  if (docs.length === 0) return `<span class="empty">閲覧リンクがありません。</span>`;

  return docs.map((doc) => `
    <a class="doc-link" href="${escapeAttribute(doc.url)}" target="_blank" rel="noreferrer">
      ${escapeHtml(doc.label ?? "資料")}
    </a>
  `).join("");
}

function normalizeDocumentKind(item) {
  if (item.documentKind) return item.documentKind;
  const title = item.title ?? "";
  if (/決算短信|Financial Results/i.test(title)) return "summary";
  if (/決算説明/.test(title)) return "presentation";
  if (/補足|Supplementary/i.test(title)) return "supplement";
  if (/決算資料/.test(title)) return "materials";
  return "other";
}

function documentKindLabel(kind) {
  return {
    summary: "決算短信",
    presentation: "決算説明資料",
    supplement: "補足資料",
    materials: "決算資料",
    other: "その他決算資料"
  }[kind] ?? "その他決算資料";
}

function newestItemDate(data) {
  return (data?.companies ?? [])
    .flatMap((company) => company.items ?? [])
    .map((item) => item.date)
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function restoreViewState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    for (const key of ["dateMode", "selectedDate", "rangeStart", "rangeEnd", "importance", "documentKind", "industry", "market", "sort"]) {
      if (typeof saved[key] === "string") state[key] = saved[key];
    }
    if (typeof saved.groupByIndustry === "boolean") state.groupByIndustry = saved.groupByIndustry;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistViewState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    dateMode: state.dateMode,
    selectedDate: state.selectedDate,
    rangeStart: state.rangeStart,
    rangeEnd: state.rangeEnd,
    importance: state.importance,
    documentKind: state.documentKind,
    industry: state.industry,
    market: state.market,
    sort: state.sort,
    groupByIndustry: state.groupByIndustry
  }));
}

function syncDateControls() {
  elements.date.value = state.dateMode === "single" ? state.selectedDate : "";
  elements.rangeToggle.checked = state.dateMode === "range";
  elements.rangeControls.hidden = state.dateMode !== "range";
  elements.rangeStart.value = state.rangeStart;
  elements.rangeEnd.value = state.rangeEnd;
  elements.sort.value = state.sort;
  elements.importance.value = state.importance;
  elements.documentKind.value = state.documentKind;
  elements.groupIndustry.checked = state.groupByIndustry;
}

function initializeResponsiveFilters() {
  const compact = window.matchMedia("(max-width: 860px)").matches;
  elements.controlPanel.classList.toggle("collapsed", compact);
  updateFilterToggleLabel();
}

function updateFilterToggleLabel() {
  const collapsed = elements.controlPanel.classList.contains("collapsed");
  elements.filterToggle.textContent = collapsed ? "詳細条件を開く" : "詳細条件を閉じる";
}

elements.date.addEventListener("change", async (event) => {
  state.dateMode = "single";
  state.selectedDate = event.target.value;
  persistViewState();
  syncDateControls();
  await loadSelectedDate();
});

elements.today.addEventListener("click", async () => {
  state.dateMode = "single";
  state.selectedDate = state.latestData?.coverageThrough ?? newestItemDate(state.latestData);
  persistViewState();
  syncDateControls();
  await loadSelectedDate();
});

elements.clearDate.addEventListener("click", async () => {
  state.dateMode = "all";
  state.selectedDate = "";
  persistViewState();
  syncDateControls();
  await loadSelectedDate();
});

elements.rangeToggle.addEventListener("change", async (event) => {
  state.dateMode = event.target.checked ? "range" : "single";
  if (state.dateMode === "range") {
    state.rangeStart ||= state.selectedDate || state.coverage?.latest || "";
    state.rangeEnd ||= state.rangeStart;
    state.selectedDate = state.rangeEnd || state.rangeStart;
  } else {
    state.selectedDate ||= state.rangeEnd || state.rangeStart || state.coverage?.latest || "";
  }
  persistViewState();
  syncDateControls();
  await loadSelectedDate();
});

elements.rangeStart.addEventListener("change", async (event) => {
  state.dateMode = "range";
  state.rangeStart = event.target.value;
  if (state.rangeEnd && state.rangeStart > state.rangeEnd) state.rangeEnd = state.rangeStart;
  state.selectedDate = state.rangeEnd || state.rangeStart;
  persistViewState();
  syncDateControls();
  await loadSelectedDate();
});

elements.rangeEnd.addEventListener("change", async (event) => {
  state.dateMode = "range";
  state.rangeEnd = event.target.value;
  if (state.rangeStart && state.rangeEnd < state.rangeStart) state.rangeStart = state.rangeEnd;
  state.selectedDate = state.rangeEnd || state.rangeStart;
  persistViewState();
  syncDateControls();
  await loadSelectedDate();
});

elements.importance.addEventListener("change", (event) => {
  state.importance = event.target.value;
  persistViewState();
  render();
});

elements.documentKind.addEventListener("change", (event) => {
  state.documentKind = event.target.value;
  persistViewState();
  render();
});

elements.industry.addEventListener("change", (event) => {
  state.industry = event.target.value;
  persistViewState();
  render();
});

elements.market.addEventListener("change", (event) => {
  state.market = event.target.value;
  persistViewState();
  render();
});

elements.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  persistViewState();
  render();
});

elements.groupIndustry.addEventListener("change", (event) => {
  state.groupByIndustry = event.target.checked;
  persistViewState();
  render();
});

elements.filterToggle.addEventListener("click", () => {
  elements.controlPanel.classList.toggle("collapsed");
  updateFilterToggleLabel();
});

elements.refresh.addEventListener("click", loadData);

initializeResponsiveFilters();
loadData().catch((error) => {
  elements.meta.textContent = "データを読み込めませんでした。";
  elements.items.innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
});
