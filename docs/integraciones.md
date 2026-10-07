# Integraciones: cómo se conectan las pantallas

Mapa de navegación de la aplicación y lista de lo que falta por conectar. Estado: **existe** (ya estaba), **hecho** (fases 1 y 2 de integración, 8-oct-2026), **pendiente** (zona ocupada por otro trabajo; detalle en § 3).

Puente de datos calendario ↔ resultados: `src/lib/sport/explorar/enlaces-calendario.ts` (lógica pura, consulta y caché) y `enlaces-calendario-real.ts` (con D1 y la caché compartida). Usa las mismas claves exactas que el calendario (`sport_edition.event_id`, `sport_competition.event_competition_id`, clave FIE `fie-<temporada>-<clave>`, clave Skermo `RFEE:<n>`); nunca empareja por parecido.

## 1. Mapa

| Desde | Hacia | Cómo | Estado |
|---|---|---|---|
| Tarjeta del calendario (torneo terminado) | Edición / prueba de Explorar | `PieResultados`: «Resultados» directo con una edición, hoja de ediciones con varias | existe (tramos pasados) |
| Prueba del calendario (`event_competition`) terminada | Su prueba exacta de resultados | la prueba elegida en la ficha: «Ver resultados» en la cabecera de Resultados (`pruebaExacta`: vínculo guardado y, si no, arma, género, categoría y formato) | hecho |
| Ficha del torneo (terminado) | Edición / prueba, podio → perfil | `ResultadosTorneo` | existe |
| Ficha del torneo, podio | País | bandera → `EnlacePais`, hermana del enlace al perfil (también la del ganador en la hoja de resultados pasados) | hecho |
| Inscritos de la ficha | Perfil | `fila-inscrito.tsx` | existe |
| Edición / prueba | Torneo del calendario (información, documentos) | la fecha de la cabecera abre `/?mes=…&evento=<id>` (`urlEventoCalendario`, conserva los filtros de `origen`) | hecho; `evento=` abre la ficha (`leerEventoCalendario`) |
| Edición / prueba | Perfil | filas de clasificación, poules y cuadro | existe |
| Edición / prueba | País | bandera de la sede (cabecera) y de cada fila de la clasificación | hecho |
| Cuadro (directas) | Cara a cara de los dos tiradores | los tantos del asalto (columna de 44 px) | hecho |
| Poule | Cara a cara | casillas de 26 px: no caben 44 px de toque | pendiente de diseño |
| Edición | Prueba conjunta / partes | `EnlaceConjunta` | existe |
| Feed (Inicio) | Perfil; prueba exacta | nombre → perfil; torneo → `?prueba=<id>&persona=<id>` (antes sólo la edición) | hecho |
| Perfil | Edición / prueba | filas de resultados | existe |
| Perfil | Cara a cara, ranking | botones y secciones | existe |
| Perfil | País | bandera y nombre del país en la cabecera (`EnlacePais tamaño="ficha"`) | hecho |
| Cara a cara | Perfiles, prueba de cada asalto | retratos, nombres, `urlCruce` | existe |
| Cara a cara | País | bandera de cada contendiente | hecho |
| Cara a cara | País contra país | `rutaPaisContraDe` | pendiente (país) |
| Ranking | Perfil | nombre | existe |
| Ranking por equipos (FIE) | País | el nombre de la selección | hecho |
| Ranking individual | País | bandera de 18 px pegada al nombre: no cabe un toque de 40 px sin pisar el nombre; el país se alcanza desde el perfil | decidido: no |
| Notificación de resultados | Prueba exacta (y persona si es una) | `destinoResultados` | existe (centralizado en `notificaciones/destinos.ts`) |
| Notificación de perfil (ranking, plaza olímpica) | Sección Ranking del perfil | `destinoPerfil` | hecho (antes, la portada del perfil) |
| Notificación de calendario (nueva, cierre de plazo) | Ficha del torneo | `destinoEvento`: `/?mes=…&q=<nombre>&evento=<id>` | hecho (abre la ficha) |
| Avisos ya guardados | Destino al día | `destinoDeAviso` al leer y al abrir; no vuelven a contar como no leídos | hecho |
| País | Perfiles, ediciones, país contra país | pantallas de país | pendiente (país) |
| Buscar | País | resultados de país → `rutaPais(codigo)` | pendiente (buscador) |
| Siguiendo / favoritos | Perfil | filas | existe |
| Barra inferior | Raíz de cada pestaña | tocar la pestaña activa | hecho, ver § 2 |

