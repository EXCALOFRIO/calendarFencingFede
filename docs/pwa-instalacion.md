# Instalación web, sin interrumpir

- `Instalable` sigue registrando `/sw.js` **después de `load`**, ahora con
  `updateViaCache: 'none'`. No compite con la carga inicial ni fuerza recargas.
- La invitación espera otros **8 segundos** y aparece al final del contenido,
  en flujo normal: no es modal, banner fijo ni permiso automático. Controles
  de 48 px, safe areas y ausencia de movimiento con `prefers-reduced-motion`.
- Chromium: captura `beforeinstallprompt`, cancela su presentación automática
  y lo consume una sola vez, exclusivamente al tocar **Instalar app**.
  Si el navegador no entrega el evento, no se promete instalación nativa.
- iPhone/iPad (incluido iPad con UA de escritorio): **Cómo añadir** explica
  **Safari → Compartir → Añadir a pantalla de inicio → Añadir**. En otros
  navegadores iOS recomienda abrir Safari; no promete un diálogo nativo.
- Oculta en standalone (incluido `navigator.standalone`), fullscreen y
  minimal-ui; también al recibir `appinstalled`. No es posible detectar
  universalmente una instalación iOS desde una pestaña distinta de Safari.
- Una fecha local, sin identidad, en `calendarfencing:instalacion:v1`:
  **7 días** tras una impresión ignorada, **30 días** tras descarte,
  cancelación o error, **180 días** tras aceptación/`appinstalled`.
  Si localStorage está bloqueado, se conserva en memoria durante esa carga
  de la pestaña: no reaparece al navegar. Al recargar sin almacenamiento
  no puede conservarse una preferencia persistente.
- No solicita permisos push, crea suscripciones ni envía notificaciones.
  El SW mantiene el contrato push `{ titulo, cuerpo, url, etiqueta }`,
  la actualización de campana y los enlaces internos existentes.

## Manifest y caché

Se conservan `name: CalendarFencing`, `short_name: CalendarF`, `scope: /`,
`start_url: /`, `display: standalone` y los cuatro iconos PNG existentes:
192/512 px, normales y maskable. Se añade `id: /`, equivalente al start_url
anterior, para estabilizar la identidad sin duplicar la aplicación.

El SW antiguo guardaba sin límite fotos/iconos sin hash. Se retira esa caché:
no hay manejador `fetch`, precarga ni persistencia de HTML, RSC, API, feeds
o datos de sesión. En activación solo elimina cachés con prefijo
`calendarfencing-estaticos-`; no borra cookies, localStorage ni suscripciones.
Los estáticos siguen usando la caché HTTP normal según sus cabeceras.

**Beneficio real:** acceso desde la pantalla de inicio y ventana sin barra
del navegador. Instalar no acelera CPU/red, no garantiza compartir la sesión
con Safari y **no ofrece modo offline**. Calendario y formularios requieren
conexión. La instalación nativa final depende del navegador/versión y HTTPS.

## Verificación reproducible, sin producción

Desde la raíz del repositorio:

```powershell
node node_modules/vitest/vitest.mjs run tests/pwa-instalacion.test.ts
node tests/ui/pwa-instalacion.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Los tests estrechos cubren detección iOS/standalone, cooldown y almacenamiento
inaccesible, captura/aceptación/cancelación/error y limpieza del SW sin caché
privada; push se simula en memoria, sin envío. La fixture del navegador
hidrata los componentes reales en Chromium aislado, sin Next ni cuentas.
Comprueba diez escenarios y genera capturas 360/1280 px en una carpeta
temporal cuya ruta imprime. Emula UA y eventos: **no sustituye** una prueba
manual final de instalación en iPhone/Safari y Android/Chrome reales.
