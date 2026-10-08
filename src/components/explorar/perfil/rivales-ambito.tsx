import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { AmbitoRivales, ListasRivales, RivalAmbito, RivalesPorAmbito } from '@/lib/sport/explorar/rivales-ambito';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { BarraVictorias } from '../barra-victorias';
import { Bloque, type Nivel } from '../piezas';
import { Paneles } from './paneles';

const OPCIONES: { clave: AmbitoRivales; rotulo: string }[] = [
  { clave: 'todos', rotulo: 'Todos' },
  { clave: 'nacional', rotulo: 'Nacional' },
  { clave: 'internacional', rotulo: 'Internacional' },
];

const SECCIONES: { clave: keyof Omit<ListasRivales, 'rivales'>; titulo: string; vacio: string }[] = [
  { clave: 'masEnfrentados', titulo: 'Más enfrentados', vacio: 'Sin rivales identificados' },
  { clave: 'aQuienMasGana', titulo: 'A quién más gana', vacio: 'Sin victorias' },
  { clave: 'quienMasLeGana', titulo: 'Quién más le gana', vacio: 'Sin derrotas' },
];

function FilaRival({ personaId, r }: { personaId: string; r: RivalAmbito }) {
  const nombre = nombreVisible(r.nombre) || r.nombre;
  return (
    <li data-rival={r.id} className="px-3 sm:px-4">
      <FilaPersona
        persona={{ id: r.id, nombre, pais: r.pais }}
        href={construirUrlCaraACara(personaId, { rival: r.id })}
        meta={`${r.asaltos} ${r.asaltos === 1 ? 'asalto' : 'asaltos'}`}
        densidad="compacta"
        insignias={<BarraVictorias victorias={r.victorias} derrotas={r.derrotas} className="w-24 sm:w-48" />}
      />
    </li>
  );
}

function Panel({ personaId, listas, encabezado }: { personaId: string; listas: ListasRivales; encabezado: 'h3' | 'h4' }) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-3 lg:gap-4">
      {SECCIONES.map((s) => (
        <section key={s.clave} data-seccion={s.clave} className="flex min-w-0 flex-col gap-2">
          <CabeceraSeccion titulo={s.titulo} nivel="grupo" como={encabezado} />
          {listas[s.clave].length === 0 ? (
            <EstadoVacio titulo={s.vacio} className="rounded-xl border bg-card py-6" />
          ) : (
            <ol className="divide-y overflow-hidden rounded-xl border bg-card" aria-label={s.titulo}>
              {listas[s.clave].map((r) => <FilaRival key={r.id} personaId={personaId} r={r} />)}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * Más enfrentados, a quién más gana y quién más le gana, con un selector
 * Todos / Nacional / Internacional (sólo el panel elegido entra en el DOM).
 * Cada fila abre directamente el cara a cara con ese rival; su balance es el
 * mismo que se ve allí.
 */
export function RivalesPorAmbitoVista({
  personaId,
  datos,
  nivel,
  id = 'ficha-rivales-ambito',
}: {
  personaId: string;
  datos: RivalesPorAmbito | null;
  nivel: Nivel;
  id?: string;
}) {
  if (datos === null) {
    return <EstadoVacio tipo="error" titulo="No se han podido cargar" descripcion="Inténtalo de nuevo en un momento." />;
  }
  if (datos.todos.rivales === 0) {
    return <EstadoVacio titulo="Sin rivales identificados" />;
  }
  const opciones = OPCIONES.filter((o) => o.clave === 'todos' || datos[o.clave].rivales > 0);
  const visibles = opciones.length > 2 ? opciones : opciones.slice(0, 1);
  const encabezado = nivel === 'pagina' ? 'h3' : 'h4';
  return (
    <Bloque id={id} titulo="Rivales" nivel={nivel} tituloOculto>
      <Paneles
        etiqueta="Qué competiciones contar"
        opciones={visibles.map((o) => ({ valor: o.clave, etiqueta: o.rotulo, cuenta: datos[o.clave].rivales }))}
        paneles={Object.fromEntries(visibles.map((o) => [
          o.clave,
          <div key={o.clave} data-ambito={o.clave} className="min-w-0">
            <Panel personaId={personaId} listas={datos[o.clave]} encabezado={encabezado} />
          </div>,
        ]))}
      />
    </Bloque>
  );
}