## 2. Bug de la brújula (Explorar)

**Síntoma.** En Explorar, tras abrir un perfil, la brújula ya no vuelve a la raíz de Explorar, y «atrás» devuelve al mismo sitio una y otra vez.

**Causa 1 (la principal): la memoria de la pestaña Explorar se queda con la ficha propia.** La barra recuerda la última URL de cada pestaña (`sistema:pestanas` en `sessionStorage`, `memoria-pestanas.ts`) y la guarda en un efecto al llegar a cada pantalla (`barra-inferior.tsx`, `useEffect` con `guardar(marcada, urlActual())`; lo mismo en `nav.tsx › PastillasEscritorio`). La pestaña marcada se deduce de la ruta (`pestanaDeRuta`) y la ficha propia sólo se reconoce por `perfil:ficha-propia` en `sessionStorage`, que apunta `MarcaFichaPropia` en un efecto del layout del perfil. La primera vez que se abre la ficha propia en una pestaña del navegador (y en cada recarga, porque al hidratar `useFichaPropia` vale `null`), el primer render de la barra marca **Explorar** (`/explorar/<id>` cuelga de `/explorar`). En el mismo commit, el efecto de la barra guarda `explorar = /explorar/<id-propio>`. Cuando después llega la ficha propia, la barra pasa a marcar «Tú», pero la memoria de Explorar ya está contaminada.

A partir de ahí la brújula **no es la pestaña activa** (la activa es «Tú»), así que `hrefDePestana` le da la URL recordada, que es la misma ficha. Al tocarla, Next navega a la misma URL (sustituye la entrada, no hace nada visible). «Volver» en la ficha hace `router.back()` y saca a la pestaña anterior. Al volver a tocar la brújula, otra vez la ficha propia. Ese es el bucle. Lo confirman las funciones puras: `pestanaDeRuta('/explorar/X', false, null) === 'explorar'` y `hrefDePestana(explorar, 'tu', { explorar: '/explorar/X' }) === '/explorar/X'`.

**Causa 2 (agrava el «atrás»): tocar la pestaña activa apila su raíz en vez de volver a ella.** `toquePestana` devuelve `navegar` y el `Link` hace `push(raíz)`. La pila queda `[raíz, perfil, raíz]`: «atrás» desde la raíz vuelve al perfil, y «Volver» del perfil a la raíz anterior. Instagram vacía la pila de la pestaña.

**Causa 3 (salto de pestaña):** las rutas neutras se asignan por prefijo y no por la pestaña de la que salen. Un perfil abierto desde Buscar o Ranking marca Explorar y se guarda en la memoria de Explorar. Una edición abierta desde un perfil marca Buscar (`prefijos: [RUTA_EDICIONES]`). La brújula acaba llevando a una ficha que se abrió desde otra pestaña.

**Arreglo (hecho en la fase 2, detalle en § 5):**

1. `memoria-pestanas.ts › recordarPestana` y los dos efectos que guardan: antes de guardar, recalcular la pestaña con la ficha propia **actual** (leer la instantánea del almacén de `ficha-propia.tsx`, no la del render) y no guardar una URL bajo una pestaña a la que no pertenece. Además, cuando `MarcaFichaPropia` apunte una ficha propia nueva, quitar de la memoria de `explorar` (y de `buscar`) cualquier URL que sea esa ficha o una de sus secciones (que vuelvan a su raíz).
2. `navegacion.ts › toquePestana` / `barra-inferior.tsx › Pestana.onClick` (y `nav.tsx › PastillaEscritorio`): con la pestaña activa y en una subpantalla, `preventDefault` y volver a la raíz sin apilar. Con la Navigation API, buscar hacia atrás la entrada de la raíz de esa pestaña y hacer `navigation.traverseTo(key)` si todas las entradas intermedias son de la misma pestaña. Si no, `router.replace(raíz, { transitionTypes: [volver] })`. En los dos casos, `recordarPestana(clave, raíz)`.
3. Pestaña de las rutas neutras (`/explorar/<persona>`, `/explorar/ediciones/<id>`, `/explorar/pais/…`): heredar la pestaña desde la que se abrieron. Por ejemplo, un mapa `ruta → pestaña` en `sessionStorage` que se escribe al cambiar de `pathname` con la pestaña marcada justo antes. `pestanaDeRuta` lo consulta antes de caer al prefijo. Así un perfil abierto desde Buscar sigue en Buscar, como en Instagram.
4. Revisar las demás pestañas con la misma regla:
   - **Calendario**: la ficha es un panel con `pushState` sobre `/`, y tocar el calendario con la ficha abierta sólo sube al principio (`accion: 'subir'`). Debe cerrarla (`history.back()`, que dispara su `popstate`).
   - **Tú**: la ficha propia sufre la causa 1 al revés (`tu` bien, `explorar` mal).
   - **Buscar** y **Ranking**: sufren la causa 3.

   Pruebas en `tests/navegacion-app.test.ts`: memoria tras ficha propia sin conocer (la causa y el arreglo), toque en pestaña activa desde una subpantalla sin apilar, pestaña heredada, y las cinco pestañas.

