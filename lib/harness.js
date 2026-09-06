import { inferDocument } from "./nano.js";
import {
  isComplete,
  mergeRecords,
  missingFields,
  scoreLinks,
} from "./engine.js";

export const MAX_PAGES = 4;
export const MAX_DEPTH = 2;
export const SCORE_THRESHOLD = 0.7;

export async function runHarness({ startDoc, fetchPage, onEvent, cached }) {
  if (cached) {
    onEvent?.({
      stage: "cache",
      message: "Domain schema restored from chrome.storage.local",
      status: "ok",
    });
    return { record: { ...cached, cacheHit: true }, conflicts: [], engine: "cache" };
  }

  onEvent?.({
    stage: "sanitize",
    message: `Serialized ${startDoc.markdown.split(/\s+/).length} tokens`,
    status: "ok",
  });
  onEvent?.({
    stage: "infer",
    message: `Primary inference · ${startDoc.lang}`,
    status: "running",
  });
  const first = await inferDocument(startDoc);
  let record = first.record;
  const miss = missingFields(record);
  onEvent?.({
    stage: "infer",
    message: miss.length
      ? `Incomplete — missing ${miss.join(", ")}`
      : "Primary pass complete",
    status: miss.length ? "warn" : "ok",
    detail: first.engine,
  });

  const visited = new Set([startDoc.url]);
  const conflicts = [];
  let depth = 0;

  while (!isComplete(record) && depth < MAX_DEPTH && visited.size < MAX_PAGES) {
    depth += 1;
    const scored = scoreLinks(startDoc.links, startDoc.url).filter(
      (l) => l.score >= SCORE_THRESHOLD && !visited.has(l.href),
    );
    onEvent?.({
      stage: "score",
      message: `Link classifier ranked ${scored.length} targets`,
      status: scored.length ? "ok" : "warn",
      detail: scored
        .slice(0, 3)
        .map((s) => `${s.text} ${Math.round(s.score * 100)}%`)
        .join(" · "),
    });
    const queue = scored.slice(0, MAX_PAGES - visited.size);
    if (!queue.length) break;

    for (const link of queue) {
      onEvent?.({
        stage: "navigate",
        message: `Background tab · ${link.href}`,
        status: "running",
        detail: link.reason,
      });
      const doc = await fetchPage(link.href);
      visited.add(link.href);
      if (!doc) {
        onEvent?.({
          stage: "navigate",
          message: "Unreachable sub-page",
          status: "warn",
        });
        continue;
      }
      const patch = await inferDocument(doc);
      patch.record.pagesVisited = patch.record.pagesVisited.map((p) => ({
        ...p,
        role: "heal",
      }));
      const merged = mergeRecords(record, patch.record);
      record = merged.merged;
      conflicts.push(...merged.conflicts);
      onEvent?.({
        stage: "merge",
        message: merged.conflicts.length
          ? "Merge paused — protected edits"
          : "Patched missing entities",
        status: merged.conflicts.length ? "warn" : "ok",
      });
      if (isComplete(record)) break;
    }
  }

  onEvent?.({
    stage: "cache",
    message: "Wrote domain schema",
    status: "ok",
  });
  onEvent?.({
    stage: "done",
    message: record.complete ? "Record complete" : "Partial record",
    status: record.complete ? "ok" : "warn",
  });
  return { record, conflicts, engine: first.engine };
}
