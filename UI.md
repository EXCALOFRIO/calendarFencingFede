# Contrato de interfaz

Documento corto y obligatorio. Todo lo que se pinte en esta aplicación tiene
que cumplirlo, venga de quien venga. El objetivo es que las pantallas no se
noten hechas por manos distintas.

## 1. Qué es esta aplicación

Herramienta de la **selección española de esgrima**. La usan tiradores (y sus
tutores), los seleccionadores de cada arma y la dirección técnica. No es una
aplicación para clubes: la palabra "club" no encabeza ninguna pantalla.

La pantalla principal **es el calendario**. Todo lo demás es secundario.

## 2. Reglas duras

1. **Móvil primero.** Se mira en el móvil antes que en el portátil. Nada de
   desbordes horizontales: `overflow-x` a nivel de página está prohibido.
   Objetivo táctil mínimo 44 px (ya lo fuerza `globals.css`).
2. **Español con acentos** en todo: interfaz, comentarios, nombres internos.
3. **Ningún dato inventado.** Si la fuente no lo publica, se dice
   "no publicado". Nunca un valor por defecto con pinta de oficial.
4. **Componentes de `src/components/ui/**` (shadcn).** No se escriben botones,
   pastillas ni diálogos a mano. Si falta uno, se instala:
   `npx shadcn@latest add <nombre>` — y **antes** se hace copia de
   `src/lib/utils.ts` y `src/app/globals.css`, porque la CLI los pisa.
   Disponibles: avatar, badge, button, card, command, dialog, popover,
   scroll-area, separator, sheet, skeleton, tabs, tooltip.
5. **Nada de controles nativos del navegador**: ni `<select>`, ni
   `<input type="date">`, ni `alert()`. Se usa el equivalente de shadcn.
6. **El color nunca comunica solo.** Todo estado lleva texto o icono además
   del color.
7. **Sin `console.log` ni datos personales en logs.**
8. Cero `any`. `npx tsc --noEmit` tiene que quedar en 0 errores.

## 3. Tokens (definidos en `src/app/globals.css`, no se inventan otros)

| Token | Para qué |
|---|---|
| `bg-background` / `bg-card` / `bg-muted` | fondo, superficie, superficie apagada |
| `text-foreground` / `text-muted-foreground` | texto y texto secundario |
| `bg-primary` + `text-primary-foreground` | **rellenos** carmesí (botón principal, selección) |
| `text-primary-text` | carmesí **como texto** (el de relleno no llega a AA) |
| `text-ok` / `text-warn` / `text-danger` | semáforo de plazos |
| `bg-gold` / `text-gold` | **exclusivo de convocatorias de selección** |
| `org-rfee` / `org-fie` / `org-efc` / `org-aut` | quién organiza |

## 4. Tipografía

Dos familias con papeles fijos:

- **Barlow Condensed** (`font-display`, aplicada ya a `h1 h2 h3`): titulares.
- **Inter** (por defecto): todo el texto de interfaz.
- Clase `.cifra`: cualquier **número que importe** (días que faltan, puesto en
  el ranking, puntos, contadores). Condensada, tabular y apretada. Es el
  recurso de jerarquía más fuerte que tiene la aplicación: una cifra grande y
  una palabra pequeña al lado.
- `.medida` limita la línea a 68 caracteres en párrafos largos.

## 5. Estructura de una pantalla

```
h1 (Barlow Condensed, text-2xl sm:text-3xl)  +  una línea de contexto al lado
[ controles en UNA fila que envuelve, nunca una barra de filtros de tres pisos ]
[ contenido ]
```

- Sin "eyebrow" en mayúsculas encima del título.
- Sin tarjetas idénticas repetidas para trocear contenido que no lo necesita.
- Espaciado vertical: `gap-3` dentro de un bloque, `gap-6` entre bloques.
- Ancho máximo de la aplicación: ya lo pone el layout (1320 px).

## 6. Estados vacíos y errores

Un estado vacío **dice qué pasará ahí y qué hacer ahora**, en dos líneas, con
una acción si la hay. No es un dibujo ni una disculpa. Nunca "No hay datos".

Los errores explican qué pasó y cómo arreglarlo, en la voz de la aplicación.
Una pantalla a la que no tienes acceso **no devuelve 500**: se captura y se
enseña el motivo (patrón de `src/app/(app)/admin/layout.tsx`).

## 7. Movimiento

Sobrio y con motivo. Lo que sí:

- Respuesta a una acción: abrir la hoja lateral, expandir, confirmar.
- Una entrada orquestada por pantalla como mucho.
- `tw-animate-css` y las clases `animate-in`/`fade-in`/`slide-in-from-*` que
  ya trae shadcn.

Lo que no: que cada tarjeta aparezca deslizándose al hacer scroll, ni
transiciones en el `hover` de todo. `prefers-reduced-motion` ya está
respetado en `globals.css`; no lo rompas con animaciones en JS sin comprobarlo.

## 8. Escritura

- Voz activa y frase corta. El botón dice lo que va a pasar: "Solicitar
  inscripción", no "Enviar".
- El mismo nombre para la misma acción en toda la aplicación.
- Sentence case, nunca MAYÚSCULAS de adorno.
- Nombres de torneo: pasarlos siempre por `titular()` de `src/lib/utils.ts`
  (las fuentes los publican en mayúsculas).

## 9. Verificación antes de dar algo por hecho

No vale con que la página cargue. Obligatorio:

1. `npx tsc --noEmit` → 0 errores.
2. `npx vitest run` → sin fallos nuevos.
3. `npm run barrido` (`tests/ui/barrido.mts`): recorre **todas** las pantallas
   con **los cuatro papeles**, en móvil y en escritorio, con sesión real, y
   mide código de respuesta, desborde horizontal, texto cortado y errores de
   consola o de hidratación. Falla si alguna acaba en `/entrar`.
4. `npm run mirar` para las capturas (`RUTAS` y `EMAIL` por variable de
   entorno) y **mirar la imagen**. Que una página devuelva 200 no dice nada
   sobre si se ve bien.

Sesiones de prueba en local: `/probar/tiradora`, `/probar/tutora`,
`/probar/seleccionador`, `/probar/admin`, `/probar/club`.
