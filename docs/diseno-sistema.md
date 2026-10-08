# Sistema de diseño y navegación

Especificación de la pasada visual. Manda sobre `UI.md` donde lo contradiga (tamaños de control, convención de marcado, movimiento). Las piezas están en `src/components/sistema/` y se ven en `capturas/sistema/` (`npx tsx tests/ui/sistema-muestra.mts`).

Referencia: Instagram. Es la interfaz que ya conoce la gente: una barra de iconos abajo, una cabecera fina arriba, el contenido a sangre y controles pequeños.

Cinco reglas:

1. **Una sola barra**, igual en toda la aplicación.
2. **Controles pequeños, área grande:** se ven de 28-36 px y se tocan en 44.
3. **Superficies opacas; cristal solo en lo que flota.** Tarjetas, filas y campos son sólidos. La cabecera, la barra inferior y los paneles flotantes (hoja, diálogo, menú, `popover`, `select`) son cristal (§ 3.2). Ni brillos, ni manchas, ni texturas detrás del texto.
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
| Tú | la foto propia de 24 px (`CircleUserRound` si no hay) | `/explorar/yo` | `/perfil`, `/estado`, `/ajustes` |

- **Medidas:** 50 px de alto más `env(safe-area-inset-bottom)`. Iconos de 22 px; trazo de 1,7, y de 2,4 en la pestaña activa. Sin rótulos: el nombre va en `aria-label`. Con `rotulos="visibles"` se añade un rótulo de 10 px, solo si las pruebas con usuarios muestran que hace falta.
- **Pestaña activa:** el icono en `--foreground` con trazo grueso; las demás en `--muted-foreground`. No lleva pastilla, punto ni contorno rojo.
- **Fondo:** cristal (`fondo="cristal"`, por defecto: `.cristal`, § 3.2) con su canto de 1 px arriba. `fondo="solido"` deja `bg-background`. La variante antigua `fondo="material"` (82 %, `blur(20px) saturate(1.6)`) no la usa ninguna pantalla y se puede retirar.
- **Precarga:** al poner el dedo en una pestaña (`EnlacePrecarga alPulsar`), además de ratón detenido y foco de teclado; y una vez por sesión, con el navegador ocioso (`requestIdleCallback`, 4 s de tope; 2 s con `setTimeout` donde no existe), las raíces de las demás pestañas, solo en 4G y sin ahorro de datos (`redHolgada()` en `red-cliente.ts`). Nada con ahorro de datos, 2G o sin red (`ahorrarDatos()`). Las pestañas salen de `destinos` (`DESTINOS_APP`), no de una lista en la barra.
- **Insignia:** un punto rojo de 7 px con anillo del color del fondo. Indica novedades y nada más; nunca lleva un número.
- **Foto en «Tú»:** como en Instagram, la pestaña lleva la foto de la ficha deportiva vinculada (24 px, redonda) y, marcada, un aro fino de 1,5 px en `--foreground` con 1,5 px de aire. Sin ficha vinculada, sin foto publicada o si la foto falla, el icono. La foto no va en el HTML ni en el layout: `useRetratoPropio` (`retrato-propio.ts`) pide después de pintar `/api/explorar/yo/retrato?cuenta=<profileId>` (respuesta `private`, una hora, `Vary: Cookie`) y luego la foto por la ruta de siempre. Ninguna pantalla hace una consulta más a D1 y la caché compartida no ve datos de la cuenta.
- **Quieta al desplazar:** `position: fixed` en su propia capa (`translateZ(0)`), sin transiciones de `transform`, y el documento sin rebote elástico (`overscroll-behavior-y: none` en `html` y `body`, ver § 4). El armazón usa `min-h-svh` y no `min-h-dvh`, que en Safari cambia de alto mientras se esconde su barra y recoloca la página.
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

- **Medidas:** 48 px de alto más `env(safe-area-inset-top)` (el layout raíz usa `viewportFit: 'cover'`). En reposo tiene el color del lienzo; cuando el contenido ya pasa por debajo (`data-desplazada`) pasa a cristal (`.cristal`) con el canto inferior.
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
  - superficie `.cristal-panel` (`--popover` al 86 % con desenfoque) y velo `--velo`, sin desenfoque;
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

