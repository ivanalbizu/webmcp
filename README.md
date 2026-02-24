# WebMCP — Tutorial práctico con Astro

Tutorial paso a paso para usar la **Web Model Context Protocol (WebMCP)**, API experimental de Chrome, en un proyecto Astro.

## Qué es WebMCP?

WebMCP es una API del navegador (`navigator.modelContext`) que permite a las páginas web **exponer herramientas (tools) y contexto a agentes IA** (ej. Gemini en Chrome).

La diferencia clave con otras APIs de IA del navegador:

> **La página NO llama al modelo. El modelo llama a la página.**

```
┌─────────────────────┐
│  Tu página web      │  ← registra tools + contexto
│  (navigator         │
│   .modelContext)     │
└────────┬────────────┘
         │ provideContext()
         ▼
┌─────────────────────┐
│  Navegador Chrome   │  ← actúa de intermediario
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Agente IA          │  ← lee contexto, invoca tools
│  (Gemini sidebar,   │
│   extensión, etc.)  │
└─────────────────────┘
```

## Requisitos

- **Chrome Canary 146+** (la API no existe en Chrome estable)
- Flag habilitada: `chrome://flags/#web-mcp-for-testing` → **Enabled**
- Para probar tools: extensión **[Model Context Tool Inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)**

## Setup del proyecto

```bash
pnpm install
pnpm dev
```

---

## La API: `navigator.modelContext`

La API vive en `navigator.modelContext` y tiene **4 métodos**:

| Método | Qué hace |
|--------|----------|
| `provideContext(params)` | Registra contexto + tools de una vez |
| `registerTool(tool)` | Añade una tool individual (sin tocar las demás) |
| `unregisterTool(name)` | Elimina una tool por nombre |
| `clearContext()` | Elimina todo: contexto y tools |

### Detección

```js
// La API es experimental y no está tipada en TypeScript
const mcp = (navigator as any).modelContext;

if (mcp) {
  console.log('WebMCP disponible');
} else {
  console.log('WebMCP no detectado — revisa Chrome Canary + flags');
}
```

> **Ojo:** `navigator.ai` y `window.ai` NO son WebMCP.
> - `navigator.ai` era un namespace propuesto que no se implementó.
> - `window.ai.languageModel` es la Prompt API (otra API distinta).
> - WebMCP está exclusivamente en **`navigator.modelContext`**.

---

## `provideContext()` — Método principal

Registra en una sola llamada: contexto sobre la página y las tools que el agente puede usar.

```js
await mcp.provideContext({
  // Identificador legible de esta página
  name: 'Mi Configurador',

  // Descripción corta para que el agente entienda de qué va la página
  description: 'Configurador de producto con opciones de color y tamaño.',

  // Texto libre con información detallada. El agente lo lee para
  // tomar decisiones informadas al invocar las tools.
  context: `Colores disponibles: rojo, azul, verde.
Estado actual: rojo seleccionado.`,

  // OBLIGATORIO: array de tools (puede ser vacío: [])
  tools: [
    { /* ver estructura de tool abajo */ }
  ]
});
```

> **`tools` es obligatorio.** Si solo quieres dar contexto sin tools, pasa `tools: []`.
> Descubrimos esto porque Chrome lanza error si no se incluye.

---

## Estructura de una Tool

Cada tool tiene 4 campos:

```js
{
  // Identificador único — el agente lo usa para invocar la tool
  name: 'cambiarColor',

  // Texto que el agente lee para decidir CUÁNDO usar esta tool
  description: 'Cambia el color del producto mostrado en la página.',

  // JSON Schema estándar que define los argumentos aceptados.
  // El agente genera los argumentos según este schema.
  parameters: {
    type: 'object',
    properties: {
      colorKey: {
        type: 'string',
        enum: ['rojo', 'azul', 'verde'],  // restringe valores válidos
        description: 'Clave del color a aplicar'
      }
    },
    required: ['colorKey']
  },

  // Callback que el navegador ejecuta cuando el agente invoca la tool.
  // Recibe los parámetros como objeto y devuelve un string de resultado
  // que el agente recibe de vuelta (como una respuesta de API).
  execute: ({ colorKey }) => {
    aplicarColor(colorKey);
    return `Color cambiado a ${colorKey}`;
  }
}
```

