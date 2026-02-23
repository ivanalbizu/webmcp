// =====================================================================
// iphone-configurator.ts — Lógica WebMCP + estado del configurador
// =====================================================================
// Este archivo es independiente de Astro (o cualquier framework).
// Solo necesita recibir referencias a los elementos del DOM.
// =====================================================================

// --- Tipos ---

export interface ConfiguratorElements {
  status: HTMLElement | null;
  img: HTMLImageElement | null;
  modelTitle: HTMLElement | null;
  priceDisplay: HTMLElement | null;
  colorLabel: HTMLElement | null;
  capacityLabel: HTMLElement | null;
  responseEl: HTMLElement | null;
  toolLog: HTMLElement | null;
  orderConfirmation: HTMLElement | null;
  orderSummary: HTMLElement | null;
}

export interface ToolDef {
  description: string;
  schema: object;
  execute: (args: Record<string, any>) => string;
}

export interface ConfiguratorResult {
  tools: Record<string, ToolDef>;
}

// --- Datos del catálogo ---

export const COLORS: Record<string, { hex: string; name: string }> = {
  natural: { hex: '#5C5B57', name: 'Titanio Natural' },
  azul:    { hex: '#2F333A', name: 'Titanio Azul' },
  blanco:  { hex: '#F2F1EB', name: 'Titanio Blanco' },
  negro:   { hex: '#181819', name: 'Titanio Negro' },
};

export const MODELS: Record<string, { title: string; basePrice: number }> = {
  iphone15:       { title: 'iPhone 15',         basePrice: 959 },
  iphone15pro:    { title: 'iPhone 15 Pro',      basePrice: 1219 },
  iphone15promax: { title: 'iPhone 15 Pro Max',  basePrice: 1469 },
};

export const CAPACITY_EXTRA: Record<string, { label: string; extra: number }> = {
  '128':  { label: '128 GB', extra: 0 },
  '256':  { label: '256 GB', extra: 120 },
  '512':  { label: '512 GB', extra: 350 },
  '1024': { label: '1 TB',   extra: 580 },
};

// --- Inicialización ---

export interface ConfiguratorOptions {
  initialModel?: string;
}

