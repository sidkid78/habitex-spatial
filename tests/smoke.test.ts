import { describe, expect, it } from 'vitest';

import { PLACEHOLDER } from '../src/index';

describe('scaffold', () => {
  it('compiles and runs the test harness', () => {
    expect(PLACEHOLDER).toBe(true);
  });
});
