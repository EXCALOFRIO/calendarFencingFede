'use client';

import { LoaderCircle, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { BarraFiltros, OpcionesFiltro, type FiltroActivo } from '@/components/filtros/barra-filtros';
import {
  CLAVES_CATALOGO,
  FORMATOS_CATALOGO,
  FUENTES_CATALOGO,
  GENEROS_CATALOGO,
  RUTA_EDICIONES,
  SIN_FILTROS_CATALOGO,
  urlCatalogo,
  type CriteriosCatalogo,
} from '@/lib/sport/explorar/catalogo-url';
import {
  ORDEN_ARMA,
  ROTULO_CATEGORIA,
  compararCategorias,
  rotuloArma,
  rotuloCategoria,
  rotuloFormato,
  rotuloGenero,
} from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { CAMPO_BUSCAR, atajosAnios, rotuloAnios, type Anios } from './buscador-filtros';
import { CabeceraExplorar } from './cabecera-explorar';

/** Espera tras la última tecla: el índice responde en milisegundos, lo que cuesta es la ida y vuelta. */
export const ESPERA_COMPETICIONES = 150;

const TODAS = { valor: '', etiqueta: 'Todas' };
const ARMAS = [TODAS, ...ORDEN_ARMA.map((valor) => ({ valor, etiqueta: rotuloArma(valor) }))];
const GENEROS = [{ valor: '', etiqueta: 'Todos' }, ...GENEROS_CATALOGO.map((valor) => ({ valor, etiqueta: rotuloGenero(valor) }))];
const FORMATOS = [TODAS, ...FORMATOS_CATALOGO.map((valor) => ({ valor, etiqueta: rotuloFormato(valor) }))];
const CATEGORIAS = [
  TODAS,
  ...Object.keys(ROTULO_CATEGORIA).sort(compararCategorias).map((valor) => ({ valor, etiqueta: rotuloCategoria(valor) })),
];
const ORGANIZADORES = [{ valor: '', etiqueta: 'Todos' }, ...FUENTES_CATALOGO];

const ANIO_RE = /^(19|20)\d{2}$/;

/**
 * Buscador de competiciones: el campo busca mientras se escribe y el botón
 * «Filtros (N)» abre una sola hoja con organizador, arma, género, modalidad,
 * categoría y fechas; lo puesto queda debajo como chips que se quitan con un
 * toque. La lista la pinta el servidor desde el índice en memoria; mientras
 * llega la nueva se queda la anterior, un poco apagada. `children` es esa lista.
 *
 * Escribir y filtrar sustituyen la entrada del historial: con la hoja abierta
 * se tocan varios filtros seguidos y Atrás no debe deshacerlos de uno en uno,
 * sino salir del buscador. La dirección siempre lleva lo elegido, así que el
 * enlace sigue valiendo y volver desde una competición recupera la lista.
 *
 * Con `ambitos`, el campo va encima del selector de ámbitos de Explorar y
 * «Filtros» debajo, en la fila de chips, como en Tiradores y Países.
 */
export function BuscadorCompeticiones({
  criterios,
  anioActual,
  total,
  ambitos = false,
  children,
}: {
  criterios: CriteriosCatalogo;
  anioActual: number;
  /** Competiciones de la lista, para el botón que cierra la hoja. */
  total?: number;
  /** Pinta la cabecera de Explorar con el campo en su hueco `buscador`. */
  ambitos?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const entrada = React.useRef<HTMLInputElement>(null);
  const [pendiente, empezar] = React.useTransition();
  const [texto, setTexto] = React.useState(criterios.q);
  const temporizador = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const envio = React.useRef<string | null>(null);
  const urlActual = urlCatalogo(criterios);
  const criteriosActuales = React.useRef(criterios);
  React.useEffect(() => { criteriosActuales.current = criterios; }, [criterios]);

  const navegar = React.useCallback((c: CriteriosCatalogo) => {
    clearTimeout(temporizador.current);
    const url = urlCatalogo(c);
    if (envio.current === url) return;
    envio.current = url;
    empezar(() => router.replace(url, { scroll: false }));
  }, [router]);
  React.useEffect(() => {
    // La transición terminada (también si falla) permite volver a intentar.
    if (!pendiente) envio.current = null;
  }, [pendiente, urlActual]);

  // Lo escrito manda mientras el campo tiene el foco; si no, la URL (Atrás, un enlace).
  React.useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === entrada.current) return;
    setTexto(criterios.q);
  }, [criterios.q]);

  React.useEffect(() => {
    const q = texto.replace(/\s+/g, ' ').trim();
    if (q === criterios.q.trim()) return;
    const t = setTimeout(() => navegar({ ...criteriosActuales.current, q }), ESPERA_COMPETICIONES);
    temporizador.current = t;
    return () => clearTimeout(t);
  }, [texto, criterios.q, urlActual, navegar]);

  const poner = (parcial: Partial<CriteriosCatalogo>) => navegar({ ...criterios, q: texto.trim(), ...parcial });
  const anios = { desde: criterios.desde, hasta: criterios.hasta };

  const activos: FiltroActivo[] = [];
  const quitable = (clave: string, etiqueta: string, parcial: Partial<CriteriosCatalogo>) =>
    activos.push({ clave, etiqueta, onQuitar: () => poner(parcial) });
  if (criterios.fuente) {
    quitable('fuente', FUENTES_CATALOGO.find((f) => f.valor === criterios.fuente)?.etiqueta ?? criterios.fuente, { fuente: '' });
  }
  if (criterios.arma) quitable('arma', rotuloArma(criterios.arma) || criterios.arma, { arma: '' });
  if (criterios.genero) quitable('genero', rotuloGenero(criterios.genero) || criterios.genero, { genero: '' });
  if (criterios.formato) quitable('formato', rotuloFormato(criterios.formato) || criterios.formato, { formato: '' });
  if (criterios.categoria) quitable('categoria', rotuloCategoria(criterios.categoria) || criterios.categoria, { categoria: '' });
  if (anios.desde || anios.hasta) quitable('fechas', rotuloAnios(anios), { desde: '', hasta: '' });
  if (criterios.temporada) quitable('temporada', `Temporada ${criterios.temporada}`, { temporada: '' });

  const buscador = (
    <form
      method="get"
      action={RUTA_EDICIONES}
      role="search"
      aria-label="Buscar competiciones"
      aria-busy={pendiente}
      className="relative w-full min-w-0 lg:max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        navegar({ ...criterios, q: texto.trim() });
        entrada.current?.blur();
      }}
    >
      {CLAVES_CATALOGO.filter((k) => k !== 'q' && criterios[k]).map((k) => (
        <input key={k} type="hidden" name={k} value={criterios[k]} />
      ))}
      <label htmlFor="catalogo-q" className="sr-only">Buscar competiciones</label>
      {pendiente ? (
        <LoaderCircle aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" />
      ) : (
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <input
        ref={entrada}
        id="catalogo-q"
        name="q"
        type="search"
        value={texto}
        maxLength={100}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Mundial, Copa del Mundo, Turín…"
        className={cn(CAMPO_BUSCAR, 'pr-11')}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && texto) { e.preventDefault(); setTexto(''); }
        }}
      />
      {texto ? (
        <button
          type="button"
          aria-label="Borrar búsqueda"
          className="absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
          onClick={() => { setTexto(''); entrada.current?.focus(); }}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </form>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {ambitos ? <CabeceraExplorar activa="competiciones" q={texto.trim()} buscador={buscador} /> : null}
      <BarraFiltros
        buscador={ambitos ? undefined : buscador}
        activos={activos}
        etiqueta="Filtros de competiciones"
        resultados={total === undefined ? 'Ver competiciones' : `Ver ${total.toLocaleString('es-ES')} ${total === 1 ? 'competición' : 'competiciones'}`}
        onLimpiar={() => navegar({ ...criterios, q: texto.trim(), ...SIN_FILTROS_CATALOGO })}
      >
        <OpcionesFiltro titulo="Organizador" valor={criterios.fuente} opciones={ORGANIZADORES} onCambio={(fuente) => poner({ fuente })} />
        <OpcionesFiltro titulo="Arma" valor={criterios.arma} opciones={ARMAS} onCambio={(arma) => poner({ arma })} />
        <OpcionesFiltro titulo="Género" variante="segmentado" valor={criterios.genero} opciones={GENEROS} onCambio={(genero) => poner({ genero })} />
        <OpcionesFiltro titulo="Modalidad" variante="segmentado" valor={criterios.formato} opciones={FORMATOS} onCambio={(formato) => poner({ formato })} />
        <OpcionesFiltro titulo="Categoría" valor={criterios.categoria} opciones={CATEGORIAS} onCambio={(categoria) => poner({ categoria })} />
        <SeccionFechas
          key={`${anios.desde}-${anios.hasta}`}
          valor={anios}
          anioActual={anioActual}
          onElegir={({ desde, hasta }) => poner({ desde, hasta, temporada: '' })}
        />
      </BarraFiltros>
      <div className={cn('flex min-w-0 flex-col gap-3 transition-opacity duration-150 motion-reduce:transition-none', pendiente && 'opacity-60')}>
        {children}
      </div>
    </div>
  );
}

