import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { Fragment } from 'react';
import { rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import { categoriaVisible, nombrePrueba, nombrePruebaCorto } from '@/lib/sport/explorar/presentacion';
import type { PruebaRelevosPerfil, RelevoCaraACara, RelevosCaraACara, RelevosPerfil } from '@/lib/sport/explorar/relevos';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { WEAPON_LABEL, cn, titular } from '@/lib/utils';
import type { Nivel } from './piezas';

/**
 * Relevos de pruebas por equipos: aparte de los asaltos individuales, en el
 * cara a cara (cada relevo entre las dos) y en el perfil (resumen y lista por
 * prueba). Sólo se pintan si hay alguno.
 */

const ENLACE = 'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset';
const DIA = new Intl.DateTimeFormat('es-ES', { day: '2-digit', timeZone: 'UTC' });
const MES = new Intl.DateTimeFormat('es-ES', { month: 'short', timeZone: 'UTC' });
const ANIO = new Intl.DateTimeFormat('es-ES', { year: '2-digit', timeZone: 'UTC' });
const FECHA_LARGA = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const VISIBLES = 8;

function fechaDe(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const visible = (nombre: string) => nombreVisible(nombre) || titular(nombre);
const conSigno = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

const RONDAS: Record<string, string> = { T2: 'Final', 'T2-3': '3.er puesto', T4: 'Semifinal', T8: 'Cuartos' };

/** «Final», «Semifinal», «Cuartos», «Tabla de 16»; sin clave (cuadro de puestos), «Puestos». */
export function rotuloRondaRelevo(r: Pick<RelevoCaraACara, 'fase' | 'ronda'>): string {
  if (r.fase === 'POULE') return 'Poule';
  if (!r.ronda) return 'Puestos';
  const tabla = /^T(\d+)$/.exec(r.ronda);
  return RONDAS[r.ronda] ?? (tabla ? `Tabla de ${tabla[1]}` : 'Directa');
}

function urlPrueba(p: { edicionId: string; pruebaId: string }, personaId: string): string {
  return `${rutaEdicion(p.edicionId)}?${new URLSearchParams({ prueba: p.pruebaId, persona: personaId }).toString()}`;
}

function Fecha({ iso }: { iso: string | null }) {
  const fecha = fechaDe(iso);
  if (!fecha) return <span aria-hidden className="text-center text-xs text-muted-foreground">–</span>;
  return (
    <time dateTime={iso!.slice(0, 10)} aria-hidden className="flex flex-col items-center leading-none">
      <span className="cifra text-lg">{DIA.format(fecha)}</span>
      <span className="text-[0.625rem] text-muted-foreground">{MES.format(fecha).replace('.', '')} {ANIO.format(fecha)}</span>
    </time>
  );
}

function Fila({ href, etiqueta, className, children }: { href: string | null; etiqueta: string; className: string; children: React.ReactNode }) {
  return (
    <li>
      {href ? (
        <Link href={href} prefetch={false} aria-label={etiqueta} className={cn(className, 'transition-colors hover:bg-secondary/60', ENLACE)}>
          {children}
        </Link>
      ) : (
        <div role="group" aria-label={etiqueta} className={className}>{children}</div>
      )}
    </li>
  );
}

function Lista<T>({ items, clave, fila }: { items: readonly T[]; clave: (x: T) => string; fila: (x: T) => React.ReactNode }) {
  const lista = (xs: readonly T[]) => <ol className="divide-y divide-filete">{xs.map((x) => <Fragment key={clave(x)}>{fila(x)}</Fragment>)}</ol>;
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-t-filete-alto bg-card">
      {lista(items.slice(0, VISIBLES))}
      {items.length > VISIBLES ? (
        <details className="group min-w-0">
          <summary
            className={cn(
              'flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 border-t border-filete text-sm font-medium text-primary-text hover:bg-secondary/60 [&::-webkit-details-marker]:hidden',
              ENLACE,
            )}
          >
            <span className="group-open:hidden">Ver {items.length - VISIBLES} más</span>
            <span className="hidden group-open:inline">Ver menos</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-filete">{lista(items.slice(VISIBLES))}</div>
        </details>
      ) : null}
    </div>
  );
}

const FILA = 'grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 sm:px-4';

/* --------------------------------------------------------------- cara a cara */

function FilaRelevo({ r, yo, nYo, nRival }: { r: RelevoCaraACara; yo: string; nYo: string; nRival: string }) {
  const datosNombre = { nombre: r.torneo, formato: 'EQUIPOS' as const, fuente: r.fuente };
  const nombre = nombrePrueba(datosNombre);
  const corto = nombrePruebaCorto(datosNombre);
  const fecha = fechaDe(r.fecha);
  const ronda = rotuloRondaRelevo(r);
  const gana = r.mios > r.rival ? 'yo' : r.mios < r.rival ? 'rival' : null;
  const etiqueta = [
    fecha ? FECHA_LARGA.format(fecha) : null,
    nombre,
    `${ronda}, relevo ${r.numero}`,
    `${nYo} ${r.mios} tocados, ${nRival} ${r.rival}`,
  ].filter(Boolean).join('. ');
  return (
    <Fila href={r.edicionId ? urlPrueba(r, yo) : null} etiqueta={etiqueta} className={FILA}>
      <Fecha iso={r.fecha} />
      <span aria-hidden className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm leading-tight font-medium" title={corto === nombre ? undefined : nombre}>{corto}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-filete-alto px-2 text-[0.6875rem] text-foreground/85">
            {ronda}
          </span>
          <span className="shrink-0">R{r.numero}</span>
          <span className="truncate">{categoriaVisible(r.categoria)}</span>
        </span>
      </span>
      <span aria-hidden className="cifra flex items-baseline gap-1 text-xl leading-none">
        <span className={gana === 'yo' ? 'text-ok' : 'text-muted-foreground'}>{r.mios}</span>
        <span className="text-sm text-muted-foreground">–</span>
        <span className={gana === 'rival' ? 'text-danger' : 'text-muted-foreground'}>{r.rival}</span>
      </span>
    </Fila>
  );
}

/**
 * Cada relevo entre las dos en pruebas por equipos, del más reciente: fecha,
 * prueba, ronda, número de relevo y los tocados de cada una en ese relevo.
 * No suma al balance de asaltos.
 */
export function RelevosCaraACaraVista({
  datos,
  yo,
  rival,
}: {
  datos: RelevosCaraACara | null;
  yo: { id: string; nombre: string };
  rival: { id: string; nombre: string };
}) {
  if (!datos || datos.items.length === 0) return null;
  const fila = { yo: yo.id, nYo: visible(yo.nombre), nRival: visible(rival.nombre) };
  const { relevos, tocadosFavor, tocadosContra } = datos.resumen;
  return (
    <section aria-labelledby="h2h-relevos" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="h2h-relevos" className="flex items-baseline gap-2 text-xl">
          Relevos
          <span className="cifra text-lg text-muted-foreground">{relevos}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Por equipos, aparte de los asaltos. <span className="whitespace-nowrap">Tocados <span className="cifra text-foreground">{tocadosFavor}–{tocadosContra}</span></span>
          {datos.truncado ? ' (los más recientes)' : ''}
        </p>
      </div>
      <Lista items={datos.items} clave={(r) => r.id} fila={(r) => <FilaRelevo r={r} {...fila} />} />
    </section>
  );
}

export async function RelevosCaraACaraDiferido({
  promesa,
  ...resto
}: { promesa: Promise<RelevosCaraACara | null> } & Omit<Parameters<typeof RelevosCaraACaraVista>[0], 'datos'>) {
  return <RelevosCaraACaraVista datos={await promesa} {...resto} />;
}

/* -------------------------------------------------------------------- perfil */

function FilaPrueba({ p, personaId, armaHabitual }: { p: PruebaRelevosPerfil; personaId: string; armaHabitual: string }) {
  const datosNombre = { nombre: p.torneo, formato: 'EQUIPOS' as const, fuente: p.fuente };
  const nombre = nombrePrueba(datosNombre);
  const corto = nombrePruebaCorto(datosNombre);
  const fecha = fechaDe(p.fecha);
  const detalle = [p.arma !== armaHabitual ? WEAPON_LABEL[p.arma] : null, categoriaVisible(p.categoria), p.equipo]
    .filter((x): x is string => Boolean(x));
  const etiqueta = [
    fecha ? FECHA_LARGA.format(fecha) : null,
    nombre,
    `${p.relevos} ${p.relevos === 1 ? 'relevo' : 'relevos'}`,
    `${p.dados} tocados dados, ${p.recibidos} recibidos`,
  ].filter(Boolean).join('. ');
  return (
    <Fila href={p.edicionId ? urlPrueba(p, personaId) : null} etiqueta={etiqueta} className={FILA}>
      <Fecha iso={p.fecha} />
      <span aria-hidden className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm leading-tight font-medium" title={corto === nombre ? undefined : nombre}>{corto}</span>
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
          {detalle.map((d, i) => (
            <span key={`${d}-${i}`} className={cn(i === detalle.length - 1 ? 'min-w-0 truncate' : 'shrink-0')}>{d}</span>
          ))}
        </span>
      </span>
      <span aria-hidden className="flex flex-col items-end gap-0.5 leading-none">
        <span className="cifra text-lg">
          {p.dados}<span className="text-sm text-muted-foreground">–</span>{p.recibidos}
        </span>
        <span className="text-[0.6875rem] text-muted-foreground">{p.relevos} rel.</span>
      </span>
    </Fila>
  );
}

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'ok' | 'danger' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn('cifra text-2xl leading-none', tono === 'ok' && 'text-ok', tono === 'danger' && 'text-danger')}>{valor}</dd>
    </div>
  );
}

