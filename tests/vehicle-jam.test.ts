import { describe, expect, it, vi } from 'vitest';
import {
  createVehicleJamState,
  departVehicle,
  getVehicleReadiness,
  type VehicleJamState,
} from '../src/game/vehicle-jam';
import { getVehicleCardViews, renderVehicleJamBoard } from '../src/ui/vehicle-jam';

describe('vehicle-jam rules', () => {
  it('blocks vehicles behind the next vehicle on their facing lane', () => {
    const state = createVehicleJamState();
    expect(getVehicleReadiness(state, 'gold-van')).toEqual({ allowed: true });
    expect(getVehicleReadiness(state, 'coral-van')).toEqual({
      allowed: false,
      reason: 'path',
      blockerId: 'gold-van',
    });
    expect(getVehicleReadiness(state, 'teal-van')).toEqual({
      allowed: false,
      reason: 'path',
      blockerId: 'coral-van',
    });
  });

  it('requires the leading passenger color even when a vehicle path is clear', () => {
    const state = createVehicleJamState();
    const wrongFlow: VehicleJamState = { ...state, passengers: ['teal', 'gold', 'coral'] };
    expect(getVehicleReadiness(wrongFlow, 'gold-van')).toEqual({
      allowed: false,
      reason: 'passenger',
      nextPassenger: 'teal',
    });
    const rejected = departVehicle(wrongFlow, 'gold-van');
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(wrongFlow);
  });

  it('solves the included example in Gold, Coral, Teal passenger order', () => {
    let state = createVehicleJamState();
    const original = structuredClone(state);
    for (const [id, color] of [
      ['gold-van', 'gold'],
      ['coral-van', 'coral'],
      ['teal-van', 'teal'],
    ] as const) {
      const result = departVehicle(state, id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.departed.color).toBe(color);
      state = result.state;
    }
    expect(original).toEqual(createVehicleJamState());
    expect(state).toEqual({ vehicles: [], passengers: [], movesMade: 3, status: 'won' });
    expect(departVehicle(state, 'gold-van')).toMatchObject({ ok: false, reason: 'won' });
  });

  it('leaves board and passenger state unchanged after a blocked selection', () => {
    const state = createVehicleJamState();
    const result = departVehicle(state, 'coral-van');
    expect(result).toMatchObject({ ok: false, reason: 'path', blockerId: 'gold-van' });
    expect(result.state).toBe(state);
    expect(state.vehicles).toHaveLength(3);
    expect(state.passengers).toEqual(['gold', 'coral', 'teal']);
  });
});

describe('vehicle-jam accessible board view', () => {
  it('places directional vans in the 4×4 grid and explains their route blockers', () => {
    const views = getVehicleCardViews(createVehicleJamState());
    expect(views).toHaveLength(3);
    expect(views.find((view) => view.id === 'gold-van')).toMatchObject({
      color: 'gold',
      axis: 'horizontal',
      label: 'Gold →',
      gridColumn: '3 / span 2',
      gridRow: '2 / span 1',
      canDepart: true,
    });
    expect(views.find((view) => view.id === 'coral-van')?.ariaLabel).toContain(
      'blocked by the Gold vehicle',
    );
    expect(views.find((view) => view.id === 'teal-van')).toMatchObject({
      axis: 'vertical',
      label: 'Teal ↑',
      gridColumn: '2 / span 1',
      gridRow: '3 / span 2',
      canDepart: false,
    });
    expect(views.find((view) => view.id === 'teal-van')?.ariaLabel).toContain(
      'next passenger is Gold',
    );
  });

  it('updates the board view after each matching passenger boards', () => {
    let state = createVehicleJamState();
    state = departVehicle(state, 'gold-van').state;
    const afterGold = getVehicleCardViews(state);
    expect(afterGold).toHaveLength(2);
    expect(afterGold.find((view) => view.id === 'coral-van')?.canDepart).toBe(true);
    expect(afterGold.find((view) => view.id === 'teal-van')?.ariaLabel).toContain(
      'blocked by the Coral vehicle',
    );
  });

  it('renders accessible directional vehicle buttons and dispatches selection', () => {
    type FakeButton = {
      type: string;
      className: string;
      dataset: Record<string, string>;
      style: Record<string, string>;
      title: string;
      textContent: string;
      attributes: Record<string, string>;
      handlers: Record<string, (event: Event) => void>;
      setAttribute: (name: string, value: string) => void;
      addEventListener: (name: string, handler: EventListenerOrEventListenerObject) => void;
    };
    const buttons: FakeButton[] = [];
    const fakeDocument = {
      createDocumentFragment: () => ({
        children: [] as FakeButton[],
        appendChild(button: FakeButton) { this.children.push(button); return button; },
      }),
      createElement: () => {
        const button: FakeButton = {
          type: '',
          className: '',
          dataset: {},
          style: {},
          title: '',
          textContent: '',
          attributes: {},
          handlers: {},
          setAttribute(name, value) { this.attributes[name] = value; },
          addEventListener(name, handler) {
            this.handlers[name] = typeof handler === 'function'
              ? handler as (event: Event) => void
              : (event) => handler.handleEvent(event);
          },
        };
        buttons.push(button);
        return button;
      },
    };
    let rendered: FakeButton[] = [];
    const container = {
      replaceChildren(fragment: { children: FakeButton[] }) { rendered = fragment.children; },
    };
    const onSelect = vi.fn();
    vi.stubGlobal('document', fakeDocument);
    try {
      renderVehicleJamBoard(container as unknown as HTMLElement, createVehicleJamState(), onSelect);
      expect(rendered).toHaveLength(3);
      expect(buttons[0]).toMatchObject({
        type: 'button',
        className: 'vehicle-card vehicle-coral axis-horizontal',
      });
      expect(buttons[0]!.dataset).toMatchObject({ vehicleId: 'coral-van', canDepart: 'false' });
      expect(buttons[0]!.style).toMatchObject({ gridColumn: '1 / span 2', gridRow: '2 / span 1' });
      expect(buttons[0]!.attributes['aria-label']).toContain('blocked by the Gold vehicle');
      buttons[1]!.handlers.click!(new Event('click'));
      expect(onSelect).toHaveBeenCalledWith('gold-van');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
