import { Suspense } from 'react';
import { TusPruebas } from '@/components/calendario/tus-pruebas';
import { VistaCalendario, type TiradorOpcion } from '@/components/calendario/vista';
import { requireProfile } from '@/lib/auth/session';
import { leerContextoCalendario } from '@/lib/calendario/contexto-url';
import { filasDeTusPruebas, type TiradorDeCuenta } from '@/lib/calendario/tus-pruebas';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { requestEntry } from '@/lib/entries/actions';
import { frescura as textoFrescura, hoyMadrid } from '@/lib/fechas';
import {
  cargarPantallaCalendario,
  type ListadoDelCalendario,
} from '@/lib/queries/calendario-pantalla';
import { pasadoDelTramo } from './calendario-pasado';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calendario' };

/**
 * La pantalla principal ES el calendario.
 *
 * Se carga la temporada entera de una vez y el filtrado ocurre en el
 * cliente: son unos cientos de eventos, cabe de sobra, y así cambiar de mes
 * o de filtro es instantáneo. En un pabellón con mala cobertura, esperar a
 * la red en cada toque es la diferencia entre usarlo y no usarlo.
 *
 * Solo nacional e internacional: el calendario autonómico (Madrid,
 * Cataluña…) no es el objeto de esta aplicación. Esto es para tiradores de
 * ámbito nacional y para la selección española.
 *
 * La carga va en dos velocidades: `base` —la sesión, la temporada, la
 * frescura y las categorías de los filtros, todo memoizado o en caché— se
 * espera aquí y pinta la estructura; `listado` —la temporada entera y las
 * inscripciones— viaja como promesa hasta la vista y entra por el stream
 * (ver `calendario-pantalla.ts`).
 */
export default function CalendarioPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  /*
    Sin esqueleto: el armazón (cabecera y barra) sale en el primer trozo del
    HTML y el calendario llega en streaming, como las sugerencias de
    `/explorar/buscar` (`explorar/pantalla-buscar.tsx`).
  */
  return (
    <Suspense fallback={null}>
      <ContenidoCalendario searchParams={searchParams} />
    </Suspense>
  );
}

async function ContenidoCalendario({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    La sesión se pide YA, sin esperarla: todo lo que no depende de la cuenta
    (contexto de la URL, temporada, frescura, categorías, el pasado del
    tramo) corre en paralelo con ella dentro de `cargarPantallaCalendario`.
  */
  const sesion = requireProfile();
  // Periodo y filtros con los que se vuelve desde una edición o una persona.
  const consulta = (await searchParams) ?? {};
  const inicial = leerContextoCalendario(consulta);

  /**
   * LO YA CELEBRADO DEL TRAMO CON EL QUE SE ABRE, Y SOLO ESO.
   *
   * El resto del pasado lo pide la vista al navegar hacia atrás (y al mostrar
   * intención de hacerlo).
   */
  // Un solo «hoy» para el servidor y para el primer pintado del cliente (ver `VistaCalendario`).
  const hoy = hoyMadrid();
  /*
    La estructura (`base`) se espera aquí; el listado (`listado`) y el
    pasado del tramo (`pasadoInicial`) viajan como promesas a la vista sin
    resolverlos: cabecera, chips y filtros salen ya, y el resto entra por el
    stream en cuanto cada promesa se resuelve.
  */
  const { base, listado, pasadoInicial } = cargarPantallaCalendario({
    perfil: sesion,
    hoy,
    mes: inicial.mes ?? null,
    meses: (inicial.vista ?? 'trimestre') === 'mes' ? 1 : 3,
  });
  const { perfil, atletas, temporada, frescura, categorias } = await base;

  const tiradores: TiradorOpcion[] = atletas.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    gender: a.gender,
    weapons: a.weapons,
    eligibleCategories: temporada
      ? deriveCategoriesFromBirthDate(a.birthDate, temporada.categories).eligible
      : [],
  }));

  /**
   * ¿Esta cuenta se ha quedado sin ficha de tirador?
   *
   * Solo se pregunta para tiradores y tutores: un seleccionador o la
   * dirección técnica tampoco tienen ficha y no les hace falta, así que
   * invitarles a vincularse sería un aviso que no les toca.
   */
  const sinFicha = atletas.length === 0 && perfil.role === 'athlete';

  return (
    <VistaCalendario
      inicial={inicial}
      /*
        «Tus pruebas», en su `<Suspense>`: usa los mismos datos que el
        listado —no repite lectura— y llega con él, sin frenar el armazón.
      */
      tusPruebas={
        <Suspense fallback={null}>
          <TusPruebasDiferidas listado={listado} tiradores={tiradores} />
        </Suspense>
      }
      /**
       * El listado entra por el stream: la vista lo resuelve con `use()`
       * dentro de sus propios `<Suspense>`, así que cabecera y filtros se
       * pintan con el primer trozo y las tarjetas llegan después.
       */
      listado={listado}
      categoriasOfertadas={categorias}
      /**
       * Papel y armas, que es lo que decide con qué filtros se abre la
       * pantalla: un seleccionador de florete entra en florete con los dos
       * géneros y en absoluto; la dirección técnica, en todo.
       */
      perfil={{ role: perfil.role, weapons: perfil.weapons }}
      sinFicha={sinFicha}
      tiradores={tiradores}
      temporada={temporada?.label ?? null}
      actualizado={frescura.lastSeenAt ? textoFrescura(frescura.lastSeenAt, { referencia: hoy }) : null}
      hoy={hoy}
      solicitarInscripcion={requestEntry}
      pasadoInicial={pasadoInicial}
      cargarPasado={pasadoDelTramo}
    />
  );
}

/**
 * «Tus pruebas», encima del listado y con los mismos datos: espera la
 * promesa del listado en el servidor —la misma que la vista resuelve en el
 * cliente—, así que no hay una segunda lectura de `entry` ni de eventos.
 * Sin tiradores vinculados `filasDeTusPruebas` devuelve vacío y la sección
 * no se pinta.
 */
async function TusPruebasDiferidas({
  listado,
  tiradores,
}: {
  listado: Promise<ListadoDelCalendario>;
  tiradores: TiradorDeCuenta[];
}) {
  const { eventos, solicitudes } = await listado;
  return (
    <TusPruebas
      filas={filasDeTusPruebas({ eventos, tiradores, solicitudes })}
      variosTiradores={tiradores.length > 1}
    />
  );
}
