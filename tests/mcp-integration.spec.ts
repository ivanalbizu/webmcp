import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Declaración de la Prompt API (experimental, no tipada en TS)
declare const LanguageModel: {
  availability(): Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create(options?: { initialPrompts?: Array<{ role: string; content: string }> }): Promise<{
    prompt(text: string, options?: { responseConstraint?: object }): Promise<string>;
    destroy(): void;
  }>;
};

// Estos tests usan Chrome Canary REAL con navigator.modelContext + Prompt API.
// Ejecutar: pnpm test:canary
//
// Usa un perfil temporal limpio + flags por CLI.
// No requiere cerrar Chrome Canary ni copiar perfiles.
//
// NOTA: Gemini Nano debe estar descargado (~1.7 GB).
// Se descarga automáticamente la primera vez con los flags activos.

const CANARY_PATH = process.env.CANARY_PATH || '/usr/bin/google-chrome-canary';
const BASE_URL = 'http://localhost:4321';

// Init script que intercepta provideContext para capturar tools
const CAPTURE_TOOLS_SCRIPT = `
  window.__capturedTools = new Map();

  // Observar navigator.modelContext (puede no existir al inicio)
  const origDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'modelContext')
    || Object.getOwnPropertyDescriptor(navigator, 'modelContext');

  function interceptProvideContext(mcp) {
    if (!mcp || mcp.__intercepted) return;
    const orig = mcp.provideContext.bind(mcp);
    mcp.provideContext = function(params) {
      if (params.tools) {
        params.tools.forEach(t => window.__capturedTools.set(t.name, t));
      }
      return orig(params);
    };
    mcp.__intercepted = true;
  }

  // Si ya existe, interceptar de inmediato
  if ('modelContext' in navigator && navigator.modelContext) {
    interceptProvideContext(navigator.modelContext);
  }

  // Si se define después, interceptar cuando aparezca
  if (origDesc) {
    Object.defineProperty(navigator, 'modelContext', {
      get() {
        const val = origDesc.get ? origDesc.get.call(this) : origDesc.value;
        interceptProvideContext(val);
        return val;
      },
      configurable: true,
    });
  }
`;

// Custom test fixture que usa launchPersistentContext con perfil temporal
const test = base.extend<{ canaryPage: Page }>({
  canaryPage: async ({}, use, testInfo) => {
    testInfo.setTimeout(120_000);

    const tmpProfile = mkdtempSync(join(tmpdir(), 'canary-test-'));

    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(tmpProfile, {
        executablePath: CANARY_PATH,
        headless: false,
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-popup-blocking',
          '--enable-experimental-web-platform-features',
        ],
      });
    } catch (error) {
      rmSync(tmpProfile, { recursive: true, force: true });
      throw new Error(
        `No se pudo abrir Chrome Canary.\nOriginal: ${error}`
      );
    }

    // Inyectar script para capturar tools ANTES de que cargue la página
    await context.addInitScript(CAPTURE_TOOLS_SCRIPT);

    const page = await context.newPage();
    await use(page);
    await page.close();
    await context.close();
    rmSync(tmpProfile, { recursive: true, force: true });
  },
});

// ─── WebMCP: verificación de API ───────────────────────────────────

