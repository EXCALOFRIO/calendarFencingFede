'use client';

import { ExternalLink, FileText } from 'lucide-react';
import * as React from 'react';
import { Boton } from '@/components/sistema/boton';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { Pastilla } from '@/components/sistema/pastilla';
import type { DatoExtraidoView } from '@/lib/queries/calendar';
import { titular, titularDocumento } from '@/lib/utils';
import { rotuloLimpio } from './datos-ficha';

/**
 * La procedencia de un apartado de la ficha: UN botón discreto al pie,
 * «Según la convocatoria», que abre una hoja con la frase literal de cada dato
 * que ese apartado ha leído del PDF, si alguien la ha revisado y el enlace al
 * documento. Sustituye a la marca que iba pegada detrás de cada valor.
 */

export type Cita = {
  dato: DatoExtraidoView;
  /** Cómo se llama el dato en la ficha («Cuota de inscripción»); si no, su etiqueta. */
  rotulo?: string;
  /** El valor tal como se enseña («80 €»); si no, el leído. */
  valor?: string;
};

type Entrada = Cita | { clave?: string; rotulo: string; valor: string; dato: DatoExtraidoView | null } | DatoExtraidoView | null | undefined;

function esDato(e: NonNullable<Entrada>): e is DatoExtraidoView {
  return 'cita' in e && 'campo' in e;
}

/** Una cita por dato, en el orden en que llegan, sin los que no vienen del PDF. */
export function citasDe(entradas: readonly Entrada[]): Cita[] {
  const vistas = new Set<string>();
  const salida: Cita[] = [];
  for (const e of entradas) {
    if (!e) continue;
    const cita: Cita | null = esDato(e) ? { dato: e } : e.dato ? { dato: e.dato, rotulo: e.rotulo, valor: e.valor } : null;
    if (!cita || vistas.has(cita.dato.id)) continue;
    vistas.add(cita.dato.id);
    salida.push(cita);
  }
  return salida;
}

export function SegunConvocatoria({ citas }: { citas: readonly Cita[] }) {
  const [abierta, setAbierta] = React.useState(false);
  if (citas.length === 0) return null;

  return (
    <HojaInferior
      abierta={abierta}
      alCambiar={setAbierta}
      titulo="Según la convocatoria"
      disparador={
        <Boton variante="fantasma" tamano="sm" className="self-start text-muted-foreground" data-slot="segun-convocatoria">
          <FileText aria-hidden />
          Según la convocatoria
        </Boton>
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {citas.map(({ dato, rotulo, valor }) => {
          const revisado = dato.estado === 'aprobado';
          return (
            <li key={dato.id} className="flex flex-col gap-2 py-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 text-sm text-muted-foreground">{rotulo ?? rotuloLimpio(dato)}</span>
                <Pastilla tono={revisado ? 'ok' : 'aviso'}>{revisado ? 'Revisado' : 'Sin verificar'}</Pastilla>
              </div>
              <p className="min-w-0 break-words text-base font-medium text-foreground">{valor ?? titular(dato.valor)}</p>
              {/*
                La frase, literal: ni se recorta ni se retocan sus mayúsculas,
                porque es la prueba de que el dato existe. Los saltos de línea
                del PDF se conservan: en una dirección, son la dirección.
              */}
              <blockquote className="border-l-2 border-primary-text pl-3 text-sm whitespace-pre-line text-foreground">
                «{dato.cita.trim()}»
              </blockquote>
              <Boton asChild variante="contorno" tamano="sm" className="max-w-full self-start">
                <a
                  href={dato.documento.url}
                  target="_blank"
                  rel="noreferrer"
                  title={dato.documento.titulo ? titularDocumento(dato.documento.titulo) : undefined}
                >
                  <ExternalLink aria-hidden />
                  PDF
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              </Boton>
            </li>
          );
        })}
      </ul>
    </HojaInferior>
  );
}
