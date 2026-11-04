'use client';

import { useState } from 'react';
import { PruebaOlimpica } from './prueba-olimpica';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { capitalizar } from '@/lib/utils';
import type { PersonaOlimpica } from '@/lib/queries/olimpica';
import type { ArmaOlimpica, GeneroOlimpico, ResultadoPrueba } from '@/lib/ranking/olimpica';

const ARMAS: readonly ArmaOlimpica[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: readonly { valor: GeneroOlimpico; etiqueta: string }[] = [
  { valor: 'F', etiqueta: 'Femenino' },
  { valor: 'M', etiqueta: 'Masculino' },
];

/**
 * Las seis proyecciones ya vienen cargadas con la página: cambiar de arma o
 * de género sólo elige otra — sin pedir nada al servidor, como cambiar de
 * arma en el ranking. La URL (`?prueba=ESPADA-M`) se actualiza sin
 * navegar para que el enlace siga siendo compartible y el botón del
 * ranking caiga en la prueba que anuncia.
 */
export function SeleccionOlimpica({
  resultados,
  personas,
  pruebaInicial,
  nocPropio,
}: {
  resultados: ResultadoPrueba[];
  personas: Record<string, PersonaOlimpica[]>;
  pruebaInicial: string;
  nocPropio?: string;
}) {
  const [clave, setClave] = useState(pruebaInicial);
  const [armaSel, generoSel] = clave.split('-') as [ArmaOlimpica, GeneroOlimpico];
  const sel = resultados.find((r) => r.arma === armaSel && r.genero === generoSel) ?? null;

  const cambiar = (arma: string, genero?: string) => {
    const a = (arma ?? armaSel) as ArmaOlimpica;
    const g = (genero ?? generoSel) as GeneroOlimpico;
    setClave(`${a}-${g}`);
    window.history.replaceState(null, '', `/olimpica?prueba=${a}-${g}`);
  };

  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        <SelectorSegmentado
          etiqueta="Arma"
          valor={armaSel}
          opciones={ARMAS.map((a) => ({ valor: a, etiqueta: capitalizar(a.toLowerCase()) }))}
          onCambio={(a) => cambiar(a)}
        />
        <SelectorSegmentado
          etiqueta="Género"
          valor={generoSel}
          opciones={GENEROS.map((g) => ({ valor: g.valor, etiqueta: g.etiqueta }))}
          onCambio={(g) => cambiar(armaSel, g)}
        />
      </div>
      {sel ? (
        <PruebaOlimpica
          resultado={sel}
          personas={personas[`${sel.arma}-${sel.genero}`] ?? []}
          nocPropio={nocPropio}
        />
      ) : (
        <EstadoVacio
          titulo="Sin ranking completo todavía"
          descripcion={`La FIE aún no ha publicado el ranking de ${rotuloPrueba({ arma: armaSel, genero: generoSel })} de la temporada.`}
        />
      )}
    </>
  );
}
