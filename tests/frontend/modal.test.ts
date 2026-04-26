import { describe, it, expect, beforeEach } from 'vitest';
import { modal } from '../../app/static/src/modal';
import { loadLang } from '../../app/static/src/i18n';

describe('modal.prompt', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = ''; });

  it('resolves with input value on Save click', async () => {
    const p = modal.prompt('Title', 'default');
    const input = document.querySelector('.modal-input') as HTMLInputElement;
    input.value = 'changed';
    (document.querySelector('.modal-save') as HTMLButtonElement).click();
    expect(await p).toBe('changed');
  });

  it('resolves null on Cancel click', async () => {
    const p = modal.prompt('Title');
    (document.querySelector('.modal-cancel') as HTMLButtonElement).click();
    expect(await p).toBeNull();
  });

  it('Esc resolves null', async () => {
    const p = modal.prompt('Title');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBeNull();
  });

  it('Enter on input confirms with current value', async () => {
    const p = modal.prompt('Title', 'value');
    const input = document.querySelector('.modal-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await p).toBe('value');
  });

  it('click on overlay (not content) closes with null', async () => {
    const p = modal.prompt('Title');
    const overlay = document.querySelector('.modal-overlay') as HTMLElement;
    overlay.click();
    expect(await p).toBeNull();
  });
});

describe('modal.confirm', () => {
  beforeEach(() => { loadLang('ru'); document.body.innerHTML = ''; });

  it('resolves true on OK', async () => {
    const p = modal.confirm('Sure?', 'About to delete');
    (document.querySelector('.modal-save') as HTMLButtonElement).click();
    expect(await p).toBe(true);
  });

  it('resolves false on Cancel', async () => {
    const p = modal.confirm('Sure?', 'About to delete');
    (document.querySelector('.modal-cancel') as HTMLButtonElement).click();
    expect(await p).toBe(false);
  });

  it('Esc resolves false', async () => {
    const p = modal.confirm('Sure?', 'msg');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBe(false);
  });
});
