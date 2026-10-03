/**
 * CSV quoting does not stop a spreadsheet from executing a cell as a formula.
 * Keep ordinary values unchanged; mark dangerous cells as text before quoting.
 * The original value, including whitespace, stays intact after the apostrophe.
 */
export function escaparCeldaCsv(valor: string): string {
  const texto = String(valor ?? '');
  const inicio = texto.replace(/^[\s\p{Cc}\p{Cf}]+/u, '').normalize('NFKC');
  const protegido = /^[=+\-@]/u.test(inicio) || /^[\t\r\n]/u.test(texto)
    ? `'${texto}`
    : texto;
  return /[";\r\n]/u.test(protegido)
    ? `"${protegido.replace(/"/g, '""')}"`
    : protegido;
}
