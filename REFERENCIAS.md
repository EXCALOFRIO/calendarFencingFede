# Dirección visual: de dónde sacamos el aspecto

Este documento existe porque el usuario dijo, mirando la aplicación:

> «ahora es como una interfaz muy poco cuidada y se puede mejorar mucho y quedar
> más profesional»

y porque acto seguido dio **referencias concretas**, que es lo que faltaba. Antes
las decisiones de aspecto se tomaban por adjetivos —«más moderno», «menos
plano»— y eso no se puede verificar. Ahora hay cuatro pantallas reales contra las
que comparar.

**Esto no sustituye a `UI.md`**, que sigue siendo el contrato: mismas reglas de
contraste, misma prohibición de los tics de «generado por IA», móvil primero y
letra grande. Esto dice **de dónde copiamos la ambición**.

---

## 0. Ve a mirarlas tú

No te fíes de esta descripción. Las cuatro son públicas y se abren con Playwright
en veinte segundos:

| Referencia | URL |
|---|---|
| Ficha de tirador | `https://fie.org/athletes/39653` |
| Cara a cara | misma ficha → botón «Head to head» |
| Seguimiento de ranking | misma ficha, más abajo: «World Ranking Tracker» |
| Ficha de torneo | `https://fie.org/events` → cualquiera, p. ej. Casablanca World Cup 2026 |

Captúralas, ábrelas con Read y míralas antes de escribir una línea. En este
proyecto **un `200` no dice nada**; con más razón cuando lo que se copia es el
aspecto.

Dos avisos que costaron tiempo y están comprobados: **el listado es
`fie.org/events`; `fie.org/tournaments` devuelve 404** (las fichas sueltas sí
son `fie.org/tournaments/<año>/<id>`), y **hay un aviso de cookies que tapa la
página entera**, así que hay que cerrarlo antes de capturar. La receta que
funciona está en `tests/ui/_ref-fie.mts`.

---

## 1. El problema de fondo tiene nombre: falta profundidad

La queja que el usuario repite en cada mensaje es **«se ve muy plano»**. Y tiene
un diagnóstico exacto, que él mismo dio:

> «¿no ves ahí cómo juegan en el fondo, al lado de la foto, como una textura en
> el fondo? Eso da profundidad y queda profesional»

La FIE resuelve el fondo con **tres capas**, y ninguna es un degradado de
colorines:

1. **Un color base plano y oscuro.**
2. **Formas geométricas enormes** —diagonales, cuñas, un círculo que se sale por
   el borde— en el **mismo color un poco más claro**. No se leen como «un
   dibujo»: se leen como que la superficie tiene relieve. En la ficha de tirador
   son dos cuñas diagonales detrás de la foto; en el cara a cara es una cuña
   gigante que cruza la pantalla entera.
3. **Un grano o un patrón muy fino** encima. En el cara a cara es **ruido**; en
   el seguimiento de ranking es una **retícula de cruces `+`** muy tenue. Es lo
   que el usuario llama «texturas con palabras».

Eso es lo que hay que traer. **Y es compatible con no parecer generado por IA**,
porque no es una sombra de color ni un brillo: es geometría del mismo tono.

Lo que **no** se copia: el azul. El usuario ha sido explícito —*«no la quiero
azul»*—. Las formas van en nuestro grafito.

### Cómo hacerlo sin pagarlo en rendimiento

Esto se despliega en Cloudflare Workers y se mira en un móvil. Así que:

- Las formas grandes, **SVG en línea o `background-image` con un `data:` URI**:
  son cuatro polígonos, no una imagen.
- El grano y la retícula, **patrón CSS repetido** (`repeating-linear-gradient`,
  un `<pattern>` de SVG o un PNG de 64×64 en mosaico). **No** una textura de
  2000 px.
- Todo por debajo del contenido y con opacidad baja. **Si tapa una letra, sobra.**
- Respeta `prefers-reduced-motion` si le pones movimiento, y no le pongas
  movimiento salvo que aporte.

---

## 2. Los colores: España, con una pizca

El usuario:

> «no hay nada de España ni los colores de España, no sé, en vez del rosa ese
> igual el rojo de la bandera de España, juega más con esos colores, no mucho
> porque quiero que se vea así profesional, pero un toque en algo»

