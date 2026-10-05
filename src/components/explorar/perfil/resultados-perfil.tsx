import { ExternalLink, Medal } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import { fuenteResultado } from '@/lib/sport/explorar/etiquetas';
import { construirUrlFicha, type CriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import {
  ambitosConResultados,
  cuantosVer,
  filtrarPorAmbito,
  mejoresCompeticiones,
  PASO_HISTORIAL,
  type AmbitoResultados,
} from '@/lib/sport/explorar/resultados-perfil';
import type { ResultadoPerfil, ResultadosPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { EtiquetaCategoria, EtiquetaTipoCompeticion } from '../etiqueta-competicion';
import { Aclaracion, Bloque, Nota, enlaceSeguro, type Nivel } from '../piezas';
import { etiquetaMedalla, partesFecha } from './piezas-perfil';

/**
 * Pestaña Resultados del perfil: selector de ámbito en la URL, mejores
 * competiciones, últimos resultados y el historial completo plegado. Todo sale
 * de `perfil.resultados`, una fila por prueba individual.
 */

const ULTIMOS = 5;

const ETIQUETA_AMBITO: Record<AmbitoResultados, string> = {
  todo: 'Todo',
  internacional: 'Internacional',
  nacional: 'Nacional',
};

/**
 * Oro, plata y bronce con su metal y el nombre escrito: el color nunca
 * comunica solo. Plata y bronce no tienen token en el tema; los valores
 * están elegidos para ≥ 4,5:1 con su texto.
 */
const METAL: Record<1 | 2 | 3, string> = {
  1: 'bg-gold text-gold-foreground',
  2: 'bg-[oklch(0.86_0.012_250)] text-[oklch(0.22_0.01_250)]',
  3: 'bg-[oklch(0.7_0.09_55)] text-[oklch(0.18_0.03_55)]',
};

function Medalla({ puesto, className }: { puesto: 1 | 2 | 3; className?: string }) {
  return (
    <span
      data-medalla={puesto}
      className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold leading-none', METAL[puesto], className)}
    >
      <Medal className="size-3.5" aria-hidden />
      {etiquetaMedalla(puesto)}
    </span>
  );
}

function esMedalla(puesto: number | null): puesto is 1 | 2 | 3 {
  return puesto === 1 || puesto === 2 || puesto === 3;
}

/** Puesto compacto: número grande y, en un podio, la medalla debajo. */
function Puesto({ r, grande = false }: { r: ResultadoPerfil; grande?: boolean }) {
  if (r.puesto === null) {
    return (
      <span className="max-w-24 text-right text-xs leading-tight text-muted-foreground">
        {r.puestoPublicado ?? 'Sin puesto publicado'}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="flex items-start gap-px" aria-label={`Puesto ${r.puesto}`} role="img">
        <span aria-hidden="true" className={cn('cifra leading-none', grande ? 'text-4xl' : 'text-2xl')}>{r.puesto}</span>
        <span aria-hidden="true" className="text-xs leading-none text-muted-foreground">º</span>
      </span>
      {esMedalla(r.puesto) ? <Medalla puesto={r.puesto} /> : r.puesto <= 8 ? (
        <span className="text-xs text-muted-foreground">Final</span>
      ) : null}
    </span>
  );
}

function Fecha({ iso, className }: { iso: string | null; className?: string }) {
  const p = iso ? partesFecha(iso) : null;
  if (!iso) return <span className={cn('text-xs text-muted-foreground', className)}>Fecha no publicada</span>;
  return (
    <time dateTime={iso} className={cn('text-xs text-muted-foreground', className)}>
      {p ? `${p.dia} ${p.mes} ${p.anio}` : iso}
    </time>
  );
}

function modalidad(r: ResultadoPerfil): string {
  return `${WEAPON_LABEL[r.prueba.arma]} ${GENDER_LABEL[r.prueba.genero].toLowerCase()}`;
}

function categoriaLegible(codigo: string): string {
  return CATEGORY_LABEL[codigo as keyof typeof CATEGORY_LABEL] ?? codigo;
}

function Sede({ r }: { r: ResultadoPerfil }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {r.torneo.pais ? <BanderaPais pais={r.torneo.pais} /> : null}
      <span className="truncate">{r.torneo.ciudad ? titular(r.torneo.ciudad) : 'Sede no publicada'}</span>
    </span>
  );
}

function Asaltos({ r }: { r: ResultadoPerfil }) {
  if (!r.asaltos) return null;
  return (
    <span className="whitespace-nowrap" title="Asaltos individuales importados de esta prueba">
      <span className="cifra text-sm text-foreground">{r.asaltos.victorias}</span> V ·{' '}
      <span className="cifra text-sm text-foreground">{r.asaltos.derrotas}</span> D
    </span>
  );
}

/** Enlace a la fuente sólo con icono: está, pero no compite con el resultado. */
function Fuente({ r }: { r: ResultadoPerfil }) {
  const href = enlaceSeguro(r.enlace);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Abrir en la fuente (${fuenteResultado(r.fuente)})`}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ExternalLink className="size-4" aria-hidden />
      <span className="sr-only">Abrir en la fuente: {fuenteResultado(r.fuente)}</span>
    </a>
  );
}

const ENLACE_TORNEO =
  'min-w-0 font-medium leading-snug break-words underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/* ------------------------------------------------------------ selector de ámbito */

function SelectorAmbito({
  actual,
  resultados,
  base,
  criterios,
}: {
  actual: AmbitoResultados;
  resultados: ResultadosPerfil;
  base: string;
  criterios: CriteriosFicha;
}) {
  const cuenta: Record<AmbitoResultados, number> = {
    todo: resultados.items.length,
    internacional: resultados.porAmbito.internacional,
    nacional: resultados.porAmbito.nacional,
  };
  return (
    <nav aria-label="Ámbito de los resultados" className="min-w-0">
      <ul className="flex w-full gap-1 overflow-x-auto rounded-full border bg-card p-1 [scrollbar-width:none] sm:inline-flex sm:w-auto">
        {(['todo', 'internacional', 'nacional'] as const).map((a) => {
          const activo = a === actual;
          return (
            <li key={a} className="flex-auto shrink-0 sm:flex-none">
              <Link
                href={construirUrlFicha(
                  base,
                  {
                    ranking: criterios.ranking,
                    formato: criterios.formato,
                    volver: criterios.volver,
                    ...(a === 'todo' ? {} : { ambito: a }),
                  },
                  'historial',
                )}
                prefetch={false}
                scroll={false}
                aria-current={activo ? 'page' : undefined}
                data-ambito={a}
                className={cn(
                  'inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-full px-2 text-[0.8125rem] font-medium sm:gap-1.5 sm:px-3.5 sm:text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  activo ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {ETIQUETA_AMBITO[a]}
                <span className={cn('cifra text-sm', activo ? 'text-background/80' : 'text-muted-foreground')}>{cuenta[a]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* --------------------------------------------------------- mejores competiciones */

function TarjetaMejor({ r }: { r: ResultadoPerfil }) {
  const categoria = r.prueba.categoria.codigo;
  return (
    <li
      className={cn(
        'flex w-[16.5rem] shrink-0 snap-start flex-col gap-3 rounded-lg border bg-card p-4 sm:w-auto',
        esMedalla(r.puesto) && 'border-filete-alto',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <EtiquetaTipoCompeticion clasificacion={r.clasificacion} />
          <EtiquetaCategoria codigo={categoria} />
        </span>
        <Puesto r={r} grande />
      </div>
      <Link href={rutaEdicion(r.torneo.id)} prefetch={false} className={cn(ENLACE_TORNEO, 'line-clamp-3')}>
        {titular(r.torneo.nombre)}
      </Link>
      <div className="mt-auto flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <Fecha iso={r.fecha} />
          <Asaltos r={r} />
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2">
          <Sede r={r} />
          <span className="shrink-0">{modalidad(r)}</span>
        </span>
      </div>
    </li>
  );
}

function MejoresCompeticiones({ items, nivel }: { items: ResultadoPerfil[]; nivel: Nivel }) {
  const mejores = mejoresCompeticiones(items);
  if (mejores.length === 0) return null;
  const Subtitulo = nivel === 'pagina' ? 'h3' : 'h4';
  return (
    <section aria-labelledby="ficha-mejores" className="flex min-w-0 flex-col gap-3">
      <Subtitulo id="ficha-mejores" className="text-lg leading-tight">Mejores competiciones</Subtitulo>
      <ol
        aria-label="Mejores competiciones: medallas primero, luego por importancia y puesto"
        className="-mx-4 flex min-w-0 snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:scroll-px-0 sm:px-0 lg:grid-cols-3"
      >
        {mejores.map((r) => <TarjetaMejor key={r.id} r={r} />)}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------- filas compactas */

function FilaCompacta({ r }: { r: ResultadoPerfil }) {
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 bg-card py-3 pr-1 pl-4 sm:gap-x-4 sm:pl-5">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Fecha iso={r.fecha} />
          <EtiquetaTipoCompeticion clasificacion={r.clasificacion} className="h-5 px-2 text-[0.6875rem]" />
        </span>
        <Link href={rutaEdicion(r.torneo.id)} prefetch={false} className={cn(ENLACE_TORNEO, 'text-sm sm:text-base')}>
          {titular(r.torneo.nombre)}
        </Link>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            {modalidad(r)}, {categoriaLegible(r.prueba.categoria.codigo).toLowerCase()}
          </span>
          <span aria-hidden>·</span>
          <Sede r={r} />
          {r.asaltos ? (
            <>
              <span aria-hidden>·</span>
              <Asaltos r={r} />
            </>
          ) : null}
        </span>
      </div>
      <Puesto r={r} />
      <span className="flex w-11 justify-center">
        <Fuente r={r} />
      </span>
    </li>
  );
}

function ListaCompacta({ items, etiqueta }: { items: ResultadoPerfil[]; etiqueta: string }) {
  return (
    <ol aria-label={etiqueta} className="grid min-w-0 gap-px overflow-hidden rounded-lg border bg-border">
      {items.map((r) => <FilaCompacta key={r.id} r={r} />)}
    </ol>
  );
}

function porTemporada(items: readonly ResultadoPerfil[]): [string, ResultadoPerfil[]][] {
  const grupos = new Map<string, ResultadoPerfil[]>();
  for (const r of items) {
    const g = grupos.get(r.temporada);
    if (g) g.push(r);
    else grupos.set(r.temporada, [r]);
  }
  return [...grupos.entries()];
}

/* -------------------------------------------------------------------- pestaña */

export function ResultadosPerfilVista({
  resultados,
  base,
  criterios,
  nivel,
}: {
  resultados: ResultadosPerfil;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
}) {
  const ambitos = ambitosConResultados(resultados);
  // Con un solo ámbito el selector sobra, y un `ambito` vacío en la URL no deja la pestaña en blanco.
  const ambito: AmbitoResultados = ambitos.length > 1 && criterios.ambito ? criterios.ambito : 'todo';
  const items = filtrarPorAmbito(resultados.items, ambito);
  const ultimos = items.slice(0, ULTIMOS);
  const visibles = cuantosVer(criterios.ver ?? 0, items.length);
  const historial = items.slice(0, visibles);
  const Subtitulo = nivel === 'pagina' ? 'h3' : 'h4';
  const siguiente = visibles < items.length ? visibles + PASO_HISTORIAL : null;

  return (
    <Bloque id="historial" titulo="Resultados" nivel={nivel} tituloOculto>
      {ambitos.length > 1 ? (
        <SelectorAmbito actual={ambito} resultados={resultados} base={base} criterios={criterios} />
      ) : null}

      {items.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No hay puestos finales importados para esta persona. Puede que las fuentes no los publiquen o
          que falte procesarlos; no significa que no haya competido.
        </p>
      ) : (
        <>
          <MejoresCompeticiones items={items} nivel={nivel} />

          <section aria-labelledby="ficha-ultimos" className="flex min-w-0 flex-col gap-3">
            <Subtitulo id="ficha-ultimos" className="text-lg leading-tight">Últimos resultados</Subtitulo>
            <ListaCompacta items={ultimos} etiqueta="Últimos resultados, del más reciente al más antiguo" />
          </section>

          {items.length > ULTIMOS ? (
            <details id="historial-completo" open={criterios.ver ? true : undefined} className="group min-w-0">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border bg-card px-4 text-sm font-medium hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                <span>
                  Historial completo{' '}
                  <span className="cifra text-base text-muted-foreground">{items.length}</span>
                </span>
                <span className="text-xs text-muted-foreground group-open:hidden">Mostrar</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">Ocultar</span>
              </summary>
              <div className="flex min-w-0 flex-col gap-4 pt-4">
                {porTemporada(historial).map(([temporada, lista]) => (
                  <section key={temporada} aria-label={`Temporada ${etiquetaTemporada(temporada)}`} className="flex min-w-0 flex-col gap-2">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {etiquetaTemporada(temporada)}
                    </p>
                    <ListaCompacta items={lista} etiqueta={`Resultados de ${etiquetaTemporada(temporada)}`} />
                  </section>
                ))}
                <nav aria-label="Más resultados" className="flex flex-wrap items-center gap-3">
                  {siguiente ? (
                    <Button asChild variant="outline">
                      <Link
                        href={construirUrlFicha(
                          base,
                          {
                            ranking: criterios.ranking,
                            formato: criterios.formato,
                            volver: criterios.volver,
                            ambito: ambito === 'todo' ? undefined : ambito,
                            ver: siguiente,
                          },
                          'historial-completo',
                        )}
                        prefetch={false}
                        scroll={false}
                      >
                        Ver más resultados
                      </Link>
                    </Button>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {visibles} de {items.length}
                    {resultados.truncado ? ' (se muestran las pruebas más recientes leídas)' : ''}.
                  </p>
                </nav>
              </div>
            </details>
          ) : null}
        </>
      )}

      <Aclaracion titulo="Qué resultados aparecen aquí">
        <Nota>
          Un puesto final por prueba individual: si dos fuentes publican la misma prueba, cuenta una vez.
          Una inscripción sin puesto final no aparece. Internacional incluye toda prueba FIE, de circuito
          europeo o celebrada fuera de España. Las pruebas por equipos no se listan: las fuentes las publican
          por club, no por tirador.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}
