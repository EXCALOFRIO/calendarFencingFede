import type { TablaNacional } from '@/lib/queries/ranking-temporadas';
import { titular } from '@/lib/utils';
import { FilaLinea } from './fila-linea';

/**
 * Clasificación nacional de una temporada pasada, con las mismas filas de una
 * línea que la vigente: puesto, retrato, nombre enlazado a su perfil cuando
 * está vinculado y puntos.
 */
export function TablaTemporada({ tabla, mios = [] }: { tabla: TablaNacional; mios?: readonly string[] }) {
  const propios = new Set(mios);
  if (tabla.filas.length === 0) return null;
  return (
    <ol
      aria-label={`Clasificación ${tabla.temporada}`}
      className="grid w-full min-w-0 max-w-3xl gap-px overflow-hidden rounded-xl border bg-border"
    >
      {tabla.filas.map((f, i) => (
        <FilaLinea
          key={`${f.puesto}-${i}`}
          puesto={f.puesto}
          nombre={f.nombre ? titular(f.nombre) : ''}
          personaId={f.personaId}
          puntos={f.puntos}
          mio={f.personaId !== null && propios.has(f.personaId)}
        />
      ))}
    </ol>
  );
}