---

## `registerTool()` y `unregisterTool()`

Para añadir o quitar tools dinámicamente después del `provideContext()` inicial:

```js
// Añadir una tool nueva (ej. cuando aparece una nueva opción en la UI)
await mcp.registerTool({
  name: 'nuevaAccion',
  description: '...',
  parameters: { /* JSON Schema */ },
  execute: (params) => { /* ... */ }
});

// Eliminar una tool (ej. cuando una opción deja de estar disponible)
await mcp.unregisterTool('nuevaAccion');
```

### `clearContext()`

Limpia todo — contexto y todas las tools registradas:

```js
await mcp.clearContext();
```

Útil al navegar a otra sección o al hacer cleanup.

---

## Cómo llegan los datos al `execute`? (flujo completo)

Cuando registras una tool, defines un `parameters` (JSON Schema) y un `execute` (callback).
El flujo de datos es:

```
Tool Inspector / Gemini         Chrome (navegador)            Tu página
       │                              │                          │
       │  "ejecuta cambiarColor       │                          │
       │   con {colorKey:'blanco'}"   │                          │
       │ ────────────────────────────►│                          │
       │                              │                          │
       │                              │  execute({colorKey:      │
       │                              │          'blanco'})      │
       │                              │ ────────────────────────►│
       │                              │                          │
       │                              │                          │ 1. Lee COLORS['blanco']
       │                              │                          │ 2. Llama setProductColor()
       │                              │                          │ 3. La UI cambia
       │                              │                          │
       │                              │  return "Color cambiado  │
       │                              │   a Titanio Blanco"      │
       │                              │ ◄────────────────────────│
       │                              │                          │
       │  muestra el resultado        │                          │
       │ ◄────────────────────────────│                          │
       │                              │                          │
```

### Paso a paso:

**1. Tú defines el schema** — es el "contrato" de qué argumentos acepta la tool:

```js
parameters: {
  type: 'object',
  properties: {
    colorKey: {
      type: 'string',
      enum: ['natural', 'azul', 'blanco', 'negro']
    }
  },
  required: ['colorKey']
}
```

**2. El agente construye un objeto** que cumple ese schema. En el Tool Inspector lo escribes tú manualmente (`{"colorKey": "blanco"}`). Cuando sea Gemini, el modelo lo generará automáticamente leyendo el schema.

**3. Chrome ejecuta tu callback** pasándole ese objeto como argumento:

```js
// Internamente, Chrome hace algo como:
const resultado = tuTool.execute({ colorKey: "blanco" });
```

**4. Tú `execute` recibe el objeto** y lo procesa. Usamos destructuring de JS para extraer las propiedades:

```js
// Esto:
execute: ({ colorKey }) => { ... }

// Es equivalente a esto:
execute: (params) => {
  const colorKey = params.colorKey;  // "blanco"
  ...
}
```

**5. El `return` es la respuesta** — el string que devuelves es lo que el agente recibe de vuelta, como si fuera la respuesta de una API REST:

```js
execute: ({ colorKey }) => {
  const color = COLORS[colorKey];       // { hex: '#F2F1EB', name: 'Titanio Blanco' }
  setProductColor(color.hex, color.name); // Actualiza la UI
  return `Color cambiado a ${color.name}`; // → El agente recibe este texto
}
```

> Es como una **API REST pero sin HTTP**: el schema es el contrato,
> el agente genera el request (el objeto JSON), Chrome lo rutea a tu
> `execute`, y el `return` es la response.

---

## Patrón clave: funciones compartidas entre UI y agente IA

La misma lógica de negocio sirve tanto para clicks del usuario como para invocaciones del agente IA:

