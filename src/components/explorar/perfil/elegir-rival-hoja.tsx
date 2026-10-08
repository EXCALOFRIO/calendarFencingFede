'use client';

import { Search, Swords, UserRoundSearch } from 'lucide-react';
import * as React from 'react';
import { Boton, BotonIcono } from '@/components/sistema/boton';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { construirUrlCaraACara, rutaCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { crearSolicitanteSugerencias, type EstadoSugerencias } from '@/lib/sport/explorar/sugerencias-cliente';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { rotuloArma } from '@/lib/sport/rotulos';

/**
 * «Cara a cara» de la cabecera del perfil: abre una hoja con un buscador de
 * rival (las mismas sugerencias que el buscador de Explorar) y cada fila va
 * directa al duelo. Así elegir rival no es otra pantalla en el historial.
 *
 * Es un enlace a `/explorar/[id]/cara-a-cara`: sin JavaScript, o con
 * Ctrl/⌘ para abrirlo aparte, lleva a la página de elegir rival de siempre.
 */
export function CaraACaraHoja({
  personaId,
  nombre,
  rotulo = 'Cara a cara',
  icono = false,
}: {
  personaId: string;
  nombre: string;
  rotulo?: string;
  /** Botón redondo de sólo icono («Cambiar de rival» en la cabecera del duelo). */
  icono?: boolean;
}) {
  const [abierta, setAbierta] = React.useState(false);
  // Se monta al abrirla por primera vez y sigue montado: al cerrar, la hoja sale con su contenido.
  const [usada, setUsada] = React.useState(false);
  const abrir = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    setUsada(true);
    setAbierta(true);
  };
  return (
    <>
      {icono ? (
        <BotonIcono asChild variante="secundario" tamano="lg" etiqueta="Cambiar de rival">
          <a href={rutaCaraACara(personaId)} aria-haspopup="dialog" title="Cambiar de rival" onClick={abrir}>
            <UserRoundSearch aria-hidden />
          </a>
        </BotonIcono>
      ) : (
        <Boton asChild variante="secundario" tamano="lg">
          <a href={rutaCaraACara(personaId)} aria-haspopup="dialog" onClick={abrir}>
            <Swords aria-hidden />
            {rotulo}
          </a>
        </Boton>
      )}
      <HojaInferior abierta={abierta} alCambiar={setAbierta} titulo="Cara a cara">
        {/* El perfil no paga el buscador hasta que hace falta. */}
        {usada ? <BuscadorRival personaId={personaId} nombre={nombre} alElegir={() => setAbierta(false)} /> : null}
      </HojaInferior>
    </>
  );
}

function BuscadorRival({ personaId, nombre, alElegir }: { personaId: string; nombre: string; alElegir: () => void }) {
  const id = React.useId();
  const lista = React.useRef<HTMLUListElement>(null);
  const [texto, setTexto] = React.useState('');
  const [estado, setEstado] = React.useState<EstadoSugerencias>({ estado: 'reposo', items: [] });
  const solicitante = React.useRef<ReturnType<typeof crearSolicitanteSugerencias> | null>(null);

  React.useEffect(() => {
    const s = crearSolicitanteSugerencias(setEstado, fetch, { limite: 8 });
    solicitante.current = s;
    return () => s.cancelar();
  }, []);

  const items = estado.items.filter((s) => s.id !== personaId);
  const quien = nombreVisible(nombre) || nombre;

  return (
    <div className="flex min-w-0 flex-col gap-3 pt-1">
      <form
        action={rutaCaraACara(personaId)}
        method="get"
        role="search"
        className="relative min-w-0"
        onSubmit={(e) => {
          // Con una sola persona encontrada, Intro abre su duelo; si no, la búsqueda de la página de rivales.
          if (estado.estado === 'ok' && items.length === 1) {
            e.preventDefault();
            lista.current?.querySelector('a')?.click();
          }
        }}
      >
        <label htmlFor={`${id}-q`} className="sr-only">Buscar rival para {quien}</label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={`${id}-q`}
          name="q"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Busca un rival"
          value={texto}
          aria-controls={`${id}-lista`}
          onChange={(e) => {
            setTexto(e.target.value);
            solicitante.current?.buscar(e.target.value);
          }}
          className="h-10 w-full min-w-0 rounded-full border bg-background pr-3 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
        />
      </form>

      <div aria-live="polite" className="min-w-0">
        {estado.estado === 'error' ? (
          <EstadoVacio tipo="error" titulo="No se ha podido buscar" descripcion="Pulsa Intro para buscar de nuevo." />
        ) : estado.estado === 'ok' && items.length === 0 ? (
          <EstadoVacio titulo="Sin coincidencias" />
        ) : items.length > 0 ? (
          <ul id={`${id}-lista`} ref={lista} aria-label="Rivales" className="flex min-w-0 flex-col divide-y"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) alElegir();
            }}
          >
            {items.map((s) => (
              <li key={s.id}>
                <FilaPersona
                  persona={{ id: s.id, nombre: nombreVisible(s.nombre) || s.nombre, pais: s.pais }}
                  href={construirUrlCaraACara(personaId, { rival: s.id })}
                  densidad="compacta"
                  meta={s.armas.length > 0 ? s.armas.map((a) => rotuloArma(a)).join(', ') : undefined}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