Estado actual: `--primary: oklch(0.586 0.222 17.6)`, que es un **carmesí rosado**
(`#e11d48`, el `rose-600` de Tailwind). Es lo que él llama «el rosa ese», y tiene
razón: tira a fucsia y no es de España.

**La propuesta**: mover el matiz al **rojo de la bandera**. El rojo oficial es
Pantone 186C (`#C60B1E` en la versión que se usa en pantalla, `#AA151B` en la más
oscura). Es un rojo de ladrillo, sin nada de rosa.

Y hay una coincidencia que conviene aprovechar: **el amarillo de la bandera ya
está en la paleta**. `--gold` está reservado para las convocatorias de selección,
que es lo más importante que le puede pasar a un tirador. Así que **rojo y oro ya
son los colores de la aplicación**; solo hay que corregir el rojo y dejar que se
vea que es a propósito.

**Condiciones, que no son negociables:**

- **Mídelo.** `--primary` se usa como relleno con texto blanco encima y hay una
  variante `--primary-text` porque el carmesí saturado se queda en 3,98:1 como
  texto. Un rojo más oscuro empeora eso. Hay un guion, `npm run contraste`
  (`tests/ui/contraste.mts`): úsalo y no entregues nada por debajo de AA.
- **Una pizca, no una bandera.** Nada de franjas rojigualdas, ni toros, ni
  banderas literales de fondo. El usuario ha dicho «no mucho».
- El semáforo de plazos (`--ok`, `--warn`, `--danger`) **no se toca**: son tres
  colores que ya pasan AA y significan cosas distintas del acento de marca.

---

## 3. Patrones concretos que copiamos

### 3.1 La cabecera de ficha con foto (referencia 1)

Lo que hace bien, y aquí sirve tal cual para la **ficha de tirador**:

- **El nombre en dos pesos en la misma línea**: `HSIEH` muy grueso + `Kaylin Sin
  Yan` fino. Se lee el apellido de golpe y el nombre completo si te fijas. Eso
  aquí es gratis: ya guardamos nombre y apellidos por separado.
- **El puesto como insignia**, no como dato en una lista: `# 13` grande en una
  pastilla oscura, al lado de la cara. Es lo primero que se lee, y es lo primero
  que quiere saber cualquiera.
- **Bandera del país en una pastilla** junto a la nacionalidad.
- **Pares etiqueta/valor** con la etiqueta apagada y el valor en blanco y en
  negrita. Nunca al revés.
- **Un selector** («View by: Senior») para cambiar de categoría **sin salir de la
  pantalla**. Esto es justo lo que el usuario pide para los rankings.

### 3.2 El seguimiento histórico de ranking (referencia 3)

**Esta es la que hay que copiar con más ganas**, porque resuelve una petición que
el usuario ha hecho dos veces: ver su evolución y poder cambiar de ranking.

Una **tira horizontal de tarjetas, una por temporada**, y en cada una:

- El puesto en grande (`#13`) con la categoría debajo en pequeño (`/ Senior`).
- **Una flecha de tendencia** y los puntos: verde hacia arriba si mejoró, amarilla
  hacia abajo si empeoró, y un **círculo de puntos** cuando no hay con qué
  comparar. Ese tercer estado es la parte lista: no se inventa una tendencia
  cuando no se sabe.
- La temporada abajo a la derecha.
- Botones de anterior/siguiente redondos arriba a la derecha.

Tenemos los datos: la ingestión `fie_tiradores` ya trae puesto mundial e histórico
(de Llavador consta el 25.º actual y su mejor puesto, 11.º en 2025), y el ranking
nacional está en `official_ranking_entry`.

Se monta con `Carousel` de shadcn. Y el color de la flecha **nunca es la única
señal**: va con la flecha, que es forma, además del color.

### 3.3 El cara a cara (referencia 2)

`valor — etiqueta — valor` centrado, con las dos caras a los lados y su bandera.
Para un seleccionador que compara dos de sus tiradores esto es directamente útil,
y para un tirador que va a enfrentarse a alguien, más.

**Esto es una idea nueva, no una petición.** Anótala como propuesta; no la montes
sin decírmelo, porque comparar tiradores españoles entre sí puede ser delicado.

