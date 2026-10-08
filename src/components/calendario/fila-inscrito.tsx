import { FilaPersona } from '@/components/sistema/fila-persona';
import { PastillaRanking } from '@/components/sistema/pastilla';
import type { InscritoPublicado, PuestoInscrito } from '@/lib/entries/union';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { titular } from '@/lib/utils';

/**
 * Un inscrito de la lista oficial con la fila de persona de toda la
 * aplicación: avatar, bandera y nombre, y a la derecha sus puestos FIE y RFEE.
 * Todas las filas tienen las mismas columnas, enlacen o no y sean de persona
 * o de equipo, así que los nombres caen en la misma vertical.
 *
 * Toda la fila lleva al perfil de Explorar cuando la persona está demostrada
 * por un ID o una licencia (`personaDeFila`); si no, no enlaza: un homónimo
 * nunca hereda el perfil de otro. El club no sale: en las listas de personas
 * sólo va la nacionalidad. El retrato pasa por la ruta de fotos, que aplica el
 * veto de menores: a quien pueda serlo le quedan las iniciales.
 */
export function FilaInscrito({ inscrito }: { inscrito: InscritoPublicado }) {
  const personaId = inscrito.personaId ?? null;
  const extra = inscrito.extra ?? null;
  // Una fila de equipo sin persona puede ser el nombre del equipo, no de un tirador.
  const equipo = Boolean(inscrito.equipo) && !personaId;
  const nombre = equipo ? titular(inscrito.nombre) : nombreVisible(inscrito.nombre) || titular(inscrito.nombre);
  const insignias =
    extra?.mundial || extra?.nacional ? (
      <>
        {extra.mundial ? <Ranking fuente="FIE" p={extra.mundial} /> : null}
        {extra.nacional ? <Ranking fuente="RFEE" p={extra.nacional} /> : null}
      </>
    ) : null;

  return (
    <FilaPersona
      persona={{ id: personaId, nombre, pais: extra?.pais ?? null }}
      href={personaId ? `${RUTA_EXPLORAR}/${personaId}` : undefined}
      equipo={equipo}
      propia={inscrito.esMio}
      insignias={insignias}
      apilar
    />
  );
}

/** «FIE #23»; «RFEE Abs #4» cuando el puesto es del absoluto y no de la categoría de la prueba. */
function Ranking({ fuente, p }: { fuente: string; p: PuestoInscrito }) {
  return <PastillaRanking fuente={p.absoluto ? `${fuente} Abs` : fuente} puesto={p.puesto} />;
}
