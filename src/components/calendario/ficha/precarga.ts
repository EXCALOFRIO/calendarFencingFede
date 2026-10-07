import { fichaDelEvento, type FichaDelEvento } from '@/app/(app)/detalle-evento';
import { torneoTerminado } from './terminado';

/**
 * Lo que pide la ficha de un torneo (detalle, quién va y podios), guardado en
 * el navegador por torneo durante un minuto.
 *
 * Se pide al mostrar intención de abrir la ficha —el puntero se para en la
 * tarjeta, se toca o se enfoca— y al abrirla se reutiliza lo pedido, así que
 * casi siempre se abre ya completa. Es una sola acción por torneo: Next las
 * despacha de una en una y precargar varias por separado retrasaría la que de
 * verdad se abre.
 */

const VIGENCIA_MS = 60_000;
const MAXIMO = 40;

type Entrada = {
  creada: number;
  conPodios: boolean;
  promesa: Promise<FichaDelEvento>;
  valor?: FichaDelEvento;
};

const fichas = new Map<string, Entrada>();

function vigente(e: Entrada | undefined, conPodios: boolean): e is Entrada {
  return Boolean(e && Date.now() - e.creada < VIGENCIA_MS && (e.conPodios || !conPodios));
}

/** La ficha de un torneo; los podios sólo si ya se ha tirado. */
export function leerFicha(evento: { id: string; endDate: string }): Promise<FichaDelEvento> {
  return pedirFicha(evento.id, torneoTerminado(evento));
}

export function pedirFicha(eventoId: string, conPodios: boolean): Promise<FichaDelEvento> {
  const ya = fichas.get(eventoId);
  if (vigente(ya, conPodios)) return ya.promesa;
  const entrada: Entrada = {
    creada: Date.now(),
    conPodios,
    // Dentro de un `then`: si la acción no existe (pruebas) o lanza, es un rechazo, no una excepción.
    promesa: Promise.resolve().then(() => fichaDelEvento(eventoId, conPodios)),
  };
  entrada.promesa.then(
    (valor) => {
      entrada.valor = valor;
    },
    () => {
      // Un fallo no se recuerda: abrir otra vez la ficha vuelve a pedirla.
      if (fichas.get(eventoId) === entrada) fichas.delete(eventoId);
    },
  );
  fichas.delete(eventoId);
  fichas.set(eventoId, entrada);
  if (fichas.size > MAXIMO) fichas.delete(fichas.keys().next().value as string);
  return entrada.promesa;
}

/** Lo ya recibido de este torneo, para abrir la ficha completa sin esperar. */
export function fichaRecibida(evento: { id: string; endDate: string }): FichaDelEvento | undefined {
  return fichaRecibidaDe(evento.id, torneoTerminado(evento));
}

export function fichaRecibidaDe(eventoId: string, conPodios: boolean): FichaDelEvento | undefined {
  const e = fichas.get(eventoId);
  return vigente(e, conPodios) ? e.valor : undefined;
}

/** Intención de abrir la ficha: se pide sin esperar la respuesta. */
export function precargarFicha(evento: { id: string; endDate: string }): void {
  leerFicha(evento).catch(() => {});
}
