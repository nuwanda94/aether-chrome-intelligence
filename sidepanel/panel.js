import { FIELD_KEYS, FIELD_LABELS, maskValue, recordToJson, executivesToCsv } from "../lib/engine.js";
import { loadHistory, saveHistory, originFromRecord } from "../lib/history.js";
import { ensureNano, probeNano } from "../lib/nano.js";

const FALLBACK = {
  extract: "Extract",
  extractRunning: "Running",
  record: "Record",
  sources: "Sources",
  log: "Log",
  maskPii: "Mask PII",
  cSuite: "C-suite",
  verifySource: "Verify source",
  emptyDossier: "Empty dossier",
  emptyHint:
    "Extract the open tab. Missing C-suite or address triggers a self-heal pass over scored sub-pages.",
  noExecutives: "No executives on this pass.",
  logHint: "Harness log appears after Extract.",
  mergeConflict: "Merge conflict",
  mergeConflictHint: "Self-heal found values for fields you already edited.",
  keepMine: "Keep mine",
  takeIncoming: "Take incoming",
  yours: "Yours",
  incoming: "Incoming",
  complete: "complete",
  partial: "partial",
  copiedJson: "Copied JSON",
  copiedMaskedJson: "Copied masked JSON",
  clipboardUnavailable: "Clipboard unavailable",
  extractFailed: "Extract failed",
  engineNano: "Gemini Nano",
  engineHeuristic: "Heuristic · Nano unavailable",
  engineDownloading: "Downloading Gemini Nano…",
  engineCache: "Cache",
  cacheCleared: "Cache cleared",
  cacheClearFailed: "Could not clear cache",
  verifyOpened: "Opened source page",
  verifyMiss: "Source not found on page",
  extractTimed: "Extract finished",
  placeholderName: "Name",
  placeholderRole: "Role",
  placeholderEmail: "Email",
};

function t(key) {
  try {
    const msg = chrome?.i18n?.getMessage?.(key);
    if (msg) return msg;
  } catch {
    /* tests / no chrome */
  }
  return FALLBACK[key] || key;
}

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (text) el.textContent = text;
  });
}

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

function verifySource({ sourceId, snippet, kind, sourceUrl }) {
  chrome.runtime
    .sendMessage({
      type: "AETHER_HIGHLIGHT",
      sourceId: sourceId || "",
      snippet: snippet || "",
      kind: kind || "",
      sourceUrl: sourceUrl || "",
    })
    .then((res) => {
      if (res?.ok === false) toast(t("verifyMiss"));
      else if (sourceUrl) toast(t("verifyOpened"));
    })
    .catch(() => toast(t("verifyMiss")));
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

function toast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 1600);
}

function render() {
  $("undo-btn").disabled = !state.past.length;
  $("redo-btn").disabled = !state.future.length;
  document.querySelectorAll(".tab").forEach((tabEl) => {
    tabEl.classList.toggle("on", tabEl.dataset.tab === state.tab);
  });
  if (state.tab === "log") {
    body.innerHTML = state.events.length
      ? state.events
          .map(
            (e) =>
              `<div class="log-item"><span class="dot ${e.status === "warn" || e.status === "error" ? "warn" : ""}"></span><div><div><span class="chip">${e.stage}</span> ${esc(e.message)}</div>${e.detail ? `<div class="muted">${esc(e.detail)}</div>` : ""}</div></div>`,
          )
          .join("")
      : `<p class="muted">${esc(t("logHint"))}</p>`;
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
    return `<div class="field"><div class="lab"><span class="k">${String(i + 1).padStart(2, "0")} ${FIELD_LABELS[key]}</span><span class="badge ${f.confidence}">${f.verified ? "✓ " : ""}${f.confidence}</span></div>${control}<button type="button" class="btn ghost" data-src="${esc(f.sourceUrl)}" data-source-id="${esc(sourceId)}" data-kind="${esc(fieldKind(key))}" data-snippet="${esc(snippet)}">${esc(t("verifySource"))}</button></div>`;
  }).join("");
  const execs = rec.executives
    .map(
      (e) =>
        `<div class="card"><div class="lab"><span class="badge ${e.confidence}">${e.confidence}</span></div><input data-exec="${e.id}" data-k="name" value="${esc(e.name)}" placeholder="${esc(t("placeholderName"))}" /><input data-exec="${e.id}" data-k="role" value="${esc(e.role)}" placeholder="${esc(t("placeholderRole"))}" style="margin-top:6px" /><input data-exec="${e.id}" data-k="email" value="${esc(state.maskPii && e.email ? maskValue("email", e.email) : e.email)}" placeholder="${esc(t("placeholderEmail"))}" style="margin-top:6px" /><button type="button" class="btn ghost" data-src="${esc(e.sourceUrl || "")}" data-source-id="${esc(e.sourceId || "")}" data-kind="person" data-snippet="${esc([e.name, e.role].filter(Boolean).join(" "))}">${esc(t("verifySource"))}</button></div>`,
    )
    .join("");
  body.innerHTML = `
    ${state.error ? `<div class="err">${esc(state.error)}</div>` : ""}
    <div class="chips">
      <span class="chip">${esc(rec.languageName || rec.language)}</span>
      <span class="chip">${rec.complete ? t("complete") : t("partial")}</span>
      ${rec.cacheHit ? `<span class="chip">cache</span>` : ""}
    </div>
    ${fields}
    <div class="k" style="margin:16px 0 8px">${esc(t("cSuite"))}</div>
    ${execs || `<p class="muted">${esc(t("noExecutives"))}</p>`}
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
        sourceUrl: el.getAttribute("data-src") || "",
      });
    });
  });
}

function empty() {
  body.innerHTML = `<div class="empty"><p class="serif">${esc(t("emptyDossier"))}</p><p>${esc(t("emptyHint"))}</p></div>`;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/"/g, """);
}

function setEngineLabel(engine, nanoStatus) {
  const el = $("engine-label");
  if (!el) return;
  if (engine === "nano") el.textContent = t("engineNano");
  else if (engine === "cache") el.textContent = t("engineCache");
  else if (nanoStatus === "downloading" || nanoStatus === "downloadable")
    el.textContent = t("engineDownloading");
  else el.textContent = t("engineHeuristic");
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)} s`;
}

