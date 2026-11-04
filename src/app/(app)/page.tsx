import { Suspense } from 'react';
import { TusPruebas } from '@/components/calendario/tus-pruebas';
import { VistaCalendario, type TiradorOpcion } from '@/components/calendario/vista';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { requireProfile } from '@/lib/auth/session';
import { leerContextoCalendario, leerEventoCalendario } from '@/lib/calendario/contexto-url';
import { filasDeTusPruebas } from '@/lib/calendario/tus-pruebas';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { requestEntry } from '@/lib/entries/actions';
import { frescura as textoFrescura, hoyMadrid } from '@/lib/fechas';
import { cargarPantallaCalendario } from '@/lib/queries/calendario-pantalla';
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
 * Lo común (la temporada y lo ya celebrado del tramo con el que se abre) sale
 * de la caché compartida; lo de la cuenta se lee aparte, en la misma tanda
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
    (contexto de la URL, temporada, frescura, el pasado del tramo) corre en
    paralelo con ella dentro de `cargarPantallaCalendario`.
  */
  const sesion = requireProfile();
  // Periodo y filtros con los que se vuelve desde una edición o una persona.
  const consulta = (await searchParams) ?? {};
  const inicial = leerContextoCalendario(consulta);
  // La ficha que se abre al llegar desde una edición o un aviso (`evento=`).
  const eventoInicial = leerEventoCalendario(consulta);

  /**
   * LO YA CELEBRADO DEL TRAMO CON EL QUE SE ABRE, Y SOLO ESO.
   *
   * El resto del pasado lo pide la vista al navegar hacia atrás (y al mostrar
   * intención de hacerlo).
   */
  // Un solo «hoy» para el servidor y para el primer pintado del cliente (ver `VistaCalendario`).
  const hoy = hoyMadrid();
  const { perfil, eventos, atletas, inscripciones, solicitudes, temporada, frescura, pasadoInicial } =
    await cargarPantallaCalendario({
      perfil: sesion,
      hoy,
      mes: inicial.mes ?? null,
      meses: (inicial.vista ?? 'trimestre') === 'mes' ? 1 : 3,
    });

  const tiradores: TiradorOpcion[] = atletas.map((a) => ({
    id: a.id,
    fullName: a.fullName,
    gender: a.gender,
    weapons: a.weapons,
    eligibleCategories: temporada
      ? deriveCategoriesFromBirthDate(a.birthDate, temporada.categories).eligible
      : [],
  }));

  if (eventos.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-center">
        <h1 className="sr-only">Calendario</h1>
        <EstadoVacio
          tipo="error"
          titulo="El calendario está vacío"
          descripcion="Todavía no hay competiciones cargadas esta temporada. Si esperabas ver alguna, avisa a la dirección técnica."
        />
      </div>
    );
  }

  /**
   * ¿Esta cuenta se ha quedado sin ficha de tirador?
   *
   * Solo se pregunta para tiradores y tutores: un seleccionador o la
   * dirección técnica tampoco tienen ficha y no les hace falta, así que
   * invitarles a vincularse sería un aviso que no les toca.
   */
  const sinFicha =
    atletas.length === 0 && perfil.role === 'athlete';

  /**
   * «Tus pruebas», encima del listado: con qué cuenta y sobre lo ya cargado.
   * Sin tiradores vinculados `filasDeTusPruebas` devuelve vacío y la sección
   * no se pinta: el calendario queda exactamente como antes.
   */
  const filasPropias = filasDeTusPruebas({ eventos, tiradores, solicitudes });

  return (
    <VistaCalendario
      inicial={inicial}
      eventoInicial={eventoInicial}
      tusPruebas={<TusPruebas filas={filasPropias} variosTiradores={tiradores.length > 1} />}
      eventos={eventos}
      /**
       * Papel y armas, que es lo que decide con qué filtros se abre la
       * pantalla: un seleccionador de florete entra en florete con los dos
       * géneros y en absoluto; la dirección técnica, en todo.
       */
      perfil={{ role: perfil.role, weapons: perfil.weapons }}
      sinFicha={sinFicha}
      tiradores={tiradores}
      inscripciones={inscripciones}
      temporada={temporada?.label ?? null}
      actualizado={frescura.lastSeenAt ? textoFrescura(frescura.lastSeenAt, { referencia: hoy }) : null}
      hoy={hoy}
      solicitarInscripcion={requestEntry}
      pasadoInicial={pasadoInicial}
      cargarPasado={pasadoDelTramo}
    />
  );
}
