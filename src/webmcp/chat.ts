// =====================================================================
// chat.ts — Chat con Gemini Nano (Prompt API) para ejecutar tools
// =====================================================================
// Módulo framework-agnostic. Usa la Prompt API del navegador
// (LanguageModel) para interpretar lenguaje natural y ejecutar
// los tools del configurador de producto.
// =====================================================================

// --- Tipos de la Prompt API (experimental, no tipada en TS) ---

declare class LanguageModel {
  static availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  static create(options?: {
    initialPrompts?: Array<{ role: string; content: string }>;
  }): Promise<LanguageModelSession>;
}

interface LanguageModelSession {
  prompt(text: string, options?: { responseConstraint?: object }): Promise<string>;
  destroy(): void;
}

// --- Tipos del chat ---

export interface ChatElements {
  messages: HTMLElement;
  input: HTMLInputElement;
  sendBtn: HTMLButtonElement;
  status: HTMLElement;
}

export interface ToolDef {
  description: string;
  schema: object;
  execute: (args: Record<string, any>) => string;
}

export interface ChatOptions {
  productName: string;
  tools: Record<string, ToolDef>;
}

// --- Inicialización ---

export async function initChat(el: ChatElements, options: ChatOptions) {
  let session: LanguageModelSession | null = null;

  // --- Verificar disponibilidad ---

  async function checkAvailability(): Promise<boolean> {
    try {
      if (typeof LanguageModel === 'undefined') {
        el.status.textContent = 'Prompt API no disponible. Usa Chrome Canary con los flags activados.';
        el.input.disabled = true;
        el.sendBtn.disabled = true;
        return false;
      }

      const availability = await LanguageModel.availability();

      if (availability === 'available') {
        el.status.textContent = 'Chat listo';
        return true;
      }

      if (availability === 'downloadable' || availability === 'downloading') {
        el.status.textContent = `Gemini Nano: ${availability}. Espera a que se descargue (~1.7 GB).`;
        el.input.disabled = true;
        el.sendBtn.disabled = true;
        return false;
      }

      el.status.textContent = 'Gemini Nano no disponible en este navegador.';
      el.input.disabled = true;
      el.sendBtn.disabled = true;
      return false;
    } catch {
      el.status.textContent = 'Error comprobando Prompt API.';
      el.input.disabled = true;
      el.sendBtn.disabled = true;
      return false;
    }
  }

  // --- Crear sesión con system prompt ---

  function buildSystemPrompt(): string {
    const toolLines = Object.entries(options.tools)
      .map(([name, t]) => {
        const schema = t.schema as any;
        const props = schema?.properties || {};
        const params = Object.entries(props)
          .map(([k, v]: [string, any]) =>
            `${k}: ${v.enum ? '"' + v.enum.join('", "') + '"' : v.type}`
          )
          .join('; ');
        return `- ${name}(${params || 'sin parametros'}): ${t.description}`;
      })
      .join('\n');

    return `Eres un asistente de configuracion de ${options.productName}.
Tu trabajo es interpretar lo que el usuario quiere y decidir que tool ejecutar.

Tools disponibles:
${toolLines}

REGLAS:
- Responde SOLO con JSON valido.
- Si no puedes hacer lo que pide el usuario, responde con {"tool": "none", "message": "explicacion"}.
- Si el usuario pide ver el estado, usa getProductState.
- Interpreta lenguaje natural: "ponlo en azul" -> cambiarColor. "el mas grande" -> cambiarModelo con el mayor.`;
  }

  async function createSession(): Promise<boolean> {
    try {
      session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: buildSystemPrompt() }],
      });
      return true;
    } catch (err) {
      el.status.textContent = `Error creando sesion: ${err instanceof Error ? err.message : 'desconocido'}`;
      return false;
    }
  }

  // --- UI helpers ---

  function appendMessage(role: 'user' | 'assistant', text: string) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-${role}`;
    div.textContent = text;
    el.messages.appendChild(div);
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  // --- responseConstraint schema ---

  const toolNames = Object.keys(options.tools);

  const responseSchema = {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: [...toolNames, 'none'] },
      args: { type: 'object' },
      message: { type: 'string' },
    },
    required: ['tool'],
  };

  // --- Enviar mensaje ---

  async function handleSend() {
    const text = el.input.value.trim();
    if (!text) return;

    appendMessage('user', text);
    el.input.value = '';
    el.sendBtn.disabled = true;
    el.status.textContent = 'Pensando...';

    // Recrear sesión si no existe
    if (!session) {
      const ok = await createSession();
      if (!ok) {
        el.sendBtn.disabled = false;
        return;
      }
    }

    try {
      const raw = await session!.prompt(text, {
        responseConstraint: responseSchema,
      });

      let parsed: { tool: string; args?: Record<string, any>; message?: string };
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Gemini Nano a veces devuelve texto mal formado
        appendMessage('assistant', `Respuesta inesperada: ${raw}`);
        el.sendBtn.disabled = false;
        el.status.textContent = 'Chat listo';
        return;
      }

      if (parsed.tool === 'none') {
        appendMessage('assistant', parsed.message || 'No puedo hacer eso con las herramientas disponibles.');
        el.sendBtn.disabled = false;
        el.status.textContent = 'Chat listo';
        return;
      }

      // Ejecutar tool
      const toolDef = options.tools[parsed.tool];
      if (!toolDef) {
        appendMessage('assistant', `Tool "${parsed.tool}" no encontrada.`);
        el.sendBtn.disabled = false;
        el.status.textContent = 'Chat listo';
        return;
      }

      const result = toolDef.execute(parsed.args || {});
      appendMessage('assistant', `${parsed.tool}: ${result}`);
      el.status.textContent = 'Chat listo';

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'desconocido';
      // Si la sesión se agota, recrear
      if (msg.includes('context') || msg.includes('token') || msg.includes('limit')) {
        session?.destroy();
        session = null;
        appendMessage('assistant', 'Sesion agotada. Enviando de nuevo...');
        el.sendBtn.disabled = false;
        el.status.textContent = 'Chat listo';
        return;
      }
      appendMessage('assistant', `Error: ${msg}`);
      el.status.textContent = 'Chat listo';
    }

    el.sendBtn.disabled = false;
  }

  // --- Event listeners ---

  el.sendBtn.addEventListener('click', handleSend);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // --- Init ---

  const available = await checkAvailability();
  if (available) {
    await createSession();
  }
}
