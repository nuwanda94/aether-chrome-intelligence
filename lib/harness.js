import { inferDocument } from "./nano.js";
import {
  isComplete,
  mergeRecords,
  missingFields,
  scoreLinks,
} from "./engine.js";
import { CrawlerState } from "./crawler-state.js";

export const MAX_PAGES = 4;
export const MAX_DEPTH = 2;
export const SCORE_THRESHOLD = 0.7;

function pageCap(maxPages) {
  const n = Number(maxPages);
  if (!Number.isFinite(n)) return MAX_PAGES;
  return Math.min(6, Math.max(2, Math.round(n)));
}

function unionLinks(pool, extra) {
  if (!Array.isArray(extra) || !extra.length) return pool;
  const seen = new Set(pool.map((l) => l.href));
  const next = pool.slice();
  for (const link of extra) {
    if (!link?.href || seen.has(link.href)) continue;
    seen.add(link.href);
    next.push(link);
  }
  return next;
}

export async function runHarness({ startDoc, fetchPage, onEvent, cached, infer, maxPages, state: externalState }) {
  const runInfer = infer || inferDocument;
  const cap = pageCap(maxPages);
  const crawlerState = externalState || new CrawlerState({ maxPages: cap });

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
  const first = await runInfer(startDoc);
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

  crawlerState.state.status = "running";
  crawlerState.state.visited = [startDoc.url];
  crawlerState.state.record = record;
  await crawlerState.persist();

  const visited = new Set([startDoc.url]);
  const conflicts = [];
  let depth = 0;
  let linkPool = Array.isArray(startDoc.links) ? startDoc.links.slice() : [];

  while (!isComplete(record) && depth < MAX_DEPTH && visited.size < cap) {
    depth += 1;
    const currentMissing = missingFields(record);
    const scored = scoreLinks(linkPool, startDoc.url, currentMissing).filter(
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
    const queue = scored.slice(0, cap - visited.size);
    if (!queue.length) break;

    crawlerState.state.frontier = queue.map((l) => l.href);
    await crawlerState.persist();

    for (const link of queue) {
      if (visited.has(link.href) || visited.size >= cap) break;
      visited.add(link.href);
      onEvent?.({
        stage: "navigate",
        message: `Background tab · ${link.href}`,
        status: "running",
        detail: link.reason,
      });
      const doc = await crawlerState.executeWithRetry(fetchPage, link.href);
      if (!doc) {
        onEvent?.({
          stage: "navigate",
          message: "Unreachable sub-page",
          status: "warn",
        });
        continue;
      }
      linkPool = unionLinks(linkPool, doc.links);
      const patch = await runInfer(doc);
      patch.record.pagesVisited = patch.record.pagesVisited.map((p) => ({
        ...p,
        role: "heal",
      }));
      const merged = mergeRecords(record, patch.record);
      record = merged.merged;
      conflicts.push(...merged.conflicts);

      crawlerState.state.visited = Array.from(visited);
      crawlerState.state.record = record;
      await crawlerState.persist();

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

  crawlerState.state.status = record.complete ? "completed" : "partial";
  await crawlerState.persist();

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
