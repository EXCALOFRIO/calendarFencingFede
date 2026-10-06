import type { AnotacionOlimpica } from '@/lib/ranking/olimpica';
import type { OlimpicaPerfil } from './olimpica-perfil';
import { ordenCategoriaVisible } from './presentacion';
import { esEspanol, type RankingAmbitos } from './ranking-ambitos';
import type { PuestoInternacional } from './ranking-internacional';
import type { RankingNacional, ResumenMundial } from './ranking-nacional';
import type { Arma, EntradaRankingOficial, Genero } from './tipos';

/**
 * Las dos filas de ranking de la cabecera de la ficha, en este orden:
 *
 *   1. Internacional (FIE), sólo si alguna vez ha tenido puesto.
 *   2. Nacional: la RFEE para un español (o sin país publicado); para un
 *      extranjero, su federación si se lee, y si no, nada.
 *
 * Cada una es la de la categoría más alta en la que figura la temporada
 * vigente (absoluto antes que M23, M20…; veteranos al final) y, dentro de
 * ella, el mejor puesto. Si no figura en la vigente (retirado, o fuera de la
 * lista este año), su mejor puesto de la carrera en la categoría más alta,
 * con la temporada.
 */

export type ChipRanking = {
  ambito: 'nacional' | 'internacional';
  /** Siglas del organismo que publica la lista (FIE, RFEE, FFE…). */
  organismo: string;
  puesto: number;
  arma: Arma;
  categoria: string;
  temporada: string;
  /** De la temporada vigente; si no, es el mejor de su carrera. */
  actual: boolean;
  /** Sólo en la internacional vigente absoluta: en zona de clasificación olímpica. */
  olimpica?: AnotacionOlimpica;
};

type Candidato = { puesto: number; arma: Arma; genero?: Genero; categoria: string; temporada: string; organismo?: string };

function mejorCandidato(lista: readonly Candidato[]): Candidato | null {
  return [...lista].sort((a, b) =>
    ordenCategoriaVisible(a.categoria) - ordenCategoriaVisible(b.categoria)
    || a.puesto - b.puesto
    || b.temporada.localeCompare(a.temporada)
    || a.arma.localeCompare(b.arma))[0] ?? null;
}

const dePuesto = (p: PuestoInternacional): Candidato[] =>
  p.puesto === null ? [] : [{ puesto: p.puesto, arma: p.arma, genero: p.genero, categoria: p.categoria, temporada: p.temporada, organismo: p.organismo }];

function chip(ambito: ChipRanking['ambito'], organismo: string, c: Candidato, actual: boolean): ChipRanking {
  return { ambito, organismo: c.organismo ?? organismo, puesto: c.puesto, arma: c.arma, categoria: c.categoria, temporada: c.temporada, actual };
}

export function chipsRanking({
  nacional,
  mundial,
  resumenMundial,
  ambitos,
  olimpica,
}: {
  nacional?: RankingNacional | null;
  mundial?: readonly EntradaRankingOficial[] | null;
  resumenMundial?: ResumenMundial | null;
  ambitos?: RankingAmbitos | null;
  olimpica?: readonly OlimpicaPerfil[] | null;
}): ChipRanking[] {
  const chips: ChipRanking[] = [];

  // La clasificación FIE vigente (la de /ranking) manda; si no está, la última
  // lista FIE guardada por temporada si es la vigente.
  const vigenteFie = resumenMundial?.vigente ?? null;
  const actualFie = mejorCandidato([
    ...(resumenMundial?.actuales ?? []).map((m) => ({ puesto: m.puesto, arma: m.arma, genero: m.genero, categoria: m.categoria, temporada: m.temporada })),
    ...(resumenMundial?.actuales?.length ? [] : (mundial ?? [])
      .filter((e) => e.puesto !== null && vigenteFie !== null && e.temporada === vigenteFie)
      .map((e) => ({ puesto: e.puesto!, arma: e.arma, genero: e.genero, categoria: e.categoria.codigo, temporada: e.temporada }))),
  ]);
  const carreraFie = actualFie ? null : mejorCandidato([
    ...(resumenMundial?.mejores ?? []).map((m) => ({ puesto: m.puesto, arma: m.arma, genero: m.genero, categoria: m.categoria, temporada: m.temporada })),
    ...(ambitos?.internacional?.mejores ?? []).flatMap(dePuesto),
  ]);
  if (actualFie) {
    const internacional = chip('internacional', 'FIE', actualFie, true);
    const marca = actualFie.categoria === 'ABS'
      ? olimpica?.find((o) => o.arma === actualFie.arma && o.genero === actualFie.genero)
      : undefined;
    chips.push(marca ? { ...internacional, olimpica: marca.anotacion } : internacional);
  } else if (carreraFie) {
    chips.push(chip('internacional', 'FIE', carreraFie, false));
  }

  if (ambitos && !esEspanol(ambitos.pais)) {
    const bloque = ambitos.nacionalFuera;
    if (bloque) {
      const actual = mejorCandidato(bloque.actual.flatMap(dePuesto));
      const carrera = actual ? null : mejorCandidato(bloque.mejores.flatMap(dePuesto));
      const elegido = actual ?? carrera;
      if (elegido) chips.push(chip('nacional', bloque.organismos[0] ?? '', elegido, actual !== null));
    }
  } else if (nacional) {
    const vigentes = nacional.vigente
      ? nacional.actuales.filter((l) => l.ultimo.temporada === nacional.vigente && l.ultimo.puesto !== null)
      : [];
    const actual = mejorCandidato(vigentes.map((l) => ({
      puesto: l.ultimo.puesto!, arma: l.arma, categoria: l.categoria, temporada: l.ultimo.temporada,
    })));
    const carrera = actual ? null : mejorCandidato(nacional.listas.flatMap((l) =>
      l.mejor?.puesto != null ? [{ puesto: l.mejor.puesto, arma: l.arma, categoria: l.categoria, temporada: l.mejor.temporada }] : []));
    const elegido = actual ?? carrera;
    if (elegido) chips.push(chip('nacional', 'RFEE', elegido, actual !== null));
  }

  return chips;
}
