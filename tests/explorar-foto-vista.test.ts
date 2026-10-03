import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FotoDeportista } from '@/components/explorar/foto-deportista';

describe('retrato accesible sin salto de tamaño', () => {
  it('reserva 96 px, iniciales y dos líneas de pie desde SSR sin imagen rota', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, { personaId: 'p', nombre: 'Nombre Sintético' }));
    expect(html).toContain('width:96px;height:96px');
    expect(html).toContain('NS');
    expect(html).toContain('Foto no publicada');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('h-8');
    expect(html).not.toContain('<img');
  });

  it('tamaño mini mantiene 48 px y caption acotado sin texto largo visible', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, {
      personaId: 'p', nombre: '', tamano: 'mini', decorativa: false,
    }));
    expect(html).toContain('width:48px;height:48px');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Foto no publicada"');
    expect(html).toContain('—');
    expect(html).toContain('sr-only');
    expect(html).toContain('h-4');
  });

  it('ocultar elimina retrato y cualquier solicitud de metadata', () => {
    const html = renderToStaticMarkup(React.createElement(FotoDeportista, {
      personaId: 'p', nombre: 'Nombre Sintético', ocultar: true,
    }));
    expect(html).toBe('');
  });

  it('usa img nativa lazy, dimensiones explícitas, referrer mínimo y fallback en error', () => {
    const codigo = readFileSync(new URL('../src/components/explorar/foto-deportista.tsx', import.meta.url), 'utf8');
    expect(codigo).toContain('key={props.personaId}');
    expect(codigo).toContain('width={medida}');
    expect(codigo).toContain('height={medida}');
    expect(codigo).toContain('loading="lazy"');
    expect(codigo).toContain('referrerPolicy="no-referrer"');
    expect(codigo).toContain('onError={() => { setCargada(false); setFoto(null); }}');
    expect(codigo).toContain('fotoPublicadaValida');
    expect(codigo).not.toMatch(/next\/image|localStorage|sessionStorage|console\.|animate-/);
  });
});
