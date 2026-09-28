import io

p = 'scripts/alta-desde-ranking.ts'
s = io.open(p, encoding='utf-8').read()

pares = []

pares.append((
r""" *   npx tsx scripts/alta-desde-ranking.ts "llavador"
 *""",
r""" *   npx tsx scripts/alta-desde-ranking.ts "llavador"
 *   npx tsx scripts/alta-desde-ranking.ts JZG00611 --correo juan@ejemplo.es
 *"""))

pares.append((
r""" * Lo que sí es de este guion es lo de alrededor: inventarse un correo
 * `@demo.local` para que `npm run demo:borrar` se lo lleve y crear la cuenta de
 * acceso. Cuando haya altas de verdad, el correo será el de la persona y la
 * contraseña la pondrá ella.""",
r""" * Lo que sí es de este guion es lo de alrededor: el correo y la cuenta de
 * acceso. Sin `--correo` se inventa uno `@demo.local` y se crea una cuenta con
 * contraseña, que es lo que hace falta para las pruebas y lo que
 * `npm run demo:borrar` se lleva por delante.
 *
 * **Con `--correo` es un alta de verdad**: se usa la dirección de la persona y
 * NO se crea ninguna credencial. La cuenta nace sola la primera vez que entra
 * pidiendo su código, que es como funciona la aplicación desde que se cerró el
 * acceso con contraseña. Una contraseña puesta por nosotros a nombre de otro
 * sería una credencial que esa persona no ha elegido ni nadie le ha pedido."""))

pares.append((
r"""const BUSQUEDA = process.argv[2];""",
r"""const BUSQUEDA = process.argv[2];
/** El correo real de la persona, si se da: `--correo alguien@dominio.es`. */
const CORREO_REAL = (() => {
  const i = process.argv.indexOf('--correo');
  return i > 0 ? process.argv[i + 1]?.trim().toLowerCase() : undefined;
})();"""))

pares.append((
"""const correo = `${sinAcentos(candidato.nombrePila).replace(/\\s+/g, '')}.${""",
"""const correo =
  CORREO_REAL ??
  `${sinAcentos(candidato.nombrePila).replace(/\\s+/g, '')}.${"""))

pares.append((
"""  sinAcentos(candidato.apellidos).split(/\\s+/)[0] ?? 'tirador'
}@demo.local`;""",
"""    sinAcentos(candidato.apellidos).split(/\\s+/)[0] ?? 'tirador'
  }@demo.local`;"""))

pares.append((
r"""// La cuenta de acceso, por el mismo camino que usa la pantalla de entrada.
const alta = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: correo,
    password: CONTRASENA,
    name: candidato.nombre,
  }),
}).catch(() => null);""",
r"""/*
  La cuenta de acceso, solo para las altas de demostración.

  En un alta de verdad no se crea nada aquí: la persona entra escribiendo su
  correo, Neon le manda un código y la cuenta nace en ese momento. Lo único
  que hace falta por adelantado es el perfil, que es lo que decide si se le
  manda código o no.
*/
const alta = CORREO_REAL
  ? null
  : await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: correo,
        password: CONTRASENA,
        name: candidato.nombre,
      }),
    }).catch(() => null);"""))

pares.append((
r"""console.log(
  `Acceso       ${
    alta?.ok
      ? 'creado'
      : `la cuenta de autenticación no se creó (HTTP ${alta?.status ?? 'sin respuesta'}); ` +
        'seguramente ya existía'
  }`,
);""",
r"""if (CORREO_REAL) {
  console.log(`Acceso       con código a ${correo}; no se le crea contraseña`);
} else {
  console.log(
    `Acceso       ${
      alta?.ok
        ? 'creado'
        : `la cuenta de autenticación no se creó (HTTP ${alta?.status ?? 'sin respuesta'}); ` +
          'seguramente ya existía'
    }`,
  );
}"""))

for i, (v, n) in enumerate(pares):
    if v not in s:
        print(f'FALLA el {i}:')
        print(repr(v[:110]))
        raise SystemExit(1)
    s = s.replace(v, n, 1)

cola = """console.log(`\\nEntra con    ${correo} / ${CONTRASENA}`);"""
nueva = """console.log(
  CORREO_REAL
    ? `\\nQue entre en ${BASE}/entrar y escriba su correo. Le llegará un código.`
    : `\\nEntra con    ${correo} / ${CONTRASENA}`,
);"""
assert cola in s, 'falla la cola'
s = s.replace(cola, nueva, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok')
