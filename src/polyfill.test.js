import { describe, expect, it } from 'vitest';

const nativeNavigator = globalThis.navigator;

await import('./polyfill.js');

describe('navigator polyfill', () => {
  it('preserves the native navigator when Node provides one', () => {
    expect(globalThis.navigator).toBeDefined();

    if (nativeNavigator) {
      expect(globalThis.navigator).toBe(nativeNavigator);
    }
  });
});
