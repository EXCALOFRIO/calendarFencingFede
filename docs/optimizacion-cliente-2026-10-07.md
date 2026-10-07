# Cliente: intención, fotos y búsqueda — 2026-10-07

## Qué se midió

Base `172a1d8`, componentes reales hidratados en Chromium aislado mediante
`tests/perf/opt-cliente.mts`. Sin sesión, base de datos, servicios remotos ni
build Next. El arnés usa adaptadores HTTP locales para Link/router y respuestas
sintéticas deterministas. Genera el marcado con React y después lo hidrata;
**no reproduce el SSR/RSC, las transiciones ni los estilos completos de Next**.
Las medidas de este documento no son tiempos de producción ni previsiones de coste.

Dos perfiles, misma CPU CDP ×4 y pantalla 390 ×844:

- Móvil: latencia 150 ms, descarga/subida 1,6 Mbps.
- Aeropuerto: 400 ms, 400 Kbps, `Save-Data: on` y conexión `2g`.

Secuencias: 20 enlaces tocados y cancelados como al desplazar (observación de
600 ms), 60 filas desplazadas cada 65 ms y luego quietas 3 s, escribir «turin»
y pulsar Intro antes del debounce, y escribir «turin» con 150 ms entre teclas.
El contador son peticiones que llegan al servidor local y bytes de sus cuerpos
JSON, sin cabeceras. En la red lenta sólo habían llegado 12 de las 20 precargas
al cerrar la ventana de observación. Los bytes de navegación llevan relleno
sintético de 4 KiB. Las fotos responden «no publicada»: se mide metadata, no JPG.

## Antes y después

Una pasada final comparable por perfil; no son percentiles.

| Medida | Móvil antes → después | Aeropuerto antes → después |
|---|---:|---:|
| Precargas por gestos cancelados | 20 → 0 | 12 → 0 |
| Bytes de esas precargas | 82.590 → 0 | 49.550 → 0 |
| Metadata de fotos: peticiones | 9 → 1 | 9 → 1 |
| Personas consultadas | 54 → 6 | 54 → 6 |
| Bytes de metadata | 2.213 → 247 | 2.213 → 247 |
| Buscar + Intro: peticiones | 2 → 1 | 2 → 1 |
| Buscar + Intro: bytes | 8.292 → 4.146 | 8.292 → 4.146 |
| Buscar + Intro hasta contenido | 332 → 292 ms | 616 → 583 ms |
| Cinco teclas a 150 ms: peticiones | 6 → 3 | 5 → 5 |
| Cinco teclas a 150 ms: bytes | 24.866 → 12.431 | 20.721 → 20.721 |
| Última tecla hasta contenido | 350 → 346 ms | 831 → 792 ms |
| Click táctil hasta destino | 99 → 284 ms | 105 → 541 ms |
| Carga del arnés hasta hidratación | 3.795 → 3.689 ms | 12.755 → 12.962 ms |

El click táctil **empeora en este caso**: antes la ruta elegida ya estaba entre
las rutas precargadas por gestos que no eran navegación. Ahora paga la ida y
vuelta de la única ruta solicitada. Es un intercambio explícito para no gastar
red/servidor por cada scroll, especialmente con Save-Data; ratón detenido y
teclado siguen precargando en redes normales.

No se ha demostrado acelerar la recarga: el bundle del arnés pasa de 568.664 a
569.250 bytes (+586); contiene también el renderizador SSR de React y no es el
bundle de la aplicación. Las pequeñas diferencias temporales son ruido de una
pasada. No se observaron tareas largas >50 ms en las interacciones antes ni
después. No hay base para prometer mejora de jank. Las cinco medidas
input→dos requestAnimationFrame después del cambio fueron 10,5–25,4 ms en móvil
y 12,3–29,3 ms en aeropuerto; no equivalen a INP.

## Cambios

- `src/components/sistema/red-cliente.ts`: política de ahorro para trabajo
  especulativo: sin red, Save-Data, 2G o slow-2g.
- `src/components/sistema/enlace-precarga.tsx`: ratón detenido 120 ms o foco
  `:focus-visible`; cancela al salir, desenfocar, cambiar destino o desmontar.
  Ni entrada del dedo ni pointerdown disparan precarga. Mantiene href, ref,
  callbacks del consumidor y el Link de Next.
- `src/components/enlace-intencion.tsx`: reutiliza esa única política.
- `src/components/nav.tsx`, `src/components/sistema/barra-inferior.tsx`,
  `src/components/notificaciones/campana-cliente.tsx`: adoptan el enlace común.
  No cambia ningún handler de click, memoria de pestañas, semántica de reset,
  destino, foto en «Tú» ni dimensiones táctiles.
