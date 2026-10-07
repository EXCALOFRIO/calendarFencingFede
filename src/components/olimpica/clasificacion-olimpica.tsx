'use client';

import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ArmaOlimpica, GeneroOlimpico, ResultadoPrueba } from '@/lib/ranking/olimpica';
import { PruebaOlimpica } from './prueba-olimpica';

const ARMAS: { valor: ArmaOlimpica; rotulo: string }[] = [
  { valor: 'FLORETE', rotulo: 'Florete' },
  { valor: 'ESPADA', rotulo: 'Espada' },
  { valor: 'SABLE', rotulo: 'Sable' },
];

const GENEROS: { valor: GeneroOlimpico; rotulo: string }[] = [
  { valor: 'F', rotulo: 'Femenino' },
  { valor: 'M', rotulo: 'Masculino' },
];

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
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={actual.arma}
          onValueChange={(v) => {
            if (v) setArma(v as ArmaOlimpica);
          }}
          aria-label="Arma"
        >
          {ARMAS.map((a) => (
            <ToggleGroupItem
              key={a.valor}
              value={a.valor}
              disabled={!resultados.some((r) => r.arma === a.valor)}
            >
              {a.rotulo}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={actual.genero}
          onValueChange={(v) => {
            if (v) setGenero(v as GeneroOlimpico);
          }}
          aria-label="Género"
        >
          {GENEROS.map((g) => (
            <ToggleGroupItem key={g.valor} value={g.valor} disabled={!hay(actual.arma, g.valor)}>
              {g.rotulo}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <PruebaOlimpica resultado={actual} nocPropio={nocPropio} />
    </div>
  );
}
