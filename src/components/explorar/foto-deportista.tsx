'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  anchoRetratoPara, fotoPublicadaValida, retratoAncho, type FotoPublicada,
} from '@/lib/sport/explorar/foto-contrato';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { ANILLO, ANILLO_APAGADO } from './avatar-anillo';
import { ahorrarDatos } from '@/components/sistema/red-cliente';

/** `null` = definitivo sin foto; `undefined` = fallo pasajero, que no se recuerda. */
async function pedirFoto(personaId: string): Promise<FotoPublicada | null | undefined> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 7000);
  try {
    // Sin `no-store`: la ruta deja reutilizar en el navegador sólo lo definitivo.
    const respuesta = await fetch(`/api/explorar/deportistas/${encodeURIComponent(personaId)}/foto`, {
      credentials: 'same-origin', signal: controlador.signal,
      headers: { Accept: 'application/json' },
    });
    if (!respuesta.ok || !respuesta.headers.get('content-type')?.startsWith('application/json')) return undefined;
    const texto = await respuesta.text();
    if (texto.length > 4096 || controlador.signal.aborted) return undefined;
    const valor: unknown = JSON.parse(texto);
    if (!valor || typeof valor !== 'object') return undefined;
    const resultado = valor as Record<string, unknown>;
    if (resultado.estado === 'publicada') return fotoPublicadaValida(resultado.foto) ? resultado.foto : null;
    return resultado.estado === 'foto_no_publicada' ? null : undefined;
  } catch {
    // Ausencia, caducidad y errores de red dejan las iniciales, nunca un icono roto.
    return undefined;
  } finally {
    clearTimeout(temporizador);
  }
}

type FotoLote = FotoPublicada | null | undefined | 'pendiente';

/**
 * Varias personas en una petición (`/api/explorar/fotos`, ver `foto-lote.ts`).
 * `'sin_ruta'` (404: un despliegue anterior sin la ruta de lote) hace que se
 * pidan una a una; cualquier otro fallo es pasajero para todas.
 */
async function pedirLote(ids: readonly string[]): Promise<Map<string, FotoLote> | 'sin_ruta'> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 9000);
  const vacio = new Map<string, FotoLote>();
  try {
    const respuesta = await fetch(`/api/explorar/fotos?ids=${[...ids].sort().map(encodeURIComponent).join(',')}`, {
      credentials: 'same-origin', signal: controlador.signal,
      headers: { Accept: 'application/json' },
    });
    if (respuesta.status === 404) return 'sin_ruta';
    if (!respuesta.ok || !respuesta.headers.get('content-type')?.startsWith('application/json')) return vacio;
    const texto = await respuesta.text();
    if (texto.length > 1024 * MAX_POR_LOTE || controlador.signal.aborted) return vacio;
    const valor: unknown = JSON.parse(texto);
    const fotosLote = valor && typeof valor === 'object' && (valor as Record<string, unknown>).estado === 'ok'
      ? (valor as Record<string, unknown>).fotos : null;
    if (!fotosLote || typeof fotosLote !== 'object') return vacio;
    const resultado = new Map<string, FotoLote>();
    for (const id of ids) {
      const r = (fotosLote as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
      if (!r || typeof r !== 'object') continue;
      if (r.estado === 'publicada') resultado.set(id, fotoPublicadaValida(r.foto) ? r.foto : null);
      else if (r.estado === 'foto_no_publicada') resultado.set(id, null);
      else if (r.estado === 'pendiente') resultado.set(id, 'pendiente');
    }
    return resultado;
  } catch {
    return vacio;
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Cada retrato cuesta lecturas en D1 y, si la FIE no está ya resuelta en R2,
 * dos peticiones a la FIE. Una sola petición por persona mientras dure la
 * página, la vea quien la vea (cabecera, curiosidades, listas): la respuesta
 * definitiva (también «sin foto») se recuerda aquí y, entre páginas, en la
 * caché del navegador. En listas se pide sólo al quedar a la vista y tras una
 * pausa (al escribir, las filas cambian antes); las filas que aparecen a la vez
 * se juntan en lotes de hasta `MAX_POR_LOTE`, y como mucho van dos peticiones
 * a la vez. Lo que el lote no resuelve (`pendiente`) se pide una a una.
 */
const ESPERA_FOTO_LISTA = 350;
const ESPERA_LOTE = 20;
const MAX_POR_LOTE = 24;
const MAX_FOTOS_A_LA_VEZ = 2;
const MAX_FOTOS_RECORDADAS = 300;
const fotos = new Map<string, Promise<FotoPublicada | null>>();
const turnos: (() => void)[] = [];
let enCurso = 0;
const enEspera = new Map<string, (f: FotoPublicada | null | undefined) => void>();
let temporizadorLote: ReturnType<typeof setTimeout> | undefined;

function vaciarLote() {
  temporizadorLote = undefined;
  const pendientes = [...enEspera];
  enEspera.clear();
  for (let i = 0; i < pendientes.length; i += MAX_POR_LOTE) {
    const trozo = pendientes.slice(i, i + MAX_POR_LOTE);
    if (trozo.length === 1) {
      // Una sola: la ruta individual, que el navegador ya puede tener guardada.
      const [[id, resolver]] = trozo;
      void conTurno(() => pedirFoto(id)).then(resolver);
      continue;
    }
    void conTurno(() => pedirLote(trozo.map(([id]) => id))).then((lote) => {
      for (const [id, resolver] of trozo) {
        const r = lote === 'sin_ruta' ? 'pendiente' : lote.get(id);
        if (r === 'pendiente') void conTurno(() => pedirFoto(id)).then(resolver);
        else resolver(r);
      }
    });
  }
}

function pedirEnLote(personaId: string): Promise<FotoPublicada | null | undefined> {
  return new Promise((resolver) => {
    enEspera.set(personaId, resolver);
    temporizadorLote ??= setTimeout(vaciarLote, ESPERA_LOTE);
  });
}

function conTurno<T>(tarea: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolver) => {
    const empezar = () => {
      enCurso++;
      void tarea().then(resolver).finally(() => {
        enCurso--;
        turnos.shift()?.();
      });
    };
    if (enCurso < (ahorrarDatos() ? 1 : MAX_FOTOS_A_LA_VEZ)) empezar();
    else turnos.push(empezar);
  });
}

