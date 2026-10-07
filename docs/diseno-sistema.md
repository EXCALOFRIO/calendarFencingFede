# Sistema de diseño y navegación

Especificación de la pasada visual. Manda sobre `UI.md` donde lo contradiga (tamaños de control, convención de marcado, movimiento). Las piezas están en `src/components/sistema/` y se ven en `capturas/sistema/` (`npx tsx tests/ui/sistema-muestra.mts`).

Referencia: Instagram. Es la interfaz que ya conoce la gente: una barra de iconos abajo, una cabecera fina arriba, el contenido a sangre y controles pequeños.

Cinco reglas:

1. **Una sola barra**, igual en toda la aplicación.
2. **Controles pequeños, área grande:** se ven de 28-36 px y se tocan en 44.
3. **Superficies opacas.** Una transparencia sólo se admite si es material de verdad (desenfoque real) o un velo sobre una foto.
4. **Nada de esqueletos.** La pantalla anterior se queda hasta que la nueva está lista.
5. **Una palabra mejor que tres.** Una frase solo si el dato no se explica solo.

---

## 1. Navegación

### 1.1 La barra inferior (móvil, < 1024 px)

`BarraInferior` (`barra-inferior.tsx`). Es la misma para todos los papeles y sustituye a `NavMovil` y a `BarraExplorarMovil`.

| Pestaña | Icono (lucide) | Ruta | También marca |
|---|---|---|---|
| Calendario | `CalendarDays` | `/` | — |
| Explorar | `Compass` | `/explorar` (lo que hoy es Inicio: el feed de a quién sigues) | `/explorar/[personaId]`, `/explorar/favoritos` |
| Buscar | `Search` | `/explorar/buscar` | `/explorar/ediciones` |
| Ranking | `Trophy` | `/ranking` | — |
| Tú | `CircleUserRound` (o la foto propia de 24 px) | `/explorar/yo` | `/perfil`, `/estado`, `/ajustes` |

- **Medidas:** 50 px de alto más `env(safe-area-inset-bottom)`. Iconos de 22 px; trazo de 1,7, y de 2,4 en la pestaña activa. Sin rótulos: el nombre va en `aria-label`. Con `rotulos="visibles"` se añade un rótulo de 10 px, solo si las pruebas con usuarios muestran que hace falta.
- **Pestaña activa:** el icono en `--foreground` con trazo grueso; las demás en `--muted-foreground`. No lleva pastilla, punto ni contorno rojo.
- **Fondo:** sólido (`bg-background`) con un filete de 1 px (`--filete-alto`) arriba. Existe la variante `fondo="material"`, que pone el fondo al 82 %, `backdrop-filter: blur(20px) saturate(1.6)` y vuelve a sólido si el navegador no soporta `backdrop-filter`. Solo se usa en pantallas con fotos a sangre detrás. Nunca se usa un alfa sin desenfoque.
- **Insignia:** un punto rojo de 7 px con anillo del color del fondo. Indica novedades y nada más; nunca lleva un número.
- **Toques:**
  - en otra pestaña, cambia de pestaña con un fundido de 150 ms;
  - en la pestaña activa desde una subpantalla, vuelve a su raíz;
  - en la pestaña activa estando ya en su raíz, sube al principio.
- **Memoria por pestaña:** cada pestaña recuerda su última URL en `sessionStorage`. Volver al Calendario desde Explorar te deja en el mes y con los filtros que tenías.
- **Lo que deja de estar en la barra:**
  - *Mi estado* pasa a ser la primera sección de Tú (solo tiradores).
  - *Gestión* se abre desde Tú → Gestión (solo administración) y desde la cabecera en escritorio.
  - *Siguiendo* (la lista de personas) está en Tú → Siguiendo, como «Seguidos» en un perfil de Instagram.
  - *Notificaciones* es una campana en la cabecera de Calendario y de Explorar.
  - *Convocatorias*, *Tiradores* y *Ajustes* son filas de Tú.

### 1.2 La cabecera compacta

`CabeceraCompacta` (`cabecera-compacta.tsx`). Va **dentro de cada `page`**, no en `(app)/layout.tsx`, porque cada pantalla tiene su título y sus acciones.

- **Medidas:** 48 px de alto más `env(safe-area-inset-top)` (el layout raíz usa `viewportFit: 'cover'`). El fondo es sólido. El filete inferior solo aparece cuando el contenido ya pasa por debajo (`data-desplazada`).
- `variante="raiz"` (cada pestaña): título a la izquierda en Barlow Condensed de 20 px y hasta dos `BotonIcono` a la derecha (buscar, notificaciones o compartir).
- `variante="subpantalla"`: flecha de volver a la izquierda, título centrado de 16 px en Inter semibold y una acción como máximo (normalmente «Más», que abre una hoja).
- **Lo que no lleva:**
  - subtítulo;
  - migas de pan;
  - el logo con el nombre, salvo en la raíz del Calendario;
  - el avatar ni el botón de salir (están en Tú).
