'use client';

import { BellRing, ChevronDown, Send, Share } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  CANALES, TEXTO_CANAL, TEXTO_TIPO, TIPOS_AVISO,
  type ClavePreferencia, type Preferencias,
} from '@/lib/notificaciones/tipos';
import { cn } from '@/lib/utils';
import { CAJA_TACTIL, clasesPastilla } from './control';

type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

export type AccionesAjustes = {
  guardarPreferencia: (clave: string, activa: boolean) => Promise<Resultado>;
  suscribir: (datos: unknown) => Promise<Resultado>;
  desuscribir: (endpoint: string) => Promise<Resultado>;
  probar: () => Promise<Resultado>;
};

export type EstadoPush =
  | 'comprobando'
  | 'sin-soporte'
  | 'ios-instalar'
  | 'sin-claves'
  | 'denegado'
  | 'apagado'
  | 'activo';

function esIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function instalada(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function claveServidor(base64: string): Uint8Array<ArrayBuffer> {
  const limpio = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(limpio);
  const salida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i);
  return salida;
}

/** «iPhone · Safari», «Android · Chrome», «Windows · Edge»: lo justo para reconocer el dispositivo. */
export function nombreDispositivo(ua: string): string {
  const sistema = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Navegador';
  const navegador = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '';
  return navegador ? `${sistema} · ${navegador}` : sistema;
}

async function registro(): Promise<ServiceWorkerRegistration> {
  const existente = await navigator.serviceWorker.getRegistration('/');
  if (!existente) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/**
 * Interruptor con la caja de toque real de 44 × 52 px y el dibujo de
 * 34 × 20 dentro. El de `ui/switch` mide 18 px de alto y solo se podía
 * agrandar con un `::after`, que la sonda no ve.
 */
function Interruptor({
  id, activa, deshabilitada, alCambiar, describe,
}: { id: string; activa: boolean; deshabilitada: boolean; alCambiar: (v: boolean) => void; describe: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={activa}
      aria-describedby={describe}
      disabled={deshabilitada}
      onClick={() => alCambiar(!activa)}
      className={cn(CAJA_TACTIL, 'w-[52px] justify-end disabled:cursor-not-allowed')}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-[20px] w-[34px] items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none',
          'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background',
          activa ? 'border-transparent bg-primary group-disabled:bg-muted' : 'border-filete-alto bg-secondary',
        )}
      >
        <span
          className={cn(
            'size-[16px] rounded-full transition-transform duration-150 motion-reduce:transition-none',
            activa ? 'translate-x-[15px] bg-primary-foreground' : 'translate-x-[1px] bg-muted-foreground',
            'group-disabled:bg-off',
          )}
        />
      </span>
    </button>
  );
}

function Fila({
  id, nombre, explicacion, activa, deshabilitada, alCambiar,
}: {
  id: string; nombre: string; explicacion: string; activa: boolean; deshabilitada: boolean; alCambiar: (v: boolean) => void;
}) {
  return (
    <li className="flex min-h-[56px] items-center justify-between gap-[12px] py-[6px]">
      <div className="flex min-w-0 flex-col gap-[2px]">
        <label htmlFor={id} className="text-[14px] leading-[20px] font-medium">{nombre}</label>
        <p id={`${id}-explicacion`} className="text-[13px] leading-[16px] text-muted-foreground">{explicacion}</p>
      </div>
      <Interruptor id={id} activa={activa} deshabilitada={deshabilitada} alCambiar={alCambiar} describe={`${id}-explicacion`} />
    </li>
  );
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-[4px]">
      <h2 id={id} className="font-sans text-[13px] leading-[16px] font-semibold tracking-normal text-muted-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

/** Los pasos de iPhone se pintan solo cuando se piden: nada oculto en la página. */
function PasosIphone({ abiertos, alternar }: { abiertos: boolean; alternar: () => void }) {
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={abiertos} aria-controls="pasos-iphone" onClick={alternar} className={cn(CAJA_TACTIL, 'justify-start')}>
        <span className={clasesPastilla('fantasma', '-ml-[14px]')}>
          Cómo activarlas en iPhone
          <ChevronDown aria-hidden className={cn('transition-transform duration-150 motion-reduce:transition-none', abiertos && 'rotate-180')} />
        </span>
      </button>
      {abiertos ? (
        <div id="pasos-iphone" className="flex flex-col gap-[8px] rounded-[12px] bg-card px-[16px] py-[12px]">
          <ol className="flex list-decimal flex-col gap-[6px] pl-[18px] text-[14px] leading-[20px]">
            <li>Abre la aplicación en Safari.</li>
            <li>Toca Compartir <Share aria-hidden className="inline size-[16px] align-[-3px]" />.</li>
            <li>Elige «Añadir a pantalla de inicio».</li>
            <li>Ábrela desde el icono y toca «Activar».</li>
          </ol>
          <p className="text-[12px] leading-[16px] text-muted-foreground">Necesitas iOS 16.4 o posterior.</p>
        </div>
      ) : null}
    </div>
  );
}

