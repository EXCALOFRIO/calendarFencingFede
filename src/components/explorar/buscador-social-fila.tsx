import { X } from 'lucide-react';
import type * as React from 'react';
import { MarcaOlimpicaPersona } from '@/components/olimpica/burbuja-olimpica';
import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { Pastilla } from '@/components/sistema/pastilla';
import { Button } from '@/components/ui/button';
import type { OlimpicaPerfil } from '@/lib/sport/explorar/olimpica-perfil';
import type { PersonaParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import type { Arma } from '@/lib/sport/explorar/tipos';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { rotuloArma } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { BotonSeguirCompacto } from './buscador-social-seguir';

/**
 * Fila de perfil de Explorar (buscador, resultados, sugerencias, Siguiendo):
 * la `FilaPersona` del sistema, con el orden fijo avatar, bandera, nombre y,
 * debajo, lo visual (medallas, motivo) o un dato corto. La acción (Seguir,
 * quitar de recientes) va en las insignias, por encima del enlace que cubre
 * la fila.
 *
 * El `<li>` lleva los datos que el buscador guarda en Recientes al abrir la
 * ficha (`data-fila-perfil`, `data-persona`…); el enlace de la ficha es su
 * primer `<a>` (ver `enlaceDeFila`).
 */
export type PerfilFila = {
  id: string;
  nombre: string;
  pais: string | null;
  armas?: Arma[];
  resultados?: number;
  ultimaFecha?: string | null;
  alias?: string | null;
  /** Motivo corto de una sugerencia («Rival frecuente», «30º FIE»), en pastilla. */
  motivo?: string;
  /** Marcas olímpicas vigentes: la burbuja va con las insignias, antes de la acción. */
  olimpica?: OlimpicaPerfil[];
};

/**
 * El único dato corto de la fila: el arma si sólo hay una (lo que más
 * distingue a dos homónimos), si no el número de pruebas, y si no las armas.
 */
export function datoCorto(p: Pick<PerfilFila, 'armas' | 'resultados'>): string | null {
  const armas = p.armas ?? [];
  if (armas.length === 1) return rotuloArma(armas[0]);
  if (typeof p.resultados === 'number' && p.resultados > 0) {
    return `${p.resultados.toLocaleString('es-ES')} ${p.resultados === 1 ? 'prueba' : 'pruebas'}`;
  }
  return armas.length > 0 ? armas.map((a) => rotuloArma(a)).join(', ') : null;
}

export const CLASE_LISTA_PERFILES = 'flex min-w-0 flex-col';

/** Selector de las filas de perfil de una lista (para el teclado y los Recientes). */
export const SELECTOR_FILA_PERFIL = '[data-fila-perfil]';

/** El enlace a la ficha de una fila de perfil: el primero de la fila. */
export function enlaceDeFila(fila: Element | null | undefined): HTMLAnchorElement | null {
  return fila?.querySelector<HTMLAnchorElement>('a[href]') ?? null;
}

export function PastillaMotivo({ children }: { children: React.ReactNode }) {
  return (
    <Pastilla className="min-w-0">
      <span className="truncate">{children}</span>
    </Pastilla>
  );
}

export function FilaPerfil({
  p,
  href = rutaFicha(p.id),
  accion,
  meta,
  detalle,
  className,
}: {
  p: PerfilFila;
  href?: string;
  /** Botón al final de la fila: Seguir, o quitar de recientes. */
  accion?: React.ReactNode;
  /** Sustituye el dato corto (p. ej. el año de un homónimo). */
  meta?: React.ReactNode;
  /** Piezas visuales de la segunda línea (p. ej. las medallas). */
  detalle?: React.ReactNode;
  className?: string;
}) {
  const nombre = nombreVisible(p.nombre) || p.nombre;
  const dato = meta ?? (p.alias && !p.motivo ? (
    <>
      <span className="sr-only">También como </span>
      <span aria-hidden="true">«</span>{p.alias}<span aria-hidden="true">»</span>
    </>
  ) : datoCorto(p));
  const linea = detalle || p.motivo || dato ? (
    <span className="flex min-w-0 items-center gap-2">
      {detalle}
      {p.motivo ? <PastillaMotivo>{p.motivo}</PastillaMotivo> : null}
      {dato && !p.motivo ? <span className="min-w-0 truncate">{dato}</span> : null}
    </span>
  ) : null;
  const insignias = p.olimpica?.length || accion ? (
    <>
      {p.olimpica?.length ? <MarcaOlimpicaPersona marcas={p.olimpica} className="shrink-0" /> : null}
      {accion}
    </>
  ) : null;
  return (
    <li
      data-fila-perfil=""
      data-persona={p.id}
      data-nombre={p.nombre}
      data-pais={p.pais ?? ''}
      className={cn('min-w-0', className)}
    >
      <FilaPersona persona={{ id: p.id, nombre, pais: p.pais }} href={href} meta={linea} insignias={insignias} />
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

/** Propuestas para seguir: en Tiradores sin texto, en «Para ti» y en Siguiendo vacíos. */
export function PropuestasBuscador({
  propuestas,
  className,
}: {
  propuestas: PersonaParaSeguir[] | null;
  className?: string;
}) {
  if (propuestas === null) {
    return <p className={cn('text-sm text-muted-foreground', className)}>No se han podido leer las sugerencias.</p>;
  }
  if (propuestas.length === 0) return null;
  return (
    <section aria-labelledby="explorar-propuestas" className={cn('flex min-w-0 flex-col', className)}>
      <CabeceraSeccion id="explorar-propuestas" titulo="Sugerencias" />
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
