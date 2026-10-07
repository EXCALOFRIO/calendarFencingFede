import { TriangleAlert } from 'lucide-react';
import { EnlacePrecarga } from '@/components/sistema/enlace-precarga';
import { BanderaPais } from '@/components/bandera';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import type { AmbitoRivales, ListasRivales, RivalAmbito, RivalesPorAmbito } from '@/lib/sport/explorar/rivales-ambito';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { BarraVictorias } from '../barra-victorias';
import { FotoDeportista } from '../foto-deportista';
import { Bloque, type Nivel } from '../piezas';

const OPCIONES: { clave: AmbitoRivales; rotulo: string }[] = [
  { clave: 'todos', rotulo: 'Todos' },
  { clave: 'nacional', rotulo: 'Nacional' },
  { clave: 'internacional', rotulo: 'Internacional' },
];

// Clases enteras (Tailwind no ve las montadas en ejecución); el cambio es
// sólo CSS, con radios y `:has(:checked)`, como el selector de Rendimiento.
const PANEL: Record<AmbitoRivales, string> = {
  todos: 'group-has-[.riv-todos:checked]/riv:flex',
  nacional: 'group-has-[.riv-nacional:checked]/riv:flex',
  internacional: 'group-has-[.riv-internacional:checked]/riv:flex',
};
const RADIO: Record<AmbitoRivales, string> = {
  todos: 'riv-todos',
  nacional: 'riv-nacional',
  internacional: 'riv-internacional',
};

const SECCIONES: { clave: keyof Omit<ListasRivales, 'rivales'>; titulo: string; vacio: string }[] = [
  { clave: 'masEnfrentados', titulo: 'Más enfrentados', vacio: 'Sin asaltos con rival identificado.' },
  { clave: 'aQuienMasGana', titulo: 'A quién más gana', vacio: 'Ninguna victoria con rival identificado.' },
  { clave: 'quienMasLeGana', titulo: 'Quién más le gana', vacio: 'Ninguna derrota con rival identificado.' },
];

function FilaRival({ personaId, r }: { personaId: string; r: RivalAmbito }) {
  const nombre = nombreVisible(r.nombre) || r.nombre;
  return (
    <li>
      <EnlacePrecarga
        href={construirUrlCaraACara(personaId, { rival: r.id })}
        data-rival={r.id}
        className="grid min-h-[44px] min-w-0 grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-2.5 px-3 py-1.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none max-[359px]:grid-cols-[minmax(0,1fr)_5.75rem] sm:grid-cols-[minmax(0,1fr)_12rem] sm:px-4"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <FotoDeportista personaId={r.id} nombre={nombre} tamano="fila" apagado />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {r.pais ? <BanderaPais pais={r.pais} soloBandera className="shrink-0" /> : null}
              <span className="truncate text-sm font-medium">{nombre}</span>
            </span>
            <span className="text-[12px] leading-tight text-muted-foreground">
              {r.asaltos} {r.asaltos === 1 ? 'asalto' : 'asaltos'}
            </span>
          </span>
        </span>
        <BarraVictorias victorias={r.victorias} derrotas={r.derrotas} />
      </EnlacePrecarga>
    </li>
  );
}

function Panel({ personaId, listas, encabezado }: { personaId: string; listas: ListasRivales; encabezado: 'h3' | 'h4' }) {
  const H = encabezado;
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-3 lg:gap-4">
      {SECCIONES.map((s) => (
        <section key={s.clave} data-seccion={s.clave} className="flex min-w-0 flex-col gap-2">
          <H className="text-base font-semibold">{s.titulo}</H>
          {listas[s.clave].length === 0 ? (
            <p className="rounded-xl border bg-card px-3 py-3 text-sm text-muted-foreground">{s.vacio}</p>
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
 * Todos / Nacional / Internacional que funciona sin JavaScript. Cada fila abre
 * el cara a cara con ese rival; su balance es el mismo que se ve allí.
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
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border bg-card px-3 py-3 text-sm">
        <TriangleAlert className="size-4 shrink-0 text-warn" aria-hidden />
        <p>No se han podido cargar los rivales.</p>
      </div>
    );
  }
  if (datos.todos.rivales === 0) {
    return <p role="status" className="text-sm text-muted-foreground">Sin asaltos importados con rival identificado.</p>;
  }
  const opciones = OPCIONES.filter((o) => o.clave === 'todos' || datos[o.clave].rivales > 0);
  const conSelector = opciones.length > 2;
  const encabezado = nivel === 'pagina' ? 'h3' : 'h4';
  return (
    <Bloque id={id} titulo="Rivales" nivel={nivel} tituloOculto>
      <div className="group/riv flex min-w-0 flex-col gap-4">
        {conSelector ? (
          <fieldset className="min-w-0">
            <legend className="sr-only">Qué competiciones contar</legend>
            <div className="grid w-full grid-cols-3 gap-1 rounded-full border bg-card p-1 sm:inline-flex sm:w-auto">
              {opciones.map((o) => (
                <label
                  key={o.clave}
                  className={cn(
                    'relative inline-flex min-h-[40px] min-w-0 cursor-pointer flex-col items-center justify-center rounded-full px-2 py-1 text-center text-[0.8125rem] leading-tight text-muted-foreground sm:flex-row sm:gap-x-1.5 sm:px-4 sm:text-sm',
                    'hover:text-foreground has-[:checked]:bg-marcado has-[:checked]:font-semibold has-[:checked]:text-primary-text',
                    'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring',
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-ambito`}
                    value={o.clave}
                    defaultChecked={o.clave === 'todos'}
                    className={cn(RADIO[o.clave], 'sr-only')}
                  />
                  <span>{o.rotulo}</span>
                  <span className="cifra text-base leading-none" title="Rivales distintos">{datos[o.clave].rivales}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {(conSelector ? opciones : opciones.slice(0, 1)).map((o) => (
          <div
            key={o.clave}
            data-ambito={o.clave}
            className={cn('min-w-0 flex-col', conSelector ? cn('hidden', PANEL[o.clave]) : 'flex')}
          >
            <Panel personaId={personaId} listas={datos[o.clave]} encabezado={encabezado} />
          </div>
        ))}
      </div>
    </Bloque>
  );
}
