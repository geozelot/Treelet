import { describe, it, expect } from 'vitest';
import { Treelet } from '../../src/index';
import { version as packageVersion } from '../../package.json';

describe('Treelet', () => {
  it('exposes a semver version string', () => {
    expect(Treelet.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('keeps Treelet.version in sync with package.json', () => {
    expect(Treelet.version).toBe(packageVersion);
  });
});