- La cabecera global de hoy (la marca, `NavEscritorio`, el avatar y salir en 56-63 px) desaparece en el móvil. En escritorio se queda una barra de 56 px con la navegación (§ 1.6).
- El aviso de «datos sin actualizar» pasa a ser una línea de 12 px **dentro** de la pantalla del Calendario, no en la cabecera de todas las pantallas.

### 1.3 Calendario ↔ Explorar

Son dos pestañas de la misma barra; no hay un «modo Explorar» con barra propia ni un botón de «Volver al calendario».

- Para ir a Explorar se toca la brújula o un nombre de tirador (en el Calendario, en Ranking o en una clasificación). El nombre **avanza** (`nav-avanzar`) a la ficha. La ficha vive en `/explorar/[personaId]`, así que la barra marca Explorar, y la flecha de la cabecera vuelve por historial a la pantalla de origen con su scroll. Mientras las rutas sean una por ficha no hay una pila por pestaña como en Instagram, y no se simula.
- Para volver al Calendario se toca su icono. La memoria de la pestaña te devuelve al mes y los filtros que tenías.

### 1.4 La hoja inferior

`HojaInferior` (`hoja-inferior.tsx`) sustituye a las hojas laterales y a los desplegables de filtros en el móvil.

- **Aspecto:**
  - sube desde abajo, con un radio de 16 px arriba;
  - superficie `--popover` opaca y velo `--velo`, sin desenfoque;
  - asa de 36 × 4 px, título centrado de 16 px y aspa de 32 px;
  - pie opcional y fijo para la acción principal («Ver 128 torneos»).
- **Se cierra:**
  - arrastrando el asa o la cabecera hacia abajo (con un tirón de 0,5 px/ms o pasado un tercio del alto: `gesto-hoja.ts`);
  - tocando el velo;
  - con Escape;
  - con el aspa.
- **Desde 640 px** es un panel centrado de 440 px.
- **Una hoja por pantalla.** Una hoja no abre otra hoja.

### 1.5 Volver y gestos

- **Flecha de la cabecera** (`BotonVolver`):
  - si la entrada anterior del historial es de la aplicación (Navigation API, o el recuento de pantallas vistas si no la hay), hace `router.back()` y conserva el scroll y los filtros;
  - si se llegó por un enlace directo, sube a la ruta madre con `nav-volver` y no te saca de la aplicación.
- **Gesto de borde de iOS y botón «Atrás» del navegador:** los anima el propio sistema, así que la página no añade animación (`nav-historial` = ninguna). Solo desliza la vuelta que lanza la flecha, que marca `<html data-navegacion="atras">`.
- **Ya no hay enlaces «← Volver a…» dentro del contenido.** La flecha de la cabecera los sustituye.
- **Sin gestos propios** de deslizar entre pestañas. Chocan con el gesto de volver de iOS y con las filas que se desplazan en horizontal.

### 1.6 Escritorio (≥ 1024 px)

La barra inferior se oculta (`lg:hidden`). Una cabecera de 56 px lleva:

- la marca a la izquierda;
- los mismos cinco destinos en el centro, con icono de 18 px y rótulo de 13 px, en pastillas de 34 px;
- la campana y el avatar a la derecha.

El estado activo es el mismo que en el móvil: el texto en `--foreground` semibold y un fondo `--secondary`. El contenido queda centrado con `.ancho-app`.

---

## 2. Escala de tamaños

Todo en **px**, no en rem. Hoy la raíz sube a 18 px por debajo de 640 px, así que cualquier `h-11`, `text-sm` o `size-5` crece un 12,5 % en el móvil. Esa es la otra mitad de los «botones enormes», además de la regla global de 44 px (§ 8.2).

| Elemento | Visible | Área táctil |
|---|---|---|
| `Boton` sm / md / lg | 28 / 32 / 36 px de alto, `rounded-full` | ≥ 44 × 44 (`::after`) |
| `BotonIcono` sm / md / lg | 28 / 32 / 36 px, redondo | ≥ 44 × 44 |
| `ChipFiltro` | 32 px | ≥ 44 de alto |
| Pestaña de la barra | 50 px | la celda entera |
| Campo de texto | 40 px, texto de **16 px** (por debajo de 16 iOS hace zoom) | el campo |
| Fila de lista tocable | 44-56 px | la fila entera |

- **Área táctil invisible:** `AREA_TACTIL` (`tactil.ts`) es un `::after` transparente centrado de `max(100%, 44px)` por lado. No ocupa sitio en la maqueta. Se recorta si un antepasado tiene `overflow` distinto de `visible`: deja 6 px de margen (como hace `FilaChips`) o haz tocable la fila entera.
- **Iconos:**
  - 22 px en la barra;
  - 20 px en la cabecera y en `BotonIcono` md/lg;
  - 18 px en `BotonIcono` sm y en filas;
  - 14-16 px solo cuando acompañan a un texto dentro de un botón o un chip.
  - El trazo es 2, y 1,7/2,4 en la barra.
