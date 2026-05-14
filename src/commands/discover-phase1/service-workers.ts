/**
 * service-workers.ts
 *
 * Detects active service worker registrations via CDP Runtime.evaluate
 * and classifies each by scriptURL pattern (speed-kit, workbox, custom).
 *
 * CDP-dependent — requires an active client connection.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServiceWorkerResult {
  hasServiceWorker: boolean;
  registrations: Array<{ scriptURL: string; type: 'speed-kit' | 'workbox' | 'custom' }>;
}

// ─── Classification ─────────────────────────────────────────────────────────

function classifyWorker(scriptURL: string): 'speed-kit' | 'workbox' | 'custom' {
  if (/speed-kit/i.test(scriptURL)) return 'speed-kit';
  if (/workbox/i.test(scriptURL)) return 'workbox';
  return 'custom';
}

// ─── Function ────────────────────────────────────────────────────────────────

/**
 * Detect service worker registrations in the current page context.
 *
 * Called by:
 *   - runPhase1Discovery(): after pure detection functions, CDP-dependent
 */
export async function detectServiceWorkers(client: any): Promise<ServiceWorkerResult> {
  const { result } = await client.Runtime.evaluate({
    expression: `
      (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          return JSON.stringify(regs.map(r => r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL).filter(Boolean));
        } catch {
          return JSON.stringify([]);
        }
      })()
    `,
    awaitPromise: true,
    returnByValue: true,
  });

  const urls: string[] = JSON.parse(result.value || '[]');

  return {
    hasServiceWorker: urls.length > 0,
    registrations: urls.map(scriptURL => ({
      scriptURL,
      type: classifyWorker(scriptURL),
    })),
  };
}
