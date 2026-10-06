/**
 * Lote 8c: estado de cada hueco RFEE de prioridad 1 «sin fuente» o «pendiente» tras la
 * búsqueda del lote 8c, y de los «fuente sin esos datos» que el lector de Engarde del lote
 * revisó. Junta lo que escribió `lote8c-engarde.ts` (su `_informe-lote8c-engarde.json`) con
 * las pruebas que no se celebraron o no existen como prueba propia, cada una con su evidencia.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8c-huecos.ts [--salida <json>]
 *
 * No toca la red ni ninguna base: sólo lee el JSON de huecos, el informe del lector y escribe
 * `cobertura/lote8c-huecos.json`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_TRABAJO } from './comun';
import { leerHuecos, type Hueco } from './lote8c-engarde';
import { HECHOS_LOTE8C } from './lote8c-red';

export type Estado = 'recuperado' | 'recuperado_parcial' | 'sin_fuente' | 'descartado' | 'fuente_sin_esos_datos' | 'no_escrito';
export type Veredicto = { estado: Estado; motivo: string; evidencia?: string[] };

const COMUNICADO_COVID = 'https://web.archive.org/web/20200422203801/https://www.esgrima.es/comunicado-sobre-el-coronavirus/';
const COMUNICADO_ABRIL = 'https://web.archive.org/web/20201020233936/https://www.esgrima.es/comunicado-de-la-rfee-sobre-las-pruebas-nacionales/';
const COMUNICADO_SEPT = 'https://web.archive.org/web/20201020223703/https://www.esgrima.es/decisiones-del-comite-nacional-tecnico-y-de-competicion/';
const CALENDARIO_2021 = 'https://web.archive.org/web/20210221063632/https://www.esgrima.es/calendario-nacional-de-actividades-2020-2021/';

/** Pruebas del catálogo que no se celebraron o no existen como prueba propia, con su evidencia. */
export const DESCARTES: { si: (h: Hueco) => boolean; v: Veredicto }[] = [
  {
    si: (h) => h.fecha >= '2020-03-14' && h.fecha <= '2020-06-30',
    v: {
      estado: 'descartado',
      motivo: 'No se celebró: la RFEE suspendió o aplazó los TNR de marzo de 2020 por la COVID-19 y el 8/4/2020 suspendió los TNR individuales pendientes de la temporada 2019-20',
      evidencia: [COMUNICADO_COVID, COMUNICADO_ABRIL],
    },
  },
  {
    si: (h) => h.fecha >= '2020-10-01' && h.fecha <= '2020-12-31' && /LIGA NACIONAL DE CLUBES/i.test(h.nombre),
    v: {
      estado: 'descartado',
      motivo: 'No se celebró en esa fecha: la RFEE aplazó las jornadas de otoño de 2020 de la Liga Nacional de Clubes; la liga 2020-21 se disputó en marzo-mayo de 2021 (Tres Cantos, Rivas, Amposta), recuperadas en este lote',
      evidencia: [COMUNICADO_SEPT, CALENDARIO_2021],
    },
  },
  {
    si: (h) => h.fecha === '2023-09-01' && /LIGA NACIONAL DE CLUBES/i.test(h.nombre) && h.formato === 'INDIVIDUAL',
    v: { estado: 'descartado', motivo: 'Fila genérica del catálogo (fecha de inicio de temporada, modalidad individual) para la Liga Nacional de Clubes 2023-24, que es por equipos y tiene sus jornadas en otras filas; no es una prueba' },
  },
  {
    si: (h) => h.fecha === '2023-06-04' && /CAMPEONATO DE ESPA/i.test(h.nombre) && h.arma === 'FLORETE' && h.genero === 'F',
    v: {
      estado: 'descartado',
      motivo: 'El Campeonato de España absoluto de florete femenino 2023 no se disputó el 4/6: se celebró el 13-14/10/2023 en Medina del Campo y ya está en la base (Skermo RFEE:7756 individual y PDF de la RFEE por equipos)',
      evidencia: ['https://engarde-service.com/tournament/fecyl/ce_ff_medina23'],
    },
  },
  {
    si: (h) => h.fecha === '2021-06-26' && h.arma === 'FLORETE' && h.genero === 'F' && h.categoria === 'VET',
    v: { estado: 'descartado', motivo: 'El Campeonato de España de veteranos 2021 no tuvo florete femenino: Engarde publica 12 pruebas (EF40, EF50, SF40, SF50, EM40-60, FM40-50, SM40-60)', evidencia: ['https://engarde-service.com/tournament/rfee/ctoesp_vet2021'] },
  },
  {
    si: (h) => (h.fecha === '2018-10-20' && h.arma === 'SABLE') || (h.fecha === '2019-04-27' && h.arma === 'FLORETE' && h.formato === 'EQUIPOS'),
    v: {
      estado: 'sin_fuente',
      motivo: 'El PDF que Skermo enlaza en esta fila es el de la prueba individual (ya cargada); la prueba por equipos no tiene documento publicado (en Engarde, rfee/190427tnr17florete/ff17eq existe sin datos)',
      evidencia: ['https://app.skermo.org/client/1/b4341d6cdb000a7847715e09489ed368.pdf', 'https://app.skermo.org/client/1/020d410eb63a2be35fcb887902ef9aeb.pdf'],
    },
  },
  {
    si: (h) => /SILLA/i.test(h.nombre) && h.genero === 'F',
    v: {
      estado: 'descartado',
      motivo: 'Sin prueba femenina propia: las pruebas de silla de ruedas se publican sólo masculinas o mixtas (Engarde rfee/sr_madrid, sr_vigo, rsss, sr_to, vigo, sr_ss; fecyl/ce_sr25, 2ce_sr_2024; esgrimavigo/sr_26_vigo) y Skermo lista la categoría femenina sin documento',
    },
  },
  {
    si: (h) => /SILLA/i.test(h.nombre) && h.genero === 'M' && h.arma === 'FLORETE' && ['2025-06-14', '2025-11-29'].includes(h.fecha),
    v: { estado: 'descartado', motivo: 'Esa prueba de silla de ruedas no tuvo florete: Engarde publica sólo espada y sable (rfee/rsss, rfee/sr_to)' },
  },
];

