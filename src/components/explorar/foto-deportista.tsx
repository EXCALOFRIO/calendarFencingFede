'use client';

import { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  anchoRetratoPara, fotoPublicadaValida, retratoAncho, type FotoPublicada,
} from '@/lib/sport/explorar/foto-contrato';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { ANILLO, ANILLO_APAGADO } from './avatar-anillo';

async function pedirFoto(personaId: string, signal?: AbortSignal): Promise<FotoPublicada | null> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 7000);
  const abortar = () => controlador.abort();
  signal?.addEventListener('abort', abortar);
  try {
    // Sin `no-store`: la ruta marca como reutilizable una hora sólo lo definitivo.
    const respuesta = await fetch(`/api/explorar/deportistas/${encodeURIComponent(personaId)}/foto`, {
      credentials: 'same-origin', signal: controlador.signal,
      headers: { Accept: 'application/json' },
    });
    if (!respuesta.ok || !respuesta.headers.get('content-type')?.startsWith('application/json')) return null;
    const texto = await respuesta.text();
    if (texto.length > 4096 || controlador.signal.aborted) return null;
    const valor: unknown = JSON.parse(texto);
    if (!valor || typeof valor !== 'object') return null;
    const resultado = valor as Record<string, unknown>;
    return resultado.estado === 'publicada' && fotoPublicadaValida(resultado.foto) ? resultado.foto : null;
  } catch {
    // Ausencia, caducidad y errores de red dejan las iniciales, nunca un icono roto.
    return null;
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener('abort', abortar);
  }
}

/**
 * En una lista cada retrato cuesta lecturas en D1 y, si la FIE no está ya
 * resuelta en R2, dos peticiones a la FIE: se pide sólo al quedar a la vista y
 * tras una pausa (al escribir, las filas cambian antes), como mucho seis a la
 * vez, y la respuesta (también «sin foto») se recuerda mientras dure la página.
 */
const ESPERA_FOTO_LISTA = 350;
const MAX_FOTOS_A_LA_VEZ = 6;
const MAX_FOTOS_RECORDADAS = 300;
const fotosLista = new Map<string, Promise<FotoPublicada | null>>();
const turnos: (() => void)[] = [];
let enCurso = 0;

function conTurno<T>(tarea: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolver) => {
    const empezar = () => {
      enCurso++;
      void tarea().then(resolver).finally(() => {
        enCurso--;
        turnos.shift()?.();
      });
    };
    if (enCurso < MAX_FOTOS_A_LA_VEZ) empezar();
    else turnos.push(empezar);
  });
}

function fotoDeLista(personaId: string): Promise<FotoPublicada | null> {
  const recordada = fotosLista.get(personaId);
  if (recordada) return recordada;
  const promesa = conTurno(() => pedirFoto(personaId));
  fotosLista.set(personaId, promesa);
  while (fotosLista.size > MAX_FOTOS_RECORDADAS) fotosLista.delete(fotosLista.keys().next().value!);
  return promesa;
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
   * anillo y la atribución FIE como sello sobre el retrato en vez de pie.
   * El sello no enlaza: quien lo usa pone el enlace a la FIE en otro sitio.
   * `lista` es el avatar de 44 px con anillo de las filas del buscador: sin
   * pie, y la foto se pide sólo al verse (ver `fotoDeLista`). `fila` es lo
   * mismo a 28 px, para las tablas de ranking de una línea por tirador.
   */
  tamano?: 'mini' | 'retrato' | 'perfil' | 'heroe' | 'lista' | 'fila';
  /** Sólo `lista`: filete en vez de degradado (sin resultados importados). */
  apagado?: boolean;
  className?: string;
};

const MEDIDAS = { mini: 48, retrato: 96, perfil: 120, heroe: 144, lista: 44, fila: 28 } as const;

export function FotoDeportista({ ocultar = false, ...props }: FotoDeportistaProps) {
  // La clave descarta también una imagen anterior al cambiar de persona.
  return ocultar ? null : <Retrato key={props.personaId} {...props} />;
}

