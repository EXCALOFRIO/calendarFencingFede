'use client';

import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { fotoPublicadaValida, type FotoPublicada } from '@/lib/sport/explorar/foto-contrato';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { ANILLO } from './avatar-anillo';

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
   */
  tamano?: 'mini' | 'retrato' | 'perfil' | 'heroe';
  className?: string;
};

const MEDIDAS = { mini: 48, retrato: 96, perfil: 120, heroe: 144 } as const;

export function FotoDeportista({ ocultar = false, ...props }: FotoDeportistaProps) {
  // La clave descarta también una imagen anterior al cambiar de persona.
  return ocultar ? null : <Retrato key={props.personaId} {...props} />;
}

function Retrato({
  personaId, nombre, decorativa = true, tamano = 'retrato', className,
}: Omit<FotoDeportistaProps, 'ocultar'>) {
  const [foto, setFoto] = useState<FotoPublicada | null>(null);
  const [cargada, setCargada] = useState(false);
  const medida = MEDIDAS[tamano];
  const iniciales = inicialesVisibles(nombre) || '—';

  useEffect(() => {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 7000);
    async function cargar() {
      try {
        const respuesta = await fetch(`/api/explorar/deportistas/${encodeURIComponent(personaId)}/foto`, {
          cache: 'no-store', credentials: 'same-origin', signal: controlador.signal,
          headers: { Accept: 'application/json' },
        });
        if (!respuesta.ok || !respuesta.headers.get('content-type')?.startsWith('application/json')) return;
        const texto = await respuesta.text();
        if (texto.length > 4096 || controlador.signal.aborted) return;
        const valor: unknown = JSON.parse(texto);
        if (!valor || typeof valor !== 'object') return;
        const resultado = valor as Record<string, unknown>;
        if (resultado.estado === 'publicada' && fotoPublicadaValida(resultado.foto)) setFoto(resultado.foto);
      } catch {
        // Ausencia, caducidad y errores de red dejan las iniciales, nunca un icono roto.
      } finally {
        clearTimeout(temporizador);
      }
    }
    void cargar();
    return () => { clearTimeout(temporizador); controlador.abort(); };
  }, [personaId]);

  if (tamano === 'heroe') {
    return (
      <div className={`relative shrink-0 ${className ?? ''}`}>
        <div className={cn(ANILLO, 'p-[3px]')}>
          <div className="rounded-full bg-background p-[3px]">
            <Avatar
              className="size-20 sm:size-36"
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
                  src={foto.src}
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
            src={foto.src}
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
