import { describe, it, expect, beforeEach } from 'vitest';
import * as state from '../../app/static/src/state';
import { openSettingsModal } from '../../app/static/src/settings_modal';

describe('settings modal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div>';
    state.reset();
    state.setSettings({
      hq_mode: false, hq_orientation: false, hq_unwarping: false,
      hq_textline: false, hq_chart: false, hq_seal: false,
      onboarding_seen: false,
    });
    state.setRecommendation({ hq_mode: 'on', reason: 'RTX 4090 (16 GB)', warning: null });
  });

  it('renders all 5 model cards in advanced disclosure', () => {
    openSettingsModal({ mode: 'settings' });
    const cards = document.querySelectorAll('[data-model-card]');
    expect(cards.length).toBe(5);
  });

  it('main switch toggles all 5 checkboxes', () => {
    openSettingsModal({ mode: 'settings' });
    const main = document.querySelector('[data-main-switch]') as HTMLInputElement;
    main.click();
    const checks = document.querySelectorAll('[data-model-card] input[type=checkbox]');
    checks.forEach((c) => expect((c as HTMLInputElement).checked).toBe(true));
  });

  it('unchecking any individual flips main to OFF', () => {
    openSettingsModal({ mode: 'settings' });
    const main = document.querySelector('[data-main-switch]') as HTMLInputElement;
    main.click();  // turn all on
    const first = document.querySelector('[data-model-card] input[type=checkbox]') as HTMLInputElement;
    first.click();  // uncheck one
    expect(main.checked).toBe(false);
  });

  it('renders onboarding wrapper with GPU recommendation', () => {
    openSettingsModal({ mode: 'onboarding' });
    expect(document.querySelector('[data-onboarding-banner]')).not.toBeNull();
    expect(document.body.textContent).toContain('RTX 4090');
  });

  it('Apply disabled when queue non-empty', () => {
    openSettingsModal({ mode: 'settings', queueSize: 1 });
    const apply = document.querySelector('[data-action="apply-settings"]') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });
});
