import { inferDocument } from "../lib/nano.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "AETHER_OFFSCREEN_INFER") return false;
  inferDocument(msg.doc)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
});