function Retrato({
  personaId, nombre, decorativa = true, tamano = 'retrato', apagado = false, className,
}: Omit<FotoDeportistaProps, 'ocultar'>) {
  const [foto, setFoto] = useState<FotoPublicada | null>(null);
  const [cargada, setCargada] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const medida = MEDIDAS[tamano];
  const iniciales = inicialesVisibles(nombre) || '—';
  // El avatar de 44-48 px no necesita los 16 KB del retrato de 320: con 96 bastan 2 KB.
  const src = foto ? retratoAncho(foto.src, anchoRetratoPara(medida)) ?? foto.src : undefined;

  useEffect(() => {
    if (tamano === 'lista' || tamano === 'fila') {
      let vigente = true;
      let espera: ReturnType<typeof setTimeout> | undefined;
      const cargar = () => {
        espera = setTimeout(() => {
          void fotoDeLista(personaId).then((f) => { if (vigente && f) setFoto(f); });
        }, ESPERA_FOTO_LISTA);
      };
      const nodo = caja.current;
      if (!nodo || typeof IntersectionObserver === 'undefined') {
        cargar();
        return () => { vigente = false; clearTimeout(espera); };
      }
      const observador = new IntersectionObserver((entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observador.disconnect();
        cargar();
      }, { rootMargin: '120px' });
      observador.observe(nodo);
      return () => { vigente = false; observador.disconnect(); clearTimeout(espera); };
    }
    const controlador = new AbortController();
    void pedirFoto(personaId, controlador.signal).then((f) => {
      if (f && !controlador.signal.aborted) setFoto(f);
    });
    return () => controlador.abort();
  }, [personaId, tamano]);

  if (tamano === 'lista' || tamano === 'fila') {
    return (
      <div ref={caja} className={cn('shrink-0', apagado ? ANILLO_APAGADO : ANILLO, className)}>
        <div className={cn('rounded-full bg-background', tamano === 'fila' ? 'p-px' : 'p-[2px]')}>
          <Avatar
            style={{ width: medida, height: medida }}
            aria-hidden={decorativa || undefined}
            role={decorativa ? undefined : 'img'}
            aria-label={decorativa ? undefined : cargada ? `Foto oficial de ${nombre}, FIE` : 'Foto no publicada'}
          >
            <AvatarFallback aria-hidden="true" className={tamano === 'fila' ? 'font-display text-[0.6875rem]' : 'font-display text-base'}>{iniciales}</AvatarFallback>
            {foto ? (
              // Imagen nativa a propósito: Next no debe copiar ni optimizar fotos FIE.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt=""
                width={medida}
                height={medida}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className={`absolute inset-0 size-full object-cover ${cargada ? '' : 'invisible'}`}
                onLoad={() => setCargada(true)}
                onError={() => { setCargada(false); setFoto(null); }}
              />
            ) : null}
          </Avatar>
        </div>
      </div>
    );
  }

  if (tamano === 'heroe') {
    return (
      <div className={`relative shrink-0 ${className ?? ''}`}>
        <div className={cn(ANILLO, 'p-[3px]')}>
          <div className="rounded-full bg-background p-[3px]">
            <Avatar
              className="size-20 max-[359px]:size-16 sm:size-36"
              aria-hidden={decorativa || undefined}
              role={decorativa ? undefined : 'img'}
              aria-label={decorativa ? undefined : cargada ? `Foto oficial de ${nombre}, FIE` : 'Foto no publicada'}
              title={cargada ? 'Foto oficial FIE' : 'Foto no publicada'}
            >
              <AvatarFallback aria-hidden="true" className="font-display text-3xl sm:text-6xl">{iniciales}</AvatarFallback>
              {foto ? (
                // Imagen nativa a propósito: Next no debe copiar ni optimizar fotos FIE.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  width={medida}
                  height={medida}
                  // Cabecera de la ficha: siempre a la vista, sin esperar al observador de lazy.
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className={`absolute inset-0 size-full object-cover ${cargada ? '' : 'invisible'}`}
                  onLoad={() => setCargada(true)}
                  onError={() => { setCargada(false); setFoto(null); }}
                />
              ) : null}
            </Avatar>
          </div>
        </div>
        {/* Sello sin enlace: no llega a 44 px; el enlace a la FIE va en los botones de la cabecera. */}
        {foto && cargada ? (
          <span className="absolute -bottom-1 left-1/2 inline-flex min-h-6 -translate-x-1/2 items-center whitespace-nowrap rounded-full border-2 border-background bg-card px-2 text-[0.6875rem] font-semibold">
            Foto FIE
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`shrink-0 ${className ?? ''}`} style={{ width: medida }}>
      <Avatar
        style={{ width: medida, height: medida }}
        className="border border-border"
        aria-hidden={decorativa || undefined}
        role={decorativa ? undefined : 'img'}
        aria-label={decorativa ? undefined : cargada ? `Foto oficial de ${nombre}, FIE` : 'Foto no publicada'}
        title={cargada ? 'Foto oficial FIE' : 'Foto no publicada'}
      >
        <AvatarFallback aria-hidden="true" className={tamano === 'perfil' ? 'font-display text-4xl' : undefined}>{iniciales}</AvatarFallback>
        {foto ? (
          // Imagen nativa a propósito: Next no debe copiar ni optimizar fotos FIE.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            width={medida}
            height={medida}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={`absolute inset-0 size-full object-cover ${cargada ? '' : 'invisible'}`}
            onLoad={() => setCargada(true)}
            onError={() => { setCargada(false); setFoto(null); }}
          />
        ) : null}
      </Avatar>
      <p className={`mt-1 break-words text-xs leading-4 text-muted-foreground ${tamano === 'mini' ? 'h-4' : 'h-8'}`}>
        {foto ? (
          <a href={foto.fichaUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {tamano === 'mini' ? 'FIE' : 'Foto FIE'}
          </a>
        ) : <span className={tamano === 'mini' ? 'sr-only' : undefined}>Foto no publicada</span>}
      </p>
    </div>
  );
}
