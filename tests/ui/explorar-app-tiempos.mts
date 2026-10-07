/**
 * Tiempo de servidor y número de consultas de cada pantalla de Explorar, con
 * los mismos cargadores que sus páginas y la copia de producción.
 *
 *   PERF_DB=<copia SQLite de D1> npx tsx tests/ui/explorar-app-tiempos.mts [salida.json]
 *
 * Cada pantalla se calienta una vez y se mide `REPETICIONES` veces; se da la
 * mediana. Las consultas son las sentencias que llegan a la base en una carga.
 */
import { writeFileSync } from 'node:fs';
import { cargarConteoSiguiendo, cargarSiguiendo, leerPropuestasParaSeguir } from '@/lib/sport/explorar/siguiendo-pantalla';
import { cargarExplorar } from '@/lib/sport/explorar/pantalla';
import { cargarFavoritos } from '@/lib/sport/explorar/favoritos-pantalla';
import { sugerirPersonas } from '@/lib/sport/explorar/sugerencias';
import { CRITERIOS_VACIOS } from '@/lib/sport/explorar/url';
import { contador, contexto, ctx, ctxMuchas, ctxNueva, seguidasDe, CUENTA, CUENTA_MUCHAS, type Ctx } from './_explorar-base.mts';

const REPETICIONES = Number(process.env.REPETICIONES ?? 5);

type Pantalla = { nombre: string; cargar: () => Promise<unknown> };

// Sin el módulo (código de antes) se miden las pantallas de antes.
const nuevas: Partial<typeof import('@/lib/sport/explorar/inicio-pantalla')> =
  await import('@/lib/sport/explorar/inicio-pantalla').catch(() => ({}));

function pantallas(): Pantalla[] {
  const lista: Pantalla[] = [];
  const conCuentas = (nombre: string, f: (c: Ctx) => Promise<unknown>) => {
    lista.push({ nombre: `${nombre} · 4 seguidas`, cargar: () => f(ctx) });
    lista.push({ nombre: `${nombre} · ${seguidasDe(CUENTA_MUCHAS)} seguidas`, cargar: () => f(ctxMuchas) });
    lista.push({ nombre: `${nombre} · 0 seguidas`, cargar: () => f(ctxNueva) });
  };
  if (nuevas.cargarInicio && nuevas.cargarListaSiguiendo) {
    const { cargarInicio, cargarListaSiguiendo } = nuevas;
    conCuentas('Inicio (feed)', (c) => cargarInicio(c, {}));
    conCuentas('Siguiendo (lista)', (c) => cargarListaSiguiendo(c, undefined));
    lista.push({ nombre: 'Buscar (sin texto, sugerencias recordadas)', cargar: () => nuevas.cargarBuscarVacio!(ctx) });
    // Una base nueva en cada carga: las sugerencias se leen siempre (primera visita del isolate).
    lista.push({ nombre: 'Buscar (sin texto, en frío)', cargar: () => nuevas.cargarBuscarVacio!(contexto(CUENTA)) });
    lista.push({
      nombre: 'Buscar «alejandro» (lista completa)',
      cargar: () => cargarExplorar(ctx, { ...CRITERIOS_VACIOS, q: 'alejandro' }, undefined),
    });
  } else {
    // Pantallas de antes: Explorar vacío con propuestas, el feed en /siguiendo y Favoritos.
    lista.push({
      nombre: 'Explorar vacío (antes la portada)',
      cargar: () => Promise.all([cargarExplorar(ctx, CRITERIOS_VACIOS, undefined), cargarConteoSiguiendo(ctx), leerPropuestasParaSeguir(ctx)]),
    });
    conCuentas('Siguiendo (feed)', (c) => Promise.all([cargarSiguiendo(c, {}), cargarConteoSiguiendo(c)]));
    conCuentas('Favoritos (lista)', (c) => cargarFavoritos(c, undefined));
    lista.push({
      nombre: 'Buscar «alejandro» (lista completa)',
      cargar: () => Promise.all([cargarExplorar(ctx, { ...CRITERIOS_VACIOS, q: 'alejandro' }, undefined), cargarConteoSiguiendo(ctx)]),
    });
  }
  lista.push({ nombre: 'Sugerencias en vivo «zabal»', cargar: () => sugerirPersonas(ctx, { q: 'zabal' }) });
  return lista;
}

const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const resultados: { pantalla: string; ms: number; consultas: number }[] = [];
for (const p of pantallas()) {
  await p.cargar();
  const tiempos: number[] = [];
  let consultas = 0;
  for (let i = 0; i < REPETICIONES; i++) {
    const antes = contador.sentencias;
    const t = performance.now();
    await p.cargar();
    tiempos.push(performance.now() - t);
    consultas = contador.sentencias - antes;
  }
  resultados.push({ pantalla: p.nombre, ms: Math.round(mediana(tiempos) * 10) / 10, consultas });
  console.log(`${p.nombre.padEnd(44)} ${String(Math.round(mediana(tiempos))).padStart(6)} ms  ${String(consultas).padStart(3)} consultas`);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(resultados, null, 2));
