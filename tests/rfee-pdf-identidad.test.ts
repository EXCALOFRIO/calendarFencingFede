import { describe, expect, it } from 'vitest';
import { resolverParticipante, type Participante } from '@/lib/ingest/sources/rfee-pdf/identidad';

const REGISTRO: Participante[] = [
  { ref: 'p0001', nombre: 'ALFA UNO GARCIA', club: 'CLUB ESGRIMA NORTE' },
  { ref: 'p0002', nombre: 'ALFA UNO GARCIA', club: 'SALA SUR' },
  { ref: 'p0003', nombre: 'BRAVO DOS LOPEZ', club: null, pais: 'ITA' },
  { ref: 'p0004', nombre: 'CHARLIE TRES RUIZ', club: 'CLUB ESGRIMA NORTE' },
  { ref: 'p0005', nombre: 'ALFA UNO GARRIDO', club: 'CLUB ESGRIMA OESTE' },
];

describe('identidad de poules y cuadro contra la clasificación', () => {
  it('el club publicado separa a dos homónimos; sin club quedan ambiguos', () => {
    expect(resolverParticipante(REGISTRO, 'ALFA UNO GARCIA', 'SALA SUR')).toEqual({ ok: true, ref: 'p0002', nombre: 'ALFA UNO GARCIA' });
    expect(resolverParticipante(REGISTRO, 'ALFA UNO GARCIA', null)).toEqual({ ok: false, motivo: 'ambiguo' });
  });

  it('el país de la columna «Nación» vale como afiliación', () => {
    expect(resolverParticipante(REGISTRO, 'BRAVO DOS', 'ITA')).toMatchObject({ ok: true, ref: 'p0003' });
    expect(resolverParticipante(REGISTRO, 'BRAVO DOS', 'FRA')).toEqual({ ok: false, motivo: 'desconocido' });
  });

  it('nombre truncado y club en un solo texto: se atribuye cuando un corte encaja con una sola fila', () => {
    expect(resolverParticipante(REGISTRO, 'CHARLIE TRES RU CLUB ESGR', null)).toMatchObject({ ok: true, ref: 'p0004' });
    expect(resolverParticipante(REGISTRO, 'BRAVO DOS LO ITA', null)).toMatchObject({ ok: true, ref: 'p0003' });
    expect(resolverParticipante(REGISTRO, 'ALFA UNO GA SALA', null)).toMatchObject({ ok: true, ref: 'p0002' });
  });

  it('hermanos del mismo club: el nombre truncado a los apellidos no se atribuye a ninguno', () => {
    const hermanos: Participante[] = [
      { ref: 'p0001', nombre: 'DELTA CUATRO ANA', club: 'SALA SUR' },
      { ref: 'p0002', nombre: 'DELTA CUATRO BEATRIZ', club: 'SALA SUR' },
    ];
    expect(resolverParticipante(hermanos, 'DELTA CUATRO', 'SALA SUR')).toEqual({ ok: false, motivo: 'ambiguo' });
    expect(resolverParticipante(hermanos, 'DELTA CUATRO B', 'SALA SUR')).toMatchObject({ ok: true, ref: 'p0002' });
    // Si la fila de un hermano no se leyera, sus asaltos irían al otro: el registro debe estar completo.
    expect(resolverParticipante(hermanos.slice(0, 1), 'DELTA CUATRO', 'SALA SUR')).toMatchObject({ ok: true, ref: 'p0001' });
  });

  it('con el club unido, dos filas que encajan son ambiguas y menos de tres letras de club no bastan', () => {
    expect(resolverParticipante(REGISTRO, 'ALFA UNO GAR CLUB ESGRIMA', null)).toEqual({ ok: false, motivo: 'ambiguo' });
    expect(resolverParticipante(REGISTRO, 'CHARLIE TRES RU CL', null)).toEqual({ ok: false, motivo: 'desconocido' });
  });
});
