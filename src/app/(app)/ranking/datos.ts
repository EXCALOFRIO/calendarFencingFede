import { conClasificacionFie, ladoCompacto, ladoMundial, ladoNacional } from '@/components/ranking/armar-ficha';
import type { FichaPanel } from '@/components/ranking/panel-ranking';
import type { DatosTablaOficial } from '@/components/ranking/tabla-oficial';
import type { GrupoEuropeo, TablaEuropea } from '@/components/ranking/tipos-europeo';
import { db } from '@/db';
import {
  type AthleteSummary,
  type SessionProfile,
  getManagedAthletes,
} from '@/lib/auth/session';
import { mapCategory } from '@/lib/ingest/mappers';
import {
  type FormatoClasificacion,
  type GrupoClasificacion,
  type PuestoOficial,
  type RankingGroupKey,
  getFichasFie,
  getPuestosOficiales,
  getRankingScreenData,
  groupKey,
  gruposDeMisTiradoresFie,
} from '@/lib/queries/ranking';
import {
  type GrupoNacional,
  type TablaNacional,
  elegirGrupo,
  personaPorAtleta,
  personasDeAtletas,
} from '@/lib/queries/ranking-temporadas';
import { armasInternas } from '@/lib/ranking/acceso-interno';
import type { TablaFieCompleta } from '@/lib/ranking/tabla-fie-completa';
import type { FiltroRankingNacional } from '@/lib/ranking/url-nacional';
import { leerPuestosOficialesVigentes, leerResumenMundial, type MejorMundial } from '@/lib/sport/explorar/ranking-nacional';
import { resolverPersona } from '@/lib/sport/explorar/personas';
import {
  gruposEuropeosCompartidos,
  gruposEuropeosPublicos,
  gruposFieCompartidos,
  gruposNacionalesDeTemporada,
  hoyRanking,
  tablaEuropeaDe,
  tablaNacionalDeTemporada,
  tablaNacionalVigente,
  temporadasNacionalesCompartidas,
  gruposNacionalesVigentes,
} from './compartido';
import { armarDatosNacional, tablaFieParaCuenta } from './consultas';

type Ambito = 'RFEE' | 'FIE' | 'EFC';

/** Lo que la URL dice de la vista, además de temporada y grupo (`leerFiltroRankingNacional`). */
export type VistaPedida = { ambito: Ambito | null; formato: FormatoClasificacion };

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const AMBITO_DE_URL: Record<string, Ambito> = { nacional: 'RFEE', internacional: 'FIE', europeo: 'EFC' };

export function leerVistaRanking(params: Record<string, string | string[] | undefined>): VistaPedida {
  const ambito = uno(params.ambito).trim().toLowerCase();
  return {
    ambito: AMBITO_DE_URL[ambito] ?? null,
    formato: uno(params.formato).trim().toLowerCase() === 'equipos' ? 'EQUIPOS' : 'INDIVIDUAL',
  };
}

export type PantallaRanking =
  | {
      tipo: 'historica';
      temporada: string;
      temporadas: string[];
      vigente: string | null;
      filtro: FiltroRankingNacional;
      grupos: GrupoNacional[];
      grupo: GrupoNacional | null;
      tabla: TablaNacional | null;
      misPersonas: string[];
    }
  | {
      tipo: 'vigente';
      ambito: Ambito;
      seasonLabel: string;
      temporadas: string[];
      vigente: string | null;
      filtro: FiltroRankingNacional;
      /** La tabla nacional del grupo inicial, sólo si se abre en Nacional; si no, se pide al cambiar. */
      nacional: DatosTablaOficial | null;
      grupoInicial: string;
      mios: string[];
      conMiFicha: boolean;
      fichas: FichaPanel[];
      mundial: { grupos: GrupoClasificacion[] };
      grupoMundial: (RankingGroupKey & { format: FormatoClasificacion }) | null;
      /** Sólo si se abre en Internacional; si no, se pide al cambiar. */
      primeraTablaMundial: TablaFieCompleta | null;
      /** El ranking europeo: grupos con lista y, si se abre en Europeo, la primera tabla. */
      europeo: { grupos: GrupoEuropeo[]; inicial: RankingGroupKey | null; primeraTabla: TablaEuropea | null; mios: string[] };
      sinFicha: boolean;
      esPersonal: boolean;
    }
  | { tipo: 'vacia' };

