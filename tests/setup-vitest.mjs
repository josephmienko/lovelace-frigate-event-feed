import { afterEach, beforeAll, vi } from "vitest";

beforeAll(() => {
  window.matchMedia ??= (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  });

  URL.createObjectURL ??= vi.fn(() => "blob:mock-image");
  URL.revokeObjectURL ??= vi.fn();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
