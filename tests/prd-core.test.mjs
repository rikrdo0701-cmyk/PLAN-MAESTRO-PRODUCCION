// LA LOGICA DE LA PAGINA DE PISO, PROBADA SIN CAMARA Y SIN RED.
//
// Se carga el archivo con `vm` igual que tests/inspection-core.test.mjs: el navegador
// lo recibe como un script clasico que deja `PrdCore` en `window`, y aqui se le da un
// `window` vacio. Asi se prueba EXACTAMENTE el archivo que se publica, no una copia.
//
// QUE SE COMPRUEBA, Y POR QUE CADA COSA:
//
// 1. LEER EL CODIGO. Code 128 llega con relleno y a veces con letras (otro documento o
//    lectura mala). Se recorta, y lo que no son digitos se rechaza: adivinar produce
//    una OT equivocada con datos de otra orden.
//
// 2. LOS TRES CUERPOS DE LLAMADA. Los nombres de parametro tienen que ser los de las
//    funciones de docs/schema-prdtiempo.sql. Si uno se escribe distinto, PostgREST
//    contesta 404 y en el telefono se ve igual que "no hay red".
//
// 3. EL CICLO POR PIEZA. Tiene que dar lo mismo que el SQL: segundos / 60 / piezas, a
//    2 decimales. La prueba fija los casos (10 min / 4 = 2.50) para que un cambio de
//    formula no pase inadvertido.
//
// 4. EL SEMAFORO. Verde <= objetivo, ambar hasta +10%, rojo arriba, gris sin objetivo.
//    Se prueban los bordes exactos (1.65 contra 1.50 es +10%: ambar; 1.66 es rojo).
//
// 5. QUE PANTALLA TOCA. Una OT cerrada o inexistente no puede abrir la pantalla de
//    iniciar; una con corrida abierta va derecho a finalizar.
//
// 6. LOS MENSAJES. Se afirma el texto completo de los dos que el operador ve mas: OT
//    no encontrada y OT cerrada. Un mensaje vacio o tecnico ("PGRST116") no le dice
//    nada a quien esta en la maquina.
//
// 7. LOS MOTIVOS SON LOS DEL SQL. Si la base renombra un motivo, la pagina no lo
//    traduciria y caeria en el mensaje generico. Esta prueba compara las dos listas.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const fuente = await readFile(new URL("../src/web/prd/prd-core.js", import.meta.url), "utf8");
const contexto = { window: {} };
vm.runInNewContext(fuente, contexto);
const core = contexto.window.PrdCore;

const DDL = await readFile(new URL("../docs/schema-prdtiempo.sql", import.meta.url), "utf8");

const ID = "c7ca23c0-d2af-406e-bc49-e2718a2bbc27";
const INICIO = new Date("2026-11-11T20:51:57-06:00");
const DIEZ_MIN_DESPUES = new Date(INICIO.getTime() + 10 * 60 * 1000);

test("1. lee el codigo de la OT y rechaza lo que no son digitos", () => {
  assert.deepEqual(structuredClone(core.leerOt(" 2151\n")), { ok: true, ot: "2151" });
  assert.deepEqual(structuredClone(core.leerOt("2151")), { ok: true, ot: "2151" });
  // "0000" es valido como codigo: que la OT exista lo decide la base, no el telefono.
  assert.deepEqual(structuredClone(core.leerOt("0000")), { ok: true, ot: "0000" });

  for (const malo of ["36A8", "", "   ", "2151 2152", "2151-2", "OT-2151", "123456789012345678901"]) {
    const lectura = core.leerOt(malo);
    assert.equal(lectura.ok, false, "acepto como OT: " + JSON.stringify(malo));
    assert.equal(lectura.motivo, "ot_invalida");
  }
  assert.equal(core.esOtValida("2151"), true);
  assert.equal(core.esOtValida("36A8"), false);
});

