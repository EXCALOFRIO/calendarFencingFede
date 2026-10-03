import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * Inventario de los endpoints de escritura. Este test estático no sustituye
 * la prueba de la guarda: evita que al modificar una acción se quite su
 * comprobación previa mientras las lecturas siguen admitiendo la vista.
 */
const ESCRITURAS: Record<string, string[]> = {
  'src/lib/entries/actions.ts': ['requestEntry', 'transitionEntry', 'transitionEntries'],
  'src/lib/callups/actions.ts': ['responderConvocatoria', 'crearConvocatoria', 'guardarConvocados', 'quitarConvocado', 'publicarConvocatoria', 'eliminarConvocatoria'],
  'src/app/(app)/alta/acciones.ts': ['vincularFicha', 'confirmarQueSoyYo', 'cancelarSolicitudVinculo'],
  'src/app/(app)/perfil/acciones.ts': ['revocarCalendario'],
  'src/app/(app)/admin/ajustes/actions.ts': ['crearMiembroEquipo', 'actualizarMiembroEquipo', 'quitarDelEquipo', 'revocarAcceso', 'restaurarAcceso'],
  'src/app/(app)/admin/cuarentena/actions.ts': ['resolverCuarentena', 'resolverVarias', 'reabrirCuarentena'],
  'src/app/(app)/admin/emparejar/actions.ts': ['asignarResultado', 'asignarTodosConEseNombre', 'desasignarResultado'],
  'src/app/(app)/admin/extraccion/actions.ts': ['marcar', 'aprobarCircular', 'confirmarEventoDeExtraccion', 'descartarEventoDeExtraccion', 'procesarSiguientes'],
  'src/app/(app)/admin/inscripciones/actions.ts': ['moverInscripciones'],
  'src/app/(app)/admin/normativa/actions.ts': ['crearTemporada', 'marcarTemporadaActual', 'guardarPlazo', 'borrarPlazo', 'guardarCategoria', 'borrarCategoria', 'guardarReglaRanking', 'borrarReglaRanking'],
  'src/app/(app)/admin/usuarios/actions.ts': ['crearClub', 'crearTiradorDesdeRanking', 'resolverSolicitudVinculo', 'crearUsuario', 'importarUsuarios'],
};

describe('inventario de guardas de escritura de la vista previa', () => {
  for (const [file, names] of Object.entries(ESCRITURAS)) {
    it(`${file}: cada entrada mutadora comienza por la guarda de escritura`, () => {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      for (const name of names) {
        const fn = ast.statements.find((n): n is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(n) && n.name?.text === name);
        expect(fn, `${file}: falta ${name}`).toBeDefined();
        const first = fn!.body!.statements[0].getText(ast);
        expect(first, `${file}: ${name}`).toMatch(/await requireWritable(Profile|Role)\(/);
      }
    });
  }

  it('el endpoint manual de ingesta aplica la misma guarda antes de llamar al runner', () => {
    const text = readFileSync(new URL('../src/app/api/admin/ingest/route.ts', import.meta.url), 'utf8');
    expect(text).toContain("await requireWritableRole('admin')");
    expect(text.indexOf("await requireWritableRole('admin')")).toBeLessThan(text.indexOf('await runIngest('));
  });

  it('el atajo privado ya no contiene contraseñas ni aprovisiona identidades', () => {
    const text = readFileSync(new URL('../src/app/probar/[quien]/route.ts', import.meta.url), 'utf8');
    expect(text).toContain('getAuthenticatedProfile');
    expect(text).not.toMatch(/password|CONTRASENA|sign-up|sign-in|Set-Cookie/);
  });
});
