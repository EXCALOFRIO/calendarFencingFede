'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BanderaPais } from '@/components/bandera';
import { Boton } from '@/components/sistema/boton';
import { VerMas } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { SelectorSegmentado } from '@/components/sistema/selector-segmentado';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { categoriaVisible, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import type { AmbitoResultados, FilaListaPerfil, ListaPerfil } from '@/lib/sport/explorar/resultados-perfil';
import type { Arma } from '@/lib/sport/explorar/tipos';
import { WEAPON_LABEL, cn } from '@/lib/utils';
import { EtiquetaCategoria, EtiquetaTipoCompeticion } from '../etiqueta-competicion';
import { FilaResultado } from './fila-resultado';
import { DiscoPuesto, Medallero } from './medallas';
import { TACTIL } from './tactil';

/**
 * Pestaña Resultados del perfil: ámbito, mejores competiciones y el historial
 * con buscador y filtros. Todo el historial ya viene cargado (una persona
 * tiene unos cientos de pruebas), así que filtrar no vuelve a pedir nada al
 * servidor. Los enlaces de ámbito llevan su URL para que sin JavaScript sigan
 * funcionando.
 */

const PASO = 25;

const ROTULO_AMBITO: Record<AmbitoResultados, string> = {
  todo: 'Todo',
  internacional: 'Internacional',
  nacional: 'Nacional',
};

function plegar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

type Opcion = { valor: string; etiqueta: string; n: number };

function opciones(
  filas: readonly FilaListaPerfil[],
  clave: (r: FilaListaPerfil) => string,
  etiqueta: (r: FilaListaPerfil) => string,
  orden: (a: Opcion & { r: FilaListaPerfil }, b: Opcion & { r: FilaListaPerfil }) => number,
): Opcion[] {
  const mapa = new Map<string, Opcion & { r: FilaListaPerfil }>();
  for (const r of filas) {
    const v = clave(r);
    const o = mapa.get(v);
    if (o) o.n += 1;
    else mapa.set(v, { valor: v, etiqueta: etiqueta(r), n: 1, r });
  }
  return [...mapa.values()].sort(orden).map(({ valor, etiqueta: e, n }) => ({ valor, etiqueta: e, n }));
}

function Selector({
  etiqueta,
  todas,
  valor,
  lista,
  onChange,
}: {
  etiqueta: string;
  todas: string;
  valor: string;
  lista: Opcion[];
  onChange: (v: string) => void;
}) {
  const activo = valor !== '';
  // Radix no admite un elemento con valor vacío: «todas» va con un valor propio.
  return (
    <Select value={activo ? valor : TODAS} onValueChange={(v) => onChange(v === TODAS ? '' : v)}>
      <SelectTrigger
        aria-label={etiqueta}
        className={cn(
          // En px: `h-11` es rem y con el texto al 130 % la pastilla pasaba de 44 px.
          'data-[size=default]:h-11 w-full min-w-0 gap-1 rounded-full border bg-card px-3 py-0 text-sm max-[359px]:px-2 max-[359px]:text-xs',
          '*:data-[slot=select-value]:block *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate',
          activo ? 'border-primary-text bg-marcado font-semibold text-primary-text' : 'text-foreground',
        )}
      >
        <SelectValue placeholder={todas} />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={TODAS}>{todas}</SelectItem>
        {lista.map((o) => (
          <SelectItem key={o.valor} value={o.valor}>
            {o.etiqueta} ({o.n})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const TODAS = '__todas__';

function TarjetaMejor({ r, className }: { r: FilaListaPerfil; className?: string }) {
  return (
    <li className={cn('min-w-0', className)}>
      <Link
        href={r.href}
        prefetch={false}
        className="flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-3 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none sm:p-4"
      >
        <span className="flex min-w-0 items-center justify-between gap-2">
          <DiscoPuesto puesto={r.puesto} puestoPublicado={r.puestoPublicado} />
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {r.pais ? <BanderaPais pais={r.pais} soloBandera /> : null}
            <time dateTime={r.fecha ?? undefined} className="whitespace-nowrap">{r.fecha ? r.fecha.slice(0, 4) : ''}</time>
          </span>
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-medium">{r.nombre}</span>
        <span className="mt-auto flex min-w-0 flex-wrap items-center gap-1">
          {r.tipoEnNombre ? null : <EtiquetaTipoCompeticion clasificacion={r.clasificacion} tamano="sm" />}
          <EtiquetaCategoria codigo={r.categoria} tamano="sm" />
        </span>
      </Link>
    </li>
  );
}

function medallas(lista: readonly FilaListaPerfil[]) {
  let oros = 0, platas = 0, bronces = 0;
  for (const r of lista) {
    if (r.puesto === 1) oros += 1;
    else if (r.puesto === 2) platas += 1;
    else if (r.puesto === 3) bronces += 1;
  }
  return { oros, platas, bronces };
}

function porTemporada(items: readonly FilaListaPerfil[]): [string, FilaListaPerfil[]][] {
  const grupos = new Map<string, FilaListaPerfil[]>();
  for (const r of items) {
    const g = grupos.get(r.temporadaEtiqueta);
    if (g) g.push(r);
    else grupos.set(r.temporadaEtiqueta, [r]);
  }
  return [...grupos.entries()];
}

export function HistorialPerfil({
  lista,
  ambitoInicial,
  verInicial,
  enlacesAmbito,
  encabezado = 'h3',
}: {
  lista: ListaPerfil;
  ambitoInicial: AmbitoResultados;
  verInicial: number;
  /** URL de cada ámbito; `null` si sólo hay uno y el selector sobra. */
  enlacesAmbito: Record<AmbitoResultados, string> | null;
  encabezado?: 'h3' | 'h4';
}) {
  const [ambito, setAmbito] = useState<AmbitoResultados>(ambitoInicial);
  const [texto, setTexto] = useState('');
  const [temporada, setTemporada] = useState('');
  const [tipo, setTipo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [arma, setArma] = useState('');
  const [visibles, setVisibles] = useState(Math.max(PASO, verInicial));
  const Subtitulo = encabezado;

  const indice = useMemo(
    () => new Map(lista.filas.map((r) => [r.id, plegar(
      [r.nombre, r.ciudad ?? '', r.clasificacion.etiqueta, r.clasificacion.corta, categoriaVisible(r.categoria), r.temporadaEtiqueta, WEAPON_LABEL[r.arma]].join(' '),
    )])),
    [lista.filas],
  );
  const delAmbito = useMemo(
    () => (ambito === 'todo' ? lista.filas : lista.filas.filter((r) => r.clasificacion.ambito === ambito)),
    [lista.filas, ambito],
  );
  const cuenta: Record<AmbitoResultados, number> = useMemo(() => ({
    todo: lista.filas.length,
    internacional: lista.filas.filter((r) => r.clasificacion.ambito === 'internacional').length,
    nacional: lista.filas.filter((r) => r.clasificacion.ambito === 'nacional').length,
  }), [lista.filas]);

  const opcionesTemporada = useMemo(
    () => opciones(delAmbito, (r) => r.temporada, (r) => r.temporadaEtiqueta, (a, b) => b.valor.localeCompare(a.valor)),
    [delAmbito],
  );
  const opcionesTipo = useMemo(
    () => opciones(delAmbito, (r) => r.clasificacion.tipo, (r) => r.clasificacion.etiqueta, (a, b) => a.r.clasificacion.orden - b.r.clasificacion.orden),
    [delAmbito],
  );
  const opcionesCategoria = useMemo(
    () => opciones(delAmbito, (r) => r.categoria, (r) => categoriaVisible(r.categoria), (a, b) => ordenCategoriaVisible(a.valor) - ordenCategoriaVisible(b.valor)),
    [delAmbito],
  );
  const opcionesArma = useMemo(
    () => opciones(delAmbito, (r) => r.arma, (r) => WEAPON_LABEL[r.arma as Arma], (a, b) => b.n - a.n),
    [delAmbito],
  );

  // Un valor que ya no existe en el ámbito elegido no filtra (y el selector vuelve a «todas»).
  const vale = (v: string, lista: Opcion[]) => (v && lista.some((o) => o.valor === v) ? v : '');
  const fTemporada = vale(temporada, opcionesTemporada);
  const fTipo = vale(tipo, opcionesTipo);
  const fCategoria = vale(categoria, opcionesCategoria);
  const fArma = vale(arma, opcionesArma);
  const terminos = plegar(texto.trim()).split(/\s+/).filter(Boolean);
  const filtrando = terminos.length > 0 || fTemporada !== '' || fTipo !== '' || fCategoria !== '' || fArma !== '';

  const filtradas = delAmbito.filter((r) =>
    (!fTemporada || r.temporada === fTemporada)
    && (!fTipo || r.clasificacion.tipo === fTipo)
    && (!fCategoria || r.categoria === fCategoria)
    && (!fArma || r.arma === fArma)
    && (terminos.length === 0 || terminos.every((t) => indice.get(r.id)!.includes(t))));
  const mostradas = filtradas.slice(0, visibles);
  const porId = new Map(lista.filas.map((r) => [r.id, r]));
  const mejores = lista.mejores[ambito].map((id) => porId.get(id)).filter((r): r is FilaListaPerfil => Boolean(r));
  const conArma = opcionesArma.length > 1;

  const limpiar = () => {
    setTexto(''); setTemporada(''); setTipo(''); setCategoria(''); setArma(''); setVisibles(PASO);
  };
  const cambiar = (f: (v: string) => void) => (v: string) => {
    f(v);
    setVisibles(PASO);
  };
  // El ámbito se cambia en el cliente (todo el historial ya está aquí) y la URL lo recuerda sin una entrada nueva.
  // Se pasa el estado del historial que hay: ahí guarda Next el árbol del router.
  const elegirAmbito = (valor: string) => {
    const a = valor as AmbitoResultados;
    setAmbito(a);
    setVisibles(PASO);
    const url = new URL(window.location.href);
    if (a === 'todo') url.searchParams.delete('ambito');
    else url.searchParams.set('ambito', a);
    url.searchParams.delete('ver');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {enlacesAmbito ? (
        <SelectorSegmentado
          etiqueta="Ámbito de los resultados"
          tamano="sm"
          anchoMinimo={6}
          valor={ambito}
          onCambio={elegirAmbito}
          opciones={(['todo', 'internacional', 'nacional'] as const).map((a) => ({ valor: a, etiqueta: ROTULO_AMBITO[a], cuenta: cuenta[a] }))}
        />
      ) : null}

      {mejores.length > 0 ? (
        <section aria-labelledby="ficha-mejores" className="flex min-w-0 flex-col gap-3">
          <Subtitulo id="ficha-mejores" className="text-lg leading-tight">Mejores competiciones</Subtitulo>
          <ol
            aria-label="Mejores competiciones: medallas primero, luego por importancia y puesto"
            className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3"
          >
            {mejores.slice(0, 6).map((r, i) => (
              <TarjetaMejor key={r.id} r={r} className={i >= 4 ? 'max-sm:hidden' : undefined} />
            ))}
          </ol>
        </section>
      ) : null}

      <section id="historial-completo" aria-labelledby="ficha-historial" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <Subtitulo id="ficha-historial" className="text-lg leading-tight">Historial</Subtitulo>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            <span className="cifra text-base text-foreground">{filtradas.length}</span>
            {filtrando ? ` de ${delAmbito.length}` : ''} {filtradas.length === 1 ? 'prueba' : 'pruebas'}
          </span>
        </div>

        <div role="search" className="flex min-w-0 flex-col gap-2">
          <label className="relative min-w-0">
            <span className="sr-only">Buscar en el historial</span>
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={texto}
              onChange={(e) => cambiar(setTexto)(e.target.value)}
              placeholder="Competición o ciudad"
              className="h-10 w-full min-w-0 rounded-full border bg-card pr-4 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring sm:text-sm"
            />
          </label>
          <div className={cn('grid min-w-0 gap-2 max-[359px]:gap-1', conArma ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-[5fr_3fr_5fr] sm:grid-cols-3')}>
            <Selector etiqueta="Temporada" todas="Temporada" valor={fTemporada} lista={opcionesTemporada} onChange={cambiar(setTemporada)} />
            <Selector etiqueta="Tipo de torneo" todas="Tipo" valor={fTipo} lista={opcionesTipo} onChange={cambiar(setTipo)} />
            <Selector etiqueta="Categoría" todas="Categoría" valor={fCategoria} lista={opcionesCategoria} onChange={cambiar(setCategoria)} />
            {conArma ? <Selector etiqueta="Arma" todas="Arma" valor={fArma} lista={opcionesArma} onChange={cambiar(setArma)} /> : null}
          </div>
          {filtrando ? (
            <button
              type="button"
              onClick={limpiar}
              className={cn(TACTIL, 'inline-flex min-h-[32px] w-fit items-center gap-1 rounded-full px-3 text-sm text-primary-text hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none')}
            >
              <X className="size-4" aria-hidden />
              Quitar filtros
            </button>
          ) : null}
        </div>

        {filtradas.length === 0 ? (
          <EstadoVacio
            titulo="Sin pruebas con estos filtros"
            accion={filtrando ? <Boton variante="contorno" tamano="md" onClick={limpiar}>Quitar filtros</Boton> : undefined}
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-4">
            {porTemporada(mostradas).map(([etiqueta, grupo]) => {
              const m = medallas(grupo);
              return (
                <section key={etiqueta} aria-label={`Temporada ${etiqueta}`} className="flex min-w-0 flex-col gap-2">
                  <div className="flex min-w-0 items-center justify-between gap-3 px-1">
                    <p className="cifra text-xl leading-none">{etiqueta}</p>
                    <Medallero {...m} ocultarCeros />
                  </div>
                  <ol className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border">
                    {grupo.map((r) => <FilaResultado key={r.id} r={r} conArma={conArma} />)}
                  </ol>
                </section>
              );
            })}
            {filtradas.length > mostradas.length ? (
              <VerMas
                onClick={() => setVisibles((v) => v + PASO)}
                cuenta={filtradas.length - mostradas.length}
                detalle="pruebas del historial"
                className="self-center"
              />
            ) : null}
            {lista.truncado && !filtrando ? (
              <p className="text-xs text-muted-foreground">Solo las pruebas más recientes.</p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
