import { ArrowLeft, ExternalLink, ShieldCheck, Swords, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { rutaCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { explicacionSinVinculo } from '@/lib/sport/explorar/etiquetas';
import { EXTRAS_VACIOS, type DatosPersonales, type ExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/edicion-url';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import { porcentajeVictorias } from '@/lib/sport/explorar/perfil-modelo';
import { CLASES_MEDALLA, CONTORNO_MEDALLA, categoriaVisible, type Medalla } from '@/lib/sport/explorar/presentacion';
import { enlacePruebaPerfil, nombreListaPerfil, type FilaListaPerfil } from '@/lib/sport/explorar/resultados-perfil';
import { tipoPorNombre } from '@/lib/sport/explorar/tipo-competicion';
import type { FichaConPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bloque, Nota, enlaceSeguro, type Nivel } from './piezas';
import { AvatarAnillo } from './avatar-anillo';
import { clasificarResultado } from './etiqueta-competicion';
import { AmbitoPerfil } from './perfil/ambito-perfil';
import { CategoriasPerfil } from './perfil/categorias-perfil';
import { BalanceFasesRivales, CuriosidadesPerfil } from './perfil/curiosidades-perfil';
import { EstadisticasDeportistaVista } from './estadisticas-deportista';
import { FotoDeportista } from './foto-deportista';
import { CifrasPerfil } from './perfil/cifras-perfil';
import { destacadosPerfil, rotuloRanking } from './perfil/destacados-perfil';
import { SeccionRendimiento } from './graficos/seccion-rendimiento';
import { CompararPerfil } from './perfil/comparar-perfil';
import { FilaResultado } from './perfil/fila-resultado';
import { PuntoMedalla } from './perfil/medallas';
import { ResultadosPerfilVista } from './perfil/resultados-perfil';
import { ManoAMano } from './perfil/rivales-perfil';
import { SugeridosPerfil } from './perfil/sugeridos-perfil';
import { AnioAAnio } from './perfil/temporadas-perfil';
import {
  construirUrlFicha,
  RUTA_EXPLORAR,
  sanitizarRetorno,
  type CriteriosFicha,
} from '@/lib/sport/explorar/ficha-url';
import type { HistorialVista, VistaFicha } from '@/lib/sport/explorar/ficha-pantalla';
import type { FichaDeportiva, ResultadoHistorial } from '@/lib/sport/explorar/tipos';
import { etiquetaTemporada } from '@/lib/sport/explorar/url';
import { WEAPON_LABEL, cn, titular } from '@/lib/utils';

/**
 * Ficha deportiva de una persona indexada.
 *
 * Sólo lleva lo que trae `FichaDeportiva`: hechos deportivos publicados. No hay
 * ninguna lectura de cuenta, correo, tutor, consentimiento ni licencia, y lo
 * que la fuente no publica no se pinta: nunca se rellena con un cero.
 */

/* ------------------------------------------------------------------ cabecera */

function Contador({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <dd className="cifra text-[1.75rem] leading-none whitespace-nowrap sm:text-4xl">{valor.toLocaleString('es-ES')}</dd>
      <dt className="max-w-full truncate text-[0.625rem] leading-none tracking-tight text-muted-foreground sm:text-xs sm:tracking-normal">{etiqueta}</dt>
    </div>
  );
}

const MEDALLAS: { m: Medalla; uno: string; varios: string }[] = [
  { m: 'oro', uno: 'Oro', varios: 'Oros' },
  { m: 'plata', uno: 'Plata', varios: 'Platas' },
  { m: 'bronce', uno: 'Bronce', varios: 'Bronces' },
];

type Ficha = { clave: string; cifra: string; rotulo: string; detalle?: string; resaltado?: boolean };

const BALDOSA = 'flex min-w-0 flex-col justify-center gap-1 rounded-xl border px-2.5 py-2 max-[359px]:px-2';

/**
 * Medallas con el color de su metal y, en la misma rejilla, los hitos
 * (ranking, títulos, mejor temporada). Envuelve en filas de tres en móvil:
 * nada se desplaza en horizontal.
 */
export function MedallasCabecera({
  oros,
  platas,
  bronces,
  hitos = [],
}: {
  oros: number;
  platas: number;
  bronces: number;
  hitos?: readonly Ficha[];
}) {
  const n: Record<Medalla, number> = { oro: oros, plata: platas, bronce: bronces };
  return (
    <dl className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-6 sm:gap-2" aria-label="Medallas y hitos">
      {MEDALLAS.map(({ m, uno, varios }) => (
        <div
          key={m}
          data-medalla={m}
          className={cn(BALDOSA, n[m] > 0 ? CLASES_MEDALLA[m] : 'border-filete-alto text-muted-foreground')}
        >
          <dd className="flex items-center gap-1.5">
            <PuntoMedalla medalla={m} className={cn('size-2.5', n[m] === 0 && 'opacity-40')} />
            <span className="cifra text-2xl leading-none">{n[m]}</span>
          </dd>
          <dt className="truncate text-[0.6875rem] leading-none font-medium">{n[m] === 1 ? uno : varios}</dt>
        </div>
      ))}
      {hitos.map((h) => (
        <div key={h.clave} data-hito={h.clave} className={cn(BALDOSA, 'bg-background/40', h.resaltado ? CONTORNO_MEDALLA.oro : 'border-filete-alto')}>
          <dd className="cifra truncate text-2xl leading-none" title={h.detalle}>{h.cifra}</dd>
          <dt className="line-clamp-2 text-[0.6875rem] leading-tight font-medium break-words hyphens-auto text-muted-foreground max-[359px]:line-clamp-3 max-[359px]:text-[0.625rem] max-[359px]:wrap-anywhere" title={h.detalle ? `${h.rotulo} · ${h.detalle}` : h.rotulo}>
            {h.rotulo}
          </dt>
        </div>
      ))}
    </dl>
  );
}

function Pastilla({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <li
      title={title}
      className={cn('inline-flex h-6 max-w-full min-w-0 items-center rounded-full border border-filete-alto px-2.5 text-xs whitespace-nowrap', className)}
    >
      <span className="truncate">{children}</span>
    </li>
  );
}

/** Edad por año de nacimiento, sin fecha exacta: la que se cumple este año. */
function edadDe(anio: number | null): number | null {
  if (anio === null) return null;
  const edad = new Date().getFullYear() - anio;
  return edad > 0 && edad < 120 ? edad : null;
}

const MANO = { L: 'Zurdo', R: 'Diestro' } as const;

/** Acciones compactas: pastillas de 36 px de alto; el área táctil la da el hueco entre ellas. */
const ACCION = 'h-9 min-h-9 rounded-full px-3 text-sm';

/**
 * Cabecera tipo perfil social: retrato con anillo, nombre completo, bandera,
 * armas y datos sueltos en pastillas (edad, mano, altura, club; lo que no hay
 * no sale). Debajo, cuatro cifras grandes, medallas e hitos en rejilla y las
 * acciones en una sola fila. Un posible menor no lleva retrato ni enlace a
 * la FIE.
 */
export function CabeceraFicha({
  ficha,
  titulo = true,
  acciones,
  datos = null,
}: {
  ficha: FichaConPerfil;
  titulo?: boolean;
  /** Controles propios de la cuenta que mira, como guardar en favoritos. */
  acciones?: React.ReactNode;
  datos?: DatosPersonales | null;
}) {
  const nombre = datos?.nombreCompleto || nombreVisible(ficha.nombre) || ficha.nombre;
  const perfil = ficha.perfil;
  const enlaceFie = ficha.esMenor ? null : enlaceSeguro(perfil?.enlaceFie ?? null);
  // La lectura por prueba ya funde las copias de dos fuentes: cuenta igual que la lista.
  const total = perfil?.ambito?.total;
  const competiciones = total ? total.competiciones : perfil?.resumen.pruebas ?? null;
  const medallas = total ?? perfil?.resumen;
  const rivales = perfil?.rivalesStats?.rivalesDistintos ?? perfil?.asaltos?.rivales ?? null;
  const asaltos = perfil?.asaltos && perfil.asaltos.total.asaltos > 0 ? perfil.asaltos.total.asaltos : null;
  const cifras = [
    competiciones ? { etiqueta: competiciones === 1 ? 'Prueba' : 'Pruebas', valor: competiciones } : null,
    asaltos !== null ? { etiqueta: 'Asaltos', valor: asaltos } : null,
    rivales ? { etiqueta: 'Rivales', valor: rivales } : null,
    medallas && competiciones ? { etiqueta: 'Medallas', valor: medallas.oros + medallas.platas + medallas.bronces } : null,
  ].filter((c) => c !== null);

  const pct = porcentajeVictorias(perfil?.asaltos?.total);
  const hitos: Ficha[] = perfil
    ? [
        ...(pct !== null ? [{ clave: 'ganados', cifra: `${pct}%`, rotulo: 'Ganados' }] : []),
        ...destacadosPerfil(perfil, ficha.estadisticas.porTipo),
      ].slice(0, 3)
    : [];

  const edad = datos?.edad ?? edadDe(ficha.anioNacimiento);
  const mujer = ficha.genero === 'F';
  const club = datos?.club?.nombre
    ? { texto: titular(datos.club.nombre), codigo: false }
    : perfil?.club
      ? { texto: titular(perfil.club.nombre), codigo: false }
      : datos?.club?.codigo
        ? { texto: datos.club.codigo, codigo: true }
        : null;

  return (
    <header className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-card px-4 pt-5 pb-4 max-[359px]:px-3 sm:gap-5 sm:px-6 sm:pt-6">
      <div className="flex min-w-0 items-center gap-4 sm:gap-6">
        {ficha.esMenor ? (
          <AvatarAnillo nombre={nombre} tamano="lg" apagado />
        ) : (
          // El sello «Foto FIE» del retrato es el único span hijo directo: aquí no se enseña.
          <FotoDeportista personaId={ficha.id} nombre={nombre} tamano="heroe" decorativa className="[&>span]:hidden" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {titulo ? (
            <h1 className="min-w-0 text-[1.75rem] leading-[0.95] break-words sm:text-5xl">{nombre}</h1>
          ) : (
            <p className="min-w-0 font-display text-[1.75rem] leading-[0.95] break-words sm:text-5xl">{nombre}</p>
          )}
          <ul className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Datos">
            {ficha.pais ? (
              <li className="inline-flex shrink-0">
                <BanderaPais pais={ficha.pais} tamaño="ficha" />
              </li>
            ) : null}
            {perfil?.armas.map((arma) => (
              <Pastilla key={arma} className="font-medium text-foreground">{WEAPON_LABEL[arma]}</Pastilla>
            ))}
            {edad !== null ? <Pastilla className="text-muted-foreground">{edad} años</Pastilla> : null}
            {datos?.mano ? (
              <Pastilla className="text-muted-foreground">
                {datos.mano === 'L' ? (mujer ? 'Zurda' : MANO.L) : mujer ? 'Diestra' : MANO.R}
              </Pastilla>
            ) : null}
            {datos?.alturaCm ? <Pastilla className="text-muted-foreground">{datos.alturaCm} cm</Pastilla> : null}
            {club ? (
              <Pastilla
                title={club.texto}
                className={cn('text-muted-foreground', club.codigo && 'font-mono text-[0.6875rem] tracking-wide uppercase')}
              >
                {club.texto}
              </Pastilla>
            ) : null}
            {ficha.esMenor ? (
              <Pastilla className="gap-1 text-muted-foreground">
                <ShieldCheck className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                Posible menor de edad
              </Pastilla>
            ) : null}
            {ficha.esPropia ? <Pastilla className="border-primary-text/50 text-primary-text">Tu ficha</Pastilla> : null}
          </ul>
        </div>
      </div>

      {cifras.length > 0 ? (
        <dl
          className="grid min-w-0 auto-cols-fr grid-flow-col gap-2 border-y py-3 sm:justify-start sm:gap-10 sm:border-0 sm:py-0"
          aria-label="En cifras"
        >
          {cifras.map((c) => <Contador key={c.etiqueta} etiqueta={c.etiqueta} valor={c.valor} />)}
        </dl>
      ) : null}

      {medallas && competiciones ? <MedallasCabecera oros={medallas.oros} platas={medallas.platas} bronces={medallas.bronces} hitos={hitos} /> : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="sm" className={ACCION}>
          <Link href={rutaCaraACara(ficha.id)} prefetch={false}>
            <Swords aria-hidden />
            Cara a cara
          </Link>
        </Button>
        {acciones ? (
          // El control de Seguir trae su propio alto de 44 px: aquí se iguala a las otras pastillas.
          <div className="min-w-0 [&_button]:rounded-full [&_button>span:first-child]:h-9 [&_button>span:first-child]:rounded-full [&_button>span:first-child]:px-3.5">

            {acciones}
          </div>
        ) : null}
        {enlaceFie ? (
          <Button asChild variant="outline" size="sm" className={ACCION}>
            <a href={enlaceFie} target="_blank" rel="noopener noreferrer" title="Perfil en la FIE">
              FIE
              <ExternalLink aria-hidden />
            </a>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------- ranking oficial */

/** Puestos del ranking oficial de la temporada más reciente, si figura en alguno. */
export function RankingCompacto({ ficha, nivel }: { ficha: FichaDeportiva; nivel: Nivel }) {
  const entradas = ficha.rankingOficial.entradas.filter((e) => e.puesto !== null);
  if (entradas.length === 0) return null;
  return (
    <Bloque id="ficha-ranking" titulo="Ranking" nivel={nivel}>
      <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
        {entradas.map((e) => (
          <li
            key={`${e.fuente}-${e.arma}-${e.genero}-${e.categoria.codigo}-${e.categoria.raw}-${e.formato}`}
            className="flex min-w-0 items-center gap-3 rounded-xl border bg-card px-4 py-3"
          >
            <span className="cifra text-3xl leading-none">{e.puesto}º</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {rotuloRanking(e.fuente)} · {WEAPON_LABEL[e.arma]} {categoriaVisible(e.categoria.codigo).toLowerCase()}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {etiquetaTemporada(e.temporada)}
                {e.totalPublicado !== null ? ` · de ${e.totalPublicado}` : ''}
                {e.puntos !== null ? ` · ${e.puntos} puntos` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Bloque>
  );
}

/* ------------------------------------------------------------------ historial */

function aFila(r: ResultadoHistorial, personaId: string): FilaListaPerfil {
  const c = clasificarResultado(r);
  const nombre = nombreListaPerfil(r.torneo.nombre, r.prueba.formato, r.fuente);
  return {
    id: r.id,
    href: enlacePruebaPerfil(r.torneo.id, r.prueba.id, personaId),
    fuenteUrl: enlaceSeguro(r.enlace),
    fuente: r.fuente,
    nombre,
    tipoEnNombre: tipoPorNombre(nombre) === c.tipo,
    fecha: r.fecha,
    temporada: r.temporada,
    temporadaEtiqueta: etiquetaTemporada(r.temporada),
    clasificacion: { tipo: c.tipo, etiqueta: c.etiqueta, corta: c.corta, tono: c.tono, ambito: c.ambito, orden: c.orden },
    categoria: r.prueba.categoria.codigo,
    arma: r.prueba.arma,
    genero: r.prueba.genero,
    pais: r.torneo.pais,
    ciudad: r.torneo.ciudad,
    puesto: r.puesto,
    puestoPublicado: r.puestoPublicado,
    asaltos: null,
  };
}

/**
 * Historial paginado de la ficha, para cuando no hay lectura por prueba (sólo
 * equipos, o esa lectura falló). Las filas son las mismas que en el perfil.
 */
export function HistorialFicha({
  historial,
  base,
  criterios,
  nivel,
  enPestana = false,
  personaId,
}: {
  historial: HistorialVista;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
  enPestana?: boolean;
  /** Persona a resaltar en la prueba; sin ella se toma la del primer segmento de `base`. */
  personaId?: string;
}) {
  const persona = personaId ?? base.split('/').filter(Boolean).at(-1) ?? '';
  return (
    <Bloque id="historial" titulo="Resultados" nivel={nivel} tituloOculto={enPestana}>
      {historial.tipo === 'ok' ? (
        historial.sinResultados ? (
          <p role="status" className="medida text-sm text-muted-foreground">
            No hay puestos finales importados para esta persona.
          </p>
        ) : (
          <>
            <ol
              className="grid min-w-0 gap-px overflow-hidden rounded-xl border bg-border"
              aria-label="Resultados, del más reciente al más antiguo"
            >
              {historial.items.map((r) => (
                <FilaResultado key={r.id} r={aFila(r, persona)} />
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
              ) : null}
            </nav>
          </>
        )
      ) : (
        <div role="alert" className="flex items-start gap-2 rounded-xl border bg-card px-4 py-4 text-sm">
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

/* ------------------------------------------------------------------ cara a cara */

/**
 * Entrada al cara a cara desde cualquier ficha, propia o ajena. La persona va
 * en la ruta; el rival se elige ya en la pantalla del cara a cara.
 */
export function EntradaCaraACara({ ficha, nivel }: { ficha: FichaDeportiva; nivel: Nivel }) {
  return (
    <Bloque id="ficha-cara-a-cara" titulo="Cara a cara" nivel={nivel}>
      <Nota>
        Compara a {nombreVisible(ficha.nombre) || ficha.nombre} con otro deportista en sus asaltos individuales.
      </Nota>
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
  extras = EXTRAS_VACIOS,
}: {
  ficha: FichaConPerfil;
  historial: HistorialVista;
  base: string;
  criterios: CriteriosFicha;
  nivel: Nivel;
  conTitulo?: boolean;
  acciones?: React.ReactNode;
  /** Datos personales y rendimiento; cada uno se omite si no se pudo leer. */
  extras?: ExtrasPerfil;
}) {
  const perfil = ficha.perfil;
  const rendimiento = extras.rendimiento && extras.rendimiento.vistas.todo.total.competiciones > 0 ? extras.rendimiento : null;
  const conRivales = perfil?.rivalesStats && perfil.rivalesStats.total.asaltos > 0 ? perfil.rivalesStats : null;
  // Las tres pestañas se pintan siempre en el HTML (forceMount) y la inactiva
  // sólo se oculta: los anclajes #historial y la lectura sin JS siguen funcionando.
  const panel = 'flex min-w-0 flex-col gap-8 pt-5 data-[state=inactive]:hidden';
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <CabeceraFicha ficha={ficha} titulo={conTitulo} acciones={acciones} datos={extras.datos} />
      <Tabs defaultValue="resultados" className="min-w-0 gap-0">
        <TabsList variant="line" aria-label="Secciones de la ficha" className="w-full justify-start gap-0 border-b p-0">
          <TabsTrigger value="resultados" className="flex-1 px-2 sm:flex-none sm:px-4">Resultados</TabsTrigger>
          <TabsTrigger value="estadisticas" className="flex-1 px-2 sm:flex-none sm:px-4">Rendimiento</TabsTrigger>
          <TabsTrigger value="rivales" className="flex-1 px-2 sm:flex-none sm:px-4">Rivales</TabsTrigger>
        </TabsList>
        <TabsContent value="resultados" forceMount className={panel}>
          {/* Sin pruebas individuales (sólo equipos, o la lectura falló) queda el historial paginado de siempre. */}
          {perfil?.resultados && perfil.resultados.items.length > 0 ? (
            <ResultadosPerfilVista personaId={ficha.id} resultados={perfil.resultados} base={base} criterios={criterios} nivel={nivel} />
          ) : (
            <HistorialFicha historial={historial} base={base} criterios={criterios} nivel={nivel} enPestana personaId={ficha.id} />
          )}
        </TabsContent>
        <TabsContent value="estadisticas" forceMount className={panel}>
          {rendimiento ? (
            <>
              <RankingCompacto ficha={ficha} nivel={nivel} />
              {/* Cifras, evolución, temporadas, tipo y categoría con Todo / Internacional / Nacional. */}
              <SeccionRendimiento datos={rendimiento} nivel={nivel} tituloOculto />
            </>
          ) : perfil ? (
            <>
              <CifrasPerfil perfil={perfil} />
              {perfil.ambito ? <AmbitoPerfil ambito={perfil.ambito} nivel={nivel} /> : null}
              {perfil.ambito ? (
                <CategoriasPerfil categorias={perfil.ambito.porCategoria} nivel={nivel} />
              ) : ficha.estadisticas.detalle ? (
                <EstadisticasDeportistaVista detalle={ficha.estadisticas.detalle} nivel={nivel} />
              ) : null}
              <RankingCompacto ficha={ficha} nivel={nivel} />
              <AnioAAnio perfil={perfil} nivel={nivel} />
            </>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">No se han podido cargar.</p>
          )}
        </TabsContent>
        <TabsContent value="rivales" forceMount className={panel}>
          {perfil ? (
            <>
              <CompararPerfil
                personaId={ficha.id}
                nombre={ficha.nombre}
                rapidos={(perfil.rivales ?? []).slice(0, 5).map(({ id, nombre, pais, asaltos, victorias, derrotas }) => ({
                  id, nombre, pais, asaltos, victorias, derrotas,
                }))}
                encabezado={nivel === 'pagina' ? 'h2' : 'h3'}
              />
              {conRivales ? (
                <>
                  <BalanceFasesRivales stats={conRivales} nivel={nivel} />
                  <CuriosidadesPerfil personaId={ficha.id} stats={conRivales} nivel={nivel} />
                </>
              ) : null}
              {/* Con curiosidades encima, la lista necesita su propio título visible. */}
              <ManoAMano personaId={ficha.id} nombre={ficha.nombre} perfil={perfil} nivel={nivel} enPestana={!conRivales} />
            </>
          ) : (
            <EntradaCaraACara ficha={ficha} nivel={nivel} />
          )}
        </TabsContent>
      </Tabs>
      {perfil ? <SugeridosPerfil personaId={ficha.id} sugeridos={perfil.sugeridos} nivel={nivel} /> : null}
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