### 3.4 La ficha de torneo con foto de la sede (referencia 4)

> «cómo juega con la imagen tal del sitio de la competición, no sé, puedes meter
> la bandera»

Lo que hace:

- **Foto de la ciudad a sangre** como cabecera.
- **Un panel oscuro translúcido flotando encima** con todo lo importante:
  - el rango de fechas en una **pastilla** de color,
  - **bandera + ciudad, país**,
  - el título enorme,
  - una línea de contexto («39 nations, 267 athletes») — el equivalente nuestro
    es el número de inscritos, que ya tenemos de las listas oficiales,
  - **pastillas de etiqueta** para arma, género, categoría e individual/equipos,
  - **un botón de acción** al final.

Aquí tenemos una ventaja y una limitación:

- **A favor**: ya enlazamos el cartel de la FIE (`imageUrl`) y **no se rehospeda
  nunca**, que es lo que exigen sus términos. Y tenemos ciudad y país para la
  bandera.
- **En contra**: 246 de 274 eventos **no tienen foto**. Así que el diseño tiene
  que ser bueno **sin foto** y mejor **con foto**, no al revés. Si lo montas
  suponiendo que hay imagen, nueve de cada diez fichas se verán rotas. Cuando no
  hay foto, la cabecera la hace la **textura del punto 1** con el tinte del
  organismo.

Ojo con un fallo ya conocido: la ficha se abría con 200 px de negro porque un
cartel de 4000 px cargaba en diferido. Se arregló con carga inmediata,
`fetchPriority="high"`, tinte debajo y `onError` que colapsa el hueco. **No lo
rompas**; `Aspect Ratio` de shadcn es la forma limpia de reservar el sitio.

---

## 4. Los escudos de las federaciones

> «no veo nada de la federación ni nada, ni logo de la fede ni de la FIE para
> cambiar entre rankings, eso estaría guay a mí visual»

Dos usos distintos:

1. **Procedencia.** Cada dato de esta aplicación sale de algún sitio, y hoy se
   dice con texto («Skermo · RFEE», «FIE»). Con el escudo se lee de un vistazo y
   además da autoridad, que es lo que el usuario echa en falta.
2. **Cambiar de ranking.** El escudo de la RFEE y el de la FIE como los dos lados
   de un conmutador: ranking nacional ↔ ranking mundial. Es la petición literal.

**Con una condición de la que no nos salimos:** los escudos son marcas de
terceros. Se **enlazan desde su origen** (`esgrima.es`, `static.fie.org`) igual
que el cartel de la FIE, **no se copian al repositorio**. Si no se puede enlazar
con garantías, se usa un conmutador de texto («Nacional / Mundial») y se dice en
el informe. **Un conmutador honesto es mejor que un logotipo mal traído.**

---

## 5. Los PDFs, vistos y no leídos

> «con la info que saques de los PDF con la IA, visualizarla bonita, más visual
> que leerse todo el PDF de cada competi»

Esta es la frase que resume para qué sirve la extracción, y hay que tenerla
delante al diseñar: **el trabajo está hecho, el PDF ya está leído. Lo que falta
es no obligar a nadie a leerlo otra vez.**

Lo que hay en la base, medido: de 274 eventos, **246 no tienen pabellón** en el
calendario; de 484 pruebas, **solo 23 tienen hora de inicio** y **ninguna tiene
cuota**. La convocatoria en PDF sí lo dice, y la extracción ya lo ha sacado: 98
datos en 9 fichas, y tres fichas ganan el pabellón con su dirección y su cuota.

Así que nada de una lista de «campos extraídos». Eso es un PDF con otra tipografía.
Cada cosa en su forma:

| Dato extraído | Cómo se ve |
|---|---|
| Pabellón y dirección | Con su bandera/ciudad y el botón de «cómo llegar» |
| Horarios del día | Una línea de tiempo del día, no una tabla |
| Cuotas | Una cifra, con su concepto |
| Plazos | La barra de tramos que ya existe y que al usuario le gustó |
| Enlaces | Botones, no URLs pegadas |

Y **sin perder las tres reglas**, que no son estéticas:

1. **`pisadoPorPublicado: true` → manda el publicado.** Se puede decir «la
   circular dice otra cosa», pero no presentarlo como el bueno.
