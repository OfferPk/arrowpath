import {
  getVehicleReadiness,
  PASSENGER_CAPACITY,
  VEHICLE_COLOR_LABEL,
  VEHICLE_DIRECTION_GLYPH,
  VEHICLE_DIRECTION_LABEL,
  type JamVehicle,
  type PassengerColor,
  type VehicleJamState,
} from '../game/vehicle-jam';

export interface VehicleCardView {
  id: string;
  color: PassengerColor;
  axis: 'horizontal' | 'vertical';
  glyph: string;
  label: string;
  gridColumn: string;
  gridRow: string;
  canPark: boolean;
  ariaLabel: string;
}

export interface VehicleJamArrivalCue {
  vehicle: JamVehicle;
  bayIndex: number;
  droveOff: boolean;
  passengersOnboard: number;
}

export function getVehicleCardViews(state: VehicleJamState): VehicleCardView[] {
  return state.vehicles.map((vehicle) => {
    const horizontal = vehicle.direction === 'E' || vehicle.direction === 'W';
    const readiness = getVehicleReadiness(state, vehicle.id);
    let route = 'route to the board edge is clear';
    if (!readiness.allowed && readiness.reason === 'path') {
      const blocker = state.vehicles.find((item) => item.id === readiness.blockerId);
      route = `blocked by the ${blocker ? VEHICLE_COLOR_LABEL[blocker.color] : 'other'} bus`;
    } else if (!readiness.allowed && readiness.reason === 'parking') {
      route = 'both parking bays are full';
    } else if (!readiness.allowed) {
      route = 'cannot depart';
    }

    const nextPassenger = state.passengers[0];
    const queue = nextPassenger
      ? `The next passenger is ${VEHICLE_COLOR_LABEL[nextPassenger]}.`
      : 'No passengers are waiting.';
    const parking = readiness.allowed
      ? 'This bus may park even if its color does not match; matching passengers board from the queue.'
      : `This bus cannot park yet: ${route}.`;
    return {
      id: vehicle.id,
      color: vehicle.color,
      axis: horizontal ? 'horizontal' : 'vertical',
      glyph: VEHICLE_DIRECTION_GLYPH[vehicle.direction],
      label: `${VEHICLE_DIRECTION_GLYPH[vehicle.direction]} ${VEHICLE_COLOR_LABEL[vehicle.color][0]}`,
      gridColumn: `${vehicle.x + 1} / span ${horizontal ? 2 : 1}`,
      gridRow: `${vehicle.y + 1} / span ${horizontal ? 1 : 2}`,
      canPark: readiness.allowed,
      ariaLabel: `${VEHICLE_COLOR_LABEL[vehicle.color]} bus facing ${VEHICLE_DIRECTION_LABEL[vehicle.direction]}. ${route}. ${queue} ${parking}`,
    };
  });
}

export function renderVehicleJamBoard(
  container: HTMLElement,
  state: VehicleJamState,
  onSelect: (vehicleId: string) => void,
): void {
  const fragment = document.createDocumentFragment();
  for (const view of getVehicleCardViews(state)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `vehicle-card vehicle-${view.color} axis-${view.axis}`;
    button.dataset.vehicleId = view.id;
    button.dataset.canPark = String(view.canPark);
    button.style.gridColumn = view.gridColumn;
    button.style.gridRow = view.gridRow;
    button.setAttribute('aria-label', view.ariaLabel);
    button.title = view.ariaLabel;
    button.textContent = view.label;
    button.addEventListener('click', () => onSelect(view.id));
    fragment.appendChild(button);
  }
  container.replaceChildren(fragment);
}

export function renderPassengerQueue(container: HTMLElement, state: VehicleJamState): void {
  const fragment = document.createDocumentFragment();
  state.passengers.forEach((color, index) => {
    const token = document.createElement('span');
    token.className = `passenger-token vehicle-${color}${index === 0 ? ' passenger-next' : ''}`;
    token.dataset.queueIndex = String(index);
    token.setAttribute('role', 'listitem');
    token.setAttribute(
      'aria-label',
      `${VEHICLE_COLOR_LABEL[color]} passenger ${index + 1}${index === 0 ? ', next to board' : ''}`,
    );
    token.textContent = VEHICLE_COLOR_LABEL[color][0];
    fragment.appendChild(token);
  });
  container.replaceChildren(fragment);
}

export function renderVehicleJamParking(
  container: HTMLElement,
  state: VehicleJamState,
  arrivalCue: VehicleJamArrivalCue | null = null,
): void {
  const fragment = document.createDocumentFragment();
  state.parking.forEach((bus, index) => {
    const bay = document.createElement('div');
    bay.className = `parking-bay${bus ? ' occupied' : ' empty'}`;
    bay.setAttribute('role', 'listitem');
    bay.setAttribute('aria-label', bus
      ? `Bay ${index + 1}: ${VEHICLE_COLOR_LABEL[bus.color]} bus, ${bus.passengersOnboard} of ${PASSENGER_CAPACITY} passengers`
      : `Bay ${index + 1}: open`);

    const label = document.createElement('span');
    label.className = 'parking-bay-label';
    label.textContent = `Bay ${index + 1}`;
    bay.appendChild(label);

    if (bus) {
      const vehicle = document.createElement('span');
      const arriving = arrivalCue?.vehicle.id === bus.id;
      vehicle.className = `parking-bus vehicle-${bus.color}${arriving ? ' just-arrived' : ''}`;
      vehicle.setAttribute('aria-hidden', 'true');
      vehicle.textContent = `${VEHICLE_DIRECTION_GLYPH[bus.direction]} ${VEHICLE_COLOR_LABEL[bus.color]} · ${bus.passengersOnboard}/${PASSENGER_CAPACITY}`;
      bay.appendChild(vehicle);
    } else {
      const open = document.createElement('span');
      open.className = 'parking-open';
      open.textContent = 'Open';
      bay.appendChild(open);

      if (arrivalCue?.bayIndex === index && arrivalCue.droveOff) {
        const transit = document.createElement('span');
        transit.className = `parking-transit vehicle-${arrivalCue.vehicle.color}`;
        transit.setAttribute('aria-hidden', 'true');
        transit.textContent = `${VEHICLE_DIRECTION_GLYPH[arrivalCue.vehicle.direction]} ${VEHICLE_COLOR_LABEL[arrivalCue.vehicle.color]} · ${arrivalCue.passengersOnboard}/${PASSENGER_CAPACITY}`;
        bay.appendChild(transit);
      }
    }
    fragment.appendChild(bay);
  });
  container.replaceChildren(fragment);
}
