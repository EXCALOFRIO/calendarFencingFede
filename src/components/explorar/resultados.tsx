'use client';

import { ChevronRight, LoaderCircle, SearchX, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { masDeportistasAccion } from '@/app/(app)/explorar/acciones';
import { Button } from '@/components/ui/button';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type { DeportistaListado, VistaExplorar } from '@/lib/sport/explorar/pantalla';
import { CLASES_MEDALLA, COLOR_MEDALLA, type Medalla } from '@/lib/sport/explorar/presentacion';
import type { DeportistaResumen } from '@/lib/sport/explorar/tipos';
import { TRAYECTORIA_VACIA, type TrayectoriaPersona } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import {
  RUTA_EXPLORAR,
  aEntrada,
  chipsActivos,
  construirUrl,
  hayCriterios,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';
import { CLASE_LISTA_PERFILES, CLASE_VER_MAS, FilaPerfil } from './buscador-social-fila';
import { BotonSeguirCompacto } from './buscador-social-seguir';

/** Filtros activos como pastillas de una línea que los quitan uno a uno. */
export function ChipsActivos({ criterios }: { criterios: CriteriosExplorar }) {
  const todos = chipsActivos(criterios);
  // El nombre solo ya está a la vista en la barra de búsqueda (con su X); como pastilla repetiría lo mismo.
  const chips = todos.length === 1 && todos[0].clave === 'q' ? [] : todos;
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex min-w-0 flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.clave} className="min-w-0 max-w-full">
          <Link
            href={chip.quitar}
            prefetch={false}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}${chip.fechaInvalida ? ' (fecha no válida)' : ''}`}
            className={cn(
              'inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border bg-secondary pr-2 pl-3 text-[0.8125rem] whitespace-nowrap hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              chip.fechaInvalida && 'border-danger/40',
            )}
          >
            <span className="shrink-0 text-muted-foreground">{chip.etiqueta}</span>
            <span className="min-w-0 truncate font-medium">{chip.valor}</span>
            {chip.fechaInvalida ? <span className="shrink-0 text-xs text-danger">no válida</span> : null}
            <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const METALES: { medalla: Medalla; clave: 'oros' | 'platas' | 'bronces'; uno: string; varios: string }[] = [
  { medalla: 'oro', clave: 'oros', uno: 'oro', varios: 'oros' },
  { medalla: 'plata', clave: 'platas', uno: 'plata', varios: 'platas' },
  { medalla: 'bronce', clave: 'bronces', uno: 'bronce', varios: 'bronces' },
];

/** Medallas individuales en pastillas mínimas; el número y el texto oculto dicen el metal, no sólo el color. */
function Medallas({ t }: { t: TrayectoriaPersona }) {
  const metales = METALES.filter((m) => t[m.clave] > 0);
  if (metales.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {metales.map((m) => (
        <span
          key={m.clave}
          className={cn('inline-flex h-[1.125rem] items-center gap-1 rounded-full border px-1.5 text-[0.6875rem] leading-none font-semibold tabular-nums', CLASES_MEDALLA[m.medalla])}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full" style={{ backgroundColor: COLOR_MEDALLA[m.medalla] }} />
          {t[m.clave]}
          <span className="sr-only"> {t[m.clave] === 1 ? m.uno : m.varios}</span>
        </span>
      ))}
    </span>
  );
}

/** Sin trayectoria (lecturas antiguas o pruebas) la fila sólo enseña la actividad. */
type FilaBuscada = DeportistaResumen & Partial<Pick<DeportistaListado, 'trayectoria' | 'seguida'>>;

function FilaDeportista({ d, volver }: { d: FilaBuscada; volver: string }) {
  const t = d.trayectoria ?? TRAYECTORIA_VACIA;
  const nombre = nombreVisible(d.nombre) || d.nombre;
  const homonimo = d.mismoNombre > 1;
  return (
    <FilaPerfil
      p={{ id: d.id, nombre: d.nombre, pais: d.pais, armas: d.armas, resultados: d.resultadosImportados, alias: d.alias }}
      href={rutaFichaConRetorno(d.id, volver)}
      meta={homonimo ? (
        <span className="text-warn" title={`${d.mismoNombre} personas con este nombre`}>
          {d.anioNacimiento !== null ? `n. ${d.anioNacimiento}` : 'Homónimo'}
          <span className="sr-only">: hay {d.mismoNombre} personas con este nombre</span>
        </span>
      ) : undefined}
      detalle={<Medallas t={t} />}
      accion={typeof d.seguida === 'boolean' ? (
        <BotonSeguirCompacto personaId={d.id} nombre={nombre} inicial={d.seguida} lectura={d} />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    />
  );
}

/** Añade `nuevas` a `actuales` sin repetir persona y sin cambiar el orden de lo ya pintado. */
export function anadirSinRepetir<T extends { id: string }>(actuales: readonly T[], nuevas: readonly T[]): T[] {
  const vistas = new Set(actuales.map((d) => d.id));
  const resultado = [...actuales];
  for (const d of nuevas) {
    if (vistas.has(d.id)) continue;
    vistas.add(d.id);
    resultado.push(d);
  }
  return resultado;
}

type EstadoMas = 'reposo' | 'cargando' | 'error';

/**
 * Lista completa de una búsqueda. «Ver más» pide la página siguiente con el
 * cursor de la última y la añade debajo: sin navegar, sin repetir a nadie y
 * en el mismo orden (el cursor es por clave, así que las páginas no se
 * solapan). Sin JavaScript, el mismo botón es un enlace a esa página.
 */
export function ListaDeportistas({
  items,
  siguiente,
  cursorActual,
  criterios,
}: {
  items: FilaBuscada[];
  siguiente: string | null;
  cursorActual: string | undefined;
  criterios: CriteriosExplorar;
}) {
  const [lista, setLista] = React.useState<FilaBuscada[]>(items);
  const [cursor, setCursor] = React.useState(siguiente);
  const [estado, setEstado] = React.useState<EstadoMas>('reposo');
  const contenedor = React.useRef<HTMLUListElement>(null);
  // La ficha vuelve a esta misma búsqueda; lo añadido con «Ver más» se vuelve a pedir al volver.
  const volver = construirUrl(criterios, cursorActual);

  async function verMas(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!cursor || estado === 'cargando') return;
    setEstado('cargando');
    const antes = lista.length;
    try {
      const r = await masDeportistasAccion(aEntrada(criterios, cursor));
      if (r.tipo !== 'ok') {
        setEstado('error');
        return;
      }
      setLista((actual) => anadirSinRepetir(actual, r.items));
      setCursor(r.siguiente);
      setEstado('reposo');
      // El foco pasa a la primera fila nueva: el botón puede desaparecer y el teclado seguiría donde estaba.
      requestAnimationFrame(() => {
        contenedor.current?.querySelectorAll<HTMLElement>('[data-fila-perfil]')[antes]?.focus({ preventScroll: true });
      });
    } catch {
      setEstado('error');
    }
  }

  const n = lista.length;
  return (
    <section aria-labelledby="explorar-resultados" className="flex min-w-0 flex-col gap-1 lg:max-w-2xl">
      <div className="flex min-h-11 items-center justify-between gap-3 px-0.5 sm:px-3">
        <h2 id="explorar-resultados" className="text-base font-semibold tracking-normal">Deportistas</h2>
        <p role="status" className="text-xs text-muted-foreground tabular-nums">
          {n.toLocaleString('es-ES')}{cursor ? '+' : ''}
          <span className="sr-only">{n === 1 ? ' deportista' : ' deportistas'}{cursor ? ', hay más' : ''}</span>
        </p>
      </div>

      {cursorActual ? (
        <Link
          href={construirUrl(criterios)}
          prefetch={false}
          className="px-0.5 py-2 text-sm text-primary-text underline-offset-4 hover:underline sm:px-3"
        >
          Ir a los primeros resultados
        </Link>
      ) : null}

      <ul ref={contenedor} className={CLASE_LISTA_PERFILES} aria-label="Deportistas encontrados">
        {lista.map((d) => (
          <FilaDeportista key={d.id} d={d} volver={volver} />
        ))}
      </ul>

      <div className="flex flex-col items-center gap-2 px-0.5 pt-3 sm:px-3">
        {cursor ? (
          <Button asChild variant="secondary" className={CLASE_VER_MAS}>
            <Link
              href={construirUrl(criterios, cursor)}
              prefetch={false}
              rel="next"
              aria-disabled={estado === 'cargando'}
              onClick={verMas}
            >
              {estado === 'cargando' ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : null}
              {estado === 'cargando' ? 'Cargando…' : 'Ver más'}
            </Link>
          </Button>
        ) : null}
        {estado === 'error' ? (
          <p role="alert" className="text-center text-sm text-danger">
            No se han podido cargar más.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Aviso({
  icono,
  titulo,
  children,
  alerta = false,
}: {
  icono: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
  alerta?: boolean;
}) {
  return (
    <section
      role={alerta ? 'alert' : 'status'}
      className="flex min-w-0 flex-col items-start gap-2 rounded-2xl border bg-card px-4 py-5 lg:max-w-2xl"
    >
      <div className="flex min-w-0 items-center gap-2">
        {icono}
        <h2 className="text-lg leading-tight">{titulo}</h2>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

export function EstadoSinLista({
  vista,
  criterios,
}: {
  vista: Exclude<VistaExplorar, { tipo: 'ok' } | { tipo: 'sin_sesion' }>;
  criterios: CriteriosExplorar;
}) {
  const reintentar = construirUrl(criterios);
  switch (vista.tipo) {
    case 'sin_criterio':
      return (
        <Aviso icono={<SearchX className="size-5 shrink-0 text-muted-foreground" aria-hidden />} titulo="Busca a alguien">
          <p>
            {criterios.q
              ? 'Escribe al menos dos letras.'
              : 'Escribe un nombre o elige un filtro.'}
          </p>
        </Aviso>
      );
    case 'entrada_invalida':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />} titulo="Algún filtro no es válido">
          <p>
            No se ha buscado.
          </p>
          <Button asChild variant="outline">
            <Link href={RUTA_EXPLORAR} prefetch={false}>
              Empezar de nuevo
            </Link>
          </Button>
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />} titulo="Página caducada">
          <Button asChild variant="outline">
            <Link href={reintentar} prefetch={false}>
              Ir a los primeros resultados
            </Link>
          </Button>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />} titulo="Búsqueda no disponible">
          <p>Aún no está activa en esta instalación.</p>
        </Aviso>
      );
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 shrink-0 text-danger" aria-hidden />} titulo="Ha fallado la búsqueda">
          <Button asChild variant="outline">
            <Link href={reintentar} prefetch={false}>
              Reintentar
            </Link>
          </Button>
        </Aviso>
      );
    default:
      return null;
  }
}

export function EstadoSinCoincidencias({ criterios }: { criterios: CriteriosExplorar }) {
  return (
    <Aviso icono={<SearchX className="size-5 shrink-0 text-muted-foreground" aria-hidden />} titulo="Nadie coincide">
      <p>Prueba con menos palabras o menos filtros.</p>
      {hayCriterios(criterios) ? (
        <Button asChild variant="outline">
          <Link href={RUTA_EXPLORAR} prefetch={false}>
            Quitar todos los filtros
          </Link>
        </Button>
      ) : null}
    </Aviso>
  );
}
