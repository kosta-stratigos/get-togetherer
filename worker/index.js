const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function error(status, message) {
  return json(status, { error: message });
}

function makeId(size = 9) {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return [...bytes].map(byte => alphabet[byte & 63]).join("");
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeDays(days) {
  if (!Array.isArray(days)) {
    return [];
  }

  return [...new Set(days.map(Number))]
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
}

function buildDates(startDate, endDate, daysOfWeek) {
  const dates = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    if (daysOfWeek.includes(current.getUTCDay())) {
      dates.push(toDateString(current));
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

function nameKey(value) {
  return normalizeName(value).toLocaleLowerCase();
}

function parseJsonList(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function mapPoll(row, responses = []) {
  return {
    id: row.id,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    daysOfWeek: parseJsonList(row.days_of_week),
    dates: parseJsonList(row.dates),
    responses,
    createdAt: row.created_at
  };
}

function mapResponse(row) {
  return {
    id: row.id,
    name: row.name,
    selectedDates: parseJsonList(row.selected_dates),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function readJson(request) {
  if (!request.body) {
    return {};
  }

  try {
    return await request.json();
  } catch (err) {
    throw new Error("Request body must be valid JSON.");
  }
}

async function loadPoll(env, id) {
  const pollRow = await env.DB
    .prepare("SELECT * FROM polls WHERE id = ?")
    .bind(id)
    .first();

  if (!pollRow) {
    return null;
  }

  const { results } = await env.DB
    .prepare("SELECT * FROM responses WHERE poll_id = ? ORDER BY COALESCE(created_at, updated_at)")
    .bind(id)
    .all();

  return mapPoll(pollRow, results.map(mapResponse));
}

async function createPoll(request, env) {
  const body = await readJson(request);
  const title = String(body.title || "").trim();
  const startDate = parseDate(body.startDate);
  const endDate = parseDate(body.endDate);
  const daysOfWeek = normalizeDays(body.daysOfWeek);

  if (!title) {
    return error(400, "Add a poll name.");
  }

  if (!startDate || !endDate || startDate > endDate) {
    return error(400, "Choose a valid date range.");
  }

  const daySpan = Math.round((endDate - startDate) / 86_400_000) + 1;
  if (daySpan > 370) {
    return error(400, "Date ranges can include up to 370 days.");
  }

  if (!daysOfWeek.length) {
    return error(400, "Choose at least one day of the week.");
  }

  const dates = buildDates(startDate, endDate, daysOfWeek);
  if (!dates.length) {
    return error(400, "No dates match that range and weekday selection.");
  }

  const now = new Date().toISOString();
  let id = makeId(7);

  for (let attempts = 0; attempts < 5; attempts += 1) {
    const existing = await env.DB.prepare("SELECT id FROM polls WHERE id = ?").bind(id).first();
    if (!existing) {
      break;
    }

    id = makeId(7);
  }

  await env.DB
    .prepare(`
      INSERT INTO polls (id, title, start_date, end_date, days_of_week, dates, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id,
      title,
      toDateString(startDate),
      toDateString(endDate),
      JSON.stringify(daysOfWeek),
      JSON.stringify(dates),
      now
    )
    .run();

  const poll = await loadPoll(env, id);
  return json(201, { poll });
}

async function getPoll(_request, env, id) {
  const poll = await loadPoll(env, id);

  if (!poll) {
    return error(404, "Poll not found.");
  }

  return json(200, { poll });
}

async function saveResponse(request, env, id) {
  const body = await readJson(request);
  const poll = await loadPoll(env, id);

  if (!poll) {
    return error(404, "Poll not found.");
  }

  const allowedDates = new Set(poll.dates);
  const selectedDates = Array.isArray(body.selectedDates)
    ? [...new Set(body.selectedDates)].filter(date => allowedDates.has(date)).sort()
    : [];
  const name = normalizeName(body.name);

  if (!name) {
    return error(400, "Add your name before saving.");
  }

  const requestedId = typeof body.responseId === "string" ? body.responseId : "";
  const normalizedName = nameKey(name);
  const existing = poll.responses.find(response => {
    return response.id === requestedId || nameKey(response.name) === normalizedName;
  });
  const responseId = existing?.id || makeId(10);
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt || now;

  await env.DB
    .prepare(`
      INSERT INTO responses (id, poll_id, name, name_key, selected_dates, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        name_key = excluded.name_key,
        selected_dates = excluded.selected_dates,
        updated_at = excluded.updated_at
    `)
    .bind(responseId, id, name, normalizedName, JSON.stringify(selectedDates), createdAt, now)
    .run();

  const updatedPoll = await loadPoll(env, id);
  const response = updatedPoll.responses.find(item => item.id === responseId);

  return json(200, { response, poll: updatedPoll });
}

async function deleteResponse(_request, env, id, responseId) {
  const poll = await loadPoll(env, id);

  if (!poll) {
    return error(404, "Poll not found.");
  }

  const existing = poll.responses.find(response => response.id === responseId);
  if (!existing) {
    return error(404, "Response not found.");
  }

  await env.DB
    .prepare("DELETE FROM responses WHERE poll_id = ? AND id = ?")
    .bind(id, responseId)
    .run();

  return json(200, { poll: await loadPoll(env, id) });
}

async function route(request, env) {
  const url = new URL(request.url);
  const getPollMatch = url.pathname.match(/^\/api\/polls\/([^/]+)$/);
  const responsesMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/responses$/);
  const responseMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/responses\/([^/]+)$/);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json(200, { status: "ok" });
  }

  if (request.method === "POST" && url.pathname === "/api/polls") {
    return createPoll(request, env);
  }

  if (request.method === "GET" && getPollMatch) {
    return getPoll(request, env, getPollMatch[1]);
  }

  if (request.method === "POST" && responsesMatch) {
    return saveResponse(request, env, responsesMatch[1]);
  }

  if (request.method === "DELETE" && responseMatch) {
    return deleteResponse(request, env, responseMatch[1], responseMatch[2]);
  }

  return error(404, "API route not found.");
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (err) {
      return error(500, err.message || "Something went wrong.");
    }
  }
};
