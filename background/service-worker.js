import {
  extractFromMarkdown,
  hashUrl,
  maskRecordForCache,
  readCacheRecord,
  toCachePayload,
} from "../lib/engine.js";
import { runHarness } from "../lib/harness.js";

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen/offscreen.html");
const MAX_HEAL_TABS = 2;
const HEAL_TIMEOUT_MS = 8000;
const CONTENT_SCRIPT = "content/content-script.js";

const DEFAULT_SETTINGS = {
  maskPii: false,
  maskCache: false,
  maxPages: 4,
  forceHeuristic: false,
};

/** Concurrent hidden heal tabs — never more than MAX_HEAL_TABS. */
let healInFlight = 0;
const healWaiters = [];
const openHealTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) await chrome.sidePanel.open({ tabId: tab.id });
});

async function readSettings() {
  const bag = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const maxPages = Math.min(6, Math.max(2, Math.round(Number(bag.maxPages) || 4)));
  return {
    maskPii: Boolean(bag.maskPii),
    maskCache: Boolean(bag.maskCache),
    maxPages,
    forceHeuristic: Boolean(bag.forceHeuristic),
  };
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length) return true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DOM_PARSER"],
      justification: "Serialize and infer company records off the visible tab",
    });
    return true;
  } catch {
    return false;
  }
}

function cacheKey(url) {
  try {
    return `schema:${hashUrl(new URL(url).origin)}`;
  } catch {
    return `schema:${hashUrl(url)}`;
  }
}

async function readCache(url) {
  const key = cacheKey(url);
  const bag = await chrome.storage.local.get(key);
  return readCacheRecord(bag[key] || null);
}

async function writeCache(url, record, maskCache) {
  const slim = toCachePayload(record);
  const payload = maskCache ? maskRecordForCache(slim) : slim;
  await chrome.storage.local.set({ [cacheKey(url)]: payload });
}

function sendToPanel(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

function logHeal(status, message, detail) {
  sendToPanel({
    type: "AETHER_PROGRESS",
    event: { stage: "navigate", status, message, detail },
  });
}

async function acquireHealSlot() {
  if (healInFlight < MAX_HEAL_TABS) {
    healInFlight += 1;
    return;
  }
  await new Promise((resolve) => healWaiters.push(resolve));
  healInFlight += 1;
}

function releaseHealSlot() {
  healInFlight = Math.max(0, healInFlight - 1);
  const next = healWaiters.shift();
  if (next) next();
}

async function closeHealTab(tabId) {
  if (!tabId) return;
  openHealTabs.delete(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already closed or never opened.
  }
}

/** Inject content script only when this tab has no listener yet. */
async function injectContent(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT],
  });
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await injectContent(tabId);
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function serializeTab(tabId) {
  return sendToTab(tabId, { type: "AETHER_SERIALIZE" });
}

async function fetchPageInBackground(url) {
  await acquireHealSlot();
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId) openHealTabs.add(tabId);
    await waitComplete(tabId, HEAL_TIMEOUT_MS);
    const res = await serializeTab(tabId);
    return res?.ok ? res.doc : null;
  } catch (err) {
    const timedOut = err?.message === "timeout";
    logHeal(
      "warn",
      timedOut ? `Heal tab timed out (${HEAL_TIMEOUT_MS / 1000}s)` : "Heal tab failed",
      url,
    );
    return null;
  } finally {
    await closeHealTab(tabId);
    releaseHealSlot();
  }
}

function waitComplete(tabId, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("timeout"));
    }, ms);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(t);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Prompt API / LanguageModel stays in the offscreen document — never the SW. */
async function inferViaOffscreen(doc, forceHeuristic) {
  if (!forceHeuristic) {
    const ready = await ensureOffscreen();
    if (ready) {
      try {
        const res = await chrome.runtime.sendMessage({
          type: "AETHER_OFFSCREEN_INFER",
          doc,
        });
        if (res?.ok && res.record) {
          return {
            record: res.record,
            engine: res.engine || "offscreen",
            chunks: res.chunks,
          };
        }
      } catch {
        // Offscreen missing or message dropped — heuristic below.
      }
    }
  }
  return { record: extractFromMarkdown(doc), engine: "heuristic" };
}

async function extractActive(force) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active tab");
  const settings = await readSettings();
  sendToPanel({ type: "AETHER_PROGRESS", event: { stage: "sanitize", message: "Reading DOM", status: "running" } });
  const res = await serializeTab(tab.id);
  if (!res?.ok) throw new Error("Could not serialize this page");
  if (!settings.forceHeuristic) await ensureOffscreen();
  const cached = force ? null : await readCache(res.doc.url);
  const result = await runHarness({
    startDoc: res.doc,
    cached,
    fetchPage: fetchPageInBackground,
    infer: (doc) => inferViaOffscreen(doc, settings.forceHeuristic),
    maxPages: settings.maxPages,
    onEvent: (event) => sendToPanel({ type: "AETHER_PROGRESS", event }),
  });
  for (const leftover of [...openHealTabs]) {
    await closeHealTab(leftover);
  }
  if (!result.record.cacheHit) await writeCache(res.doc.url, result.record, settings.maskCache);
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "AETHER_OFFSCREEN_INFER") {
    return false;
  }
  if (msg?.type === "AETHER_EXTRACT") {
    extractActive(Boolean(msg.force))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "Extract failed" }),
      );
    return true;
  }
  if (msg?.type === "AETHER_HIGHLIGHT") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) return;
      try {
        await sendToTab(tab.id, {
          type: "AETHER_HIGHLIGHT",
          sourceId: msg.sourceId,
          snippet: msg.snippet,
        });
      } catch {
        // Restricted page or inject failed — panel still gets ok below.
      }
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === "AETHER_CLEAR_CACHE") {
    chrome.storage.local.clear().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