## 3. Cambios por zona

Calendario, Perfil y Barra se hicieron en la fase 2 (se dejan como registro de lo pedido; detalle en § 5). Buscador y Países siguen pendientes.

### Calendario (`src/components/calendario/**`, `src/lib/calendario/contexto-url.ts`, datos de la ficha) — hecho

1. **Abrir la ficha con `evento=<id>`.** Leerlo en `leerContextoCalendario` (UUID) y en `VistaCalendario`: al montar, abrir esa ficha si el torneo está cargado. Si no lo está, pedir su tramo con `cargarPasado` y abrirla al llegar. Después, quitar `evento` de la URL con `history.replaceState` antes de que `useEntradaDeHistorial` apile la entrada de la ficha: cerrar la ficha vuelve al calendario y no la reabre. Motivo: lo usan el enlace de la fecha en la edición (`urlEventoCalendario`) y los avisos de calendario (`destinoEvento`). Hoy esos enlaces abren el mes correcto, pero no la ficha.
2. **«Resultados» en cada prueba terminada** (las pastillas de prueba de `ficha-evento.tsx` y de `tarjeta-bloque.tsx`). Con `pasado.resultados[evento.id]` cargado, `destinoEnPruebas(competicion, pruebas)` da la prueba exacta y `urlResultados(destino, retornoCalendario)` la dirección. Si no está cargado (torneo del tramo actual), la server action `enlacesResultadosDelEvento(evento.id)` de `src/app/(app)/explorar/enlaces-evento.ts` devuelve `{ ediciones, destino }` con caché compartida: una consulta por torneo y ninguna por prueba. Motivo: el ejemplo del dueño. Al pulsar una competición «Terminada» hay que poder entrar a sus resultados.
3. Banderas del podio (`ficha/resultados-torneo.tsx`) y del ganador (`pasado/resultados-pasados.tsx › Ganador`) → `EnlacePais` de `components/explorar/piezas.tsx`, como hermano del enlace, nunca dentro. Motivo: país.

### Perfil (`src/components/explorar/perfil/**`, `ficha-deportiva.tsx`) — hecho

1. `ficha-deportiva.tsx` (cabecera, `<BanderaPais pais={ficha.pais} tamaño="ficha" />`): cambiarla por `<EnlacePais pais={ficha.pais} soloBandera={false} />`. Motivo: bandera → país (b).
2. En filas que ya son enlace entero (`fila-resultado.tsx`, `historial-perfil.tsx`, `rivales-*.tsx`), dejar la bandera sin enlace: dentro de otro enlace no es HTML válido y a 18 px no da 40 de toque.

### Barra y navegación (`src/components/sistema/**`, `nav.tsx`, `navegacion-app.ts`, `cabecera-app.tsx`) — hecho

1. Arreglo del bug de § 2 (puntos 1 a 4).
2. `navegacion-app.ts › cabeceraDeRuta`: hoy `/explorar/pais/ESP` cae en la rama del perfil («Perfil», vuelve a Explorar). Añadir antes la rama del país: `{ variante: 'subpantalla', titulo: 'País', volverA: RUTA_INICIO, encabezado: false }`, y para `/explorar/pais/A/contra/B`, `volverA: '/explorar/pais/A'`. `rutaMadre` daría `/explorar/pais`, que no existe. `esFichaPropia` no cambia.

