// Sin dependencias a propósito: lo importan módulos que acaban en el bundle
// del navegador (edicion-url.ts, ficha-url.ts) y no deben arrastrar zod.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