export function initConfigurator(el: ConfiguratorElements, options?: ConfiguratorOptions): ConfiguratorResult {
  // --- Estado actual ---
  // Si se pasa un modelo inicial (ej. desde query param), se usa ese.
  const initialModel = (options?.initialModel && MODELS[options.initialModel])
    ? options.initialModel
    : 'iphone15pro';
  let currentModel = initialModel;
  let currentCapacity = '256';
  let currentColorHex = '#5C5B57';
  let hasChanges = false;
  let isConfirmToolRegistered = false;

  // navigator.modelContext es el punto de entrada de la API WebMCP.
  // No está tipado en TypeScript (es experimental), por eso usamos `as any`.
  const mcp = (navigator as any).modelContext;

  // --- Utilidades ---

  function logToUI(message: string) {
    if (!el.toolLog) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">${time}</span>${message}`;
    el.toolLog.prepend(entry);
  }

  function updatePrice() {
    const model = MODELS[currentModel];
    const cap = CAPACITY_EXTRA[currentCapacity];
    if (model && cap && el.priceDisplay) {
      const total = model.basePrice + cap.extra;
      el.priceDisplay.textContent = `Desde ${total.toLocaleString('es-ES')} €`;
    }
  }

  function updateImage() {
    if (!el.img) return;
    const hex = currentColorHex.replace('#', '');
    const modelShort = MODELS[currentModel]?.title.replace('iPhone ', '') || '15 Pro';
    el.img.src = `https://placehold.co/300x600/${hex}/ffffff?text=${encodeURIComponent(modelShort)}`;
  }

  // --- Acciones (compartidas entre UI y WebMCP tools) ---

  function setProductColor(hex: string, name: string) {
    currentColorHex = hex;
    if (el.colorLabel) el.colorLabel.textContent = name;
    document.querySelector('.color-btn.selected')?.classList.remove('selected');
    const btn = document.querySelector(`.color-btn[data-hex="${hex}"]`);
    if (btn) btn.classList.add('selected');
    updateImage();
    markChanged();
  }

  function setModel(modelKey: string): string {
    const model = MODELS[modelKey];
    if (!model) return `Modelo "${modelKey}" no reconocido.`;
    currentModel = modelKey;
    if (el.modelTitle) el.modelTitle.textContent = model.title;
    document.querySelector('.model-btn.selected')?.classList.remove('selected');
    const btn = document.querySelector(`.model-btn[data-model="${modelKey}"]`);
    if (btn) btn.classList.add('selected');
    updatePrice();
    updateImage();
    markChanged();
    return `Modelo cambiado a ${model.title}`;
  }

  function setCapacity(capacityKey: string): string {
    const cap = CAPACITY_EXTRA[capacityKey];
    if (!cap) return `Capacidad "${capacityKey}" no reconocida.`;
    currentCapacity = capacityKey;
    if (el.capacityLabel) el.capacityLabel.textContent = cap.label;
    document.querySelector('.capacity-btn.selected')?.classList.remove('selected');
    const btn = document.querySelector(`.capacity-btn[data-capacity="${capacityKey}"]`);
    if (btn) btn.classList.add('selected');
    updatePrice();
    markChanged();
    return `Capacidad cambiada a ${cap.label}`;
  }

  // ---------------------------------------------------------------
  // Tools dinámicas con registerTool() / unregisterTool()
  // ---------------------------------------------------------------
  // Cuando el usuario (o el agente) modifica la configuración,
  // registramos dinámicamente una tool "confirmarCompra" que antes
  // NO existía. Si se confirma la compra, la desregistramos.
  //
  // Esto demuestra cómo las tools disponibles pueden cambiar
  // en tiempo real según el estado de la página.
  // ---------------------------------------------------------------

  function markChanged() {
    // Actualizar el contexto que lee el agente (sin tocar las tools).
    updateContext();

    if (hasChanges) return;
    hasChanges = true;
    checkDynamicTools();
  }

  // ---------------------------------------------------------------
  // Actualizar contexto tras cada cambio
  // ---------------------------------------------------------------
  // El `context` que se pasa en provideContext() es texto estático:
  // se registra una vez y el agente lo lee tal cual. Si el usuario
  // cambia el modelo de "Pro" a "Pro Max", el agente seguiría leyendo
  // "Estado actual: iPhone 15 Pro" — información desactualizada.
  //
  // Para mantenerlo sincronizado, re-llamamos a provideContext()
  // con el estado actualizado. Esto SOBREESCRIBE el contexto anterior
  // pero MANTIENE las tools ya registradas con registerTool().
  //
  // Nota: provideContext() requiere el array `tools`. Al re-llamar
  // pasamos las mismas tools iniciales (las tools dinámicas como
  // confirmarCompra se gestionan aparte con registerTool/unregisterTool).
  // ---------------------------------------------------------------
  async function updateContext() {
    if (!mcp) return;
    try {
      const model = MODELS[currentModel];
      const cap = CAPACITY_EXTRA[currentCapacity];
      const colorName = el.colorLabel?.textContent || 'desconocido';
      const total = model.basePrice + cap.extra;

      await mcp.provideContext({
        name: 'iPhone Configurator',
        description: 'Configurador interactivo de iPhone. USA SOLO las tools listadas para cambiar color, modelo o capacidad.',
        context: `TOOLS DISPONIBLES: cambiarColor, cambiarModelo, cambiarCapacidad, getProductState.
Para cambiar el color, usa "cambiarColor" con colorKey: natural, azul, blanco o negro.
Para cambiar el modelo, usa "cambiarModelo" con modelKey: iphone15, iphone15pro o iphone15promax.
Para cambiar la capacidad, usa "cambiarCapacidad" con capacityKey: 128, 256, 512 o 1024.
Estado actual: ${model.title}, ${colorName}, ${cap.label}, ${total.toLocaleString('es-ES')} €.`,
        tools: [],
      });
      console.log('🔄 Contexto actualizado:', model.title, colorName, cap.label);
    } catch (err) {
      console.error('Error actualizando contexto:', err);
    }
  }

  async function checkDynamicTools() {
    if (!mcp) return;

    if (hasChanges && !isConfirmToolRegistered) {
      // --- registerTool() ---
      // Añade UNA tool sin tocar las demás ya registradas.
      try {
        await mcp.registerTool({
          name: 'confirmarCompra',
          description: 'Confirma la compra con la configuración actual. Solo disponible si el usuario ha hecho al menos un cambio.',
          parameters: {
            type: 'object',
            properties: {},
          },
          execute: () => {
            const model = MODELS[currentModel];
            const cap = CAPACITY_EXTRA[currentCapacity];
            const colorName = el.colorLabel?.textContent || 'desconocido';
            const total = model.basePrice + cap.extra;

            const summary = `${model.title} — ${colorName} — ${cap.label} — ${total.toLocaleString('es-ES')} €`;

            if (el.orderConfirmation) el.orderConfirmation.style.display = 'block';
            if (el.orderSummary) el.orderSummary.textContent = `Pedido confirmado: ${summary}`;

            logToUI(`🛒 Compra confirmada: ${summary}`);
            if (el.responseEl) el.responseEl.textContent = `Compra confirmada: ${summary}`;

            hasChanges = false;
            removeDynamicTool();

            return `Compra confirmada: ${summary}`;
          }
        });

        isConfirmToolRegistered = true;
        logToUI('➕ Tool dinámica registrada: <strong>confirmarCompra</strong>');
        console.log('➕ registerTool("confirmarCompra") — tool dinámica añadida');
      } catch (err) {
        console.error('Error registrando tool dinámica:', err);
      }
    }
  }

  async function removeDynamicTool() {
    if (!mcp || !isConfirmToolRegistered) return;

    try {
      // --- unregisterTool() ---
      // Elimina una tool por nombre. El agente ya no la verá disponible.
      await mcp.unregisterTool('confirmarCompra');
      isConfirmToolRegistered = false;
      logToUI('➖ Tool dinámica eliminada: <strong>confirmarCompra</strong>');
      console.log('➖ unregisterTool("confirmarCompra") — tool dinámica eliminada');
    } catch (err) {
      console.error('Error eliminando tool dinámica:', err);
    }
  }

  // --- Event listeners de botones ---

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = btn as HTMLButtonElement;
      if (b.dataset.hex && b.dataset.name) setProductColor(b.dataset.hex, b.dataset.name);
    });
  });

  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const model = (btn as HTMLButtonElement).dataset.model;
      if (model) setModel(model);
    });
  });

  document.querySelectorAll('.capacity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cap = (btn as HTMLButtonElement).dataset.capacity;
      if (cap) setCapacity(cap);
    });
  });

  // --- Aplicar modelo inicial (si viene de query param o configuración) ---
  if (initialModel !== 'iphone15pro') {
    // setModel actualiza título, botón selected, precio e imagen.
    // No llamamos markChanged() extra porque setModel ya lo hace,
    // pero como es la carga inicial, reseteamos hasChanges.
    setModel(initialModel);
    hasChanges = false;
  }

  // =====================================================================
  // WebMCP (Web Model Context Protocol) — API experimental de Chrome
  // =====================================================================
  //
  // ¿Qué es WebMCP?
  // Es una API del navegador que permite a las páginas web exponer
  // "herramientas" (tools) y contexto a agentes IA externos (ej. Gemini
  // en Chrome). La página NO llama al modelo; el modelo llama a la página.
  //
  // Flujo:
  //   1. La página registra contexto + tools via navigator.modelContext
  //   2. Un agente IA (Gemini sidebar, extensión, etc.) lee ese contexto
  //   3. El usuario habla con el agente: "pon el iPhone en azul"
  //   4. El agente decide invocar la tool "cambiarColor" con {colorKey:"azul"}
  //   5. El navegador ejecuta el callback `execute` definido aquí
  //
  // API disponible en navigator.modelContext:
  //   - provideContext(params)   → Registra contexto + tools de una vez
  //   - registerTool(tool)       → Añade una tool individual
  //   - unregisterTool(name)     → Elimina una tool por nombre
  //   - clearContext()           → Limpia todo el contexto y tools
  //
  // Requisitos:
  //   - Chrome Canary 146+
  //   - Flag: chrome://flags/#web-mcp-for-testing → Enabled
  //   - Para probar tools: extensión "Model Context Tool Inspector"
  // =====================================================================

  // --- Tool definitions (reutilizadas por WebMCP y el chat) ---

  const toolDefs: Record<string, ToolDef> = {
    getProductState: {
      description: 'Devuelve el estado actual (modelo, color, capacidad, precio) en JSON. No modifica nada.',
      schema: { type: 'object', properties: {} },
      execute: () => {
        const model = MODELS[currentModel];
        const cap = CAPACITY_EXTRA[currentCapacity];
        const colorName = el.colorLabel?.textContent || 'desconocido';
        const total = model.basePrice + cap.extra;
        const state = {
          modelo: model.title, modelKey: currentModel,
          color: colorName, colorHex: currentColorHex,
          capacidad: cap.label, capacityKey: currentCapacity,
          precio: `${total.toLocaleString('es-ES')} €`,
        };
        const msg = `Estado actual: ${model.title}, ${colorName}, ${cap.label}, ${total.toLocaleString('es-ES')} €`;
        logToUI(`🔍 ${msg}`);
        if (el.responseEl) el.responseEl.textContent = msg;
        return JSON.stringify(state, null, 2);
      },
    },
    cambiarColor: {
      description: 'Cambia el color del iPhone. Si el usuario dice "blanco", usa colorKey "blanco". Valores: natural, azul, blanco, negro.',
      schema: {
        type: 'object',
        properties: { colorKey: { type: 'string', enum: ['natural', 'azul', 'blanco', 'negro'], description: 'Clave del color' } },
        required: ['colorKey'],
      },
      execute: ({ colorKey }: Record<string, any>) => {
        const color = COLORS[colorKey];
        if (!color) {
          logToUI(`❌ Color "${colorKey}" no reconocido`);
          return `Color "${colorKey}" no reconocido. Usa: natural, azul, blanco, negro.`;
        }
        setProductColor(color.hex, color.name);
        const msg = `Color cambiado a ${color.name}`;
        logToUI(`🎨 ${msg}`);
        if (el.responseEl) el.responseEl.textContent = msg;
        return msg;
      },
    },
    cambiarModelo: {
      description: 'Cambia el modelo de iPhone. Valores: iphone15, iphone15pro, iphone15promax.',
      schema: {
        type: 'object',
        properties: { modelKey: { type: 'string', enum: ['iphone15', 'iphone15pro', 'iphone15promax'], description: 'Clave del modelo' } },
        required: ['modelKey'],
      },
      execute: ({ modelKey }: Record<string, any>) => {
        const msg = setModel(modelKey);
        logToUI(`📱 ${msg}`);
        if (el.responseEl) el.responseEl.textContent = msg;
        return msg;
      },
    },
    cambiarCapacidad: {
      description: 'Cambia la capacidad de almacenamiento. Valores: 128, 256, 512, 1024 (en GB).',
      schema: {
        type: 'object',
        properties: { capacityKey: { type: 'string', enum: ['128', '256', '512', '1024'], description: 'Capacidad en GB' } },
        required: ['capacityKey'],
      },
      execute: ({ capacityKey }: Record<string, any>) => {
        const msg = setCapacity(capacityKey);
        logToUI(`💾 ${msg}`);
        if (el.responseEl) el.responseEl.textContent = msg;
        return msg;
      },
    },
  };

  async function initWebMCP() {
    if (!mcp) {
      if (el.status) {
        el.status.textContent = '❌ navigator.modelContext no detectado';
        el.status.style.color = 'red';
      }
      return;
    }

    if (el.status) {
      el.status.textContent = '✅ navigator.modelContext disponible — registrando tools...';
      el.status.style.color = 'green';
    }

    try {
      // ---------------------------------------------------------------
      // provideContext() — Método principal de la API WebMCP
      // ---------------------------------------------------------------
      // Registra en una sola llamada:
      //   - name: identificador legible del contexto de esta página
      //   - description: descripción corta para que el agente entienda
      //     de qué va esta página
      //   - context: texto libre con información detallada que el agente
      //     puede leer para tomar decisiones (catálogo, estado, etc.)
      //   - tools: array de herramientas que el agente puede invocar
      //
      // Nota: tools es OBLIGATORIO en provideContext(). Si solo quieres
      // dar contexto sin tools, pasa un array vacío: tools: []
      // Para añadir tools individuales después, usa registerTool().
      // ---------------------------------------------------------------
      await mcp.provideContext({
        name: 'iPhone Configurator',
        description: 'Configurador interactivo de iPhone. USA SOLO las tools listadas abajo para cambiar color, modelo o capacidad. No inventes tools que no existen.',

        context: `TOOLS DISPONIBLES: cambiarColor, cambiarModelo, cambiarCapacidad, getProductState.
Para cambiar el color, usa la tool "cambiarColor" con colorKey: natural, azul, blanco o negro.
Para cambiar el modelo, usa la tool "cambiarModelo" con modelKey: iphone15, iphone15pro o iphone15promax.
Para cambiar la capacidad, usa la tool "cambiarCapacidad" con capacityKey: 128, 256, 512 o 1024.
Para consultar el estado actual, usa la tool "getProductState" sin parámetros.
Modelos: iphone15 (959€), iphone15pro (1219€), iphone15promax (1469€).
Colores disponibles: natural (Titanio Natural), azul (Titanio Azul), blanco (Titanio Blanco), negro (Titanio Negro).
Capacidades: 128 GB, 256 GB, 512 GB, 1 TB (1024).
Estado actual: ${MODELS[currentModel].title}, ${el.colorLabel?.textContent}, ${CAPACITY_EXTRA[currentCapacity].label}.`,

        // tools: reutiliza las definiciones de toolDefs
        tools: Object.entries(toolDefs).map(([name, t]) => ({
          name,
          description: t.description,
          parameters: t.schema,
          execute: t.execute,
        }))
      });

      console.log('📋 Contexto + 4 tools registradas');
      logToUI('📋 Tools registradas: <strong>getProductState</strong>, <strong>cambiarColor</strong>, <strong>cambiarModelo</strong>, <strong>cambiarCapacidad</strong>');

      if (el.status) {
        el.status.textContent = '✅ WebMCP listo — 4 tools registradas';
      }

    } catch (err) {
      console.error('Error registrando WebMCP:', err);
      logToUI(`❌ Error: ${err instanceof Error ? err.message : 'desconocido'}`);
      if (el.status) {
        el.status.textContent = `⚠️ Error: ${err instanceof Error ? err.message : 'desconocido'}`;
        el.status.style.color = 'orange';
      }
    }
  }

  initWebMCP();

  // ---------------------------------------------------------------
  // clearContext() — Cleanup al salir de la página
  // ---------------------------------------------------------------
  // Cuando el usuario navega fuera (ej. vuelve al catálogo), limpiamos
  // todo el contexto y tools registradas. Esto evita que el agente
  // siga viendo tools de una página que ya no está activa.
  //
  // En una MPA (como Astro por defecto), el navegador destruye el JS
  // al navegar, así que clearContext() es redundante. Pero en una SPA
  // (React, Vue, etc.) es imprescindible para evitar tools "fantasma".
  //
  // Usamos el evento `pagehide` en vez de `beforeunload` porque:
  //   - `pagehide` se dispara siempre al salir (incluso en bfcache)
  //   - `beforeunload` puede no dispararse en móviles
  // ---------------------------------------------------------------
  window.addEventListener('pagehide', () => {
    if (!mcp) return;
    mcp.clearContext();
    console.log('🧹 clearContext() — contexto y tools eliminados');
  });

  return { tools: toolDefs };
}
