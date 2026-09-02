export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => value.trim().toLowerCase());
  const at = (...names) => names.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1;
  return rows.slice(1).map((values, index) => {
    const date = values[at("date")]?.trim();
    const time = values[at("time")]?.trim() || "";
    const description = values[at("journey", "description")]?.trim() || "";
    const notes = values[at("notes", "note")]?.trim() || "";
    const charge = Math.abs(Number(values[at("charge (gbp)", "charge", "fare")] || 0));
    const [from = description, to = ""] = description.split(/\s+to\s+/i);
    const [start, end] = time.split(/\s+-\s+/);
    const incomplete = /unknown|incomplete|no record|missing journey/i.test(`${description} ${notes}`) || end === "--:--";
    return { id: `journey-${index}`, date, time, start, end, from, to, description, notes, charge, incomplete, mode: inferMode(description) };
  }).filter(journey => journey.date && journey.description);
}

export function inferMode(description) {
  if (/bus journey/i.test(description)) return "bus";
  if (/DLR/i.test(description)) return "dlr";
  if (/overground/i.test(description)) return "overground";
  if (/elizabeth/i.test(description)) return "elizabeth";
  if (/underground|\bBank\b|Oxford Circus|Victoria|Brixton/i.test(description)) return "tube";
  if (/national rail/i.test(description)) return "rail";
  return "tube";
}

const minutes = value => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export function duration(journey) {
  const start = minutes(journey.start), end = minutes(journey.end);
  if (start == null || end == null) return null;
  return end >= start ? end - start : end + 1440 - start;
}

export function detectClaims(journeys, now = new Date()) {
  const groups = new Map();
  for (const journey of journeys) {
    if (journey.incomplete || journey.mode === "bus") continue;
    const key = `${journey.from}|${journey.to}`.toLowerCase();
    const value = duration(journey);
    if (value != null) groups.set(key, [...(groups.get(key) || []), value]);
  }
  const claims = [];
  for (const journey of journeys) {
    const journeyDate = parseDate(journey.date, now);
    if (!journeyDate) continue;
    if (journey.incomplete) {
      const expectedFare = 3.1;
      claims.push(makeClaim(journey, "max-fare", Math.max(0, journey.charge - expectedFare), journeyDate, 56, now, { expectedFare }));
      continue;
    }
    if (!["tube", "dlr", "overground", "elizabeth"].includes(journey.mode)) continue;
    const values = groups.get(`${journey.from}|${journey.to}`.toLowerCase()) || [];
    if (values.length < 3) continue;
    const sorted = [...values].sort((a, b) => a - b);
    const baseline = sorted[Math.floor((sorted.length - 1) / 2)];
    const actual = duration(journey);
    const threshold = ["overground", "elizabeth"].includes(journey.mode) ? 30 : 15;
    if (actual - baseline >= threshold) claims.push(makeClaim(journey, "delay", journey.charge, journeyDate, 28, now, { actual, baseline, delta: actual - baseline, threshold }));
  }
  return claims.sort((a, b) => a.daysLeft - b.daysLeft);
}

function parseDate(value, now) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value || "");
  if (!match) return null;
  const year = value.includes("DEMO_YEAR") ? now.getFullYear() : Number(match[3]);
  return new Date(year, Number(match[2]) - 1, Number(match[1]), 12);
}

function makeClaim(journey, type, amount, date, windowDays, now, details) {
  const deadline = new Date(date); deadline.setDate(deadline.getDate() + windowDays);
  const daysLeft = Math.ceil((deadline - now) / 86400000);
  return { id: `${journey.id}-${type}`, journey, type, amount, deadline, daysLeft, status: daysLeft < 0 ? "expired" : type === "max-fare" && now - date < 172800000 ? "hold" : "ready", ...details };
}

export function demoJourneys(now = new Date()) {
  const date = offset => { const value = new Date(now); value.setDate(value.getDate() - offset); return value.toLocaleDateString("en-GB"); };
  const rows = [
    [date(22), "08:17 - 08:28", "Brixton to Victoria", -3.10, ""],
    [date(18), "08:12 - 08:23", "Brixton to Victoria", -3.10, ""],
    [date(12), "08:20 - 08:31", "Brixton to Victoria", -3.10, ""],
    [date(4), "08:14 - 08:48", "Brixton to Victoria", -3.10, ""],
    [date(9), "18:04 - 18:16", "Oxford Circus to Bank", -3.10, ""],
    [date(7), "18:01 - 18:13", "Oxford Circus to Bank", -3.10, ""],
    [date(5), "18:09 - 18:21", "Oxford Circus to Bank", -3.10, ""],
    [date(3), "18:02 - 18:31", "Oxford Circus to Bank", -3.10, ""],
    [date(3), "08:15 - --:--", "Bank to Unknown", -5.90, "We have no record of where you touched in or out."],
  ];
  return rows.map((row, index) => ({ id: `demo-${index}`, date: row[0], time: row[1], start: row[1].split(" - ")[0], end: row[1].split(" - ")[1], description: row[2], from: row[2].split(" to ")[0], to: row[2].split(" to ")[1], charge: Math.abs(row[3]), notes: row[4], incomplete: /Unknown/.test(row[2]), mode: inferMode(row[2]) }));
}
