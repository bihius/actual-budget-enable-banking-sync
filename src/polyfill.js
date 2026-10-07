if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform: 'linux', userAgent: '' },
  });
}