const BUSCADO_LOTE8C = [
  'Engarde: listas de los 738 organizadores de getOrganism.php (torneos desde 2021-08) y listas históricas de los organizadores españoles, con los nuevos (cev-m, sav-v, crcalatrava, cecvi, cdf-ss, sagu, f_vasca_esgrima...)',
  'Engarde: listas en vivo de rfee, fme, fecyl, fce y clubesgrimalcobendas el 2026-10-06',
  'Wayback Machine: CDX de las exportaciones estáticas files/fce/tnrfabs2018 y files/rfee/1904*, noticias de esgrima.es 2020-2021',
  'Ophardt Online no se consultó: su robots.txt prohíbe todo (Disallow: /); FencingTimeLive excluido por pedir sesión',
];

type Lectura = { prueba: string; url?: string; motivo: string; fichero?: string; engarde?: { resultados: number; poules: number; cuadro: number }; equivalentes?: string[] };

/** Veredicto de un hueco a partir de las lecturas del lector de Engarde del lote 8c. */
export function veredictoEngarde(h: Pick<Hueco, 'faltan'>, lecturas: readonly Lectura[]): Veredicto | null {
  if (lecturas.length === 0) return null;
  const escritas = lecturas.filter((l) => l.motivo.startsWith('escrita'));
  if (escritas.length > 0) {
    const aporta = new Set<string>();
    for (const l of escritas) {
      if ((l.engarde?.resultados ?? 0) > 0) aporta.add('clasificacion');
      if ((l.engarde?.poules ?? 0) > 0) aporta.add('poules');
      if ((l.engarde?.cuadro ?? 0) > 0) aporta.add('cuadro');
    }
    const quedan = h.faltan.filter((f) => !aporta.has(f));
    return {
      estado: quedan.length === 0 ? 'recuperado' : 'recuperado_parcial',
      motivo: `${escritas.map((l) => `${l.prueba} (${l.engarde?.resultados ?? 0} puestos, ${l.engarde?.poules ?? 0} asaltos de poule, ${l.engarde?.cuadro ?? 0} de cuadro)`).join('; ')}${quedan.length ? `; la fuente no publica: ${quedan.join(', ')}` : ''}`,
      evidencia: escritas.map((l) => l.fichero ?? '').filter(Boolean),
    };
  }
  if (lecturas.some((l) => l.motivo === 'ya_cubierta')) {
    const l = lecturas.find((x) => x.motivo === 'ya_cubierta')!;
    return { estado: 'descartado', motivo: `Sin prueba propia: la categoría se disputó dentro de ${l.prueba}, ya cargada (${(l.equivalentes ?? []).slice(0, 2).join(', ')})` };
  }
  const sinFusion = lecturas.filter((l) => l.motivo.startsWith('fase_falta') || l.motivo === 'clasificacion_discrepa_de_la_oficial');
  if (sinFusion.length > 0) {
    return {
      estado: 'no_escrito',
      motivo: `Engarde trae fases que faltan, pero no se escriben: ${sinFusion.map((l) => `${l.prueba} → ${l.motivo === 'clasificacion_discrepa_de_la_oficial' ? 'su clasificación no coincide con la oficial' : `ya existe la prueba en otra fuente (${(l.equivalentes ?? []).slice(0, 2).join(', ')}) y no hay fusión segura`}`).join('; ')}`,
    };
  }
  if (lecturas.some((l) => l.motivo === 'fuente_sin_esos_datos')) {
    return { estado: 'fuente_sin_esos_datos', motivo: `Engarde publica ${lecturas.map((l) => `${l.prueba} (${l.engarde?.resultados ?? 0}/${l.engarde?.poules ?? 0}/${l.engarde?.cuadro ?? 0})`).join('; ')} sin las fases que faltan` };
  }
  return { estado: 'sin_fuente', motivo: `Engarde: ${lecturas.map((l) => `${l.prueba} → ${l.motivo}`).join('; ')}` };
}

