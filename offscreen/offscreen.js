import { inferDocument, probeNano, ensureNano } from "../lib/nano.js";

function progress(stage, message, status = "running", detail = "") {
  chrome.runtime
    .sendMessage({
      type: "AETHER_PROGRESS",
      event: { stage, message, status, detail },
    })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "AETHER_OFFSCREEN_PROBE_NANO") {
    probeNano()
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "probe failed" }),
      );
    return true;
  }

  if (msg?.type === "AETHER_OFFSCREEN_ENSURE_NANO") {
    ensureNano((evt) => {
      if (evt.status === "downloading" || evt.status === "downloadable") {
        const pct =
          typeof evt.loaded === "number" ? Math.round(evt.loaded * 100) : null;
        progress(
          "nano",
          pct != null
            ? `Downloading Gemini Nano · ${pct}%`
            : "Downloading Gemini Nano",
          "running",
          String(pct ?? ""),
        );
      } else if (evt.status === "available") {
        progress("nano", "Gemini Nano ready", "ok", "available");
      } else {
        progress("nano", `Nano ${evt.status}`, "warn", evt.status);
      }
    })
      .then((r) => sendResponse({ ok: r.ok, status: r.status }))
      .catch((err) =>
        sendResponse({ ok: false, error: err?.message || "ensure failed" }),
      );
    return true;
  }

  if (msg?.type !== "AETHER_OFFSCREEN_INFER") return false;

  progress("nano", "Preparing Gemini Nano", "running");
  inferDocument(msg.doc, {
    onProgress: (loaded) => {
      const pct = Math.round(Number(loaded) * 100);
      progress(
        "nano",
        pct < 100 ? `Downloading Gemini Nano · ${pct}%` : "Gemini Nano ready",
        pct < 100 ? "running" : "ok",
        String(pct),
      );
    },
  })
    .then((result) => {
      if (result.engine === "nano") {
        progress("nano", "Primary inference via Gemini Nano", "ok", "nano");
      } else {
        progress(
          "nano",
          "Fell back to heuristic",
          "warn",
          result.nanoError || result.engine || "heuristic",
        );
      }
      sendResponse({ ok: true, ...result });
    })
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
