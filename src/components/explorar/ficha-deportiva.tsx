import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Boton } from '@/components/sistema/boton';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { MarcaPropia, Pastilla, PastillaRanking } from '@/components/sistema/pastilla';
import { CaraACaraHoja } from './perfil/elegir-rival-hoja';
import { chipsRanking, type ChipRanking } from '@/lib/sport/explorar/chips-ranking';
import type { DiferidosPerfil } from '@/lib/sport/explorar/perfil-diferido';
import type { RivalesPorAmbito } from '@/lib/sport/explorar/rivales-ambito';
import type { ResumenAmbito } from '@/lib/sport/explorar/tipos-social';
import { medallaMasValiosa, type MedallaPerfil } from '@/lib/sport/explorar/medallas-perfil';
import { RivalesPorAmbitoVista } from './perfil/rivales-ambito';
import { RelevosPerfilDiferido } from './relevos';
import { TarjetaGiratoria, type CaraTarjeta } from './perfil/tarjeta-giratoria';
import { InsigniaOlimpica } from '@/components/olimpica/insignia-olimpica';
import { Button } from '@/components/ui/button';
import { explicacionSinVinculo } from '@/lib/sport/explorar/etiquetas';
import { EXTRAS_VACIOS, type DatosPersonales, type ExtrasPerfil } from '@/lib/sport/explorar/perfil-extra';
import { RUTA_EDICIONES } from '@/lib/sport/explorar/edicion-url';
import { RUTA_FAVORITOS } from '@/lib/sport/explorar/favoritos-url';
import { porcentajeVictorias, temporadaDeportiva } from '@/lib/sport/explorar/perfil-modelo';
import { temporadaCorta as temporadaCortaRanking } from '@/lib/ranking/url-nacional';
import { CLASES_MEDALLA, CONTORNO_MEDALLA, categoriaVisible, ordenCategoriaVisible, type Medalla } from '@/lib/sport/explorar/presentacion';
import { enlacePruebaPerfil, nombreListaPerfil, type FilaListaPerfil } from '@/lib/sport/explorar/resultados-perfil';
import { tipoPorNombre } from '@/lib/sport/explorar/tipo-competicion';
import type { FichaConPerfil } from '@/lib/sport/explorar/tipos-perfil';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { Paneles } from './perfil/paneles';
import { Bloque, EnlacePais, enlaceSeguro, type Nivel } from './piezas';
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
import { RankingMundialPerfil, RankingNacionalPerfil } from './perfil/ranking-perfil';
import { EuropeoDiferido, RankingAmbitoPerfil, SeccionRanking } from './perfil/ranking-ambito';
import { bloquesRankingPerfil, type BloquesRankingPerfil } from '@/lib/sport/explorar/ranking-ambitos';
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
import { WEAPON_LABEL, cn } from '@/lib/utils';

/**
 * Ficha deportiva de una persona indexada.
 *
 * Sólo lleva lo que trae `FichaDeportiva`: hechos deportivos publicados. No hay
 * ninguna lectura de cuenta, correo, tutor, consentimiento ni licencia, y lo
 * que la fuente no publica no se pinta: nunca se rellena con un cero.
 */

/* ------------------------------------------------------------------ cabecera */