test("2. arma los cuerpos de las tres llamadas con los nombres de parametro del SQL", () => {
  assert.deepEqual(structuredClone(core.cuerpoEscanear(" 2151 ")), { ok: true, cuerpo: { p_ot: "2151" } });
  assert.deepEqual(structuredClone(core.cuerpoEscanear("36A8")), { ok: false, motivo: "ot_invalida" });

  const iniciar = core.cuerpoIniciar({
    ot: "2151",
    operacionId: "ns-19590",
    horaInicio: INICIO,
    dispositivo: "tel-abc",
  });
  assert.equal(iniciar.ok, true);
  assert.deepEqual(structuredClone(iniciar.cuerpo), {
    p_ot: "2151",
    p_operacion_id: "ns-19590",
    p_hora_inicio: "2026-11-12T02:51:57.000Z",
    p_dispositivo: "tel-abc",
  });
  // La hora viaja como instante (UTC), no como hora de pared: la base la guarda como
  // timestamptz y el ciclo sale de la diferencia.
  assert.equal(iniciar.cuerpo.p_hora_inicio.endsWith("Z"), true);

  // El identificador del telefono se recorta a 80, que es lo que acepta la columna.
  const largo = core.cuerpoIniciar({ ot: "2151", operacionId: "ns-1", horaInicio: INICIO, dispositivo: "x".repeat(200) });
  assert.equal(largo.cuerpo.p_dispositivo.length, 80);

  for (const [partes, motivo] of [
    [{ ot: "36A8", operacionId: "ns-1", horaInicio: INICIO }, "ot_invalida"],
    [{ ot: "2151", operacionId: "", horaInicio: INICIO }, "operacion_invalida"],
    [{ ot: "2151", operacionId: "   ", horaInicio: INICIO }, "operacion_invalida"],
    [{ ot: "2151", operacionId: "ns-1", horaInicio: "no es fecha" }, "hora_invalida"],
    [{ ot: "2151", operacionId: "ns-1" }, "hora_invalida"],
  ]) {
    assert.equal(core.cuerpoIniciar(partes).motivo, motivo, JSON.stringify(partes));
  }

  const finalizar = core.cuerpoFinalizar({ id: ID, cantidad: 4, horaFin: DIEZ_MIN_DESPUES });
  assert.equal(finalizar.ok, true);
  assert.deepEqual(structuredClone(finalizar.cuerpo), {
    p_id: ID,
    p_cantidad: 4,
    p_hora_fin: "2026-11-12T03:01:57.000Z",
  });

  // La cantidad llega como texto del campo numerico: "4" es valido, 1.5 y 0 no.
  assert.equal(core.cuerpoFinalizar({ id: ID, cantidad: "4", horaFin: DIEZ_MIN_DESPUES }).ok, true);
  for (const [cantidad, motivo] of [[0, "cantidad_invalida"], [-1, "cantidad_invalida"], [1.5, "cantidad_invalida"], ["", "cantidad_invalida"], [null, "cantidad_invalida"]]) {
    assert.equal(core.cuerpoFinalizar({ id: ID, cantidad, horaFin: DIEZ_MIN_DESPUES }).motivo, motivo, "cantidad " + cantidad);
  }

  assert.equal(core.cuerpoFinalizar({ id: "123", cantidad: 4, horaFin: DIEZ_MIN_DESPUES }).motivo, "id_invalida");
  assert.equal(core.cuerpoFinalizar({ cantidad: 4, horaFin: DIEZ_MIN_DESPUES }).motivo, "id_invalida");
  assert.equal(core.cuerpoFinalizar({ id: ID, cantidad: 4, horaFin: "ayer" }).motivo, "hora_invalida");
});

