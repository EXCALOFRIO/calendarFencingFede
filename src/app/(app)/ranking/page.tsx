import { IdCard } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ladoMundial, ladoNacional } from '@/components/ranking/armar-ficha';
import { PanelRanking } from '@/components/ranking/panel-ranking';
import { TablaRankingOficial } from '@/components/ranking/tabla-oficial';
import {
  type AthleteSummary,
  getManagedAthletes,
  getSessionProfile,
} from '@/lib/auth/session';
import {
  type RankingRowView,
  getFichasFie,
  getPuestosOficiales,
  getClasificacionFie,
  gruposDeMisTiradoresFie,
  listGruposClasificacionFie,
  getRankingOficialScreenData,
  getRankingScreenData,
  groupKey,
} from '@/lib/queries/ranking';
import { armasInternas } from '@/lib/ranking/acceso-interno';
import { yearFromIsoDate } from '@/lib/utils';
import { cargarClasificacionFie, paisesFie } from './consultas';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ranking' };

/**
 * Ranking de la temporada.
 *
 * -------------------------------------------------------------------------
 * DOS NÚMEROS, Y SE DICE CUÁL ES CUÁL
 * -------------------------------------------------------------------------
 * Manda la clasificación OFICIAL de la RFEE: 1.235 filas y 808 tiradores
 * leídos de Skermo. Es la que la gente reconoce y la que decide convocatorias,
 * y hasta ahora no se enseñaba en ninguna parte: esta pantalla mostraba el
 * cálculo interno, que tenía tres filas de datos de demostración.
 *
 * El cálculo interno no se tira, porque es lo único auditable: entra dentro del
 * panel de cada tirador con ficha, debajo del puesto oficial y con su nombre
 * puesto. El razonamiento de por qué no son dos pestañas está en
 * `tabla-oficial.tsx`.
 *
 * Si algún día no hubiera clasificación oficial ingerida —una base recién
 * creada—, se cae a la tabla del cálculo interno, que es mejor que una pantalla
 * vacía. Nunca se enseñan las dos a la vez.
 *
 * Ninguna de las dos recalcula nada al vuelo: se enseña lo que hay, con su
 * fecha. Si falta, se dice.
 */
