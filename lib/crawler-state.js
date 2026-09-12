/**
 * Fault-tolerant crawler state management with storage checkpointing and backoff.
 */

export class CrawlerState {
  constructor({
    maxPages = 4,
    maxRetries = 3,
    initialDelayMs = 1000,
    storageKey = "crawler_active_state",
    storage = null,
  } = {}) {
    this.maxPages = maxPages;
    this.maxRetries = maxRetries;
    this.initialDelayMs = initialDelayMs;
    this.storageKey = storageKey;
    this.storage =
      storage ||
      (typeof chrome !== "undefined" && chrome?.storage?.local
        ? chrome.storage.local
        : null);
    this.state = {
      visited: [],
      frontier: [],
      record: null,
      startedAt: Date.now(),
      status: "idle",
      retryCount: 0,
    };
  }

  async persist() {
    if (this.storage) {
      await this.storage.set({ [this.storageKey]: this.state });
    }
  }

  async restore() {
    if (this.storage) {
      const stored = await this.storage.get(this.storageKey);
      if (stored && stored[this.storageKey]) {
        this.state = stored[this.storageKey];
        return true;
      }
    }
    return false;
  }

  async clear() {
    if (this.storage) {
      if (typeof this.storage.remove === "function") {
        await this.storage.remove(this.storageKey);
      } else if (typeof this.storage.set === "function") {
        await this.storage.set({ [this.storageKey]: null });
      }
    }
    this.state = {
      visited: [],
      frontier: [],
      record: null,
      startedAt: Date.now(),
      status: "idle",
      retryCount: 0,
    };
  }

  async executeWithRetry(
    actionFn,
    url,
    maxRetries = this.maxRetries,
    initialDelay = this.initialDelayMs,
    attempt = 1,
  ) {
    try {
      return await actionFn(url);
    } catch (err) {
      this.state.retryCount = (this.state.retryCount || 0) + 1;
      if (attempt >= maxRetries) throw err;
      const jitter = Math.floor(Math.random() * 20);
      const delay = initialDelay * Math.pow(2, attempt - 1) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.executeWithRetry(
        actionFn,
        url,
        maxRetries,
        initialDelay,
        attempt + 1,
      );
    }
  }
}