Todo en **px**, no en rem. La raíz es de 16 px en todos los tamaños: la de 18 px por debajo de 640 px, que hacía crecer un 12,5 % cualquier `h-11`, `text-sm` o `size-5` en el móvil, se quitó en la pasada final (§ 8.3). Era la otra mitad de los «botones enormes», además de la regla global de 44 px (§ 8.2).

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
- **Tipografía:** los tamaños de Tailwind, y no hay más. Nada de `text-[13px]` ni `text-[0.6875rem]`.

  | Clase | px / interlineado | Uso |
  |---|---|---|
  | `text-2xl` | 24 / 32 | titular de una ficha (Barlow Condensed 600) |
  | `text-xl` | 20 / 28 (`leading-6` en la cabecera) | título de pestaña (Barlow Condensed 600) |
  | `text-lg` | 18 / 28 | nombre destacado, cifra secundaria |
  | `text-base` | 16 / 24 (`leading-5` en una fila) | título de subpantalla y de hoja, campos de texto |
  | `text-sm` | 14 / 20 | texto de lista, párrafos, botones y chips |
  | `text-xs` | 12 / 16 | fecha, contador, metadato (`--muted-foreground` u `--off`) |

  Por encima de 24 px solo las cifras (`.cifra`, Barlow Condensed): la **cifra que importa** de una pantalla (puesto, días que faltan), a 28-48 px, una o dos por pantalla. Y 10 px solo para los rótulos opcionales de la barra. La jerarquía se hace con tamaño y peso (400/500/600), nunca con alfa sobre el color del texto (`text-muted-foreground/70` está prohibido: para un texto más apagado está `--off`).
- **Espaciado:** múltiplos de 4 px; la escala de Tailwind (`1` = 4 px) sin medios pasos (`py-1.5`, `gap-0.5`) ni valores arbitrarios que no sean múltiplo de 4 (`py-[6px]`). Lo habitual es 4 / 8 / 12 / 16 / 24.
  - 16 px de margen lateral en el móvil y 24 desde 640 px;
  - 8 px entre controles de una fila;
  - 12 px entre filas de un bloque;
  - 24 px entre bloques.
- **Radios:** 6 / 12 / redondo.
  - `rounded-full` en botones, chips, avatares e insignias;
  - `rounded-xl` (12 px) en tarjetas, bloques sueltos y diálogos;
  - `rounded-md` / `rounded-lg` (6 px, `--radius`) en tablas, celdas, menús y campos;
  - 16 px arriba en la hoja inferior, que es la excepción;
  - `rounded-sm` (4 px) solo en piezas de menos de 24 px.
- **Sin desplazamiento horizontal.** Ningún carril de chips, pestañas o tarjetas que se desplace de lado: lo que no cabe se envuelve en varias líneas, se resume («+3») o va a una hoja. Solo las tablas y visores de datos que lo necesitan por formato (`ui/table.tsx`, la matriz de poule, el registro de `admin/cuarentena-panel.tsx`) pueden desplazarse en horizontal, dentro de su contenedor y nunca la página.
- **El trinquete:** `tests/ui/estilo-sistema.test.ts` cuenta por fichero los desplazamientos horizontales, los tamaños de letra arbitrarios, el espaciado fuera de escala, el alfa sobre tokens de texto y los brillos (degradados radiales o cónicos, grano SVG, sombras de color sin desplazamiento, manchas `blur-3xl`). Ningún fichero puede subir respecto a `tests/ui/estilo-sistema.base.json`; al bajar, se fija la base nueva con `ACTUALIZAR_BASE=1 npx vitest run tests/ui/estilo-sistema.test.ts`.
- **Sombras:** solo en lo que flota: la hoja (`--sombra-hoja-aba`) y los paneles de escritorio (`--sombra-flotante`). Ni las tarjetas ni los botones llevan sombra; las superficies se separan con el filete de 1 px.

## 3. Color, contraste y modo oscuro

- **La aplicación es oscura** (`<html class="dark">`, `color-scheme: dark`). No hay tema claro y no se añade en esta pasada. Si llega, se hará con los mismos tokens y sin tocar las piezas.
### 3.1 Tokens

Un solo sistema: hexadecimal para lo opaco, `rgba()` para cantos, velo y cristal. `tests/contraste-tokens.test.ts` lee `globals.css` y comprueba cada par; `npm run contraste` lo mide en Chrome con la cascada real.

