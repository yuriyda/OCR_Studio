import { describe, it, expect } from 'vitest';
import { iconForFilename, formatBytes } from '../../app/static/src/icons';

describe('iconForFilename', () => {
  it('returns 📕 for pdf', () => expect(iconForFilename('a.pdf')).toBe('📕'));
  it('returns 🖼 for image extensions', () => {
    expect(iconForFilename('a.png')).toBe('🖼');
    expect(iconForFilename('B.JPG')).toBe('🖼');
    expect(iconForFilename('x.tiff')).toBe('🖼');
    expect(iconForFilename('y.webp')).toBe('🖼');
  });
  it('returns 📄 fallback for unknown', () => expect(iconForFilename('x.xyz')).toBe('📄'));
  it('returns 📄 for no extension', () => expect(iconForFilename('readme')).toBe('📄'));
});

describe('formatBytes', () => {
  it('formats bytes', () => expect(formatBytes(500)).toBe('500 Б'));
  it('formats KB', () => expect(formatBytes(1500)).toBe('1.5 КБ'));
  it('formats MB', () => expect(formatBytes(2_500_000)).toBe('2.4 МБ'));
  it('formats GB', () => expect(formatBytes(3_000_000_000)).toBe('2.8 ГБ'));
  it('handles 0', () => expect(formatBytes(0)).toBe('0 Б'));
  it('handles boundary 1023 → bytes', () => expect(formatBytes(1023)).toBe('1023 Б'));
  it('handles boundary 1024 → KB', () => expect(formatBytes(1024)).toBe('1.0 КБ'));
});
