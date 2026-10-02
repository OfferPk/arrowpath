import {
  getVehicleReadiness,
  VEHICLE_COLOR_LABEL,
  VEHICLE_DIRECTION_GLYPH,
  VEHICLE_DIRECTION_LABEL,
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
  canDepart: boolean;
  ariaLabel: string;
}

export function getVehicleCardViews(state: VehicleJamState): VehicleCardView[] {
  return state.vehicles.map((vehicle) => {
    const horizontal = vehicle.direction === 'E' || vehicle.direction === 'W';
    const readiness = getVehicleReadiness(state, vehicle.id);
    let route = 'route to the edge is clear';
    if (!readiness.allowed && readiness.reason === 'path') {
      const blocker = state.vehicles.find((item) => item.id === readiness.blockerId);
      route = `blocked by the ${blocker ? VEHICLE_COLOR_LABEL[blocker.color] : 'other'} vehicle`;
    } else if (!readiness.allowed && readiness.reason === 'passenger') {
      route = readiness.nextPassenger
        ? `waiting for the ${VEHICLE_COLOR_LABEL[readiness.nextPassenger]} passenger`
        : 'no passenger is waiting';
    } else if (!readiness.allowed) {
      route = 'cannot depart';
    }

    const passenger = state.passengers[0];
    const flow = passenger
      ? `The next passenger is ${VEHICLE_COLOR_LABEL[passenger]}.`
      : 'No passengers remain.';
    const action = readiness.allowed ? 'Activate to depart.' : `This vehicle cannot depart yet: ${route}.`;
    return {
      id: vehicle.id,
      color: vehicle.color,
      axis: horizontal ? 'horizontal' : 'vertical',
      glyph: VEHICLE_DIRECTION_GLYPH[vehicle.direction],
      label: `${VEHICLE_COLOR_LABEL[vehicle.color]} ${VEHICLE_DIRECTION_GLYPH[vehicle.direction]}`,
      gridColumn: `${vehicle.x + 1} / span ${horizontal ? 2 : 1}`,
      gridRow: `${vehicle.y + 1} / span ${horizontal ? 1 : 2}`,
      canDepart: readiness.allowed,
      ariaLabel: `${VEHICLE_COLOR_LABEL[vehicle.color]} vehicle facing ${VEHICLE_DIRECTION_LABEL[vehicle.direction]}. ${route}. ${flow} ${action}`,
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
    button.dataset.canDepart = String(view.canDepart);
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
