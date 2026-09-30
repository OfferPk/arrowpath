import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  manageDialogKeydown,
  type DialogFocusTarget,
  type DialogKeydownLike,
} from '../src/ui/dialog';

function fakeTarget(name: string, calls: string[]): DialogFocusTarget & { name: string } {
  return {
    name,
    focus: () => calls.push(name),
  };
}

function event(key: string, shiftKey = false) {
  let prevented = false;
  const value: DialogKeydownLike = {
    key,
    shiftKey,
    preventDefault: () => { prevented = true; },
  };
  return { value, wasPrevented: () => prevented };
}

describe('overlay dialog accessibility regressions', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  for (const id of ['overlay-fail', 'overlay-win', 'overlay-reward']) {
    it(`${id} has modal dialog semantics and a labelled description`, () => {
      const markup = html.match(
        new RegExp(`<div id="${id}"([^>]*)>([\\s\\S]*?)</div>\\s*</div>`),
      );
      expect(markup, `${id} exists`).not.toBeNull();
      const attributes = markup![1]!;
      const contents = markup![2]!;
      expect(attributes).toContain('role="dialog"');
      expect(attributes).toContain('aria-modal="true"');
      expect(attributes).toContain('tabindex="-1"');
      const labelledBy = attributes.match(/aria-labelledby="([^"]+)"/)?.[1];
      const describedBy = attributes.match(/aria-describedby="([^"]+)"/)?.[1];
      expect(labelledBy).toBeTruthy();
      expect(describedBy).toBeTruthy();
      expect(contents).toContain(`id="${labelledBy}"`);
      expect(contents).toContain(`id="${describedBy}"`);
    });
  }

  it('wraps forward Tab from the last control to the first', () => {
    const calls: string[] = [];
    const first = fakeTarget('first', calls);
    const last = fakeTarget('last', calls);
    const key = event('Tab');

    expect(manageDialogKeydown(key.value, [first, last], last)).toBe('trapped');
    expect(key.wasPrevented()).toBe(true);
    expect(calls).toEqual(['first']);
  });

  it('wraps reverse Tab from the first control to the last', () => {
    const calls: string[] = [];
    const first = fakeTarget('first', calls);
    const last = fakeTarget('last', calls);
    const key = event('Tab', true);

    expect(manageDialogKeydown(key.value, [first, last], first)).toBe('trapped');
    expect(key.wasPrevented()).toBe(true);
    expect(calls).toEqual(['last']);
  });

  it('moves unexpected focus back inside the dialog in the matching direction', () => {
    const calls: string[] = [];
    const first = fakeTarget('first', calls);
    const last = fakeTarget('last', calls);
    const outside = fakeTarget('outside', calls);
    const key = event('Tab', true);

    expect(manageDialogKeydown(key.value, [first, last], outside)).toBe('trapped');
    expect(calls).toEqual(['last']);
  });

  it('leaves ordinary in-dialog Tab movement to the browser', () => {
    const calls: string[] = [];
    const first = fakeTarget('first', calls);
    const last = fakeTarget('last', calls);
    const key = event('Tab');

    expect(manageDialogKeydown(key.value, [first, last], first)).toBe('pass');
    expect(key.wasPrevented()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('requests dialog dismissal on Escape and prevents its default action', () => {
    const key = event('Escape');
    expect(manageDialogKeydown(key.value, [], null)).toBe('dismiss');
    expect(key.wasPrevented()).toBe(true);
  });

  it('keeps Tab within a dialog even if it has no focusable controls', () => {
    const key = event('Tab');
    expect(manageDialogKeydown(key.value, [], null)).toBe('trapped');
    expect(key.wasPrevented()).toBe(true);
  });
});
