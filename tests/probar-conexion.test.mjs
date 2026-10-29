// El detector de conexion tiene que poder distinguir "no conecta" de "se calla", y no puede
// imprimir el secreto ni escribir nada. Se afirma sobre el fuente, que es lo unico que se
// puede afirmar sin una base de datos de verdad.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const src = await readFile(new URL("../scripts/probar-conexion.mjs", import.meta.url), "utf8");
const aplicar = await readFile(new URL("../scripts/apply-sql-supabase.mjs", import.meta.url), "utf8");

test("el detector se sincroniza con el script que aplica el DDL", () => {
  // MEDIDO 2026-09-30: aplicar el DDL fallo con "password authentication failed for user
  // postgres", que no dice si la contrasena estaba mal o si el usuario no correspondia al
  // puerto. El pooler resuelve postgres.<ref> al rol postgres en los dos casos, asi que el
  // mensaje es identico y no sirve para distinguirlos. Si el script de aplicacion cambia de
  // puerto o de usuario, el detector tiene que seguir probando ESA forma, o dejaria de servir.
  const m = aplicar.match(/postgresql:\/\/([^:]+):[^@]*@([^:]+):(\d+)/);
  assert.ok(m, "no se pudo leer la cadena de conexion del script de aplicacion");
  const usuario = m[1];
  const host = m[2];
  const puerto = m[3];

  // Se buscan puerto y usuario JUNTOS, en la misma entrada. Un detector que probara el
  // usuario correcto en otro puerto tampoco serviria para este fallo.
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const forma = new RegExp("port:\\s*" + esc(puerto) + "\\s*,\\s*user:\\s*`?" + esc(usuario) + "`?");
  assert.match(src, forma,
    "el detector no prueba la forma que usa el script de aplicacion (user=" + usuario + " port=" + puerto + ")");

  // Y tiene que apuntar al mismo pooler.
  assert.ok(src.includes(host.split("-").slice(-3).join("-")) || src.includes("${region}"),
    "el detector no apunta al mismo host que el script (" + host + ")");
});

test("el detector NUNCA imprime la contrasena", () => {
  // Un detector de conexion que se cuelga con la clave en pantalla es un detector que nadie
  // va a usar. Se afirman las DOS formas en que un valor se escapa a un log: interpolado
  // (${password}) o como argumento suelto (console.log("x", password)). La comprobacion
  // `if (!password)` NO es eso, y no debe hacer fallar el test: ahi el valor va dentro de un
  // `!`, no en la cola de argumentos del log.
  const lineas = src.split("\n").filter((l) => /console\.(log|error|warn)/.test(l));
  assert.ok(lineas.length >= 3, "el detector deberia informar algo; si no imprime nada, no sirve");
  for (const l of lineas) {
    assert.doesNotMatch(l, /\$\{\s*password\s*\}/, "imprime la contrasena: " + l.trim());
    assert.doesNotMatch(l, /,\s*password\s*\)/, "pasa la contrasena a un log: " + l.trim());
    assert.doesNotMatch(l, /,\s*password\s*,/, "pasa la contrasena a un log: " + l.trim());
  }
  // Y de la contrasena solo se mide la LONGITUD, que no dice nada del valor.
  assert.match(src, /password\.length/);
  assert.match(src, /no se imprime/);
});