/**
 * Todo lo que lee /ranking, separado de cómo se pinta.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ CADA LECTURA ARRANCA EN CUANTO PUEDE, Y NO POR TANDAS
 * -------------------------------------------------------------------------
 * Cada lectura cuelga sólo de lo que necesita de verdad: en D1 (un viaje de
 * red por sentencia) eso son varios viajes menos en el camino crítico.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SÓLO VIAJA UN GRUPO DE LA TABLA QUE SE VE
 * -------------------------------------------------------------------------
 * Medido en la copia de producción: la primera carga serializaba 681 kB, la
 * mitad de la tabla que NO se enseña; y abriendo en Nacional, las 1.350 filas
 * de todos los grupos (y la persona de cada una) para enseñar uno. Ahora va la
 * lista de grupos y la tabla del grupo inicial; lo demás se pide al cambiar.
 *
 * -------------------------------------------------------------------------
 * CACHÉ COMPARTIDA, LO DE LA CUENTA APARTE
 * -------------------------------------------------------------------------
 * Las tablas y las listas de grupos salen de `compartido.ts` (iguales para
 * todos). Lo de la cuenta —sus tiradores, sus puestos, el cálculo interno— se
 * lee aquí en cada petición y se añade encima.
 */
export async function cargarPantallaRanking(
  perfil: SessionProfile,
  filtro: FiltroRankingNacional,
  vista: VistaPedida = { ambito: null, formato: 'INDIVIDUAL' },
): Promise<PantallaRanking> {
  /**
   * El cálculo interno se autoriza ANTES de leerlo: sin permiso no se consulta
   * ni se serializa nada de `ranking_snapshot` / `ranking_point`.
   */
  const armas = armasInternas(perfil);
  const hoy = hoyRanking();

  const vigentesP = gruposNacionalesVigentes();
  const atletasP = getManagedAthletes(perfil.profileId);
  const historicasP = temporadasNacionalesCompartidas().catch(() => [] as string[]);

  if (filtro.temporada) {
    const [vigentes, atletas, historicas] = await Promise.all([vigentesP, atletasP, historicasP]);
    const vigente = vigentes.seasonLabel ?? historicas[0] ?? null;
    if (filtro.temporada !== vigente && historicas.includes(filtro.temporada)) {
      const temporada = filtro.temporada;
      const temporadas = ordenarTemporadas(vigente, historicas);
      const [grupos, misPersonas] = await Promise.all([
        gruposNacionalesDeTemporada(temporada),
        personasDeAtletas(db, atletas.map((a) => a.id)).catch(() => [] as string[]),
      ]);
      const grupo = elegirGrupo(grupos, filtro);
      const tabla = grupo
        ? await tablaNacionalDeTemporada(temporada, grupo.arma, grupo.genero, grupo.categoriaRaw, grupo.categoria, grupo.fuente ?? null)
        : null;
      return { tipo: 'historica', temporada, temporadas, vigente, filtro, grupos, grupo, tabla, misPersonas };
    }
  }

  // Cada lectura cuelga sólo de lo que necesita.
  const miosP = atletasP.then((a) => a.map((x) => x.id));
  const mundialP = gruposFieCompartidos();
  const europeosP = gruposEuropeosCompartidos().catch(() => []);
  const fichasFieP = miosP.then((m) => getFichasFie(m));
  const puestosP = miosP.then((m) => getPuestosOficiales(m));
  const misGruposFieP = miosP.then((m) => gruposDeMisTiradoresFie(m));
  const personaDeP = miosP.then((m) => personaPorAtleta(db, m).catch(() => ({}) as Record<string, string>));
  const gruposPersonaP = personaDeP.then(gruposDePersonas);
  const puestosVigentesP = Promise.all([atletasP, puestosP, gruposPersonaP])
    .then(([atletas, puestos, grupos]) => completarPuestosOficiales(atletas, puestos, grupos));
  const fieVigenteP = gruposPersonaP.then(clasificacionFieDeAtletas);

  const categoriaPedida = filtro.categoria ? mapCategory(filtro.categoria) : null;
  const casaConFiltro = (g: RankingGroupKey) =>
    g.weapon === filtro.arma &&
    (filtro.genero === null || g.gender === filtro.genero) &&
    (categoriaPedida === null || g.category === categoriaPedida);
  const pedidoP = vigentesP.then((o) => (filtro.arma ? o.groups.find(casaConFiltro) : undefined));
  /** Los grupos de la clasificación vigente donde está alguno de tus tiradores, en el orden de la lista. */
  const suyosOficialP = Promise.all([vigentesP, puestosP]).then(([o, puestos]) => {
    const suyos = new Set(puestos.filter((p) => p.seasonLabel === o.seasonLabel).map((p) => groupKey({ weapon: p.weapon, gender: p.gender, category: p.category as RankingGroupKey['category'] })));
    return o.groups.filter((g) => suyos.has(groupKey(g)));
  });

  /**
   * Se abre por el grupo del tirador que mira, no por el primero de la lista:
   * para un padre que entra a ver cómo va su hija, «florete femenino M17» es
   * la respuesta. Sin tiradores propios, por el arma del seleccionador
   * (`profile_weapon`): *«el seleccionador de florete ve a los de florete»*.
   * Un enlace con arma y categoría (p. ej. desde un perfil) manda.
   */
  const grupoInicialP = Promise.all([vigentesP, pedidoP, suyosOficialP]).then(([o, pedido, suyos]) => {
    const deSuArma = perfil.weapons.length ? o.groups.filter((g) => perfil.weapons.includes(g.weapon)) : [];
    const g = pedido ?? suyos[0] ?? deSuArma[0] ?? o.groups[0];
    return g ? { weapon: g.weapon, gender: g.gender, category: g.category } : null;
  });

  /**
   * ARRANCA EN LA FIE (*«quiero que sea por defecto en la internacional»*),
   * salvo que el enlace pida otro ámbito o traiga arma y categoría de una
   * lista nacional concreta. En el caso de siempre —sin nada en la URL— se
   * sabe sin esperar a la clasificación nacional.
   */
  const ambitoP: Promise<Ambito> = Promise.all([mundialP, europeosP]).then(async ([mundial, europeos]) => {
    if (vista.ambito === 'EFC') return europeos.length > 0 ? 'EFC' : mundial.grupos.length > 0 ? 'FIE' : 'RFEE';
    if (mundial.grupos.length === 0) return 'RFEE';
    if (vista.ambito) return vista.ambito;
    if (filtro.temporada) return 'RFEE';
    if (!filtro.arma) return 'FIE';
    return (await pedidoP) ? 'RFEE' : 'FIE';
  });

  const nacionalP = ambitoP.then(async (ambito) => {
    if (ambito !== 'RFEE') return null;
    const [vigentes, grupo, mios, interno] = await Promise.all([vigentesP, grupoInicialP, miosP, getRankingScreenData(armas)]);
    const tabla = grupo && vigentes.seasonLabel
      ? await tablaNacionalVigente(vigentes.seasonLabel, grupo.weapon, grupo.gender, grupo.category, hoy)
      : null;
    return armarDatosNacional({ grupos: vigentes.groups, grupo, tabla, interno, mios, armas });
  });

  /**
   * EL INTERNACIONAL ABRE EN LA PRUEBA DE TU TIRADOR, NO EN LA DE CUALQUIERA:
   * *«que me salga el mío; que sí pueda ver otro, pero al cargar por defecto
   * siempre el mío»*. Primero un enlace que pide Internacional con arma y
   * categoría; luego donde la FIE publica a tu tirador de verdad
   * (`gruposDeMisTiradoresFie`); si no está, la categoría en la que compite en
   * la RFEE; luego su arma y género, y al final el arma del seleccionador.
   * Sólo los escalones del medio esperan a la clasificación nacional.
   */
  const grupoMundialP = Promise.all([ambitoP, mundialP, misGruposFieP, atletasP]).then(
    async ([ambito, mundial, misGruposFie, atletas]) => {
      const formato: FormatoClasificacion = ambito === 'FIE' ? vista.formato : 'INDIVIDUAL';
      const delFormato = mundial.grupos.filter((g) => g.format === formato);
      const suyoFie = misGruposFie.find((g) => g.format === formato);
      const directo =
        (ambito === 'FIE' && filtro.arma ? delFormato.find(casaConFiltro) : undefined) ??
        (suyoFie
          ? delFormato.find((g) => g.weapon === suyoFie.weapon && g.gender === suyoFie.gender && g.category === suyoFie.category)
          : undefined);
      if (directo) return { formato, grupo: directo };
      const suyosOficial = await suyosOficialP;
      const miArma = new Set(atletas.flatMap((a) => a.weapons));
      const miGenero = new Set(atletas.map((a) => a.gender));
      const grupo =
        delFormato.find((g) => suyosOficial.some((s) => s.weapon === g.weapon && s.gender === g.gender && s.category === g.category)) ??
        delFormato.find((g) => miArma.has(g.weapon) && miGenero.has(g.gender)) ??
        delFormato.find((g) => miArma.has(g.weapon)) ??
        delFormato.find((g) => perfil.weapons.includes(g.weapon)) ??
        delFormato[0] ??
        null;
      return { formato, grupo };
    },
  );

  const primeraTablaP = Promise.all([ambitoP, grupoMundialP, miosP]).then(([ambito, { formato, grupo }, mios]) =>
    ambito === 'FIE' && grupo
      ? tablaFieParaCuenta({ format: formato, weapon: grupo.weapon, gender: grupo.gender, category: grupo.category }, mios)
      : null,
  );

  /** El europeo abre en el arma y género del enlace, de tus tiradores o del seleccionador. */
  const europeoP = Promise.all([ambitoP, europeosP, atletasP]).then(async ([ambito, grupos, atletas]) => {
    if (grupos.length === 0) return { grupos: [], inicial: null, primeraTabla: null };
    const miArma = new Set(atletas.flatMap((a) => a.weapons));
    const miGenero = new Set(atletas.map((a) => a.gender));
    // Dentro de cada escalón, la lista más larga: a principio de temporada la U14 trae una fila.
    const mayor = (lista: typeof grupos) => [...lista].sort((a, b) => b.clasificados - a.clasificados)[0];
    const elegido =
      (filtro.arma ? grupos.find(casaConFiltro) ?? mayor(grupos.filter((g) => g.weapon === filtro.arma && (filtro.genero === null || g.gender === filtro.genero))) : undefined) ??
      mayor(grupos.filter((g) => miArma.has(g.weapon) && miGenero.has(g.gender))) ??
      mayor(grupos.filter((g) => perfil.weapons.includes(g.weapon))) ??
      mayor(grupos);
    const inicial = { weapon: elegido.weapon, gender: elegido.gender, category: elegido.category };
    const primeraTabla = ambito === 'EFC' ? await tablaEuropeaDe(grupos, elegido).catch(() => null) : null;
    return { grupos: gruposEuropeosPublicos(grupos), inicial, primeraTabla };
  });

  const [
    vigentes, atletas, historicas, mios, mundial, ambito, nacional, mundialElegido, grupoInicial,
    primeraTablaMundial, fichasFie, puestosVigentes, personaDe, fieVigente, europeo,
  ] = await Promise.all([
    vigentesP, atletasP, historicasP, miosP, mundialP, ambitoP, nacionalP, grupoMundialP, grupoInicialP,
    primeraTablaP, fichasFieP, puestosVigentesP, personaDeP, fieVigenteP, europeoP,
  ]);

  if (vigentes.groups.length === 0 || !grupoInicial) return { tipo: 'vacia' };

  const vigente = vigentes.seasonLabel ?? historicas[0] ?? null;
  const { formato, grupo: grupoMundial } = mundialElegido;

  return {
    tipo: 'vigente',
    ambito,
    seasonLabel: vigentes.seasonLabel ?? vigente ?? '',
    temporadas: ordenarTemporadas(vigente, historicas),
    vigente,
    filtro,
    nacional,
    grupoInicial: groupKey(grupoInicial),
    mios,
    conMiFicha: puestosVigentes.length > 0 || fichasFie.size > 0,
    fichas: armarFichas({ atletas, fichasFie, puestosOficiales: puestosVigentes, personaDe, fieVigente }),
    mundial: { grupos: mundial.grupos },
    grupoMundial: grupoMundial
      ? { weapon: grupoMundial.weapon, gender: grupoMundial.gender, category: grupoMundial.category, format: formato }
      : null,
    primeraTablaMundial,
    europeo: { ...europeo, mios: [...new Set(Object.values(personaDe))] },
    sinFicha: atletas.length === 0,
    esPersonal: perfil.role === 'athlete',
  };
}

