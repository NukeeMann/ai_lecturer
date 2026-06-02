// Shared test setup. jsdom does not implement ResizeObserver, which AppLogo
// (rendered by the extend wizard page, among others) uses on mount. Provide a
// no-op polyfill so component tests can render without a ReferenceError. The
// guard keeps node-environment suites untouched and respects any real impl.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