test("3. el ciclo por pieza da lo mismo que la funcion de la base", () => {
  // 10 minutos, 4 piezas -> 2.50 min/pza (el caso que se verifico contra producción).
  assert.equal(core.cicloPorPiezaMin(600, 4), 2.5);
  assert.equal(core.cicloEntreFechas(INICIO, DIEZ_MIN_DESPUES, 4), 2.5);
  // 100 s / 3 = 0.5555... -> 0.56
  assert.equal(core.cicloPorPiezaMin(100, 3), 0.56);
  assert.equal(core.cicloPorPiezaMin(60, 1), 1);
  assert.equal(core.cicloPorPiezaMin(3600, 7), 8.57);

  // Sin con que calcular: null, no 0. Un 0 se pinta como ciclo perfecto y nadie lo midio.
  assert.equal(core.cicloPorPiezaMin(-5, 2), null);
  assert.equal(core.cicloPorPiezaMin(600, 0), null);
  assert.equal(core.cicloPorPiezaMin(600, -2), null);
  assert.equal(core.cicloPorPiezaMin(600, 2.5), null);
  assert.equal(core.cicloEntreFechas("ayer", DIEZ_MIN_DESPUES, 4), null);

  assert.equal(core.segundosEntre(INICIO, DIEZ_MIN_DESPUES), 600);
  assert.equal(core.segundosEntre(DIEZ_MIN_DESPUES, INICIO), 0);
});

test("4. el semaforo: verde igual o menor, ambar hasta +10%, rojo arriba, gris sin objetivo", () => {
  assert.equal(core.colorCiclo(1.2, 1.5).tono, "verde");
  assert.equal(core.colorCiclo(1.5, 1.5).tono, "verde", "igual al objetivo sigue siendo verde");
  assert.equal(core.colorCiclo(1.6, 1.5).tono, "ambar", "1.60 contra 1.50 es +6.7%");
  assert.equal(core.colorCiclo(1.65, 1.5).tono, "ambar", "1.65 contra 1.50 es exactamente +10%: todavia ambar");
  assert.equal(core.colorCiclo(1.66, 1.5).tono, "rojo", "1.66 contra 1.50 pasa el 10%");
  assert.equal(core.colorCiclo(2.5, 1.5).tono, "rojo");

  assert.equal(core.colorCiclo(1.2, 1.5).desviacion, -20);
  assert.equal(core.colorCiclo(1.65, 1.5).desviacion, 10);
  assert.equal(core.colorCiclo(2.5, 1.5).desviacion, 67);

  // Operacion sin tiempo de ciclo capturado: gris y se dice, en vez de comparar contra 0.
  for (const objetivo of [0, null, undefined, "", "x"]) {
    const color = core.colorCiclo(2.5, objetivo);
    assert.equal(color.tono, "sin-referencia", "objetivo " + JSON.stringify(objetivo));
    assert.equal(color.desviacion, null);
    assert.equal(color.etiqueta, "sin ciclo de referencia");
  }
  assert.equal(core.colorCiclo(null, 1.5).tono, "sin-referencia");
  assert.equal(core.etiquetaObjetivo(1.5), "1.50 min/pza");
  assert.equal(core.etiquetaObjetivo(0), "sin ciclo de referencia");
});

test("5. decide que pantalla sigue despues de escanear", () => {
  const noEncontrada = core.decidirPantalla({ ok: false, motivo: "no_encontrada", ot: "0000" });
  assert.equal(noEncontrada.pantalla, "escanear");
  assert.equal(noEncontrada.mensaje, "La OT 0000 no está en el sistema.");

  const nueva = core.decidirPantalla({
    ok: true, ot: "2151", operaciones: [{ operation_id: "ns-1" }], abiertas: [],
  });
  assert.equal(nueva.pantalla, "verificar");
  assert.equal(nueva.operaciones.length, 1);

  const abiertas = [
    { id: ID, operacion_id: "ns-2", hora_inicio: "2026-11-12T02:51:57+00:00" },
    { id: "11111111-2222-3333-4444-555555555555", operacion_id: "ns-1", hora_inicio: "2026-11-12T01:00:00+00:00" },
  ];
  const finalizando = core.decidirPantalla({ ok: true, ot: "2151", operaciones: [], abiertas });
  assert.equal(finalizando.pantalla, "finalizar");
  assert.equal(finalizando.corrida.id, ID, "tiene que tomar la corrida mas reciente, que es la primera del arreglo");
  assert.equal(finalizando.abiertas.length, 2);
});

