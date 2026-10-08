'use client';

import { ChevronRight, SearchX, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { masDeportistasAccion } from '@/app/(app)/explorar/acciones';
import { Boton } from '@/components/sistema/boton';
import { CabeceraSeccion, VerMas } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { Pastilla } from '@/components/sistema/pastilla';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type { DeportistaListado, VistaExplorar } from '@/lib/sport/explorar/pantalla';
import type { Medalla } from '@/lib/sport/explorar/presentacion';
import type { DeportistaResumen } from '@/lib/sport/explorar/tipos';
import { TRAYECTORIA_VACIA, type TrayectoriaPersona } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import {
  CRITERIOS_VACIOS,
  RUTA_BUSCAR,
  aEntrada,
  chipsActivos,
  construirUrl,
  construirUrlBuscar,
  hayCriterios,
  type ClaveCriterio,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';
import { CLASE_LISTA_PERFILES, FilaPerfil, SELECTOR_FILA_PERFIL, enlaceDeFila } from './buscador-social-fila';
import { BotonSeguirCompacto } from './buscador-social-seguir';

/**
 * Filtros activos como pastillas que los quitan uno a uno. Tiradores los pinta
 * en su barra de filtros; ésta queda para pantallas y arneses que enseñan una
 * búsqueda sin la barra.
 */
export function ChipsActivos({
  criterios,
  omitir = [],
}: {
  criterios: CriteriosExplorar;
  /** Criterios que ya se ven (y se quitan) en otro control. */
  omitir?: readonly ClaveCriterio[];
}) {
  const todos = chipsActivos(criterios).filter((c) => !omitir.includes(c.clave));
  // El nombre solo ya está a la vista en la barra de búsqueda (con su X); como pastilla repetiría lo mismo.
  const chips = todos.length === 1 && todos[0].clave === 'q' ? [] : todos;
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex min-w-0 flex-wrap gap-x-2">
      {chips.map((chip) => (
        <li key={chip.clave} className="min-w-0 max-w-full">
          <Link
            href={chip.quitar}
            prefetch={false}
            replace
            scroll={false}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}${chip.fechaInvalida ? ' (fecha no válida)' : ''}`}
            className="group flex h-11 max-w-full items-center outline-none"
          >
            <span
              className={cn(
                'inline-flex h-8 max-w-full items-center gap-1 rounded-full border bg-secondary px-3 text-xs whitespace-nowrap group-hover:bg-accent group-focus-visible:ring-[3px] group-focus-visible:ring-ring',
                chip.fechaInvalida && 'border-danger',
              )}
            >
              <span className="shrink-0 text-muted-foreground">{chip.etiqueta}</span>
              <span className="min-w-0 truncate font-medium">{chip.valor}</span>
              {chip.fechaInvalida ? <span className="shrink-0 text-xs text-danger">no válida</span> : null}
              <X className="size-[14px] shrink-0 text-muted-foreground" aria-hidden />
            </span>
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

/** Medallas individuales en pastillas del color del metal; el número y el texto oculto dicen el metal, no sólo el color. */
function Medallas({ t }: { t: TrayectoriaPersona }) {
  const metales = METALES.filter((m) => t[m.clave] > 0);
  if (metales.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {metales.map((m) => (
        <Pastilla key={m.clave} tono={m.medalla} className="tabular-nums">
          {t[m.clave]}
          <span className="sr-only"> {t[m.clave] === 1 ? m.uno : m.varios}</span>
        </Pastilla>
      ))}
    </span>
  );
}

/** Sin trayectoria (lecturas antiguas o pruebas) la fila sólo enseña la actividad. */
type FilaBuscada = DeportistaResumen & Partial<Pick<DeportistaListado, 'trayectoria' | 'seguida' | 'olimpica'>>;

function FilaDeportista({ d, volver }: { d: FilaBuscada; volver: string }) {
  const t = d.trayectoria ?? TRAYECTORIA_VACIA;
  const nombre = nombreVisible(d.nombre) || d.nombre;
  const homonimo = d.mismoNombre > 1;
  return (
    <FilaPerfil
      p={{ id: d.id, nombre: d.nombre, pais: d.pais, armas: d.armas, resultados: d.resultadosImportados, alias: d.alias, olimpica: d.olimpica }}
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
 * solapan).
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
  // La ficha vuelve a esta misma búsqueda (en la forma que guardan las fichas); lo añadido con «Ver más» se vuelve a pedir al volver.
  const volver = construirUrl(criterios, cursorActual);

  async function verMas() {
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
        enlaceDeFila(contenedor.current?.querySelectorAll(SELECTOR_FILA_PERFIL)[antes])?.focus({ preventScroll: true });
      });
    } catch {
      setEstado('error');
    }
  }

  const n = lista.length;
  return (
    <section aria-labelledby="explorar-resultados" className="flex min-w-0 flex-col lg:max-w-2xl">
      <CabeceraSeccion
        id="explorar-resultados"
        titulo="Tiradores"
        accion={(
          <p role="status" className="text-xs text-muted-foreground tabular-nums">
            {n.toLocaleString('es-ES')}{cursor ? '+' : ''}
            <span className="sr-only">{n === 1 ? ' tirador' : ' tiradores'}{cursor ? ', hay más' : ''}</span>
          </p>
        )}
      />

      {cursorActual ? (
        <Link
          href={construirUrlBuscar(criterios)}
          prefetch={false}
          replace
          className="py-2 text-sm text-primary-text underline-offset-4 hover:underline"
        >
          Ir a los primeros resultados
        </Link>
      ) : null}

      <ul ref={contenedor} className={CLASE_LISTA_PERFILES} aria-label="Tiradores encontrados" aria-busy={estado === 'cargando'}>
        {lista.map((d) => (
          <FilaDeportista key={d.id} d={d} volver={volver} />
        ))}
      </ul>

      <div className="flex flex-col items-center gap-2 pt-1">
        {cursor ? <VerMas onClick={() => void verMas()} detalle="tiradores" /> : null}
        <p role="status" className={estado === 'error' ? 'text-center text-sm text-danger' : 'sr-only'}>
          {estado === 'cargando' ? 'Leyendo más tiradores' : estado === 'error' ? 'No se han podido cargar más.' : ''}
        </p>
      </div>
    </section>
  );
}

function Accion({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Boton asChild variante="contorno">
      <Link href={href} prefetch={false} replace>{children}</Link>
    </Boton>
  );
}

export function EstadoSinLista({
  vista,
  criterios,
}: {
  vista: Exclude<VistaExplorar, { tipo: 'ok' } | { tipo: 'sin_sesion' }>;
  criterios: CriteriosExplorar;
}) {
  const reintentar = construirUrlBuscar(criterios);
  switch (vista.tipo) {
    case 'sin_criterio':
      return (
        <EstadoVacio
          icono={SearchX}
          titulo="Busca a alguien"
          descripcion={criterios.q ? 'Escribe al menos dos letras.' : 'Escribe un nombre o elige un filtro.'}
        />
      );
    case 'entrada_invalida':
      return (
        <EstadoVacio
          tipo="error"
          icono={TriangleAlert}
          titulo="Algún filtro no es válido"
          accion={<Accion href={RUTA_BUSCAR}>Empezar de nuevo</Accion>}
        />
      );
    case 'cursor_invalido':
      return (
        <EstadoVacio
          tipo="error"
          icono={TriangleAlert}
          titulo="Página caducada"
          accion={<Accion href={reintentar}>Ir a los primeros resultados</Accion>}
        />
      );
    case 'no_disponible':
      return <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Búsqueda no disponible" descripcion="Aún no está activa en esta instalación." />;
    case 'error':
      return (
        <EstadoVacio
          tipo="error"
          icono={TriangleAlert}
          titulo="Ha fallado la búsqueda"
          accion={<Accion href={reintentar}>Reintentar</Accion>}
        />
      );
    default:
      return null;
  }
}

export function EstadoSinCoincidencias({ criterios }: { criterios: CriteriosExplorar }) {
  return (
    <EstadoVacio
      icono={SearchX}
      titulo="Nadie coincide"
      descripcion="Prueba con menos palabras o menos filtros."
      accion={hayCriterios({ ...criterios, q: '' }) ? (
        <Accion href={construirUrlBuscar({ ...CRITERIOS_VACIOS, q: criterios.q })}>Quitar filtros</Accion>
      ) : null}
    />
  );
}
