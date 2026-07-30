import { GpsPinType } from '../gps.service';

/**
 * One exportable GPS activity record — the unified shape the map/list already
 * present (User Name / Date & Time / Status), plus the coordinates the pins carry
 * (the compliance use-case in GPS-08.1 needs the location). Kept deliberately in
 * step with the on-screen list so the file matches the view (AC4).
 */
export interface GpsExportRow {
  agentName: string;
  timestamp: Date;
  type: GpsPinType;
  lat: number;
  lng: number;
}

/** The on-screen Status labels (mirror the GPS legend / list `PIN_LABELS`). */
const STATUS_LABEL: Record<GpsPinType, string> = {
  CHECK_IN: 'Check-in',
  CHECK_OUT: 'Check-out',
  LOCATION_CHECK_IN: 'Location Check-in',
  AUTOMATIC_TRACKING: 'Automatic Tracking',
  FOLLOW_UP_COMPLETION: 'Follow-up Completion',
};

export interface ExportColumn {
  header: string;
  value: (row: GpsExportRow) => string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Rendered in UTC and documented as such (the same convention the leads export
 * uses): the list formats the same instant in the viewer's timezone, so an
 * exported timestamp can differ from the on-screen cell by the viewer's offset.
 * Unambiguous beats locale-dependent for a file a spreadsheet parses.
 */
function formatDateTime(date: Date): string {
  let hour = date.getUTCHours();
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}, ${pad(hour)}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${meridiem}`;
}

/** The export columns, matching the GPS list (User Name / Date & Time / Status) + coordinates. */
export const GPS_EXPORT_COLUMNS: ExportColumn[] = [
  { header: 'User Name', value: (r) => r.agentName },
  { header: 'Date & Time', value: (r) => formatDateTime(r.timestamp) },
  { header: 'Status', value: (r) => STATUS_LABEL[r.type] },
  { header: 'Latitude', value: (r) => r.lat.toFixed(6) },
  { header: 'Longitude', value: (r) => r.lng.toFixed(6) },
];