- **Tipografía:** cinco tamaños y no hay más.

  | px | Interlineado | Uso |
  |---|---|---|
  | 20 | 24 | título de pestaña (Barlow Condensed 600) |
  | 16 | 20 | título de subpantalla y de hoja, nombre en una ficha (Inter 600) |
  | 14 | 20 | texto de lista y párrafos (Inter 400/500) |
  | 13 | 16 | segunda línea, botones, chips (Inter 500/600) |
  | 12 | 16 | fecha, contador, metadato (Inter 400, `--muted-foreground`) |

  Fuera de la escala: `.cifra` (Barlow Condensed) para la **cifra que importa** de una pantalla (puesto, días que faltan), a 28-48 px, una o dos por pantalla. Y 10 px solo para los rótulos opcionales de la barra.
- **Espaciado:** múltiplos de 4. Lo habitual es 4 / 8 / 12 / 16 / 24.
  - 16 px de margen lateral en el móvil y 24 desde 640 px;
  - 8 px entre controles de una fila;
  - 12 px entre filas de un bloque;
  - 24 px entre bloques.
- **Radios:**
  - `rounded-full` en botones, chips, avatares e insignias;
  - 12 px en tarjetas y bloques sueltos;
  - 16 px arriba en la hoja inferior;
  - 6 px (`--radius`) en tablas y celdas.
  - No hay más radios.
- **Sombras:** solo en lo que flota: la hoja (`--sombra-hoja-aba`) y los paneles de escritorio (`--sombra-flotante`). Ni las tarjetas ni los botones llevan sombra; las superficies se separan con el filete de 1 px.

## 3. Color, contraste y modo oscuro

- **La aplicación es oscura** (`<html class="dark">`, `color-scheme: dark`). No hay tema claro y no se añade en esta pasada. Si llega, se hará con los mismos tokens y sin tocar las piezas.
- **Superficies opacas por nivel**, como ya dice `globals.css`:
  - `--background` (0,17) para el lienzo, la cabecera y la barra;
  - `--card` (0,215) para un bloque;
  - `--secondary` (0,27) para un control;
  - `--accent` (0,30) para el `hover`;
  - `--popover` (0,255) para la hoja.
  - Dentro de una hoja, los controles suben a `--accent`; `ChipFiltro` ya lo hace.
- **El rojo** (`--primary`) es solo para:
  - la acción principal de la pantalla;
  - la insignia de novedades;
  - tu propia fila en una clasificación.

  Como texto se usa `--primary-text`.
- **Marcado:**
  - un chip o un segmento elegido va **invertido**: relleno `--foreground` y texto `--background`, como en Instagram (21:1);
  - una pestaña de la barra se marca con el trazo y el color.

  El contorno rojo con `--marcado` de `nav.tsx` (`ACTIVO`) se retira en la pasada final.
- **Contraste:**
  - texto AA, 4,5:1;
  - `--muted-foreground` sobre `--card` da 7,9:1, y no hay que bajarlo;
  - los iconos sin texto, 3:1 contra su fondo;
  - el texto apagado no se pone nunca sobre `--secondary` y además por debajo de 13 px.
- **Transparencias:** solo valen tres.
  1. Un velo (`--velo`) detrás de una hoja o un diálogo.
  2. Un degradado de legibilidad sobre una **foto** (la cabecera de un torneo con foto, el acceso).
  3. `fondo="material"` / `.acrilico`, que es desenfoque real.

  El resto es un token opaco. Para un tinte se usa `color-mix(in oklab, <color> N%, var(--card))`, como ya hacen `--org-*-tinte`. Lista de casos en § 9.
- **Filetes:** se pueden escribir como blanco con alfa (`--filete`, `--filete-alto`), porque son líneas de 1 px y no superficies.

## 4. Movimiento

| Qué | Duración | Curva |
|---|---|---|
| Pulsar un control (`active:scale-[0.96]`) | 150 ms | ease-out |
| Cambio de color o estado | 150 ms | ease-out |
| Cambiar de pestaña (fundido) | 90 ms salida + 150 entrada | `--sis-curva` |
| Avanzar o volver (28 px + fundido) | 120 salida, 200 entrada (60 ms de retardo), 260 desplazamiento | `cubic-bezier(.2,0,0,1)` |
| Mismo sitio, otro contenido (`TransicionContenido`) | 100 + 160 ms | ídem |
| Hoja inferior | 240 ms al abrir, 180 al cerrar | `cubic-bezier(.32,.72,0,1)` (la de iOS) |

