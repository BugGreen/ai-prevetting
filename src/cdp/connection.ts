import CDP from 'chrome-remote-interface';

export interface CDPConnection {
  client: CDP.Client;
  close: () => Promise<void>;
}

export interface CDPConfig {
  host?: string;
  port?: number;
  targetId?: string;
}

const DEFAULT_CONFIG: CDPConfig = {
  host: 'localhost',
  port: 9222,
};

/**
 * Connect to an existing Chrome instance via CDP
 */
export async function connectToCDP(config: CDPConfig = {}): Promise<CDPConnection> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    // List available targets
    const targets = await CDP.List({
      host: mergedConfig.host,
      port: mergedConfig.port
    });

    // Find a page target (not extension, devtools, etc.)
    let targetId = mergedConfig.targetId;
    if (!targetId) {
      const pageTarget = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome'));
      if (pageTarget) {
        targetId = pageTarget.id;
      }
    }

    const client = await CDP({
      host: mergedConfig.host,
      port: mergedConfig.port,
      target: targetId,
    });

    return {
      client,
      close: async () => {
        await client.close();
      },
    };
  } catch (error) {
    const err = error as Error;
    if (err.message?.includes('ECONNREFUSED')) {
      throw new Error(
        `Cannot connect to Chrome on ${mergedConfig.host}:${mergedConfig.port}. ` +
        `Make sure Chrome is running with --remote-debugging-port=${mergedConfig.port}`
      );
    }
    throw error;
  }
}

/**
 * Create a new CDP target (new tab)
 */
export async function createNewTarget(config: CDPConfig = {}, url: string = 'about:blank'): Promise<CDPConnection> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const target = await CDP.New({
    host: mergedConfig.host,
    port: mergedConfig.port,
    url,
  });

  const client = await CDP({
    host: mergedConfig.host,
    port: mergedConfig.port,
    target: target.id,
  });

  return {
    client,
    close: async () => {
      await client.close();
      await CDP.Close({
        host: mergedConfig.host,
        port: mergedConfig.port,
        id: target.id,
      });
    },
  };
}

/**
 * List all available CDP targets
 */
export async function listTargets(config: CDPConfig = {}): Promise<CDP.Target[]> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  return CDP.List({
    host: mergedConfig.host,
    port: mergedConfig.port,
  });
}

/**
 * Mobile device user agents and viewport settings
 */
export const DEVICE_PROFILES = {
  desktop: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    mobile: false,
  },
  mobile: {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    mobile: true,
  },
  mobileIPhone: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    mobile: true,
  },
};

export type DeviceType = keyof typeof DEVICE_PROFILES;