```
┌─────────────────┐
│ Usuario (click)  │──┐
└─────────────────┘  │     ┌──────────────────┐
                     ├────►│ setProductColor() │──► Actualiza la UI
┌─────────────────┐  │     └──────────────────┘
│ Agente IA (tool) │──┘
└─────────────────┘
```

**Click del usuario** — llama directamente a la función con los datos del DOM:

```js
btn.addEventListener('click', () => {
  // Los datos vienen del atributo data-* del botón HTML
  setProductColor('#2F333A', 'Titanio Azul');
});
```

**Agente IA** — el `execute` actúa como **adaptador** entre el lenguaje del agente y tu función:

```js
execute: ({ colorKey }) => {
  // El agente habla en "keys" (ej. "blanco")
  // Tu función espera hex + nombre
  // execute hace la traducción:
  const color = COLORS[colorKey];  // "blanco" → { hex: '#F2F1EB', name: 'Titanio Blanco' }
  setProductColor(color.hex, color.name);  // misma función que usa el click

  // Devuelve texto para que el agente confirme al usuario
  return `Color cambiado a ${color.name}`;
}
```

La función `setProductColor()` no sabe ni le importa quién la llama — solo recibe hex y nombre, y actualiza la UI. El `execute` es el puente que traduce entre el mundo del agente (texto/JSON) y tu lógica (funciones JS).

---

## Cómo probar las tools

### Opción 1: Model Context Tool Inspector (recomendada para desarrollo)

