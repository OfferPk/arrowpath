export const VEHICLE_JAM_SIZE = 4;
export const VEHICLE_LENGTH = 2;

export type PassengerColor = 'coral' | 'teal' | 'gold';
export type VehicleDirection = 'N' | 'E' | 'S' | 'W';
export type VehicleJamStatus = 'playing' | 'won';

export interface JamVehicle {
  id: string;
  color: PassengerColor;
  x: number;
  y: number;
  direction: VehicleDirection;
}

export interface VehicleJamState {
  vehicles: JamVehicle[];
  passengers: PassengerColor[];
  movesMade: number;
  status: VehicleJamStatus;
}

export type VehicleBlockReason = 'path' | 'passenger' | 'missing' | 'won';

export type VehicleReadiness =
  | { allowed: true }
  | { allowed: false; reason: VehicleBlockReason; blockerId?: string; nextPassenger?: PassengerColor };

export type VehicleDeparture =
  | { ok: true; state: VehicleJamState; departed: JamVehicle }
  | { ok: false; state: VehicleJamState; reason: VehicleBlockReason; blockerId?: string; nextPassenger?: PassengerColor };

const STARTING_VEHICLES: JamVehicle[] = [
  { id: 'coral-van', color: 'coral', x: 0, y: 1, direction: 'E' },
  { id: 'gold-van', color: 'gold', x: 2, y: 1, direction: 'E' },
  { id: 'teal-van', color: 'teal', x: 1, y: 2, direction: 'N' },
];

const STARTING_PASSENGERS: PassengerColor[] = ['gold', 'coral', 'teal'];

const DIRECTION_STEP: Record<VehicleDirection, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

export const VEHICLE_COLOR_LABEL: Record<PassengerColor, string> = {
  coral: 'Coral',
  teal: 'Teal',
  gold: 'Gold',
};

export const VEHICLE_DIRECTION_LABEL: Record<VehicleDirection, string> = {
  N: 'north',
  E: 'east',
  S: 'south',
  W: 'west',
};

export const VEHICLE_DIRECTION_GLYPH: Record<VehicleDirection, string> = {
  N: '↑',
  E: '→',
  S: '↓',
  W: '←',
};

export function createVehicleJamState(): VehicleJamState {
  return {
    vehicles: STARTING_VEHICLES.map((vehicle) => ({ ...vehicle })),
    passengers: [...STARTING_PASSENGERS],
    movesMade: 0,
    status: 'playing',
  };
}

function vehicleCells(vehicle: JamVehicle): { x: number; y: number }[] {
  const step = vehicle.direction === 'E' || vehicle.direction === 'W'
    ? { x: 1, y: 0 }
    : { x: 0, y: 1 };
  return Array.from({ length: VEHICLE_LENGTH }, (_, offset) => ({
    x: vehicle.x + step.x * offset,
    y: vehicle.y + step.y * offset,
  }));
}

function leadingCell(vehicle: JamVehicle): { x: number; y: number } {
  if (vehicle.direction === 'E') return { x: vehicle.x + VEHICLE_LENGTH - 1, y: vehicle.y };
  if (vehicle.direction === 'S') return { x: vehicle.x, y: vehicle.y + VEHICLE_LENGTH - 1 };
  return { x: vehicle.x, y: vehicle.y };
}

export function getVehicleReadiness(state: VehicleJamState, vehicleId: string): VehicleReadiness {
  if (state.status === 'won') return { allowed: false, reason: 'won' };
  const vehicle = state.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) return { allowed: false, reason: 'missing' };

  const occupied = new Map<string, string>();
  for (const other of state.vehicles) {
    if (other.id === vehicle.id) continue;
    for (const cell of vehicleCells(other)) occupied.set(`${cell.x},${cell.y}`, other.id);
  }

  const step = DIRECTION_STEP[vehicle.direction];
  const front = leadingCell(vehicle);
  for (
    let x = front.x + step.x, y = front.y + step.y;
    x >= 0 && x < VEHICLE_JAM_SIZE && y >= 0 && y < VEHICLE_JAM_SIZE;
    x += step.x, y += step.y
  ) {
    const blockerId = occupied.get(`${x},${y}`);
    if (blockerId) return { allowed: false, reason: 'path', blockerId };
  }

  const nextPassenger = state.passengers[0];
  if (!nextPassenger || nextPassenger !== vehicle.color) {
    return { allowed: false, reason: 'passenger', nextPassenger };
  }
  return { allowed: true };
}

/** A vehicle departs only when its full route to the edge is clear and it matches the next passenger. */
export function departVehicle(state: VehicleJamState, vehicleId: string): VehicleDeparture {
  const readiness = getVehicleReadiness(state, vehicleId);
  if (!readiness.allowed) return { ok: false, state, ...readiness };

  const index = state.vehicles.findIndex((vehicle) => vehicle.id === vehicleId);
  const departed = state.vehicles[index]!;
  const passengers = state.passengers.slice(1);
  const next: VehicleJamState = {
    vehicles: state.vehicles
      .filter((vehicle) => vehicle.id !== vehicleId)
      .map((vehicle) => ({ ...vehicle })),
    passengers,
    movesMade: state.movesMade + 1,
    status: state.vehicles.length === 1 && passengers.length === 0 ? 'won' : 'playing',
  };
  return { ok: true, state: next, departed: { ...departed } };
}
