export const VEHICLE_JAM_SIZE = 6;
export const VEHICLE_LENGTH = 2;
export const PASSENGER_CAPACITY = 2;
export const PARKING_BAY_COUNT = 2;

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

export interface ParkedJamVehicle extends JamVehicle {
  passengersOnboard: number;
}

export interface VehicleJamState {
  vehicles: JamVehicle[];
  passengers: PassengerColor[];
  parking: (ParkedJamVehicle | null)[];
  movesMade: number;
  status: VehicleJamStatus;
}

export type VehicleBlockReason = 'path' | 'parking' | 'missing' | 'won';

export type VehicleReadiness =
  | { allowed: true }
  | { allowed: false; reason: VehicleBlockReason; blockerId?: string };

export interface PassengerBoarding {
  vehicleId: string;
  color: PassengerColor;
  passengersOnboard: number;
}

export type VehicleDeparture =
  | {
      ok: true;
      state: VehicleJamState;
      dispatched: JamVehicle;
      bayIndex: number;
      boardings: PassengerBoarding[];
      autoDeparted: ParkedJamVehicle[];
    }
  | { ok: false; state: VehicleJamState; reason: VehicleBlockReason; blockerId?: string };

const STARTING_VEHICLES: JamVehicle[] = [
  { id: 'gold-east', color: 'gold', x: 3, y: 0, direction: 'E' },
  { id: 'coral-east', color: 'coral', x: 0, y: 0, direction: 'E' },
  { id: 'teal-north', color: 'teal', x: 1, y: 1, direction: 'N' },
  { id: 'gold-north', color: 'gold', x: 1, y: 3, direction: 'N' },
  { id: 'teal-west', color: 'teal', x: 3, y: 2, direction: 'W' },
  { id: 'coral-west', color: 'coral', x: 2, y: 5, direction: 'W' },
  { id: 'gold-west', color: 'gold', x: 4, y: 5, direction: 'W' },
  { id: 'coral-south', color: 'coral', x: 5, y: 3, direction: 'S' },
];

// Six seats of each Coral and Gold passenger, plus four Teal seats. The order
// deliberately creates two-color waiting in the parking bays during the solve.
const STARTING_PASSENGERS: PassengerColor[] = [
  'coral', 'coral', 'gold', 'gold', 'teal', 'teal',
  'coral', 'coral', 'gold', 'gold', 'teal', 'teal',
  'gold', 'gold', 'coral', 'coral',
];

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
    parking: Array.from({ length: PARKING_BAY_COUNT }, () => null),
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

  if (state.parking.every((bay) => bay !== null)) {
    return { allowed: false, reason: 'parking' };
  }
  return { allowed: true };
}

function boardWaitingPassengers(
  parking: (ParkedJamVehicle | null)[],
  passengerQueue: PassengerColor[],
): { passengers: PassengerColor[]; boardings: PassengerBoarding[]; autoDeparted: ParkedJamVehicle[] } {
  const passengers = [...passengerQueue];
  const boardings: PassengerBoarding[] = [];
  const autoDeparted: ParkedJamVehicle[] = [];

  while (passengers.length > 0) {
    const color = passengers[0]!;
    const bayIndex = parking.findIndex(
      (bus) => bus?.color === color && bus.passengersOnboard < PASSENGER_CAPACITY,
    );
    if (bayIndex < 0) break;

    const bus = parking[bayIndex]!;
    const updatedBus = { ...bus, passengersOnboard: bus.passengersOnboard + 1 };
    passengers.shift();
    boardings.push({
      vehicleId: updatedBus.id,
      color: updatedBus.color,
      passengersOnboard: updatedBus.passengersOnboard,
    });

    if (updatedBus.passengersOnboard === PASSENGER_CAPACITY) {
      autoDeparted.push(updatedBus);
      parking[bayIndex] = null;
    } else {
      parking[bayIndex] = updatedBus;
    }
  }

  return { passengers, boardings, autoDeparted };
}

/**
 * A clear-route bus may park regardless of the queue's next color. Only parked
 * buses matching the queue head board; a bus leaves automatically at 2/2 seats.
 */
export function departVehicle(state: VehicleJamState, vehicleId: string): VehicleDeparture {
  const readiness = getVehicleReadiness(state, vehicleId);
  if (!readiness.allowed) return { ok: false, state, ...readiness };

  const vehicleIndex = state.vehicles.findIndex((vehicle) => vehicle.id === vehicleId);
  const dispatched = state.vehicles[vehicleIndex]!;
  const vehicles = state.vehicles
    .filter((vehicle) => vehicle.id !== vehicleId)
    .map((vehicle) => ({ ...vehicle }));
  const parking = state.parking.map((bus) => bus ? { ...bus } : null);
  const bayIndex = parking.findIndex((bay) => bay === null);
  parking[bayIndex] = { ...dispatched, passengersOnboard: 0 };

  const boarding = boardWaitingPassengers(parking, state.passengers);
  const won = vehicles.length === 0
    && boarding.passengers.length === 0
    && parking.every((bay) => bay === null);
  const nextState: VehicleJamState = {
    vehicles,
    passengers: boarding.passengers,
    parking,
    movesMade: state.movesMade + 1,
    status: won ? 'won' : 'playing',
  };

  return {
    ok: true,
    state: nextState,
    dispatched: { ...dispatched },
    bayIndex,
    boardings: boarding.boardings,
    autoDeparted: boarding.autoDeparted,
  };
}
