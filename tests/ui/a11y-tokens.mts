/** Contraste no textual (WCAG 1.4.11) de los tokens del tema oscuro: anillo de foco, bordes y superficies. npx tsx tests/ui/a11y-tokens.mts */
import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await b.newPage();
await p.evaluate('window.__name = (f) => f');
const r = await p.evaluate(() => {
  const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  const px = (c: string, fondo: string) => { cx.fillStyle = fondo; cx.fillRect(0,0,1,1); cx.fillStyle = c; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return [d[0], d[1], d[2]]; };
  const lum = (c: number[]) => { const [r,g,b] = c.map(v => { v/=255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
  const ratio = (a: number[], b: number[]) => { const [x,y] = [lum(a), lum(b)]; return +((Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)).toFixed(2); };
  const T = { bg: 'oklch(0.17 0.008 265)', card: 'oklch(0.215 0.009 265)', pop: 'oklch(0.255 0.009 265)', ring: 'oklch(0.68 0.19 25.8)', ring50: 'oklch(0.68 0.19 25.8 / 0.5)', input: 'oklch(1 0 0 / 14%)', border: 'oklch(1 0 0 / 9%)', secondary: 'oklch(0.27 0.009 265)', muted: 'oklch(0.75 0.01 265)', off: 'var(--off)' };
  const out: Record<string, number> = {};
  for (const f of ['bg','card','pop'] as const) {
    const F = px(T[f], '#000');
    out[`ring/${f}`] = ratio(px(T.ring, T[f]), F);
    out[`ring50/${f}`] = ratio(px(T.ring50, T[f]), F);
    out[`input/${f}`] = ratio(px(T.input, T[f]), F);
    out[`border/${f}`] = ratio(px(T.border, T[f]), F);
    out[`secondary/${f}`] = ratio(px(T.secondary, T[f]), F);
  }
  return out;
});
console.log(r); await b.close();