- `src/components/calendario/vista.tsx`: fichas y pasos de mes dejan de
  precargar al iniciar un gesto táctil; misma política de ahorro y cancelación
  del hover. Abrir/cambiar de mes sigue siendo una acción explícita sin barrera.
- `src/components/explorar/foto-deportista.tsx`: el observador permanece vivo
  durante la espera y cancela si la fila sale de pantalla. Los tamaños
  no prioritarios esperan visibilidad; héroe/perfil conservan prioridad.
  Espera 350 ms normal, 700 ms con ahorro; margen 120/0 px respectivamente.
  Cola de metadata limitada a 2 solicitudes (1 con ahorro); imágenes secundarias
  con prioridad baja. Se conservan deduplicación, caché negativa, validación
  de foto oficial y recuperación de errores pasajeros.
- `src/components/explorar/buscador-competiciones.tsx`: navegación explícita
  cancela el debounce; deduplica URL en tránsito, y el efecto depende de
  criterios serializados, no de la identidad cambiante del objeto. Sigue
  esperando 150 ms y manteniendo el contenido anterior y la entrada controlada.
- `tests/navegacion-app.test.ts`: actualiza la aserción estructural que exigía
  precisamente precargar en pointerdown; comprueba la política compartida.

No se cambiaron CSS, animaciones, service worker, servidor, rutas, autenticación,
paquetes ni fotos de menores. No se añadieron esqueletos ni efectos de carga.
No se añadió ViewTransition: los escenarios medidos no justificaban más movimiento.

## Validaciones y límites

- `tsc --noEmit`: correcto en la comprobación independiente.
- 88 pruebas correctas en cinco suites: navegación-app (45), foto-vista (13),
  calendario-retorno (14), sugerencias-vista (5), enlaces-calendario (11).
- Arnés: scroll no precarga; las seis filas finales sí recuperan su lectura;
  Intro cancela el envío pendiente; consumidores concurrentes y caché negativa
  piden una vez; fallo offline seguido de reintento online vuelve a pedir;
  teclado navega aun con Save-Data; hover fugaz cancela y hover detenido sólo
  precarga con red normal. Todos los contextos se ejecutaron con reduced-motion.
- Atrás/reset y enlaces integrados: cubiertos por las suites de modelo/SSR.
  **No se validó la pila real del navegador Next ni las fichas del calendario
  hidratadas** en este arnés. Esas verificaciones corresponden a la aplicación.
- Reduced-motion: se comprobó la preferencia del navegador y no se cambió CSS;
  el arnés no permite afirmar validación visual de las transiciones reales.
- Las solicitudes de fotos compartidas que ya salieron no se abortan al
  desmontar una sola fila: podrían servir a otro consumidor. Se cancela la
  espera aún no enviada y se ignoran respuestas en componentes desmontados.
  Los límites de tiempo existentes siguen siendo 7/9 s. La recuperación
  comprobada es una nueva llamada/remontaje, no un reintento automático offline.
- La búsqueda social ya cancelaba solicitudes y mantenía resultados anteriores;
  no se modificó su solicitante de datos fuera del ámbito asignado.
- Los envíos a exactamente 150 ms de separación quedan en el límite del
  debounce y sus recuentos dependen del planificador; no se garantiza una
  petición única por palabra. No se modificaron las garantías de navegación
  obsoleta del router de Next.
- Un comando combinado posterior agotó su timeout después de producir ambos
  informes. Las cinco suites se volvieron a ejecutar directamente y pasaron.

## Reproducción y artefactos

Desde la raíz:

```powershell
node node_modules/tsx/dist/cli.mjs tests/perf/opt-cliente.mts antes 172a1d8
node node_modules/tsx/dist/cli.mjs tests/perf/opt-cliente.mts despues
node node_modules/vitest/vitest.mjs run tests/explorar-foto-vista.test.ts tests/navegacion-app.test.ts tests/enlaces-calendario.test.ts tests/calendario-retorno.test.ts tests/explorar-sugerencias-vista.test.ts --maxWorkers=1 --no-file-parallelism
```

La opción de baseline lee objetos Git con `git show`; no modifica índice,
historial ni working tree. Sólo una instancia Chromium propia por ejecución,
cerrada en `finally`. Resultados y capturas sintéticas en
`%USERPROFILE%\calendario-datos\calendario-trabajo\perf\opt-red-lenta\cliente`
(se puede elegir otro destino con `PERF_CLIENTE_SALIDA`):
`{antes,despues}.json`, `{antes,despues}-{movil,aeropuerto}.png` y
`despues-desktop.png`.