2. **`estado: 'sin_revisar'` no se pinta como oficial.** En gris, y dicho.
3. **La `cita` tiene que poder verse.** Un dato sacado de un PDF sin la frase de
   la que sale no se puede comprobar, y entonces no vale nada. `HoverCard`,
   `Tooltip` o `Collapsible`, sin ensuciar.

---

## 6. Para quién es la aplicación

> «quiero que quede una app para que puedan planificarse bien, y el seleccionador
> español pueda ver a sus tiradores y él pueda gestionar todo»

Tres papeles y nada más: **dirección técnica (admin)**, **seleccionador de un
arma**, **tirador de la cabeza del ranking**. Sin clubes. El club sigue siendo un
dato del tirador, porque viene en el ranking oficial y en las listas de Skermo,
pero ya no es un usuario que aprueba nada.

Y **no es una aplicación para inscribirse**. Sirve para **planificarse**: ver el
calendario, saber cuánto queda para que cierre un plazo, saber si estás dentro
—incluso si te ha inscrito otro— y ver tu ranking. El seleccionador ve lo mismo de
todos sus tiradores, que es lo que necesita para gestionarlos.

---

## 7. Cómo se sabe si esto ha salido bien

No por adjetivos. Por comparación:

1. Captura de la pantalla **antes**.
2. Captura de la referencia de la FIE.
3. Captura de la pantalla **después**.

Las tres abiertas con Read, en **iPhone y en escritorio**. Si la tercera no está
más cerca de la segunda que la primera, no ha salido bien, y eso se dice en vez de
entregarlo.

Y lo de siempre: `npx tsc --noEmit` limpio, `npx vitest run` en verde,
`npm run barrido` en «Sin problemas», `npm run contraste` sin nada por debajo de
AA.

---

## 8. Hasta dónde se copia

El usuario ha dado permiso amplio:

> «usa si quieres cosas de la FIE, incluso del código, que son chulas… como es
> algo interno que no se va a monetizar ni nada… o de otras empresas o cosas
> punteras para que quede bien»

La postura práctica, que además es la que da mejor resultado:

- **Los patrones se copian sin complejo.** Una jerarquía, una tira de tarjetas de
  temporada, un panel flotando sobre una foto, el apellido en negrita y el nombre
  fino: eso es vocabulario de diseño, lo usa todo el mundo y no es de nadie.
- **Inspeccionar su CSS para aprender la técnica, sí.** Cómo consiguen el grano,
  con qué opacidad, con qué tamaño de mosaico: mirarlo es lo que haría cualquiera
  y ahorra media tarde de tanteo.
- **Pegar su hoja de estilos, no.** Y no por prudencia: es que **viene con su azul
  y con su sistema entero**. Nuestra base es grafito frío con acento rojo; sus
  variables chocarían con las nuestras en cada línea y acabaríamos peleando con
  un sistema ajeno. Reimplementar el patrón en nuestras variables es menos
  trabajo, no más.
- **Sus imágenes y sus escudos se enlazan desde su origen, nunca se copian al
  repositorio.** Esto ya es regla del proyecto por los términos de la FIE, que
  exigen permiso escrito para almacenar su contenido, y no cambia porque la
  aplicación sea interna: lo que cambia con «interno y sin monetizar» es el
  riesgo, no la regla. Enlazar es además lo correcto técnicamente: su CDN es más
  rápido que nuestro Worker y la imagen se actualiza si ellos la cambian.

### Otras referencias que merece la pena mirar

El usuario ha abierto la puerta a mirar fuera de la esgrima, y conviene, porque
la FIE resuelve bien la profundidad pero no es un dechado de densidad de
información. Para lo que nos falta:

- **Tiras de tarjetas con tendencia y evolución**: cualquier panel de bolsa o de
  analítica. Es el patrón de la referencia 3 llevado más lejos.
- **Calendarios densos en móvil**: las aplicaciones de calendario nativas
  resuelven el reparto de alto por día mejor que cualquier web, y ese es justo
  nuestro problema (`planificar()` en `rejilla-mes.tsx`).
- **Fichas de deportista con foto, bandera y datos**: las de las ligas
  profesionales. De ahí sale la jerarquía de la referencia 1.

