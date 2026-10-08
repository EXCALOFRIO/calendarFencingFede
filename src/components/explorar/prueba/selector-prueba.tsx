'use client';

import { SelectorNiveles } from '@/components/sistema/selector-niveles';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { SEPARADOR } from '@/lib/sport/rotulos';
import type { FilaNivel } from '@/lib/sport/selector-pruebas';

/** Una fila extra del selector: grupos de la misma prueba o la misma prueba en otra fuente. */
export type GruposDePrueba = { activa: string; opciones: { valor: string; etiqueta: string; href: string }[] };

/**
 * El selector de prueba de toda la aplicación: lo que no cambia en una línea
 * («Espada femenina · Absoluto»), una fila por arma, género, modalidad y, si
 * cambia, categoría (`filasSelectorPruebas`), y debajo, sólo si existen, los
 * grupos de la misma prueba (edades de veteranos, días) y las fuentes que la
 * publican dos veces. Las opciones son enlaces a `?prueba=` que sustituyen la
 * entrada del historial y no mueven la página: ir de Espada a Sable no apila
 * pasos atrás y la dirección sigue siendo un enlace válido a esa prueba.
 */
export function SelectorPruebaPorNiveles({
  filas,
  grupos,
  fuentes,
  resumen = [],
}: {
  filas: readonly FilaNivel[];
  grupos?: GruposDePrueba;
  fuentes?: GruposDePrueba;
  /** Lo que no tiene fila porque sólo hay un valor: «Espada femenina», «Absoluto». */
  resumen?: readonly string[];
}) {
  if (filas.length === 0 && !grupos && !fuentes && resumen.length === 0) return null;
  return (
    <div role="group" aria-label="Elegir prueba" className="flex min-w-0 flex-col gap-2">
      {resumen.length ? (
        <p className="text-sm text-muted-foreground">
          {resumen.map((r, i) => (
            <span key={r}>
              {i ? SEPARADOR : null}
              <span className={i ? undefined : 'font-medium text-foreground'}>{r}</span>
            </span>
          ))}
        </p>
      ) : null}
      <SelectorNiveles filas={filas} replace scroll={false} />
      {grupos ? <FilaExtra etiqueta="Grupo" fila={grupos} /> : null}
      {/* Subrayada: es secundaria, casi siempre basta la fuente que se abre por defecto. */}
      {fuentes ? <FilaExtra etiqueta="Fuente" fila={fuentes} variante="subrayado" /> : null}
    </div>
  );
}

function FilaExtra({ etiqueta, fila, variante = 'pastilla' }: { etiqueta: string; fila: GruposDePrueba; variante?: 'pastilla' | 'subrayado' }) {
  return (
    <SelectorSegmentado
      etiqueta={etiqueta}
      variante={variante}
      tamano="sm"
      anchoMinimo={4}
      replace
      scroll={false}
      valor={fila.activa}
      opciones={fila.opciones}
    />
  );
}