### Buscador (`vista-buscar`, `buscador-*`, `catalogo-ediciones`, `busqueda.ts`, `ediciones.ts`)

1. Resultados de país → `rutaPais(codigo)` (contrato de `pais-url.ts`).
2. `catalogo-ediciones.tsx`: ninguno; la fila de edición ya es un enlace entero y su bandera no puede enlazar.

### Países (`src/app/(app)/explorar/pais/**`, `src/components/explorar/pais/**`, `pais-url.ts`)

1. Crear las rutas `/explorar/pais/[ISO3]` y `/contra/[ISO3]`. Ya enlazan a ellas la cabecera de la edición, la clasificación, el cara a cara y el ranking por equipos, a través de `enlace-pais.ts › rutaPaisDe`, que normaliza ISO-2 o código FIE y descarta «FIE»/«AIN». Mientras no existan, esos enlaces dan 404.
2. Si se prefiere un solo fichero, mover `codigoPaisRuta` / `rutaPaisDe` / `rutaPaisContraDe` a `pais-url.ts` y dejar `enlace-pais.ts` como reexportación.
3. Desde el país: tiradores → `rutaFicha`, pruebas → `construirUrlEdicion(edicion, { prueba })` y «contra» → `rutaPaisContraDe`.

### Edición (`src/components/explorar/ediciones.tsx`, zona del buscador)

1. Rotular la prueba conjunta como «Prueba conjunta» en el título y en el selector de pruebas; hoy sólo lo dice `EnlaceConjunta`.

### Poule

1. Cara a cara desde las casillas de la poule: necesita diseño (casillas de 26 px, no caben 44 px de toque).

## 4. Hecho en la fase 1 (ficheros)

- `src/lib/sport/explorar/enlaces-calendario.ts`: `soloConResultados`, `destinoDeEvento`, `destinoDeCompeticion`, `destinoEnPruebas`, `urlResultados`, `urlEventoCalendario`, `leerEventoDeEdicion` (una consulta, cuatro ramas por índice, devuelve la tarjeta canónica) y `crearEnlacesCalendario` (caché compartida `enlaces-evento-resultados` y `enlaces-edicion-evento`, dependencias `deporte` y `calendario`; guarda también lo vacío; guarda de sesión antes de la caché).
- `src/lib/sport/explorar/enlaces-calendario-real.ts`, `src/app/(app)/explorar/enlaces-evento.ts` (server action para el calendario).
- `src/lib/sport/explorar/enlace-pais.ts`, `src/components/explorar/piezas.tsx › EnlacePais` (44 × 44).
- Edición: `src/app/(app)/explorar/ediciones/[edicionId]/page.tsx` (torneo en paralelo), `src/components/explorar/ediciones.tsx` (fecha → calendario, sede → país), `prueba/clasificacion.tsx` (bandera → país, hermana del enlace al perfil), `asaltos-prueba.tsx` (tantos → cara a cara, `caraACaraDeAsalto`).
- `tarjeta-feed.tsx` (prueba exacta), `cara-a-cara.tsx` (bandera → país), `ranking/fila-linea.tsx` + `tabla-fie.tsx` (`enlacePais` en selecciones).
- Notificaciones: `src/lib/notificaciones/destinos.ts` y su uso en `agrupar.ts`, `perfil.ts`, `calendario.ts` y `bandeja.ts`.
- Pruebas: `tests/enlaces-calendario.test.ts`, `tests/notificaciones-destinos.test.ts`, y ajustes en `explorar-ediciones`, `explorar-edicion-prueba`, `explorar-redisenio-vista`, `explorar-diseno-vista` y `notificaciones-generacion`. Las pruebas cuentan los enlaces a perfiles aparte de los de país o cara a cara (`data-enlace`). Arnés `tests/ui/prueba-v2.mts`: pinta el enlace al calendario; `SIN_CATALOGO=1` salta el índice.

## 5. Hecho en la fase 2 (ficheros)

