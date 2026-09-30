/**
 * `sinComentarios`: quita los comentarios de un archivo de JavaScript respetando
 * strings, plantillas y expresiones regulares. Vive aqui y no duplicado en cada test
 * porque la razon por la que se necesita es la misma en todos: cuando se busca un
 * SIMBOLO que se borro, la palabra sigue living en los comentarios que explican el
 * borrado, y buscar en el crudo da un falso positivo que hace pasar un test que no
 * probo nada.
 *
 * EL CASO QUE LA ROMPIO, y por que esta en el comentario: en app.js,
 * `.replace(/"/g, "&quot;")`. Leido sin saber de expresiones regulares, el `/"` abre
 * una cadena que no se cierra nunca, y de ahi en adelante TODO el archivo se lee como
 * texto, comentarios incluidos. El sintoma es desconcertante: el aserto falla por "no
 * lo encontro" cuando en realidad se estaba leyendo otra cosa.
 *
 * La maquina de estados lleva una pila de contextos (codigo / cadena / plantilla /
 * expresion interpolada) y cuenta las llaves DENTRO de `${...}`, porque un
 * `${ { a: 1 } }` cierra con dos llaves y tomar la primera por el fin de la expresion
 * deja la plantilla abierta para siempre.
 */

const ES_CODIGO = "codigo";
const ES_STR = "str";
const ES_PLANTILLA = "plantilla";
const ES_EXPR = "expr";

/**
 * Un `/` en codigo es division o es el arranque de una expresion regular. La regla es
 * la clasica: la division solo puede ir detras de algo que ya dio un valor
 * (identificador, numero, `)`, `]`, comillas), y en cualquier otro caso es una regular.
 */
function arrancaRegular(src, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return true;
  return !/[A-Za-z0-9_$)\]}'"`]/.test(src[k]);
}

/**
 * @param {string} src  el archivo completo.
 * @returns {string} el mismo archivo sin comentarios. Conserva saltos de linea, asi
 *   que los numeros de linea siguen sirviendo para ubicar un hallazgo.
 */
export function sinComentarios(src) {
  let salida = "";
  let i = 0;
  const pila = [{ tipo: ES_CODIGO, depth: 0 }];
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    const f = pila[pila.length - 1];
    // "codigo" y "expr" se leen igual: dentro de `${...}` hay codigo, con sus cadenas y
    // sus comentarios. Lo unico que cambia es que en "expr" se cuentan las llaves.
    if (f.tipo === ES_CODIGO || f.tipo === ES_EXPR) {
      if (c === '"' || c === "'") { pila.push({ tipo: ES_STR, delim: c, depth: 0 }); salida += c; i += 1; continue; }
      if (c === "`") { pila.push({ tipo: ES_PLANTILLA, depth: 0 }); salida += c; i += 1; continue; }
      if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
      if (c === "/" && d === "*") {
        i += 2;
        while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
        i += 2;
        continue;
      }
      if (c === "/" && arrancaRegular(src, i)) {
        i += 1;
        let enClase = false;
        while (i < src.length) {
          if (src[i] === "\\") { i += 2; continue; }
          if (src[i] === "[") enClase = true;
          else if (src[i] === "]") enClase = false;
          else if (src[i] === "/" && !enClase) { i += 1; break; }
          else if (src[i] === "\n") break;
          i += 1;
        }
        continue;
      }
      if (c === "{" && f.tipo === ES_EXPR) f.depth += 1;
      if (c === "}" && f.tipo === ES_EXPR) {
        // Cierre de la expresion interpolada: se vuelve al texto de la plantilla.
        if (f.depth === 0) { pila.pop(); salida += c; i += 1; continue; }
        f.depth -= 1;
      }
      salida += c;
      i += 1;
      continue;
    }
    if (c === "\\") { salida += src.slice(i, i + 2); i += 2; continue; }
    if (c === "$" && d === "{") {
      salida += "${";
      i += 2;
      pila.push({ tipo: ES_EXPR, depth: 0 });
      continue;
    }
    if ((f.tipo === ES_STR && c === f.delim) || (f.tipo === ES_PLANTILLA && c === "`")) {
      pila.pop();
      salida += c;
      i += 1;
      continue;
    }
    salida += c;
    i += 1;
  }
  return salida;
}