export default async function Pagina() {
  const perfil = await getSessionProfile();
  if (!perfil) redirect('/entrar');

  /**
   * El cálculo interno se autoriza ANTES de leerlo: sin permiso no se consulta
   * ni se serializa nada de `ranking_snapshot` / `ranking_point`, ni cifras,
   * ni desgloses, ni cortes, ni contadores de estado. Que la pantalla oculte
   * un botón no cuenta: lo que viaja en el HTML y en el RSC es lo que se filtra.
   */
  const armas = armasInternas(perfil);

  const [oficial, interno, atletas] = await Promise.all([
    getRankingOficialScreenData(),
    getRankingScreenData(armas),
    getManagedAthletes(perfil.profileId),
  ]);

  const mios = atletas.map((a) => a.id);

  /**
   * Las fichas de los tiradores de esta cuenta: foto y puesto mundial de la
   * FIE, y puesto oficial de la RFEE. Es lo que el usuario echaba en falta:
   *
   *   «en lo del ranking no sale como ya fijado el suyo, que es lo
   *    interesante»
   *
   * Las dos consultas van en paralelo y solo con los identificadores de esta
   * cuenta: son una o dos personas, no la federación entera.
   */
  const [fichasFie, puestosOficiales, paises, mundial, misGruposFie] = await Promise.all([
    getFichasFie(mios),
    getPuestosOficiales(mios),
    paisesFie(mios),
    /**
     * Solo la LISTA de combinaciones del mundial, que son 44 filas de cinco
     * campos. La tabla del grupo se pide abajo, una sola, y las demás cuando
     * se tocan: la clasificación completa son 11.561 filas y no tiene por qué
     * viajar al navegador para enseñar cincuenta.
     */
    listGruposClasificacionFie(),
    /** En qué prueba del mundial está cada tirador de esta cuenta. */
    gruposDeMisTiradoresFie(mios),
  ]);
  const esPersonal = perfil.role === 'athlete';
  const sinFicha = atletas.length === 0;

  if (oficial.groups.length > 0) {
    /**
     * Se abre por el grupo del tirador que mira, no por el primero de la lista.
     * Para un padre que entra a ver cómo va su hija, «florete femenino M17» es
     * la respuesta; «espada masculino absoluto» es ruido.
     */
    const suyosOficial = Object.values(oficial.tables)
      .filter((t) => t.rows.some((r) => r.athleteId && mios.includes(r.athleteId)))
      .map((t) => t.group);
    const suyos = suyosOficial.map((g) => groupKey(g));

    /**
     * Y SI NO HAY TIRADORES PROPIOS, POR EL ARMA DE QUIEN MIRA.
     *
     * Un seleccionador no gestiona fichas, así que `suyos` le sale vacío y
     * caía en el primer grupo de la lista: espada masculina absoluta. Para el
     * seleccionador de florete eso es ruido, y era justo la queja:
     *
     *   «tiene que ser automático, tipo el seleccionador de florete ve a los
     *    de florete, el de sable a los de sable»
     *
     * El perfil ya sabe de qué armas se ocupa (`profile_weapon`), así que no
     * hace falta que lo elija nadie: se abre por la primera que encuentre de
     * las suyas. Sigue pudiendo mirar cualquier otra con un clic —esto decide
     * con cuál abre, no lo que puede ver.
     */
    const deSuArma = perfil.weapons.length
      ? oficial.groups
          .filter((g) => perfil.weapons.includes(g.weapon))
          .map((g) => groupKey(g))
      : [];

    const grupoInicial = suyos[0] ?? deSuArma[0] ?? groupKey(oficial.groups[0]);

    /**
     * EL MUNDIAL ABRE EN LA PRUEBA DE TU TIRADOR, NO EN LA DE CUALQUIERA.
     *
     * Estaba mal y se vio en la captura: entrando como Carlos Llavador
     * —floretista masculino— la tabla del mundial abría en **florete
     * femenino**. El motivo: el criterio era «el primer grupo que tenga a
     * alguien con ficha en la aplicación», y con la ficha de María Mariño
     * también enlazada, «FLORETE|F» va antes que «FLORETE|M» por orden
     * alfabético y ganaba ella.
     *
     * Ahora se exige que sea **de los tuyos** (`esMio`), y si no hay ninguno,
     * el arma y el género de tu propio tirador, y solo al final el arma del
     * seleccionador. Petición literal: *«por defecto en su categoría siempre y
     * en su género»*.
     */
    const miArma = new Set(atletas.flatMap((a) => a.weapons));
    const miGenero = new Set(atletas.map((a) => a.gender));

    /**
     * De entrada, el INDIVIDUAL: es la clasificación que la gente reconoce.
     * Las selecciones están a un toque y tienen su propio conmutador.
     */
    const individuales = mundial.grupos.filter((g) => g.format === 'INDIVIDUAL');

    /**
     * ARRANCA EN LA PRUEBA DONDE ESTÁ TU TIRADOR. No en la primera que encaje.
     *
     * Con el criterio anterior —arma y género— Carlos Llavador entraba en
     * «florete masculino M17», porque M17 va antes que ABS en el orden del
     * enum y las dos son florete masculino. Y él es absoluto. Petición
     * literal: *«que me salga el mío; que sí pueda ver otro, pero al cargar
     * por defecto siempre el mío»*.
     *
     * Así que primero se busca el grupo donde la FIE lo publica de verdad
     * (`gruposDeMisTiradoresFie`), que es el dato y no una deducción.
     *
     * Y si no aparece en ninguno —la mayoría de tiradores españoles no están
     * en el ranking mundial—, se usa **la categoría en la que compite en la
     * clasificación de la RFEE**, que también es un dato. Sin este escalón se
     * caía al primer grupo por orden del enum: una tiradora de florete M20
     * abría en «florete femenino M17», visto en la captura. Solo al final se
     * cae al arma y el género a secas, y luego al arma del seleccionador.
     */
    const suyoFie = misGruposFie.find((g) => g.format === 'INDIVIDUAL');

    const grupoMundial =
      (suyoFie
        ? individuales.find(
            (g) =>
              g.weapon === suyoFie.weapon &&
              g.gender === suyoFie.gender &&
              g.category === suyoFie.category,
          )
        : undefined) ??
      individuales.find((g) =>
        suyosOficial.some(
          (s) =>
            s.weapon === g.weapon &&
            s.gender === g.gender &&
            s.category === g.category,
        ),
      ) ??
      individuales.find((g) => miArma.has(g.weapon) && miGenero.has(g.gender)) ??
      individuales.find((g) => miArma.has(g.weapon)) ??
      individuales.find((g) => perfil.weapons.includes(g.weapon)) ??
      individuales[0] ??
      null;

    /**
     * La primera tabla se resuelve AQUÍ, en el servidor, para que la pantalla
     * llegue pintada. Cambiar de arma después ya es una acción de servidor.
     */
    const primeraTablaMundial = grupoMundial
      ? await getClasificacionFie({
          format: 'INDIVIDUAL',
          weapon: grupoMundial.weapon,
          gender: grupoMundial.gender,
          category: grupoMundial.category,
          athleteIdsPropios: mios,
        })
      : null;

    /** Fila del cálculo interno por `grupo|athleteId`, para el panel. */
    const internos: Record<string, RankingRowView> = {};
    for (const [clave, tabla] of Object.entries(interno.tables)) {
      for (const fila of tabla.rows) internos[`${clave}|${fila.athleteId}`] = fila;
    }

    return (
      <>
        {/*
          El subtítulo dice la TEMPORADA y nada más.
          Decía «Clasificación oficial de la RFEE, temporada 2026-2027», y
          desde que se puede cambiar a la del mundial eso era una cabecera
          afirmando una cosa encima de una tabla que enseña otra. Visto en la
          captura del lado «Mundial». Cuál es cada clasificación lo dice el
          conmutador con su escudo, y de dónde sale exactamente lo dice la
          línea de procedencia de cada tabla.
        */}
        <Cabecera contexto={`Temporada ${oficial.seasonLabel}`} />

        {/*
          AQUÍ HABÍA DOS AVISOS DE DIAGNÓSTICO Y SE HAN IDO.

          Decían «1.235 de las 1.237 filas del ranking oficial no tienen ficha
          en la aplicación» y «el cálculo propio está incompleto: 77 resultados
          leídos siguen sin asignar a un tirador». Petición literal del
          usuario, señalando este texto: *«hay mucho texto que no quiero, como
          todo esto»*.

          Y tiene razón: eso no es información del ranking, es el estado de
          nuestra base de datos. A un tirador no le cambia ninguna decisión, y
          a la dirección técnica ya se lo cuenta la pantalla que además lo
          arregla (Gestión › Emparejar), con el número al lado del botón.

          Lo que sí se queda es lo único que cambia algo para quien mira: si
          tu cuenta no tiene ficha, el aviso de más abajo te lleva a
          vincularla. Ese habla de ti, no de la base.
        */}

        <PanelRanking
          fichas={armarFichas({ atletas, fichasFie, puestosOficiales, paises })}
          rfee={
            <TablaRankingOficial
              grupos={oficial.groups}
              tablas={oficial.tables}
              cortes={oficial.cutoffs}
              desgloses={interno.breakdowns}
              internos={internos}
              mios={mios}
              grupoInicial={grupoInicial}
              conMiFicha={puestosOficiales.length > 0 || fichasFie.size > 0}
              armasAutorizadas={armas}
            />
          }
          fie={
            grupoMundial
              ? {
                  grupos: mundial.grupos,
                  inicial: {
                    weapon: grupoMundial.weapon,
                    gender: grupoMundial.gender,
                    category: grupoMundial.category,
                    format: 'INDIVIDUAL' as const,
                  },
                  primeraTabla: primeraTablaMundial,
                  mios,
                  cargar: cargarClasificacionFie,
                }
              : null
          }
        />

        {sinFicha && esPersonal ? (
          <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
            <IdCard className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="medida">
              Vincula tu ficha para ver tu puesto.{' '}
              <Link href="/alta" className="inline-flex min-h-[44px] items-center text-primary-text underline underline-offset-4">
                Buscar mi ficha
              </Link>
              .
            </span>
          </p>
        ) : null}
      </>
    );
  }

  /**
   * Sin clasificación oficial publicada NO se cae al cálculo interno: sería
   * enseñar a cualquier cuenta un ranking privado como si fuera el de la
   * federación. Se dice que no hay clasificación y nada más.
   */
  return (
    <>
      <Cabecera contexto="Clasificación oficial RFEE" />
      <div className="flex max-w-2xl flex-col items-start gap-3 rounded-lg border border-dashed px-4 py-10">
        <h2 className="text-xl">Todavía no hay clasificación oficial</h2>
        <p className="medida text-sm text-muted-foreground">
          Aún no se ha cargado el ranking RFEE de esta temporada. Aparecerá aquí
          cuando se lea la fuente oficial.
        </p>
      </div>
    </>
  );
}
/**
 * La ficha de cada tirador de la cuenta, encima de la tabla.
 *
 * Una por tirador: un padre con dos hijas ve las dos, y un tirador la suya. Si
 * la cuenta no gestiona a nadie con datos de ranking —el caso de un
 * seleccionador, que mira el ranking de otros—, no se pinta nada: un bloque
 * vacío diciendo «no tienes puesto» no le sirve a quien no está en la lista.
 *
 * Lo que NO se pinta aquí, y por qué:
 *
 * - **El club con nombre legible.** `source_club` trae el código de Skermo
 *   (`FED-M-C`), y `club.name` hoy guarda ese mismo código. Un código donde la
 *   gente espera un nombre de club se lee como un fallo, así que el campo no
 *   sale hasta que otro agente lo tenga resuelto. No se inventa la
 *   correspondencia.
 * - **El ranking por equipos de España**, que el usuario pidió expresamente y
 *   no está en la base: no hay ninguna tabla de clasificación por equipos, ni
 *   nacional ni de la FIE. Es un encargo de ingestión, no de pantalla.
 */
