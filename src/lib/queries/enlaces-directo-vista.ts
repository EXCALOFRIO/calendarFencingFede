import {
  esEnlaceDeResultados,
  esPortada,
  mejorEnlace,
  normalizarUrlDirecto,
  proveedorDeUrl,
  type EnlaceDirecto,
} from '@/lib/calendario/enlaces-directo';

export type FilaEnlaceDirecto = {
  eventId: string;
  eventCompetitionId: string | null;
  kind: string;
  url: string;
  /** La tarjeta en la que se pinta (la canónica si el evento está absorbido). */
  tarjetaId: string;
};

export type PruebaParaEnlace = { id: string; eventId: string; clave: string };

/**
 * Reparte los enlaces de directo entre tarjetas y pruebas.
 *
 * Un enlace de prueba se cuelga por la CLAVE de la prueba (arma, género,
 * categoría, modalidad) y no por su id, porque la tarjeta puede estar
 * enseñando la prueba española equivalente a la de la FIE que lo trajo. Un
 * enlace sin prueba de un registro absorbido con una sola prueba —la FIE
 * publica un evento por prueba— es de esa prueba; uno sin prueba del propio
 * evento es del torneo entero.
 */
export function atribuirEnlacesDirecto({
  enlaces,
  pruebas,
}: {
  enlaces: readonly FilaEnlaceDirecto[];
  pruebas: readonly PruebaParaEnlace[];
}): {
  porTarjeta: Map<string, EnlaceDirecto>;
  porPrueba: Map<string, EnlaceDirecto>;
} {
  const clavePorId = new Map(pruebas.map((p) => [p.id, p.clave] as const));
  const pruebasPorEvento = new Map<string, string[]>();
  for (const p of pruebas) {
    const lista = pruebasPorEvento.get(p.eventId) ?? [];
    lista.push(p.clave);
    pruebasPorEvento.set(p.eventId, lista);
  }

  // Una fila sin prueba cuya URL ya tiene ese evento con prueba es la copia
  // antigua del enlace de esa prueba, no un enlace del torneo.
  const conPrueba = new Set<string>();
  for (const l of enlaces) {
    if (!l.eventCompetitionId) continue;
    const url = normalizarUrlDirecto(l.url);
    if (url) conPrueba.add(`${l.eventId}|${url}`);
  }

  const deTarjeta = new Map<string, { enlace: EnlaceDirecto; propio: boolean }[]>();
  const dePrueba = new Map<string, { enlace: EnlaceDirecto; propio: boolean }[]>();
  for (const l of enlaces) {
    if (!esEnlaceDeResultados(l.kind)) continue;
    const url = normalizarUrlDirecto(l.url);
    if (!url || esPortada(url)) continue;
    if (!l.eventCompetitionId && conPrueba.has(`${l.eventId}|${url}`)) continue;
    const enlace = { url, proveedor: proveedorDeUrl(url) };
    const propio = l.eventId === l.tarjetaId;
    let clave = l.eventCompetitionId ? (clavePorId.get(l.eventCompetitionId) ?? null) : null;
    if (!clave && !l.eventCompetitionId && !propio) {
      const delEvento = pruebasPorEvento.get(l.eventId) ?? [];
      if (delEvento.length === 1) clave = delEvento[0];
    }
    if (l.eventCompetitionId && !clave) continue;
    const destino = clave ? `${l.tarjetaId}|${clave}` : l.tarjetaId;
    const mapa = clave ? dePrueba : deTarjeta;
    const lista = mapa.get(destino) ?? [];
    lista.push({ enlace, propio });
    mapa.set(destino, lista);
  }

  const elegir = (lista: { enlace: EnlaceDirecto; propio: boolean }[]) => {
    const propios = lista.filter((x) => x.propio);
    return mejorEnlace((propios.length > 0 ? propios : lista).map((x) => x.enlace));
  };
  const porTarjeta = new Map<string, EnlaceDirecto>();
  for (const [k, lista] of deTarjeta) {
    const e = elegir(lista);
    if (e) porTarjeta.set(k, e);
  }
  const porPrueba = new Map<string, EnlaceDirecto>();
  for (const [k, lista] of dePrueba) {
    const e = elegir(lista);
    if (e) porPrueba.set(k, e);
  }
  return { porTarjeta, porPrueba };
}
