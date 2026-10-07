import { construirUrlCalendario } from '@/lib/calendario/contexto-url';
import { formatDateRangeEs, formatDateTimeEs } from '@/lib/utils';
import type { AvisoNuevo } from './agrupar';
import { nombrePrueba, recortar } from './textos';
import { PREFERENCIAS_POR_DEFECTO, type Preferencias } from './tipos';

/**
 * Avisos de «tu calendario»: competiciones nuevas y cierres de inscripción
 * próximos, filtrados como el feed iCal «todo» (armas, género y categorías
 * de los tiradores de la cuenta; si no se sabe un criterio, no se filtra por
 * él). Puro: el cron le pasa los eventos de `listEvents`.
 */

export const DIAS_AVISO_PLAZO = 3;
/** Ventana de «competición nueva»: un poco más de un día para que una pasada fallida no se la salte. */
export const HORAS_NUEVA = 36;
/** Una fuente que se estrena con cien torneos no debe llegar como cien avisos. */
export const MAX_NUEVAS_POR_PERFIL = 8;

export type CriteriosCalendario = {
  profileId: string;
  armas: ReadonlySet<string> | null;
  generos: ReadonlySet<string> | null;
  categorias: ReadonlySet<string> | null;
};

export type PlazoCalendario = { type: string; label: string; deadlineAt: Date; blocking: boolean };

export type EventoCalendario = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  city: string | null;
  competitions: { weapon: string; gender: string; category: string; format: string; deadlines: PlazoCalendario[] }[];
};

export function encaja(c: CriteriosCalendario, p: EventoCalendario['competitions'][number]): boolean {
  return (!c.armas || c.armas.has(p.weapon))
    && (!c.generos || p.gender === 'MIXTO' || c.generos.has(p.gender))
    && (!c.categorias || c.categorias.has(p.category));
}

function pruebasTexto(pruebas: readonly EventoCalendario['competitions'][number][]): string {
  const nombres = [...new Set(pruebas.map((p) => nombrePrueba({ arma: p.weapon, genero: p.gender, categoria: p.category, formato: p.format })))];
  const vistas = nombres.slice(0, 3);
  return nombres.length > vistas.length ? `${vistas.join(', ')} y ${nombres.length - vistas.length} más` : vistas.join(', ');
}

function urlEvento(e: EventoCalendario): string {
  return construirUrlCalendario({ mes: e.startDate.slice(0, 7), busqueda: e.name });
}

export function construirAvisosCalendario(
  perfiles: readonly CriteriosCalendario[],
  eventos: readonly EventoCalendario[],
  nuevos: ReadonlySet<string>,
  ahora: Date,
  preferencias: ReadonlyMap<string, Preferencias>,
): AvisoNuevo[] {
  const hoy = ahora.toISOString().slice(0, 10);
  const limite = ahora.getTime() + DIAS_AVISO_PLAZO * 86_400_000;
  const avisos: AvisoNuevo[] = [];
  for (const perfil of perfiles) {
    if (!(preferencias.get(perfil.profileId) ?? PREFERENCIAS_POR_DEFECTO)['tipo:calendario']) continue;
    let nuevas = 0;
    for (const e of eventos) {
      const suyas = e.competitions.filter((p) => encaja(perfil, p));
      if (suyas.length === 0) continue;
      const fechas = formatDateRangeEs(e.startDate, e.endDate);
      const lugar = e.city ? ` · ${e.city}` : '';

      if (nuevos.has(e.id) && e.endDate >= hoy && nuevas < MAX_NUEVAS_POR_PERFIL) {
        nuevas++;
        avisos.push({
          profileId: perfil.profileId,
          tipo: 'calendario',
          clave: `nueva:${e.id}`,
          grupo: `evento:${e.id}`,
          titulo: recortar(`Nueva competición: ${e.name}`, 200),
          cuerpo: recortar(`${fechas}${lugar}. ${pruebasTexto(suyas)}`, 1000),
          url: urlEvento(e),
          datos: { contexto: recortar(e.name, 200), detalles: [recortar(pruebasTexto(suyas), 200)] },
        });
      }

      // El hito que importa es el cierre ordinario o, si vence antes, uno bloqueante (como el correo del cron).
      const proximo = suyas
        .flatMap((p) => p.deadlines.map((d) => ({ d, p })))
        .filter(({ d }) => (d.type === 'L1' || d.blocking) && d.deadlineAt.getTime() > ahora.getTime() && d.deadlineAt.getTime() <= limite)
        .sort((a, b) => a.d.deadlineAt.getTime() - b.d.deadlineAt.getTime())[0];
      if (!proximo) continue;
      const dias = Math.max(1, Math.ceil((proximo.d.deadlineAt.getTime() - ahora.getTime()) / 86_400_000));
      const delMismoCierre = suyas.filter((p) => p.deadlines.some((d) => d.type === proximo.d.type && d.deadlineAt.getTime() === proximo.d.deadlineAt.getTime()));
      avisos.push({
        profileId: perfil.profileId,
        tipo: 'calendario',
        clave: `plazo:${e.id}:${proximo.d.type}:${proximo.d.deadlineAt.toISOString().slice(0, 10)}`,
        grupo: `evento:${e.id}`,
        titulo: recortar(`Cierra la inscripción en ${dias} ${dias === 1 ? 'día' : 'días'}: ${e.name}`, 200),
        cuerpo: recortar(`${proximo.d.label}: ${formatDateTimeEs(proximo.d.deadlineAt)}. ${pruebasTexto(delMismoCierre)}`, 1000),
        url: urlEvento(e),
        datos: { contexto: recortar(e.name, 200), detalles: [recortar(pruebasTexto(delMismoCierre), 200)] },
      });
    }
  }
  return avisos;
}