| Token | Valor | Uso | Contraste |
|---|---|---|---|
| `--background` | `#090A0F` | lienzo, plano | — |
| `--card` | `#12141C` | tarjeta, fila, tabla, bloque | — |
| `--popover` | `#1A1D27` | base de hoja, diálogo y menú | — |
| `--secondary` / `--muted` | `#232733` | control: campo, pastilla neutra, cabecera de tabla | — |
| `--accent` | `#2A2E3B` | `hover` de un control | — |
| `--marcado` | `#3A1714` | control marcado (con borde y texto `--primary-text`) | rótulo rojo 5,74 |
| `--foreground` | `#E8EAF0` | texto | 16,4 (lienzo) – 11,3 (`accent`) |
| `--muted-foreground` | `#A1A6B4` | texto secundario | 8,1 – 5,6 |
| `--off` | `#9197A6` | el texto más apagado permitido | 6,8 – 4,6 |
| `--primary` | `#C60C1E` | relleno de la acción principal | blanco encima 6,0; relleno/lienzo 3,3 |
| `--primary-text` / `--ring` | `#FF6B63` | rojo como texto, foco, contorno del marcado | 7,1 – 4,9 |
| `--destructive` | `#FF6168` | texto destructivo | 6,7 – 4,6 |
| `--gold` · `--ok` · `--warn` · `--danger` | `#EEBB58` · `#54D795` · `#F4BE4F` · `#FF666F` | convocatoria y semáforo | ≥ 4,8 en todas |
| `--org-rfee/fie/efc/aut` | `#F7CCC7` · `#61A4FF` · `#6CE7EB` · `#9A9EA7` | identidad de organismo | ≥ 5,0 en todas |
| `--org-*-relleno` | `#773733` · `#18417C` · `#005B5C` · `#313337` | barra sólida, texto blanco | 6,6 – 10,5 |
| `--*-tinte` | `card` + 14 % (organismos) o 12 % (avisos) en OKLab | pastilla o aviso teñido, opaco | su color encima ≥ 5,6 |
| `--borde-campo` | `#7A7F8C` | canto de un campo de texto | ≥ 3,4 (1.4.11) |
| `--border` · `--input` | `rgba(255,255,255,.08)` · `.14` | separadores; borde de tarjeta y chip | decorativo |
| `--filete` · `--filete-alto` | `rgba(255,255,255,.06)` · `.12` | canto de luz de una superficie | decorativo |
| `--velo` | `rgba(0,0,0,.65)` | detrás de hojas y diálogos | — |
| `--canto-luz` | `inset 0 1px 0 rgba(255,255,255,.04)` | realce opcional de una tarjeta sólida | — |

- **Superficies opacas por nivel:** a más elevación, gris más claro; nunca más transparente. El lienzo es plano: sin retícula, grano, cuñas, bandas ni degradados de color. Las antiguas `.fondo-pantalla`, `.fondo-cabecera`, `.fondo-panel`, `.tinte-*`, `.acrilico` y `<Fondo>`/`<Acrilico>` se retiraron; si algo necesita color de procedencia, un filete de 2 px (`border-t-2 border-gold`) o un punto basta.
- Dentro de una hoja, los controles suben a `--accent`; `ChipFiltro` ya lo hace.

### 3.2 Cristal

| Clase | Fondo | Filtro | Canto | Dónde |
|---|---|---|---|---|
| `.cristal` | `rgba(18,20,28,.72)` (`--card` al 72 %) | `blur(16px) saturate(1.2)` | `rgba(255,255,255,.08)` | cabecera (al desplazar) y barra inferior |
| `.cristal-panel` | `rgba(26,29,39,.86)` (`--popover` al 86 %) | ídem | ídem | hoja inferior, `ui/sheet`, `ui/dialog`, `ui/popover`, `ui/dropdown-menu`, `ui/select` |

