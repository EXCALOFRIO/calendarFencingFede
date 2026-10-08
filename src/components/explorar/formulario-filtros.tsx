'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { BarraFiltros, CampoBuscar, OpcionesFiltro, SeccionFiltro, type FiltroActivo } from '@/components/filtros/barra-filtros';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { CLAVES_FILTRO_TIRADOR } from '@/lib/sport/explorar/filtros-buscar';
import { buscarPaises, paisPorCodigo } from '@/lib/sport/explorar/paises';
import { categoriaVisible, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import {
  CLAVES_CRITERIO,
  CRITERIOS_VACIOS,
  RUTA_BUSCAR,
  alternarEspana,
  chipsActivos,
  construirUrl,
  construirUrlBuscar,
  etiquetaTemporada,
  type CriteriosExplorar,
  type OpcionTemporada,
} from '@/lib/sport/explorar/url';
import { ROTULO_ARMA, ROTULO_GENERO } from '@/lib/sport/rotulos';
import { CATEGORY_LABEL, esFechaIsoReal } from '@/lib/utils';
import { BuscadorSocial } from './buscador-social';
import { CabeceraExplorar } from './cabecera-explorar';
import { CLASE_FILA_PAIS, ContenidoPais } from './buscador-filtros';

type Opcion = { valor: string; etiqueta: string };
type Grupo = { etiqueta: string; opciones: Opcion[] };

const NOMBRE_FUENTE: Record<OpcionTemporada['fuente'], string> = {
  FIE: 'Internacional (año en que termina)',
  RFEE: 'Nacional y Europeo (septiembre a agosto)',
};

export const ARMAS: Opcion[] = Object.entries(ROTULO_ARMA).map(([valor, etiqueta]) => ({ valor, etiqueta }));
/** Un tirador es masculino o femenino; «Mixto» sólo existe en pruebas. */
const GENEROS: Opcion[] = (['M', 'F'] as const).map((valor) => ({ valor, etiqueta: ROTULO_GENERO[valor] }));
const CATEGORIAS: Opcion[] = Object.keys(CATEGORY_LABEL)
  .sort((a, b) => ordenCategoriaVisible(a) - ordenCategoriaVisible(b))
  .map((valor) => ({ valor, etiqueta: categoriaVisible(valor) }));

const MAX_PAISES_HOJA = 6;

/**
 * Opciones del selector de temporada: un grupo por fuente y, aparte, la
 * temporada de la URL si no está entre las ofrecidas, para que el selector
 * nunca muestre «Todas» mientras el filtro está activo.
 */
export function agruparTemporadas(
  temporadas: OpcionTemporada[],
  actual: string,
): { sueltas: Opcion[]; grupos: Grupo[] } {
  const sueltas =
    actual !== '' && !temporadas.some((t) => t.valor === actual)
      ? [{ valor: actual, etiqueta: etiquetaTemporada(actual) }]
      : [];
  const grupos = (['FIE', 'RFEE'] as const).map((fuente) => ({
    etiqueta: NOMBRE_FUENTE[fuente],
    opciones: temporadas
      .filter((t) => t.fuente === fuente)
      .map(({ valor, etiqueta }) => ({ valor, etiqueta })),
  }));
  return { sueltas, grupos };
}

type ClaveError = 'torneo' | 'nacionalidad' | 'desde' | 'hasta' | 'intervalo';

const MENSAJE_FECHA = (nombre: string) =>
  `«${nombre}» no es una fecha válida. Escríbela como 03/10/2026 o bórrala para poder buscar.`;

/**
 * Una fecha rellena que no existe (`31/02/2026`, `2026-99-99`) es un error,
 * no un campo vacío: enviarla en blanco ampliaría la búsqueda sin avisar.
 */
export function erroresDe(c: CriteriosExplorar): Partial<Record<ClaveError, string>> {
  const errores: Partial<Record<ClaveError, string>> = {};
  if (c.torneo.length === 1) errores.torneo = 'Escribe al menos dos letras del torneo.';
  if (c.nacionalidad !== '' && !/^[A-Z]{3}$/.test(c.nacionalidad)) {
    errores.nacionalidad = 'El país son tres letras, por ejemplo ESP o FRA.';
  }
  const desdeReal = c.desde !== '' && esFechaIsoReal(c.desde);
  const hastaReal = c.hasta !== '' && esFechaIsoReal(c.hasta);
  if (c.desde !== '' && !desdeReal) errores.desde = MENSAJE_FECHA('Desde');
  if (c.hasta !== '' && !hastaReal) errores.hasta = MENSAJE_FECHA('Hasta');
  if (desdeReal && hastaReal && c.desde > c.hasta) {
    errores.intervalo = 'La fecha «Desde» tiene que ser anterior o igual a «Hasta».';
  }
  return errores;
}

export type PreparacionBusqueda =
  | { ok: true; url: string }
  | { ok: false; errores: Partial<Record<ClaveError, string>> };

/** Única puerta entre el borrador del formulario y la URL: sin errores no hay navegación. */
export function prepararBusqueda(c: CriteriosExplorar): PreparacionBusqueda {
  const errores = erroresDe(c);
  if (Object.keys(errores).length > 0) return { ok: false, errores };
  return { ok: true, url: construirUrlBuscar(c) };
}

const DE_TIRADOR: ReadonlySet<string> = new Set(CLAVES_FILTRO_TIRADOR);

/**
 * Los filtros puestos como chips que se quitan de un toque. Los de tirador
 * dicen sólo el valor («Espada»); los de enlaces antiguos (torneo, temporada,
 * fechas…), que ya no se eligen aquí, llevan su nombre delante.
 */
export function filtrosPuestos(
  criterios: CriteriosExplorar,
  quitar: (clave: keyof CriteriosExplorar) => void,
): FiltroActivo[] {
  return chipsActivos(criterios)
    .filter((c) => c.clave !== 'q')
    .map((c) => ({
      clave: c.clave,
      etiqueta: DE_TIRADOR.has(c.clave)
        ? (c.clave === 'nacionalidad' ? (paisPorCodigo(c.valor)?.nombre ?? c.valor) : c.valor)
        : `${c.etiqueta}: ${c.valor}${c.fechaInvalida ? ' (no válida)' : ''}`,
      onQuitar: () => quitar(c.clave),
    }));
}

/**
 * Buscador de tiradores: la barra de perfiles en vivo (`BuscadorSocial`), el
 * selector de ámbitos de Explorar y la barra de filtros del sistema: un botón
 * «Filtros» con una sola hoja (arma, género, categoría y país) y los puestos
 * como chips. Cada cambio se aplica al momento con `router.replace`: la
 * búsqueda no apila entradas en el historial y Atrás sale de Explorar de una
 * vez. El texto se envía con Intro o con «Ver todos los resultados».
 * `children` es el contenido de la página (lista completa o sugerencias), que
 * se sustituye por los perfiles en vivo mientras se escribe.
 */
export function FormularioFiltros({
  criterios,
  atajoEspana,
  profileId,
  children,
}: {
  criterios: CriteriosExplorar;
  /** Temporadas que ofrecía el panel antiguo; los tiradores ya no se filtran por temporada. */
  temporadas?: OpcionTemporada[];
  atajoEspana: boolean;
  /** Cuenta de la sesión: separa los recientes de cada cuenta en el navegador. */
  profileId?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pendiente, empezar] = React.useTransition();
  const [borrador, setBorrador] = React.useState<CriteriosExplorar>(criterios);
  const [avisar, setAvisar] = React.useState(false);
  const [hoja, setHoja] = React.useState(false);

  // La URL manda: al llegar una búsqueda nueva (también por Atrás) el borrador se pone al día sin cerrar la hoja.
  const clave = construirUrl(criterios);
  const [vista, setVista] = React.useState(clave);
  if (vista !== clave) {
    setVista(clave);
    setBorrador(criterios);
    setAvisar(false);
  }

  const errores = erroresDe(borrador);
  const filtrosActivos = CLAVES_FILTRO_TIRADOR.filter((k) => criterios[k] !== '').length;

  const buscar = (siguiente: CriteriosExplorar) => {
    setBorrador(siguiente);
    const preparada = prepararBusqueda(siguiente);
    if (!preparada.ok) {
      setAvisar(true);
      return;
    }
    setAvisar(false);
    empezar(() => router.replace(preparada.url, { scroll: false }));
  };
  const poner = (parcial: Partial<CriteriosExplorar>) => buscar({ ...borrador, ...parcial });

  return (
    <form
      action={RUTA_BUSCAR}
      method="get"
      role="search"
      aria-label="Buscar tiradores"
      aria-busy={pendiente}
      className="flex min-w-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        buscar(borrador);
      }}
    >
      {CLAVES_CRITERIO.filter((k) => k !== 'q').map((k) => (
        <input key={k} type="hidden" name={k} value={borrador[k]} />
      ))}
      <BuscadorSocial
        valor={borrador.q}
        onChange={(q) => setBorrador((actual) => ({ ...actual, q }))}
        qUrl={criterios.q}
        volverDe={(q) => construirUrl({ ...criterios, q })}
        profileId={profileId}
        avisoFiltros={filtrosActivos > 0}
        pendiente={pendiente}
        herramientas={(
          <div className="flex min-w-0 flex-col gap-3">
            <CabeceraExplorar activa="personas" q={criterios.q} />
            <BarraFiltros
              activos={filtrosPuestos(criterios, (k) => buscar({ ...borrador, [k]: '' }))}
              onLimpiar={() => buscar({ ...CRITERIOS_VACIOS, q: borrador.q })}
              resultados="Ver resultados"
              abierta={hoja}
              onAbierta={setHoja}
              etiqueta="Filtros de tiradores puestos"
            >
              <HojaTirador borrador={borrador} poner={poner} atajoEspana={atajoEspana} />
            </BarraFiltros>
            {avisar && Object.keys(errores).length > 0 ? (
              <p role="alert" className="text-sm text-danger">
                {Object.values(errores).join(' ')}
              </p>
            ) : null}
          </div>
        )}
      >
        {children}
      </BuscadorSocial>
    </form>
  );
}