/** Fechas dentro de la hoja: atajos desde el año en curso o un intervalo de años escrito. */
function SeccionFechas({ valor, anioActual, onElegir }: { valor: Anios; anioActual: number; onElegir: (a: Anios) => void }) {
  // Quien la pinta le cambia la `key` con el valor: el borrador vuelve a la URL sin un efecto.
  const [borrador, setBorrador] = React.useState<Anios>(valor);
  const atajos = atajosAnios(anioActual);
  const elegido = atajos.find((a) => a.anios.desde === valor.desde && a.anios.hasta === valor.hasta);
  const valido = (v: string) => v === '' || ANIO_RE.test(v);
  const error = !valido(borrador.desde) || !valido(borrador.hasta)
    ? 'Escribe años de cuatro cifras.'
    : borrador.desde && borrador.hasta && borrador.desde > borrador.hasta ? '«Desde» va antes que «Hasta».' : null;
  const aplicar = (b: Anios) => {
    const okB = valido(b.desde) && valido(b.hasta) && !(b.desde && b.hasta && b.desde > b.hasta);
    if (okB && (b.desde !== valor.desde || b.hasta !== valor.hasta)) onElegir(b);
  };
  const campo = (clave: keyof Anios, rotulo: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={`catalogo-${clave}`} className="text-sm font-medium">{rotulo}</label>
      <input
        id={`catalogo-${clave}`}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        placeholder={clave === 'desde' ? '2018' : String(anioActual)}
        value={borrador[clave]}
        aria-invalid={!valido(borrador[clave]) || undefined}
        onChange={(e) => {
          const b = { ...borrador, [clave]: e.target.value.replace(/\D/g, '').slice(0, 4) };
          setBorrador(b);
          // Se aplica al completar el año (o al vaciarlo), no a cada cifra.
          if (b[clave].length === 4 || b[clave] === '') aplicar(b);
        }}
        className="h-10 w-full rounded-xl border border-transparent bg-accent px-3 text-base tabular-nums outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
      />
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <OpcionesFiltro
        titulo="Fechas"
        valor={elegido ? elegido.etiqueta : valor.desde || valor.hasta ? '' : 'todas'}
        opciones={[{ valor: 'todas', etiqueta: 'Todas' }, ...atajos.map((a) => ({ valor: a.etiqueta, etiqueta: a.etiqueta }))]}
        onCambio={(v) => onElegir(v === 'todas' ? { desde: '', hasta: '' } : (atajos.find((a) => a.etiqueta === v)?.anios ?? valor))}
      />
      <div className="flex gap-3">
        {campo('desde', 'Desde')}
        {campo('hasta', 'Hasta')}
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
