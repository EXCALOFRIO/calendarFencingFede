import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { describe, expect, it } from 'vitest';

describe('CSS de producción acotado al código de la aplicación', () => {
  it('conserva utilidades de accesibilidad, responsive y componentes sin escanear las capturas', async () => {
    const ruta = fileURLToPath(new URL('../src/app/globals.css', import.meta.url));
    const fuente = readFileSync(ruta, 'utf8');
    expect(fuente).toContain("@import 'tailwindcss' source(none)");
    expect(fuente).toContain("@source '../'");
    const { css } = await postcss([tailwind({ optimize: false })]).process(fuente, { from: ruta });
    expect(css).toContain('.sr-only');
    expect(css).toContain('.min-w-0');
    expect(css).toContain('.fixed');
    expect(css).toContain('focus-visible');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('--font-display');
    expect(css).toContain('safe-area-inset-bottom');
  }, 30_000);
});