- **Por qué las tarjetas no llevan cristal.** El desenfoque solo se ve si detrás hay algo distinto que desenfocar. Una tarjeta está sobre el lienzo plano: desenfocar un color liso da el mismo color, y cada elemento con `backdrop-filter` es una capa compuesta más que un Android modesto paga en cada fotograma de scroll. Tarjetas, filas y celdas fijas (`sticky`) dentro de un contenedor con scroll van **sólidas** (`--card` + borde de 1 px + `--canto-luz` si hace falta).
- **Presupuesto: tres capas desenfocadas como mucho.** Cabecera + barra + un panel. Con una hoja o un menú modal abiertos, Radix marca `body[data-scroll-locked]` y las barras (bajo el velo) pasan a sólido.
- **Alternativas sólidas:** sin soporte de `backdrop-filter`, con `prefers-reduced-transparency: reduce` o `prefers-contrast: more`, la barra pasa a `--cristal-solido` (`#0F1118`, el mismo tono que el cristal sobre el lienzo) y el panel a `--popover`. Lo mismo durante una transición de página (`:root:active-view-transition`), porque la captura de la cabecera no ve lo de debajo.
- **Contraste:** el texto pasa AA sobre la barra con el lienzo detrás y sobre el panel con el velo encima de una foto blanca (peor caso). El rojo como texto también.
- Las clases van en `@layer components`: un `bg-*` del propio elemento las anula, que es la forma de volver a sólido.
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
  - texto AA, 4,5:1, para todos los tokens de texto sobre todas las superficies (`--off` incluido, también sobre `--accent`);
  - los iconos sin texto y los cantos que son la única señal de un control, 3:1 contra su fondo.
- **Transparencias:** solo valen tres.
  1. Un velo (`--velo`) detrás de una hoja o un diálogo.
  2. Un degradado lineal de legibilidad sobre una **foto** (la cabecera de un torneo con foto, el acceso).
  3. El cristal de § 3.2.

  El resto es un token opaco. Para un tinte se usa un `--*-tinte` (ya están `--org-*`, `--warn`, `--ok`, `--danger` y `--gold`). Lista de casos en § 9.
- **Filetes:** se pueden escribir como blanco con alfa (`--filete`, `--filete-alto`), porque son líneas de 1 px y no superficies.

## 4. Movimiento

| Qué | Duración | Curva |
|---|---|---|
| Pulsar un control (`.pulsable`: `scale` a 0,98; `--sis-pulsar`) | 120 ms | `--sis-curva` |
| Cambio de color o estado | 150 ms | ease-out |
| Indicador de un segmentado o de pestañas (`.sis-indicador`, `--sis-indicador`) | 180 ms, solo `translate`/`scale`/`opacity` | `--sis-curva` |
| Cambiar de pestaña (fundido) | 90 ms salida + 150 entrada | `--sis-curva` |
| Avanzar o volver (28 px + fundido) | 120 salida, 200 entrada (60 ms de retardo), 260 desplazamiento | `cubic-bezier(.2,0,0,1)` |
| Mismo sitio, otro contenido (`TransicionContenido`: arma, temporada, ámbito) | 90 + 150 ms | ídem |
| Hoja inferior, hoja lateral y diálogo (`--sis-hoja-entrada/salida`) | 240 ms al abrir, 180 al cerrar; desplazamiento + fundido (el diálogo sube 8 px) | `--sis-curva-hoja` (la de iOS) al abrir |
| Menú, `popover`, `select` (`--sis-panel-entrada/salida`) | 160 / 120 ms; 8 px + fundido, sin `zoom` | `--sis-curva` |
| Pulsar una pestaña de la barra | icono a 0,86 mientras se pulsa, 150 ms | ease-out |
| Pestaña que pasa a marcada (`.sis-marcar`) | de 0,9 a 1 en 180 ms, sin pasarse | `--sis-curva` |
| Aparición de lista o tarjeta (`.sis-aparecer`, `.sis-aparecer-lista`) | 180 ms de opacidad; 20 ms de escalonado en las 8 primeras filas | `--sis-curva` |

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

### 4.1 Pautas de movimiento

