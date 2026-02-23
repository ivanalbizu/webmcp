// =====================================================================
// macbook-configurator.ts — Lógica WebMCP + estado del configurador
// =====================================================================
// Mismo patrón que iphone-configurator.ts pero con datos de MacBook.
// Independiente de Astro (o cualquier framework).
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
  plata:      { hex: '#E3E4E5', name: 'Plata' },
  grisEspac:  { hex: '#6E6E73', name: 'Gris Espacial' },
  medianoche: { hex: '#2E3642', name: 'Medianoche' },
  estelar:    { hex: '#F0E4D3', name: 'Estelar' },
};

export const MODELS: Record<string, { title: string; basePrice: number }> = {
  macbookAir13:  { title: 'MacBook Air 13"',  basePrice: 1299 },
  macbookAir15:  { title: 'MacBook Air 15"',  basePrice: 1499 },
  macbookPro14:  { title: 'MacBook Pro 14"',  basePrice: 1999 },
  macbookPro16:  { title: 'MacBook Pro 16"',  basePrice: 2499 },
};

export const CAPACITY_EXTRA: Record<string, { label: string; extra: number }> = {
  '256':  { label: '256 GB', extra: 0 },
  '512':  { label: '512 GB', extra: 230 },
  '1024': { label: '1 TB',   extra: 460 },
  '2048': { label: '2 TB',   extra: 690 },
};

// --- Inicialización ---

export interface ConfiguratorOptions {
  initialModel?: string;
}

export function initConfigurator(el: ConfiguratorElements, options?: ConfiguratorOptions): ConfiguratorResult {
  const initialModel = (options?.initialModel && MODELS[options.initialModel])
    ? options.initialModel
    : 'macbookPro14';
  let currentModel = initialModel;
  let currentCapacity = '512';
  let currentColorHex = '#6E6E73';
  let hasChanges = false;
  let isConfirmToolRegistered = false;

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
    const modelShort = MODELS[currentModel]?.title || 'MacBook Pro 14"';
    el.img.src = `https://placehold.co/500x320/${hex}/ffffff?text=${encodeURIComponent(modelShort)}`;
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

  // --- Tools dinámicas ---

  function markChanged() {
    updateContext();
    if (hasChanges) return;
    hasChanges = true;
    checkDynamicTools();
  }

  async function updateContext() {
    if (!mcp) return;
    try {
      const model = MODELS[currentModel];
      const cap = CAPACITY_EXTRA[currentCapacity];
      const colorName = el.colorLabel?.textContent || 'desconocido';
      const total = model.basePrice + cap.extra;

      await mcp.provideContext({
        name: 'MacBook Configurator',
        description: 'Configurador de MacBook. Permite cambiar modelo, color y capacidad.',
        context: `Modelos: macbookAir13 (1299€), macbookAir15 (1499€), macbookPro14 (1999€), macbookPro16 (2499€).
Colores: plata, grisEspac, medianoche, estelar.
Capacidades: 256, 512, 1024, 2048 (GB).
Estado actual: ${model.title}, ${colorName}, ${cap.label}, ${total.toLocaleString('es-ES')} €.`,
        tools: [],
      });
    } catch (err) {
      console.error('Error actualizando contexto:', err);
    }
  }

  async function checkDynamicTools() {
    if (!mcp || isConfirmToolRegistered) return;

    try {
      await mcp.registerTool({
        name: 'confirmarCompra',
        description: 'Confirma la compra con la configuración actual del MacBook.',
        parameters: { type: 'object', properties: {} },
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
    } catch (err) {
      console.error('Error registrando tool dinámica:', err);
    }
  }

  async function removeDynamicTool() {
    if (!mcp || !isConfirmToolRegistered) return;
    try {
      await mcp.unregisterTool('confirmarCompra');
      isConfirmToolRegistered = false;
      logToUI('➖ Tool dinámica eliminada: <strong>confirmarCompra</strong>');
    } catch (err) {
      console.error('Error eliminando tool dinámica:', err);
    }
  }

  // --- Event listeners ---

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

  // --- Aplicar modelo inicial ---
  if (initialModel !== 'macbookPro14') {
    setModel(initialModel);
    hasChanges = false;
  }

  // --- Tool definitions (reutilizadas por WebMCP y el chat) ---

  const toolDefs: Record<string, ToolDef> = {
    getProductState: {
      description: 'Devuelve el estado actual del configurador MacBook: modelo, color, capacidad y precio.',
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
      description: 'Cambia el color del MacBook. Valores: plata, grisEspac, medianoche, estelar.',
      schema: {
        type: 'object',
        properties: { colorKey: { type: 'string', enum: ['plata', 'grisEspac', 'medianoche', 'estelar'], description: 'Clave del color' } },
        required: ['colorKey'],
      },
      execute: ({ colorKey }: Record<string, any>) => {
        const color = COLORS[colorKey];
        if (!color) {
          logToUI(`❌ Color "${colorKey}" no reconocido`);
          return `Color "${colorKey}" no reconocido. Usa: plata, grisEspac, medianoche, estelar.`;
        }
        setProductColor(color.hex, color.name);
        const msg = `Color cambiado a ${color.name}`;
        logToUI(`🎨 ${msg}`);
        if (el.responseEl) el.responseEl.textContent = msg;
        return msg;
      },
    },
    cambiarModelo: {
      description: 'Cambia el modelo de MacBook. Valores: macbookAir13, macbookAir15, macbookPro14, macbookPro16.',
      schema: {
        type: 'object',
        properties: { modelKey: { type: 'string', enum: ['macbookAir13', 'macbookAir15', 'macbookPro14', 'macbookPro16'], description: 'Clave del modelo' } },
        required: ['modelKey'],
      },
      execute: ({ modelKey }: Record<string, any>) => {
        const msg = setModel(modelKey);
        logToUI(`💻 ${msg}`);
        if (el.responseEl) el.responseEl.textContent = msg;
        return msg;
      },
    },
    cambiarCapacidad: {
      description: 'Cambia la capacidad de almacenamiento del MacBook. Valores: 256, 512, 1024, 2048 (en GB).',
      schema: {
        type: 'object',
        properties: { capacityKey: { type: 'string', enum: ['256', '512', '1024', '2048'], description: 'Capacidad en GB' } },
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

  // --- WebMCP init ---

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
      await mcp.provideContext({
        name: 'MacBook Configurator',
        description: 'Configurador de MacBook. Permite cambiar modelo, color y capacidad.',
        context: `Modelos: macbookAir13 (1299€), macbookAir15 (1499€), macbookPro14 (1999€), macbookPro16 (2499€).
Colores: plata, grisEspac, medianoche, estelar.
Capacidades: 256, 512, 1024, 2048 (GB).
Estado actual: ${MODELS[currentModel].title}, ${el.colorLabel?.textContent}, ${CAPACITY_EXTRA[currentCapacity].label}.`,

        tools: Object.entries(toolDefs).map(([name, t]) => ({
          name,
          description: t.description,
          parameters: t.schema,
          execute: t.execute,
        }))
      });

      console.log('📋 Contexto + 4 tools registradas (MacBook)');
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

  window.addEventListener('pagehide', () => {
    if (!mcp) return;
    mcp.clearContext();
    console.log('🧹 clearContext() — contexto y tools eliminados (MacBook)');
  });

  return { tools: toolDefs };
}