function setTiming(ms, engine) {
  const el = $("timing-label");
  if (!el) return;
  if (!Number.isFinite(ms)) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  const eng = engine ? ` · ${engine}` : "";
  el.textContent = `Extract ${formatDuration(ms)}${eng}`;
}

async function runExtract({ force = false } = {}) {
  const extractBtn = $("extract-btn");
  const forceBtn = $("force-btn");
  extractBtn.disabled = true;
  if (forceBtn) forceBtn.disabled = true;
  extractBtn.textContent = t("extractRunning");
  state.events = [];
  state.error = "";
  state.tab = "log";
  setTiming(NaN);
  render();
  const t0 = performance.now();

  let nanoStatus = "unknown";
  try {
    const probe = await probeNano();
    nanoStatus = probe.status;
    setEngineLabel(null, nanoStatus);
    if (probe.status === "downloadable" || probe.status === "downloading") {
      state.events.push({
        stage: "nano",
        message: "Downloading Gemini Nano (first run may take several minutes)",
        status: "running",
      });
      render();
      const ensured = await ensureNano((evt) => {
        nanoStatus = evt.status;
        setEngineLabel(null, evt.status);
        if (typeof evt.loaded === "number") {
          const pct = Math.round(evt.loaded * 100);
          const last = state.events[state.events.length - 1];
          if (last?.stage === "nano") {
            last.message = `Downloading Gemini Nano · ${pct}%`;
            last.detail = String(pct);
          }
          render();
        }
      });
      nanoStatus = ensured.status;
    } else if (probe.status === "available") {
      setEngineLabel("nano", "available");
    }
  } catch {
    /* panel may lack LanguageModel; offscreen will try next */
  }

  const res = await chrome.runtime.sendMessage({
    type: "AETHER_EXTRACT",
    force: Boolean(force),
  });
  const elapsed = performance.now() - t0;
  extractBtn.disabled = false;
  if (forceBtn) forceBtn.disabled = false;
  extractBtn.textContent = t("extract");

  if (!res?.ok) {
    state.error = res?.error || t("extractFailed");
    state.tab = "record";
    setTiming(elapsed, "error");
    state.events.push({
      stage: "done",
      message: `Failed after ${formatDuration(elapsed)}`,
      status: "error",
    });
    render();
    return;
  }

  state.record = res.record;
  state.conflicts = res.conflicts || [];
  state.past = [];
  state.future = [];
  state.origin = originFromRecord(res.record);
  await persistHistory();
  setEngineLabel(res.engine, nanoStatus);
  setTiming(elapsed, res.engine || "heuristic");
  state.events.push({
    stage: "bench",
    message: `Extract completed in ${formatDuration(elapsed)}`,
    status: "ok",
    detail: res.engine || "",
  });
  state.tab = "record";
  render();
  if (state.conflicts.length) {
    $("conflict-list").innerHTML = state.conflicts
      .map(
        (c) =>
          `<div class="card"><div class="k">${esc(c.label)}</div><div>${esc(t("yours"))}: ${esc(c.current)}</div><div class="muted">${esc(t("incoming"))}: ${esc(c.incoming)}</div></div>`,
      )
      .join("");
    $("conflict").showModal();
  }
}

$("extract-btn").addEventListener("click", () => {
  runExtract({ force: false }).catch((err) => {
    state.error = err?.message || t("extractFailed");
    render();
  });
});

$("force-btn")?.addEventListener("click", () => {
  runExtract({ force: true }).catch((err) => {
    state.error = err?.message || t("extractFailed");
    render();
  });
});

$("clear-cache-btn")?.addEventListener("click", async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: "AETHER_CLEAR_CACHE" });
    toast(res?.ok ? t("cacheCleared") : t("cacheClearFailed"));
  } catch {
    toast(t("cacheClearFailed"));
  }
});

$("options-btn")?.addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else window.open(chrome.runtime.getURL("options/index.html"), "_blank");
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

document.querySelectorAll(".tab").forEach((tabEl) => {
  tabEl.addEventListener("click", () => {
    state.tab = tabEl.dataset.tab;
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
$("csv-btn").addEventListener("click", () => {
  if (!state.record) return;
  download("aether-executives.csv", executivesToCsv(state.record, state.maskPii), "text/csv");
});
$("copy-btn").addEventListener("click", async () => {
  if (!state.record) return;
  const text = recordToJson(state.record, state.maskPii);
  try {
    await navigator.clipboard.writeText(text);
    toast(state.maskPii ? t("copiedMaskedJson") : t("copiedJson"));
  } catch {
    toast(t("clipboardUnavailable"));
  }
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

applyStaticI18n();
restoreForActiveTab().then(render);
