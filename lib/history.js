const MAX_SNAPSHOTS = 20;
const KEY_PREFIX = "aether:hist:";

function storageArea() {
  if (typeof chrome !== "undefined" && chrome.storage?.session) {
    return chrome.storage.session;
  }
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

export function historyKey(origin) {
  return `${KEY_PREFIX}${origin || "unknown"}`;
}

export function originFromRecord(record) {
  if (!record) return "";
  const site = record.fields?.website?.value;
  if (site) {
    try {
      return new URL(site).origin;
    } catch {
      /* fall through */
    }
  }
  const page = record.pagesVisited?.[0]?.url;
  if (page) {
    try {
      return new URL(page).origin;
    } catch {
      /* fall through */
    }
  }
  return "";
}

export function clipStacks(past = [], future = []) {
  const p = Array.isArray(past) ? past.slice(-MAX_SNAPSHOTS) : [];
  const f = Array.isArray(future) ? future.slice(-MAX_SNAPSHOTS) : [];
  return { past: p, future: f };
}

export async function loadHistory(origin) {
  if (!origin) return null;
  const area = storageArea();
  if (!area) return null;
  const key = historyKey(origin);
  const bag = await area.get(key);
  const entry = bag?.[key];
  if (!entry || typeof entry !== "object") return null;
  const { past, future } = clipStacks(entry.past, entry.future);
  return {
    record: entry.record || null,
    past,
    future,
  };
}

export async function saveHistory(origin, { record, past, future }) {
  if (!origin) return;
  const area = storageArea();
  if (!area) return;
  const stacks = clipStacks(past, future);
  await area.set({
    [historyKey(origin)]: {
      record: record || null,
      past: stacks.past,
      future: stacks.future,
      savedAt: new Date().toISOString(),
    },
  });
}

export async function clearHistory(origin) {
  if (!origin) return;
  const area = storageArea();
  if (!area) return;
  await area.remove(historyKey(origin));
}

export { MAX_SNAPSHOTS };