- **Corto y sin rebote.** Entre 150 y 250 ms; nada de muelles, curvas que se pasan ni animaciones en bucle. El retardo acumulado de un escalonado no pasa de 140 ms.
- **Sólo `opacity` y `scale`/`translate`.** Nunca alto, ancho, márgenes ni `top`: lo que aparece no empuja a nada (CLS 0). Las listas aparecen con un fundido, no deslizándose.
- **Las listas se animan al entrar en el DOM**, no al hacer scroll: la primera pantalla y cada página nueva del feed. Una fila que ya estaba no vuelve a animar.
- **Lo fijo no se mueve.** La cabecera y la barra no tienen transiciones de `transform` y el documento no rebota (`overscroll-behavior-y: none`). Lo que hace scroll por dentro (hojas, matrices, carriles de chips) lleva `overscroll-contain`.
- **Hojas, diálogos, menús y `popover`** se ajustan desde `sistema.css` por `data-slot` con `--tw-animation-duration` y `--tw-ease`; los componentes solo dicen el sentido (`slide-in-from-*`, `fade-in-0`).
- **Un menú es más rápido que una hoja.** Se abre y se cierra muchas veces seguidas; a 240 ms se nota lento.
- **`prefers-reduced-motion`** quita además `.sis-marcar`, las apariciones (`animation: none`) y el hundido de `.pulsable`, porque la regla global acorta la duración pero no el retardo del escalonado.

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
4. **Precarga por intención.** `EnlacePrecarga` hace `prefetch` completo (`prefetch={true}` tras la intención) al detener el ratón 120 ms o al enfocar con teclado, y con `alPulsar` también al poner el dedo (solo la barra de pestañas: en una lista, poner el dedo no distingue pulsar de desplazar). No se precarga al entrar en la ventana: son rutas dinámicas y con miles de usuarios serían cuatro renderizados de servidor por visita. La única precarga sin intención es la de las raíces de las pestañas, una vez por sesión, ocioso, en 4G y sin ahorro de datos (§ 1.1). Con ahorro de datos, 2G o sin red no se precarga nada.
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
| `enlace-precarga.tsx` | `EnlacePrecarga` (`alPulsar`) | precarga por intención (§ 5.4) |
| `red-cliente.ts` | `ahorrarDatos`, `redHolgada` | cuándo no se precarga y cuándo se puede precargar sin intención |
| `sistema.css` | tokens de movimiento, `.pulsable`, `.sis-indicador`, las transiciones de página, las de hojas, diálogos y menús, y `prefers-reduced-motion` | se importa desde `globals.css` (§ 8.1) |

Pruebas: `tests/sistema-piezas.test.ts`. Muestra: `tests/ui/sistema-muestra.mts` (servidor `node:http` e hidratación con esbuild, sin `next dev`). Mide que cada control se ve de ≤ 36 px y se toca en ≥ 44, que no hay desplazamiento horizontal y que no hay errores de consola. Hace capturas a 320, 393 y 1440 en `capturas/sistema/`.

La sonda de auditoría (`tests/ui/auditoria-sonda.mts`) y la matriz de dispositivos (`tests/ui/matriz-medir.mts`) miden el área táctil real: la caja del control o su `::after` (`getComputedStyle(el, '::after')`), la mayor, recortada por los antepasados con `overflow` distinto de `visible`. La matriz afina dos casos: en una zona desplazable recorta como si se hubiera desplazado lo justo para ver el control (una fila más abajo de una lista con scroll no cuenta como pequeña), y lo que un antepasado oculta del todo (lo plegado bajo «Ver todo») no se cuenta. El informe escribe «44x44 (se ve 32x32)» cuando el área sale del `::after`.

## 8. Parches de `globals.css` (aplicados)

Estado: 8.1, 8.2, 8.4 y 8.5 se aplicaron en las olas; 8.3 (fuera la raíz de 18 px) en la pasada final. Se dejan escritos como referencia de qué cambió y qué hay que revisar si se toca.

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

La raíz de 18 px agrandaba un 12,5 % todo lo que va en rem en el móvil. Las piezas del sistema van en px y no les afecta. Al quitarla, el texto en rem bajó de 15,75 a 14 px y los rótulos de 11 px (`text-[0.6875rem]`) y 10 px (`text-[0.625rem]`), que en el móvil se veían a 12,4 y 11,25, se quedaban en 11 y 10. Por eso, en la misma entrega, todo rótulo por debajo de 12 px pasó a `text-[12px]` (pastilla de país, insignia de organismo, ejes y leyendas de los gráficos, cifras del perfil, «Dirección técnica» de la cabecera de escritorio…). Sólo quedan por debajo los rótulos opcionales de 10 px de la barra.

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

