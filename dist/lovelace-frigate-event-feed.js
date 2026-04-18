/**
 * Built file for the Frigate Event Feed HACS artifact.
 * Edit src/frigate-event-feed.js and rerun npm run build.
 */

class FrigateEventFeed extends HTMLElement {
  static _nextId = 0;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._events = [];
    this._error = "";
    this._loading = false;
    this._lastRefreshAt = 0;
    this._refreshPromise = null;
    this._refreshTimer = null;
    this._expanded = new Set();
    this._imageUrls = new Map();
    this._imageStatus = new Map();
    this._imageRequests = new Map();
    this._pendingActions = new Map();
    this._instanceId = ++FrigateEventFeed._nextId;
    this._boundToggleChange = this._handleToggleChange.bind(this);
    this._boundImageError = this._handleImageError.bind(this);
    this._boundClick = this._handleClick.bind(this);
    this._playingEventId = "";
  }

  connectedCallback() {
    this.shadowRoot.addEventListener("change", this._boundToggleChange);
    this.shadowRoot.addEventListener("click", this._boundClick);
    this.shadowRoot.addEventListener("error", this._boundImageError, true);
    this._queueRefresh(true);
  }

  disconnectedCallback() {
    this.shadowRoot.removeEventListener("change", this._boundToggleChange);
    this.shadowRoot.removeEventListener("click", this._boundClick);
    this.shadowRoot.removeEventListener("error", this._boundImageError, true);
    if (this._refreshTimer) {
      window.clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    for (const request of this._imageRequests.values()) {
      request.abort();
    }
    this._imageRequests.clear();
    for (const url of this._imageUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this._imageUrls.clear();
    this._imageStatus.clear();
  }

  setConfig(config) {
    const rawTabs = config || {};
    const cameras = Array.isArray(rawTabs.cameras)
      ? rawTabs.cameras
      : rawTabs.camera
        ? [rawTabs.camera]
        : [];
    const labels = Array.isArray(rawTabs.labels)
      ? rawTabs.labels
      : rawTabs.label
        ? [rawTabs.label]
        : [];

    this._config = {
      instanceId: String(rawTabs.instance_id || "frigate"),
      title: rawTabs.title ? String(rawTabs.title) : "",
      cameras: cameras.map((camera) => String(camera)).filter(Boolean),
      labels: labels.map((label) => String(label)).filter(Boolean),
      limit: Number(rawTabs.limit || 12),
      minCardWidth: String(rawTabs.min_card_width || "280px"),
      maxCardWidth: String(rawTabs.max_card_width || "250px"),
      media: rawTabs.media === "snapshot" ? "snapshot" : "thumbnail",
      showCamera:
        rawTabs.show_camera === true || rawTabs.show_camera === false
          ? rawTabs.show_camera
          : "auto",
      hasClip:
        rawTabs.has_clip === true || rawTabs.has_clip === false
          ? rawTabs.has_clip
          : undefined,
      hasSnapshot:
        rawTabs.has_snapshot === true || rawTabs.has_snapshot === false
          ? rawTabs.has_snapshot
          : true,
      playSelectEntity: rawTabs.play_select_entity
        ? String(rawTabs.play_select_entity)
        : "",
      playSelectOption: rawTabs.play_select_option
        ? String(rawTabs.play_select_option)
        : "",
      playSelectMap:
        rawTabs.play_select_map &&
        typeof rawTabs.play_select_map === "object" &&
        !Array.isArray(rawTabs.play_select_map)
          ? Object.fromEntries(
              Object.entries(rawTabs.play_select_map)
                .map(([key, value]) => [String(key), String(value)])
                .filter(([key, value]) => key && value)
            )
          : {},
      playTargetSelector: rawTabs.play_target_selector
        ? String(rawTabs.play_target_selector)
        : "advanced-camera-card",
      pollIntervalMs: Math.max(Number(rawTabs.poll_interval_seconds || 45) * 1000, 5000),
    };

    this._render();
    this._queueRefresh(true);
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    this._queueRefresh();
  }

  getCardSize() {
    return Math.max(3, Math.ceil(((this._events?.length || 6) + 1) / 2));
  }

  static getStubConfig() {
    return {
      type: "custom:frigate-event-feed",
      instance_id: "frigate",
      limit: 12,
    };
  }

  _handleToggleChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.classList.contains("card-toggle")) {
      return;
    }
    const { eventId } = input.dataset;
    if (!eventId) {
      return;
    }
    if (input.checked) {
      this._expanded.add(eventId);
    } else {
      this._expanded.delete(eventId);
    }
  }

  _handleImageError(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("card-image")) {
      return;
    }
    const frame = image.closest(".card-media");
    if (frame) {
      frame.classList.add("image-failed");
    }
  }

  _handleClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const playButton = target.closest(".play-button");
    if (playButton) {
      event.preventDefault();
      event.stopPropagation();
      const { eventId } = playButton.dataset;
      if (!eventId) {
        return;
      }
      const detection = this._events.find((item) => item.id === eventId);
      if (!detection || !this._canPlayEvent(detection)) {
        return;
      }
      this._playEvent(detection).catch((error) => {
        console.error("Failed to open Frigate clip in advanced-camera-card", error);
      });
      return;
    }

    const actionButton = target.closest(".event-action");
    if (!actionButton) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const { eventId, action } = actionButton.dataset;
    if (!eventId || !action) {
      return;
    }
    const detection = this._events.find((item) => item.id === eventId);
    if (!detection) {
      return;
    }
    if (action === "retain-toggle") {
      this._toggleRetain(detection).catch((error) => {
        console.error("Failed to toggle Frigate retain state", error);
      });
      return;
    }
    if (action === "delete") {
      this._deleteEvent(detection).catch((error) => {
        console.error("Failed to delete Frigate event", error);
      });
    }
  }

  _queueRefresh(force = false) {
    if (!this.isConnected || !this._config || !this._hass) {
      return;
    }
    const due = Date.now() - this._lastRefreshAt >= this._config.pollIntervalMs;
    if (force || due) {
      this._refreshEvents();
    }
    if (!this._refreshTimer) {
      this._refreshTimer = window.setTimeout(() => {
        this._refreshTimer = null;
        this._queueRefresh(true);
      }, this._config.pollIntervalMs);
    }
  }

  async _refreshEvents() {
    if (!this._hass || !this._config || this._refreshPromise) {
      return this._refreshPromise;
    }

    this._loading = true;
    this._error = "";
    this._render();

    const request = {
      type: "frigate/events/get",
      instance_id: this._config.instanceId,
      limit: this._config.limit,
      has_snapshot: this._config.hasSnapshot,
    };

    if (this._config.cameras.length) {
      request.cameras = this._config.cameras;
    }
    if (this._config.labels.length) {
      request.labels = this._config.labels;
    }
    if (this._config.hasClip !== undefined) {
      request.has_clip = this._config.hasClip;
    }

    this._refreshPromise = this._hass.callWS(request)
      .then((response) => {
        const parsed = typeof response === "string" ? JSON.parse(response) : response;
        this._events = Array.isArray(parsed)
          ? parsed
              .filter((event) => event?.id && event?.label && event?.start_time)
              .sort((left, right) => (right.start_time || 0) - (left.start_time || 0))
          : [];
        this._expanded = new Set(
          [...this._expanded].filter((eventId) => this._events.some((event) => event.id === eventId))
        );
        this._syncImageState();
        this._lastRefreshAt = Date.now();
        this._primeImages();
      })
      .catch((error) => {
        console.error("Failed to load Frigate events", error);
        this._events = [];
        this._error = error?.message || "Failed to load detections";
      })
      .finally(() => {
        this._loading = false;
        this._refreshPromise = null;
        this._render();
      });

    return this._refreshPromise;
  }

  _syncImageState() {
    const activeIds = new Set(this._events.map((event) => event.id));
    for (const [eventId, request] of this._imageRequests.entries()) {
      if (!activeIds.has(eventId)) {
        request.abort();
        this._imageRequests.delete(eventId);
      }
    }
    for (const [eventId, url] of this._imageUrls.entries()) {
      if (!activeIds.has(eventId)) {
        URL.revokeObjectURL(url);
        this._imageUrls.delete(eventId);
      }
    }
    for (const eventId of [...this._imageStatus.keys()]) {
      if (!activeIds.has(eventId)) {
        this._imageStatus.delete(eventId);
      }
    }
  }

  _getAccessToken() {
    return (
      this._hass?.auth?.data?.access_token ||
      this._hass?.auth?.data?.accessToken ||
      this._hass?.auth?.accessToken ||
      this._hass?.connection?.options?.auth?.access_token ||
      ""
    );
  }

  _imageCandidates(event) {
    return [
      this._thumbnailUrl(event),
      this._snapshotUrl(event),
    ];
  }

  _primeImages() {
    for (const event of this._events) {
      if (this._imageUrls.has(event.id) || this._imageRequests.has(event.id)) {
        continue;
      }
      this._fetchImage(event);
    }
  }

  async _fetchImage(event) {
    if (!this._hass || !event?.id) {
      return;
    }
    const controller = new AbortController();
    this._imageRequests.set(event.id, controller);
    this._imageStatus.set(event.id, "loading");
    const token = this._getAccessToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      for (const candidate of this._imageCandidates(event)) {
        const response = await fetch(candidate, {
          method: "GET",
          headers,
          credentials: "same-origin",
          signal: controller.signal,
        });
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.startsWith("image/")) {
          continue;
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/") || !blob.size) {
          continue;
        }
        const previous = this._imageUrls.get(event.id);
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        this._imageUrls.set(event.id, URL.createObjectURL(blob));
        this._imageStatus.set(event.id, "ready");
        this._render();
        return;
      }
      this._imageStatus.set(event.id, "failed");
      this._render();
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error("Failed to load event preview", event.id, error);
        this._imageStatus.set(event.id, "failed");
        this._render();
      }
    } finally {
      this._imageRequests.delete(event.id);
    }
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  _slug(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  _titleCase(value) {
    return String(value || "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  _showCameraInSubtitle() {
    if (!this._config) {
      return false;
    }
    if (typeof this._config.showCamera === "boolean") {
      return this._config.showCamera;
    }
    return this._config.cameras.length !== 1;
  }

  _eventTitle(event) {
    const label = event.sub_label || event.label || "object";
    return `${this._titleCase(label)} detected`;
  }

  _eventConfidence(event) {
    const scores = [
      event?.data?.top_score,
      event?.data?.score,
      event?.top_score,
    ].filter((value) => typeof value === "number");
    if (!scores.length) {
      return "Unknown";
    }
    return `${Math.round(Math.max(...scores) * 100)}% confidence`;
  }

  _eventDuration(event) {
    const start = Number(event?.start_time || 0);
    const end = Number(event?.end_time || Date.now() / 1000);
    const totalSeconds = Math.max(Math.round(end - start), 0);
    if (totalSeconds < 60) {
      return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
      return seconds
        ? `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`
        : `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes
      ? `${hours} hour${hours === 1 ? "" : "s"} ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"}`
      : `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  _eventSubtitle(event) {
    const startedAt = new Date(Number(event.start_time || 0) * 1000);
    const now = new Date();
    const startDay = new Date(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate());
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((nowDay - startDay) / 86400000);
    const timeText = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(startedAt);

    let when = "";
    if (dayDiff === 0) {
      when = `Today, ${timeText}`;
    } else if (dayDiff === 1) {
      when = `Yesterday, ${timeText}`;
    } else {
      when = new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(startedAt);
    }

    if (this._showCameraInSubtitle() && event.camera) {
      return `${this._titleCase(event.camera)} · ${when}`;
    }
    return when;
  }

  _thumbnailUrl(event) {
    const base = `/api/frigate/${encodeURIComponent(this._config.instanceId)}`;
    const route = this._config.media === "snapshot" ? "snapshot" : "thumbnail";
    return `${base}/${route}/${encodeURIComponent(event.id)}`;
  }

  _snapshotUrl(event) {
    return `/api/frigate/${encodeURIComponent(this._config.instanceId)}/snapshot/${encodeURIComponent(event.id)}`;
  }

  _normalizeLookupKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^camera\./, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  _canPlayEvent(event) {
    return Boolean(event?.id) && event?.has_clip !== false;
  }

  _isActionPending(eventId, action) {
    return this._pendingActions.get(String(eventId || "")) === action;
  }

  _setPendingAction(eventId, action = "") {
    const key = String(eventId || "");
    if (!key) {
      return;
    }
    if (action) {
      this._pendingActions.set(key, action);
    } else {
      this._pendingActions.delete(key);
    }
    this._render();
  }

  async _toggleRetain(event) {
    if (!this._hass || !event?.id || this._isActionPending(event.id, "retain")) {
      return;
    }
    const retain = !(event.retain_indefinitely === true);
    this._setPendingAction(event.id, "retain");
    try {
      await this._hass.callWS({
        type: "frigate/event/retain",
        instance_id: this._config.instanceId,
        event_id: String(event.id),
        retain,
      });
      event.retain_indefinitely = retain;
      this._queueRefresh(true);
    } finally {
      this._setPendingAction(event.id, "");
    }
  }

  async _deleteEvent(event) {
    if (!this._hass || !event?.id || this._isActionPending(event.id, "delete")) {
      return;
    }
    const title = this._eventTitle(event);
    const subtitle = this._eventSubtitle(event);
    if (!window.confirm(`Delete ${title} (${subtitle}) permanently?`)) {
      return;
    }
    this._setPendingAction(event.id, "delete");
    try {
      await this._hass.callWS({
        type: "frigate/event/delete",
        instance_id: this._config.instanceId,
        event_id: String(event.id),
      });
      this._expanded.delete(event.id);
      const imageRequest = this._imageRequests.get(event.id);
      if (imageRequest) {
        imageRequest.abort();
        this._imageRequests.delete(event.id);
      }
      const imageUrl = this._imageUrls.get(event.id);
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
        this._imageUrls.delete(event.id);
      }
      this._imageStatus.delete(event.id);
      this._events = this._events.filter((item) => item.id !== event.id);
    } finally {
      this._setPendingAction(event.id, "");
    }
  }

  _resolvePlaySelectOption(event) {
    if (this._config.playSelectOption) {
      return this._config.playSelectOption;
    }
    const playMap = this._config.playSelectMap || {};
    if (!Object.keys(playMap).length) {
      return "";
    }
    const candidates = [
      event?.camera,
      String(event?.camera || "").replace(/^camera\./, ""),
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (playMap[candidate]) {
        return playMap[candidate];
      }
      const normalizedCandidate = this._normalizeLookupKey(candidate);
      for (const [key, value] of Object.entries(playMap)) {
        if (this._normalizeLookupKey(key) === normalizedCandidate) {
          return value;
        }
      }
    }
    return "";
  }

  _sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  _findDeepMatches(selector, root = document) {
    const matches = [];
    const seen = new Set();

    const visit = (node) => {
      if (!node || seen.has(node)) {
        return;
      }
      seen.add(node);

      if (node instanceof Element) {
        if (node.matches(selector)) {
          matches.push(node);
        }
        if (node.shadowRoot) {
          visit(node.shadowRoot);
        }
        if (node.tagName === "SLOT") {
          for (const assigned of node.assignedElements({ flatten: true })) {
            visit(assigned);
          }
        }
        for (const child of node.children) {
          visit(child);
        }
        return;
      }

      if (node instanceof Document) {
        if (node.documentElement) {
          visit(node.documentElement);
        }
        return;
      }

      if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
        for (const child of node.children) {
          visit(child);
        }
      }
    };

    visit(root);
    return matches;
  }

  _isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    let current = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : current.parentElement;
    }
    return true;
  }

  async _waitForPlayTarget(selector, timeoutMs = 4000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const matches = this._findDeepMatches(selector).filter((element) => this._isVisible(element));
      if (matches.length) {
        return matches[0];
      }
      await this._sleep(100);
    }
    return null;
  }

  async _requestClipPlayback(targetCard, event) {
    const eventId = String(event.id);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => (value) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        callback(value);
      };
      const resolveOnce = finish(resolve);
      const rejectOnce = finish(reject);
      const timeoutId = window.setTimeout(() => {
        rejectOnce(new Error("Timed out waiting for advanced-camera-card callback"));
      }, 2500);

      const request = new CustomEvent("advanced-camera-card:action:execution-request", {
        bubbles: true,
        composed: true,
        cancelable: true,
        detail: {
          actions: {
            action: "fire-dom-event",
            advanced_camera_card_action: "__INTERNAL_CALLBACK_ACTION__",
            callback: async (api) => {
              try {
                const viewManager = api?.getViewManager?.();
                if (!viewManager) {
                  throw new Error("advanced-camera-card view manager unavailable");
                }
                const payload = {
                  params: { view: "clip" },
                  queryExecutorOptions: {
                    selectResult: {
                      id: eventId,
                    },
                  },
                  failSafe: true,
                };
                if (typeof viewManager.setViewByParametersWithNewQuery === "function") {
                  await viewManager.setViewByParametersWithNewQuery(payload);
                } else if (typeof viewManager.setViewByParametersWithExistingQuery === "function") {
                  await viewManager.setViewByParametersWithExistingQuery(payload);
                } else if (typeof viewManager.setViewByParameters === "function") {
                  await viewManager.setViewByParameters({ view: "clip" });
                } else {
                  throw new Error("advanced-camera-card does not expose a compatible view API");
                }
                resolveOnce();
              } catch (error) {
                rejectOnce(error);
              }
            },
          },
        },
      });

      targetCard.dispatchEvent(request);
    });
  }

  async _playEvent(event) {
    if (!this._hass || !this._config || !this._canPlayEvent(event)) {
      return;
    }

    this._playingEventId = event.id;
    this._render();

    try {
      const option = this._resolvePlaySelectOption(event);
      if (option && this._config.playSelectEntity) {
        const currentState = this._hass.states?.[this._config.playSelectEntity]?.state || "";
        if (currentState !== option) {
          await this._hass.callService("input_select", "select_option", {
            entity_id: this._config.playSelectEntity,
            option,
          });
          await this._sleep(150);
        }
      }

      const targetCard = await this._waitForPlayTarget(this._config.playTargetSelector);
      if (!targetCard) {
        throw new Error(`No visible play target found for selector: ${this._config.playTargetSelector}`);
      }

      await this._requestClipPlayback(targetCard, event);
    } finally {
      if (this._playingEventId === event.id) {
        this._playingEventId = "";
        this._render();
      }
    }
  }

  _renderLoadingSkeleton() {
    return Array.from({ length: Math.min(this._config?.limit || 6, 6) }, (_, index) => `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton-media"></div>
        <div class="skeleton-content">
          <div class="skeleton-line skeleton-line-title"></div>
          <div class="skeleton-line skeleton-line-subtitle"></div>
        </div>
      </div>
    `).join("");
  }

  _renderEventCard(event, index) {
    const inputId = `frigate-event-feed-${this._instanceId}-${index}-${this._slug(event.id)}`;
    const checked = this._expanded.has(event.id) ? " checked" : "";
    const title = this._eventTitle(event);
    const subtitle = this._eventSubtitle(event);
    const confidence = this._eventConfidence(event);
    const duration = this._eventDuration(event);
    const imageUrl = this._imageUrls.get(event.id) || "";
    const imageStatus = this._imageStatus.get(event.id) || "loading";
    const showPlayButton = this._canPlayEvent(event);
    const playStateClass = this._playingEventId === event.id ? " is-playing" : "";
    const retainPending = this._isActionPending(event.id, "retain");
    const deletePending = this._isActionPending(event.id, "delete");
    const retainIndefinitely = event.retain_indefinitely === true;
    const retainActionIcon = retainIndefinitely ? "mdi:pin-off" : "mdi:pin";
    const retainActionLabel = retainIndefinitely ? "Auto-delete" : "Retain indefinitely";
    const retainActionTitle = retainIndefinitely
      ? "Restore normal retention for this event"
      : "Retain this event indefinitely";

    return `
      <div class="event-slot">
        <input
          id="${this._escape(inputId)}"
          class="card-toggle"
          type="checkbox"
          data-event-id="${this._escape(event.id)}"${checked}
        >
        <label class="m3-card" for="${this._escape(inputId)}">
          <div class="card-media">
            ${showPlayButton ? `
              <button
                class="play-button${playStateClass}"
                type="button"
                data-event-id="${this._escape(event.id)}"
                aria-label="Play clip for ${this._escape(title)}"
                title="Play clip"
              >
                <ha-icon class="play-icon" icon="mdi:play"></ha-icon>
              </button>
            ` : ""}
            ${imageUrl ? `
              <img
                class="card-image"
                src="${this._escape(imageUrl)}"
                alt="${this._escape(title)}"
                loading="lazy"
              >
            ` : ""}
            <div class="image-fallback${imageStatus === "failed" ? " visible" : ""}">
              ${imageStatus === "failed" ? "No preview" : "Loading preview"}
            </div>
          </div>
          <div class="card-content">
            <h3 class="card-title">${this._escape(title)}</h3>
            <p class="card-subtitle">${this._escape(subtitle)}</p>
            <div class="expand-info">
              <div class="info-row">
                <ha-icon class="info-icon" icon="mdi:percent"></ha-icon>
                <span>${this._escape(confidence)}</span>
              </div>
              <div class="info-row">
                <ha-icon class="info-icon" icon="mdi:timer-outline"></ha-icon>
                <span>${this._escape(duration)}</span>
              </div>
              <div class="card-actions">
                <button
                  class="event-action retain-action${retainPending ? " is-busy" : ""}"
                  type="button"
                  data-event-id="${this._escape(event.id)}"
                  data-action="retain-toggle"
                  aria-label="${this._escape(retainActionLabel)}"
                  title="${this._escape(retainActionTitle)}"
                  ${retainPending || deletePending ? "disabled" : ""}
                >
                  <ha-icon class="action-icon" icon="${this._escape(retainActionIcon)}"></ha-icon>
                  <span>${this._escape(retainPending ? "Saving..." : retainActionLabel)}</span>
                </button>
                <button
                  class="event-action delete-action${deletePending ? " is-busy" : ""}"
                  type="button"
                  data-event-id="${this._escape(event.id)}"
                  data-action="delete"
                  aria-label="Delete permanently"
                  title="Delete permanently"
                  ${retainPending || deletePending ? "disabled" : ""}
                >
                  <ha-icon class="action-icon" icon="mdi:delete-forever"></ha-icon>
                  <span>${deletePending ? "Deleting..." : "Delete"}</span>
                </button>
              </div>
            </div>
          </div>
        </label>
      </div>
    `;
  }

  _render() {
    if (!this._config) {
      return;
    }

    const content = this._error
      ? `<div class="state-message error">${this._escape(this._error)}</div>`
      : this._loading && !this._events.length
        ? `<div class="feed-grid">${this._renderLoadingSkeleton()}</div>`
        : this._events.length
          ? `<div class="feed-grid">${this._events.map((event, index) => this._renderEventCard(event, index)).join("")}</div>`
        : `<div class="state-message">No detections found.</div>`;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: none;
          align-self: stretch;
          justify-self: stretch;
          --m3-feed-min-card-width: ${this._escape(this._config.minCardWidth)};
          --m3-feed-max-card-width: ${this._escape(this._config.maxCardWidth)};
          --m3-feed-gap: 8px;
          --m3-feed-radius: 12px;
          --m3-feed-padding-inline: 16px;
          --m3-feed-padding-block: 16px;
          --m3-feed-surface: var(--md-sys-color-surface, var(--ha-card-background, var(--card-background-color)));
          --m3-feed-surface-strong: color-mix(in srgb, var(--m3-feed-surface) 92%, var(--md-sys-color-outline-variant, rgba(127, 127, 127, 0.24)));
          --m3-feed-on-surface: var(--md-sys-color-on-surface, var(--primary-text-color));
          --m3-feed-on-surface-variant: var(--md-sys-color-on-surface-variant, var(--secondary-text-color));
          --m3-feed-outline: var(--md-sys-color-outline-variant, rgba(127, 127, 127, 0.24));
          --m3-feed-shadow: none;
          --m3-feed-state-opacity-hover: 0.08;
          --m3-feed-state-opacity-active: 0.12;
          --m3-feed-heading-size: 1.375rem;
          --m3-feed-heading-line-height: 1.75rem;
          --m3-feed-heading-weight: 400;
          --m3-feed-state-size: 0.875rem;
          --m3-feed-state-line-height: 1.25rem;
          --m3-feed-state-weight: 400;
        }

        * {
          box-sizing: border-box;
        }

        ha-card {
          display: block;
          width: 100%;
          min-width: 0;
          max-width: none;
          background: transparent;
          border: 0;
          box-shadow: none;
          padding: 0;
          overflow: visible;
        }

        .feed-header {
          margin: 0 0 var(--m3-feed-gap);
        }

        .feed-title {
          margin: 0;
          color: var(--m3-feed-on-surface);
          font-size: var(--m3-feed-heading-size);
          font-weight: var(--m3-feed-heading-weight);
          line-height: var(--m3-feed-heading-line-height);
        }

        .feed-grid {
          display: grid;
          grid-template-columns: repeat(
            auto-fit,
            minmax(min(100%, var(--m3-feed-max-card-width)), var(--m3-feed-max-card-width))
          );
          gap: var(--m3-feed-gap);
          align-items: start;
          justify-content: center;
        }

        .event-slot,
        .skeleton-card {
          min-width: 0;
        }

        .event-slot {
          width: 100%;
          container-type: inline-size;
          --m3-card-title-size: 16px;
          --m3-card-title-line-height: 24px;
          --m3-card-title-weight: 500;
          --m3-card-body-size: 14px;
          --m3-card-body-line-height: 20px;
          --m3-card-body-weight: 400;
        }

        .card-toggle {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }

        .m3-card,
        .skeleton-card {
          display: block;
          width: 100%;
          background: var(--m3-feed-surface);
          border: 1px solid var(--m3-feed-outline);
          border-radius: var(--m3-feed-radius);
          overflow: hidden;
          box-shadow: var(--m3-feed-shadow);
          text-align: start;
        }

        .m3-card {
          position: relative;
          cursor: pointer;
          transition:
            transform 0.25s cubic-bezier(0.2, 0, 0, 1),
            box-shadow 0.25s cubic-bezier(0.2, 0, 0, 1),
            background-color 0.2s ease;
          will-change: transform;
        }

        .m3-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: currentColor;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.12s linear;
        }

        .m3-card:hover::before {
          opacity: var(--m3-feed-state-opacity-hover);
        }

        .m3-card:active {
          transform: scale(0.985);
        }

        .m3-card:active::before {
          opacity: var(--m3-feed-state-opacity-active);
        }

        .card-media,
        .skeleton-media {
          position: relative;
          aspect-ratio: 10 / 7;
          width: 100%;
          overflow: hidden;
          background: var(--m3-feed-surface-strong);
        }

        .play-button {
          position: absolute;
          inset-block-start: 12px;
          inset-inline-end: 12px;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border: 0;
          border-radius: 999px;
          background: color-mix(
            in srgb,
            var(--m3-feed-surface) 78%,
            var(--m3-feed-on-surface) 22%
          );
          color: var(--m3-feed-on-surface);
          cursor: pointer;
          transition:
            transform 0.2s cubic-bezier(0.2, 0, 0, 1),
            background-color 0.2s ease,
            box-shadow 0.2s ease;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
          -webkit-tap-highlight-color: transparent;
        }

        .play-button:hover {
          background: color-mix(
            in srgb,
            var(--m3-feed-surface) 70%,
            var(--m3-feed-on-surface) 30%
          );
        }

        .play-button:active {
          transform: scale(0.96);
        }

        .play-button.is-playing {
          opacity: 0.72;
        }

        .play-icon {
          width: 24px;
          height: 24px;
          --mdc-icon-size: 24px;
          color: currentColor;
        }

        .card-image {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          background: var(--m3-feed-surface-strong);
        }

        .card-media.image-failed .card-image {
          display: none;
        }

        .image-fallback {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--m3-feed-on-surface-variant);
          font-size: var(--m3-card-body-size);
          font-weight: var(--m3-card-body-weight);
          line-height: var(--m3-card-body-line-height);
          letter-spacing: 0;
          text-transform: uppercase;
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        .image-fallback.visible {
          opacity: 1;
        }

        .card-content,
        .skeleton-content {
          padding: var(--m3-feed-padding-block) var(--m3-feed-padding-inline);
        }

        .card-title {
          margin: 0;
          color: var(--m3-feed-on-surface);
          font-size: var(--m3-card-title-size);
          font-weight: var(--m3-card-title-weight);
          line-height: var(--m3-card-title-line-height);
          letter-spacing: 0;
        }

        .card-subtitle {
          margin: 4px 0 0;
          color: var(--m3-feed-on-surface-variant);
          font-size: var(--m3-card-body-size);
          font-weight: var(--m3-card-body-weight);
          line-height: var(--m3-card-body-line-height);
          font-variant-numeric: tabular-nums;
        }

        .expand-info {
          max-height: 0;
          opacity: 0;
          overflow: hidden;
          transition:
            max-height 0.28s cubic-bezier(0.2, 0, 0, 1),
            opacity 0.18s ease,
            margin-top 0.28s cubic-bezier(0.2, 0, 0, 1);
          display: grid;
          gap: 12px;
        }

        .card-toggle:checked + .m3-card .expand-info {
          max-height: 220px;
          opacity: 1;
          margin-top: 12px;
        }

        .info-row {
          display: flex;
          align-items: center;
          gap: 14px;
          color: var(--m3-feed-on-surface);
          min-width: 0;
        }

        .info-row span {
          font-size: var(--m3-card-body-size);
          font-weight: var(--m3-card-body-weight);
          line-height: var(--m3-card-body-line-height);
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }

        .info-icon {
          flex: 0 0 auto;
          width: 24px;
          height: 24px;
          color: var(--m3-feed-on-surface-variant);
          --mdc-icon-size: 24px;
        }

        .card-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 8px;
        }

        .event-action {
          appearance: none;
          border: 1px solid var(--m3-feed-outline);
          background: var(--m3-feed-surface);
          color: var(--m3-feed-on-surface);
          min-height: 40px;
          padding: 0 14px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: var(--m3-card-body-size);
          font-weight: 500;
          line-height: var(--m3-card-body-line-height);
          transition:
            transform 0.18s cubic-bezier(0.2, 0, 0, 1),
            background-color 0.18s ease,
            border-color 0.18s ease,
            color 0.18s ease,
            opacity 0.18s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .event-action:hover {
          background: color-mix(in srgb, var(--m3-feed-surface) 92%, var(--m3-feed-on-surface) 8%);
        }

        .event-action:active {
          transform: scale(0.98);
        }

        .event-action:disabled {
          cursor: default;
          opacity: 0.7;
        }

        .action-icon {
          width: 18px;
          height: 18px;
          color: currentColor;
          --mdc-icon-size: 18px;
        }

        .delete-action {
          background: color-mix(in srgb, var(--error-color, #ba1a1a) 16%, var(--m3-feed-surface));
          border-color: color-mix(in srgb, var(--error-color, #ba1a1a) 44%, var(--m3-feed-outline));
          color: var(--error-color, #ba1a1a);
        }

        .delete-action:hover {
          background: color-mix(in srgb, var(--error-color, #ba1a1a) 22%, var(--m3-feed-surface));
        }

        .state-message {
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          color: var(--m3-feed-on-surface-variant);
          font-size: var(--m3-feed-state-size);
          font-weight: var(--m3-feed-state-weight);
          line-height: var(--m3-feed-state-line-height);
          padding: var(--m3-feed-padding-block) var(--m3-feed-padding-inline);
          border-radius: var(--m3-feed-radius);
          background: var(--m3-feed-surface);
          border: 1px solid var(--m3-feed-outline);
        }

        .state-message.error {
          color: var(--error-color, #f28b82);
        }

        .skeleton-card {
          overflow: hidden;
        }

        .skeleton-media,
        .skeleton-line {
          background:
            linear-gradient(
              90deg,
              color-mix(in srgb, var(--m3-feed-surface-strong) 94%, transparent) 0%,
              color-mix(in srgb, var(--m3-feed-surface-strong) 78%, white) 50%,
              color-mix(in srgb, var(--m3-feed-surface-strong) 94%, transparent) 100%
            );
          background-size: 200% 100%;
          animation: shimmer 1.4s linear infinite;
        }

        .skeleton-line {
          height: 16px;
          border-radius: 999px;
        }

        .skeleton-line + .skeleton-line {
          margin-top: 12px;
        }

        .skeleton-line-title {
          width: 58%;
          height: 24px;
        }

        .skeleton-line-subtitle {
          width: 42%;
        }

        @keyframes shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }

        @container (min-width: 360px) {
          .event-slot {
            --m3-card-title-size: 22px;
            --m3-card-title-line-height: 28px;
            --m3-card-title-weight: 400;
            --m3-card-body-size: 16px;
            --m3-card-body-line-height: 24px;
            --m3-card-body-weight: 400;
          }
        }

        @media (max-width: 599px) {
          .feed-grid {
            grid-template-columns: 1fr;
          }

          .m3-card,
          .skeleton-card {
            display: grid;
            grid-template-columns: 96px minmax(0, 1fr);
            align-items: stretch;
          }

          .card-media,
          .skeleton-media {
            aspect-ratio: auto;
            width: 96px;
            min-height: 96px;
            height: 100%;
          }

          .card-content,
          .skeleton-content {
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 16px;
          }

          .card-toggle:checked + .m3-card .expand-info {
            max-height: 160px;
          }

          .event-slot {
            --m3-card-title-size: 16px;
            --m3-card-title-line-height: 24px;
            --m3-card-title-weight: 500;
            --m3-card-body-size: 14px;
            --m3-card-body-line-height: 20px;
            --m3-card-body-weight: 400;
          }
        }
      </style>
      <ha-card>
        ${this._config.title ? `
          <div class="feed-header">
            <h2 class="feed-title">${this._escape(this._config.title)}</h2>
          </div>
        ` : ""}
        ${content}
      </ha-card>
    `;
  }
}

const ExistingFrigateEventFeed = customElements.get("frigate-event-feed");
if (ExistingFrigateEventFeed) {
  const sourceProto = FrigateEventFeed.prototype;
  const targetProto = ExistingFrigateEventFeed.prototype;
  for (const name of Object.getOwnPropertyNames(sourceProto)) {
    if (name === "constructor") {
      continue;
    }
    Object.defineProperty(
      targetProto,
      name,
      Object.getOwnPropertyDescriptor(sourceProto, name)
    );
  }
  ExistingFrigateEventFeed.getStubConfig =
    FrigateEventFeed.getStubConfig;
} else {
  customElements.define(
    "frigate-event-feed",
    FrigateEventFeed
  );
}

window.customCards = window.customCards || [];
if (!window.customCards.find((card) => card.type === "frigate-event-feed")) {
  window.customCards.push({
    type: "frigate-event-feed",
    name: "Frigate Event Feed",
    description: "Expandable Frigate event feed for Lovelace dashboards with optional advanced-camera-card interop",
  });
}
