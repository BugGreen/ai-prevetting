/**
 * bot-wall.ts
 *
 * Bot-wall / challenge-page detection for Phase 1 Discovery.
 * Static registry (BOT_DETECTORS) and execution logic (detectBotWall) are
 * co-located here — the registry is an internal implementation detail of this
 * function and is not shared with any other module.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BotWallResult {
  isWall: boolean;
  /** null when isWall is false */
  type: 'cloudflare' | 'distil' | 'datadome' | 'perimeterx' | 'generic' | null;
  confidence: 'high' | 'medium' | 'low';
  /** Human-readable strings naming each matched signal */
  evidence: string[];
}

interface BotSignal {
  pattern: RegExp;
  weight: number;
  description: string;
}

interface BotDetector {
  name: BotWallResult['type'];
  signals: BotSignal[];
  /** Minimum cumulative signal weight required to declare a match */
  minScore: number;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Registry of known bot-wall / challenge-page patterns.
 * To add a new detector: append one object here — the function body never changes.
 */
const BOT_DETECTORS: BotDetector[] = [
  {
    name: 'cloudflare',
    minScore: 0.8,
    signals: [
      { pattern: /cf-mitigated/i,                                weight: 1.0, description: 'cf-mitigated header marker' },
      { pattern: /cf-chl-bypass/i,                               weight: 1.0, description: 'Cloudflare challenge bypass' },
      { pattern: /Checking if the site connection is secure/i,   weight: 1.0, description: 'Cloudflare challenge text' },
      { pattern: /challenge-form/i,                              weight: 0.8, description: 'Cloudflare challenge form' },
      { pattern: /cf_chl_opt/i,                                  weight: 1.0, description: 'Cloudflare challenge options' },
      { pattern: /__cf_chl_tk__/i,                               weight: 1.0, description: 'Cloudflare challenge token' },
      { pattern: /Just a moment\.\.\./i,                         weight: 0.8, description: 'Cloudflare challenge title' },
    ],
  },
  {
    name: 'datadome',
    minScore: 0.7,
    signals: [
      { pattern: /geo\.captcha-delivery\.com/i,   weight: 1.0, description: 'DataDome captcha delivery' },
      { pattern: /captcha-delivery\.com/i,        weight: 1.0, description: 'DataDome captcha domain' },
      { pattern: /datadome/i,                     weight: 0.7, description: 'DataDome reference' },
      { pattern: /_dd_s\b/i,                      weight: 0.7, description: 'DataDome session marker' },
    ],
  },
  {
    name: 'perimeterx',
    minScore: 1.0,
    signals: [
      { pattern: /_px3\b/,          weight: 1.0, description: 'PerimeterX token' },
      { pattern: /PXJS/,            weight: 1.0, description: 'PerimeterX JS bundle' },
      { pattern: /pxchk/i,          weight: 1.0, description: 'PerimeterX check marker' },
      { pattern: /px-captcha/i,     weight: 1.0, description: 'PerimeterX captcha' },
      { pattern: /PerimeterX/i,     weight: 1.0, description: 'PerimeterX reference' },
    ],
  },
  {
    name: 'distil',
    minScore: 0.7,
    signals: [
      { pattern: /distil_r_captcha/i,  weight: 1.0, description: 'Distil captcha marker' },
      { pattern: /ak_bmsc/i,           weight: 0.7, description: 'Akamai/Distil bot score marker' },
      { pattern: /Imperva/i,           weight: 1.0, description: 'Imperva reference' },
      { pattern: /incapsula/i,         weight: 1.0, description: 'Imperva/Incapsula reference' },
    ],
  },
  {
    name: 'generic',
    minScore: 0.7,
    signals: [
      {
        pattern: /<title>[^<]*(Access Denied|Robot Check|Please verify|403 Forbidden|Too Many Requests|Attention Required|Security Check|Human Verification)[^<]*<\/title>/i,
        weight: 1.0,
        description: 'Bot-wall page title',
      },
      { pattern: /Please complete the security check/i,  weight: 1.0, description: 'Security check prompt' },
      { pattern: /verify you are human/i,                weight: 1.0, description: 'Human verification prompt' },
      { pattern: /This site is protected/i,              weight: 0.7, description: 'Site protection notice' },
    ],
  },
];

// ─── Function ─────────────────────────────────────────────────────────────────

/**
 * Inspect raw HTML for known bot-wall / challenge-page signatures.
 * Pure function — no CDP, no network. Operates on a string.
 *
 * Uses a Registry pattern: adding a new detector means adding one entry to
 * BOT_DETECTORS above. The function body itself never needs to change.
 *
 * Called by:
 *   - check-ssr.ts    : after getResponseBody(), before analyzeContent()
 *   - check-images.ts : after loadEventFired(), before DOM queries
 *   - runPhase1Discovery(): step 6 — aborts if isWall=true
 */
export async function detectBotWall(rawHtml: string): Promise<BotWallResult> {
  for (const detector of BOT_DETECTORS) {
    let score = 0;
    const matched: string[] = [];

    for (const signal of detector.signals) {
      if (signal.pattern.test(rawHtml)) {
        score += signal.weight;
        matched.push(signal.description);
      }
    }

    if (score >= detector.minScore) {
      const confidence: BotWallResult['confidence'] =
        score >= 1.5 ? 'high' : score >= 1.0 ? 'medium' : 'low';
      return { isWall: true, type: detector.name, confidence, evidence: matched };
    }
  }

  return { isWall: false, type: null, confidence: 'high', evidence: [] };
}