function armaMasComun(pruebas: readonly PruebaRelevosPerfil[]): string {
  const cuenta = new Map<string, number>();
  for (const p of pruebas) cuenta.set(p.arma, (cuenta.get(p.arma) ?? 0) + 1);
  return [...cuenta].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/**
 * Resumen compacto de los relevos de una persona y la lista por prueba. Va
 * como bloque propio al final de la pestaña Rivales.
 */
export function RelevosPerfilVista({
  datos,
  personaId,
  nivel = 'pagina',
}: {
  datos: RelevosPerfil | null;
  personaId: string;
  nivel?: Nivel;
}) {
  if (!datos || datos.relevos === 0) return null;
  const armaHabitual = armaMasComun(datos.pruebas);
  const Titulo = nivel === 'pagina' ? 'h2' : 'h3';
  return (
    <section aria-labelledby="perfil-relevos" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <Titulo id="perfil-relevos" className="text-xl">Relevos</Titulo>
        <p className="text-xs text-muted-foreground">
          {datos.pruebas.length === 1 ? '1 prueba' : `${datos.pruebas.length} pruebas`} por equipos
          {datos.truncado ? ' (las más recientes)' : ''}
        </p>
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-4">
        <Cifra etiqueta="Relevos" valor={String(datos.relevos)} />
        <Cifra etiqueta="Dados" valor={String(datos.dados)} />
        <Cifra etiqueta="Recibidos" valor={String(datos.recibidos)} />
        <Cifra etiqueta="Índice" valor={conSigno(datos.indice)} tono={datos.indice > 0 ? 'ok' : datos.indice < 0 ? 'danger' : undefined} />
      </dl>
      <Lista items={datos.pruebas} clave={(p) => p.pruebaId} fila={(p) => <FilaPrueba p={p} personaId={personaId} armaHabitual={armaHabitual} />} />
    </section>
  );
}

export async function RelevosPerfilDiferido({
  promesa,
  ...resto
}: { promesa: Promise<RelevosPerfil | null> } & Omit<Parameters<typeof RelevosPerfilVista>[0], 'datos'>) {
  return <RelevosPerfilVista datos={await promesa} {...resto} />;
}
