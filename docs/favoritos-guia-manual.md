# Favoritos: guía de comprobación manual

Los favoritos son un acceso rápido privado a fichas deportivas. No envían avisos, no generan notificaciones ni permisos del navegador, no siguen a nadie y no enseñan ranking interno.

Esta guía es para quien tenga una sesión real. Los tests automáticos cubren acciones, vistas renderizadas en servidor y estados, pero no un navegador con sesión. La migración 0017 ya está aplicada en la base real. No crees usuarios de prueba en producción: usa una cuenta tuya.

## Dónde está

- Explorar: enlace «Mis favoritos» en la cabecera.
- Mi perfil: sección «Favoritos» con el mismo enlace.
- Ficha deportiva (`/explorar/<id>`): botón «Guardar en favoritos» / «Quitar de favoritos» y estado «Favorito» / «Sin guardar».
- Lista: `/explorar/favoritos`. La barra de navegación no cambia; Explorar sigue marcado.

## Recorrido

1. Abre Explorar y busca a alguien con cuenta y a alguien retirado o sin cuenta. Abre cada ficha y pulsa «Guardar en favoritos». Debe verse «Favorito» al instante y el mensaje «Guardado en tus favoritos…».
2. Pulsa de nuevo en una ficha ya guardada para quitarla («Sin guardar»). Pulsa «Guardar» varias veces seguidas: no debe duplicarse nada.
3. Entra en «Mis favoritos» desde Explorar y desde Mi perfil. Cada persona guardada aparece una vez, incluidas las retiradas o sin cuenta, y su fila abre la ficha.
4. Desde la ficha abierta por la lista, el enlace superior dice «Volver a Favoritos» y devuelve a la misma página de la lista.
5. En una ficha abierta desde la lista, quita el favorito y pulsa Atrás del navegador: la lista no debe mostrar a esa persona.
6. En la lista, pulsa «Quitar de favoritos» en una fila: la fila desaparece, el contador de la página se actualiza y el foco pasa al encabezado «Guardados».
7. Con más de una página, comprueba «Ver más favoritos», «Volver a la primera página» y Atrás.
8. Corta la red (modo sin conexión) y pulsa Guardar: el estado vuelve al anterior y aparece un aviso en rojo que dice cómo reintentar. Al volver la red, repite y debe funcionar.
9. Con una segunda cuenta tuya, comprueba que su lista está vacía y no contiene lo guardado con la primera. Cambiar a mano `?cursor=` por un valor de la otra cuenta muestra «Esta página ya no corresponde a tu lista».
10. Sin sesión, `/explorar/favoritos` y cualquier ficha redirigen a `/entrar`.
11. El navegador no debe pedir ningún permiso de notificaciones en todo el recorrido.

## Anchos y accesibilidad

Revisa a 320, 393, 768 y 1440 px, con zoom del 200 %, solo teclado y «reducir movimiento»:

- Todos los botones y enlaces miden al menos 44 px de alto y no se solapan.
- El foco es visible y el orden de tabulación es: enlace de la fila, botón de la fila.
- Un lector de pantalla anuncia el cambio de estado («Guardado…», «Quitado…») y los errores.
- «Favorito» / «Sin guardar» se distinguen por texto e icono, no solo por color.
- La fila con un homónimo muestra el aviso con el año de nacimiento.
