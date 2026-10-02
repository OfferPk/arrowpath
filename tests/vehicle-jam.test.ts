import { describe, expect, it, vi } from 'vitest';
import {
  createVehicleJamState,
  departVehicle,
  getVehicleReadiness,
  PARKING_BAY_COUNT,
  PASSENGER_CAPACITY,
  VEHICLE_JAM_SIZE,
  type VehicleJamState,
} from '../src/game/vehicle-jam';
import {
  getVehicleCardViews,
  renderPassengerQueue,
  renderVehicleJamBoard,
  renderVehicleJamParking,
} from '../src/ui/vehicle-jam';

function boardWithPassengerQueue(passengers: VehicleJamState['passengers']): VehicleJamState {
  return { ...createVehicleJamState(), passengers };
}

function solveAuthoredPuzzle(): VehicleJamState {
  let state = createVehicleJamState();
  for (const id of [
    'gold-east',
    'coral-east',
    'teal-north',
    'gold-north',
    'coral-west',
    'teal-west',
    'gold-west',
    'coral-south',
  ]) {
    const result = departVehicle(state, id);
    if (!result.ok) throw new Error(`Authored solution unexpectedly blocked at ${id}: ${result.reason}`);
    state = result.state;
  }
  return state;
}

describe('Passenger Jam rules', () => {
  it('creates a separate, authored 6x6 puzzle with eight buses, two bays, and a 16-passenger queue', () => {
    const state = createVehicleJamState();
    expect(VEHICLE_JAM_SIZE).toBe(6);
    expect(state.vehicles).toHaveLength(8);
    expect(state.passengers).toHaveLength(16);
    expect(state.parking).toHaveLength(PARKING_BAY_COUNT);
    expect(state.parking).toEqual([null, null]);
    expect(state.movesMade).toBe(0);
    expect(state.status).toBe('playing');

    const cellOwners = new Set<string>();
    for (const vehicle of state.vehicles) {
      const horizontal = vehicle.direction === 'E' || vehicle.direction === 'W';
      for (let offset = 0; offset < 2; offset += 1) {
        const x = vehicle.x + (horizontal ? offset : 0);
        const y = vehicle.y + (horizontal ? 0 : offset);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(VEHICLE_JAM_SIZE);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(VEHICLE_JAM_SIZE);
        expect(cellOwners.has(`${x},${y}`)).toBe(false);
        cellOwners.add(`${x},${y}`);
      }
    }
  });

  it('allows any clear-route bus to park, even when its color is not next in the queue', () => {
    const state = createVehicleJamState();
    expect(state.passengers[0]).toBe('coral');
    expect(getVehicleReadiness(state, 'gold-east')).toEqual({ allowed: true });

    const result = departVehicle(state, 'gold-east');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.vehicles.some((vehicle) => vehicle.id === 'gold-east')).toBe(false);
    expect(result.state.parking[0]).toMatchObject({ id: 'gold-east', passengersOnboard: 0 });
    expect(result.state.passengers).toEqual(state.passengers);
    expect(result.state.movesMade).toBe(1);
    expect(state.vehicles).toHaveLength(8);
    expect(state.parking).toEqual([null, null]);
  });

  it('blocks a bus whose forward ray reaches another bus and leaves all state unchanged', () => {
    const state = createVehicleJamState();
    expect(getVehicleReadiness(state, 'coral-east')).toEqual({
      allowed: false,
      reason: 'path',
      blockerId: 'gold-east',
    });
    const result = departVehicle(state, 'coral-east');
    expect(result).toMatchObject({ ok: false, reason: 'path', blockerId: 'gold-east' });
    expect(result.state).toBe(state);
    expect(state.movesMade).toBe(0);
    expect(state.parking).toEqual([null, null]);
  });

  it('boards only matching passengers from the queue front and retains a partially filled bus', () => {
    let state = boardWithPassengerQueue(['gold', 'coral', 'coral', 'gold']);
    const result = departVehicle(state, 'gold-east');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardings).toEqual([
      { vehicleId: 'gold-east', color: 'gold', passengersOnboard: 1 },
    ]);
    expect(result.state.passengers).toEqual(['coral', 'coral', 'gold']);
    expect(result.state.parking[0]).toMatchObject({ id: 'gold-east', passengersOnboard: 1 });
    expect(result.autoDeparted).toEqual([]);
  });

  it('automatically clears a two-seat bus when the next two passengers match and opens its bay', () => {
    let state = boardWithPassengerQueue(['gold', 'gold', 'coral']);
    const result = departVehicle(state, 'gold-east');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardings).toEqual([
      { vehicleId: 'gold-east', color: 'gold', passengersOnboard: 1 },
      { vehicleId: 'gold-east', color: 'gold', passengersOnboard: 2 },
    ]);
    expect(result.autoDeparted).toEqual([
      { ...state.vehicles[0], passengersOnboard: PASSENGER_CAPACITY },
    ]);
    expect(result.state.parking[0]).toBeNull();
    expect(result.state.passengers).toEqual(['coral']);
    expect(result.state.movesMade).toBe(1);
  });

  it('boards the oldest matching parked bus before the newly arriving bus, deterministically freeing bays', () => {
    const initial = createVehicleJamState();
    const gold = initial.vehicles.find((vehicle) => vehicle.id === 'gold-east')!;
    const state: VehicleJamState = {
      ...initial,
      vehicles: initial.vehicles.filter((vehicle) => vehicle.id !== 'gold-east'),
      passengers: ['gold', 'coral', 'coral'],
      parking: [{ ...gold, passengersOnboard: 1 }, null],
    };
    const result = departVehicle(state, 'coral-east');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardings.map((boarding) => boarding.vehicleId)).toEqual([
      'gold-east', 'coral-east', 'coral-east',
    ]);
    expect(result.autoDeparted.map((bus) => bus.id)).toEqual(['gold-east', 'coral-east']);
    expect(result.state.parking).toEqual([null, null]);
    expect(result.state.passengers).toEqual([]);
  });

  it('boards the lowest-numbered matching bay first when two parked buses share the queue color', () => {
    const initial = createVehicleJamState();
    const firstGold = initial.vehicles.find((vehicle) => vehicle.id === 'gold-east')!;
    const state: VehicleJamState = {
      ...initial,
      vehicles: initial.vehicles.filter((vehicle) => !['gold-east', 'teal-north', 'coral-east'].includes(vehicle.id)),
      passengers: ['gold', 'gold'],
      parking: [{ ...firstGold, passengersOnboard: 1 }, null],
    };
    const result = departVehicle(state, 'gold-north');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardings.map((boarding) => boarding.vehicleId)).toEqual(['gold-east', 'gold-north']);
    expect(result.autoDeparted.map((bus) => bus.id)).toEqual(['gold-east']);
    expect(result.state.parking[0]).toBeNull();
    expect(result.state.parking[1]).toMatchObject({ id: 'gold-north', passengersOnboard: 1 });
  });

  it('rejects a clear-route dispatch when both bays are full without changing board, queue, bays, or moves', () => {
    let state = boardWithPassengerQueue(['teal', 'teal', 'coral']);
    const first = departVehicle(state, 'gold-east');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = departVehicle(first.state, 'coral-east');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.parking.every(Boolean)).toBe(true);
    expect(getVehicleReadiness(second.state, 'teal-north')).toEqual({
      allowed: false,
      reason: 'parking',
    });
    const before = structuredClone(second.state);
    const rejected = departVehicle(second.state, 'teal-north');
    expect(rejected).toMatchObject({ ok: false, reason: 'parking' });
    expect(rejected.state).toBe(second.state);
    expect(second.state).toEqual(before);
  });

  it('opens dependent board routes after their blockers park and never mutates the prior state', () => {
    let state = createVehicleJamState();
    const original = structuredClone(state);
    expect(getVehicleReadiness(state, 'coral-east')).toMatchObject({ allowed: false, reason: 'path' });
    const gold = departVehicle(state, 'gold-east');
    expect(gold.ok).toBe(true);
    if (!gold.ok) return;
    state = gold.state;
    expect(getVehicleReadiness(state, 'coral-east')).toEqual({ allowed: true });
    const coral = departVehicle(state, 'coral-east');
    expect(coral.ok).toBe(true);
    if (!coral.ok) return;
    state = coral.state;
    expect(getVehicleReadiness(state, 'teal-north')).toEqual({ allowed: true });
    expect(original).toEqual(createVehicleJamState());
    expect(original.vehicles.map((vehicle) => vehicle.id)).toContain('gold-east');
  });

  it('solves the authored queue and board in its documented route-opening order', () => {
    const state = solveAuthoredPuzzle();
    expect(state).toEqual({
      vehicles: [],
      passengers: [],
      parking: [null, null],
      movesMade: 8,
      status: 'won',
    });
    expect(departVehicle(state, 'gold-east')).toMatchObject({ ok: false, reason: 'won' });
  });

  it('restarts entirely in memory by creating a pristine state', () => {
    const played = solveAuthoredPuzzle();
    expect(played.status).toBe('won');
    const restarted = createVehicleJamState();
    expect(restarted).toEqual(createVehicleJamState());
    expect(restarted).not.toBe(played);
    expect(restarted.vehicles).not.toBe(played.vehicles);
  });

  it('does not mutate browser storage or depend on Campaign/Daily persistence APIs', () => {
    const storageRead = vi.fn();
    const storageWrite = vi.fn();
    const { document } = createFakeDocument();
    vi.stubGlobal('localStorage', { getItem: storageRead, setItem: storageWrite });
    vi.stubGlobal('sessionStorage', { getItem: storageRead, setItem: storageWrite });
    vi.stubGlobal('document', document);
    try {
      const state = createVehicleJamState();
      const result = departVehicle(state, 'gold-east');
      expect(result.ok).toBe(true);
      if (result.ok) {
        renderPassengerQueue(createFakeContainer().element, result.state);
        renderVehicleJamBoard(createFakeContainer().element, result.state, vi.fn());
        renderVehicleJamParking(createFakeContainer().element, result.state);
      }
      expect(storageRead).not.toHaveBeenCalled();
      expect(storageWrite).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

interface FakeNode {
  type: string;
  className: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  title: string;
  textContent: string;
  attributes: Record<string, string>;
  children: FakeNode[];
  handlers: Record<string, (event: Event) => void>;
  setAttribute: (name: string, value: string) => void;
  appendChild: (node: FakeNode) => FakeNode;
  addEventListener: (name: string, handler: EventListenerOrEventListenerObject) => void;
}

function createFakeDocument(): { document: Document; nodes: FakeNode[] } {
  const nodes: FakeNode[] = [];
  const createNode = (): FakeNode => {
    const node: FakeNode = {
      type: '',
      className: '',
      dataset: {},
      style: {},
      title: '',
      textContent: '',
      attributes: {},
      children: [],
      handlers: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(name, handler) {
        this.handlers[name] = typeof handler === 'function'
          ? handler as (event: Event) => void
          : (event) => handler.handleEvent(event);
      },
    };
    nodes.push(node);
    return node;
  };
  return {
    document: {
      createDocumentFragment: createNode,
      createElement: createNode,
    } as unknown as Document,
    nodes,
  };
}

function createFakeContainer(): { element: HTMLElement; rendered: FakeNode[] } {
  let rendered: FakeNode[] = [];
  return {
    element: {
      replaceChildren(fragment: FakeNode) { rendered = fragment.children; },
    } as unknown as HTMLElement,
    get rendered() { return rendered; },
  };
}

describe('Passenger Jam accessible UI state', () => {
  it('renders all eight direction-aware buses in the six-by-six grid and explains blocked routes', () => {
    const views = getVehicleCardViews(createVehicleJamState());
    expect(views).toHaveLength(8);
    expect(views.find((view) => view.id === 'gold-east')).toMatchObject({
      color: 'gold',
      axis: 'horizontal',
      label: '→ G',
      gridColumn: '4 / span 2',
      gridRow: '1 / span 1',
      canPark: true,
    });
    expect(views.find((view) => view.id === 'coral-east')?.ariaLabel).toContain('blocked by the Gold bus');
    expect(views.find((view) => view.id === 'teal-north')).toMatchObject({
      axis: 'vertical',
      gridColumn: '2 / span 1',
      gridRow: '2 / span 2',
      canPark: false,
    });
  });

  it('explains a full parking lot on otherwise clear-route bus controls', () => {
    let state = boardWithPassengerQueue(['teal', 'teal', 'coral']);
    const first = departVehicle(state, 'gold-east');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const second = departVehicle(state, 'coral-east');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const tealBus = getVehicleCardViews(second.state).find((view) => view.id === 'teal-north');
    expect(tealBus?.canPark).toBe(false);
    expect(tealBus?.ariaLabel).toContain('both parking bays are full');
  });

  it('renders queue order, marks the next passenger, and announces exact color and position', () => {
    const { document } = createFakeDocument();
    const previous = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    try {
      const container = createFakeContainer();
      renderPassengerQueue(container.element, createVehicleJamState());
      expect(container.rendered).toHaveLength(16);
      expect(container.rendered[0]).toMatchObject({
        className: 'passenger-token vehicle-coral passenger-next',
        textContent: 'C',
        dataset: { queueIndex: '0' },
      });
      expect(container.rendered[0]!.attributes['aria-label']).toBe('Coral passenger 1, next to board');
      expect(container.rendered[1]!.className).toBe('passenger-token vehicle-coral');
      expect(container.rendered[2]!.textContent).toBe('G');
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
    }
  });

  it('renders empty and occupied bays with passenger counts and an arrival animation class', () => {
    const { document } = createFakeDocument();
    const previous = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    try {
      let state = createVehicleJamState();
      const result = departVehicle(state, 'gold-east');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
      const container = createFakeContainer();
      renderVehicleJamParking(container.element, state, {
        vehicle: result.dispatched,
        bayIndex: result.bayIndex,
        droveOff: false,
        passengersOnboard: 0,
      });
      expect(container.rendered).toHaveLength(2);
      expect(container.rendered[0]!.attributes['aria-label']).toBe('Bay 1: Gold bus, 0 of 2 passengers');
      expect(container.rendered[0]!.children[1]!.className).toContain('just-arrived');
      expect(container.rendered[0]!.children[1]!.textContent).toBe('→ Gold · 0/2');
      expect(container.rendered[1]!.attributes['aria-label']).toBe('Bay 2: open');
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
    }
  });

  it('renders a just-filled bus driving out of its bay after the queue boards it', () => {
    const { document } = createFakeDocument();
    const previous = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    try {
      const state = boardWithPassengerQueue(['gold', 'gold']);
      const result = departVehicle(state, 'gold-east');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const container = createFakeContainer();
      renderVehicleJamParking(container.element, result.state, {
        vehicle: result.dispatched,
        bayIndex: result.bayIndex,
        droveOff: true,
        passengersOnboard: 2,
      });
      expect(container.rendered[0]!.attributes['aria-label']).toBe('Bay 1: open');
      expect(container.rendered[0]!.children[2]!.className).toContain('parking-transit');
      expect(container.rendered[0]!.children[2]!.textContent).toBe('→ Gold · 2/2');
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
    }
  });

  it('keeps blocked vehicles selectable so the UI can announce a reason without altering the game state', () => {
    const { document } = createFakeDocument();
    const previous = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    try {
      const state = createVehicleJamState();
      const container = createFakeContainer();
      const onSelect = vi.fn();
      renderVehicleJamBoard(container.element, state, onSelect);
      expect(container.rendered).toHaveLength(8);
      expect(container.rendered[1]!.dataset).toMatchObject({ vehicleId: 'coral-east', canPark: 'false' });
      expect(container.rendered[1]!.attributes['aria-label']).toContain('blocked by the Gold bus');
      container.rendered[1]!.handlers['click']!(new Event('click'));
      expect(onSelect).toHaveBeenCalledWith('coral-east');
      expect(state.movesMade).toBe(0);
      expect(state.vehicles).toHaveLength(8);
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
    }
  });
});
