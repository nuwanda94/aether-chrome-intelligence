import { hashUrl } from "../lib/engine.js";
import { runHarness } from "../lib/harness.js";

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen/offscreen.html");

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) await chrome.sidePanel.open({ tabId: tab.id });
});

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DOM_PARSER"],
    justification: "Serialize and infer company records off the visible tab",
  });
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
  return bag[key] || null;
}

async function writeCache(url, record) {
  await chrome.storage.local.set({ [cacheKey(url)]: record });
}

function sendToPanel(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

async function serializeTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "AETHER_SERIALIZE" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content-script.js"],
    });
    return await chrome.tabs.sendMessage(tabId, { type: "AETHER_SERIALIZE" });
  }
}

async function fetchPageInBackground(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitComplete(tab.id, 8000);
    const res = await serializeTab(tab.id);
    return res?.ok ? res.doc : null;
  } catch {
    return null;
  } finally {
    if (tab.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitComplete(tabId, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
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

async function extractActive(force) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active tab");
  sendToPanel({ type: "AETHER_PROGRESS", event: { stage: "sanitize", message: "Reading DOM", status: "running" } });
  const res = await serializeTab(tab.id);
  if (!res?.ok) throw new Error("Could not serialize this page");
  await ensureOffscreen();
  const cached = force ? null : await readCache(res.doc.url);
  const result = await runHarness({
    startDoc: res.doc,
    cached,
    fetchPage: fetchPageInBackground,
    onEvent: (event) => sendToPanel({ type: "AETHER_PROGRESS", event }),
  });
  if (!result.record.cacheHit) await writeCache(res.doc.url, result.record);
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "AETHER_EXTRACT") {
    extractActive(Boolean(msg.force))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "Extract failed" }),
      );
    return true;
  }
  if (msg?.type === "AETHER_HIGHLIGHT") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs
          .sendMessage(tab.id, {
            type: "AETHER_HIGHLIGHT",
            sourceId: msg.sourceId,
            snippet: msg.snippet,
          })
          .catch(() => {});
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
