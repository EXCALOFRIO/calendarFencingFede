# Matriz de QA manual: responsive, accesibilidad y carga

Esta matriz es para la **revisión privada manual posterior a la publicación**
(versión vigente `b0da2841`, ver `docs/entrega-release.md`).
Nadie la ha ejecutado todavía: no hay cuenta de prueba ni navegador autenticado
disponibles para el agente, y no se crean cuentas temporales ni se reutilizan
cookies o sesiones para suplirlos. Las comprobaciones anónimas posteriores a la
publicación (ver `docs/entrega-release.md`) no sustituyen a ninguna fila. Lo que sí hay
es revisión de código y pruebas de servidor directas, que no sustituyen a esta
matriz (ver «Qué está comprobado y qué no»).

## Cómo ejecutarla

Con sesión propia, en cada ruta y en cada ancho (**320, 393, 768 y 1440 CSS px**):

1. **Desborde**: en la consola, `document.documentElement.scrollWidth <= window.innerWidth`.
   Un `overflow-x` dentro de una tabla propia es aceptable; a nivel de página, no.
2. **Texto completo**: nombres, puestos, tanteos y fuentes se leen enteros (se
   parten, no se recortan con puntos suspensivos).
3. **Teclado**: `Tab` recorre cabecera, navegación y contenido en orden; el foco
   se ve y no queda tapado por la cabecera fija ni por la barra inferior; `Intro`
   y `Espacio` activan filas y botones; `Esc` cierra hojas y devuelve el foco al
   control que las abrió.
4. **Tacto**: objetivos de 44 px o más (en móvil la raíz es de 18 px, así que
   `h-11` mide 49,5 px).
5. **Zoom**: 200 % y tamaño de texto del sistema al máximo; nada se solapa ni
   queda inalcanzable.
6. **Movimiento reducido**: activar «reducir movimiento» en el sistema; los
   indicadores de carga no giran ni parpadean y el salto de mes del calendario
   no anima.
7. **Estados**: carga (esqueleto), cero coincidencias, error con salida
   utilizable, lista parcial. Un error nunca se lee como «no hay resultados».

## Rutas

| Ruta | Existente/nueva | Comprobar además |
|---|---|---|
| `/` (calendario y ficha de torneo, banda «Estás dentro», resultados) | existente | foco al abrir y cerrar la hoja; lista de inscritos vacía vs sin consultar; aviso de lectura fallida con la lista retenida |
| `/explorar` | nueva | filtros en URL, «Solo España», chips de filtro con valor largo sin recorte, «Ver más deportistas» con cursor, retorno desde la ficha |
| `/explorar/[personaId]` | nueva | temporada y modalidad conservadas, favorito Guardar/Quitar con anuncio de estado, vuelta a la búsqueda de origen |
| `/explorar/[personaId]/cara-a-cara` | nueva | solo asaltos individuales, filtros de rival y temporada, detalle por asalto |
| `/explorar/ediciones` y `/explorar/ediciones/[edicionId]` | nueva | estados de resultados con icono y texto, enlaces de resultados |
| `/explorar/favoritos` | nueva | lista paginada, quitar favorito, vacío y error |
| `/ranking` | existente | con rol **atleta**, **seleccionador de otra arma** y **admin**: ver más abajo |
| `/estado` | existente | «Dentro», «Sin confirmar», «Lista vacía» y «Lista sin consultar» se distinguen y ninguno dice «no estás» |
| `/perfil` | existente | correo completo, favoritos, historial propio, calendarios, «Salir de la sesión» |
| Shell (cabecera y barra) | existente | «Saltar al contenido» aparece con el primer `Tab`; «Perfil de …» y «Salir» miden 44 px o más; barra inferior con 4 o 5 destinos a 320 px |

### Matriz de `/ranking` por arma

| Cuenta | Arma de la tabla | «Ver tus datos y el cálculo» | Bloque «Cálculo de esta aplicación» | Nota de filas sin ficha |
|---|---|---|---|---|
| atleta | cualquiera | no (dice «Ver tus datos») | no | sin «ni el cálculo abierto» |
| seleccionador de espada | florete | no | no | sin «ni el cálculo abierto» |
| seleccionador de espada | espada | sí | sí | con «ni el cálculo abierto» |
| admin | cualquiera | sí | sí | con «ni el cálculo abierto» |