function ordenarTemporadas(vigente: string | null, historicas: string[]): string[] {
  return [...new Set([...(vigente ? [vigente] : []), ...historicas])].sort().reverse();
}

function armarFichas({
  atletas,
  fichasFie,
  puestosOficiales,
  personaDe,
  fieVigente,
}: {
  atletas: AthleteSummary[];
  fichasFie: Awaited<ReturnType<typeof getFichasFie>>;
  puestosOficiales: PuestoOficial[];
  personaDe: Record<string, string>;
  fieVigente: Record<string, MejorMundial[]>;
}): FichaPanel[] {
  return atletas
    .map((atleta) => {
      const ficha = fichasFie.get(atleta.id) ?? null;
      const suyos = puestosOficiales.filter((p) => p.athleteId === atleta.id);
      return {
        atleta,
        nacional: ladoNacional(suyos),
        mundial: ladoMundial(ficha),
        fie: fieVigente[atleta.id] ?? [],
      };
    })
    .filter((f) => f.nacional.variantes.length > 0 || f.mundial.variantes.length > 0 || f.fie.length > 0)
    .map(({ atleta, nacional, mundial, fie }) => ({
      athleteId: atleta.id,
      apellidos: atleta.lastName,
      nombre: atleta.firstName,
      personaId: personaDe[atleta.id] ?? null,
      lados: [ladoCompacto(nacional), conClasificacionFie(ladoCompacto(mundial), fie)],
    }));
}

