import { X } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import type { PersonaParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import type { Arma } from '@/lib/sport/explorar/tipos';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { WEAPON_LABEL, cn } from '@/lib/utils';
import { BotonSeguirCompacto } from './buscador-social-seguir';
import { FotoDeportista } from './foto-deportista';

/**
 * Fila de perfil del buscador social: retrato, nombre, país y armas, y una
 * línea de actividad. El enlace y el botón son hermanos (un botón no puede ir
 * dentro de un enlace): la fila es un flex con los dos.
 */
export type PerfilFila = {
  id: string;
  nombre: string;
  pais: string | null;
  armas?: Arma[];
  resultados?: number;
  ultimaFecha?: string | null;
  alias?: string | null;
  /** Sustituye la línea de actividad (p. ej. «Rival frecuente tuyo»). */
  motivo?: string;
};

export function lineaActividad(p: Pick<PerfilFila, 'resultados' | 'ultimaFecha'>): string | null {
  if (typeof p.resultados !== 'number') return null;
  if (p.resultados === 0) return 'Sin competiciones importadas';
  const n = `${p.resultados.toLocaleString('es-ES')} ${p.resultados === 1 ? 'competición' : 'competiciones'}`;
  const anio = p.ultimaFecha && /^\d{4}/.test(p.ultimaFecha) ? p.ultimaFecha.slice(0, 4) : null;
  return anio ? `${n} · última ${anio}` : n;
}

export const CLASE_LISTA_PERFILES = 'flex min-w-0 flex-col';

export function FilaPerfil({
  p,
  href = rutaFicha(p.id),
  accion,
  idEnlace,
}: {
  p: PerfilFila;
  href?: string;
  /** Botón al final de la fila: Seguir, o quitar de recientes. */
  accion?: React.ReactNode;
  idEnlace?: string;
}) {
  const nombre = nombreVisible(p.nombre) || p.nombre;
  const armas = p.armas ?? [];
  const actividad = p.motivo ?? lineaActividad(p);
  return (
    <li className="relative flex min-w-0 items-center gap-2 rounded-xl px-0.5 hover:bg-accent/50 has-[a:focus-visible]:bg-accent/50 sm:px-3">
      <Link
        id={idEnlace}
        href={href}
        prefetch={false}
        data-fila-perfil=""
        data-persona={p.id}
        data-nombre={p.nombre}
        data-pais={p.pais ?? ''}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg py-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <FotoDeportista personaId={p.id} nombre={nombre} tamano="lista" apagado={p.resultados === 0} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[0.9375rem] leading-tight font-semibold">{nombre}</span>
          {p.pais || armas.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {p.pais ? <BanderaPais pais={p.pais} className="shrink-0" /> : null}
              {armas.length > 0 ? (
                <span className="truncate">
                  <span className="sr-only">Armas: </span>
                  {p.pais ? <span aria-hidden="true">· </span> : null}
                  {armas.map((a) => WEAPON_LABEL[a]).join(', ')}
                </span>
              ) : null}
            </span>
          ) : null}
          {actividad ? <span className="truncate text-xs text-muted-foreground">{actividad}</span> : null}
          {p.alias && !p.motivo ? (
            <span className="truncate text-xs text-muted-foreground">Publicado también como {p.alias}</span>
          ) : null}
        </span>
      </Link>
      {accion}
    </li>
  );
}

/** Botón X de una fila de recientes. */
export function BotonQuitarReciente({ nombre, onQuitar }: { nombre: string; onQuitar: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="rounded-full text-muted-foreground hover:text-foreground"
      aria-label={`Quitar a ${nombre} de recientes`}
      onClick={onQuitar}
    >
      <X aria-hidden />
    </Button>
  );
}

export function EncabezadoSeccion({ id, titulo, children }: { id: string; titulo: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-0.5 sm:px-3">
      <h2 id={id} className="text-base font-semibold tracking-normal">{titulo}</h2>
      {children}
    </div>
  );
}

/** Propuestas para seguir en la pantalla vacía de Explorar, como filas de perfil. */
export function PropuestasBuscador({
  propuestas,
  className,
}: {
  propuestas: PersonaParaSeguir[] | null;
  className?: string;
}) {
  if (propuestas === null) {
    return (
      <p className={cn('px-0.5 text-sm text-muted-foreground sm:px-3', className)}>
        No se han podido leer las sugerencias para seguir. Busca a quien quieras por su nombre.
      </p>
    );
  }
  if (propuestas.length === 0) return null;
  return (
    <section aria-labelledby="explorar-propuestas" className={cn('flex min-w-0 flex-col gap-1', className)}>
      <EncabezadoSeccion id="explorar-propuestas" titulo="Sugerencias para seguir" />
      <ul className={CLASE_LISTA_PERFILES} aria-labelledby="explorar-propuestas">
        {propuestas.map((p) => (
          <FilaPerfil
            key={p.id}
            p={p}
            accion={<BotonSeguirCompacto personaId={p.id} nombre={nombreVisible(p.nombre) || p.nombre} inicial={false} lectura={p} />}
          />
        ))}
      </ul>
    </section>
  );
}
