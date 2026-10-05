import { ArrowLeft, Info, Swords, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { rutaCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import {
  estadoLectura,
  etiquetaHecho,
  etiquetaTipo,
  explicacionSinVinculo,
  fuenteRanking,
  fuenteResultado,
} from '@/lib/sport/explorar/etiquetas';
import { RUTA_EDICIONES, rutaEdicion } from '@/lib/sport/explorar/edicion-url';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import type { FichaConPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { Aclaracion, Bloque, Celda, Dato, EnlaceFuente, Nota, fechaLegible, type Nivel } from './piezas';
import { EstadisticasDeportistaVista } from './estadisticas-deportista';
import { FotoDeportista } from './foto-deportista';
import { CifrasPerfil } from './perfil/cifras-perfil';
import { PuestoFinal, partesFecha } from './perfil/piezas-perfil';
import { ManoAMano } from './perfil/rivales-perfil';
import { AnioAAnio } from './perfil/temporadas-perfil';
import {
  construirUrlFicha,
  RUTA_EXPLORAR,
  sanitizarRetorno,
  type CriteriosFicha,
} from '@/lib/sport/explorar/ficha-url';
import type { HistorialVista, VistaFicha } from '@/lib/sport/explorar/ficha-pantalla';
import type {
  CoberturaFicha,
  EntradaRankingOficial,
  EstadisticaPorTipo,
  FichaDeportiva,
  ResultadoHistorial,
} from '@/lib/sport/explorar/tipos';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import {
  CATEGORY_LABEL,
  GENDER_LABEL,
  WEAPON_LABEL,
  cn,
  titular,
} from '@/lib/utils';

/**
 * Ficha deportiva de una persona indexada.
 *
 * Sólo lleva lo que trae `FichaDeportiva`: hechos deportivos publicados. No hay
 * ninguna lectura de cuenta, correo, tutor, consentimiento ni licencia, y una
 * fecha que la fuente no publica se dice «no publicada»: nunca se rellena con
 * una por defecto ni se cuenta como cero.
 */

/* ------------------------------------------------------------------ cabecera */

function DatoCabecera({
  etiqueta,
  children,
  className,
}: {
  etiqueta: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 bg-card px-4 py-3 sm:px-6', className)}>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

const plegar = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').split(/\s+/).sort().join(' ');

/**
 * Cabecera tipo perfil: retrato FIE grande, nombre en formato «Nombre
 * Apellidos», país, armas, club y las dos acciones de la ficha (cara a cara y
 * favorito). Un posible menor no lleva retrato, año ni enlace a la FIE.
 */
export function CabeceraFicha({
  ficha,
  titulo = true,
  acciones,
}: {
  ficha: FichaConPerfil;
  titulo?: boolean;
  /** Controles propios de la cuenta que mira, como guardar en favoritos. */
  acciones?: React.ReactNode;
}) {
  const nombre = nombreVisible(ficha.nombre) || ficha.nombre;
  const perfil = ficha.perfil;
  const propio = plegar(nombre);
  // Un alias que sólo cambia el orden o las mayúsculas del nombre no aporta nada.
  const alias = ficha.alias.filter((a) => plegar(nombreVisible(a)) !== propio);
  return (
    <header className="flex min-w-0 flex-col border-y border-t-filete-alto bg-card">
      <div className="flex min-w-0 items-start gap-4 px-4 pt-5 pb-4 sm:gap-6 sm:px-6 sm:pt-6 sm:pb-5">
        <FotoDeportista
          personaId={ficha.id}
          nombre={nombre}
          ocultar={ficha.esMenor}
          tamano="perfil"
          decorativa
        />
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:pt-1">
          {titulo ? (
            <h1 className="min-w-0 text-4xl leading-[0.95] break-words sm:text-5xl lg:text-6xl">{nombre}</h1>
          ) : (
            <p className="min-w-0 font-display text-4xl leading-[0.95] break-words sm:text-5xl">{nombre}</p>
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {ficha.pais ? (
              <BanderaPais pais={ficha.pais} tamaño="ficha" />
            ) : (
              <span className="text-sm text-muted-foreground">País no publicado</span>
            )}
            {perfil?.armas.map((arma) => (
              <Badge key={arma} variant="outline" className="h-7 px-3 text-sm">
                {WEAPON_LABEL[arma]}
              </Badge>
            ))}
            {ficha.esPropia ? <Badge variant="secondary" className="h-7 px-3">Es tu ficha deportiva</Badge> : null}
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border-t bg-border sm:grid-cols-4">
        <DatoCabecera etiqueta="Club publicado más reciente">
          {perfil?.club ? (
            <>
              {titular(perfil.club.nombre)}
              <span className="block text-xs text-muted-foreground">{fuenteResultado(perfil.club.fuente)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">No publicado</span>
          )}
        </DatoCabecera>
        <DatoCabecera etiqueta="Año de nacimiento">
          {ficha.anioNacimiento !== null ? (
            <span className="cifra text-xl">{ficha.anioNacimiento}</span>
          ) : (
            <span className="text-muted-foreground">{ficha.esMenor ? 'No se muestra' : 'No publicado'}</span>
          )}
        </DatoCabecera>
        <DatoCabecera etiqueta="Género">
          {ficha.genero ? GENDER_LABEL[ficha.genero] : <span className="text-muted-foreground">No publicado</span>}
        </DatoCabecera>
        <DatoCabecera etiqueta="También publicado como">
          {alias.length > 0 ? alias.join(', ') : <span className="text-muted-foreground">Sin otras formas</span>}
        </DatoCabecera>
      </dl>

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 border-t px-4 py-3 sm:px-6">
        <Button asChild>
          <Link href={rutaCaraACara(ficha.id)} prefetch={false}>
            <Swords aria-hidden />
            Cara a cara
          </Link>
        </Button>
        {acciones ? <div className="min-w-0">{acciones}</div> : null}
        {perfil?.enlaceFie ? <EnlaceFuente url={perfil.enlaceFie} etiqueta="Perfil en la FIE" /> : null}
      </div>

      {ficha.esMenor ? (
        <p className="flex items-start gap-2 border-t px-4 py-3 text-sm text-muted-foreground sm:px-6">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="medida">
            Posible menor de edad: esta ficha enseña sólo resultados deportivos publicados por las
            federaciones. No hay foto, fecha de nacimiento, contacto ni datos de tutores.
          </span>
        </p>
      ) : null}
      <div className="border-t px-4 sm:px-6">
        <Aclaracion titulo="Sobre esta ficha">
          <Nota>
            La ficha no dice si la persona sigue compitiendo: sólo recoge lo que han publicado las
            fuentes. Que no tenga cuenta en la aplicación no significa que esté retirada. Junta todos
            los resultados de las fichas fusionadas de esta persona, de la FIE, de la RFEE y de Skermo.
          </Nota>
        </Aclaracion>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------- estadísticas */

function FilaEstadistica({ e }: { e: EstadisticaPorTipo }) {
  const sinDato = <span className="text-sm text-muted-foreground">Sin dato</span>;
  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-5 sm:grid-cols-3 md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))] md:items-center">
      <span className="col-span-2 min-w-0 font-medium break-words sm:col-span-3 md:col-span-1">{etiquetaTipo(e.tipo)}</span>
      <Celda etiqueta="Clasificaciones con puesto">
        <span className="cifra text-4xl leading-none">{e.clasificaciones}</span>
      </Celda>
      <Celda etiqueta="Mejor puesto">
        {e.mejorPuesto !== null ? <span className="cifra text-4xl leading-none">{e.mejorPuesto}</span> : sinDato}
      </Celda>
      <Celda etiqueta="Podios">
        <span className="cifra text-4xl leading-none">{e.podios}</span>
      </Celda>
      <Celda etiqueta="Victorias">
        <span className="cifra text-4xl leading-none">{e.victorias}</span>
      </Celda>
      <Celda etiqueta="Sin puesto numérico">
        <Dato>{e.sinPuestoNumerico}</Dato>
      </Celda>
    </li>
  );
}

export function EstadisticasFicha({ ficha, nivel }: { ficha: FichaDeportiva; nivel: Nivel }) {
  if (ficha.estadisticas.detalle) {
    return (
      <Bloque id="ficha-estadisticas" titulo="Desglose por torneo, categoría y arma" nivel={nivel}>
        <EstadisticasDeportistaVista detalle={ficha.estadisticas.detalle} />
      </Bloque>
    );
  }
  const { porTipo } = ficha.estadisticas;
  const { pruebasConResultado, ediciones } = ficha.cobertura;
  return (
    <Bloque id="ficha-estadisticas" titulo="Estadísticas por tipo de torneo" nivel={nivel}>
      {porTipo.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No hay clasificaciones individuales importadas. Puede que falte importar esa información;
          no equivale a cero participaciones ni a derrotas.
        </p>
      ) : (
        <>
          <ul className="divide-y border-y bg-card" aria-label="Estadísticas por tipo de torneo">
            {porTipo.map((e) => (
              <FilaEstadistica key={e.tipo ?? 'sin-tipo'} e={e} />
            ))}
          </ul>
          <Nota>
            Conjunto cubierto: {pruebasConResultado} {pruebasConResultado === 1 ? 'prueba' : 'pruebas'} con
            resultado importado, de {ediciones} {ediciones === 1 ? 'edición' : 'ediciones'}.
          </Nota>
        </>
      )}
      <Aclaracion titulo="Cómo se cuentan las estadísticas">
        <Nota>
          Cuentan sólo clasificaciones individuales con resultado publicado, una por prueba. Una
          inscripción sin final no cuenta como participación. El tipo sale del calendario cuando lo
          documenta; si no, la prueba va a «Sin tipo documentado» y nunca se deduce del título.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}

/* ------------------------------------------------------------- ranking oficial */

function FilaRanking({ e }: { e: EntradaRankingOficial }) {
  const categoria = CATEGORY_LABEL[e.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? e.categoria.codigo;
  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] md:items-center">
      <span className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
        <span className="font-medium break-words">
          {WEAPON_LABEL[e.arma]} {GENDER_LABEL[e.genero].toLowerCase()}, {categoria}
        </span>
        <span className="text-xs text-muted-foreground break-words">
          {fuenteRanking(e.fuente)}, {etiquetaTemporada(e.temporada)}
          {e.categoria.raw ? `, publicada como «${e.categoria.raw}»` : ''}
        </span>
      </span>
      <Celda etiqueta="Puesto en la lista">
        {e.puesto !== null ? (
          <span className="flex items-baseline gap-1.5">
            <span className="cifra text-4xl leading-none">{e.puesto}</span>
            {e.totalPublicado !== null ? (
              <span className="text-xs text-muted-foreground">de {e.totalPublicado}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">La fuente no le asigna puesto</span>
        )}
      </Celda>
      <Celda etiqueta="Puntos">
        {e.puntos !== null ? (
          <span className="cifra text-3xl leading-none break-all">{e.puntos}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Puntos no publicados</span>
        )}
      </Celda>
      <Celda etiqueta="Fecha de la lista" className="col-span-2 md:col-span-1">
        {e.fecha.sourcePublishedOn ? (
          <Dato>Publicada el {fechaLegible(e.fecha.sourcePublishedOn)}</Dato>
        ) : (
          <>
            <Dato>Leída el {fechaLegible(e.fecha.observedOn)}</Dato>
            <Aclaracion titulo="Fecha de lectura, no de publicación">
              <Nota>
                La fuente no publica la fecha de la lista. «Leída el» es el día en que se obtuvo, no la
                situación a final de temporada.
              </Nota>
            </Aclaracion>
          </>
        )}
        <EnlaceFuente url={e.enlace} etiqueta="Ver la lista en la fuente" />
      </Celda>
    </li>
  );
}

export function RankingOficialFicha({
  ficha,
  base,
  criterios,
  nivel,
}: {
  ficha: FichaDeportiva;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
}) {
  const r = ficha.rankingOficial;
  const otro = r.formato === 'INDIVIDUAL' ? 'EQUIPOS' : 'INDIVIDUAL';
  return (
    <Bloque id="ficha-ranking" titulo="Ranking oficial publicado" nivel={nivel}>
      <Aclaracion titulo="Qué representa este ranking">
        <Nota>
          Es la lista que publica cada federación para una temporada y una modalidad. No es el puesto
          de un torneo ni ningún cálculo propio de esta aplicación. Cada puesto pertenece a la lista,
          temporada y fuente que se indican.
        </Nota>
      </Aclaracion>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm">
          Modalidad: <strong>{r.formato === 'INDIVIDUAL' ? 'individual' : 'por equipos'}</strong>
        </p>
        <Button asChild variant="outline" size="sm">
          <Link
            href={construirUrlFicha(
              base,
              { ranking: criterios.ranking, formato: otro, volver: criterios.volver },
              'ficha-ranking',
            )}
            prefetch={false}
            scroll={false}
          >
            Ver {otro === 'EQUIPOS' ? 'equipos' : 'individual'}
          </Link>
        </Button>
      </div>

      {r.temporadasDisponibles.length > 0 ? (
        <nav aria-label="Temporadas con ranking oficial" className="flex flex-wrap gap-2">
          {r.temporadasDisponibles.map((t) => {
            const actual = t === r.temporada;
            return (
              <Link
                key={t}
                href={construirUrlFicha(
                  base,
                  { ranking: t, formato: criterios.formato, volver: criterios.volver },
                  'ficha-ranking',
                )}
                prefetch={false}
                scroll={false}
                aria-current={actual ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-3 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  actual && 'border-primary-text bg-marcado font-semibold text-primary-text',
                )}
              >
                {etiquetaTemporada(t)}
                {actual ? <span className="sr-only"> (mostrada)</span> : null}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {r.temporada === null ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No hay ninguna lista oficial importada en la que figure esta persona
          {r.formato === 'EQUIPOS' ? ' como equipo' : ''}. Puede faltar por importar; no significa
          que no esté clasificada.
        </p>
      ) : r.entradas.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          No figura en las listas importadas de {etiquetaTemporada(r.temporada)}. No se le atribuye la
          de otra temporada.
        </p>
      ) : (
        <ul className="divide-y border-y bg-card" aria-label={`Ranking oficial ${etiquetaTemporada(r.temporada)}`}>
          {r.entradas.map((e) => (
            <FilaRanking key={`${e.fuente}-${e.arma}-${e.genero}-${e.categoria.raw}-${e.formato}`} e={e} />
          ))}
        </ul>
      )}
    </Bloque>
  );
}

/* ------------------------------------------------------------------ historial */

function FilaHistorial({ r }: { r: ResultadoHistorial }) {
  const categoria = CATEGORY_LABEL[r.prueba.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? r.prueba.categoria.codigo;
  const fecha = r.fecha ? partesFecha(r.fecha) : null;
  return (
    <li className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-4 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_minmax(0,9rem)] sm:gap-x-5 sm:px-5">
      <div className="flex flex-col items-start leading-none">
        {fecha ? (
          <>
            <span className="cifra text-3xl leading-none">{fecha.dia}</span>
            <span className="text-xs text-muted-foreground">{fecha.mes} {fecha.anio}</span>
          </>
        ) : r.fecha ? (
          <span className="text-xs break-all">{r.fecha}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Fecha no publicada</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <Link
          href={rutaEdicion(r.torneo.id)}
          prefetch={false}
          className="w-fit max-w-full font-medium break-words underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {titular(r.torneo.nombre)}
        </Link>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {r.torneo.pais ? <BanderaPais pais={r.torneo.pais} /> : null}
          <span className="break-words">{r.torneo.ciudad ? titular(r.torneo.ciudad) : 'Sede no publicada'}</span>
        </span>
        <span className="text-xs text-muted-foreground break-words">
          {WEAPON_LABEL[r.prueba.arma]} {GENDER_LABEL[r.prueba.genero].toLowerCase()}, {categoria}
          {r.prueba.categoria.raw ? ` («${r.prueba.categoria.raw}»)` : ''}
          {r.prueba.formato === 'EQUIPOS' ? ', equipos' : ''}
        </span>
        <span className="text-xs text-muted-foreground">
          {r.tipoDocumentado ? etiquetaTipo(r.tipoDocumentado) : 'Tipo de torneo sin documentar'}
          {', '}{etiquetaTemporada(r.temporada)}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        <PuestoFinal puesto={r.puesto} puestoPublicado={r.puestoPublicado} />
        {r.puntosOficiales ? <span className="text-xs text-muted-foreground">{r.puntosOficiales} puntos</span> : null}
      </div>
      <div className="col-span-2 col-start-2 flex min-w-0 flex-col sm:col-span-1 sm:col-start-auto sm:items-end sm:text-right">
        <span className="text-xs text-muted-foreground">{fuenteResultado(r.fuente)}</span>
        <EnlaceFuente url={r.enlace} etiqueta="Abrir en la fuente" />
      </div>
    </li>
  );
}

export function HistorialFicha({
  historial,
  base,
  criterios,
  nivel,
}: {
  historial: HistorialVista;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
}) {
  return (
    <Bloque id="historial" titulo="Resultados" nivel={nivel}>
      <Aclaracion titulo="Resultados publicados, del más reciente al más antiguo">
        <Nota>
          Puestos finales publicados, del más reciente al más antiguo. Una inscripción sin final no
          aparece aquí: no es un resultado ni una participación clasificada.
        </Nota>
      </Aclaracion>
      {historial.tipo === 'ok' ? (
        historial.sinResultados ? (
          <p role="status" className="medida text-sm text-muted-foreground">
            No hay puestos finales importados para esta persona. Puede que las fuentes no los publiquen o
            que falte procesarlos; no significa que no haya competido.
          </p>
        ) : (
          <>
            <ol className="divide-y border-y bg-card" aria-label="Resultados, del más reciente al más antiguo">
              {historial.items.map((r) => (
                <FilaHistorial key={r.id} r={r} />
              ))}
            </ol>
            <nav aria-label="Páginas del historial" className="flex flex-wrap items-center gap-3">
              {criterios.cursor ? (
                <Button asChild variant="outline">
                  <Link
                    href={construirUrlFicha(
                      base,
                      { ranking: criterios.ranking, formato: criterios.formato, volver: criterios.volver },
                      'historial',
                    )}
                    prefetch={false}
                  >
                    Volver a los más recientes
                  </Link>
                </Button>
              ) : null}
              {historial.siguiente ? (
                <Button asChild variant="outline">
                  <Link
                    href={construirUrlFicha(
                      base,
                      {
                        ranking: criterios.ranking,
                        formato: criterios.formato,
                        cursor: historial.siguiente,
                        volver: criterios.volver,
                      },
                      'historial',
                    )}
                    prefetch={false}
                    rel="next"
                  >
                    Ver resultados anteriores
                  </Link>
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">No hay más resultados importados.</p>
              )}
            </nav>
          </>
        )
      ) : (
        <div role="alert" className="flex items-start gap-2 rounded-md border bg-card px-4 py-4 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p className="medida">
            {historial.tipo === 'cursor_invalido'
              ? 'Esta página del historial ya no corresponde a la ficha. Vuelve a los resultados más recientes.'
              : historial.tipo === 'no_disponible'
                ? 'Los datos deportivos todavía no están preparados en esta instalación, así que no se ha podido leer el historial.'
                : 'No se ha podido leer el historial. Ha fallado la consulta; no es que no haya resultados. Inténtalo de nuevo.'}
          </p>
        </div>
      )}
    </Bloque>
  );
}

/* ------------------------------------------------------------------ cobertura */

export function CoberturaFichaVista({ cobertura, nivel }: { cobertura: CoberturaFicha; nivel: Nivel }) {
  return (
    <Bloque id="ficha-cobertura" titulo="Qué cubre esta ficha" nivel={nivel}>
      <p className="text-sm">
        {cobertura.resultadosImportados === 0 ? (
          <>Ningún resultado importado todavía.</>
        ) : (
          <>
            {cobertura.resultadosImportados}{' '}
            {cobertura.resultadosImportados === 1 ? 'resultado importado' : 'resultados importados'} en{' '}
            {cobertura.pruebasConResultado} {cobertura.pruebasConResultado === 1 ? 'prueba' : 'pruebas'} de{' '}
            {cobertura.ediciones} {cobertura.ediciones === 1 ? 'edición' : 'ediciones'}.
          </>
        )}
      </p>
      {cobertura.lecturas.length > 0 ? (
        <ul className="divide-y border-y bg-card" aria-label="Estado de lectura por tipo de dato">
          {cobertura.lecturas.map((l) => {
            const estado = estadoLectura(l.hecho, l.estado);
            return (
              <li
                key={`${l.hecho}-${l.estado}`}
                className="grid gap-x-4 gap-y-1 px-3 py-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,3fr)] md:items-center"
              >
                <span className="font-medium">{etiquetaHecho(l.hecho)}</span>
                <span className="text-sm">
                  {estado.texto}: {l.pruebas} {l.pruebas === 1 ? 'prueba' : 'pruebas'}
                </span>
                <span className="text-xs text-muted-foreground">{estado.ayuda}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Nota>
        «Leído completo» es por fuente y tipo de dato. La aplicación carga el histórico de forma
        progresiva: una ficha nunca garantiza que estén todas las temporadas ni todas las pruebas.
      </Nota>
    </Bloque>
  );
}

/* ------------------------------------------------------------------ cara a cara */

/**
 * Entrada al cara a cara desde cualquier ficha, propia o ajena. La persona va
 * en la ruta; el rival se elige ya en la pantalla del cara a cara.
 */
export function EntradaCaraACara({ ficha, nivel }: { ficha: FichaDeportiva; nivel: Nivel }) {
  return (
    <Bloque id="ficha-cara-a-cara" titulo="Cara a cara" nivel={nivel}>
      <Nota>Consulta los asaltos individuales publicados frente a otro deportista.</Nota>
      <Aclaracion titulo="Qué asaltos se incluyen">
        <Nota>
          Compara a {nombreVisible(ficha.nombre) || ficha.nombre} con otra persona en asaltos individuales ya importados:
          poule y eliminación directa, con el marcador visto desde esta ficha. Los encuentros por
          equipos, los BYE y las finales sin marcador no cuentan.
        </Nota>
      </Aclaracion>
      <div>
        <Button asChild variant="outline">
          <Link href={rutaCaraACara(ficha.id)} prefetch={false}>
            <Swords aria-hidden />
            Elegir un rival
          </Link>
        </Button>
      </div>
    </Bloque>
  );
}

/* ---------------------------------------------------------------- composición */

export function FichaCompleta({
  ficha,
  historial,
  base,
  criterios,
  nivel,
  conTitulo = true,
  acciones,
}: {
  ficha: FichaConPerfil;
  historial: HistorialVista;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
  conTitulo?: boolean;
  acciones?: React.ReactNode;
}) {
  const perfil = ficha.perfil;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex min-w-0 flex-col">
        <CabeceraFicha ficha={ficha} titulo={conTitulo} acciones={acciones} />
        {perfil ? <CifrasPerfil perfil={perfil} /> : null}
      </div>
      {perfil ? <AnioAAnio perfil={perfil} nivel={nivel} /> : null}
      <HistorialFicha historial={historial} base={base} criterios={criterios} nivel={nivel} />
      {perfil ? (
        <ManoAMano personaId={ficha.id} nombre={ficha.nombre} perfil={perfil} nivel={nivel} />
      ) : (
        <EntradaCaraACara ficha={ficha} nivel={nivel} />
      )}
      <EstadisticasFicha ficha={ficha} nivel={nivel} />
      <RankingOficialFicha ficha={ficha} base={base} criterios={criterios} nivel={nivel} />
      <CoberturaFichaVista cobertura={ficha.cobertura} nivel={nivel} />
    </div>
  );
}

/* --------------------------------------------------------------------- retorno */

/**
 * Enlace de vuelta a la búsqueda (o a la página de favoritos) de la que se
 * llegó. `volver` ya viene saneado por `leerCriteriosFicha`; se vuelve a
 * sanear aquí porque este componente se puede usar con cualquier cadena. Sin
 * origen (entrada directa) lleva a `/explorar`. No sustituye al botón Atrás del
 * navegador.
 */
export function VolverAExplorar({ volver }: { volver: string }) {
  const destino = sanitizarRetorno(volver) || RUTA_EXPLORAR;
  const aFavoritos = destino === RUTA_FAVORITOS || destino.startsWith(`${RUTA_FAVORITOS}?`);
  const aEdicion = destino.startsWith(`${RUTA_EDICIONES}/`);
  const aSeries = destino === RUTA_EDICIONES;
  return (
    <nav aria-label="Volver">
      <Link
        href={destino}
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {aFavoritos
          ? 'Volver a Favoritos'
          : aEdicion
            ? 'Volver a la edición'
            : aSeries
              ? 'Volver a las ediciones'
              : 'Volver a Explorar'}
      </Link>
    </nav>
  );
}

/* --------------------------------------------------------------------- estados */

function Aviso({
  titulo,
  children,
  alerta = false,
  incrustado = false,
}: {
  titulo: string;
  children: React.ReactNode;
  alerta?: boolean;
  incrustado?: boolean;
}) {
  return (
    <section
      role={alerta ? 'alert' : 'status'}
      className="flex flex-col items-start gap-2 rounded-md border bg-card px-4 py-5"
    >
      {/* Dentro de /perfil el título de la sección ya es un h2. */}
      {incrustado ? <h3 className="text-lg">{titulo}</h3> : <h2 className="text-xl">{titulo}</h2>}
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

export function EstadoFicha({
  vista,
  incrustado = false,
}: {
  vista: Exclude<VistaFicha, { tipo: 'ok' } | { tipo: 'sin_sesion' }>;
  incrustado?: boolean;
}) {
  const volver = (
    <Button asChild variant="outline">
      <Link href={RUTA_EXPLORAR} prefetch={false}>
        Buscar en Explorar
      </Link>
    </Button>
  );
  switch (vista.tipo) {
    case 'propia_no_confirmada': {
      const e = explicacionSinVinculo(vista.motivo);
      return (
        <Aviso incrustado={incrustado} titulo={e.titulo}>
          <p>{e.texto}</p>
          <p>Mientras tanto puedes buscar tu nombre en Explorar y abrir la ficha que sea tuya.</p>
          {volver}
        </Aviso>
      );
    }
    case 'no_encontrada':
      return (
        <Aviso incrustado={incrustado} titulo="Esta ficha no existe">
          <p>No hay ninguna persona deportiva con ese identificador. Puede que el enlace sea antiguo.</p>
          {volver}
        </Aviso>
      );
    case 'entrada_invalida':
      return (
        <Aviso alerta incrustado={incrustado} titulo="El enlace no es válido">
          <p>Alguno de los valores de la dirección no se entiende, por eso no se ha abierto ninguna ficha.</p>
          {volver}
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta incrustado={incrustado} titulo="Las fichas aún no están activas">
          <p>
            Los datos deportivos todavía no están preparados en esta instalación. No es que la
            persona no tenga resultados.
          </p>
        </Aviso>
      );
    default:
      return (
        <Aviso alerta incrustado={incrustado} titulo="No se ha podido abrir la ficha">
          <p>Ha fallado la consulta; no es que no haya datos. Inténtalo de nuevo; si sigue fallando, avisa a la dirección técnica.</p>
        </Aviso>
      );
  }
}