**Calendario.**
- `src/lib/calendario/contexto-url.ts`: `leerEventoCalendario` (UUID en minúsculas; aparte del contexto, que no lo guarda) y `quitarEventoDeUrl`. `src/app/(app)/page.tsx` lo pasa como `eventoInicial` a `VistaCalendario` (`vista.tsx`), que espera a que el torneo esté en la lista (o a que el tramo termine de cargar), quita `evento` con `history.replaceState` y abre la ficha: cerrarla no la reabre.
- `ficha/resultados-torneo.tsx`: `pruebaExacta` (vínculo guardado y, si no, arma, género, categoría y formato) y «Ver resultados» en la cabecera de Resultados hacia la prueba elegida en la ficha (`data-resultados-prueba`); bandera del podio → `EnlacePais` hermana del enlace al perfil. `ficha-evento.tsx` le pasa la competición elegida.
- `pasado/resultados-pasados.tsx`: bandera del ganador → `EnlacePais` (`Ganador sinBandera`).

**Perfil.**
- `ficha-deportiva.tsx`: bandera y nombre del país de la cabecera → `EnlacePais tamaño="ficha"` (nuevo tamaño en `piezas.tsx`).
- `perfil/historial-perfil.tsx`: los filtros (Temporada, Tipo de torneo, Categoría) usan el `Select` del sistema en vez del `<select>` nativo; alto fijo de 44 px en px para que el texto al 130 % no lo agrande.

**Barra y navegación** (arreglo de § 2).
- `sistema/navegacion.ts`: `toquePestana` devuelve `raiz` en una subpantalla de la pestaña activa; `raizRecordada` (la raíz con su consulta, p. ej. el mes del calendario), `esRaizDe`, `indiceRaizEnHistorial`, `hayCapaAbierta` (`fichaCalendario`, `hojaPoule`).
- `sistema/toque-pestana.ts` (nuevo): `recordarSiEsSuya`, `volverARaiz` (Navigation API `history.go` hasta la raíz si todo lo de en medio es de la pestaña; si no, `router.replace`), `resolverToque` (en la raíz cierra la capa abierta o sube), `useRouterOpcional`.
- `sistema/herencia-pestanas.ts` (nuevo): pestaña heredada de las rutas neutras, anotada en `sessionStorage` (`sistema:pestana-de-ruta`, 200 como mucho) para atrás y recarga; nada al hidratar.
- `navegacion-app.ts`: `pestanaDeRuta(…, heredada)`, `esRutaNeutra`, `pestanaQueRecuerda`, `sinFichaPropiaAjena`. `memoria-pestanas.ts › transformarRecordadas`; `perfil/ficha-propia.tsx` limpia la memoria al apuntar la ficha propia y expone `leerFichaPropia`.
- `sistema/barra-inferior.tsx` (`deLaPestana`) y `nav.tsx` (`deLaPestanaApp`, `usePestanaMarcada`, también en las pastillas del escritorio).

**Inscritos.** `src/lib/entries/duplicados-pantalla.ts` (nuevo): `sinDuplicadosEnPantalla` oculta, sólo en pantalla y dentro de la misma prueba, la fila suelta (sin persona, no «mía», no equipo) cuyo nombre normalizado coincide con UNA fila enlazada (o la contiene con el segundo apellido de más: «ROMAN Adrian» / «ADRIÁN ROMÁN BLANQUE»). Con homónimos enlazados no oculta nada. Se usa en `ficha-evento.tsx` y en `queries/inscritos-union.ts › contarInscritosPublicados`, para que el recuento coincida con la lista.

**Conjuntas de veteranos.** `src/lib/sport/explorar/conjunta-edicion.ts`: rótulo corto de la fuente (el año para los literales largos del Criterium), partes con el mismo rótulo distinguidas por sus puestos («VET40 · 7») o por su orden, orden numérico natural, y recuento de puestos en la consulta. En `nuevo15`: 148 conjuntas y 237 partes; los enlaces conjunta ↔ partes funcionan y 11 conjuntas tenían rótulos repetidos.

**Pruebas.** `tests/navegacion-app.test.ts` (bucle de la brújula: causa y arreglo, herencia, toque por pestaña en las cinco, raíz recordada, capas, cabecera del país), `tests/integraciones-fase2.test.ts` (nuevo: `evento=`, `pruebaExacta`, duplicados, rótulos de conjuntas), `tests/sistema-piezas.test.ts` (toque `raiz`).
