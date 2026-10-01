import 'dotenv/config';
import { leerPruebaFie, type ParteAsaltos } from '../src/lib/ingest/sources/fie-resultados';

/**
 * Resultados FIE de UNA prueba, por `(temporada, competitionId)`:
 *
 *   npm run fie-resultados -- 2027 1478            -> lectura y resumen, no escribe
 *   npm run fie-resultados -- 2027 1478 --aplicar  -> además guarda en la base
 *
 * Sin `--aplicar` sólo se hacen GET públicos y se imprime un resumen con
 * recuentos, sin nombres. `--aplicar` exige las migraciones 0017/0018
 * aplicadas por el propietario; si no lo están, no escribe nada.
 */

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const [season, competitionId] = args.filter((a) => !a.startsWith('--')).map(Number);

if (!Number.isInteger(season) || !Number.isInteger(competitionId)) {
  console.error('Uso: npm run fie-resultados -- <temporada> <competitionId> [--aplicar]');
  process.exit(1);
}

function lineaAsaltos(nombre: string, p: ParteAsaltos | null): string {
  if (!p) return `  ${nombre}: no se piden`;
  const motivos = Object.entries(p.excluidos)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  return (
    `  ${nombre}: ${p.cobertura.estado} grupos=${p.grupos} publicados=${p.cobertura.publicado ?? '-'} ` +
    `asaltos=${p.asaltos.length}${motivos ? ` excluidos[${motivos}]` : ''}` +
    (p.cobertura.error ? ` error=${p.cobertura.error}` : '')
  );
}

const lectura = await leerPruebaFie(season, competitionId);
console.log(`FIE ${season}/${competitionId}`);
if (!lectura.prueba) {
  console.log(`  prueba: error ${lectura.errorPrueba}`);
} else {
  const p = lectura.prueba;
  console.log(`  prueba: ${p.arma} ${p.genero} ${p.categoria} ${p.formato} fecha=${p.fecha}`);
  if (lectura.ranking) {
    const r = lectura.ranking;
    console.log(
      `  ranking: ${r.cobertura.estado} publicado=${r.cobertura.publicado ?? '-'} ` +
        `leidos=${r.puestos.length} paginas=${r.paginasLeidas}` +
        (r.cobertura.error ? ` error=${r.cobertura.error}` : ''),
    );
  }
  console.log(lineaAsaltos('poules', lectura.poules));
  console.log(lineaAsaltos('cuadro', lectura.cuadro));
}

if (!aplicar) {
  console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar.');
} else {
  const { db } = await import('../src/db');
  const { crearDepsPersistenciaFieDb } = await import('../src/lib/ingest/fie-resultados-db');
  const { persistirLecturaFie } = await import('../src/lib/ingest/fie-resultados-persist');
  const r = await persistirLecturaFie(crearDepsPersistenciaFieDb(db), lectura);
  if (r.estado === 'esquema_no_aplicado') {
    console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
    process.exitCode = 2;
  } else {
    console.log(
      `  guardado: puestos ${JSON.stringify(r.puestos)} poules ${JSON.stringify(r.poules)} ` +
        `cuadro ${JSON.stringify(r.cuadro)} personas ${JSON.stringify(r.personas)}`,
    );
  }
}
