export const CLAVE_INSTALACION = 'calendarfencing:instalacion:v1';
export const DIA = 86_400_000;
export const ESPERA_INVITACION = 8_000;

export interface EventoInstalacion extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PlataformaInstalacion = 'ios-safari' | 'ios-otro' | 'nativa';

export function plataformaIOS(userAgent: string, maxTouchPoints: number): PlataformaInstalacion | null {
  const ios = /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!ios) return null;
  return /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA/.test(userAgent)
    ? 'ios-safari'
    : 'ios-otro';
}

export function estaInstalada(
  navegador: { standalone?: boolean },
  coincide: (consulta: string) => boolean,
) {
  return navegador.standalone === true ||
    coincide('(display-mode: standalone)') ||
    coincide('(display-mode: fullscreen)') ||
    coincide('(display-mode: minimal-ui)');
}

/** Solo una fecha, nunca identidad/sesión. La memoria cubre almacenamiento bloqueado. */
export function crearCooldown(obtenerStorage: () => Pick<Storage, 'getItem' | 'setItem'>) {
  let hastaEnMemoria = 0;
  return {
    activo(ahora = Date.now()) {
      let hasta = hastaEnMemoria;
      try {
        const valor = Number(obtenerStorage().getItem(CLAVE_INSTALACION));
        if (Number.isFinite(valor)) hasta = Math.max(hasta, valor);
      } catch { /* Navegación privada: se conserva la decisión durante esta pestaña. */ }
      return hasta > ahora;
    },
    guardar(dias: number, ahora = Date.now()) {
      hastaEnMemoria = ahora + dias * DIA;
      try {
        obtenerStorage().setItem(CLAVE_INSTALACION, String(hastaEnMemoria));
      } catch { /* No impedir la instalación ni la navegación. */ }
    },
  };
}

export const cooldownInstalacion = crearCooldown(() => window.localStorage);

/** El llamador debe ejecutarlo directamente desde un toque, nunca desde un efecto. */
export async function solicitarInstalacion(evento: EventoInstalacion) {
  try {
    await evento.prompt();
    return (await evento.userChoice).outcome;
  } catch {
    return 'error' as const;
  }
}

/** Captura temprana; el registro del SW y la invitación esperan a load por separado. */
export function escucharInstalacion(
  destino: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  recibir: (evento: EventoInstalacion) => void,
  instalada: () => void,
) {
  const capturar = (evento: Event) => {
    evento.preventDefault();
    recibir(evento as EventoInstalacion);
  };
  destino.addEventListener('beforeinstallprompt', capturar);
  destino.addEventListener('appinstalled', instalada);
  return () => {
    destino.removeEventListener('beforeinstallprompt', capturar);
    destino.removeEventListener('appinstalled', instalada);
  };
}
