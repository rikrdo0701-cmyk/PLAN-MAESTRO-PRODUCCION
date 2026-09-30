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

test("el detector avisa que el certificado del pooler no valida", () => {
  // MEDIDO 2026-09-30: la aplicacion imprimio "self-signed certificate in certificate chain"
  // y reintento SIN verificar. El canal va cifrado; lo que no se verifica es quien esta al
  // otro lado. Es aceptable para aplicar un DDL propio, pero tiene que estar DICHO en el
  // codigo, no solo haber salido una vez en una terminal.
  assert.match(src, /rejectUnauthorized:\s*false/);
  assert.match(src, /cifrado/i, "falta decir que el canal va cifrado aunque no se verifique");
  assert.match(src, /no se verifica|quien esta al otro lado/i, "falta decir que no se verifica el otro extremo");
});