En todos los casos se conservan puesto, puntos, club y corte oficiales. Al cambiar
de arma con el selector, la fila de la tabla debe cambiar de texto según esta
tabla, sin recargar.

## Qué está comprobado y qué no

Comprobado por el agente, sin sesión privada:

- Renders de servidor directos (sin navegador) del texto y la estructura de la
  tabla oficial por arma autorizada, del panel de fila oficial y de los estados
  oficiales de «Mi estado».
- Pruebas de la proyección de «Mi estado» (propiedad, recuentos y lecturas
  acotadas) con datos sintéticos.
- Revisión estática de código de las rutas de la tabla para recortes, nombres
  accesibles, objetivos táctiles y movimiento reducido.

**No ejecutado** (pendiente del propietario): todas las filas de la matriz de
rutas a los cuatro anchos, teclado real, zoom, movimiento reducido real, lector
de pantalla y métricas web. No se han medido ni se fijan objetivos de Core Web
Vitals.

## Mediciones disponibles

Todas distintas entre sí y ninguna de una vista privada:

- **Lectura agregada de la base real** (un `SELECT` de solo recuentos, el
  02/10/2026): 273 torneos con fecha futura, 1.302 filas de inscripción en
  total, máximo 137 por torneo, 557 filas entre los cinco torneos mayores.
  Antes, «Mi estado» leía la unión de **todas** las pruebas candidatas; ahora
  lee los torneos donde figura el tirador y, además, solo los de las filas que
  muestra (tope 5), sin repetir los ya leídos. La cota superior pasa de 1.302
  filas crudas a, como mucho, lo que tengan esos torneos. No se midió con la
  cuenta de ningún usuario ni se midieron tiempos.
- **Proyección sintética (no es una medida de producción)**, reproducible en
  `tests/estado-lista-oficial-proyeccion.test.ts` (120 torneos × 80 inscritos
  inventados): filas leídas 9.600 → 400 y bytes retenidos de la proyección
  3.505.621 → 639. Describe el diseño de la consulta con datos fabricados; no
  se midió con la aplicación publicada ni con ninguna cuenta.
- **Core Web Vitals, tiempos y bytes transferidos reales: no medidos.** No hay
  sesión privada ni una base comparable antes y después, y esta guía no fija
  ningún objetivo numérico de CWV. Una publicación correcta tampoco los mide.
  Medirlos forma parte de la QA privada del propietario (por ejemplo, con las
  herramientas de rendimiento del navegador sobre su propia sesión).

## Recorrido por cuenta (a ejecutar por el propietario, con sesión propia)

Marca cada casilla en 320, 393, 768 y 1440 px; en cada ancho, además, teclado,
zoom al 200 % y movimiento reducido (pasos 3, 5 y 6 de «Cómo ejecutarla»).

| Cuenta | Qué comprobar |
|---|---|
| **Atleta** | Entrar con código; `/estado` distingue Dentro / Sin confirmar / Lista vacía / Lista sin consultar; `/ranking` no ofrece «Ver tus datos y el cálculo» ni bloque de cálculo; `/explorar` busca, abre ficha y conserva temporada y modalidad; cara a cara solo muestra asaltos individuales; favoritos (ver `docs/favoritos-guia-manual.md`); datos oficiales de inscripción visibles sin etiquetas de procedencia por inscrito. |
| **Seleccionador, arma propia** | `/ranking` de su arma muestra «Ver tus datos y el cálculo» y el bloque «Cálculo de esta aplicación». |
| **Seleccionador, otra arma** | `/ranking` de otra arma **no** lo muestra y conserva puesto, puntos, club y corte oficiales; al cambiar de arma con el selector el texto cambia sin recargar. |
| **Admin** | Todas las armas con cálculo; `/admin/salud` y cuarentena accesibles; ningún botón de ingesta se pulsa en la QA. |
| **Sin sesión** | Ya comprobado de forma anónima en la publicación: cada ruta privada redirige a `/entrar`. Repetirlo en el navegador propio. |

Guardas y límites a observar en la revisión: ningún dato nominal en la URL; un
error nunca se lee como «sin resultados»; una prueba sin datos importados dice
«sin datos», no «sin participantes»; la cobertura histórica es parcial (ver
`README.md`, «Estado real de los datos históricos»).