test.describe('WebMCP real - iPhone', () => {

  test('navigator.modelContext existe', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/iphone`);

    const hasModelContext = await page.evaluate(() =>
      'modelContext' in navigator
    );
    expect(hasModelContext).toBe(true);
  });

  test('provideContext registra sin error', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/iphone`);

    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo', {
      timeout: 5000,
    });
  });

  test('tools se registran y el log lo refleja', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/iphone`);

    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo', {
      timeout: 5000,
    });

    const logText = await page.locator('#tool-log').textContent();
    expect(logText).toContain('cambiarColor');
    expect(logText).toContain('cambiarModelo');
    expect(logText).toContain('cambiarCapacidad');
    expect(logText).toContain('getProductState');
  });
});

test.describe('WebMCP real - MacBook', () => {

  test('navigator.modelContext existe', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/macbook`);

    const hasModelContext = await page.evaluate(() =>
      'modelContext' in navigator
    );
    expect(hasModelContext).toBe(true);
  });

  test('provideContext registra sin error', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/macbook`);

    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo', {
      timeout: 5000,
    });
  });
});

// ─── Prompt API → WebMCP tools (E2E con Gemini Nano) ──────────────

test.describe('Prompt API → tool execution', () => {

  test.beforeEach(async ({ canaryPage: page }) => {
    // Verificar que Prompt API está disponible
    const available = await page.evaluate(async () => {
      // API más reciente: LanguageModel global
      if (typeof LanguageModel !== 'undefined') {
        const avail = await LanguageModel.availability();
        return avail;
      }
      // API legacy: window.ai.languageModel
      if ((window as any).ai?.languageModel) {
        const caps = await (window as any).ai.languageModel.capabilities();
        return caps.available;
      }
      return 'unavailable';
    });

    test.skip(
      available === 'unavailable',
      'Prompt API no disponible. Activa los flags de Gemini Nano en chrome://flags'
    );
    test.skip(
      available === 'downloadable' || available === 'downloading',
      `Gemini Nano se está descargando (${available}). Espera a que termine e intenta de nuevo.`
    );
  });

  test('prompt natural → cambiarColor (traje de gala oscuro → negro)', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/iphone`);
    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo', { timeout: 5000 });

    // 1. Gemini Nano interpreta el prompt y devuelve un tool call
    const toolCall = await page.evaluate(async () => {
      const systemPrompt = `Eres un asistente de configuración de iPhone. Decides qué tool ejecutar según lo que pide el usuario.

Tools disponibles:
- cambiarColor(colorKey): Cambia el color. Valores: "natural", "azul", "blanco", "negro"
- cambiarModelo(modelKey): Cambia el modelo. Valores: "15pro", "15promax", "16pro", "16promax"
- cambiarCapacidad(capacityKey): Cambia la capacidad. Valores: "256", "512", "1024"

Responde SOLO con JSON indicando qué tool usar y con qué argumentos.`;

      const responseSchema = {
        type: 'object' as const,
        properties: {
          tool: { type: 'string' as const, enum: ['cambiarColor', 'cambiarModelo', 'cambiarCapacidad'] },
          args: { type: 'object' as const },
        },
        required: ['tool', 'args'],
      };

      let session;
      // Intentar API moderna primero, luego legacy
      if (typeof LanguageModel !== 'undefined') {
        session = await LanguageModel.create({
          initialPrompts: [{ role: 'system', content: systemPrompt }],
        });
      } else {
        session = await (window as any).ai.languageModel.create({
          systemPrompt,
        });
      }

      const response = await session.prompt(
        'El usuario quiere un iPhone que combine con un traje de gala oscuro. Aplica el color adecuado.',
        { responseConstraint: responseSchema }
      );

      session.destroy();
      return JSON.parse(response);
    });

    expect(toolCall.tool).toBe('cambiarColor');
    expect(toolCall.args.colorKey).toBe('negro');

    // 2. Ejecutar el tool capturado
    const result = await page.evaluate(async (tc) => {
      const tool = (window as any).__capturedTools.get(tc.tool);
      if (!tool) throw new Error(`Tool "${tc.tool}" no capturada`);
      return tool.execute(tc.args);
    }, toolCall);

    expect(result).toContain('negro');

    // 3. Verificar que la UI cambió
    const colorLabel = await page.locator('#color-label').textContent();
    expect(colorLabel).toContain('Negro');
  });

  test('prompt natural → cambiarModelo (quiero el más grande)', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/iphone`);
    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo', { timeout: 5000 });

    const toolCall = await page.evaluate(async () => {
      const systemPrompt = `Eres un asistente de configuración de iPhone. Decides qué tool ejecutar.

Tools disponibles:
- cambiarColor(colorKey): Cambia el color. Valores: "natural", "azul", "blanco", "negro"
- cambiarModelo(modelKey): Cambia el modelo. Valores posibles y sus tamaños:
  "15pro" (6.1"), "15promax" (6.7"), "16pro" (6.3"), "16promax" (6.9")
- cambiarCapacidad(capacityKey): Cambia la capacidad. Valores: "256", "512", "1024"

Responde SOLO con JSON.`;

      const responseSchema = {
        type: 'object' as const,
        properties: {
          tool: { type: 'string' as const, enum: ['cambiarColor', 'cambiarModelo', 'cambiarCapacidad'] },
          args: { type: 'object' as const },
        },
        required: ['tool', 'args'],
      };

      let session;
      if (typeof LanguageModel !== 'undefined') {
        session = await LanguageModel.create({
          initialPrompts: [{ role: 'system', content: systemPrompt }],
        });
      } else {
        session = await (window as any).ai.languageModel.create({
          systemPrompt,
        });
      }

      const response = await session.prompt(
        'Quiero el iPhone más grande que tengáis.',
        { responseConstraint: responseSchema }
      );

      session.destroy();
      return JSON.parse(response);
    });

    expect(toolCall.tool).toBe('cambiarModelo');
    expect(toolCall.args.modelKey).toBe('16promax');

    const result = await page.evaluate(async (tc) => {
      const tool = (window as any).__capturedTools.get(tc.tool);
      if (!tool) throw new Error(`Tool "${tc.tool}" no capturada`);
      return tool.execute(tc.args);
    }, toolCall);

    expect(result).toContain('16 Pro Max');

    const modelTitle = await page.locator('#model-title').textContent();
    expect(modelTitle).toContain('16 Pro Max');
  });

  test('prompt natural → cambiarCapacidad (muchas fotos y vídeos)', async ({ canaryPage: page }) => {
    await page.goto(`${BASE_URL}/iphone`);
    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo', { timeout: 5000 });

    const toolCall = await page.evaluate(async () => {
      const systemPrompt = `Eres un asistente de configuración de iPhone. Decides qué tool ejecutar.

Tools disponibles:
- cambiarColor(colorKey): Cambia el color. Valores: "natural", "azul", "blanco", "negro"
- cambiarModelo(modelKey): Cambia el modelo. Valores: "15pro", "15promax", "16pro", "16promax"
- cambiarCapacidad(capacityKey): Cambia la capacidad. Valores: "256" (256GB), "512" (512GB), "1024" (1TB)

Responde SOLO con JSON.`;

      const responseSchema = {
        type: 'object' as const,
        properties: {
          tool: { type: 'string' as const, enum: ['cambiarColor', 'cambiarModelo', 'cambiarCapacidad'] },
          args: { type: 'object' as const },
        },
        required: ['tool', 'args'],
      };

      let session;
      if (typeof LanguageModel !== 'undefined') {
        session = await LanguageModel.create({
          initialPrompts: [{ role: 'system', content: systemPrompt }],
        });
      } else {
        session = await (window as any).ai.languageModel.create({
          systemPrompt,
        });
      }

      const response = await session.prompt(
        'Hago muchas fotos y grabo vídeos en 4K. Necesito la máxima capacidad posible.',
        { responseConstraint: responseSchema }
      );

      session.destroy();
      return JSON.parse(response);
    });

    expect(toolCall.tool).toBe('cambiarCapacidad');
    expect(toolCall.args.capacityKey).toBe('1024');

    const result = await page.evaluate(async (tc) => {
      const tool = (window as any).__capturedTools.get(tc.tool);
      if (!tool) throw new Error(`Tool "${tc.tool}" no capturada`);
      return tool.execute(tc.args);
    }, toolCall);

    expect(result).toContain('1024');

    const capacityLabel = await page.locator('#capacity-label').textContent();
    expect(capacityLabel).toContain('1 TB');
  });
});
