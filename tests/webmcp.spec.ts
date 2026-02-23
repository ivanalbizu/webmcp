import { test, expect } from '@playwright/test';

// Mock navigator.modelContext antes de que cargue el script del configurador.
// Esto simula un navegador con WebMCP habilitado.
async function mockWebMCP(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const tools: Record<string, any> = {};
    let lastContext: any = null;

    (navigator as any).modelContext = {
      provideContext: async (params: any) => {
        lastContext = params;
        if (params.tools) {
          for (const tool of params.tools) {
            tools[tool.name] = tool;
          }
        }
      },
      registerTool: async (tool: any) => {
        tools[tool.name] = tool;
      },
      unregisterTool: async (name: string) => {
        delete tools[name];
      },
      clearContext: () => {
        lastContext = null;
        for (const key in tools) delete tools[key];
      },
    };

    // Exponer para inspeccionar desde los tests
    (window as any).__mcpMock = {
      getTools: () => Object.keys(tools),
      getContext: () => lastContext,
      executeTool: (name: string, params: any) => tools[name]?.execute(params),
      hasTool: (name: string) => name in tools,
    };
  });
}

test.describe('iPhone - WebMCP registration', () => {
  test('registers 4 tools via provideContext', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const tools = await page.evaluate(() => (window as any).__mcpMock.getTools());
    expect(tools).toContain('getProductState');
    expect(tools).toContain('cambiarColor');
    expect(tools).toContain('cambiarModelo');
    expect(tools).toContain('cambiarCapacidad');
    expect(tools).toHaveLength(4);
  });

  test('provideContext includes correct name and description', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const ctx = await page.evaluate(() => (window as any).__mcpMock.getContext());
    expect(ctx.name).toBe('iPhone Configurator');
    expect(ctx.description).toContain('iPhone');
  });

  test('context includes current state', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const ctx = await page.evaluate(() => (window as any).__mcpMock.getContext());
    expect(ctx.context).toContain('iPhone 15 Pro');
    expect(ctx.context).toContain('cambiarColor');
  });

  test('status shows WebMCP ready', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    await expect(page.locator('#mcp-status')).toContainText('WebMCP listo');
  });
});

test.describe('iPhone - WebMCP tool execution', () => {
  test('cambiarColor changes the UI', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarColor', { colorKey: 'azul' })
    );
    expect(result).toContain('Titanio Azul');
    await expect(page.locator('#color-name')).toHaveText('Titanio Azul');
  });

  test('cambiarModelo changes the UI', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarModelo', { modelKey: 'iphone15promax' })
    );
    expect(result).toContain('iPhone 15 Pro Max');
    await expect(page.locator('#model-title')).toHaveText('iPhone 15 Pro Max');
  });

  test('cambiarCapacidad changes the UI', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarCapacidad', { capacityKey: '1024' })
    );
    expect(result).toContain('1 TB');
    await expect(page.locator('#capacity-name')).toHaveText('1 TB');
  });

  test('getProductState returns JSON with current state', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('getProductState', {})
    );
    const state = JSON.parse(result);
    expect(state.modelo).toBe('iPhone 15 Pro');
    expect(state.color).toBe('Titanio Natural');
    expect(state.capacidad).toBe('256 GB');
    expect(state.precio).toContain('1339');
  });

  test('cambiarColor with invalid key returns error', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarColor', { colorKey: 'rojo' })
    );
    expect(result).toContain('no reconocido');
  });
});

test.describe('iPhone - Dynamic tools (registerTool/unregisterTool)', () => {
  test('confirmarCompra appears after a change', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    // Initially no confirmarCompra
    let has = await page.evaluate(() => (window as any).__mcpMock.hasTool('confirmarCompra'));
    expect(has).toBe(false);

    // Trigger a change via tool
    await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarColor', { colorKey: 'negro' })
    );

    // Wait for registerTool (async)
    await page.waitForFunction(() => (window as any).__mcpMock.hasTool('confirmarCompra'));
    has = await page.evaluate(() => (window as any).__mcpMock.hasTool('confirmarCompra'));
    expect(has).toBe(true);
  });

  test('confirmarCompra disappears after execution', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    // Trigger change + wait for tool
    await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarModelo', { modelKey: 'iphone15' })
    );
    await page.waitForFunction(() => (window as any).__mcpMock.hasTool('confirmarCompra'));

    // Execute confirmarCompra
    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('confirmarCompra', {})
    );
    expect(result).toContain('Compra confirmada');

    // Wait for unregisterTool (async)
    await page.waitForFunction(() => !(window as any).__mcpMock.hasTool('confirmarCompra'));
    const has = await page.evaluate(() => (window as any).__mcpMock.hasTool('confirmarCompra'));
    expect(has).toBe(false);
  });

  test('confirmarCompra shows order confirmation in UI', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/iphone');

    await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarColor', { colorKey: 'blanco' })
    );
    await page.waitForFunction(() => (window as any).__mcpMock.hasTool('confirmarCompra'));

    await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('confirmarCompra', {})
    );

    await expect(page.locator('#order-confirmation')).toBeVisible();
    await expect(page.locator('#order-summary')).toContainText('Pedido confirmado');
  });
});

test.describe('MacBook - WebMCP registration', () => {
  test('registers 4 tools via provideContext', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/macbook');

    const tools = await page.evaluate(() => (window as any).__mcpMock.getTools());
    expect(tools).toContain('getProductState');
    expect(tools).toContain('cambiarColor');
    expect(tools).toContain('cambiarModelo');
    expect(tools).toContain('cambiarCapacidad');
    expect(tools).toHaveLength(4);
  });

  test('context includes MacBook info', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/macbook');

    const ctx = await page.evaluate(() => (window as any).__mcpMock.getContext());
    expect(ctx.name).toBe('MacBook Configurator');
    expect(ctx.context).toContain('MacBook Pro 14');
  });

  test('cambiarColor works with MacBook colors', async ({ page }) => {
    await mockWebMCP(page);
    await page.goto('/macbook');

    const result = await page.evaluate(() =>
      (window as any).__mcpMock.executeTool('cambiarColor', { colorKey: 'medianoche' })
    );
    expect(result).toContain('Medianoche');
    await expect(page.locator('#color-name')).toHaveText('Medianoche');
  });
});