/** La foto de una persona, pedida una vez; `prioritaria` se salta la cola de las listas. */
export function fotoDe(personaId: string, prioritaria = false): Promise<FotoPublicada | null> {
  const recordada = fotos.get(personaId);
  if (recordada) return recordada;
  const promesa = (prioritaria ? pedirFoto(personaId) : pedirEnLote(personaId)).then((f) => {
    // Un fallo pasajero se olvida para que la próxima vez se vuelva a intentar.
    if (f === undefined) fotos.delete(personaId);
    return f ?? null;
  });
  fotos.set(personaId, promesa);
  while (fotos.size > MAX_FOTOS_RECORDADAS) fotos.delete(fotos.keys().next().value!);
  return promesa;
}

/**
 * Fotos ya resueltas en el servidor (`leerFotosDeportistas`): quien las
 * siembra ahorra la petición. `null` es «sin foto» definitivo; lo que no pase
 * `fotoPublicadaValida` no se siembra y se pedirá como siempre.
 */
export function sembrarFotos(resueltas: Readonly<Record<string, FotoPublicada | null>>): void {
  for (const [id, foto] of Object.entries(resueltas)) {
    if (fotos.has(id) || (foto !== null && !fotoPublicadaValida(foto))) continue;
    fotos.set(id, Promise.resolve(foto));
  }
  while (fotos.size > MAX_FOTOS_RECORDADAS) fotos.delete(fotos.keys().next().value!);
}

/** Sólo para pruebas: vacía la memoria de fotos. */
export function olvidarFotos(): void {
  fotos.clear();
  enEspera.clear();
  clearTimeout(temporizadorLote);
  temporizadorLote = undefined;
}

export type FotoDeportistaProps = {
  /** ID público de la persona deportiva, nunca athleteId/profileId. */
  personaId: string;
  nombre: string;
  /** El encabezado puede suprimir el componente; no se hace ninguna petición. */
  ocultar?: boolean;
  /** Junto a un nombre visible el retrato es decorativo. */
  decorativa?: boolean;
  /**
   * `perfil` es el retrato grande de la cabecera de la ficha; `heroe`, el de
   * la cabecera tipo red social (5 rem en móvil, 9 rem desde `sm`), con
   * anillo. `lista` es el avatar de 44 px con anillo de las filas del
   * buscador: la foto se pide sólo al verse. `fila` es lo mismo a 28 px, para
   * las tablas de ranking de una línea por tirador.
   */
  tamano?: 'mini' | 'retrato' | 'perfil' | 'heroe' | 'lista' | 'fila';
  /** Sólo `lista`: filete en vez de degradado (sin resultados importados). */
  apagado?: boolean;
  /**
   * Ya resuelta en el servidor (`leerFotosDeportistas`): no se pide. `null` es
   * «sin foto»; sin la prop (`undefined`) se pide como siempre.
   */
  foto?: FotoPublicada | null;
  className?: string;
};

const MEDIDAS = { mini: 48, retrato: 96, perfil: 120, heroe: 144, lista: 44, fila: 28 } as const;

export function FotoDeportista({ ocultar = false, ...props }: FotoDeportistaProps) {
  // La clave descarta también una imagen anterior al cambiar de persona.
  return ocultar ? null : <Retrato key={props.personaId} {...props} />;
}

