import { ArrowLeft, Medal, SearchX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import {
  ETIQUETA_SERIE,
  type SerieComplementaria,
} from '@/lib/ingest/series-complementarias';
import type { Clasificacion, EdicionDetalle, EdicionResumen, PruebaDeEdicion } from '@/lib/sport/explorar/edicion-modelo';
import {
  RUTA_EDICIONES,
  construirUrlEdicion,
  rutaEdicion,
  urlExplorarDePrueba,
  type CriteriosEdicion,
} from '@/lib/sport/explorar/edicion-url';
import type { VistaEdicion, VistaSeries } from '@/lib/sport/explorar/ediciones-pantalla';
import { fuenteResultado } from '@/lib/sport/explorar/etiquetas';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import { WEAPON_LABEL, cn } from '@/lib/utils';
import { Bloque, Nota, fechaLegible } from './piezas';
import { EnlacesResultados, EstadoResultadosPrueba, nombreDePrueba } from './prueba-resultados';

const ENLACE =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';
const ENLACE_VOLVER =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/** Entrada a las ediciones desde Explorar, sin ocupar sitio en la barra. */
export function EnlaceEdiciones({ className }: { className?: string }) {
  return (
    <Link href={RUTA_EDICIONES} prefetch={false} className={cn(ENLACE, className)}>
      <Medal className="size-4" aria-hidden />
      Ediciones y series
    </Link>
  );
}

/** Vuelta a las ediciones desde Explorar cuando la búsqueda está acotada a una. */
export function EnlaceVolverAEdicion({ edicionId }: { edicionId: string }) {
  return (
    <Link href={rutaEdicion(edicionId)} prefetch={false} className={ENLACE}>
      <Medal className="size-4" aria-hidden />
      Ver la edición y su clasificación
    </Link>
  );
}

function periodo(inicio: string | null, fin: string | null): string | null {
  if (!inicio) return null;
  return fin && fin !== inicio ? `${fechaLegible(inicio)} – ${fechaLegible(fin)}` : fechaLegible(inicio);
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
      className="flex flex-col items-start gap-2 rounded-md border bg-card px-4 py-5"
    >
      <div className="flex items-center gap-2">
        {icono}
        <h2 className="text-xl">{titulo}</h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

/* --------------------------------------------------------------------- series */

function FilaEdicion({ e }: { e: EdicionResumen }) {
  const fechas = periodo(e.inicio, e.fin);
  return (
    <li>
      <Link
        href={rutaEdicion(e.id)}
        prefetch={false}
        className="grid min-h-11 gap-x-4 gap-y-1 px-3 py-3 hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)] md:items-center"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium break-words">{e.nombre}</span>
          <span className="text-xs text-muted-foreground">
            Temporada {e.temporada}
            {e.ciudad ? ` · ${e.ciudad}` : ''}
          </span>
        </span>
        <span className="text-sm">{fechas ?? <span className="text-muted-foreground">Fechas no publicadas</span>}</span>
        <span className="flex flex-col gap-0.5 text-sm">
          <span>
            {e.pruebas} {e.pruebas === 1 ? 'prueba publicada' : 'pruebas publicadas'}
          </span>
          <span className="text-xs text-muted-foreground">
            {e.armas.length > 0 ? e.armas.map((a) => WEAPON_LABEL[a]).join(', ') : 'Sin armas indicadas'}
            {e.formatos.length > 0
              ? ` · ${e.formatos.map((f) => (f === 'EQUIPOS' ? 'equipos' : 'individual')).join(' y ')}`
              : ''}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function ListaSeries({ series }: { series: { serie: SerieComplementaria; ediciones: EdicionResumen[] }[] }) {
  return (
    <div className="flex flex-col gap-8">
      {series.map(({ serie, ediciones }) => {
        const id = `serie-${serie}`;
        return (
          <Bloque key={serie} id={id} titulo={ETIQUETA_SERIE[serie]} nivel="pagina">
            {ediciones.length === 0 ? (
              <Nota>
                Ninguna edición de esta serie está importada todavía. No se muestran pruebas que la fuente no haya
                publicado ni se completa la serie con otras.
              </Nota>
            ) : (
              <ul className="divide-y rounded-md border bg-card" aria-label={`Ediciones: ${ETIQUETA_SERIE[serie]}`}>
                {ediciones.map((e) => (
                  <FilaEdicion key={e.id} e={e} />
                ))}
              </ul>
            )}
          </Bloque>
        );
      })}
      <Nota>
        La serie se reconoce por el nombre publicado de la edición. Las categorías y modalidades son las que cada
        fuente publica; los Juegos Olímpicos de la Juventud no se incluyen.
      </Nota>
    </div>
  );
}

export function EstadoSeries({ vista }: { vista: Exclude<VistaSeries, { tipo: 'ok' } | { tipo: 'sin_sesion' }> }) {
  return vista.tipo === 'no_disponible' ? (
    <Aviso
      alerta
      icono={<TriangleAlert className="size-5 text-warn" aria-hidden />}
      titulo="Las ediciones aún no están activas"
    >
      <p>
        Los datos deportivos todavía no están preparados en esta instalación. No es que no haya ediciones.
      </p>
    </Aviso>
  ) : (
    <Aviso
      alerta
      icono={<TriangleAlert className="size-5 text-danger" aria-hidden />}
      titulo="No se han podido leer las ediciones"
    >
      <p>Ha fallado la consulta, no es que no haya ediciones. Inténtalo de nuevo.</p>
      <Button asChild variant="outline">
        <Link href={RUTA_EDICIONES} prefetch={false}>
          Reintentar
        </Link>
      </Button>
    </Aviso>
  );
}

/* -------------------------------------------------------------------- edición */

function FilaPrueba({
  edicion,
  p,
  elegida,
}: {
  edicion: EdicionResumen;
  p: PruebaDeEdicion;
  elegida: boolean;
}) {
  return (
    <li
      aria-current={elegida ? 'true' : undefined}
      className={cn('grid gap-x-6 gap-y-3 px-3 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)]', elegida && 'bg-accent/40')}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-base font-medium break-words">{nombreDePrueba(p)}</h3>
        {p.fecha ? <span className="text-xs text-muted-foreground">{fechaLegible(p.fecha)}</span> : null}
        <EstadoResultadosPrueba estado={p.resultados.estado} importados={p.resultados.importados} />
      </div>
      <EnlacesResultados enlaces={p.enlaces} />
      <div className="flex flex-col items-start">
        {p.resultados.importados > 0 ? (
          <Link
            href={construirUrlEdicion(edicion.id, { prueba: p.id })}
            prefetch={false}
            aria-label={`Ver la clasificación: ${nombreDePrueba(p)}`}
            className={ENLACE}
          >
            Ver la clasificación
          </Link>
        ) : null}
        <Link
          href={urlExplorarDePrueba(edicion.id, p)}
          prefetch={false}
          aria-label={`Buscar en Explorar a quienes compitieron en: ${nombreDePrueba(p)}`}
          className={ENLACE}
        >
          Buscar en Explorar
        </Link>
      </div>
    </li>
  );
}

export function PruebasDeEdicion({
  edicion,
  seleccionada,
}: {
  edicion: EdicionDetalle;
  seleccionada: string;
}) {
  if (edicion.pruebasDetalle.length === 0) {
    return (
      <Nota>
        Esta edición no tiene pruebas importadas. No se inventan pruebas que la fuente no haya publicado.
      </Nota>
    );
  }
  const grupos = (['INDIVIDUAL', 'EQUIPOS'] as const)
    .map((formato) => ({ formato, pruebas: edicion.pruebasDetalle.filter((p) => p.formato === formato) }))
    .filter((g) => g.pruebas.length > 0);
  return (
    <div className="flex flex-col gap-5">
      {grupos.map((g) => (
        <section key={g.formato} aria-label={g.formato === 'EQUIPOS' ? 'Pruebas por equipos' : 'Pruebas individuales'}>
          <h3 className="pb-2 text-lg">{g.formato === 'EQUIPOS' ? 'Por equipos' : 'Individuales'}</h3>
          <ul className="divide-y rounded-md border bg-card">
            {g.pruebas.map((p) => (
              <FilaPrueba key={p.id} edicion={edicion} p={p} elegida={p.id === seleccionada} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FilaPuesto({
  fila,
  volver,
}: {
  fila: Clasificacion['filas'][number];
  volver: string;
}) {
  const contenido = (
    <>
      <span className="cifra text-2xl leading-none md:text-right">{fila.puesto ?? '—'}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium break-words">{fila.nombre}</span>
        {fila.puesto === null && fila.puestoPublicado ? (
          <span className="text-xs text-muted-foreground">Publicado como «{fila.puestoPublicado}»</span>
        ) : null}
        {fila.personaId ? null : (
          <span className="text-xs text-muted-foreground">Sin ficha deportiva vinculada</span>
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {fila.pais ? <BanderaPais pais={fila.pais} /> : <span className="text-muted-foreground">País no publicado</span>}
        {fila.club ? <span className="text-xs text-muted-foreground">{fila.club}</span> : null}
      </span>
    </>
  );
  const rejilla =
    'grid min-h-11 grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-3 py-3 md:grid-cols-[3rem_minmax(0,2fr)_minmax(0,1.5fr)]';
  return (
    <li>
      {fila.personaId ? (
        <Link
          href={rutaFichaConRetorno(fila.personaId, volver)}
          prefetch={false}
          aria-label={`Abrir la ficha deportiva de ${fila.nombre}`}
          className={cn(
            rejilla,
            'hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
          )}
        >
          {contenido}
        </Link>
      ) : (
        <div className={rejilla}>{contenido}</div>
      )}
    </li>
  );
}

export function ClasificacionDePrueba({
  edicion,
  prueba,
  clasificacion,
  criterios,
}: {
  edicion: EdicionResumen;
  prueba: PruebaDeEdicion;
  clasificacion: Clasificacion;
  criterios: CriteriosEdicion;
}) {
  // La ficha vuelve a esta misma página de esta misma clasificación.
  const volver = construirUrlEdicion(edicion.id, { prueba: prueba.id, cursor: criterios.cursor });
  return (
    <Bloque id="edicion-clasificacion" titulo={`Clasificación: ${nombreDePrueba(prueba)}`} nivel="pagina">
      {clasificacion.filas.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No hay puestos importados para esta prueba. No significa que no se haya disputado.
        </p>
      ) : (
        <>
          <p role="status" className="text-sm text-muted-foreground">
            {clasificacion.filas.length === 1 ? '1 puesto' : `${clasificacion.filas.length} puestos`} en esta página
            {clasificacion.siguiente ? ', hay más' : ''}. Fuente: {fuenteResultado(clasificacion.fuente)}.
          </p>
          <ul className="divide-y rounded-md border bg-card" aria-label="Clasificación">
            {clasificacion.filas.map((f) => (
              <FilaPuesto key={f.id} fila={f} volver={volver} />
            ))}
          </ul>
          <nav aria-label="Páginas de la clasificación" className="flex flex-wrap items-center gap-3">
            {criterios.cursor ? (
              <Button asChild variant="outline">
                <Link href={construirUrlEdicion(edicion.id, { prueba: prueba.id })} prefetch={false}>
                  Volver al principio
                </Link>
              </Button>
            ) : null}
            {clasificacion.siguiente ? (
              <Button asChild variant="outline">
                <Link
                  href={construirUrlEdicion(edicion.id, { prueba: prueba.id, cursor: clasificacion.siguiente })}
                  prefetch={false}
                  rel="next"
                >
                  Ver más puestos
                </Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">No hay más puestos importados.</p>
            )}
          </nav>
        </>
      )}
      {clasificacion.otrasFuentes.length > 0 ? (
        <Nota>
          Hay puestos de otras fuentes para esta prueba que no se mezclan aquí:{' '}
          {clasificacion.otrasFuentes
            .map((o) => `${fuenteResultado(o.fuente)} (${o.filas})`)
            .join(', ')}
          .
        </Nota>
      ) : null}
      <Nota>
        Sólo las filas vinculadas a una persona deportiva abren su ficha. Una fila sin vínculo se conserva tal y
        como la publicó la fuente: no se asigna a nadie por parecido de nombre.
      </Nota>
    </Bloque>
  );
}

export function EdicionCompleta({
  edicion,
  criterios,
}: {
  edicion: EdicionDetalle;
  criterios: CriteriosEdicion;
}) {
  const fechas = periodo(edicion.inicio, edicion.fin);
  const elegida = edicion.pruebasDetalle.find((p) => p.id === criterios.prueba) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Volver">
        <Link href={RUTA_EDICIONES} prefetch={false} className={ENLACE_VOLVER}>
          <ArrowLeft className="size-4" aria-hidden />
          Volver a las ediciones
        </Link>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl break-words sm:text-3xl">{edicion.nombre}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {edicion.serie ? <span className="font-medium text-foreground">{ETIQUETA_SERIE[edicion.serie]}</span> : null}
          <span>Temporada {edicion.temporada}</span>
          {edicion.ciudad ? <span>{edicion.ciudad}</span> : null}
          {edicion.pais ? <BanderaPais pais={edicion.pais} /> : null}
          {fechas ? <span>{fechas}</span> : null}
          <span>Fuente: {fuenteResultado(edicion.fuente)}</span>
        </p>
      </header>

      {edicion.pruebaDesconocida ? (
        <p role="alert" className="medida text-sm text-warn">
          La prueba pedida no pertenece a esta edición. Elige una de las de abajo.
        </p>
      ) : null}

      <Bloque id="edicion-pruebas" titulo="Pruebas publicadas" nivel="pagina">
        <PruebasDeEdicion edicion={edicion} seleccionada={criterios.prueba} />
      </Bloque>

      {elegida && edicion.clasificacion ? (
        <ClasificacionDePrueba
          edicion={edicion}
          prueba={elegida}
          clasificacion={edicion.clasificacion}
          criterios={criterios}
        />
      ) : null}
    </div>
  );
}

export function EstadoEdicion({ vista }: { vista: Exclude<VistaEdicion, { tipo: 'ok' } | { tipo: 'sin_sesion' }> }) {
  const volver = (
    <Button asChild variant="outline">
      <Link href={RUTA_EDICIONES} prefetch={false}>
        Ver las ediciones
      </Link>
    </Button>
  );
  switch (vista.tipo) {
    case 'no_encontrada':
      return (
        <Aviso icono={<SearchX className="size-5 text-muted-foreground" aria-hidden />} titulo="Esta edición no existe">
          <p>No hay ninguna edición con ese identificador. Puede que el enlace sea antiguo.</p>
          {volver}
        </Aviso>
      );
    case 'entrada_invalida':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Dirección no válida">
          <p>El identificador de la edición no se entiende, así que no se ha consultado nada.</p>
          {volver}
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso
          alerta
          icono={<TriangleAlert className="size-5 text-warn" aria-hidden />}
          titulo="Esta página ya no corresponde a la clasificación"
        >
          <p>El enlace de página es de otra prueba o ha caducado. Vuelve a la edición para elegirla de nuevo.</p>
          {volver}
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso
          alerta
          icono={<TriangleAlert className="size-5 text-warn" aria-hidden />}
          titulo="Las ediciones aún no están activas"
        >
          <p>Los datos deportivos todavía no están preparados en esta instalación. No es que no haya resultados.</p>
        </Aviso>
      );
    default:
      return (
        <Aviso
          alerta
          icono={<TriangleAlert className="size-5 text-danger" aria-hidden />}
          titulo="No se ha podido leer la edición"
        >
          <p>Ha fallado la consulta, no es que no haya resultados. Inténtalo de nuevo.</p>
          {volver}
        </Aviso>
      );
  }
}
