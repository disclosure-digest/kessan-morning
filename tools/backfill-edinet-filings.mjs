import { spawn } from "node:child_process";

const firstArg = process.argv[2] ?? "45";
const secondArg = process.argv[3] ?? yesterdayJst();

const dates = /^\d{4}-\d{2}-\d{2}$/.test(firstArg)
  ? dateRangeInclusive(firstArg, secondArg)
  : trailingDates(secondArg, Number(firstArg));

for (const date of dates) {
  await runNode(["tools/fetch-edinet-filings.mjs", date]);
  await sleep(3500);
}

function runNode(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
      env: process.env
    });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`node ${args.join(" ")} exited with ${code}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
