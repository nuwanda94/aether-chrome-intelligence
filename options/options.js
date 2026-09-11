const DEFAULTS = {
  maskPii: false,
  maskCache: false,
  maxPages: 4,
  forceHeuristic: false,
};

function clampPages(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULTS.maxPages;
  return Math.min(6, Math.max(2, Math.round(v)));
}

async function load() {
  const bag = await chrome.storage.sync.get(DEFAULTS);
  document.getElementById("mask-pii").checked = Boolean(bag.maskPii);
  document.getElementById("mask-cache").checked = Boolean(bag.maskCache);
  document.getElementById("max-pages").value = String(clampPages(bag.maxPages));
  document.getElementById("force-heuristic").checked = Boolean(bag.forceHeuristic);
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function save() {
  const settings = {
    maskPii: document.getElementById("mask-pii").checked,
    maskCache: document.getElementById("mask-cache").checked,
    maxPages: clampPages(document.getElementById("max-pages").value),
    forceHeuristic: document.getElementById("force-heuristic").checked,
  };
  document.getElementById("max-pages").value = String(settings.maxPages);
  await chrome.storage.sync.set(settings);
  setStatus("Saved.");
}

async function clearCache() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "AETHER_CLEAR_CACHE" });
    setStatus(res?.ok ? "Domain cache cleared." : "Could not clear cache.");
  } catch {
    setStatus("Could not clear cache.");
  }
}

document.getElementById("save-btn").addEventListener("click", () => {
  save().catch(() => setStatus("Save failed."));
});
document.getElementById("clear-cache-btn").addEventListener("click", () => {
  clearCache().catch(() => setStatus("Could not clear cache."));
});

load().catch(() => setStatus("Could not load settings."));
