import { describe, expect, it } from 'vitest';
import { resolveAppUrl } from './url.js';

describe('resolveAppUrl', () => {
  it('保留 baseUrl 中的子路径', () => {
    expect(
      resolveAppUrl('https://example.com/welfare/', 'auth/callback').toString()
    ).toBe('https://example.com/welfare/auth/callback');
  });

  it('兼容没有尾斜杠的 baseUrl', () => {
    expect(
      resolveAppUrl('https://example.com/welfare', '/auth/callback').toString()
    ).toBe('https://example.com/welfare/auth/callback');
  });
});