Y la regla de siempre al mirar fuera: **se copia la decisión, no la captura.**
Si no sabes decir en una frase *por qué* funciona, no lo copies, porque entonces
no lo estás copiando: lo estás calcando.

---

## 9. Convenciones compartidas, y quién es dueño de cada cosa

Hay ocho agentes trabajando a la vez. El peligro no es que no hagan nada: es que
**cada uno resuelva por su cuenta lo que es común** y acabemos con tres tipos de
bandera, dos convenciones de botón activo y cuatro rojos distintos. Eso es
exactamente lo que produce la sensación de «interfaz poco cuidada» que el usuario
quiere quitarse.

**Regla general: lo que sale en más de una pantalla tiene UN dueño y todos los
demás lo importan.** Si te falta algo de esta lista, no lo hagas: pídelo en tu
informe y yo se lo paso a su dueño.

| Qué | Dueño | Dónde vive | Los demás |
|---|---|---|---|
| Paleta y tokens de color | Paleta | `src/app/globals.css` | usan **variables CSS**, nunca colores a mano |
| Fondo con textura y profundidad | Paleta | `src/components/fondo/` | lo ponen con la línea que yo les pase |
| Color de circuito y de organismo | Paleta | token en `globals.css` + mapa en `src/lib/colores.ts` | lo importan |
| Iconos de arma | Iconos | `src/components/calendario/iconos-arma.tsx` | los importan |
| Banderas de país | Iconos | `src/components/bandera.tsx` | la importan |
| Escudos RFEE y FIE | Ranking | `src/components/escudo.tsx` | lo importan |
| La barra de plazos | Ficha de torneo | `src/components/calendario/barra-plazos.tsx` | la importan |

### 9.1 El estado activo de un control: una sola convención

Este es el fallo que el usuario detectó de un vistazo, y merece la pena entender
por qué lo detectó. En la fila de filtros del calendario:

- `Florete` sale **relleno de rojo** porque está activo, y `Espada` y `Sable`
  oscuros porque no lo están. Bien: relleno = activo.
- Pero `M` y `F` salen **los dos rellenos de rojo**, porque los dos están activos.

Resultado: **la misma señal visual significa dos cosas distintas en la misma
línea**, y el ojo lo nota aunque no sepa decir qué pasa. Eso, y no el color, es lo
que hace que parezca descuidado.

La convención, para toda la aplicación:

1. **El relleno del color de acento se reserva para la acción principal de la
   pantalla, y para nada más.** Un filtro nunca va relleno de acento: compite con
   el botón que de verdad hace algo.
2. **Selección múltiple** (armas, géneros) → `ToggleGroup`. El marcado se indica
   con **fondo secundario + borde**, no con acento.
3. **Elegir uno de varios** (categoría, vista) → `Select` o `Combobox`, no una
   fila de pastillas. Si hay más de cuatro opciones, `Combobox`.
4. **Navegación** (mes anterior / hoy / siguiente) → `Button Group`, botones
   fantasma, pegados, misma altura.
5. **Y una altura y un radio para toda la fila.** Hoy hay seis formas distintas.

### 9.2 El buscador se va a una paleta

Decidido con el usuario: *«me parece bien lo que dices del buscador»*.

Hoy es un campo enorme, siempre vacío, que se lleva media anchura de la cabecera
para algo que se usa de vez en cuando. Pasa a ser un **icono que abre `Command`**,
con su `Kbd` para el atajo. El espacio que libera se lo queda el calendario, que
es lo que la gente viene a ver.

En móvil, el icono; nunca un campo que ocupe una fila entera.

### 9.3 El color como señal: dos límites

- **Nunca es la única señal.** Va siempre con texto o con forma. Es requisito de
  accesibilidad del proyecto y está en `UI.md`.
- **Verde, ámbar y rojo están cogidos.** Son el semáforo de plazos (`--ok`,
  `--warn`, `--danger`). **No se pueden reutilizar para el circuito** o dos
  significados se pisan: alguien leería «Liga de Oro» como «plazo a punto de
  cerrar».

### 9.4 Lo que no se inventa

Si un dato no lo tenemos, se dice **«no publicado»**. No se rellena un hueco
bonito con algo que parezca oficial. Al rediseñar es facilísimo saltarse esto sin
querer, porque un maquetado con todos los campos llenos queda mejor en la captura.
Queda mejor y es mentira.

