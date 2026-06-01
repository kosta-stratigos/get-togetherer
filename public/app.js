const app = document.querySelector("#app");
const weekdayNames = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" }
];

function cloneTemplate(id) {
  return document.querySelector(id).content.cloneNode(true);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function localDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...options
  }).format(localDate(value));
}

function formatWeekday(value, weekday = "short") {
  return new Intl.DateTimeFormat("en", { weekday }).format(localDate(value));
}

function formatRange(poll) {
  const days = poll.daysOfWeek
    .map(day => weekdayNames.find(item => item.value === day)?.short)
    .filter(Boolean)
    .join(", ");

  return `${formatDate(poll.startDate)} to ${formatDate(poll.endDate)} | ${days}`;
}

function getPollIdFromPath() {
  const match = window.location.pathname.match(/^\/poll\/([^/]+)$/);
  return match ? match[1] : null;
}

function navigate(path) {
  history.pushState({}, "", path);
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }

  return payload;
}

function setTodayDefaults(root) {
  const today = new Date();
  const end = new Date();
  end.setDate(today.getDate() + 21);

  root.querySelector("#start-date").valueAsDate = today;
  root.querySelector("#end-date").valueAsDate = end;
}

function renderWeekdays(root) {
  const grid = root.querySelector("#weekday-grid");
  grid.innerHTML = weekdayNames.map(day => `
    <label class="weekday-option" title="${day.long}">
      <input type="checkbox" name="daysOfWeek" value="${day.value}" checked>
      <span>${day.short}</span>
    </label>
  `).join("");
}

function renderCreate() {
  const view = cloneTemplate("#create-template");
  renderWeekdays(view);
  setTodayDefaults(view);

  const form = view.querySelector("#create-form");
  const error = view.querySelector("#create-error");

  form.addEventListener("submit", async event => {
    event.preventDefault();
    error.textContent = "";
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    submit.textContent = "Creating...";

    const data = new FormData(form);
    const daysOfWeek = data.getAll("daysOfWeek").map(Number);

    try {
      const payload = await api("/api/polls", {
        method: "POST",
        body: JSON.stringify({
          title: data.get("title"),
          startDate: data.get("startDate"),
          endDate: data.get("endDate"),
          daysOfWeek
        })
      });

      navigate(`/poll/${payload.poll.id}`);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Create poll";
    }
  });

  app.replaceChildren(view);
}

function responseCounts(poll) {
  const counts = Object.fromEntries(poll.dates.map(date => [date, 0]));

  Object.values(poll.responses || {}).forEach(response => {
    response.selectedDates.forEach(date => {
      if (date in counts) {
        counts[date] += 1;
      }
    });
  });

  return counts;
}

function getBestDates(poll, counts) {
  const max = Math.max(0, ...Object.values(counts));
  if (!max) {
    return new Set();
  }

  return new Set(poll.dates.filter(date => counts[date] === max));
}

function participantName(person) {
  return person.name;
}

function responseStorageKey(pollId) {
  return `get-togetherer-response:${pollId}`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  } catch (error) {
    window.prompt("Copy this link", text);
  }
}

function renderResponseForm(root, poll) {
  const savedResponseId = localStorage.getItem(responseStorageKey(poll.id));
  const existing = poll.responses.find(response => response.id === savedResponseId);
  const selected = new Set(existing?.selectedDates || []);

  root.querySelector("#response-title").textContent = existing
    ? `Update your dates, ${participantName(existing)}`
    : "Add your dates";
  root.querySelector("#person-name").value = existing?.name || "";
  root.querySelector("#response-date-grid").innerHTML = poll.dates.map(date => `
    <label class="date-option">
      <input type="checkbox" name="selectedDates" value="${date}" ${selected.has(date) ? "checked" : ""}>
        <span>
        <span class="date-day">${formatWeekday(date)}</span>
        <span class="date-label">${formatDate(date)}</span>
      </span>
    </label>
  `).join("");

  const form = root.querySelector("#response-form");
  const saveState = root.querySelector("#save-state");

  form.addEventListener("submit", async event => {
    event.preventDefault();
    saveState.textContent = "Saving...";
    const data = new FormData(form);
    const name = String(data.get("personName") || "").trim();

    if (!name) {
      saveState.textContent = "Add your name before saving.";
      return;
    }

    try {
      const payload = await api(`/api/polls/${poll.id}/responses`, {
        method: "POST",
        body: JSON.stringify({
          responseId: savedResponseId,
          name,
          selectedDates: data.getAll("selectedDates")
        })
      });

      localStorage.setItem(responseStorageKey(poll.id), payload.response.id);
      saveState.textContent = "Saved";
      setTimeout(() => renderPoll(payload.poll), 250);
    } catch (error) {
      saveState.textContent = error.message;
    }
  });
}

function renderResultSummary(root, poll) {
  const responseTotal = poll.responses.length;
  root.querySelector("#response-count").textContent = responseTotal
    ? `${responseTotal} ${responseTotal === 1 ? "response" : "responses"}`
    : "No responses yet";
}

function renderResultsTable(root, poll, counts, bestDates) {
  const table = root.querySelector("#results-table");
  const originalOrder = new Map(poll.dates.map((date, index) => [date, index]));
  const rankedDates = [...poll.dates].sort((a, b) => {
    return counts[b] - counts[a] || originalOrder.get(a) - originalOrder.get(b);
  });

  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Yes</th>
        ${poll.responses.map(response => `<th>${escapeHTML(participantName(response))}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${rankedDates.map(date => `
        <tr class="${bestDates.has(date) ? "best-row" : ""}">
          <th scope="row">${formatWeekday(date)}, ${formatDate(date)}</th>
          <td>${counts[date]}</td>
          ${poll.responses.map(response => {
            const yes = response.selectedDates?.includes(date);
            return `<td><span class="person-chip ${yes ? "yes" : "no"}">${yes ? "Yes" : "No"}</span></td>`;
          }).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;
}

function renderPoll(poll) {
  const view = cloneTemplate("#poll-template");
  const counts = responseCounts(poll);
  const bestDates = getBestDates(poll, counts);

  view.querySelector("#poll-title").textContent = poll.title;
  view.querySelector("#poll-range").textContent = formatRange(poll);
  view.querySelector("#copy-poll-link").addEventListener("click", event => {
    copyText(`${window.location.origin}/poll/${poll.id}`, event.currentTarget);
  });

  renderResponseForm(view, poll);
  renderResultSummary(view, poll);
  renderResultsTable(view, poll, counts, bestDates);

  app.replaceChildren(view);
}

function renderEmpty() {
  app.replaceChildren(cloneTemplate("#empty-template"));
}

async function render() {
  const pollId = getPollIdFromPath();

  if (!pollId) {
    renderCreate();
    return;
  }

  app.innerHTML = `<div class="loading">Loading poll...</div>`;

  try {
    const payload = await api(`/api/polls/${pollId}`);
    renderPoll(payload.poll);
  } catch (error) {
    renderEmpty();
  }
}

document.addEventListener("click", event => {
  const link = event.target.closest("a[data-link]");
  if (!link) {
    return;
  }

  const url = new URL(link.href);
  if (url.origin !== window.location.origin) {
    return;
  }

  event.preventDefault();
  navigate(`${url.pathname}${url.search}`);
});

window.addEventListener("popstate", render);
render();