1. Instala la extensión desde [GitHub](https://github.com/beaufortfrancois/model-context-tool-inspector)
2. Abre tu página en Chrome Canary
3. Abre la extensión — verás las tools registradas listadas
4. Ejecuta una tool manualmente, ej: `{"colorKey": "azul"}`
5. La página reacciona cambiando el color

### Opción 2: Gemini sidebar

1. Abre el asistente Gemini en Chrome (icono sparkle en toolbar o `Alt+G`)
2. Dile: "Cambia el iPhone a color azul"
3. Gemini lee el contexto, invoca la tool, y la página cambia

> **Nota:** A fecha de este tutorial, Gemini sidebar solo está disponible en EEUU/inglés
> y requiere Chrome 137+ estable.

---

## Errores comunes que encontramos

| Error | Causa | Solución |
|-------|-------|----------|
| `navigator.modelContext` es `undefined` | Chrome estable o sin flag | Usa Chrome Canary + habilita `chrome://flags/#web-mcp-for-testing` |
| `provideContext` falla con "tools is required" | Falta el campo `tools` | Añade `tools: []` como mínimo |
| `navigator.ai` existe pero no funciona como WebMCP | Son APIs distintas | Usa `navigator.modelContext`, no `navigator.ai` |
| La tool se registra pero no pasa nada | No hay agente invocándola | Instala el Model Context Tool Inspector para probar manualmente |

---

## Estructura del proyecto

```
src/
├── webmcp/
│   ├── iphone-configurator.ts    ← Lógica WebMCP iPhone (independiente de framework)
│   ├── macbook-configurator.ts   ← Lógica WebMCP MacBook (mismo patrón)
│   └── chat.ts                   ← Chat con Gemini Nano via Prompt API
├── components/
│   ├── IphoneSelector.astro      ← Solo HTML + CSS + initConfigurator() + initChat()
│   ├── MacbookSelector.astro     ← Solo HTML + CSS + initConfigurator() + initChat()
│   └── ChatPanel.astro           ← UI del chat (burbujas, input, status)
├── pages/
│   ├── index.astro               ← Catálogo con iPhones y MacBooks
│   ├── iphone.astro              ← Configurador iPhone
│   └── macbook.astro             ← Configurador MacBook
└── types.d.ts                    ← Tipos para navigator.modelContext
```

Cada producto tiene su propio `*-configurator.ts` independiente del framework. Ambos exportan `initConfigurator(elements, options?)` que devuelve `{ tools }` — las definiciones de tools reutilizables tanto por WebMCP como por el chat.

## Chat con Gemini Nano (Prompt API)

Cada página de producto incluye un **chat integrado** que usa **Gemini Nano** (el modelo local de Chrome) para interpretar lenguaje natural y ejecutar los tools del configurador.

```
┌────────────────────────────────────────────────────┐
│  Usuario escribe:                                   │
│  "Quiero un iPhone que combine con un traje oscuro" │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│  Gemini Nano (local, via Prompt API)                │
│  LanguageModel.create() + responseConstraint        │
│                                                     │
│  → Interpreta: "traje oscuro" = color negro         │
│  → Devuelve: { tool: "cambiarColor",                │
│                args: { colorKey: "negro" } }        │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────┐
│  Se ejecuta toolDefs.cambiarColor.execute(args)     │
│  → La UI cambia el color a Titanio Negro            │
│  → El chat muestra la confirmación                  │
└────────────────────────────────────────────────────┘
```

### Cómo funciona

1. **`chat.ts`** es un módulo framework-agnostic que exporta `initChat(elements, options)`
2. Recibe los `tools` devueltos por `initConfigurator()` — las mismas funciones execute que usa WebMCP
3. Crea una sesión `LanguageModel` con un system prompt dinámico que describe los tools y sus parámetros enum según el producto
4. Usa `responseConstraint` (JSON Schema) para forzar a Gemini Nano a devolver JSON estructurado `{ tool, args }`
5. Ejecuta el tool correspondiente y muestra el resultado en el chat

### Requisitos adicionales para el chat

El chat usa la **Prompt API** (`LanguageModel`), que es una API distinta de WebMCP:

| | WebMCP | Prompt API |
|---|---|---|
| API | `navigator.modelContext` | `LanguageModel.create()` |
| Quién llama | El agente llama a la página | La página llama al modelo |
| Modelo | Gemini (cloud, en sidebar) | Gemini Nano (local, en device) |
| Flags | `#web-mcp-for-testing` | `#prompt-api-for-gemini-nano` + `#optimization-guide-on-device-model` |

Para activar el chat, habilita en `chrome://flags`:

- `#prompt-api-for-gemini-nano` → **Enabled**
- `#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**

La primera vez, Gemini Nano se descarga automáticamente (~1.7 GB). Si el modelo no está disponible, el chat se deshabilita con un mensaje informativo.

### Ejemplos de prompts

| Prompt | Tool ejecutada | Resultado |
|--------|---------------|-----------|
| "Ponlo en negro" | `cambiarColor({ colorKey: "negro" })` | Cambia a Titanio Negro |
| "Quiero el más grande" | `cambiarModelo({ modelKey: "iphone15promax" })` | Cambia a iPhone 15 Pro Max |
| "Máxima capacidad" | `cambiarCapacidad({ capacityKey: "1024" })` | Cambia a 1 TB |
| "Qué tengo configurado?" | `getProductState()` | Muestra estado actual en JSON |

### Arquitectura: tools compartidas

Las funciones execute se definen una sola vez en el configurador y se reutilizan en dos contextos:

```
                    ┌─────────────────────────┐
                    │  toolDefs               │
                    │  (definidas una vez en   │
                    │   *-configurator.ts)     │
                    └─────────┬───────────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
                 ▼                         ▼
    ┌────────────────────┐   ┌────────────────────┐
    │ WebMCP              │   │ Chat (Prompt API)   │
    │ provideContext({    │   │ initChat({          │
    │   tools: [...]      │   │   tools: toolDefs   │
    │ })                  │   │ })                  │
    │                     │   │                     │
    │ El agente externo   │   │ Gemini Nano local   │
    │ (sidebar) las       │   │ las ejecuta via     │
    │ invoca              │   │ responseConstraint  │
    └────────────────────┘   └────────────────────┘
```

`initConfigurator()` devuelve `{ tools }` — el mismo objeto se pasa a `provideContext` (para WebMCP) y a `initChat` (para el chat local).

---

## TODO — Próximos pasos

- [x] **Tool de lectura (`getProductState`)** — Una tool que NO modifica la UI, solo devuelve el estado actual (modelo, color, capacidad, precio). Permite al agente "leer" la página antes de actuar.
- [x] **`registerTool` / `unregisterTool` dinámicos** — Añadir y quitar tools en tiempo real según el estado de la UI. Ej: si el usuario ya eligió un modelo, registrar una tool `confirmarCompra` que antes no existía.
- [x] **`clearContext()` en cleanup** — Limpiar contexto y tools al salir de la página (`pagehide`). Imprescindible en SPAs para evitar tools "fantasma".
- [x] **`provideContext()` con contexto actualizado** — Re-llamar a `provideContext()` tras cada cambio para que el agente siempre lea el estado actual, no el estado inicial.
- [x] **Segundo producto (MacBook)** — Nuevo configurador con su propio `macbook-configurator.ts`, demostrando que el patrón es reutilizable para cualquier producto.
- [x] **Tests con Playwright** — 34 tests: UI (clicks, precios, query params) + WebMCP mock (provideContext, registerTool, unregisterTool, execute tools) + integration tests (Chrome Canary). Ejecutar: `pnpm test` (chromium) o `pnpm test:canary` (Chrome Canary real).
- [x] **Chat con Gemini Nano** — Chat integrado en cada página de producto. Usa la Prompt API (`LanguageModel`) con `responseConstraint` para interpretar lenguaje natural y ejecutar tools. Módulo `chat.ts` framework-agnostic.
- [x] **Formulario declarativo para tools** — Documentado como nota al final del README (enfoque, limitaciones y por qué la imperativa es mejor). No implementado en código.

## Nota: enfoque declarativo vs imperativo para tools

Una idea recurrente es generar tools automáticamente desde atributos HTML, sin escribir JS:

```html
<button
  data-tool-name="cambiarColor"
  data-tool-description="Cambia el color del iPhone"
  data-tool-param-colorKey="string:natural,azul,blanco,negro"
>
```

Un script recorrería los `[data-tool-name]`, construiría el objeto tool y llamaría a `mcp.registerTool()`. Es decir, **la declarativa siempre acaba siendo imperativa por debajo**.

### El problema: `execute`

En la API imperativa, `execute` es un callback JS con lógica libre:

```js
execute: ({ colorKey }) => {
  const color = COLORS[colorKey];
  setProductColor(color.hex, color.name);
  return `Color cambiado a ${color.name}`;
}
```

En un atributo HTML no puedes definir esta lógica. Las opciones serían:

1. **CustomEvent genérico** — la tool dispara un evento en el elemento (`tool:cambiarColor`) y tú lo escuchas con JS. Sencillo, pero el return al agente sería siempre genérico.
2. **Referencia a función** — `data-tool-execute="setProductColor"` apunta a un registry global. Más potente, pero ya no es tan "declarativo".
3. **Solo tools simples** — la declarativa se limita a tools sin lógica (toggle, click). Para lógica real, usas la imperativa.

### Limitaciones

| | Imperativa | Declarativa |
|---|---|---|
| Lógica en `execute` | Libre (JS completo) | Limitada (evento o referencia) |
| Validación de params | En el callback | Genérica o ninguna |
| Return al agente | Personalizado | Genérico |
| Tools dinámicas | `registerTool`/`unregisterTool` | Requiere observer o re-scan |
| Conflicto si ambas | — | Si registran el mismo `name`, gana la última |

### Conclusión

La declarativa tiene valor pedagógico pero en la práctica la **imperativa es siempre más potente**. Las 3 opciones de execute usan `registerTool()` por debajo, que ya está cubierto en este tutorial. Por eso este enfoque queda documentado aquí como referencia, no como implementación.

## Referencias

- [Model Context Tool Inspector](https://github.com/beaufortfrancois/model-context-tool-inspector) — Extensión para probar tools
- [WebMCP en VentureBeat](https://venturebeat.com/infrastructure/google-chrome-ships-webmcp-in-early-preview-turning-every-website-into-a) — Artículo de lanzamiento
- [WebMCP explicado](https://demily-clement.com/en/posts/webmcp-make-your-site-agent-ready-in-chrome) — Tutorial complementario