function Contador({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  // El `dt` va antes que el `dd` (orden de lectura); `flex-col-reverse` pone la cifra arriba a la vista.
  return (
    <div className="flex min-w-0 flex-col-reverse items-center gap-1">
      <dt className="max-w-full truncate text-xs leading-none text-muted-foreground">{etiqueta}</dt>
      <dd className="cifra text-3xl leading-none whitespace-nowrap sm:text-4xl">{valor.toLocaleString('es-ES')}</dd>
    </div>
  );
}

const MEDALLAS: { m: Medalla; uno: string; varios: string }[] = [
  { m: 'oro', uno: 'Oro', varios: 'Oros' },
  { m: 'plata', uno: 'Plata', varios: 'Platas' },
  { m: 'bronce', uno: 'Bronce', varios: 'Bronces' },
];

type Ficha = { clave: string; cifra: string; rotulo: string; detalle?: string; resaltado?: boolean };

const BALDOSA = 'flex min-w-0 flex-col-reverse justify-center gap-1 rounded-xl border px-3 py-2 max-[359px]:px-2';

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
    <dl className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Medallas y hitos">
      {MEDALLAS.map(({ m, uno, varios }) => (
        <div
          key={m}
          data-medalla={m}
          className={cn(BALDOSA, n[m] > 0 ? CLASES_MEDALLA[m] : 'border-filete-alto text-muted-foreground')}
        >
          <dt className="truncate text-xs leading-none font-medium">{n[m] === 1 ? uno : varios}</dt>
          <dd className="flex items-center gap-2">
            <PuntoMedalla medalla={m} className={cn('size-2.5', n[m] === 0 && 'opacity-40')} />
            <span className="cifra text-2xl leading-none">{n[m]}</span>
          </dd>
        </div>
      ))}
      {hitos.map((h) => (
        <div key={h.clave} data-hito={h.clave} className={cn(BALDOSA, 'bg-card', h.resaltado ? CONTORNO_MEDALLA.oro : 'border-filete-alto')}>
          <dt className="line-clamp-2 text-xs leading-tight font-medium text-muted-foreground" title={h.detalle ? `${h.rotulo} · ${h.detalle}` : h.rotulo}>
            {h.rotulo}
          </dt>
          <dd className="cifra truncate text-2xl leading-none" title={h.detalle}>{h.cifra}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Un dato suelto de la cabecera (arma, edad, mano, altura) en la pastilla del sistema. */
function Dato({ children }: { children: React.ReactNode }) {
  return (
    <li className="inline-flex min-w-0 max-w-full">
      <Pastilla tamano="md" className="font-normal text-muted-foreground">{children}</Pastilla>
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

/** «2021» (FIE) y «2020-2021» se leen igual: «20-21». */
const temporadaCorta = (t: string) => temporadaCortaRanking(temporadaDeportiva(t));

/** Sigla de la pastilla: la del organismo publicado o, sin él, la del ámbito. */
function fuenteChip(c: ChipRanking): string {
  return c.organismo || (c.ambito === 'nacional' ? 'RFEE' : 'FIE');
}

/**
 * Lo que la pastilla no dice: la categoría si no es Absoluto y, en un mejor
 * puesto histórico, «Mejor» y la temporada. El arma ya va en los datos de la
 * cabecera. `detalle` es la frase entera para el `title`.
 */
function textoChip(c: ChipRanking): { extra: string; detalle: string } {
  const ambito = c.ambito === 'nacional' ? 'nacional' : 'internacional';
  const modalidad = `${WEAPON_LABEL[c.arma]} ${categoriaVisible(c.categoria).toLowerCase()}`;
  // «Absoluto» se sobreentiende: sólo se escribe otra categoría.
  const cat = ordenCategoriaVisible(c.categoria) === 0 ? '' : categoriaVisible(c.categoria);
  const organismo = c.organismo ? ` · ${c.organismo}` : '';
  return c.actual
    ? { extra: cat, detalle: `Ranking ${ambito} ${temporadaCorta(c.temporada)}${organismo}: ${modalidad}` }
    : {
        extra: [`Mejor ${temporadaCorta(c.temporada)}`, cat].filter(Boolean).join(' · '),
        detalle: `Mejor puesto en el ranking ${ambito}${organismo}: ${modalidad}, ${temporadaCorta(c.temporada)}`,
      };
}

/**
 * Ranking de la cabecera: una `PastillaRanking` por ámbito («FIE #25»,
 * «RFEE #3»), sin rótulos que repitan lo que dice la sigla. Lo que añade
 * (categoría, «Mejor 20-21») va detrás en pequeño y la frase entera en
 * `title`. Las pastillas saltan de línea, nunca se desplazan.
 */
export function FilasRanking({ chips }: { chips: readonly ChipRanking[] }) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Ranking" className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map((c) => {
        const { extra, detalle } = textoChip(c);
        return (
          <li key={c.ambito} data-fila-ranking={c.ambito} title={detalle} className="flex min-w-0 max-w-full items-center gap-1">
            <span data-chip-ranking={c.ambito} className="inline-flex">
              <PastillaRanking fuente={fuenteChip(c)} puesto={c.puesto} tamano="md" />
            </span>
            {extra ? <span className="min-w-0 truncate text-xs text-muted-foreground">{extra}</span> : null}
            {c.olimpica ? <InsigniaOlimpica anotacion={c.olimpica} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Cifras grandes de una cara de la tarjeta, en una fila que reparte el ancho. */
function FilaCifras({ cifras }: { cifras: readonly { etiqueta: string; valor: number }[] }) {
  return (
    <dl
      className="grid min-w-0 auto-cols-fr grid-flow-col gap-2 border-y py-3 sm:justify-start sm:gap-10 sm:border-0 sm:py-0"
      aria-label="En cifras"
    >
      {cifras.map((c) => <Contador key={c.etiqueta} etiqueta={c.etiqueta} valor={c.valor} />)}
    </dl>
  );
}

const NOMBRE_METAL: Record<Medalla, string> = { oro: 'Oro', plata: 'Plata', bronce: 'Bronce' };

/** La medalla más valiosa de la cara (ver `compararMedallas`), en una línea. */
function MedallaDestacada({ m }: { m: MedallaPerfil | null }) {
  if (!m) return null;
  const partes = [
    m.etiquetaTipo,
    ordenCategoriaVisible(m.categoria) === 0 ? null : categoriaVisible(m.categoria),
    m.formato === 'EQUIPOS' ? 'equipos' : null,
  ].filter(Boolean);
  return (
    // Puede ir en dos líneas: nunca se recorta.
    <p data-medalla-destacada={m.medalla} className="flex min-w-0 items-baseline gap-2 text-xs leading-snug" title={m.torneo}>
      <PuntoMedalla medalla={m.medalla} className="size-2.5 shrink-0 self-center" />
      <span className="shrink-0 font-semibold">{NOMBRE_METAL[m.medalla]}</span>
      <span className="min-w-0 text-muted-foreground">
        {partes.map((p) => `${p} · `).join('')}
        <span className="whitespace-nowrap">{temporadaCorta(m.temporada)}</span>
      </span>
    </p>
  );
}

/** Reparto de las medallas entre internacional y nacional, en una barra fina. */
function BarraAmbitos({ internacional, nacional }: { internacional: number; nacional: number }) {
  // Con un lado a cero la barra sólo repetiría el total.
  if (internacional === 0 || nacional === 0) return null;
  const total = internacional + nacional;
  const pct = Math.round((internacional / total) * 100);
  return (
    <div data-barra-ambitos className="flex min-w-0 flex-col gap-1">
      <div className="flex h-1.5 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="h-full bg-primary-text" style={{ width: `${pct}%` }} />
        <span className="h-full flex-1 bg-org-rfee-relleno" />
      </div>
      <p className="flex justify-between gap-2 text-xs leading-none text-muted-foreground">
        <span>Internacional <span className="cifra text-foreground">{internacional}</span></span>
        <span>Nacional <span className="cifra text-foreground">{nacional}</span></span>
      </p>
    </div>
  );
}

/** Cara Internacional o Nacional: mismas piezas que la general, con lo de ese ámbito. */
function CaraAmbito({ r, destacada }: { r: ResumenAmbito; destacada: MedallaPerfil | null }) {
  const pct = r.porcentajeVictorias === null ? null : Math.round(r.porcentajeVictorias * 100);
  const cifras = [
    { etiqueta: r.competiciones === 1 ? 'Prueba' : 'Pruebas', valor: r.competiciones },
    ...(r.asaltos > 0 ? [{ etiqueta: 'Asaltos', valor: r.asaltos }] : []),
    { etiqueta: 'Medallas', valor: r.medallas },
  ];
  const hitos: Ficha[] = [
    ...(pct !== null ? [{ clave: 'ganados', cifra: `${pct}%`, rotulo: 'Ganados' }] : []),
    ...(r.mejorPuesto !== null ? [{ clave: 'mejor', cifra: `${r.mejorPuesto}º`, rotulo: 'Mejor puesto' }] : []),
    { clave: 'finales', cifra: String(r.finales), rotulo: r.finales === 1 ? 'Final de ocho' : 'Finales de ocho' },
  ].slice(0, 3);
  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      <FilaCifras cifras={cifras} />
      <MedallasCabecera oros={r.oros} platas={r.platas} bronces={r.bronces} hitos={hitos} />
      <MedallaDestacada m={destacada} />
    </div>
  );
}

/**
 * Cifras de la carrera en la tarjeta que gira (General, Internacional y
 * Nacional): pruebas, asaltos, rivales y medallas, hitos y la medalla más
 * valiosa. `null` si la persona no tiene nada que contar.
 */
export function CifrasCarrera({ ficha, caraInicial = 0 }: { ficha: FichaConPerfil; caraInicial?: number }) {
  const perfil = ficha.perfil;
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
        // El ranking ya va en la línea de la cabecera, con la lectura oficial: aquí no se repite.
        ...destacadosPerfil(perfil, ficha.estadisticas.porTipo).filter((d) => d.clave !== 'ranking' && d.clave !== 'mejor-ranking'),
      ].slice(0, 3)
    : [];

  const ambito = perfil?.ambito;
  const items = perfil?.resultados?.items ?? [];
  const general = cifras.length > 0 || (medallas && competiciones) ? (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      {cifras.length > 0 ? <FilaCifras cifras={cifras} /> : null}
      {medallas && competiciones ? <MedallasCabecera oros={medallas.oros} platas={medallas.platas} bronces={medallas.bronces} hitos={hitos} /> : null}
      {ambito ? <BarraAmbitos internacional={ambito.internacional.medallas} nacional={ambito.nacional.medallas} /> : null}
      <MedallaDestacada m={medallaMasValiosa(items)} />
    </div>
  ) : null;
  if (!general) return null;
  // Con un solo ámbito, su cara repetiría la general: entonces no se gira.
  const dosAmbitos = ambito && ambito.internacional.competiciones > 0 && ambito.nacional.competiciones > 0;
  const caras: CaraTarjeta[] = [
    { clave: 'general', rotulo: 'General', contenido: general },
    ...(dosAmbitos
      ? [
          { clave: 'internacional', rotulo: 'Internacional', contenido: <CaraAmbito r={ambito.internacional} destacada={medallaMasValiosa(items, 'internacional')} /> },
          { clave: 'nacional', rotulo: 'Nacional', contenido: <CaraAmbito r={ambito.nacional} destacada={medallaMasValiosa(items, 'nacional')} /> },
        ]
      : []),
  ];
  return <TarjetaGiratoria caras={caras} etiqueta="Cifras de la carrera" inicial={caraInicial} />;
}

/**
 * Cabecera compacta tipo perfil social, sin caja: retrato con anillo, nombre
 * completo, bandera, armas y datos sueltos en pastillas (edad, mano, altura;
 * lo que no hay no sale), el ranking en una línea y las acciones pequeñas.
 * El club no se enseña: el publicado en una prueba suelta (un campeonato
 * universitario, por ejemplo) no es el club de la persona. Un posible menor
 * no lleva retrato ni enlace a la FIE. Con `conCifras`, debajo va la tarjeta
 * de cifras de la carrera (en el perfil por secciones vive en Estadísticas).
 */
export function CabeceraFicha({
  ficha,
  titulo = true,
  acciones,
  datos = null,
  chips = [],
  caraInicial = 0,
  conCifras = true,
}: {
  ficha: FichaConPerfil;
  titulo?: boolean;
  /** Controles propios de la cuenta que mira, como guardar en favoritos. */
  acciones?: React.ReactNode;
  datos?: DatosPersonales | null;
  /** Puesto nacional e internacional (ver `chipsRanking`). */
  chips?: readonly ChipRanking[];
  /** Cara de la tarjeta de cifras con la que se abre (0 General, 1 Internacional, 2 Nacional). */
  caraInicial?: number;
  conCifras?: boolean;
}) {
  const nombre = datos?.nombreCompleto || nombreVisible(ficha.nombre) || ficha.nombre;
  const perfil = ficha.perfil;
  const enlaceFie = ficha.esMenor ? null : enlaceSeguro(perfil?.enlaceFie ?? null);
  // Las dos fuentes llegan ya vetadas del servidor para un posible menor ajeno;
  // el veto de los datos personales manda también sobre el año de la ficha.
  const edad = datos?.edad ?? (datos?.edadVetada && !ficha.esPropia ? null : edadDe(ficha.anioNacimiento));
  const mujer = ficha.genero === 'F';

  return (
    <header className="flex min-w-0 flex-col gap-4 pt-1">
      <div className="flex min-w-0 items-center gap-4 sm:gap-6">
        {ficha.esMenor ? (
          <AvatarAnillo nombre={nombre} tamano="lg" apagado />
        ) : (
          <FotoDeportista personaId={ficha.id} nombre={nombre} tamano="heroe" decorativa />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* El `<h1>` es el nombre: «Perfil», en la cabecera compacta, es sólo un rótulo (`encabezado: false`). */}
          {titulo ? (
            <h1 className="min-w-0 text-2xl leading-tight break-words sm:text-4xl">{nombre}</h1>
          ) : (
            <p className="min-w-0 font-display text-2xl leading-tight break-words sm:text-4xl">{nombre}</p>
          )}
          <ul className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Datos">
            {ficha.pais ? (
              <li className="inline-flex shrink-0">
                {/* 44 px de toque sin que la fila de datos crezca: el margen negativo devuelve lo que sobra. */}
                <EnlacePais pais={ficha.pais} soloBandera={false} tamaño="ficha" className="-my-3 justify-start" />
              </li>
            ) : null}
            {perfil?.armas.map((arma) => <Dato key={arma}>{WEAPON_LABEL[arma]}</Dato>)}
            {edad !== null ? <Dato>{edad} años</Dato> : null}
            {datos?.mano ? <Dato>{datos.mano === 'L' ? (mujer ? 'Zurda' : MANO.L) : mujer ? 'Diestra' : MANO.R}</Dato> : null}
            {datos?.alturaCm ? <Dato>{datos.alturaCm} cm</Dato> : null}
            {ficha.esPropia ? (
              <li className="inline-flex">
                <MarcaPropia tamano="md" />
              </li>
            ) : null}
          </ul>
          <FilasRanking chips={chips} />
        </div>
      </div>

      {/* Tres acciones con la misma medida (36 px a la vista, 44 de toque): Seguir, Cara a cara y FIE. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {acciones ? (
          // Seguir trae su propio botón de 44 px: aquí se iguala a los otros dos.
          <div className="min-w-0 [&_button]:relative [&_button]:rounded-full [&_button]:after:absolute [&_button]:after:inset-x-0 [&_button]:after:-inset-y-1 [&_button]:after:content-[''] [&_button>span:first-child]:h-9 [&_button>span:first-child]:rounded-full [&_button>span:first-child]:px-4 [&_button>span:first-child]:text-sm">
            {acciones}
          </div>
        ) : null}
        <CaraACaraHoja personaId={ficha.id} nombre={nombre} />
        {enlaceFie ? (
          <Boton asChild variante="contorno" tamano="lg">
            <a href={enlaceFie} target="_blank" rel="noopener noreferrer" title="Perfil en la FIE">
              FIE
              <ExternalLink aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
          </Boton>
        ) : null}
      </div>

      {conCifras ? <CifrasCarrera ficha={ficha} caraInicial={caraInicial} /> : null}
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
          <EstadoVacio titulo="Sin puestos finales importados" />
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
        <EstadoVacio
          tipo="error"
          titulo={historial.tipo === 'cursor_invalido' ? 'Página caducada' : 'No se ha podido cargar'}
          descripcion={
            historial.tipo === 'cursor_invalido'
              ? 'Vuelve a los resultados más recientes.'
              : historial.tipo === 'no_disponible'
                ? 'Los datos deportivos aún no están listos.'
                : 'Ha fallado la consulta. Inténtalo de nuevo.'
          }
        />
      )}
    </Bloque>
  );
}

/* ------------------------------------------------------------------ cara a cara */

/**
 * Entrada al cara a cara cuando la ficha no tiene perfil deportivo que
 * enseñar en Rivales: el mismo selector de rival en hoja que la cabecera.
 */
export function EntradaCaraACara({ ficha, nivel }: { ficha: FichaDeportiva; nivel: Nivel }) {
  return (
    <Bloque id="ficha-cara-a-cara" titulo="Cara a cara" nivel={nivel}>
      <div>
        <CaraACaraHoja personaId={ficha.id} nombre={nombreVisible(ficha.nombre) || ficha.nombre} rotulo="Elegir rival" />
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
  diferidos,
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
  /**
   * Rendimiento y rivales que llegan después (streaming). Con ellos, la ficha
   * no los espera: sus pestañas se pintan vacías, sin esqueleto, hasta que llegan.
   */
  diferidos?: DiferidosPerfil;
}) {
  const perfil = ficha.perfil;
  const ambitos = extras.rankingAmbitos ?? null;
  const bloques = bloquesRankingPerfil(extras);
  const conRanking = bloques.hay;
  const soloEuropeo = bloques.europeo && !bloques.internacional && !bloques.mundial && !bloques.nacional && !bloques.nacionalFuera;
  // Con pestaña de ranking, el resumen de la temporada ya no se repite en Rendimiento.
  const rankingEnRendimiento = conRanking ? null : <RankingCompacto ficha={ficha} nivel={nivel} />;
  const opciones = [
    { valor: 'resultados', etiqueta: 'Resultados' },
    { valor: 'estadisticas', etiqueta: 'Rendimiento' },
    ...(conRanking ? [{ valor: 'ranking', etiqueta: 'Ranking' }] : []),
    { valor: 'rivales', etiqueta: 'Rivales' },
  ];
  const paneles: Record<string, React.ReactNode> = {
    resultados:
      // Sin pruebas individuales (sólo equipos, o la lectura falló) queda el historial paginado de siempre.
      perfil?.resultados && perfil.resultados.items.length > 0 ? (
        <ResultadosPerfilVista personaId={ficha.id} resultados={perfil.resultados} base={base} criterios={criterios} nivel={nivel} />
      ) : (
        <HistorialFicha historial={historial} base={base} criterios={criterios} nivel={nivel} enPestana personaId={ficha.id} />
      ),
    estadisticas: diferidos ? (
      <Suspense fallback={null}>
        <RendimientoDiferido promesa={diferidos.rendimiento} ficha={ficha} rankingEnRendimiento={rankingEnRendimiento} nivel={nivel} />
      </Suspense>
    ) : (
      <PanelRendimiento ficha={ficha} rendimiento={extras.rendimiento} rankingEnRendimiento={rankingEnRendimiento} nivel={nivel} />
    ),
    rivales: (
      <>
        {!perfil ? (
          <EntradaCaraACara ficha={ficha} nivel={nivel} />
        ) : diferidos ? (
          <Suspense fallback={null}>
            <RivalesDiferidosVista promesa={diferidos.rivales} ficha={ficha} nivel={nivel} />
          </Suspense>
        ) : (
          <PanelRivales ficha={ficha} perfil={perfil} nivel={nivel} />
        )}
        {diferidos ? (
          <Suspense fallback={null}>
            <RelevosPerfilDiferido promesa={diferidos.relevos} personaId={ficha.id} nivel={nivel} />
          </Suspense>
        ) : null}
      </>
    ),
  };
  if (conRanking) {
    paneles.ranking = (
      <PestanaRanking
        bloques={bloques}
        nivel={nivel}
        europeo={diferidos ? (
          <Suspense fallback={null}>
            <EuropeoDiferido
              promesa={diferidos.europeo}
              nivel={nivel}
              vacio={soloEuropeo ? <EstadoVacio tipo="error" titulo="No se ha podido cargar" /> : null}
            />
          </Suspense>
        ) : null}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <CabeceraFicha
        ficha={ficha}
        titulo={conTitulo}
        acciones={acciones}
        datos={extras.datos}
        chips={chipsRanking({
          nacional: extras.rankingNacional,
          mundial: extras.rankingMundial,
          resumenMundial: extras.resumenMundial,
          ambitos,
          olimpica: extras.olimpica,
        })}
      />
      {/* Sólo el panel elegido entra en el DOM; cambiar de pestaña no vuelve a pedir nada. */}
      <Paneles
        etiqueta="Secciones de la ficha"
        variante="subrayado"
        tamano="md"
        anchoMinimo={4}
        opciones={opciones}
        paneles={paneles}
        className="gap-5"
        clasePanel="gap-8"
      />

      {!perfil ? null : diferidos ? (
        <Suspense fallback={null}>
          <SugeridosDiferidos promesa={diferidos.rivales} personaId={ficha.id} nivel={nivel} />
        </Suspense>
      ) : (
        <SugeridosPerfil personaId={ficha.id} sugeridos={perfil.sugeridos} nivel={nivel} />
      )}
    </div>
  );
}

/**
 * Pestaña Ranking: Internacional, Europeo (diferido) y Nacional, con la misma
 * lectura que las filas de la cabecera. Sin ningún bloque, una línea.
 */
export function PestanaRanking({
  bloques,
  nivel,
  europeo = null,
}: {
  bloques: BloquesRankingPerfil;
  nivel: Nivel;
  europeo?: React.ReactNode;
}) {
  const { internacional, mundial, nacional, nacionalFuera } = bloques;
  if (!internacional && !mundial && !nacional && !nacionalFuera && !europeo) {
    return <EstadoVacio titulo="Sin puestos en ningún ranking" />;
  }
  return (
    <>
      {internacional ? <RankingAmbitoPerfil titulo="Internacional" bloque={internacional} nivel={nivel} /> : null}
      {mundial ? <RankingMundialPerfil entradas={mundial} nivel={nivel} /> : null}
      {europeo}
      {nacional ? (
        <SeccionRanking titulo="Nacional" nivel={nivel}>
          <RankingNacionalPerfil ranking={nacional} nivel={nivel} />
        </SeccionRanking>
      ) : null}
      {nacionalFuera ? <RankingAmbitoPerfil titulo="Nacional" bloque={nacionalFuera} nivel={nivel} /> : null}
    </>
  );
}

export function PanelRendimiento({
  ficha,
  rendimiento: leido,
  rankingEnRendimiento,
  nivel,
}: {
  ficha: FichaConPerfil;
  rendimiento: ExtrasPerfil['rendimiento'];
  rankingEnRendimiento: React.ReactNode;
  nivel: Nivel;
}) {
  const perfil = ficha.perfil;
  const rendimiento = leido && leido.vistas.todo.total.competiciones > 0 ? leido : null;
  if (rendimiento) {
    return (
      <>
        {rankingEnRendimiento}
        {/* Cifras, evolución, temporadas, tipo y categoría con Todo / Internacional / Nacional. */}
        <SeccionRendimiento datos={rendimiento} nivel={nivel} tituloOculto />
      </>
    );
  }
  if (!perfil) return <EstadoVacio tipo="error" titulo="No se han podido cargar" />;
  return (
    <>
      <CifrasPerfil perfil={perfil} />
      {perfil.ambito ? <AmbitoPerfil ambito={perfil.ambito} nivel={nivel} /> : null}
      {perfil.ambito ? (
        <CategoriasPerfil categorias={perfil.ambito.porCategoria} nivel={nivel} />
      ) : ficha.estadisticas.detalle ? (
        <EstadisticasDeportistaVista detalle={ficha.estadisticas.detalle} nivel={nivel} />
      ) : null}
      {rankingEnRendimiento}
      <AnioAAnio perfil={perfil} nivel={nivel} />
    </>
  );
}

async function RendimientoDiferido({
  promesa,
  ...resto
}: { promesa: DiferidosPerfil['rendimiento'] } & Omit<Parameters<typeof PanelRendimiento>[0], 'rendimiento'>) {
  return <PanelRendimiento {...resto} rendimiento={await promesa} />;
}

/**
 * Pestaña Rivales. Con `enfrentados` (lectura diferida): más enfrentados, a
 * quién más gana y quién más le gana por ámbito; sin ella, la lista «Mano a
 * mano» de siempre.
 */
export function PanelRivales({
  ficha,
  perfil,
  enfrentados,
  nivel,
}: {
  ficha: FichaConPerfil;
  perfil: NonNullable<FichaConPerfil['perfil']>;
  enfrentados?: RivalesPorAmbito | null;
  nivel: Nivel;
}) {
  const conRivales = perfil.rivalesStats && perfil.rivalesStats.total.asaltos > 0 ? perfil.rivalesStats : null;
  // Con «Más enfrentados» debajo, los atajos del comparador lo repetirían.
  const rapidos = enfrentados !== undefined
    ? []
    : (perfil.rivales ?? []).slice(0, 5).map(({ id, nombre, pais, asaltos, victorias, derrotas }) => ({
        id, nombre, pais, asaltos, victorias, derrotas,
      }));
  return (
    <>
      <CompararPerfil personaId={ficha.id} nombre={ficha.nombre} rapidos={rapidos} encabezado={nivel === 'pagina' ? 'h2' : 'h3'} />
      {enfrentados !== undefined ? <RivalesPorAmbitoVista personaId={ficha.id} datos={enfrentados} nivel={nivel} /> : null}
      {conRivales ? (
        <>
          <BalanceFasesRivales stats={conRivales} nivel={nivel} />
          <CuriosidadesPerfil personaId={ficha.id} stats={conRivales} nivel={nivel} />
        </>
      ) : null}
      {enfrentados === undefined ? (
        // Con curiosidades encima, la lista necesita su propio título visible.
        <ManoAMano personaId={ficha.id} nombre={ficha.nombre} perfil={perfil} nivel={nivel} enPestana={!conRivales} />
      ) : null}
    </>
  );
}

async function RivalesDiferidosVista({
  promesa,
  ficha,
  nivel,
}: {
  promesa: DiferidosPerfil['rivales'];
  ficha: FichaConPerfil;
  nivel: Nivel;
}) {
  const d = await promesa;
  const perfil = { ...ficha.perfil!, rivalesStats: d.stats };
  return <PanelRivales ficha={ficha} perfil={perfil} enfrentados={d.enfrentados} nivel={nivel} />;
}

async function SugeridosDiferidos({ promesa, personaId, nivel }: { promesa: DiferidosPerfil['rivales']; personaId: string; nivel: Nivel }) {
  const d = await promesa;
  return <SugeridosPerfil personaId={personaId} sugeridos={d.sugeridos} nivel={nivel} />;
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
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
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

/**
 * Estados de la ficha con `EstadoVacio`. `incrustado` se mantiene por
 * compatibilidad: el estado no lleva encabezado propio, así que sirve igual
 * dentro de `/perfil` que como pantalla entera.
 */
export function EstadoFicha({
  vista,
}: {
  vista: Exclude<VistaFicha, { tipo: 'ok' } | { tipo: 'sin_sesion' }>;
  incrustado?: boolean;
}) {
  const volver = (
    <Boton asChild variante="contorno" tamano="lg">
      <Link href={RUTA_EXPLORAR} prefetch={false}>
        Buscar en Explorar
      </Link>
    </Boton>
  );
  switch (vista.tipo) {
    case 'propia_no_confirmada': {
      const e = explicacionSinVinculo(vista.motivo);
      return <EstadoVacio titulo={e.titulo} descripcion={e.texto} accion={volver} />;
    }
    case 'no_encontrada':
      return <EstadoVacio titulo="Ficha no encontrada" descripcion="Puede que el enlace sea antiguo." accion={volver} />;
    case 'entrada_invalida':
      return <EstadoVacio tipo="error" titulo="Enlace no válido" descripcion="Revisa la dirección o busca la ficha." accion={volver} />;
    case 'no_disponible':
      return <EstadoVacio tipo="error" titulo="Fichas aún no activas" descripcion="Los datos deportivos aún no están cargados." />;
    default:
      return <EstadoVacio tipo="error" titulo="No se pudo abrir la ficha" descripcion="Inténtalo de nuevo en un momento." />;
  }
}
