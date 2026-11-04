/**
 * La cabecera `Link` de precargas en documentos que no pueden usarla.
 *
 * Al renderizar una página, React junta las pistas de recursos (las fuentes
 * de `next/font` y el CSS del árbol de la ruta) y Next las envía como
 * `Link: <…>; rel=preload`. Cuando la pantalla hace `redirect()` —cada
 * visita sin sesión a cualquier ruta de la aplicación— la respuesta es un
 * documento mínimo (`__next_error__`) sin hojas de estilo ni texto: esas
 * precargas quedan sin consumir («the resource was preloaded but not used»
 * en la consola) y son una descarga desperdiciada.
 *
 * En un 3xx no aportan nada: el documento de destino manda su propio `Link`
 * con lo que él sí usa. Aquí se quita la cabecera entera; el resto de
 * respuestas pasa igual.
 */
export function conLinkSoloEnPaginas<E, C>(
  servir: (peticion: Request, entorno: E, contexto: C) => Promise<Response>,
) {
  return async (peticion: Request, entorno: E, contexto: C): Promise<Response> => {
    const respuesta = await servir(peticion, entorno, contexto);
    if (respuesta.status < 300 || respuesta.status >= 400 || !respuesta.headers.has('Link')) {
      return respuesta;
    }
    const cabeceras = new Headers(respuesta.headers);
    cabeceras.delete('Link');
    return new Response(respuesta.body, {
      status: respuesta.status,
      statusText: respuesta.statusText,
      headers: cabeceras,
    });
  };
}
