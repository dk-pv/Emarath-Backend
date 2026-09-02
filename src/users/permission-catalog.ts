/**
 * The User Permissions matrix catalogue (ADR-0055 §2), transcribed cell-for-cell from
 * the Workpex "Create A Team Member" step 3 screenshots: which of View/Add/Edit each
 * module row offers. A crossed-out cell in the reference is `false` here, and the
 * service rejects any write that sets an inapplicable flag — so a disabled cell cannot
 * be forged through the API, only greyed in the UI.
 *
 * Pure data in its own module: the DTO decorators need reflect-metadata at import time,
 * and the seeds that consume this catalogue must not drag that in.
 */
export const PERMISSION_CATALOG = [
  {
    module: 'DASHBOARD',
    label: 'Dashboard',
    view: true,
    add: false,
    edit: false,
  },
  { module: 'LEADS', label: 'Leads', view: true, add: true, edit: true },
  {
    module: 'ACTIVITIES',
    label: 'Activities',
    view: true,
    add: true,
    edit: true,
  },
  { module: 'CALLS', label: 'Calls', view: true, add: true, edit: false },
  {
    module: 'DOCUMENTS',
    label: 'Documents',
    view: true,
    add: true,
    edit: true,
  },
  { module: 'GPS_MAP', label: 'GPS/Map', view: true, add: false, edit: false },
  { module: 'REPORTS', label: 'Reports', view: true, add: false, edit: false },
  { module: 'SETTINGS', label: 'Settings', view: true, add: true, edit: true },
  {
    module: 'NOTIFICATIONS',
    label: 'Notifications',
    view: true,
    add: false,
    edit: false,
  },
  { module: 'PIPELINE', label: 'Pipeline', view: true, add: true, edit: true },
  {
    module: 'CHANGE_OWNERSHIP',
    label: 'Change Ownership',
    view: false,
    add: true,
    edit: true,
  },
  {
    module: 'INTEGRATION',
    label: 'Integration',
    view: true,
    add: true,
    edit: true,
  },
  { module: 'EXPORT', label: 'Export', view: true, add: false, edit: false },
] as const;

export type PermissionModule = (typeof PERMISSION_CATALOG)[number]['module'];
export const PERMISSION_MODULES = PERMISSION_CATALOG.map((row) => row.module);