/** Los apartados de la hoja de filtros de tiradores. Cada toque aplica el filtro. */
export function HojaTirador({
  borrador,
  poner,
  atajoEspana,
}: {
  borrador: CriteriosExplorar;
  poner: (parcial: Partial<CriteriosExplorar>) => void;
  atajoEspana: boolean;
}) {
  return (
    <>
      <OpcionesFiltro
        titulo="Arma"
        variante="segmentado"
        valor={borrador.arma}
        opciones={[{ valor: '', etiqueta: 'Todas' }, ...ARMAS]}
        onCambio={(arma) => poner({ arma })}
      />
      <OpcionesFiltro
        titulo="Género"
        variante="segmentado"
        valor={borrador.genero}
        opciones={[{ valor: '', etiqueta: 'Todos' }, ...GENEROS]}
        onCambio={(genero) => poner({ genero })}
      />
      <OpcionesFiltro
        titulo="Categoría"
        valor={borrador.categoria}
        opciones={[{ valor: '', etiqueta: 'Todas' }, ...CATEGORIAS]}
        onCambio={(categoria) => poner({ categoria })}
      />
      <ApartadoPais
        valor={borrador.nacionalidad}
        atajoEspana={atajoEspana}
        onElegir={(nacionalidad) => poner({ nacionalidad })}
        onEspana={() => poner({ nacionalidad: alternarEspana(borrador).nacionalidad })}
      />
    </>
  );
}

