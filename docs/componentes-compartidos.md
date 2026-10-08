# Componentes y rótulos compartidos

Piezas comunes para que cada pantalla deje de montar su propia versión. Todas usan tokens semánticos, la escala de Tailwind y nunca desplazan en horizontal.

## Rótulos de prueba: `@/lib/sport/rotulos`

| Función | Resultado |
| --- | --- |
| `rotuloArma(a, 'largo' \| 'codigo')` | «Florete»; `codigo` «FLO» (sólo tablas densas) |
| `rotuloGenero(g, { arma?, variante })` | «Masculino»; con arma concuerda: «masculino» (florete, sable), «masculina» (espada); `corto` «Masc.», «Fem.», «Mixto» |
| `rotuloCategoria(c, { variante, omitirAbsoluto })` | «Absoluto», «Veteranos», «M17»; `corto` «Abs», «Vet» |
| `rotuloFormato(f)` | «Individual», «Equipos» |
| `rotuloPrueba(p, { variante, categoria, formato })` | «Espada femenina M17 · Equipos», «Espada femenina · Absoluto · Individual», corto «Espada Fem. M17 · Equipos» |
| `ordenCategoria`, `compararCategorias` | ABS, de menor a mayor edad (M7…M23), VET |

- Sí: el separador « · » va antes de la modalidad. Por defecto se omiten ABS e «Individual».
- «Absoluto» y «Veteranos» (corto «Abs», «Vet») son un tramo propio: «Espada femenina · Veteranos». Los códigos («M17», «V40») van pegados al género: «Espada femenina M17». Nunca «Espada femenina Absoluto».
- `competitionLabel` de las convocatorias es `rotuloPrueba` con `categoria: 'siempre'`.
- No: concatenar `WEAPON_SHORT[...] + GENDER_SHORT[...]` (salía «FLO M, equipos»). Las tablas de `utils.ts` (`WEAPON_LABEL`, `GENDER_LABEL`…) siguen existiendo, salen de aquí y están marcadas `@deprecated`.
- Lo que no se reconoce se omite: nunca sale un código crudo ni `undefined`.

## Fechas: `@/lib/fechas`

Todo en Europe/Madrid, con formateadores en caché. Las fechas civiles (`YYYY-MM-DD`) se leen tal cual; los instantes se pasan a Madrid.

| Función | Resultado |
| --- | --- |
| `hoyMadrid()` | `2026-10-05` (reexporta `callups/fechas`) |
| `diaMadrid(fecha)` | el día civil en Madrid de un instante |
| `fechaCorta(f, { anio: 'auto' \| 'siempre' \| 'nunca' })` | «5 oct», «5 oct 2027» |
| `rangoFechas(a, b, 'linea')` | «15–18 oct», «30 sept–2 oct», «30 dic 2026–2 ene 2027» |
| `rangoFechas(a, b, 'bloque')` | `{ dias: '30–2', mes: 'SEPT–OCT', etiqueta }` |
| `fechaHora(instante)` | «5 oct, 23:59» |
| `nombreMes(f, { anio, variante })` | «Octubre», «Octubre 2026», «oct» |
| `frescura(f)` | «Actualizado el 5 oct» (la única redacción) |
| `diasEntre(a, b)` | días de calendario, correcto en los cambios de hora |

Reemplaza `formatDateEs` («05 oct 2026»), `formatDateRangeEs` («15 – 27 oct»), «05/10/26» y el `nombreMes` sin huso de `calendario/vista.tsx`.

## Selector de pruebas: `@/lib/sport/selector-pruebas` y `SelectorNiveles`

`filasSelectorPruebas(elementos, actualId)` devuelve una fila por dimensión con dos o más valores (arma, género, modalidad, categoría, en ese orden). Cada opción trae `destinoId` y, si se pasó, `destinoHref`. Al cambiar una dimensión se busca la prueba que conserva más del resto, con prioridad arma > género > modalidad > categoría.

`<SelectorNiveles filas={...} onSeleccion?={(id) => …} />` pinta esas filas. Sin `onSeleccion` usa enlaces con `replace` y `scroll={false}`. Generaliza `selectorDePruebas` de `explorar/edicion-modelo.ts`.

## `SelectorSegmentado` (`sistema/selector-segmentado`)

Props: `etiqueta`, `opciones [{ valor, etiqueta, href?, cuenta?, deshabilitada? }]`, `valor`, `onCambio?`, `variante 'pastilla' | 'subrayado'`, `tamano 'md' (44 px) | 'sm' (36 px y área de 44)`, `anchoMinimo 4|5|6|8` (rem), y para los enlaces `replace`, `scroll` y `transitionTypes`.

- Con `onCambio` se pinta un `radiogroup`, con flechas, Inicio y Fin. Si todas las opciones traen `href`, se pinta un `nav` con `aria-current`.
- Rejilla `auto-fit`: las opciones miden lo mismo y saltan de fila.
- Reemplaza los 7 segmentados hechos a mano y las pestañas con desplazamiento.

