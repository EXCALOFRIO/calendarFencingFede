import { X } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { MarcaOlimpicaPersona } from '@/components/olimpica/burbuja-olimpica';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { Button } from '@/components/ui/button';
import type { OlimpicaPerfil } from '@/lib/sport/explorar/olimpica-perfil';
import type { PersonaParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import type { Arma } from '@/lib/sport/explorar/tipos';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { WEAPON_LABEL, cn } from '@/lib/utils';
import { BotonSeguirCompacto } from './buscador-social-seguir';
import { FotoDeportista } from './foto-deportista';

/**
 * Fila de perfil del buscador social: retrato, nombre y una sola línea pequeña
 * con bandera, lo visual (medallas, motivo) y como mucho un dato corto. El
 * enlace y el botón son hermanos (un botón no puede ir dentro de un enlace):
 * la fila es un flex con los dos.
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
  /** Marcas olímpicas vigentes: la burbuja va al lado del enlace, antes de la acción. */
  olimpica?: OlimpicaPerfil[];
};

/**
 * El único dato corto de la fila: el arma si sólo hay una (lo que más
 * distingue a dos homónimos), si no el número de pruebas, y si no las armas.
 */
export function datoCorto(p: Pick<PerfilFila, 'armas' | 'resultados'>): string | null {
  const armas = p.armas ?? [];
  if (armas.length === 1) return WEAPON_LABEL[armas[0]];
  if (typeof p.resultados === 'number' && p.resultados > 0) {
    return `${p.resultados.toLocaleString('es-ES')} ${p.resultados === 1 ? 'prueba' : 'pruebas'}`;
  }
  return armas.length > 0 ? armas.map((a) => WEAPON_LABEL[a]).join(', ') : null;
}

export const CLASE_LISTA_PERFILES = 'flex min-w-0 flex-col';

/** «Ver más» como texto de acento: 44 px de toque, sin pastilla que ocupe más que las filas. */
export const CLASE_VER_MAS =
  'inline-flex h-[44px] items-center gap-1.5 px-4 text-[13px] font-semibold text-primary-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

export function PastillaMotivo({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[18px] min-w-0 items-center rounded-full bg-secondary px-1.5 text-[12px] leading-none font-medium text-foreground">
      <span className="truncate">{children}</span>
    </span>
  );
}

export function FilaPerfil({
  p,
  href = rutaFicha(p.id),
  accion,
  idEnlace,
  meta,
  detalle,
}: {
  p: PerfilFila;
  href?: string;
  /** Botón al final de la fila: Seguir, o quitar de recientes. */
  accion?: React.ReactNode;
  idEnlace?: string;
  /** Sustituye el dato corto (p. ej. el año de un homónimo). */
  meta?: React.ReactNode;
  /** Piezas visuales tras la bandera (p. ej. las medallas). */
  detalle?: React.ReactNode;
}) {
  const nombre = nombreVisible(p.nombre) || p.nombre;
  const dato = meta ?? (p.alias && !p.motivo ? (
    <>
      <span className="sr-only">También como </span>
      <span aria-hidden="true">«</span>{p.alias}<span aria-hidden="true">»</span>
    </>
  ) : datoCorto(p));
  const hayLinea = p.pais || detalle || p.motivo || dato;
  return (
    <li className="relative flex min-w-0 items-center gap-2 rounded-xl px-0.5 hover:bg-secondary has-[a:focus-visible]:bg-secondary sm:px-3">
      <Link
        id={idEnlace}
        href={href}
        prefetch={false}
        transitionTypes={[TIPO_TRANSICION.avanzar]}
        data-fila-perfil=""
        data-persona={p.id}
        data-nombre={p.nombre}
        data-pais={p.pais ?? ''}
        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-lg py-[4px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <FotoDeportista personaId={p.id} nombre={nombre} tamano="lista" apagado={p.resultados === 0} />
        <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span className="truncate text-[14px] leading-[18px] font-semibold">{nombre}</span>
          {hayLinea ? (
            // Envuelve en vez de recortar: con el texto al 200 % las medallas no caben en una línea y no deben montar sobre Seguir.
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 py-px text-[12px] leading-none text-muted-foreground">
              {p.pais ? <BanderaPais pais={p.pais} soloBandera className="shrink-0" /> : null}
              {detalle}
              {p.motivo ? <PastillaMotivo>{p.motivo}</PastillaMotivo> : null}
              {dato && !p.motivo ? <span className="min-w-0 truncate">{dato}</span> : null}
            </span>
          ) : null}
        </span>
      </Link>
      {/* Fuera del enlace: la burbuja abre su propia explicación al tocarla. */}
      {p.olimpica?.length ? <MarcaOlimpicaPersona marcas={p.olimpica} className="shrink-0" /> : null}
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
    <div className="flex min-h-[40px] items-center justify-between gap-3 px-0.5 sm:px-3">
      <h2 id={id} className="text-[15px] font-semibold tracking-normal">{titulo}</h2>
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
        No se han podido leer las sugerencias.
      </p>
    );
  }
  if (propuestas.length === 0) return null;
  return (
    <section aria-labelledby="explorar-propuestas" className={cn('flex min-w-0 flex-col gap-1', className)}>
      <EncabezadoSeccion id="explorar-propuestas" titulo="Sugerencias" />
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
