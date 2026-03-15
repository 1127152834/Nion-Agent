import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// streamdown imports KaTeX CSS in its ESM build. In unit tests (jsdom),
// we do not need the stylesheet, and Node cannot load it as an ESM module.
vi.mock("katex/dist/katex.min.css", () => ({}));

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// use-stick-to-bottom relies on ResizeObserver for measuring container layout.
// JSDOM doesn't ship it by default; unit tests only need a no-op implementation.
if (!globalThis.ResizeObserver) {
  class NoopResizeObserver {
    observe() {
      /* noop */
    }
    unobserve() {
      /* noop */
    }
    disconnect() {
      /* noop */
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = NoopResizeObserver;
}

// Some UI dependencies probe <canvas> at module init; JSDOM throws by default.
// Unit tests don't need real canvas rendering, so return null to keep tests quiet/stable.
if (typeof HTMLCanvasElement !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => null;
}