test("6. los mensajes dicen que paso, sin codigos tecnicos", () => {
  assert.equal(core.mensajeEscaneo({ ok: false, motivo: "ot_invalida" }), "Ese código no es una OT.");
  assert.equal(core.mensajeEscaneo({ ok: false, motivo: "no_encontrada", ot: "0000" }), "La OT 0000 no está en el sistema.");
  assert.equal(
    core.mensajeEscaneo({ ok: false, motivo: "cerrada", ot: "2222", estatus: "Orden de trabajo : Cerrada" }),
    "La OT 2222 ya está cerrada (Orden de trabajo : Cerrada).",
  );
  assert.equal(core.mensajeEscaneo({ ok: false, motivo: "cerrada", ot: "2222" }), "La OT 2222 ya está cerrada.");
  // Un motivo desconocido no puede dejar la pantalla sin explicacion.
  assert.equal(core.mensajeEscaneo({ ok: false, motivo: "lo_que_sea" }), "No se pudo leer la OT. Intenta otra vez.");
  assert.equal(core.mensajeEscaneo(null), "No se pudo leer la OT. Intenta otra vez.");

  assert.match(core.mensajeError("ya_finalizada"), /otro teléfono/);
  assert.match(core.mensajeError("operacion_invalida"), /no pertenece a la OT/);
  assert.match(core.mensajeError("cerrada", { ot: "2151" }), /2151/);
  assert.match(core.mensajeError("cantidad_invalida"), /entero mayor que cero/);
  assert.match(core.mensajeError("desconocido"), /Intenta otra vez/);
});

test("7. los motivos de la pagina son los que devuelve el SQL", () => {
  const motivos = Object.values(core.MOTIVOS);
  assert.equal(motivos.length >= 6, true);
  for (const motivo of motivos) {
    assert.equal(
      DDL.includes("'" + motivo + "'"),
      true,
      "docs/schema-prdtiempo.sql no devuelve el motivo '" + motivo + "': la pagina lo traduciria al mensaje generico",
    );
  }
});

test("8. formatos y avisos de la pantalla", () => {
  assert.equal(core.formatearCiclo(2.5), "2.50");
  assert.equal(core.formatearCiclo(0), "0.00");
  assert.equal(core.formatearCiclo(null), "-");

  assert.equal(core.textoDuracion(0), "00:00");
  assert.equal(core.textoDuracion(65), "01:05");
  assert.equal(core.textoDuracion(600), "10:00");
  assert.equal(core.textoDuracion(3661), "01:01:01");
  assert.equal(core.textoDuracion(-5), "00:00");

  // Aviso NO bloqueante: se puede guardar una cantidad mayor a la de la OT.
  assert.equal(core.avisoCantidad(200, 200), "");
  assert.equal(core.avisoCantidad(150, 200), "");
  const aviso = core.avisoCantidad(250, 200);
  assert.match(aviso, /250/);
  assert.match(aviso, /200/);
  assert.equal(core.avisoCantidad(250, 0), "");
  assert.equal(core.avisoCantidad(0, 200), "");

  assert.equal(
    core.resumenOperacion({ secuencia: 10, descripcion: "DOBLADO", maquina: "DOBLADORA 1" }),
    "10 - DOBLADO (DOBLADORA 1)",
  );
  assert.equal(core.resumenOperacion({ operation_id: "ns-1" }), "ns-1");

  const guardado = core.mensajeFinalizada({ tiempo_ciclo_min: 2.5, ciclo_objetivo_min: 1.5 });
  assert.equal(guardado.ciclo, "2.50");
  assert.equal(guardado.tono, "rojo");
  assert.equal(guardado.texto, "Guardado: 2.50 min/pza");
  assert.equal(core.mensajeFinalizada({ tiempo_ciclo_min: 1.2, ciclo_objetivo_min: 1.5 }).tono, "verde");
  assert.equal(core.mensajeFinalizada({ tiempo_ciclo_min: 1.2, ciclo_objetivo_min: 0 }).tono, "sin-referencia");
});
