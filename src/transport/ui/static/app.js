// stoa dashboard — Alpine.js state machine
// Field names mirror the contract types from src/transport/ui/types.ts.

const VALID_FILTERS = new Set(["active", "all", "pending", "claimed", "in_progress", "completed", "failed", "blocked"]);

function dashboard() {
  return {
    // State — mirrors ApiTask[], ApiAgent[], ApiChannelEntry[], ApiWiki[], ApiSynthesisStaleness[]
    tasks: [],
    agents: [],
    channelEntries: [],
    wikis: [],
    syntheses: [],

    // Staleness drawer open/closed state
    stalenessOpen: false,

    // Derived / display state
    activeTaskCount: 0,
    vaultBaseName: "",
    lastRefreshDelta: "—",
    pollPaused: false,
    loading: false,

    // Task status filter — presentational only; does not affect activeTaskCount
    taskStatusFilter: "active",

    // Spawn modal state
    spawnOpen: false,
    spawnSpecialty: "",
    spawnSuggestions: [],
    spawnSelected: null,
    spawnLoading: false,

    // Channel composer state
    composer: {
      open: false,
      channel: "",
      content: "",
      sending: false,
    },

    // Pinned views — [{name, hash}], persisted in localStorage
    pinnedViews: [],
    pinning: false,

    // Watchdog ribbon — thresholds (minutes) for considering a task stuck
    stuckThresholds: { claimed: 15, in_progress: 45 },

    // Internal
    _lastFetchAt: null,
    _pollHandle: null,
    _deltaHandle: null,

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    async boot() {
      this.hydrateFromHash();
      this.pinnedViews = this.loadPinnedViews();
      window.addEventListener("hashchange", () => this.hydrateFromHash());

      // Watch taskStatusFilter and sync to URL hash on every change
      this.$watch("taskStatusFilter", () => this.syncToHash());

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
        const [healthRes, tasksRes, agentsRes, channelsRes, wikisRes, stalenessRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/tasks"),
          fetch("/api/agents"),
          fetch("/api/channels"),
          fetch("/api/wikis"),
          fetch("/api/syntheses/staleness"),
        ]);

        // Parse all responses in parallel
        const [health, tasks, agents, channelsData, wikis, stalenessData] = await Promise.all([
          healthRes.ok ? healthRes.json() : null,
          tasksRes.ok ? tasksRes.json() : [],
          agentsRes.ok ? agentsRes.json() : [],
          channelsRes.ok ? channelsRes.json() : { channels: [], entries: [] },
          wikisRes.ok ? wikisRes.json() : [],
          stalenessRes.ok ? stalenessRes.json() : { syntheses: [] },
        ]);

        // Apply health data — ApiHealth: { ok, vault, wikis, indexedAt }
        if (health && health.ok) {
          const parts = (health.vault || "").replace(/\\/g, "/").split("/");
          this.vaultBaseName = parts[parts.length - 1] || health.vault || "";
        }

        // Apply tasks — server returns { tasks: ApiTask[], generatedAt } per the contract.
        // Fall back to bare array for forward-compat.
        const taskArr = Array.isArray(tasks) ? tasks : (tasks && Array.isArray(tasks.tasks) ? tasks.tasks : null);
        if (taskArr) {
          this.tasks = taskArr;
          this.activeTaskCount = taskArr.filter(
            (t) => t.status === "pending" || t.status === "claimed" || t.status === "in_progress"
          ).length;
        }

        // Apply agents — server returns { agents: ApiAgent[], generatedAt }.
        const agentArr = Array.isArray(agents) ? agents : (agents && Array.isArray(agents.agents) ? agents.agents : null);
        if (agentArr) {
          this.agents = agentArr;
        }

        // Apply channel entries — server returns { channels, entries }.
        if (channelsData && Array.isArray(channelsData.entries)) {
          this.channelEntries = channelsData.entries;
        } else if (Array.isArray(channelsData)) {
          this.channelEntries = channelsData;
        }

        // Apply wikis — server returns { wikis: ApiWiki[] }.
        const wikiArr = Array.isArray(wikis) ? wikis : (wikis && Array.isArray(wikis.wikis) ? wikis.wikis : null);
        if (wikiArr) {
          this.wikis = wikiArr;
        }

        // Apply syntheses staleness — server returns { syntheses: ApiSynthesisStaleness[], generatedAt }.
        const synthesisArr = stalenessData && Array.isArray(stalenessData.syntheses) ? stalenessData.syntheses : [];
        this.syntheses = synthesisArr;

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
    // Write — Claim task
    // -----------------------------------------------------------------------

    async claim(task) {
      if (task.loading) return;

      // Save previous state for rollback
      const prev = { status: task.status, claimed_by: task.claimed_by };

      // Optimistic update
      task.loading = true;
      task.status = "claimed";

      try {
        const res = await fetch(`/api/tasks/${task.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expected_updated: task.updated }),
        });

        if (res.status === 409) {
          // Already claimed by someone else — rollback
          task.status = prev.status;
          task.claimed_by = prev.claimed_by;
          this.flashError(task, "already claimed");
          return;
        }

        if (res.status === 412) {
          // OCC mismatch — task changed since we last loaded — rollback
          task.status = prev.status;
          task.claimed_by = prev.claimed_by;
          this.flashError(task, "task changed — refresh");
          return;
        }

        if (!res.ok) {
          // Other error — rollback
          task.status = prev.status;
          task.claimed_by = prev.claimed_by;
          this.flashError(task, "claim failed");
          return;
        }

        // Success — update with server response
        const updated = await res.json();
        task.status = updated.status || "claimed";
        task.claimed_by = updated.claimed_by || task.claimed_by;
        task.updated = updated.updated || task.updated;
      } catch (err) {
        // Network error — rollback
        task.status = prev.status;
        task.claimed_by = prev.claimed_by;
        this.flashError(task, "network error");
        console.error("[stoa] claim error:", err);
      } finally {
        task.loading = false;
      }
    },

    // -----------------------------------------------------------------------
    // Write — Channel composer
    // -----------------------------------------------------------------------

    openComposer(channel) {
      this.composer.open = true;
      if (channel) {
        this.composer.channel = channel;
      }
    },

    async post() {
      if (this.composer.sending) return;
      if (!this.composer.content.trim()) return;

      this.composer.sending = true;

      // Optimistic prepend
      const optimisticEntry = {
        id: `opt-${Date.now()}`,
        channel: this.composer.channel,
        wiki: "",
        author: "me",
        ts: new Date().toISOString(),
        excerpt: this.composer.content,
        pageId: "",
      };
      this.channelEntries.unshift(optimisticEntry);

      try {
        const res = await fetch(`/api/channels/${encodeURIComponent(this.composer.channel)}/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: this.composer.content }),
        });

        if (!res.ok) {
          // Rollback optimistic entry
          this.channelEntries = this.channelEntries.filter((e) => e.id !== optimisticEntry.id);
          console.error("[stoa] post error:", res.status);
          return;
        }

        // Replace optimistic entry with server response
        const created = await res.json();
        const idx = this.channelEntries.findIndex((e) => e.id === optimisticEntry.id);
        if (idx !== -1) {
          this.channelEntries.splice(idx, 1, created);
        }

        // Clear composer content on success (keep open)
        this.composer.content = "";
      } catch (err) {
        // Network error — rollback optimistic entry
        this.channelEntries = this.channelEntries.filter((e) => e.id !== optimisticEntry.id);
        console.error("[stoa] post error:", err);
      } finally {
        this.composer.sending = false;
      }
    },

    // -----------------------------------------------------------------------
    // Write — Spawn agent modal
    // -----------------------------------------------------------------------

    openSpawn() {
      this.spawnOpen = true;
      this.spawnSpecialty = "";
      this.spawnSuggestions = [];
      this.spawnSelected = null;
      this.spawnLoading = false;
    },

    closeSpawn() {
      this.spawnOpen = false;
    },

    async suggest() {
      this.spawnSuggestions = [];
      try {
        const params = this.spawnSpecialty
          ? `?specialty=${encodeURIComponent(this.spawnSpecialty)}`
          : "";
        const res = await fetch(`/api/agents/suggest${params}`);
        if (res.ok) {
          const data = await res.json();
          this.spawnSuggestions = Array.isArray(data) ? data : (data.suggestions || []);
        } else {
          this.flashError(this, `Suggest failed (${res.status})`);
        }
      } catch (err) {
        console.error("[stoa] suggest error:", err);
        this.flashError(this, "Suggest request failed");
      }
    },

    async register() {
      if (this.spawnLoading) return;
      if (!this.spawnSelected) return;

      this.spawnLoading = true;
      try {
        const res = await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_species: this.spawnSelected }),
        });

        if (!res.ok) {
          console.error("[stoa] register error:", res.status);
          this.flashError(this, `Register failed (${res.status})`);
          return;
        }

        const response = await res.json();
        // Server returns { ok, agent, stadium_registered } — push the agent object
        const newAgent = response.agent ?? response;
        this.agents.push(newAgent);
        this.closeSpawn();
      } catch (err) {
        console.error("[stoa] register error:", err);
      } finally {
        this.spawnLoading = false;
      }
    },

    // -----------------------------------------------------------------------
    // Filter
    // -----------------------------------------------------------------------

    get filteredTasks() {
      const f = this.taskStatusFilter;
      if (f === "all") return this.tasks;
      if (f === "active") return this.tasks.filter(t => t.status === "pending" || t.status === "claimed" || t.status === "in_progress");
      return this.tasks.filter(t => t.status === f);
    },

    // -----------------------------------------------------------------------
    // Watchdog ribbon — derived stuck tasks list
    // -----------------------------------------------------------------------

    /**
     * Derived list of stuck tasks — recomputed each Alpine cycle from
     * this.tasks + this.channelEntries (no extra fetches).
     * Annotates each row with _stuckMinutes used by the template.
     */
    get stuckTasks() {
      const now = Date.now();
      const out = [];
      for (const t of this.tasks) {
        const threshold = this.stuckThresholds[t.status];
        if (!threshold) continue; // only claimed / in_progress
        if (!t.updated) continue;
        const ageMin = Math.floor((now - Date.parse(t.updated)) / 60000);
        if (ageMin < threshold) continue;
        // For in_progress, also check no channel post on t.channel within the threshold window
        if (t.status === "in_progress" && t.channel) {
          const cutoff = now - threshold * 60000;
          const hasRecent = this.channelEntries.some(e => e.channel === t.channel && Date.parse(e.ts) >= cutoff);
          if (hasRecent) continue;
        }
        t._stuckMinutes = ageMin;   // annotate on the original — Alpine-reactive
        out.push(t);                 // push the original, not a copy
      }
      return out;
    },

    // -----------------------------------------------------------------------
    // Watchdog ribbon — actions
    // -----------------------------------------------------------------------

    /** IMPORTANT: name this `releaseStuckTask` (not `releaseTask`) to avoid
     *  shadowing/colliding with the existing claim methods if they share a namespace. */
    async releaseStuckTask(task) {
      if (task._releaseLoading) return;
      task._releaseLoading = true;
      try {
        const res = await fetch(`/api/tasks/${task.id}/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_updated: task.updated,
            wiki: task.wiki,
            reason: "force-release from dashboard",
          }),
        });
        if (res.status === 409) { this.flashError(task, "not in claimed state"); return; }
        if (res.status === 412) { this.flashError(task, "task changed — refresh"); return; }
        if (!res.ok) { this.flashError(task, "release failed"); return; }
        await this.refresh();
      } finally {
        task._releaseLoading = false;
      }
    },

    async pingChannel(task) {
      if (!task.channel || task._pingLoading) return;
      task._pingLoading = true;
      try {
        await fetch(`/api/channels/${encodeURIComponent(task.channel)}/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `ping: task ${task.id} idle for ${Math.floor((Date.now() - Date.parse(task.updated))/60000)}m — claimed by ${task.claimed_by}`,
          }),
        });
      } finally {
        task._pingLoading = false;
      }
    },

    // -----------------------------------------------------------------------
    // Staleness rail helpers
    // -----------------------------------------------------------------------

    /**
     * Returns a CSS class name based on how stale the synthesis is.
     * freshness-never  — never compiled (lag_days is null)
     * freshness-fresh  — compiled within 30 days
     * freshness-mid    — compiled 30-89 days ago
     * freshness-stale  — compiled 90+ days ago
     */
    freshnessClass(s) {
      if (s.lag_days === null) return "freshness-never";
      if (s.lag_days < 30) return "freshness-fresh";
      if (s.lag_days < 90) return "freshness-mid";
      return "freshness-stale";
    },

    /**
     * Returns a human-readable label for the freshness badge tooltip.
     */
    freshnessLabel(s) {
      if (s.lag_days === null) return "never compiled";
      return `${s.lag_days} days since /synthesize`;
    },

    /**
     * Produces an obsidian:// deep-link URI for a given ApiSynthesisStaleness entry.
     * Mirrors the taskHref / channelHref pattern.
     */
    synthesisHref(s) {
      const vault = encodeURIComponent(this.vaultBaseName);
      const file = encodeURIComponent(`wikis/${s.wiki}/synthesis/${s.id}.md`);
      return `obsidian://open?vault=${vault}&file=${file}`;
    },

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------

    /**
     * Transiently adds a red-flash CSS class to the element matching target._el (if present),
     * or falls back to setting a reactive _errorClass on the target object.
     * The class is removed after a short timeout (transient red flash).
     */
    flashError(target, msg) {
      target._errorMsg = msg;
      // Try DOM classList if target._el is an element reference
      if (target._el && target._el.classList) {
        target._el.classList.add("error-flash");
        if (target._flashTimeout) clearTimeout(target._flashTimeout);
        target._flashTimeout = setTimeout(() => {
          target._el.classList.remove("error-flash");
          target._errorMsg = "";
        }, 3000);
      } else {
        // Reactive fallback — Alpine x-bind:class picks this up
        target._errorClass = "error-flash";
        if (target._flashTimeout) clearTimeout(target._flashTimeout);
        target._flashTimeout = setTimeout(() => {
          target._errorClass = "";
          target._errorMsg = "";
        }, 3000);
      }
    },

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

    /**
     * Produces an obsidian:// deep-link URI for a given ApiChannelEntry.
     * Uses the vaultBaseName resolved from /api/health.
     */
    channelHref(e) {
      const vault = encodeURIComponent(this.vaultBaseName);
      const file = encodeURIComponent(e.pageId);
      return `obsidian://open?vault=${vault}&file=${file}`;
    },

    // -----------------------------------------------------------------------
    // Session state — URL hash serialisation
    // -----------------------------------------------------------------------

    hydrateFromHash() {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const filter = params.get("tasks");
      if (filter && VALID_FILTERS.has(filter)) {
        this.taskStatusFilter = filter;
      }
      // Future fields plug in here.
    },

    syncToHash() {
      const params = new URLSearchParams();
      if (this.taskStatusFilter !== "active") params.set("tasks", this.taskStatusFilter);
      const next = params.toString();
      const target = next ? `#${next}` : "";
      if (window.location.hash !== target) {
        window.history.replaceState(null, "", `${window.location.pathname}${target}`);
      }
    },

    // -----------------------------------------------------------------------
    // Session state — pinned views (localStorage)
    // -----------------------------------------------------------------------

    loadPinnedViews() {
      try { return JSON.parse(localStorage.getItem("stoa.pinnedViews") || "[]"); }
      catch { return []; }
    },

    savePinnedViews() {
      localStorage.setItem("stoa.pinnedViews", JSON.stringify(this.pinnedViews));
    },

    addPin() {
      const name = prompt("Name this view:");
      if (!name) return;
      const hash = window.location.hash.replace(/^#/, "");
      this.pinnedViews.push({ name, hash });
      this.savePinnedViews();
    },

    applyPin(pin) {
      window.location.hash = pin.hash;
    },
  };
}
