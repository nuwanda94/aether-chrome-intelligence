import { FIELD_KEYS, FIELD_LABELS, maskValue, recordToJson } from "../lib/engine.js";
import { loadHistory, saveHistory, originFromRecord } from "../lib/history.js";

const state = {
  record: null,
  events: [],
  conflicts: [],
  tab: "record",
  maskPii: false,
  past: [],
  future: [],
  error: "",
  origin: "",
};

const $ = (id) => document.getElementById(id);
const body = $("panel-body");

const FIELD_KIND = {
  company_name: "heading",
  legal_name: "heading",
  email: "email",
  phone: "phone",
  address: "heading",
};

function fieldKind(key) {
  return FIELD_KIND[key] || "";
}

function verifySource({ sourceId, snippet, kind }) {
  chrome.runtime.sendMessage({
    type: "AETHER_HIGHLIGHT",
    sourceId: sourceId || "",
    snippet: snippet || "",
    kind: kind || "",
  });
}

async function persistHistory() {
  const origin = state.origin || originFromRecord(state.record);
  if (!origin) return;
  state.origin = origin;
  await saveHistory(origin, {
    record: state.record,
    past: state.past,
    future: state.future,
  });
}

function snapshot() {
  if (!state.record) return;
  state.past.push(structuredClone(state.record));
  if (state.past.length > 40) state.past.shift();
  state.future = [];
  persistHistory();
}

function render() {
  $("undo-btn").disabled = !state.past.length;
  $("redo-btn").disabled = !state.future.length;
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("on", t.dataset.tab === state.tab);
  });
  if (state.tab === "log") {
    body.innerHTML = state.events.length
      ? state.events
          .map(
            (e) =>
              `<div class="log-item"><span class="dot ${e.status === "warn" || e.status === "error" ? "warn" : ""}"></span><div><div><span class="chip">${e.stage}</span> ${esc(e.message)}</div>${e.detail ? `<div class="muted">${esc(e.detail)}</div>` : ""}</div></div>`,
          )
          .join("")
      : `<p class="muted">Harness log appears after Extract.</p>`;
    return;
  }
  if (state.tab === "sources") {
    if (!state.record) return empty();
    body.innerHTML = state.record.pagesVisited
      .map(
        (p) =>
          `<div class="card"><div>${esc(p.title)}</div><div class="muted" style="font-family:var(--mono);font-size:11px;word-break:break-all">${esc(p.url)}</div><div class="chip">${esc(p.role)}</div></div>`,
      )
      .join("");
    return;
  }
  if (!state.record) return empty();
  const rec = state.record;
  const fields = FIELD_KEYS.map((key, i) => {
    const f = rec.fields[key];
    const val =
      state.maskPii && (key === "email" || key === "phone")
        ? maskValue(key, f.value)
        : f.value;
    const control =
      key === "description"
        ? `<textarea data-field="${key}">${esc(val)}</textarea>`
        : `<input data-field="${key}" value="${esc(val)}" />`;
    const sourceId = f.sourceId || "";
    const snippet = f.sourceSnippet || f.value || "";
    return `<div class="field"><div class="lab"><span class="k">${String(i + 1).padStart(2, "0")} ${FIELD_LABELS[key]}</span><span class="badge ${f.confidence}">${f.verified ? "✓ " : ""}${f.confidence}</span></div>${control}<button type="button" class="btn ghost" data-src="${esc(f.sourceUrl)}" data-source-id="${esc(sourceId)}" data-kind="${esc(fieldKind(key))}" data-snippet="${esc(snippet)}">Verify source</button></div>`;
  }).join("");
  const execs = rec.executives
    .map(
      (e) =>
        `<div class="card"><div class="lab"><span class="badge ${e.confidence}">${e.confidence}</span></div><input data-exec="${e.id}" data-k="name" value="${esc(e.name)}" placeholder="Name" /><input data-exec="${e.id}" data-k="role" value="${esc(e.role)}" placeholder="Role" style="margin-top:6px" /><input data-exec="${e.id}" data-k="email" value="${esc(state.maskPii && e.email ? maskValue("email", e.email) : e.email)}" placeholder="Email" style="margin-top:6px" /><button type="button" class="btn ghost" data-src="${esc(e.sourceUrl || "")}" data-source-id="${esc(e.sourceId || "")}" data-kind="person" data-snippet="${esc([e.name, e.role].filter(Boolean).join(" "))}">Verify source</button></div>`,
    )
    .join("");
  body.innerHTML = `
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    <div class="chips">
      <span class="chip">${esc(rec.languageName || rec.language)}</span>
      <span class="chip">${rec.complete ? "complete" : "partial"}</span>
      ${rec.cacheHit ? `<span class="chip">cache</span>` : ""}
    </div>
    ${fields}
    <div class="k" style="margin:16px 0 8px">C-suite</div>
    ${execs || `<p class="muted">No executives on this pass.</p>`}
  `;
  body.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("change", () => {
      snapshot();
      const key = el.getAttribute("data-field");
      rec.fields[key].value = el.value;
      rec.fields[key].dirty = true;
      rec.fields[key].verified = true;
      persistHistory();
    });
  });
  body.querySelectorAll("[data-exec]").forEach((el) => {
    el.addEventListener("change", () => {
      snapshot();
      const exec = rec.executives.find((x) => x.id === el.getAttribute("data-exec"));
      if (exec) {
        exec[el.getAttribute("data-k")] = el.value;
        exec.dirty = true;
        exec.verified = true;
        persistHistory();
      }
    });
  });
  body.querySelectorAll("[data-snippet]").forEach((el) => {
    el.addEventListener("click", () => {
      verifySource({
        sourceId: el.getAttribute("data-source-id"),
        snippet: el.getAttribute("data-snippet"),
        kind: el.getAttribute("data-kind"),
      });
    });
  });
}