function main(): void {
  const salida = argumento('salida', join(CARPETA_TRABAJO, 'cobertura', 'lote8c-huecos.json'));
  const huecos = leerHuecos();
  const ruta = join(HECHOS_LOTE8C('engarde'), '_informe-lote8c-engarde.json');
  const informe = existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as { huecos: { id: string; lecturas: Lectura[] }[] }) : { huecos: [] };
  const lecturas = new Map(informe.huecos.map((x) => [x.id, x.lecturas]));
  const filas = huecos
    .filter((h) => h.estadoBusqueda !== 'fuente_sin_datos' || lecturas.has(h.id))
    .map((h) => {
      const d = DESCARTES.find((x) => x.si(h))?.v;
      const e = veredictoEngarde(h, lecturas.get(h.id) ?? []);
      // Lo recuperado manda; si no, la evidencia de que la prueba no existe; si no, lo que dijo Engarde.
      const v: Veredicto = e && e.estado.startsWith('recuperado') ? e : d ?? e ?? {
        estado: h.estadoBusqueda === 'fuente_sin_datos' ? 'fuente_sin_esos_datos' : 'sin_fuente',
        motivo: /FENCING FOR EVERYONE/i.test(h.nombre)
          ? 'Prueba del circuito europeo sub-23 «Fencing For Everyone» que no está en Engarde (ningún organizador); probablemente publicada en Ophardt o FencingTimeLive, que no se pueden consultar'
          : h.categoria === 'VET' && /VET(30|60|70)/.test(h.categoriaOriginal ?? '')
            ? 'Skermo lista la categoría sin documento y ninguna prueba de Engarde ni PDF tiene ese tramo; probablemente sin participantes'
            : 'Ningún documento publicado en los sitios mirados',
      };
      return {
        id: h.id, temporada: h.temporada, fecha: h.fecha, nombre: h.nombre, prueba: `${h.arma} ${h.genero} ${h.categoriaOriginal ?? h.categoria} ${h.formato}`,
        estadoAntes: h.estadoBusqueda, faltan: h.faltan, ...v,
        dondeSeBusco: v.estado === 'sin_fuente' ? BUSCADO_LOTE8C : undefined,
      };
    });
  const resumen: Record<string, Record<string, number>> = {};
  for (const f of filas) (resumen[f.estadoAntes] ??= {})[f.estado] = (resumen[f.estadoAntes][f.estado] ?? 0) + 1;
  writeFileSync(salida, `${JSON.stringify({ generado: new Date().toISOString(), resumen, huecos: filas }, null, 1)}\n`);
  console.log(JSON.stringify(resumen, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
