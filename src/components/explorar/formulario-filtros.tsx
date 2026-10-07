'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { BuscadorSocial } from './buscador-social';
import {
  RUTA_EXPLORAR,
  CLAVES_CRITERIO,
  CRITERIOS_VACIOS,
  alternarEspana,
  construirUrl,
  etiquetaTemporada,
  hayCriterios,
  type CriteriosExplorar,
  type OpcionTemporada,
} from '@/lib/sport/explorar/url';
import { CLAVES_FILTRO_TIRADOR } from '@/lib/sport/explorar/filtros-buscar';
import { categoriaVisible, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, esFechaIsoReal } from '@/lib/utils';
import { ChipOpciones, ChipPais } from './buscador-filtros';

type Opcion = { valor: string; etiqueta: string };
type Grupo = { etiqueta: string; opciones: Opcion[] };

const NOMBRE_FUENTE: Record<OpcionTemporada['fuente'], string> = {
  FIE: 'Internacional (año en que termina)',
  RFEE: 'Nacional y Europeo (septiembre a agosto)',
};

export const ARMAS: Opcion[] = Object.entries(WEAPON_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }));
/** Un tirador es masculino o femenino; «Mixto» sólo existe en pruebas. */
const GENEROS: Opcion[] = Object.entries(GENDER_LABEL).filter(([v]) => v !== 'MIXTO').map(([valor, etiqueta]) => ({ valor, etiqueta }));
const CATEGORIAS: Opcion[] = Object.keys(CATEGORY_LABEL)
  .sort((a, b) => ordenCategoriaVisible(a) - ordenCategoriaVisible(b))
  .map((valor) => ({ valor, etiqueta: categoriaVisible(valor) }));

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
  return { ok: true, url: construirUrl(c) };
}

/**
 * Buscador de tiradores: la barra de perfiles en vivo (`BuscadorSocial`) y
 * una fila de chips (arma, género, categoría, país y, para quien dirige,
 * «Solo España»). Cada chip abre una hoja y elegir aplica el filtro al momento
 * con `router.push`: Atrás vuelve a la búsqueda anterior y cada búsqueda
 * empieza en la primera página. El texto se envía con Intro o con «Ver todos
 * los resultados». La página remonta este componente (`key`) cuando cambia la
 * URL. `children` es el contenido de la página (lista completa o pantalla de
 * inicio), que se sustituye por los perfiles en vivo mientras se escribe.
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

  const filtrosActivos = CLAVES_FILTRO_TIRADOR.filter((k) => criterios[k] !== '').length;
  const errores = erroresDe(borrador);

  const buscar = (siguiente: CriteriosExplorar) => {
    setBorrador(siguiente);
    const preparada = prepararBusqueda(siguiente);
    if (!preparada.ok) {
      setAvisar(true);
      return;
    }
    setAvisar(false);
    empezar(() => router.push(preparada.url));
  };
  const poner = (parcial: Partial<CriteriosExplorar>) => buscar({ ...borrador, ...parcial });

  const espanaActiva = borrador.nacionalidad === 'ESP';

  return (
    <form
      action={RUTA_EXPLORAR}
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
      {CLAVES_CRITERIO.filter((k) => k !== 'q').map((clave) => (
        <input key={clave} type="hidden" name={clave} value={borrador[clave]} />
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
          <div className="flex min-w-0 flex-col gap-2">
            <FilaChips etiqueta="Filtros de tiradores">
              <ChipOpciones etiqueta="Arma" valor={borrador.arma} opciones={ARMAS} textoTodas="Todas" disabled={pendiente} onElegir={(arma) => poner({ arma })} />
              <ChipOpciones etiqueta="Género" valor={borrador.genero} opciones={GENEROS} textoTodas="Todos" disabled={pendiente} onElegir={(genero) => poner({ genero })} />
              <ChipOpciones etiqueta="Categoría" valor={borrador.categoria} opciones={CATEGORIAS} textoTodas="Todas" disabled={pendiente} onElegir={(categoria) => poner({ categoria })} />
              <ChipPais valor={borrador.nacionalidad} disabled={pendiente} onElegir={(nacionalidad) => poner({ nacionalidad })} />
              {atajoEspana ? (
                <ChipFiltro
                  marcado={espanaActiva}
                  aria-describedby="explorar-espana-ayuda"
                  disabled={pendiente}
                  onClick={() => buscar(alternarEspana(borrador))}
                >
                  Solo España
                </ChipFiltro>
              ) : null}
              {hayCriterios({ ...criterios, q: '' }) ? (
                <Link
                  href={construirUrl({ ...CRITERIOS_VACIOS, q: criterios.q })}
                  prefetch={false}
                  className="relative inline-flex h-[32px] shrink-0 items-center px-[4px] text-[13px] font-semibold whitespace-nowrap text-primary-text outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-[44px] after:-translate-y-1/2 after:content-[''] focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  Quitar filtros
                </Link>
              ) : null}
            </FilaChips>
            {atajoEspana ? (
              <p id="explorar-espana-ayuda" className="sr-only">
                Todas las personas españolas indexadas, tengan cuenta o no, estén activas o retiradas. Combínalo con arma o categoría.
              </p>
            ) : null}
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