/**
 * Los datos de la ficha de cada tirador de la cuenta.
 *
 * Devuelve DATOS y no elementos porque el conmutador Nacional/Mundial de la
 * ficha manda ahora también sobre la tabla, así que su estado tiene que vivir
 * en un componente de cliente que envuelva a las dos cosas
 * (`PanelRanking`). Todo lo que sale de aquí es serializable.
 */
function armarFichas({
  atletas,
  fichasFie,
  puestosOficiales,
  paises,
}: {
  atletas: AthleteSummary[];
  fichasFie: Awaited<ReturnType<typeof getFichasFie>>;
  puestosOficiales: Awaited<ReturnType<typeof getPuestosOficiales>>;
  /** `athleteId` -> código de país de la FIE («ESP»). */
  paises: Map<string, string>;
}) {
  const fichas = atletas
    .map((atleta) => {
      const ficha = fichasFie.get(atleta.id) ?? null;
      const suyos = puestosOficiales.filter((p) => p.athleteId === atleta.id);

      const nacional = ladoNacional(suyos, {
        licencia: atleta.rfeeLicense,
        anioNacimiento: atleta.birthDate ? yearFromIsoDate(atleta.birthDate) : null,
      });
      const mundial = ladoMundial(ficha);

      return { atleta, ficha, nacional, mundial };
    })
    // Sin ningún puesto en ninguno de los dos lados no hay ficha que enseñar.
    .filter(
      (f) => f.nacional.variantes.length > 0 || f.mundial.variantes.length > 0,
    );

  return fichas.map(({ atleta, ficha, nacional, mundial }) => ({
    athleteId: atleta.id,
    apellidos: atleta.lastName,
    nombre: atleta.firstName,
    pais: paises.get(atleta.id) ?? null,
    foto: ficha
      ? {
          url: ficha.fotoUrlRetrato,
          fichaUrl: ficha.fichaUrl,
          nombrePublicado: ficha.nombrePublicado,
        }
      : null,
    lados: [mundial, nacional],
  }));
}

function Cabecera({ contexto }: { contexto: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 className="text-3xl sm:text-4xl">Ranking</h1>
      <p className="text-sm text-muted-foreground">{contexto}</p>
    </div>
  );
}
