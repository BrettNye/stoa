// stoa dashboard — Alpine.js state machine
// Field names mirror the contract types from src/transport/ui/types.ts.
// No write affordances here; those are added by task-frontend-writes.

function dashboard() {
  return {
    // State — mirrors ApiTask[], ApiAgent[], ApiChannelEntry[], ApiWiki[]
    tasks: [],
    agents: [],
    channelEntries: [],
    wikis: [],

    // Derived / display state
    activeTaskCount: 0,
    vaultBaseName: "",
    lastRefreshDelta: "—",
    pollPaused: false,
    loading: false,

    // Internal
    _lastFetchAt: null,
    _pollHandle: null,
    _deltaHandle: null,

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async boot() {
      await this.refresh();
      this.startPolling();

      // Visibility-change: pause poll when tab is hidden, resume + refresh when visible
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.stopPolling();
          this.pollPaused = true;
        } else {
          this.pollPaused = false;
          this.refresh();
          this.startPolling();
        }
      });

      // Tick the "last refreshed X ago" display every 5s
      this._deltaHandle = setInterval(() => {
        if (this._lastFetchAt) {
          this.lastRefreshDelta = this.relTime(this._lastFetchAt.toISOString());
        }
      }, 5000);
    },

    startPolling() {
      this.stopPolling();
      this._pollHandle = setInterval(() => this.refresh(), 10000);
    },

    stopPolling() {
      if (this._pollHandle !== null) {
        clearInterval(this._pollHandle);
        this._pollHandle = null;
      }
    },

    // -----------------------------------------------------------------------
    // Data fetching
    // -----------------------------------------------------------------------

    async refresh() {
      if (this.loading) return;
      this.loading = true;
      try {
        const [healthRes, tasksRes, agentsRes, channelsRes, wikisRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/tasks"),
          fetch("/api/agents"),
          fetch("/api/channels"),
          fetch("/api/wikis"),
        ]);

        // Parse all responses in parallel
        const [health, tasks, agents, channelsData, wikis] = await Promise.all([
          healthRes.ok ? healthRes.json() : null,
          tasksRes.ok ? tasksRes.json() : [],
          agentsRes.ok ? agentsRes.json() : [],
          channelsRes.ok ? channelsRes.json() : { channels: [], entries: [] },
          wikisRes.ok ? wikisRes.json() : [],
        ]);

        // Apply health data — ApiHealth: { ok, vault, wikis, indexedAt }
        if (health && health.ok) {
          const parts = (health.vault || "").replace(/\\/g, "/").split("/");
          this.vaultBaseName = parts[parts.length - 1] || health.vault || "";
        }

        // Apply tasks — ApiTask: { id, title, wiki, status, claimed_by, claimed_at, channel, required_pokemon_type, updated }
        if (Array.isArray(tasks)) {
          this.tasks = tasks;
          this.activeTaskCount = tasks.filter(
            (t) => t.status === "pending" || t.status === "claimed" || t.status === "in_progress"
          ).length;
        }

        // Apply agents — ApiAgent: { id, wiki, pokemon, pokemon_type, evolution_stage, spriteUrl, updated, claimedTaskCount }
        if (Array.isArray(agents)) {
          this.agents = agents;
        }

        // Apply channel entries — ApiChannelEntry: { id, channel, wiki, author, ts, excerpt, pageId }
        if (channelsData && Array.isArray(channelsData.entries)) {
          this.channelEntries = channelsData.entries;
        } else if (Array.isArray(channelsData)) {
          // Fallback if server returns plain array
          this.channelEntries = channelsData;
        }

        // Apply wikis — ApiWiki: { name, mode, pageCount, activeTasks }
        if (Array.isArray(wikis)) {
          this.wikis = wikis;
        }

        this._lastFetchAt = new Date();
        this.lastRefreshDelta = "just now";
      } catch (err) {
        // Non-fatal: leave stale data in place, show error in delta
        this.lastRefreshDelta = "error — retry pending";
        console.error("[stoa] refresh error:", err);
      } finally {
        this.loading = false;
      }
    },

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Returns a human-readable relative time string for an ISO timestamp.
     * e.g. "just now", "3m ago", "2h ago", "4d ago"
     */
    relTime(iso) {
      if (!iso) return "—";
      const delta = Date.now() - new Date(iso).getTime();
      if (isNaN(delta)) return "—";
      const abs = Math.abs(delta);
      if (abs < 5000) return "just now";
      if (abs < 60000) return Math.floor(abs / 1000) + "s ago";
      if (abs < 3600000) return Math.floor(abs / 60000) + "m ago";
      if (abs < 86400000) return Math.floor(abs / 3600000) + "h ago";
      return Math.floor(abs / 86400000) + "d ago";
    },

    /**
     * Produces an obsidian:// deep-link URI for a given ApiTask.
     * Uses the vaultBaseName resolved from /api/health.
     */
    taskHref(t) {
      const vault = encodeURIComponent(this.vaultBaseName);
      const file = encodeURIComponent(`wikis/${t.wiki}/tasks/${t.id}.md`);
      return `obsidian://open?vault=${vault}&file=${file}`;
    },
  };
}
