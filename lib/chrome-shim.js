/**
 * Aether Chrome MV3 Polyfill for Web Environments.
 * Allows the exact same sidepanel, options, and content scripts
 * to run in standard browser previews outside the Chrome Extension container.
 */

(function () {
  if (typeof window === "undefined") return;
  if (window.chrome?.runtime?.id && !window.chrome.__isShim) {
    return; // Already running in a real Chrome extension context
  }

  const EN_MESSAGES = {
    extName: "Aether — Company Intelligence",
    extShortName: "Aether",
    extDescription: "Autonomous on-device company intelligence. Gemini Nano extraction, self-healing navigation, and source-traced records.",
    actionTitle: "Open Aether",
    extract: "Extract",
    extractRunning: "Running",
    record: "Record",
    sources: "Sources",
    log: "Log",
    maskPii: "Mask PII",
    cSuite: "C-suite",
    verifySource: "Verify source",
    emptyDossier: "Empty dossier",
    emptyHint: "Extract the open tab. Missing C-suite or address triggers a self-heal pass over scored sub-pages.",
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

  function createStorageArea(prefix, storageBackend) {
    return {
      async get(keys) {
        const out = {};
        if (!keys) {
          for (let i = 0; i < storageBackend.length; i++) {
            const k = storageBackend.key(i);
            if (k && k.startsWith(prefix)) {
              try {
                out[k.slice(prefix.length)] = JSON.parse(storageBackend.getItem(k));
              } catch {
                out[k.slice(prefix.length)] = storageBackend.getItem(k);
              }
            }
          }
          return out;
        }
        if (typeof keys === "string") {
          const raw = storageBackend.getItem(prefix + keys);
          if (raw !== null) {
            try { out[keys] = JSON.parse(raw); } catch { out[keys] = raw; }
          }
          return out;
        }
        if (Array.isArray(keys)) {
          for (const k of keys) {
            const raw = storageBackend.getItem(prefix + k);
            if (raw !== null) {
              try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
            }
          }
          return out;
        }
        if (typeof keys === "object") {
          for (const [k, defaultVal] of Object.entries(keys)) {
            const raw = storageBackend.getItem(prefix + k);
            if (raw !== null) {
              try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
            } else {
              out[k] = defaultVal;
            }
          }
          return out;
        }
        return out;
      },
      async set(items) {
        if (!items || typeof items !== "object") return;
        for (const [k, v] of Object.entries(items)) {
          storageBackend.setItem(prefix + k, JSON.stringify(v));
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) {
          storageBackend.removeItem(prefix + k);
        }
      },
      async clear() {
        const toRemove = [];
        for (let i = 0; i < storageBackend.length; i++) {
          const k = storageBackend.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        for (const k of toRemove) storageBackend.removeItem(k);
      },
    };
  }

  const inMemory = new Map();
  const memoryStorage = {
    getItem(k) { return inMemory.has(k) ? inMemory.get(k) : null; },
    setItem(k, v) { inMemory.set(k, String(v)); },
    removeItem(k) { inMemory.delete(k); },
    get length() { return inMemory.size; },
    key(i) { return [...inMemory.keys()][i] || null; },
  };

  const localBackend = typeof window.localStorage !== "undefined" ? window.localStorage : memoryStorage;
  const sessionBackend = typeof window.sessionStorage !== "undefined" ? window.sessionStorage : memoryStorage;

  const storageLocal = createStorageArea("aether:local:", localBackend);
  const storageSync = createStorageArea("aether:sync:", localBackend);
  const storageSession = createStorageArea("aether:session:", sessionBackend);

  // BroadcastChannel for cross-frame / cross-window messaging
  const bus = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("aether-extension-bus") : null;
  const localListeners = new Set();

  function onMessageListener(msg, sender, sendResponse) {
    let responded = false;
    const responder = (res) => {
      responded = true;
      sendResponse(res);
    };
    for (const fn of localListeners) {
      try {
        const result = fn(msg, sender, responder);
        if (result === true) responded = true;
      } catch (err) {
        console.error("[Aether Shim] Listener error:", err);
      }
    }
    return responded;
  }

  if (bus) {
    bus.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (data.type === "AETHER_RPC_CALL") {
        const sender = { id: "aether-web-preview" };
        let handled = false;
        for (const fn of localListeners) {
          try {
            const ret = fn(data.payload, sender, (res) => {
              handled = true;
              bus.postMessage({ type: "AETHER_RPC_REPLY", callId: data.callId, response: res });
            });
            if (ret === true) handled = true;
          } catch (e) {
            console.error("[Aether Shim] RPC dispatch error:", e);
          }
        }
      }
    };
  }

  // Active simulated page state
  let activeTabState = {
    id: 1,
    url: "https://acme.example/",
    title: "Acme Corp | Home",
    active: true,
  };

  const shim = {
    __isShim: true,
    i18n: {
      getMessage(key) {
        return EN_MESSAGES[key] || key;
      },
    },
    storage: {
      local: storageLocal,
      sync: storageSync,
      session: storageSession,
    },
    runtime: {
      id: "aether-web-preview",
      getURL(path) {
        const clean = String(path || "").replace(/^\//, "");
        return "/" + clean;
      },
      openOptionsPage() {
        if (window.openAetherOptions) {
          window.openAetherOptions();
        } else {
          window.open("/options/index.html", "_blank");
        }
      },
      onMessage: {
        addListener(fn) {
          localListeners.add(fn);
        },
        removeListener(fn) {
          localListeners.delete(fn);
        },
      },
      async sendMessage(msg) {
        // First try local listeners
        let directResponse = null;
        let responded = false;
        const sender = { id: "aether-web-preview" };

        for (const fn of localListeners) {
          try {
            const ret = fn(msg, sender, (res) => {
              responded = true;
              directResponse = res;
            });
            if (ret === true) {
              // Async response expected
            }
          } catch (e) {
            console.error("[Aether Shim] sendMessage listener error:", e);
          }
        }

        if (responded && directResponse !== null) {
          return directResponse;
        }

        // Try via BroadcastChannel if available
        if (bus) {
          const callId = "call-" + Math.random().toString(36).slice(2) + Date.now();
          const p = new Promise((resolve) => {
            const timeout = setTimeout(() => {
              bus.removeEventListener("message", onReply);
              // Fallback to internal worker if no external responder answered
              handleFallbackMessage(msg).then(resolve);
            }, 300);

            function onReply(evt) {
              if (evt.data?.type === "AETHER_RPC_REPLY" && evt.data?.callId === callId) {
                clearTimeout(timeout);
                bus.removeEventListener("message", onReply);
                resolve(evt.data.response);
              }
            }
            bus.addEventListener("message", onReply);
            bus.postMessage({ type: "AETHER_RPC_CALL", callId, payload: msg });
          });
          return await p;
        }

        return await handleFallbackMessage(msg);
      },
    },
    tabs: {
      async query() {
        return [activeTabState];
      },
      async sendMessage(tabId, msg) {
        return shim.runtime.sendMessage(msg);
      },
      async create(createProps) {
        return { id: Math.floor(Math.random() * 1000) + 2, url: createProps?.url || "", active: false };
      },
      async remove() {},
      onUpdated: {
        addListener() {},
        removeListener() {},
      },
    },
    sidePanel: {
      async setPanelBehavior() {},
      async open() {},
    },
    action: {
      onClicked: {
        addListener() {},
        removeListener() {},
      },
    },
  };

  /** Internal fallback handler when background service worker is not active */
  async function handleFallbackMessage(msg) {
    if (!msg || typeof msg !== "object") return { ok: false };

    if (msg.type === "AETHER_CLEAR_CACHE") {
      try {
        await storageLocal.clear();
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }

    if (msg.type === "AETHER_HIGHLIGHT") {
      // Find matching text in document or active preview
      if (typeof window.highlightAetherSource === "function") {
        const found = window.highlightAetherSource(msg.sourceId, msg.snippet, msg.kind);
        return { ok: true, found: Boolean(found) };
      }
      return { ok: true, found: false };
    }

    if (msg.type === "AETHER_EXTRACT") {
      try {
        // Send progress
        dispatchProgress("sanitize", "Reading DOM", "running");
        let startDoc = null;
        if (typeof window.getAetherActiveDoc === "function") {
          startDoc = window.getAetherActiveDoc();
        }

        if (!startDoc) {
          // Default fixture if no active tab document defined
          startDoc = {
            url: activeTabState.url,
            title: activeTabState.title,
            lang: "en",
            markdown: `# Acme Corp\n\nAcme Corp builds industrial sensors for global manufacturers and ships from three continents.\n\nAddress: 100 Market Street, San Francisco, CA 94105\nContact: press@acme.example or +1 415-555-0199\nWebsite: https://acme.example\n\n- **Jane Doe** — Chief Executive Officer — jane.doe@acme.example\n- **John Smith** — Chief Technology Officer — john.smith@acme.example\n`,
            links: [
              { href: "https://acme.example/leadership", text: "Leadership Team" },
              { href: "https://acme.example/about", text: "About Us" },
            ],
            sources: [],
          };
        }

        // Run harness
        const { runHarness } = await import("/lib/harness.js");
        const { extractFromMarkdown, hashUrl, maskRecordForCache } = await import("/lib/engine.js");
        const { readCacheRecord, toCachePayload } = await import("/lib/cache.js");

        const cached = msg.force ? null : await readCache(startDoc.url);

        async function readCache(url) {
          const key = `schema:${hashUrl(url)}`;
          const bag = await storageLocal.get(key);
          return readCacheRecord(bag[key] || null);
        }

        async function writeCache(url, record) {
          const slim = toCachePayload(record);
          const key = `schema:${hashUrl(url)}`;
          await storageLocal.set({ [key]: slim });
        }

        const harnessResult = await runHarness({
          startDoc,
          cached,
          fetchPage: async (url) => {
            dispatchProgress("navigate", "Scanning page", "running", url);
            if (typeof window.getAetherSubPageDoc === "function") {
              return window.getAetherSubPageDoc(url);
            }
            return null;
          },
          infer: async (doc) => {
            dispatchProgress("infer", "Inference · " + (doc.lang || "en"), "running");
            return { record: extractFromMarkdown(doc), engine: "heuristic" };
          },
          maxPages: 4,
          onEvent: (event) => dispatchProgress(event.stage, event.message, event.status, event.detail),
        });

        if (!harnessResult.record.cacheHit) {
          await writeCache(startDoc.url, harnessResult.record);
        }

        return {
          ok: true,
          record: harnessResult.record,
          conflicts: harnessResult.conflicts || [],
          engine: harnessResult.engine || "heuristic",
        };
      } catch (err) {
        console.error("[Aether Shim] Extract failed:", err);
        return { ok: false, error: err?.message || "Extract failed" };
      }
    }

    return { ok: true };
  }

  function dispatchProgress(stage, message, status = "running", detail = "") {
    const event = { stage, message, status, detail };
    const payload = { type: "AETHER_PROGRESS", event };
    for (const fn of localListeners) {
      try { fn(payload, { id: "aether-web-preview" }, () => {}); } catch {}
    }
    if (bus) {
      try { bus.postMessage({ type: "AETHER_RPC_CALL", payload }); } catch {}
    }
  }

  window.setAetherActiveTab = function (tab) {
    activeTabState = { ...activeTabState, ...tab };
  };

  window.chrome = shim;
})();
