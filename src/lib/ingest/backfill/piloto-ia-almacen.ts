import fs from 'node:fs';
import path from 'node:path';
import { type AlmacenPiloto, type EstadoPiloto, type ModoPiloto, estadoVacio } from './piloto-ia';

/**
 * Libro persistente del piloto en disco (sólo CLI/local, no Worker).
 *
 * Un libro por modo: la simulación jamás comparte fichero con el real, así que
 * una simulación no puede gastar ni liberar presupuesto real. Un libro ilegible
 * lanza en vez de empezar de cero: reiniciar el contador permitiría gastar otra
 * vez el tope.
 */

export const DIRECTORIO_PILOTO_IA = '.piloto-ia';

export const rutaLibro = (modo: ModoPiloto, base: string = DIRECTORIO_PILOTO_IA): string => path.join(base, `libro-${modo}.json`);

function leerLibro(ruta: string, modo: ModoPiloto): EstadoPiloto {
  if (!fs.existsSync(ruta)) return estadoVacio(modo);
  const bruto: unknown = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const e = bruto as Partial<EstadoPiloto> | null;
  if (!e || e.version !== 1 || e.modo !== modo || !Array.isArray(e.entradas) || !Array.isArray(e.bloqueos)) {
    throw new Error(`Libro del piloto ilegible o de otro modo: ${ruta}`);
  }
  return e as EstadoPiloto;
}

export function crearAlmacenFichero(modo: ModoPiloto, base: string = DIRECTORIO_PILOTO_IA): AlmacenPiloto & { leer(): EstadoPiloto } {
  const ruta = rutaLibro(modo, base);
  let cola: Promise<unknown> = Promise.resolve();
  return {
    modo,
    leer: () => leerLibro(ruta, modo),
    transaccion<T>(fn: (e: EstadoPiloto) => T): Promise<T> {
      const paso = cola.then(() => {
        const estado = leerLibro(ruta, modo);
        const valor = fn(estado);
        fs.mkdirSync(path.dirname(ruta), { recursive: true });
        const temporal = `${ruta}.tmp`;
        fs.writeFileSync(temporal, JSON.stringify(estado, null, 2));
        fs.renameSync(temporal, ruta);
        return valor;
      });
      cola = paso.catch(() => undefined);
      return paso;
    },
  };
}
