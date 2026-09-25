export type EntryStatus =
  | 'draft'
  | 'pending_club'
  | 'club_approved'
  | 'federation_approved'
  | 'submitted'
  | 'rejected'
  | 'withdrawn';

export type Role = 'admin' | 'coach' | 'club' | 'athlete' | 'guardian';

export type Transition = {
  from: EntryStatus;
  to: EntryStatus;
  /** Quién puede hacerla. El admin puede hacer todas menos las prohibidas. */
  roles: Role[];
  /** Etiqueta del botón. */
  action: string;
  /** Si hace falta motivo obligatorio (rechazos y retiradas). */
  requiresReason: boolean;
};

/**
 * Transiciones válidas de una inscripción, en un único sitio.
 *
 * Tenerlas aquí y no repartidas por la interfaz es lo que permite testearlas
 * de verdad y que la bandeja del club, la del admin y la pantalla del tirador
 * no puedan discrepar entre ellas.
 */
export const TRANSITIONS: Transition[] = [
  {
    from: 'draft',
    to: 'pending_club',
    roles: ['athlete', 'guardian', 'club', 'admin'],
    action: 'Solicitar inscripción',
    requiresReason: false,
  },
  {
    from: 'draft',
    to: 'withdrawn',
    roles: ['athlete', 'guardian', 'club', 'admin'],
    action: 'Descartar',
    requiresReason: false,
  },
  {
    from: 'pending_club',
    to: 'club_approved',
    roles: ['club', 'admin'],
    action: 'Validar',
    requiresReason: false,
  },
  {
    from: 'pending_club',
    to: 'rejected',
    roles: ['club', 'admin'],
    action: 'Rechazar',
    requiresReason: true,
  },
  {
    from: 'pending_club',
    to: 'withdrawn',
    roles: ['athlete', 'guardian', 'club', 'admin'],
    action: 'Retirar solicitud',
    requiresReason: true,
  },
  {
    from: 'club_approved',
    to: 'federation_approved',
    roles: ['admin'],
    action: 'Aprobar (federación)',
    requiresReason: false,
  },
  {
    from: 'club_approved',
    to: 'rejected',
    roles: ['admin'],
    action: 'Rechazar',
    requiresReason: true,
  },
  {
    from: 'club_approved',
    to: 'pending_club',
    roles: ['admin'],
    action: 'Devolver al club',
    requiresReason: true,
  },
  {
    from: 'club_approved',
    to: 'withdrawn',
    roles: ['athlete', 'guardian', 'club', 'admin'],
    action: 'Retirar',
    requiresReason: true,
  },
  {
    from: 'federation_approved',
    to: 'submitted',
    roles: ['admin', 'club'],
    action: 'Marcar como enviada',
    requiresReason: false,
  },
  {
    from: 'federation_approved',
    to: 'withdrawn',
    roles: ['admin'],
    action: 'Retirar',
    requiresReason: true,
  },
  {
    from: 'federation_approved',
    to: 'rejected',
    roles: ['admin'],
    action: 'Rechazar',
    requiresReason: true,
  },
  {
    /** Una inscripción ya enviada solo la retira el admin, porque implica
     *  avisar a la federación o a la organización. */
    from: 'submitted',
    to: 'withdrawn',
    roles: ['admin'],
    action: 'Retirar inscripción enviada',
    requiresReason: true,
  },
  {
    from: 'rejected',
    to: 'pending_club',
    roles: ['athlete', 'guardian', 'club', 'admin'],
    action: 'Volver a solicitar',
    requiresReason: false,
  },
  {
    from: 'withdrawn',
    to: 'pending_club',
    roles: ['athlete', 'guardian', 'club', 'admin'],
    action: 'Volver a solicitar',
    requiresReason: false,
  },
];

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  draft: 'Borrador',
  pending_club: 'Pendiente de tu club',
  club_approved: 'Validada por tu club',
  federation_approved: 'Aceptada por la RFEE',
  submitted: 'Enviada / confirmada',
  rejected: 'Rechazada',
  withdrawn: 'Retirada',
};

/** Pasos de la línea de progreso que ve el tirador en "Mi estado". */
export const ENTRY_PROGRESS: EntryStatus[] = [
  'pending_club',
  'club_approved',
  'federation_approved',
  'submitted',
];

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; error: string };

export function findTransition(
  from: EntryStatus,
  to: EntryStatus,
): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/**
 * Valida una transición antes de tocar la base de datos. Devuelve el motivo
 * legible del rechazo en lugar de lanzar, para poder enseñarlo tal cual.
 */
export function canTransition(
  from: EntryStatus,
  to: EntryStatus,
  role: Role,
  reason?: string | null,
): TransitionCheck {
  if (from === to) {
    return { ok: false, error: `La inscripción ya está en "${ENTRY_STATUS_LABEL[to]}".` };
  }

  const transition = findTransition(from, to);
  if (!transition) {
    return {
      ok: false,
      error: `No se puede pasar de "${ENTRY_STATUS_LABEL[from]}" a "${ENTRY_STATUS_LABEL[to]}".`,
    };
  }

  if (!transition.roles.includes(role)) {
    return {
      ok: false,
      error: `Tu rol (${role}) no puede hacer "${transition.action}".`,
    };
  }

  if (transition.requiresReason && !reason?.trim()) {
    return { ok: false, error: `"${transition.action}" necesita un motivo.` };
  }

  return { ok: true, transition };
}

/** Acciones disponibles ahora mismo para ese rol. Alimenta los botones. */
export function availableTransitions(from: EntryStatus, role: Role): Transition[] {
  return TRANSITIONS.filter((t) => t.from === from && t.roles.includes(role));
}

/**
 * En quién está la pelota. Es la pregunta que hoy nadie sabe responder sin
 * llamar por teléfono, así que se responde explícitamente.
 */
export function waitingOn(status: EntryStatus): string | null {
  switch (status) {
    case 'pending_club':
      return 'tu club';
    case 'club_approved':
      return 'la RFEE';
    case 'federation_approved':
      return 'el envío a la organización';
    default:
      return null;
  }
}

export function progressIndex(status: EntryStatus): number {
  const i = ENTRY_PROGRESS.indexOf(status);
  if (i >= 0) return i;
  // rejected / withdrawn / draft no están en la línea de progreso.
  return -1;
}