- **View Transitions de React.** Next 16.3 ya trae `<ViewTransition>` sin configurar nada (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`). Las navegaciones son Transitions, así que se activan solas.
  - **Tipos:** se pasan con `<Link transitionTypes={['nav-avanzar']}>` o con `router.push(href, { transitionTypes })`. Las constantes están en `TIPO_TRANSICION` (`navegacion.ts`), y `tiposEntre(desde, hasta)` deduce la dirección por la profundidad de la ruta.
  - **`TransicionPagina`** envuelve el contenido de cada `page.tsx`, debajo de la cabecera. No va en el layout, que no se desmonta.
  - **`TransicionContenido`** cubre los cambios de arma o de temporada dentro de la misma ruta.
  - **CSS:** está en `src/components/sistema/sistema.css`, que en la pasada final se importa desde `globals.css`. Ancla la cabecera (`view-transition-name: cabecera`) y la barra (`barra-inferior`) por encima de la página que se desliza, y deja pasar los toques durante la animación (`::view-transition { pointer-events: none }`).
  - **Sin soporte** del navegador no hay animación y todo funciona igual.
- **No se anima:**
  - la entrada de cada fila al hacer scroll;
  - el `hover` de todo;
  - las cifras que cuentan hacia arriba;
  - los giradores (spinners) a pantalla completa.
- **`prefers-reduced-motion`:**
  - se queda el fundido y se quita el desplazamiento (`--sis-recorrido: 0px`), con duraciones de grupo a 0;
  - la regla global de `globals.css` no alcanza a los pseudoelementos de view transition, por eso va en `sistema.css`;
  - la subida al principio con la pestaña activa pasa a ser instantánea.

## 5. Carga sin esqueletos

Objetivo: tocar algo produce respuesta en menos de 100 ms y la pantalla nueva aparece entera, sin bloques grises.

1. **Datos críticos en el primer render.** Cada `page.tsx` espera lo que se ve en la primera pantalla (título, filtros y las primeras 20-30 filas) y lo pinta en el HTML. Lo que va por debajo del pliegue va en un `<Suspense>` **sin fallback visible** (`fallback={null}`) o con la carga incremental que ya tiene `feed-incremental.tsx`.
2. **Fuera los `loading.tsx` con esqueletos:**
   - `explorar`, `explorar/buscar`, `explorar/ediciones`, `explorar/favoritos`, `explorar/siguiendo`;
   - `explorar/[personaId]`, `explorar/[personaId]/(perfil)`, `explorar/[personaId]/cara-a-cara`;
   - `ranking`, `estado`;
   - y `components/explorar/esqueletos.tsx`.

   Sin `loading.tsx`, Next mantiene la pantalla anterior a la vista hasta que la nueva está lista, porque la navegación es una Transition. Eso es justo lo que se quiere.
3. **Respuesta inmediata sin esqueleto:**
   - la pestaña tocada se marca al instante (`useLinkStatus` en `BarraInferior`);
   - el control tocado se queda en su estado de pulsado;
   - si la espera pasa de 300 ms, aparece una línea de progreso de 2 px bajo la cabecera, con retardo de 300 ms, para que en una navegación normal no salga nunca.
4. **Precarga por intención.** Al pasar el puntero, al poner el dedo o al enfocar se hace `prefetch` completo (`prefetch={true}` tras la intención, como `BarraInferior`). No se precarga al entrar en la ventana: son rutas dinámicas y con miles de usuarios serían cuatro renderizados de servidor por visita. Las filas de lista que abren fichas usan el mismo patrón, con un componente `EnlacePrecarga` en la pasada final.
5. **Caché:**
   - `experimental.staleTimes.dynamic: 30` en `next.config.ts`, para que volver a una pestaña ya vista sea instantáneo durante 30 s;
   - en el servidor siguen las cachés de datos que ya hay (catálogo, ranking);
   - `router.refresh()` solo tras una acción del usuario.
6. **Imágenes:**
   - las fotos de tirador llevan siempre `width` y `height` (o `aspect-ratio`), para que no haya saltos;
   - fondo `--secondary` con las iniciales mientras carga, que es contenido y no un esqueleto;
   - `loading="lazy"` por debajo del pliegue.

## 6. Escritura

- **Tono:**
  - de tú, directo y en voz activa;
  - es una herramienta de deporte, no un folleto: nada de exclamaciones, emojis ni «¡Ups!».
- **Longitudes máximas:**

  | Elemento | Máximo |
  |---|---|
  | Pestaña / título de pantalla | 1 palabra (2 si es un nombre propio) |
  | Título de sección | 1-3 palabras |
  | Botón | 1-3 palabras, verbo primero («Seguir», «Solicitar inscripción») |
  | Chip | 1-2 palabras |
  | Estado vacío | título de ≤ 5 palabras + 1 línea de ≤ 60 caracteres + una acción |
  | Error | 1 línea: qué ha pasado y qué hacer |
  | Aviso | 1 línea de ≤ 70 caracteres |

- **No se escribe:**
  - procedencia («Fuente: …», «Foto: FIE»);
  - frases que explican la pantalla;
  - «No hay datos»;
  - «Cargando…» como texto suelto;
  - MAYÚSCULAS de adorno;
  - cadenas «A · B · C» de tres o más datos (dos datos sí: «Madrid · Florete»).
- **Cifras:**
  - formato español («1.234», «3,5»);
  - fechas cortas («12 oct», «12 oct 2026» si no es este año);
  - días que faltan como cifra y palabra («3 días»).

### Diccionario

| Se dice | Para | No se dice |
|---|---|---|
| **Nacional** | lo de la RFEE: ranking, circuito, competiciones | «RFEE» como rótulo (la sigla solo en el escudo) |
| **Internacional** | lo de la FIE: ranking, Copas del Mundo, Grandes Premios | «Mundial», «ranking mundial», «FIE» como rótulo |
| **Europeo** | lo de la EFC: Circuito Europeo, Campeonato de Europa | «EFC» como rótulo |
| **Mundial** | **solo** el Campeonato del Mundo («Mundial M20») | para el ranking FIE o para una Copa del Mundo |
| **Copa del Mundo** | la prueba de la FIE de ese nombre | «Copa Mundial», «World Cup» |
| **Gran Premio** | Grand Prix FIE | «GP», «Grand Prix» |
| **Olímpico / Juegos Olímpicos** | JJOO y clasificación olímpica | «JJOO» fuera de un chip estrecho |
| **Florete, Espada, Sable** | armas (con mayúscula en chips y rótulos, en minúscula dentro de una frase) | «FLO/ESP/SAB» salvo en tablas estrechas |
| **Masculino, Femenino, Mixto** | género (M/F solo en tablas estrechas) | «Hombres», «Mujeres» |
| **M13…M23, Absoluto, Veteranos** | categorías (`CATEGORY_LABEL`) | «Absoluta», «Senior», «Júnior», «Cadete» |
| **Tirador / tiradora** | la persona | «atleta», «deportista», «esgrimista» |
| **Seguir / Siguiendo** | la acción y la lista | «Favorito» en pantalla (el código puede seguir llamándolo así) |
| **Tú** | la pestaña propia | «Mi perfil», «Cuenta» |
| **Convocatoria** | la llamada a la selección (color oro) | «citación» |
| **Inscribirme / Solicitar inscripción** | la acción | «Enviar» |
| **Ver todo** | ampliar una lista | «Ver más resultados…», «Mostrar más» |

---

## 7. Piezas (`src/components/sistema/`)

| Fichero | Exporta | Notas |
|---|---|---|
| `tactil.ts` | `SIN_MINIMO`, `AREA_TACTIL`, `FOCO`, `PULSACION`, `MEDIDAS` | clases comunes |
| `boton.tsx` | `Boton` (variante `primario·secundario·claro·contorno·fantasma`, tamano `sm·md·lg`, `ancho="completo"`, `asChild`), `BotonIcono` (`etiqueta` obligatoria) | sin `'use client'` y sin alfa en las superficies |
| `chip-filtro.tsx` | `ChipFiltro` (`tipo` `alternar·menu·quitar`, `marcado`, `contador`, `icono`), `FilaChips` (`envolver`) | `aria-pressed` / `aria-haspopup` |
| `barra-inferior.tsx` | `BarraInferior` (`destinos`, `activa`, `fondo`, `rotulos`, `posicion`, `soloMovil`) | cliente; precarga por intención y memoria por pestaña |
| `cabecera-compacta.tsx` | `CabeceraCompacta` (`variante`, `titulo`, `acciones`, `inicio`, `volverA`), `BotonVolver` | cliente |
| `hoja-inferior.tsx` | `HojaInferior` (`abierta`, `alCambiar`, `titulo`, `descripcion`, `pie`, `disparador`) | Radix Dialog |
| `transicion.tsx` | `TransicionPagina`, `TransicionContenido`, `CLASES_PAGINA` | `<ViewTransition>` de React |
| `navegacion.ts` | `TIPO_TRANSICION`, `pestanaActiva`, `toquePestana`, `hrefDePestana`, `tiposEntre`, `rutaMadre`, `anteriorEsDeLaApp` | lógica pura, con pruebas |
| `gesto-hoja.ts` | `decidirCierre`, `conResistencia` | lógica pura, con pruebas |
| `sistema.css` | las transiciones de página y `prefers-reduced-motion` | se importa desde `globals.css` (§ 8.1) |

Pruebas: `tests/sistema-piezas.test.ts`. Muestra: `tests/ui/sistema-muestra.mts` (servidor `node:http` e hidratación con esbuild, sin `next dev`). Mide que cada control se ve de ≤ 36 px y se toca en ≥ 44, que no hay desplazamiento horizontal y que no hay errores de consola. Hace capturas a 320, 393 y 1440 en `capturas/sistema/`.

La sonda de auditoría (`tests/ui/auditoria-sonda.mts`) mide el objetivo táctil con `getBoundingClientRect` y contará como «pequeños» los controles de 32 px con área por `::after`. En la pasada final hay que enseñarle a leer `getComputedStyle(el, '::after')`, como hace `sistema-muestra.mts`.

## 8. Parches de `globals.css` (NO aplicados)

Otras sesiones dependen de la regla actual. Se aplican al empezar la pasada final, en este orden, y después se pasa la sonda y el barrido.

### 8.1 Importar el movimiento

```diff
 @import 'tailwindcss';
 @import 'tw-animate-css';
+@import '../components/sistema/sistema.css';
```

### 8.2 La regla de 44 px pasa a ser un área táctil invisible

Se sustituye el bloque sin capa que empieza en `/* Fuera de las capas: ni h-8 ni min-w-0 pueden reducir el área interactiva. */` (hoy en la línea ~936):

```diff
-/* Fuera de las capas: ni h-8 ni min-w-0 pueden reducir el área interactiva. */
-:where(
-  button:not([role='switch']):not([role='checkbox']),
-  a[role='button'],
-  [role='tab'],
-  [role='option'],
-  [data-slot='input'],
-  [data-slot='command-input'],
-  [data-slot='command-item']
-) {
-  min-height: 44px;
-  min-width: 44px;
-}
+/*
+ * Objetivo táctil de 44 px SIN tamaño visual de 44 px: un `::after`
+ * transparente centrado en el control. En `@layer base` y con `:where()`
+ * (especificidad 0), así que cualquier utilidad lo puede cambiar: `absolute`
+ * o `fixed` ganan a este `relative`, y `after:*` gana a este `::after`.
+ */
+@layer base {
+  :where(button:not([role='switch']):not([role='checkbox']), a[role='button'], [role='tab']) {
+    position: relative;
+  }
+  :where(button:not([role='switch']):not([role='checkbox']), a[role='button'], [role='tab'])::after {
+    content: '';
+    position: absolute;
+    top: 50%;
+    left: 50%;
+    width: max(100%, 44px);
+    height: max(100%, 44px);
+    translate: -50% -50%;
+  }
+  /* Filas de lista y campos: el área es la propia fila; 40 px bastan. */
+  :where([role='option'], [data-slot='command-item'], [data-slot='input'], [data-slot='command-input']) {
+    min-height: 40px;
+  }
+}
```

Y dentro del `@layer base` que ya hay:

```diff
-    [data-slot='input'],
-    [data-slot='command-input'] {
-      min-height: 44px;
-    }
+    /* Por debajo de 16 px iOS amplía la página al enfocar. */
+    [data-slot='input'],
+    [data-slot='command-input'],
+    textarea {
+      font-size: max(16px, 1em);
+    }
@@
-    .cerrar-hoja {
-      min-width: 44px;
-    }
@@
   .calendario a[href],
   .ranking a[href] {
     display: inline-flex;
     align-items: center;
-    min-height: 44px;
-    min-width: 44px;
+    position: relative;
     max-width: 100%;
     overflow-wrap: anywhere;
   }
+  .calendario a[href]::after,
+  .ranking a[href]::after {
+    content: '';
+    position: absolute;
+    top: 50%;
+    left: 50%;
+    width: max(100%, 44px);
+    height: max(100%, 44px);
+    translate: -50% -50%;
+  }
```

**Qué revisar al aplicarlo:**

- **Controles que hoy se ven de 44 porque la regla los estira** (`size="sm"` de shadcn con `h-11`, `h-8` dentro de un `button`) bajarán a su tamaño real. Hay que repasar `src/components/ui/button.tsx`: todos sus tamaños son `h-11`/`size-11`, y deberían pasar a 32/36 px con área por `::after`, o retirarse en favor de `Boton`.
- **`position: relative` en todos los `button`.** Si alguno tiene un hijo `absolute` que se colocaba respecto a un antepasado, ahora se colocará respecto al botón. Para encontrarlos: `rg "<button[^>]*>[^<]*<[^>]*absolute"` y mirar las capturas de la sonda.
- **Recortes.** Un área `::after` se recorta dentro de un contenedor con `overflow: hidden/auto`. Las filas desplazables de chips necesitan 6 px de margen vertical (`FilaChips`).
- **`SIN_MINIMO`** (`min-h-0! min-w-0!`) en `filtros/chips.tsx` y en el sistema deja de hacer falta, pero no estorba.

### 8.3 Fuera la raíz de 18 px (después de 8.2, pantalla a pantalla)

```diff
-  @media (max-width: 639px) {
-    html {
-      font-size: 18px;
-    }
-  }
```

La raíz de 18 px agranda un 12,5 % todo lo que va en rem en el móvil. Las piezas del sistema van en px y no les afecta. Se quita cuando las pantallas ya usen la escala de § 2. Si se quitara antes, el texto en rem de las pantallas sin migrar bajaría de 15,75 a 14 px de golpe.

### 8.4 El hueco de la barra, una sola regla

```diff
   .hueco-barra {
-    padding-bottom: calc(3.25rem + env(safe-area-inset-bottom));
+    padding-bottom: calc(50px + env(safe-area-inset-bottom));
   }
-  @media (max-width: 1023.98px) {
-    .hueco-barra:has(nav[data-barra='explorar']) { … }
-    .hueco-barra:has(nav[data-barra='explorar']) > header > .ancho-app { … }
-    .hueco-barra:has(nav[data-barra='explorar']) > main { … }
-  }
```

Y `scroll-padding-top: 5rem` pasa a `calc(48px + env(safe-area-inset-top) + 8px)`, y `scroll-padding-bottom` a `calc(50px + env(safe-area-inset-bottom) + 8px)`.

### 8.5 `themeColor`

En `src/app/layout.tsx`, `themeColor: '#09090b'` no es el color de `--background` (`oklch(0.17 0.008 265)`, un grafito azulado). La barra de estado del iPhone y la de Android quedan de otro negro que la cabecera. Hay que poner el hexadecimal de `--background`, medido con `npm run contraste`.

## 9. Transparencias mal hechas

Las líneas son las de este momento: varias de estas pantallas las están cambiando otras sesiones. Se buscan otra vez con `rg "bg-[a-z-]+/\d+|backdrop-blur|from-[a-z-]+/\d+"`.

| Fichero:línea | Ahora | Propuesta |
|---|---|---|
| `src/app/(app)/layout.tsx:187` | aviso de datos viejos `bg-warn/10` sobre la cabecera | lo quita § 1.2. Si se queda, usar el token opaco `--warn-tinte: color-mix(in oklab, var(--warn) 12%, var(--card))` |
| `src/app/(app)/layout.tsx:197` | franja de vista previa `bg-warn/10` sobre el lienzo con textura | `bg-warn-tinte` (deja pasar la retícula) |
| `src/components/explorar/ficha-deportiva.tsx:124` | baldosa de hito `bg-background/40` | `bg-card` (o `bg-secondary` si va sobre una tarjeta) |
| `src/components/explorar/ficha-deportiva.tsx:250` | segmento `bg-org-rfee/70` | `bg-org-rfee-relleno` |
| `src/components/explorar/perfil/destacados-perfil.tsx:124` | tarjeta `bg-background/40` | `bg-card` |
| `src/components/explorar/cara-a-cara.tsx:159` | degradado `from-marcado/70` en la cabecera | `from-marcado` (ya es un tinte opaco) |
| `src/components/explorar/cara-a-cara.tsx:489, 620, 662, 728` · `relevos.tsx:62, 81` · `perfil/historial-perfil.tsx:98` · `perfil/fila-resultado.tsx:58` | `hover:bg-secondary/60` | `hover:bg-secondary` (sobre `--card`) o `hover:bg-accent` (sobre `--secondary`) |
| `src/components/explorar/cara-a-cara.tsx:527` | cabecera de grupo `bg-secondary/50` | `bg-secondary` |
| `src/components/explorar/buscador-social-fila.tsx:86` · `buscador-social.tsx:286` | `hover:bg-accent/50` | `hover:bg-secondary` |
| `src/components/tirador/cabecera.tsx:273` | `border-primary/50 bg-primary/10` y `bg-secondary/60` | `bg-marcado` y `bg-secondary` |
| `src/components/olimpica/prueba-olimpica.tsx:75, 187` | tu fila `bg-primary/10` | `bg-marcado` |
| `src/components/olimpica/pastilla-olimpica.tsx:7-8, 14-15` | `bg-ok/15`, `bg-warn/15`, `/30` y bordes `/45` | `--ok-tinte` / `--warn-tinte` opacos (como `--org-*-tinte`) y sin borde |
| `src/components/estado/pruebas.tsx:370, 379` | `bg-ok/10`, `bg-secondary/60` | `bg-ok-tinte`, `bg-secondary` |
| `src/components/ranking/tabla-ranking.tsx:181` · `tabla-oficial.tsx:401` | corte de convocatoria `bg-gold/5` con borde discontinuo `/60` | `--gold-tinte` opaco (5-8 % en `--card`) y un filete sólido `border-gold` |
| `src/components/perfil/calendarios.tsx:93` | `bg-muted/40` | `bg-secondary` |
| `src/components/notificaciones/ajustes.tsx:91, 243` | `bg-muted/30`, `bg-warn/10` | `bg-card`, `bg-warn-tinte` |
| `src/components/calendario/horarios-torneo.tsx:443` | `bg-primary/5` | `bg-marcado` |
| `src/components/calendario/barra-plazos.tsx:237` | marca `bg-background/90` | `bg-background` |
| `src/components/convocatorias/elegir-convocados.tsx:356` | `hover:bg-muted/40` | `hover:bg-secondary` |
| `src/app/(app)/documentos/page.tsx:302, 461` | `hover:bg-accent/40`; `border-border/50 bg-muted/30` | `hover:bg-secondary`; `border-filete bg-card` |
| `src/components/escudo.tsx:229` | plato `bg-white/90` detrás del escudo | `bg-white` (el 10 % deja ver la retícula detrás del escudo) |
| `src/components/ui/button.tsx:11, 13` · `ui/badge.tsx:11, 15` · `filtros/chips.tsx:357` · `app/global-error.tsx:47` | `hover:bg-primary/90`, `dark:bg-destructive/60` | `hover:brightness-110`; `bg-destructive` opaco |
| `src/components/admin/*` (`alta-tirador.tsx:209`, `ajustes-panel.tsx:236, 451`, `usuarios-panel.tsx:484, 516, 792, 840`) · `app/entrar/page.tsx:119` · `app/(app)/ajustes/notificaciones/page.tsx:41` | avisos `bg-warn/5`, `bg-destructive/5`, `bg-primary/5`, `bg-destructive/10` | tokens `--warn-tinte`, `--danger-tinte`, `bg-marcado` (prioridad baja) |
| `src/components/ui/kbd.tsx:10` · `ui/dropdown-menu.tsx:76` | alfa dentro de un tooltip o de un menú (sobre superficie opaca) | se pueden quedar: van sobre un panel opaco |

**Se quedan, porque están bien hechas:**

- `sheet.tsx`, `dialog.tsx` (`bg-velo`), que son velos;
- `calendario/cabecera-ficha.tsx:101` y `acceso/fondo-competicion.tsx:221-223, 299-300`, que son degradados de legibilidad sobre una foto;
- `.acrilico` / `fondo/acrilico.tsx`, que tiene desenfoque real sobre una foto.

## 10. Plan de aplicación (pasada final)

En este orden. Cada paso es una entrega con sus capturas a 320, 393 y 1440, la sonda y el barrido.

1. **Base:**
   - § 8.1 (importar `sistema.css`), § 8.2 (área táctil), § 8.4 (hueco de la barra) y § 8.5 (`themeColor`);
   - `staleTimes.dynamic: 30` en `next.config.ts`;
   - la sonda aprende a medir el `::after`;
   - `ui/button.tsx` pasa a 32/36 px.
2. **Armazón** (`(app)/layout.tsx`, `nav.tsx`, `explorar/barra-explorar.tsx`):
   - en el móvil se quita la cabecera global y `NavMovil`/`BarraExplorarMovil`, y entra `BarraInferior` con los cinco destinos de § 1.1;
   - en escritorio se queda la cabecera de 56 px de § 1.6;
   - `BotonAtras` deja paso a la `CabeceraCompacta` de cada pantalla;
   - el aviso de datos viejos baja al Calendario.
3. **Calendario** (`/`, `components/calendario/*`):
   - `CabeceraCompacta` raíz con la campana;
   - los filtros pasan a `FilaChips` (armas como `ChipFiltro`, «Filtros» como `tipo="menu"`, que abre una `HojaInferior`);
   - la ficha de torneo pasa de hoja lateral a subpantalla con `nav-avanzar`, o a `HojaInferior` si es una vista rápida;
   - `TransicionContenido` al cambiar de mes;
   - se quitan las transparencias de § 9.
4. **Explorar** (`/explorar`, `[personaId]`, `cara-a-cara`, `siguiendo`, `favoritos`):
   - fuera los `loading.tsx` y `esqueletos.tsx` (§ 5.2);
   - `CabeceraCompacta` raíz «Explorar» con la campana; el perfil y el cara a cara, como subpantalla;
   - los enlaces a fichas con `transitionTypes={['nav-avanzar']}` y precarga por intención;
   - «Siguiendo» pasa a Tú;
   - se quitan las transparencias de `ficha-deportiva`, `destacados-perfil`, `cara-a-cara`, `relevos` e `historial-perfil`.
5. **Buscar** (`/explorar/buscar`, `ediciones`):
   - campo de 40 px con texto de 16 px;
   - filtros en `FilaChips` y la `HojaInferior` de filtros;
   - fuera `loading.tsx`.
6. **Ranking** (`/ranking`, `components/ranking/*`):
   - el selector Nacional / Internacional / Europeo como `FilaChips` de `ChipFiltro`;
   - el resto de filtros en `HojaInferior`;
   - `TransicionContenido` al cambiar de arma o temporada;
   - el corte de convocatoria en `--gold-tinte`;
   - fuera `loading.tsx`;
   - repasar «Mundial» con el diccionario.
7. **Olímpica** (`components/olimpica/*`):
   - pastillas con tintes opacos y sin borde;
   - tu fila en `bg-marcado`;
   - «Internacional» según el diccionario.
8. **Tú** (`/explorar/yo`, `/perfil`, `/estado`, `/ajustes`, notificaciones):
   - una lista de filas de 48 px: Mi estado (tiradores), Siguiendo, Convocatorias, Mis tiradores (club o seleccionador), Notificaciones, Calendarios, Gestión (administración) y Salir;
   - cada fila es una subpantalla con `CabeceraCompacta`.
9. **Notificaciones:** la campana de la cabecera abre `/notificaciones` como subpantalla, y la insignia es el punto rojo de la barra o de la campana.
10. **Cierre:**
    - § 8.3 (fuera la raíz de 18 px);
    - repaso del texto con el diccionario de § 6;
    - capturas finales en `capturas/pasada-final/`.