`themeColor` en `src/app/layout.tsx` y `background_color` / `theme_color` en `src/app/manifest.ts` tienen que ser el hexadecimal de `--background`, hoy `#090A0F`. Si no, la barra de estado del iPhone y la de Android quedan de otro negro que la cabecera.

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
| `src/components/ui/button.tsx:11, 13` · `ui/badge.tsx:11, 15` · `app/global-error.tsx:47` | `hover:bg-primary/90`, `dark:bg-destructive/60` | Hecho en la pasada final en `badge.tsx` y `global-error.tsx` (`hover:brightness-110`, `bg-destructive` opaco). La cita a `filtros/chips.tsx:357` se retiró: esa línea ya no existe. |
| `src/components/admin/*` (`alta-tirador.tsx:209`, `ajustes-panel.tsx:236, 451`, `usuarios-panel.tsx:484, 516, 792, 840`) · `app/entrar/page.tsx:119` · `app/(app)/ajustes/notificaciones/page.tsx:41` | avisos `bg-warn/5`, `bg-destructive/5`, `bg-primary/5`, `bg-destructive/10` | tokens `--warn-tinte`, `--danger-tinte`, `bg-marcado` (prioridad baja) |
| `src/components/ui/kbd.tsx:10` · `ui/dropdown-menu.tsx:76` | alfa dentro de un tooltip o de un menú (sobre superficie opaca) | se pueden quedar: van sobre un panel opaco |

**Se quedan, porque están bien hechas:**

- `sheet.tsx`, `dialog.tsx` (`bg-velo`), que son velos;
- `calendario/cabecera-ficha.tsx:101` y `acceso/fondo-competicion.tsx:221-223, 299-300`, que son degradados de legibilidad sobre una foto;
- el cristal de § 3.2 (`.cristal`, `.cristal-panel`), que tiene desenfoque real. `.acrilico` y `fondo/acrilico.tsx` se retiraron: no los usaba nadie.

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
10. **Cierre** (hecho, ver § 11):
    - § 8.3 (fuera la raíz de 18 px);
    - repaso del texto con el diccionario de § 6;
    - capturas finales: la matriz completa en `capturas/matriz/`, con la línea base medida antes de la pasada (`linea-base.*`) y la comparación (`comparacion-linea-base.md`).

## 11. Pasada final: lo que se hizo

- **Matriz** (`tests/ui/matriz-medir.mts`): mide el área táctil real con el criterio de la sonda (§ 7). Base por defecto: `nuevo11.sqlite`.
- **Raíz de 16 px** en todos los tamaños (§ 8.3) y ningún rótulo por debajo de 12 px: `BanderaPais` (pastilla de 12 px, 18 px de alto como antes), `InsigniaOrganismo` (12 px), `EjeX`, `Guias` y `Leyenda` (12 px; el hueco mínimo entre rótulos del eje sube de 13 a 15 % y de 20 a 24 % en estrecho), la segunda línea de la cuenta en `cabecera-escritorio.tsx` y los rótulos del perfil y de los gráficos.
- **Toque:** `BotonVolver` ya se tocaba en 44 px con el `::after` de `BotonIcono`; la matriz lo confirma. Los enlaces a las pruebas de una ficha de torneo (`prueba-resultados.tsx`, `resultados-torneo.tsx`) dejan de bajar a 21 px desde 768 px (iPad): se quedan en 44. Las filas `Item` pequeñas miden 44 px y no 46. En la página de una prueba, las poules van en dos columnas sólo desde 1280 px: a 1024 el nombre se quedaba en 19 px.
- **El nombre enlazado del feed** (`tarjeta-feed.tsx`) se toca en la tarjeta entera por su `after:inset-0`; la matriz, que antes medía los 18 px de la línea, ya no lo cuenta.
- **Sin esqueletos:** fuera `estado/loading.tsx`, `ui/skeleton.tsx`, el esqueleto de `HistorialPropio` en `/perfil` y los `CargandoPestana` de `FichaCompleta` (las pestañas diferidas esperan con `fallback={null}`). Los avisos de espera para lectores de pantalla siguen, sin «Cargando…».
- **Textos:** diccionario de § 6 en circuitos (`CIRCUIT_LABEL`, `CIRCUIT_SHORT`: «Copa del Mundo M17», «Gran Premio», «Satélite», «Circuito Europeo M17», «Mundial» para el Campeonato del Mundo), categorías (`CATEGORIAS_DEPORTIVAS`: M20, M17… en vez de «Júnior (M20)»), filtros de organismo y de fuente (Internacional, Europeo, Nacional), leyenda de la dispersión de puestos, «Puntos» en la ficha FIE, «Perfil deportivo» en Tú, y párrafos de `/perfil`, `/estado` y la tabla oficial reducidos a una línea.
- **Limpieza:** fuera `calendario/banda-resultados.tsx` y su prueba (nadie lo importaba). La acción `explorar/resultados-evento.ts` se queda: la usa la matriz de acceso anónimo.