## Pastillas (`sistema/pastilla`)

- `Pastilla` acepta `tono` (`neutro`, `ok`, `aviso`, `peligro`, `info`, `marca`, `oro`, `plata`, `bronce`), `tamano` (`sm` 20 px, `md` 24 px) e `icono`. Nunca salta de línea.
- `PastillaRanking({ fuente, puesto })` pinta «FIE #126».
- `Puesto({ puesto })` pinta un disco con el color de la medalla del 1 al 3 y dice el metal al lector de pantalla.
- `MarcaPropia` pinta «Tú», siempre con mayúscula.
- Reemplaza las alturas sueltas de 18, 26 y 28 px, el «tú» en minúscula y las 6 versiones de la insignia de puesto.

## Personas (`sistema/avatar`, `sistema/fila-persona`)

`Avatar({ personaId?, nombre, tamano 28|40|56|96, apagado?, foto? })` delega en `FotoDeportista`, que agrupa las peticiones de fotos. Las iniciales se calculan sólo aquí.

`FilaPersona` admite estas props: `persona {id?, nombre, pais?}`, `href?`, `avatar?`, `equipo?`, `puesto?`, `insignias?`, `apilar?`, `meta?`, `propia?`, `apagado?`, `transitionTypes?`, `enlace? { id?, data-* }` y `densidad 'normal' | 'compacta'`. Siempre usa la misma rejilla: `[puesto] [avatar 40] [bandera + nombre / meta] [insignias]`. El nombre se recorta y conserva el texto completo en `title`. Con `href`, toda la fila es pulsable.

- Sí: pasa las pastillas en `insignias`, que se alinean a la derecha sin saltar de línea.
- Sí: con dos puestos (FIE y RFEE), `apilar`: por debajo de `sm` van uno encima de otro y «Tú» queda a su izquierda, así el nombre sigue legible a 360 px. No lo uses si una insignia es un botón.
- `apagado` pone la foto en gris (persona sin resultados propios). `transitionTypes` y `enlace` pasan al `Link` del nombre.
- No: montar las iniciales a mano como en `ranking/fila-linea.tsx`, `ranking/mis-tiradores.tsx` o `calendario/fila-inscrito.tsx`.

## `ListaDatos` y `ParDato` (`sistema/lista-datos`)

`<ListaDatos disposicion="columna" | "linea" | "rejilla">` contiene elementos `<ParDato etiqueta icono? fuente?>valor</ParDato>`. Genera un `<dl>` con el `dt` siempre antes del `dd`. La prop `fuente={{ etiqueta: 'Ver en la convocatoria', href }}` pinta un botón aparte al final del par, nunca pegado al valor. Con `onClick`, el componente tiene que ser de cliente. En `linea`, rótulo y valor saltan de línea cuando no caben; el rótulo nunca encoge por debajo de su palabra más larga. Reemplaza `Rotulos` de `estado/piezas.tsx` (ya borrado) y el icono `ScanText` pegado detrás de «80 €».

## Filtros (`filtros/barra-filtros`)

`BarraFiltros` admite `buscador?`, `activos [{clave, etiqueta, onQuitar}]`, `resultados`, `onLimpiar?`, `abierta?`, `onAbierta?` y `children`. Pinta un único botón «Filtros» con el número de filtros puestos y los filtros activos como chips que se quitan con un toque. Los apartados de la hoja se pasan como `children` con `OpcionesFiltro` (`variante 'chips' | 'segmentado'`) o con `SeccionFiltro`, para contenido libre. Reutiliza `BotonFiltros`, `HojaFiltros` y `CampoBuscar` de `filtros/chips.tsx`.

`FilaChips` ahora salta de línea siempre. `envolver` queda obsoleto y no hace nada.

## Cabeceras, vacíos, fechas y horarios

- `CabeceraSeccion` acepta `titulo`, `nivel` (`pagina` h1, `seccion` h2, `grupo` h3), `como?`, `contexto?`, `accion?` e `id?`. `VerMas` acepta `href`, `onClick`, `cuenta` y `detalle`, y siempre escribe «Ver más» o «Ver más (N)».
- `EstadoVacio` acepta `tipo 'vacio' | 'error'`, `titulo`, `descripcion?`, `accion?` e `icono?`. No usa esqueletos.
- `BloqueFecha({ desde, hasta?, tamano 'fila' 48 px | 'tarjeta' 60 px })` usa `rangoFechas(…, 'bloque')`.
- `hora-doble` tiene estas piezas:
  - `FilaHorario({ hora, titulo, subtitulo?, local? })` pinta tres columnas fijas.
  - `MarcaDia({ dias })` pinta «−1 día» o «+1 día».
  - `horaEnMadrid(fecha, hora, husoSede)` pasa la hora de la sede a Madrid y devuelve `null` si el reloj es el mismo.
  - `desfaseDiasMadrid` devuelve los días de diferencia entre la sede y Madrid.