test("el detector no escribe nada: solo un SELECT", () => {
  // El unico SQL que puede ejecutar es una lectura. Si alguien mete un INSERT aqui para
  // "comprobar algo", deja de ser un detector y pasa a ser un segundo aplicador de DDL.
  const sql = src.match(/query\(\s*(["'`])([\s\S]*?)\1\s*\)/);
  assert.ok(sql, "no se encontro la consulta del detector");
  assert.match(sql[2], /^\s*select /i, "la consulta tiene que ser un SELECT: " + sql[2]);
  assert.doesNotMatch(src, /query\([^)]*\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i,
    "el detector no puede ejecutar sentencias que escriban");
});

test("el detector explica las DOS causas, no solo una", () => {
  // Si solo documentara la contrasena, alguien con la contrasena CORRECTA y el usuario mal
  // leeria "la contrasena esta mal" y se iria a resetear una password que esta bien. Y al
  // reves: resetear la password es un cambio real en la base hecho por un diagnostico mal leido.
  assert.match(src, /contrasena no es la de la base/i, "falta la causa (a): la contrasena");
  assert.match(src, /formato del usuario no corresponde al puerto/i, "falta la causa (b): el formato");
  assert.match(src, /session pooler/i);
  assert.match(src, /transaction pooler/i);
  assert.match(src, /5432/);
  assert.match(src, /6543/);
});

test("el cierre cuenta solo las formas que LLEGARON a verificar la contrasena", () => {
  // MEDIDO 2026-09-30, primera corrida real. El cierre decia, con cuatro fallos de TRES tipos
  // distintos: "el pooler acepto las cuatro y las cuatro dijeron password authentication
  // failed, o sea que llego a donde se verifica". Eso era FALSO. Los cuatro errores fueron:
  //
  //   session     5432  user=postgres       -> (ENOIDENTIFIER) no tenant identifier provided
  //   session     5432  user=postgres.<ref> -> password authentication failed
  //   transaction 6543  user=postgres.<ref> -> password authentication failed
  //   directa db.<ref>:5432                 -> getaddrinfo ENOTFOUND
  //
  // Solo DOS fueron de contrasena. Y el primero dice algo CONTRADICTORIO de lo que el cierre
  // afirmaba: el pooler NO acepto esa forma porque exige el tenant en el usuario, lo cual
  // confirma que la forma que usa apply-sql-supabase.mjs (postgres.<ref>) es la CORRECTA.
  // Con el texto anterior, alguien iba a "arreglar" el formato del usuario, que ya estaba bien.
  // Un diagnostico que afirma mas de lo que sabe hace perder el rato en el sistema equivocado.
  assert.match(src, /no tenant identifier provided/i, "falta reconocer el error de tenant del pooler");
  assert.match(src, /ENOTFOUND|ENODATA/, "falta reconocer que el host no resuelve");
  assert.match(src, /clasificar\(/, "el cierre tiene que apoyarse en la clasificacion");
  assert.match(src, /formasQueVerificaronLaContrasena/,
    "el cierre tiene que contar solo las que llegaron a verificar");
  assert.doesNotMatch(src, /acepto las cuatro|las cuatro dijeron/i,
    "el cierre no puede afirmar que todas las formas Fallaron con el mismo error");
  // Y las dos que no aplican tienen que estar marcadas como tales, no como fallos: contarlas
  // como fallos de contrasena es justamente el error que se esta corrigiendo.
  assert.match(src, /noAplica/, "las formas que no aplican tienen que marcarse aparte");  assert.match(src, /no dicen NADA de la contrasena|NADA de la contrasena/,
    "tiene que decir que esas formas no dicen nada de la contrasena");

  // Se afirma sobre el archivo entero, sin stripper de comentarios. Antes el comentario de
  // arriba citaba el texto viejo de la conclusion y el test tenia que distinguir prosa de
  // codigo para no fallar por algo bien escrito; el stripper no era confiable y hacia fallar
  // el test por el comentario de la cabecera. Se reescribio el comentario en vez de arreglar
  // el stripper: la explicacion sigue diciendo lo mismo, sin la cita literal.
  assert.doesNotMatch(src, /acepto las cuatro|las cuatro dijeron|NINGUNA COMBINACION FUNCIONO/i,
    "el cierre no puede afirmar que todas las formas fallaron con el mismo error");
});

test("el detector avisa de un largo IMPLAUSIBLE antes de hacer nada", () => {
  // MEDIDO 2026-09-30: la contrasena que se probo tenia 127 caracteres. Un password de base de
  // Supabase no llega a eso: lo que estaba en la variable era otra cosa. Notarlo es MAS BARATO
  // que cuatro conexiones fallidas, y mas claro que el error que sale de ellas.
  assert.match(src, /LARGO_IMPLAUSIBLE/);
  assert.match(src, /IMPLAUSIBLE/);
  assert.match(src, /access token|JWT/i, "hay que decir QUE es lo que suele estar en su lugar");
  assert.match(src, /postgresql:\/\/postgres:/,
    "hay que decir que se copia solo la parte de la contrasena, no la cadena entera");
});

test("cada declaracion se usa y cada uso se declara", () => {
  // Un typo mio dejo el cierre entero sin funcionar: la declaracion era "llegaronAVerificar" y
  // los usos "lleganAVerificar", y el script imprimia TODO el diagnostico y luego moria con
  // ReferenceError en la CONCLUSION, que es justo la parte que el detector existe para dar. Un
  // detector que muere al dar su veredicto es peor que uno que no existe, porque alguien lo
  // corre, ve la mitad de la respuesta, y cree que ya sabe.
  assert.doesNotMatch(src, /lleg\w+nAVerificar/,
    "quedaron dos formas parecidas de un mismo identificador: declaracion y usos no coinciden");
  const decl = src.match(/const formasQueVerificaronLaContrasena = /g) || [];
  assert.equal(decl.length, 1, "se esperaba una sola declaracion de formasQueVerificaronLaContrasena");
  const usos = (src.match(/formasQueVerificaronLaContrasena/g) || []).length;
  assert.ok(usos >= 4, "la variable se declara y se usa en la conclusion y en su detalle");
});

test("el detector avisa que el certificado del pooler no valida", () => {
  // MEDIDO 2026-09-30: la aplicacion imprimio "self-signed certificate in certificate chain"
  // y reintento SIN verificar. El canal va cifrado; lo que no se verifica es quien esta al
  // otro lado. Es aceptable para aplicar un DDL propio, pero tiene que estar DICHO en el
  // codigo, no solo haber salido una vez en una terminal.
  assert.match(src, /rejectUnauthorized:\s*false/);
  assert.match(src, /cifrado/i, "falta decir que el canal va cifrado aunque no se verifique");
  assert.match(src, /no se verifica|quien esta al otro lado/i, "falta decir que no se verifica el otro extremo");
});