function empty() {
  body.innerHTML = `<div class="empty"><p class="serif">Empty dossier</p><p>Extract the open tab. Missing C-suite or address triggers a self-heal pass over scored sub-pages.</p></div>`;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

$("extract-btn").addEventListener("click", async () => {
  $("extract-btn").disabled = true;
  $("extract-btn").textContent = "Running";
  state.events = [];
  state.error = "";
  state.tab = "log";
  render();
  const res = await chrome.runtime.sendMessage({ type: "AETHER_EXTRACT" });
  $("extract-btn").disabled = false;
  $("extract-btn").textContent = "Extract";
  if (!res?.ok) {
    state.error = res?.error || "Extract failed";
    state.tab = "record";
    render();
    return;
  }
  state.record = res.record;
  state.conflicts = res.conflicts || [];
  state.past = [];
  state.future = [];
  state.origin = originFromRecord(res.record);
  await persistHistory();
  $("engine-label").textContent = res.engine === "nano" ? "Gemini Nano" : "Heuristic · Nano unavailable";
  state.tab = "record";
  render();
  if (state.conflicts.length) {
    $("conflict-list").innerHTML = state.conflicts
      .map(
        (c) =>
          `<div class="card"><div class="k">${esc(c.label)}</div><div>Yours: ${esc(c.current)}</div><div class="muted">Incoming: ${esc(c.incoming)}</div></div>`,
      )
      .join("");
    $("conflict").showModal();
  }
});

$("keep-btn").addEventListener("click", () => $("conflict").close());
$("take-btn").addEventListener("click", () => {
  snapshot();
  for (const c of state.conflicts) {
    if (state.record?.fields[c.key]) {
      state.record.fields[c.key].value = c.incoming;
      state.record.fields[c.key].dirty = false;
    }
  }
  $("conflict").close();
  persistHistory();
  render();
});

document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    state.tab = t.dataset.tab;
    render();
  });
});

$("undo-btn").addEventListener("click", () => {
  const prev = state.past.pop();
  if (!prev || !state.record) return;
  state.future.push(structuredClone(state.record));
  state.record = prev;
  persistHistory();
  render();
});
$("redo-btn").addEventListener("click", () => {
  const next = state.future.pop();
  if (!next || !state.record) return;
  state.past.push(structuredClone(state.record));
  state.record = next;
  persistHistory();
  render();
});
$("pii-toggle").addEventListener("change", (e) => {
  state.maskPii = e.target.checked;
  render();
});

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("json-btn").addEventListener("click", () => {
  if (!state.record) return;
  download("aether-record.json", recordToJson(state.record, state.maskPii), "application/json");
});
$("md-btn").addEventListener("click", () => {
  if (!state.record) return;
  const lines = [`# ${state.record.fields.company_name.value}`, ""];
  for (const key of FIELD_KEYS) {
    const v = state.maskPii ? maskValue(key, state.record.fields[key].value) : state.record.fields[key].value;
    if (v) lines.push(`- **${FIELD_LABELS[key]}**: ${v}`);
  }
  download("aether-record.md", lines.join("\n"), "text/markdown");
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "AETHER_PROGRESS" && msg.event) {
    state.events.push(msg.event);
    if (state.tab === "log") render();
  }
});

async function restoreForActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.url) return;
    const origin = new URL(tab.url).origin;
    state.origin = origin;
    const hist = await loadHistory(origin);
    if (!hist?.record) return;
    state.record = hist.record;
    state.past = hist.past || [];
    state.future = hist.future || [];
  } catch {
    /* chrome:// or no tab */
  }
}

restoreForActiveTab().then(render);