Dos números para tenerlo presente: **246 de 274 eventos no tienen pabellón** y
**ninguna de las 484 pruebas tiene cuota** en el calendario. Si tu diseño supone
que esos campos están, casi todas las pantallas reales se verán rotas.

---

## 10. El acrílico: transparencia NO, material SÍ

El usuario vio una captura de la pantalla de acceso y dijo:

> «cuidado, no te pases de transparencia en el calendario, que queda medio raro…
> mete como más acrílico difuminado, para evitar ese efecto muy transparente
> raro… mejor algo tipo glassforming acrylic entonces»

Tiene razón, y el diagnóstico es preciso. **Transparencia y acrílico no son lo
mismo**, y confundirlos es la diferencia entre parecer una plantilla y parecer un
sistema operativo:

- **Transparencia a secas** (`bg-black/40`): el fondo se ve **nítido** por debajo.
  El texto encima compite con lo que hay detrás, el panel no se lee como un
  objeto y todo queda turbio. Es el «efecto muy transparente raro».
- **Acrílico** (lo de Windows, el *material* de Apple): el fondo se
  **desenfoca**, se le pone un **tinte** y encima un **grano finísimo**. El panel
  deja de ser un agujero y se convierte en **una lámina de vidrio esmerilado**.
  Se lee, y parece caro.

### La receta, y los números importan

```css
backdrop-filter: blur(20px) saturate(1.2);
background: color-mix(in oklab, var(--card) 72%, transparent);
border-top: 1px solid var(--filete);   /* el canto de luz ya existe */
```

Cuatro capas, y ninguna es opcional:

1. **Desenfoque de 16 a 24 px.** Por debajo de 12 px no se lee como material, se
   lee como una foto mal puesta.
2. **Tinte del 65 al 80 %**, no del 20 al 40 %. **Aquí está el fallo del usuario
   que hay que corregir**: lo que produce el efecto raro es el tinte demasiado
   bajo. Si dudas, sube la opacidad: un acrílico opaco queda bien y uno
   translúcido de más queda sucio.
3. **El canto de luz arriba**, `--filete`, que ya está en la paleta. Es lo que
   hace que la lámina tenga grosor.
4. **Grano muy fino encima**, que es justo la textura que se está construyendo
   en `src/components/fondo/`. El acrílico de Windows lleva ruido por esto
   mismo: sin él, el desenfoque parece un desenfoque; con él, parece vidrio.

### Dónde sí y dónde no, que es lo que separa esto de un tic de IA

`UI.md` prohíbe en la sección «3 bis» las tarjetas translúcidas flotando por
todas partes, y con razón: es uno de los cinco tics de «generado por IA». La
diferencia es **un material usado con criterio** frente a **un efecto repartido
por todo**.

**SÍ**, y solo aquí: paneles que de verdad flotan **sobre una imagen**.

- La tarjeta de acceso, encima de las fotos.
- La cabecera de la ficha de torneo, encima de la foto de la sede — es
  exactamente lo que hace fie.org en la referencia 3.4.
- Barras fijas que se superponen al contenido al desplazarse (la de navegación).

**NO**, en ningún caso:

- **Las barras del calendario.** Son cientos en pantalla; `backdrop-filter` es
  caro y esto se mira en un móvil. Ahí van colores **sólidos**.
- Tarjetas sobre fondo plano. Si detrás no hay nada que desenfocar, el acrílico
  no aporta nada y solo cuesta pintarlo. Sobre fondo plano se usa `--card`
  sólido, que es lo que hay hoy y está bien.
- Texto sobre acrílico con contraste justo. **Mídelo**: `npm run contraste`.

### Y la otra cosa de esa captura: la tira de fotos

En `capturas/acceso-escritorio.png` hay tres fotos nítidas en una banda que cruza
la composición **con los cantos a hueso**. Parece recortada y pegada encima, no
integrada: es el segundo motivo de que quede raro. Si la banda se queda, necesita
resolverse el borde —desvanecido, máscara, o un encuadre que la justifique— o
desaparecer. **Míralo en la captura y decide**; no lo dejes como está.
