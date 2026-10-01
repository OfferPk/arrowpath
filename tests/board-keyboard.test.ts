import { describe, expect, it } from 'vitest';
import {
  handleBoardKeydown,
  type BoardKeydownEventLike,
  type BoardCellPosition,
} from '../src/ui/board-keyboard';
function dispatch(
  key: string,
  options: { ctrlKey?: boolean; metaKey?: boolean; repeat?: boolean } = {},
) {
  let prevented = false;
  const event: BoardKeydownEventLike = {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    repeat: options.repeat ?? false,
    preventDefault: () => { prevented = true; },
  };
  const focused: BoardCellPosition[] = [];
  let activations = 0;
  const handled = handleBoardKeydown(
    event,
    { x: 1, y: 1 },
    3,
    2,
    (position) => focused.push(position),
    () => { activations += 1; },
  );
  return { handled, wasPrevented: prevented, focused, activations };
}
describe('accessible board keyboard interaction', () => {
  it.each(['Enter', ' ', 'Spacebar'])(
    'explicitly activates the focused cell with %s and prevents native duplicate activation',
    (key) => {
      expect(dispatch(key)).toEqual({
        handled: true,
        wasPrevented: true,
        focused: [],
        activations: 1,
      });
    },
  );
  it('prevents auto-repeat from firing the same focused cell more than once', () => {
    expect(dispatch(' ', { repeat: true })).toEqual({
      handled: true,
      wasPrevented: true,
      focused: [],
      activations: 0,
    });
  });
  it('preserves arrow-key, Home/End, and modified corner navigation', () => {
    expect(dispatch('ArrowRight')).toMatchObject({
      handled: true,
      wasPrevented: true,
      focused: [{ x: 2, y: 1 }],
      activations: 0,
    });
    expect(dispatch('Home')).toMatchObject({
      focused: [{ x: 0, y: 1 }],
    });
    expect(dispatch('ArrowDown')).toMatchObject({
      focused: [{ x: 1, y: 1 }],
    });
    expect(dispatch('Home', { ctrlKey: true })).toMatchObject({
      focused: [{ x: 0, y: 0 }],
    });
    expect(dispatch('End', { metaKey: true })).toMatchObject({
      focused: [{ x: 2, y: 1 }],
    });
  });
  it('leaves unrelated keys to the browser and rejects invalid board positions', () => {
    expect(dispatch('Tab')).toEqual({
      handled: false,
      wasPrevented: false,
      focused: [],
      activations: 0,
    });
    let prevented = false;
    const event: BoardKeydownEventLike = {
      key: 'Enter',
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => { prevented = true; },
    };
    expect(
      handleBoardKeydown(event, { x: 3, y: 0 }, 3, 2, () => {}, () => {}),
    ).toBe(false);
    expect(prevented).toBe(false);
  });
});