/** País: el elegido, «Solo España» para quien dirige y un campo que busca por nombre o código. */
function ApartadoPais({
  valor,
  atajoEspana,
  onElegir,
  onEspana,
}: {
  valor: string;
  atajoEspana: boolean;
  onElegir: (codigo: string) => void;
  onEspana: () => void;
}) {
  const [texto, setTexto] = React.useState('');
  const lista = texto.trim() ? buscarPaises(texto, MAX_PAISES_HOJA) : [];
  const elegido = valor ? paisPorCodigo(valor) : null;
  const elegir = (codigo: string) => {
    setTexto('');
    if (codigo !== valor) onElegir(codigo);
  };
  return (
    <SeccionFiltro titulo="País">
      {atajoEspana || valor ? (
        <FilaChips etiqueta="País elegido">
          {atajoEspana ? (
            <ChipFiltro marcado={valor === 'ESP'} aria-describedby="explorar-espana-ayuda" onClick={onEspana}>
              Solo España
            </ChipFiltro>
          ) : null}
          {valor && !(atajoEspana && valor === 'ESP') ? (
            <ChipFiltro tipo="quitar" onClick={() => elegir('')}>{elegido?.nombre ?? valor}</ChipFiltro>
          ) : null}
        </FilaChips>
      ) : null}
      {atajoEspana ? (
        <p id="explorar-espana-ayuda" className="sr-only">
          Todas las personas españolas indexadas, tengan cuenta o no, estén activas o retiradas. Combínalo con arma o categoría.
        </p>
      ) : null}
      <CampoBuscar valor={texto} onCambio={setTexto} etiqueta="Buscar país" placeholder="España, ITA…" />
      {lista.length > 0 ? (
        <ul aria-label="Países" className="flex flex-col">
          {lista.map((p) => (
            <li key={p.codigo}>
              <button
                type="button"
                aria-pressed={p.codigo === valor}
                className={CLASE_FILA_PAIS}
                onClick={() => elegir(p.codigo)}
              >
                <ContenidoPais pais={p} />
              </button>
            </li>
          ))}
        </ul>
      ) : texto.trim() ? (
        <p className="py-3 text-sm text-muted-foreground">Ningún país</p>
      ) : null}
    </SeccionFiltro>
  );
}