async function gruposDePersonas(personaDe: Record<string, string>): Promise<Record<string, string[]>> {
  const pares = await Promise.all(Object.entries(personaDe).map(async ([atleta, persona]) => {
    const grupo = await resolverPersona(db, persona).catch(() => null);
    return [atleta, grupo?.ids ?? [persona]] as const;
  }));
  return Object.fromEntries(pares);
}

async function clasificacionFieDeAtletas(grupos: Record<string, string[]>): Promise<Record<string, MejorMundial[]>> {
  const pares = await Promise.all(Object.entries(grupos).map(async ([atleta, ids]) =>
    [atleta, (await leerResumenMundial(db, ids)).actuales ?? []] as const));
  return Object.fromEntries(pares);
}

async function completarPuestosOficiales(
  atletas: AthleteSummary[],
  puestos: PuestoOficial[],
  grupos: Record<string, string[]>,
): Promise<PuestoOficial[]> {
  const sinPuesto = atletas.filter((a) => grupos[a.id] && !puestos.some((p) => p.athleteId === a.id));
  const extra = await Promise.all(sinPuesto.map(async (a) =>
    (await leerPuestosOficialesVigentes(db, grupos[a.id])).map((f): PuestoOficial => ({
      athleteId: a.id,
      seasonLabel: f.temporada,
      weapon: f.arma as PuestoOficial['weapon'],
      gender: f.genero as PuestoOficial['gender'],
      category: f.categoria,
      categoryRaw: f.categoriaRaw,
      position: f.puesto === null ? null : Number(f.puesto),
      totalPoints: f.puntos === null ? null : Number.parseFloat(f.puntos),
      club: f.club,
      deCuantos: f.clasificados,
      actualizadoEl: new Date(Number(f.lectura ?? 0)),
      sourceUrl: f.url,
    }))));
  return [...puestos, ...extra.flat()];
}
