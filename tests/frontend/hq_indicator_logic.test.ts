/**
 * Tests for the isAnyHqActive helper exported from main.ts.
 *
 * Maintenance notes:
 * - isAnyHqActive must be kept in sync with SettingsResponse in api.ts.
 * - These tests guard against regressions where the dot color semantics
 *   revert to using only hq_mode (master switch), ignoring partial activation.
 */

import { describe, it, expect } from 'vitest';
import { isAnyHqActive } from '../../app/static/src/state';

const base = {
  hq_mode: false,
  hq_orientation: false,
  hq_unwarping: false,
  hq_textline: false,
  hq_chart: false,
  hq_seal: false,
  onboarding_seen: true,
};

describe('isAnyHqActive', () => {
  it('returns false when all flags are off', () => {
    expect(isAnyHqActive(base)).toBe(false);
  });

  it('returns true when master hq_mode is on (all-on shortcut)', () => {
    expect(isAnyHqActive({ ...base, hq_mode: true })).toBe(true);
  });

  it('returns true when only hq_orientation is on', () => {
    expect(isAnyHqActive({ ...base, hq_orientation: true })).toBe(true);
  });

  it('returns true when only hq_unwarping is on', () => {
    expect(isAnyHqActive({ ...base, hq_unwarping: true })).toBe(true);
  });

  it('returns true when only hq_textline is on', () => {
    expect(isAnyHqActive({ ...base, hq_textline: true })).toBe(true);
  });

  it('returns true when only hq_chart is on', () => {
    expect(isAnyHqActive({ ...base, hq_chart: true })).toBe(true);
  });

  it('returns true when only hq_seal is on', () => {
    expect(isAnyHqActive({ ...base, hq_seal: true })).toBe(true);
  });

  it('returns true when exactly 3 of 5 sub-models are on (hq_mode still false)', () => {
    expect(isAnyHqActive({ ...base, hq_orientation: true, hq_textline: true, hq_seal: true })).toBe(true);
  });
});
