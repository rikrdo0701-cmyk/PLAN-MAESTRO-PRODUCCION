# Tiempo de piso — `/prd.html`

Página independiente para el teléfono del piso (Chrome en Android, instalable como PWA).
Lee el código **Code 128** de la OT con la cámara, registra cuándo empieza y cuándo termina
una operación y muestra el **ciclo por pieza en vivo**.

No es parte de la aplicación de planeación: no carga sesión, ni el lector, ni el escritor de
Supabase. Habla con la base por tres funciones RPC y nada más.

## Flujo

| Pantalla | Qué pasa |
|---|---|
| **Escanear** | Video a pantalla completa y marco de lectura. Un solo `BarcodeDetector` con `code_128`, una lectura cada 140 ms, enfriamiento de 5 s para el mismo código. El video **nunca se apaga**: las otras pantallas son hojas encima. |
| **Verificar** | **Pantalla completa, sin video** (RULE-PRD-009). OT a lo grande, artículo, descripción y cantidad en una columna para que la descripción use todo el ancho. Desplegable de operaciones (obligatorio) con su ciclo objetivo. `Iniciar` guarda la corrida; `Cancelar` cierra la pantalla sin tocar la base. |
| **Finalizar** | También a pantalla completa. Aparece al volver a escanear una OT que ya tiene corrida abierta. Operación, reloj desde el inicio, campo de piezas, aviso si la cantidad supera la de la OT (no bloquea), ciclo por pieza en vivo con semáforo. `Finalizar` guarda hora de fin, cantidad y ciclo. |

Después de iniciar o finalizar se vuelve a la cámara con un aviso breve (`OT iniciada`,
`Guardado: 2.50 min/pza`). Una OT cerrada, inexistente o con un código que no es una OT se
avisa y la página se queda en la cámara: no hay captura manual del folio.

## Datos

- Tabla `public.prdtiempo_registros` (17 columnas, una fila por corrida). DDL:
  `docs/schema-prdtiempo.sql`; descripción completa en `docs/data/sources.md`
  («Tiempos de piso»).
- Tres RPC `SECURITY DEFINER` con `execute` para `anon`: `prdtiempo_escanear`,
  `prdtiempo_iniciar`, `prdtiempo_finalizar`. La tabla no se expone (RLS sin políticas,
  grants revocados): la Data API contesta 401 a una lectura directa.
- El registro **no** vive en `operations` ni en `work_orders`: la ingesta de NetSuite las
  borra e inserta cada 15 minutos y el dato se perdería (RULE-PRD-001).

## Decisiones que no son obvias

1. **La hora es la del teléfono** y viaja como instante ISO (`timestamptz`). Un reloj mal
   puesto produce un ciclo falso; `prdtiempo_escanear` devuelve `servidor_ahora` para poder
   avisarlo sin cambiar el esquema (RULE-PRD-004).
2. **Una corrida abierta por OT + operación** (índice único parcial). `Iniciar` es
   idempotente: dos teléfonos con la misma operación no crean dos filas (RULE-PRD-003).
3. **Ciclo por pieza** = `round(segundos / 60 / cantidad, 2)`, la misma fórmula en la base y
   en la página. La página solo lo previsualiza; después de guardar muestra el número del
   servidor (RULE-PRD-005).
4. **Semáforo**: verde ≤ objetivo (`operations.tiempo_ciclo`, min/pza), ámbar ≤ +10 %, rojo
   arriba, gris «sin ciclo de referencia» cuando el objetivo es 0 o nulo.
5. **Cantidad entera > 0**; si supera la de la OT se avisa y se puede guardar igual
   (RULE-PRD-006).
6. **Sin red no se guarda ni se encola**: se avisa y no se finge que guardó. La cola local es
   una etapa posterior y se mete debajo de `rpc()` en `prd-app.js` (RULE-PRD-007).
7. **Sin login todavía** (decisión del usuario): el enlace es público y cualquiera que lo
   abra puede iniciar o finalizar corridas reales. Las funciones acotan el daño (solo OTs
   existentes, sin borrados, una corrida abierta por par, operación que debe pertenecer a la
   OT) pero no identifican a la persona. El **login por código de barras** es la etapa que lo
   cierra (RULE-PRD-002).
8. **El plan no se toca todavía**: `operacion_id`, `operacion_secuencia` y `cantidad` quedan
   guardados para que la etapa siguiente marque la operación como completada sin volver a
   capturar.
9. **Leída la OT, la cámara desaparece** (RULE-PRD-009, decisión del usuario 2026-11-12 con
   captura del teléfono). Las pantallas de verificar y finalizar ocupan toda la pantalla con
   fondo opaco, el video sigue encendido detrás (no se vuelve a pedir permiso ni se corta la
   lectura) y la letra crece con `clamp()`: OT hasta 4rem, datos hasta 1.5rem, ciclo hasta
   4rem. Los datos van en una columna (etiqueta arriba, valor abajo) para que la descripción
   use todo el ancho, y la barra de botones se queda pegada al pie aunque la lista no quepa.

## Archivos

| Ruta | Qué es |
|---|---|
| `src/web/prd/prd-core.js` | Lógica pura: leer el código, armar los cuerpos de las RPC, ciclo, semáforo, mensajes. Sin DOM ni red. |
| `src/web/prd/prd-app.js` | Cámara, tres pantallas, `rpc()`, reloj y render del ciclo. |
| `src/web/prd/prd.css` | Estilos del teléfono (áreas seguras, objetivos táctiles de 56 px, tema oscuro). |
| `src/web/prd/index.template.html` | Plantilla con `{{PRD_STYLES}}`, `{{PRD_CORE}}`, `{{PRD_APP}}`. |
| `docs/schema-prdtiempo.sql` | Tabla, índices, permisos, trigger y las tres RPC. |
| `tests/prd-core.test.mjs` | 8 pruebas de la lógica pura. |
| `tests/ddl-prdtiempo.test.mjs` | 8 pruebas del contrato del DDL y las RPC. |

## Build y publicación

`npm run build` arma `site/prd.html` (template + CSS + core + app, con `__PP_SUPABASE_URL__` y
`__PP_SUPABASE_ANON_KEY__` reemplazados una sola vez), `site/prd.webmanifest` y los iconos
`prd-icon-192.png` / `prd-icon-512.png` generados en el build. **No viaja a `dist/`**: no es
una vista de Apps Script.

El service worker incluye `./prd.html` y `./prd.webmanifest` en `APP_SHELL` y, en una
navegación sin red, devuelve la página que se pidió (antes contestaba siempre `index.html`, y
abrir la página de piso sin señal entregaba la de planeación). La página registra el service
worker solo en `*.github.io`.

Instalación: abrir la URL publicada en Chrome (Android) y usar «Instalar aplicación» /
«Agregar a la pantalla principal». El manifiesto arranca en `./prd.html`, en modo `standalone`
y orientación vertical.

## Límites conocidos

- Requiere Chrome en Android: el lector es el `BarcodeDetector` nativo. Otro navegador muestra
  el aviso y no avanza.
- Sin login (etapa siguiente).
- Sin cola offline: sin red no se guarda nada.
- La cantidad no se valida contra la de la OT (es un aviso, decisión del usuario).
- Todavía no marca operaciones completadas en el plan.
