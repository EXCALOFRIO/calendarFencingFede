'use client';

import { useState } from 'react';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import type { ArmaOlimpica, GeneroOlimpico, ResultadoPrueba } from '@/lib/ranking/olimpica';
import { rotuloArma, rotuloGenero } from '@/lib/sport/rotulos';
import { PruebaOlimpica } from './prueba-olimpica';

const ARMAS: readonly ArmaOlimpica[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: readonly GeneroOlimpico[] = ['F', 'M'];

/**
 * Proyección de LA 2028 para las seis pruebas, con selector de arma y género.
 *
 * Todo llega calculado del servidor (unas decenas de filas por prueba), así
 * que cambiar de prueba no pide nada a la red.
 */
export function ClasificacionOlimpica({
  resultados,
  nocPropio = 'ESP',
  inicial,
}: {
  resultados: ResultadoPrueba[];
  nocPropio?: string;
  inicial?: { arma: ArmaOlimpica; genero: GeneroOlimpico };
}) {
  const primera = inicial ?? resultados[0];
  const [arma, setArma] = useState<ArmaOlimpica>(primera?.arma ?? 'FLORETE');
  const [genero, setGenero] = useState<GeneroOlimpico>(primera?.genero ?? 'F');

  if (resultados.length === 0) return null;

  const hay = (a: ArmaOlimpica, g: GeneroOlimpico) =>
    resultados.some((r) => r.arma === a && r.genero === g);
  const actual =
    resultados.find((r) => r.arma === arma && r.genero === genero) ??
    resultados.find((r) => r.arma === arma) ??
    resultados[0];

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <SelectorSegmentado
          etiqueta="Arma"
          tamano="sm"
          valor={actual.arma}
          onCambio={(v) => setArma(v as ArmaOlimpica)}
          opciones={ARMAS.map((a) => ({
            valor: a,
            etiqueta: rotuloArma(a),
            deshabilitada: !resultados.some((r) => r.arma === a),
          }))}
          className="sm:flex-1"
        />
        <SelectorSegmentado
          etiqueta="Género"
          tamano="sm"
          valor={actual.genero}
          onCambio={(v) => setGenero(v as GeneroOlimpico)}
          opciones={GENEROS.map((g) => ({
            valor: g,
            etiqueta: rotuloGenero(g),
            deshabilitada: !hay(actual.arma, g),
          }))}
          className="sm:flex-1"
        />
      </div>      <PruebaOlimpica resultado={actual} nocPropio={nocPropio} />
    </div>
  );
}
