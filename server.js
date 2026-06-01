const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "polls.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ polls: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (error) {
    return { polls: {} };
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function makeId(size = 9) {
  return crypto.randomBytes(size).toString("base64url");
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

function pollResponses(poll) {
  return Object.values(poll.responses || {}).sort((a, b) => {
    return String(a.createdAt || a.updatedAt).localeCompare(String(b.createdAt || b.updatedAt));
  });
}

function publicPoll(poll) {
  return {
    id: poll.id,
    title: poll.title,
    startDate: poll.startDate,
    endDate: poll.endDate,
    daysOfWeek: poll.daysOfWeek,
    dates: poll.dates,
    responses: pollResponses(poll),
    createdAt: poll.createdAt
  };
}

async function createPoll(req, res) {
  const body = await readBody(req);
  const title = String(body.title || "").trim();
  const startDate = parseDate(body.startDate);
  const endDate = parseDate(body.endDate);
  const daysOfWeek = normalizeDays(body.daysOfWeek);

  if (!title) {
    sendError(res, 400, "Add a poll name.");
    return;
  }

  if (!startDate || !endDate || startDate > endDate) {
    sendError(res, 400, "Choose a valid date range.");
    return;
  }

  const daySpan = Math.round((endDate - startDate) / 86_400_000) + 1;
  if (daySpan > 370) {
    sendError(res, 400, "Date ranges can include up to 370 days.");
    return;
  }

  if (!daysOfWeek.length) {
    sendError(res, 400, "Choose at least one day of the week.");
    return;
  }

  const dates = buildDates(startDate, endDate, daysOfWeek);
  if (!dates.length) {
    sendError(res, 400, "No dates match that range and weekday selection.");
    return;
  }

  const store = readStore();
  let id = makeId(7);
  while (store.polls[id]) {
    id = makeId(7);
  }

  const poll = {
    id,
    title,
    startDate: toDateString(startDate),
    endDate: toDateString(endDate),
    daysOfWeek,
    dates,
    responses: {},
    createdAt: new Date().toISOString()
  };

  store.polls[id] = poll;
  writeStore(store);

  sendJson(res, 201, { poll: publicPoll(poll) });
}

function getPoll(_req, res, id) {
  const store = readStore();
  const poll = store.polls[id];

  if (!poll) {
    sendError(res, 404, "Poll not found.");
    return;
  }

  sendJson(res, 200, { poll: publicPoll(poll) });
}

async function saveResponse(req, res, id) {
  const body = await readBody(req);
  const store = readStore();
  const poll = store.polls[id];

  if (!poll) {
    sendError(res, 404, "Poll not found.");
    return;
  }

  const allowedDates = new Set(poll.dates);
  const selectedDates = Array.isArray(body.selectedDates)
    ? [...new Set(body.selectedDates)].filter(date => allowedDates.has(date)).sort()
    : [];
  const name = normalizeName(body.name);

  if (!name) {
    sendError(res, 400, "Add your name before saving.");
    return;
  }

  const responses = poll.responses || {};
  const requestedId = typeof body.responseId === "string" ? body.responseId : "";
  const existing = responses[requestedId] || Object.values(responses).find(response => {
    return nameKey(response.name) === nameKey(name);
  });
  const responseId = existing?.id || makeId(10);
  const now = new Date().toISOString();

  poll.responses = {
    ...responses,
    [responseId]: {
      id: responseId,
      name,
      selectedDates,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
  };

  writeStore(store);
  sendJson(res, 200, {
    response: poll.responses[responseId],
    poll: publicPoll(poll)
  });
}

async function deleteResponse(_req, res, id, responseId) {
  const store = readStore();
  const poll = store.polls[id];

  if (!poll) {
    sendError(res, 404, "Poll not found.");
    return;
  }

  if (!poll.responses?.[responseId]) {
    sendError(res, 404, "Response not found.");
    return;
  }

  delete poll.responses[responseId];
  writeStore(store);
  sendJson(res, 200, { poll: publicPoll(poll) });
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden.");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          sendError(res, 404, "Not found.");
          return;
        }

        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(fallbackData);
      });
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function router(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const getPollMatch = url.pathname.match(/^\/api\/polls\/([^/]+)$/);
    const responsesMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/responses$/);
    const responseMatch = url.pathname.match(/^\/api\/polls\/([^/]+)\/responses\/([^/]+)$/);

    if (req.method === "POST" && url.pathname === "/api/polls") {
      await createPoll(req, res);
      return;
    }

    if (req.method === "GET" && getPollMatch) {
      getPoll(req, res, getPollMatch[1]);
      return;
    }

    if (req.method === "POST" && responsesMatch) {
      await saveResponse(req, res, responsesMatch[1]);
      return;
    }

    if (req.method === "DELETE" && responseMatch) {
      await deleteResponse(req, res, responseMatch[1], responseMatch[2]);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendError(res, 404, "API route not found.");
      return;
    }

    serveFile(req, res);
  } catch (error) {
    sendError(res, 500, error.message || "Something went wrong.");
  }
}

ensureStore();

http.createServer(router).listen(PORT, () => {
  console.log(`Get Togetherer is running at http://localhost:${PORT}`);
});