/** Una línea de 70 caracteres como mucho por estado (`docs/diseno-sistema.md` § 6). */
const TEXTO_ESTADO: Record<EstadoPush, string | null> = {
  comprobando: null,
  'sin-soporte': 'Este navegador no admite notificaciones.',
  'ios-instalar': 'En iPhone, añade antes la aplicación a la pantalla de inicio.',
  'sin-claves': 'El envío al móvil aún no está configurado.',
  denegado: 'Bloqueadas en este navegador. Permítelas en sus ajustes.',
  apagado: 'Desactivadas en este dispositivo.',
  activo: 'Activadas en este dispositivo.',
};

/** Tinte opaco de aviso (`--warn-tinte`, § 3): no deja ver lo de detrás. */
const TINTE_AVISO = 'bg-warn-tinte';

/**
 * Ajustes › Notificaciones. Todo lo que se puede apagar está a la vista con
 * una línea de qué hace. El estado del dispositivo se comprueba en el
 * navegador; `estadoInicial` solo lo fijan las capturas.
 */
export function AjustesNotificaciones({
  preferencias: iniciales,
  vapidPublica,
  soloLectura,
  avisoSoloLectura = 'Vista previa: solo lectura.',
  acciones,
  estadoInicial = 'comprobando',
  ios: iosInicial = false,
}: {
  preferencias: Preferencias;
  vapidPublica: string | null;
  soloLectura: boolean;
  avisoSoloLectura?: string;
  acciones: AccionesAjustes;
  estadoInicial?: EstadoPush;
  ios?: boolean;
}) {
  const router = useRouter();
  const [preferencias, setPreferencias] = React.useState(iniciales);
  const [mensaje, setMensaje] = React.useState<{ ok: boolean; texto: string } | null>(null);
  const [estado, setEstado] = React.useState<EstadoPush>(estadoInicial);
  const [pasos, setPasos] = React.useState(iosInicial || estadoInicial === 'ios-instalar');
  const [dispositivo, setDispositivo] = React.useState<string | null>(null);
  const [ocupado, empezar] = React.useTransition();

  React.useEffect(() => {
    let vivo = true;
    (async () => {
      const enIos = esIos();
      setDispositivo(nombreDispositivo(navigator.userAgent));
      if (enIos && !instalada()) {
        setPasos(true);
        return setEstado('ios-instalar');
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setEstado('sin-soporte');
      if (!vapidPublica) return setEstado('sin-claves');
      if (Notification.permission === 'denied') return setEstado('denegado');
      try {
        const reg = await registro();
        const sub = await reg.pushManager.getSubscription();
        if (!vivo) return;
        if (sub) {
          // Vuelve a guardarla: si la cuenta cambió en este dispositivo, la suscripción pasa a la de ahora.
          const j = sub.toJSON();
          if (!soloLectura) void acciones.suscribir({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, dispositivo: nombreDispositivo(navigator.userAgent) });
          setEstado('activo');
        } else setEstado('apagado');
      } catch {
        if (vivo) setEstado('sin-soporte');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [vapidPublica, soloLectura, acciones]);

  const cambiar = (clave: ClavePreferencia, activa: boolean) => {
    const anterior = preferencias[clave];
    setPreferencias((p) => ({ ...p, [clave]: activa }));
    empezar(async () => {
      const r = await acciones.guardarPreferencia(clave, activa);
      if (!r.ok) {
        setPreferencias((p) => ({ ...p, [clave]: anterior }));
        setMensaje({ ok: false, texto: r.error });
      } else setMensaje(null);
    });
  };

  const activar = () => empezar(async () => {
    if (!vapidPublica) return;
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== 'granted') {
        setEstado(permiso === 'denied' ? 'denegado' : 'apagado');
        return;
      }
      const reg = await registro();
      let sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveServidor(vapidPublica) });
      const j = sub.toJSON();
      const r = await acciones.suscribir({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, dispositivo: nombreDispositivo(navigator.userAgent) });
      if (!r.ok) {
        await sub.unsubscribe().catch(() => false);
        setMensaje({ ok: false, texto: r.error });
        return;
      }
      setEstado('activo');
      setMensaje(null);
    } catch {
      setMensaje({ ok: false, texto: 'El navegador no ha dejado activarlas. Vuelve a intentarlo.' });
    }
  });

  const desactivar = () => empezar(async () => {
    try {
      const reg = await registro();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await acciones.desuscribir(endpoint);
      }
      setEstado('apagado');
      setMensaje(null);
    } catch {
      setMensaje({ ok: false, texto: 'No se han podido desactivar. Vuelve a intentarlo.' });
    }
  });

  const probar = () => empezar(async () => {
    const r = await acciones.probar();
    setMensaje(r.ok ? { ok: true, texto: r.mensaje } : { ok: false, texto: r.error });
    if (r.ok) router.refresh();
  });

  const deshabilitada = soloLectura || ocupado;
  const textoEstado = TEXTO_ESTADO[estado];
  return (
    <div className="flex flex-col gap-[24px]">
      {soloLectura ? (
        <p className={cn('rounded-[12px] px-[16px] py-[10px] text-[14px] leading-[20px]', TINTE_AVISO)}>{avisoSoloLectura}</p>
      ) : null}

      <p
        role="status"
        aria-live="polite"
        className={mensaje ? cn('rounded-[12px] bg-card px-[16px] py-[10px] text-[14px] leading-[20px]', !mensaje.ok && 'text-primary-text') : 'sr-only'}
      >
        {mensaje?.texto ?? ''}
      </p>

      <Seccion id="ajustes-tipos" titulo="Qué te avisa">
        <ul className="flex flex-col divide-y divide-filete">
          {TIPOS_AVISO.map((t) => (
            <Fila
              key={t}
              id={`pref-tipo-${t}`}
              nombre={TEXTO_TIPO[t].nombre}
              explicacion={TEXTO_TIPO[t].explicacion}
              activa={preferencias[`tipo:${t}`]}
              deshabilitada={deshabilitada}
              alCambiar={(v) => cambiar(`tipo:${t}`, v)}
            />
          ))}
        </ul>
        <p className="text-[12px] leading-[16px] text-muted-foreground">Solo nombre, prueba y puesto. Un aviso por competición.</p>
      </Seccion>

      <Seccion id="ajustes-canales" titulo="Por dónde">
        <ul className="flex flex-col divide-y divide-filete">
          {CANALES.map((c) => (
            <Fila
              key={c}
              id={`pref-canal-${c}`}
              nombre={TEXTO_CANAL[c].nombre}
              explicacion={TEXTO_CANAL[c].explicacion}
              activa={preferencias[`canal:${c}`]}
              deshabilitada={deshabilitada}
              alCambiar={(v) => cambiar(`canal:${c}`, v)}
            />
          ))}
        </ul>
      </Seccion>

      <Seccion id="ajustes-dispositivo" titulo="Este dispositivo">
        <div className="flex min-h-[44px] items-center gap-[12px]">
          <span className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-secondary">
            <BellRing aria-hidden className={cn('size-[18px]', estado === 'activo' ? 'text-primary-text' : 'text-muted-foreground')} />
          </span>
          <div className="flex min-w-0 flex-col gap-[2px]">
            <p className="text-[14px] leading-[20px] font-medium" data-estado-push={estado}>{textoEstado ?? dispositivo ?? 'Este dispositivo'}</p>
            {textoEstado && dispositivo ? <p className="text-[12px] leading-[16px] text-muted-foreground">{dispositivo}</p> : null}
            {estado === 'activo' && !preferencias['canal:push'] ? (
              <p className="text-[12px] leading-[16px] text-muted-foreground">Enciende «Móvil» para recibirlas.</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-[8px]">
          {estado === 'apagado' ? (
            <button type="button" onClick={activar} disabled={deshabilitada} className={CAJA_TACTIL}>
              <span className={clasesPastilla('primario')}>Activar</span>
            </button>
          ) : null}
          {estado === 'activo' ? (
            <button type="button" onClick={desactivar} disabled={deshabilitada} className={CAJA_TACTIL}>
              <span className={clasesPastilla('secundario')}>Desactivar</span>
            </button>
          ) : null}
          <button type="button" onClick={probar} disabled={deshabilitada} className={CAJA_TACTIL}>
            <span className={clasesPastilla('secundario')}>
              <Send aria-hidden />
              Enviar prueba
            </span>
          </button>
        </div>
        <PasosIphone abiertos={pasos} alternar={() => setPasos((v) => !v)} />
      </Seccion>
    </div>
  );
}
