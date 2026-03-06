import { describe, it, expect } from 'vitest';
import { Treelet } from '../../src/index';

describe('Treelet', () => {
  it('exposes a semver version string', () => {
    expect(Treelet.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
