import { describe, expect, it, vi } from "vitest";

import "../src/frigate-event-feed.js";

const flushAsyncWork = async (iterations = 3) => {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
};

const buildEvents = () => [
  {
    id: "evt-old",
    label: "person",
    start_time: 100,
    end_time: 130,
    camera: "front_door",
    has_clip: true,
    has_snapshot: true,
    data: { top_score: 0.84 },
  },
  {
    id: "evt-new",
    label: "car",
    start_time: 200,
    end_time: 240,
    camera: "driveway",
    has_clip: true,
    has_snapshot: true,
    data: { top_score: 0.93 },
  },
  {
    id: "ignored",
    label: "",
    start_time: 300,
  },
];

const buildHass = (events) => ({
  auth: {
    data: {
      access_token: "test-token",
    },
  },
  states: {
    "input_select.camera_feed": {
      state: "Driveway",
    },
  },
  callWS: vi.fn(async (request) => {
    switch (request.type) {
      case "frigate/events/get":
        return JSON.stringify(events);
      case "frigate/event/retain": {
        const event = events.find((item) => item.id === request.event_id);
        if (event) {
          event.retain_indefinitely = request.retain;
        }
        return { ok: true };
      }
      case "frigate/event/delete": {
        const index = events.findIndex((item) => item.id === request.event_id);
        if (index >= 0) {
          events.splice(index, 1);
        }
        return { ok: true };
      }
      default:
        throw new Error(`Unexpected WS request: ${request.type}`);
    }
  }),
  callService: vi.fn().mockResolvedValue(undefined),
});

const createImageResponse = () => ({
  ok: true,
  headers: {
    get(name) {
      return name === "content-type" ? "image/jpeg" : "";
    },
  },
  blob: async () => new Blob(["image-bytes"], { type: "image/jpeg" }),
});

const mountFeed = async (config = {}, hassEvents = buildEvents()) => {
  const hass = buildHass(hassEvents);
  global.fetch = vi.fn().mockResolvedValue(createImageResponse());

  const feed = document.createElement("frigate-event-feed");
  feed.setConfig({
    title: "Recent Events",
    instance_id: "frigate-main",
    cameras: ["front_door", "driveway"],
    labels: ["person", "car"],
    limit: 12,
    has_clip: true,
    poll_interval_seconds: 45,
    ...config,
  });
  feed.hass = hass;
  document.body.appendChild(feed);

  await flushAsyncWork();

  return { feed, hass, events: hassEvents };
};

describe("frigate-event-feed", () => {
  it("registers the public custom element and card metadata", () => {
    expect(customElements.get("frigate-event-feed")).toBeTypeOf("function");
    const cardTypes = new Set((window.customCards || []).map((card) => card.type));
    expect(cardTypes.has("frigate-event-feed")).toBe(true);
  });

  it("loads Frigate events, sorts them, and fetches previews with the HA access token", async () => {
    const { feed, hass } = await mountFeed();

    expect(hass.callWS).toHaveBeenCalledWith({
      type: "frigate/events/get",
      instance_id: "frigate-main",
      limit: 12,
      has_snapshot: true,
      cameras: ["front_door", "driveway"],
      labels: ["person", "car"],
      has_clip: true,
    });

    const titles = [...feed.shadowRoot.querySelectorAll(".card-title")].map((node) => node.textContent);
    expect(titles).toEqual(["Car detected", "Person detected"]);
    expect(feed.shadowRoot.querySelector(".feed-title")?.textContent).toBe("Recent Events");
    expect(global.fetch).toHaveBeenCalled();
    expect(global.fetch.mock.calls[0][0]).toBe("/api/frigate/frigate-main/thumbnail/evt-new");
    expect(global.fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      headers: {
        Authorization: "Bearer test-token",
      },
    });
  });

  it("toggles retain state through the Frigate websocket API", async () => {
    const sharedEvents = buildEvents();
    const { feed, hass } = await mountFeed({}, sharedEvents);

    const retainButton = feed.shadowRoot.querySelector('[data-event-id="evt-new"][data-action="retain-toggle"]');
    retainButton.click();
    await flushAsyncWork();

    expect(hass.callWS).toHaveBeenCalledWith({
      type: "frigate/event/retain",
      instance_id: "frigate-main",
      event_id: "evt-new",
      retain: true,
    });
    expect(feed._events.find((event) => event.id === "evt-new")?.retain_indefinitely).toBe(true);
  });

  it("confirms and deletes events through the Frigate websocket API", async () => {
    const sharedEvents = buildEvents().slice(0, 1);
    const { feed, hass } = await mountFeed({}, sharedEvents);
    window.confirm = vi.fn(() => true);

    const deleteButton = feed.shadowRoot.querySelector('[data-event-id="evt-old"][data-action="delete"]');
    deleteButton.click();
    await flushAsyncWork();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(hass.callWS).toHaveBeenCalledWith({
      type: "frigate/event/delete",
      instance_id: "frigate-main",
      event_id: "evt-old",
    });
    expect(feed.shadowRoot.querySelectorAll(".event-slot")).toHaveLength(0);
    expect(feed.shadowRoot.textContent).toContain("No detections found.");
  });

  it("plays clips through advanced-camera-card and optionally switches the target input_select first", async () => {
    const { feed, hass } = await mountFeed({
      play_select_entity: "input_select.camera_feed",
      play_select_map: {
        driveway: "Driveway Camera",
      },
    });

    const targetCard = document.createElement("advanced-camera-card");
    targetCard.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 180,
      width: 320,
      height: 180,
      toJSON() {
        return {};
      },
    });
    const playbackSpy = vi.fn().mockResolvedValue(undefined);
    targetCard.addEventListener("advanced-camera-card:action:execution-request", async (event) => {
      await event.detail.actions.callback({
        getViewManager() {
          return {
            setViewByParametersWithNewQuery: playbackSpy,
          };
        },
      });
    });
    document.body.appendChild(targetCard);

    await feed._playEvent(feed._events.find((event) => event.id === "evt-new"));

    expect(hass.callService).toHaveBeenCalledWith("input_select", "select_option", {
      entity_id: "input_select.camera_feed",
      option: "Driveway Camera",
    });
    expect(playbackSpy).toHaveBeenCalledWith({
      params: { view: "clip" },
      queryExecutorOptions: {
        selectResult: {
          id: "evt-new",
        },
      },
      failSafe: true,
    });
  });
});
