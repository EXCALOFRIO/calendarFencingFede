'use client';

import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { fotoPublicadaValida, type FotoPublicada } from '@/lib/sport/explorar/foto-contrato';

export type FotoDeportistaProps = {
  /** ID público de la persona deportiva, nunca athleteId/profileId. */
  personaId: string;
  nombre: string;
  /** El encabezado puede suprimir el componente; no se hace ninguna petición. */
  ocultar?: boolean;
  /** Junto a un nombre visible el retrato es decorativo. */
  decorativa?: boolean;
  tamano?: 'mini' | 'retrato';
  className?: string;
};

export function FotoDeportista({ ocultar = false, ...props }: FotoDeportistaProps) {
  // La clave descarta también una imagen anterior al cambiar de persona.
  return ocultar ? null : <Retrato key={props.personaId} {...props} />;
}

function Retrato({
  personaId, nombre, decorativa = true, tamano = 'retrato', className,
}: Omit<FotoDeportistaProps, 'ocultar'>) {
  const [foto, setFoto] = useState<FotoPublicada | null>(null);
  const [cargada, setCargada] = useState(false);
  const medida = tamano === 'mini' ? 48 : 96;
  const iniciales = nombre.trim().split(/\s+/u).slice(0, 2)
    .map((p) => Array.from(p)[0] ?? '').join('').toLocaleUpperCase('es') || '—';

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
        <AvatarFallback aria-hidden="true">{iniciales}</AvatarFallback>
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