function Retrato({
  personaId, nombre, decorativa = true, tamano = 'retrato', apagado = false, className, foto: resuelta,
}: Omit<FotoDeportistaProps, 'ocultar'>) {
  const resueltaEnServidor = resuelta !== undefined;
  const [foto, setFoto] = useState<FotoPublicada | null>(() =>
    resuelta && fotoPublicadaValida(resuelta) ? resuelta : null);
  const [cargada, setCargada] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const medida = MEDIDAS[tamano];
  const iniciales = inicialesVisibles(nombre) || '—';
  const enLista = tamano === 'lista' || tamano === 'fila';
  const prioritaria = tamano === 'heroe' || tamano === 'perfil';
  // El avatar de 44-48 px no necesita los 16 KB del retrato de 320: con 96 bastan 2 KB.
  const src = foto ? retratoAncho(foto.src, anchoRetratoPara(medida)) ?? foto.src : undefined;

  useEffect(() => {
    if (resueltaEnServidor) return;
    let vigente = true;
    const poner = (f: FotoPublicada | null) => { if (vigente && f) setFoto(f); };
    if (prioritaria) {
      void fotoDe(personaId, true).then(poner);
      return () => { vigente = false; };
    }
    let espera: ReturnType<typeof setTimeout> | undefined;
    const nodo = caja.current;
    let observador: IntersectionObserver | undefined;
    const cargar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => {
        observador?.disconnect();
        void fotoDe(personaId).then(poner);
      }, ahorrarDatos() ? 700 : ESPERA_FOTO_LISTA);
    };
    if (!nodo || typeof IntersectionObserver === 'undefined') {
      cargar();
      return () => { vigente = false; clearTimeout(espera); };
    }
    observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) cargar();
      else clearTimeout(espera);
    }, { rootMargin: ahorrarDatos() ? '0px' : '120px' });
    observador.observe(nodo);
    return () => { vigente = false; observador?.disconnect(); clearTimeout(espera); };
  }, [personaId, prioritaria, resueltaEnServidor]);

  const rotulo = decorativa ? undefined : cargada ? `Foto de ${nombre}` : 'Foto no publicada';
  const imagen = foto ? (
    // Imagen nativa a propósito: Next no debe copiar ni optimizar fotos FIE.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={medida}
      height={medida}
      // La cabecera de la ficha está siempre a la vista: sin esperar al lazy.
      loading={tamano === 'heroe' ? 'eager' : 'lazy'}
      fetchPriority={tamano === 'heroe' ? 'high' : 'low'}
      decoding="async"
      referrerPolicy="no-referrer"
      className={`absolute inset-0 size-full object-cover ${cargada ? '' : 'invisible'}`}
      onLoad={() => setCargada(true)}
      onError={() => { setCargada(false); setFoto(null); }}
    />
  ) : null;

  if (enLista) {
    return (
      <div ref={caja} className={cn('shrink-0', apagado ? ANILLO_APAGADO : ANILLO, className)}>
        <div className={cn('rounded-full border-background bg-background', tamano === 'fila' ? 'border' : 'border-2')}>
          <Avatar
            style={{ width: medida, height: medida }}
            aria-hidden={decorativa || undefined}
            role={decorativa ? undefined : 'img'}
            aria-label={rotulo}
          >
            <AvatarFallback aria-hidden="true" className={tamano === 'fila' ? 'font-display text-xs' : 'font-display text-base'}>{iniciales}</AvatarFallback>
            {imagen}
          </Avatar>
        </div>
      </div>
    );
  }

  if (tamano === 'heroe') {
    return (
      <div className={cn('relative shrink-0', className)}>
        <div className={cn(ANILLO, 'border-[3px]')}>
          <div className="rounded-full border-[3px] border-background bg-background">
            <Avatar
              className="size-20 max-[359px]:size-16 sm:size-36"
              aria-hidden={decorativa || undefined}
              role={decorativa ? undefined : 'img'}
              aria-label={rotulo}
            >
              <AvatarFallback aria-hidden="true" className="font-display text-3xl sm:text-6xl">{iniciales}</AvatarFallback>
              {imagen}
            </Avatar>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={caja} className={cn('shrink-0', className)} style={{ width: medida }}>
      <Avatar
        style={{ width: medida, height: medida }}
        className="border border-border"
        aria-hidden={decorativa || undefined}
        role={decorativa ? undefined : 'img'}
        aria-label={rotulo}
      >
        <AvatarFallback aria-hidden="true" className={tamano === 'perfil' ? 'font-display text-4xl' : undefined}>{iniciales}</AvatarFallback>
        {imagen}
      </Avatar>
    </div>
  );
}
