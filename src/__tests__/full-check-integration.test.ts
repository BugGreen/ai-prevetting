/**
 * Integration tests for handleFullCheckCommand — covers the discovery branching
 * logic added in Step 8: autonomous path, manual --import-phase1 path,
 * BotWallError re-throw contract, and generic discovery error degradation.
 *
 * All CDP check functions are mocked so no real Chrome connection is needed.
 */

// ── Module mocks (must be before imports) ────────────────────────────────────

jest.mock('../commands/discover-phase1', () => {
  // Preserve the real BotWallError class so instanceof checks work correctly
  const { BotWallError } = jest.requireActual('../commands/discover-phase1');
  return { runPhase1Discovery: jest.fn(), BotWallError };
});

jest.mock('../cdp/connection', () => ({
  listTargets:    jest.fn().mockResolvedValue([{ type: 'page', url: 'about:blank', id: '1' }]),
  createNewTarget: jest.fn(),
  DEVICE_PROFILES: {
    desktop: { userAgent: 'Mozilla/5.0', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, mobile: false },
    mobile:  { userAgent: 'Mozilla/5.0 Mobile', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, mobile: true },
  },
}));

jest.mock('../commands/compare-mobile-desktop', () => ({
  compareMobileDesktop: jest.fn().mockResolvedValue({
    comparison: { hasDifferences: false, diffCount: 0, diffs: [] },
    mobileHtml: '', desktopHtml: '',
  } as any),
}));

jest.mock('../commands/check-ssr', () => ({
  checkSSR: jest.fn().mockResolvedValue({
    url: '', analysis: { isSSR: false, isCSR: true, isHybrid: false, confidence: 'high', reasoning: '' },
    rawHtml: { length: 0, hasContent: false, contentIndicators: {} },
    renderedHtml: { length: 0, hasContent: false, contentIndicators: {} },
  } as any),
}));

jest.mock('../commands/check-images', () => ({
  checkImages: jest.fn().mockResolvedValue({
    summary: { optimizedPercentage: 0 },
    lazyLoadAnalysis: { aboveTheFoldLazyLoaded: [] },
  } as any),
}));

jest.mock('../commands/get-headers', () => ({
  getHeaders: jest.fn().mockResolvedValue({
    analysis: { cdn: null, csp: null, xPoweredBy: null, server: null, cacheControl: null, securityHeaders: {} },
  } as any),
}));

jest.mock('../commands/check-navigation', () => ({
  checkNavigation: jest.fn().mockResolvedValue(null),
}));

jest.mock('../commands/run-wpt', () => ({
  runWPT: jest.fn().mockRejectedValue(new Error('WPT not available in tests')),
}));

jest.mock('../utils/artifacts', () => {
  const actual = jest.requireActual('../utils/artifacts');
  return {
    ...actual,
    readReportContent: jest.fn().mockReturnValue('# Phase 1 Report\n**Website:** https://example.com'),
    parseStep1Report: jest.fn().mockReturnValue({
      url:          'https://example.com',
      domain:       'example.com',
      summaryTable: {},
      pageTypes:    [{ name: 'Homepage', urlPattern: 'https://example.com' }],
      techStack:    {},
      rawContent:   '',
    }),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { handleFullCheckCommand } from '../commands/full-check';
import { runPhase1Discovery, BotWallError } from '../commands/discover-phase1';
import { parseStep1Report } from '../utils/artifacts';

const mockRunPhase1Discovery = runPhase1Discovery as jest.MockedFunction<typeof runPhase1Discovery>;
const mockParseStep1Report   = parseStep1Report   as jest.MockedFunction<typeof parseStep1Report>;

const BASE_URL = 'https://example.com';

const FAKE_STEP1_REPORT = {
  url: BASE_URL, domain: 'example.com', summaryTable: {},
  pageTypes: [{ name: 'Homepage', urlPattern: BASE_URL }, { name: 'PLP', urlPattern: `${BASE_URL}/category` }],
  techStack: { Framework: 'Next.js' }, rawContent: '',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleFullCheckCommand — discovery path branching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockRunPhase1Discovery.mockResolvedValue(FAKE_STEP1_REPORT as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('autonomous path: calls runPhase1Discovery when no --import-phase1 flag', async () => {
    await handleFullCheckCommand(BASE_URL, {});

    expect(mockRunPhase1Discovery).toHaveBeenCalledTimes(1);
    expect(mockRunPhase1Discovery).toHaveBeenCalledWith(BASE_URL);
  });

  it('manual path: skips runPhase1Discovery and calls parseStep1Report when --import-phase1 is provided', async () => {
    await handleFullCheckCommand(undefined, { importPhase1: 'step1-report.md' });

    expect(mockRunPhase1Discovery).not.toHaveBeenCalled();
    expect(mockParseStep1Report).toHaveBeenCalledTimes(1);
  });

  it('re-throws BotWallError without swallowing it — no process.exit', async () => {
    const botWallErr = new BotWallError(BASE_URL, 'cloudflare', 'high');
    mockRunPhase1Discovery.mockRejectedValue(botWallErr);

    // Must propagate as BotWallError, not be swallowed or converted to process.exit
    await expect(handleFullCheckCommand(BASE_URL, {})).rejects.toThrow(BotWallError);
    await expect(handleFullCheckCommand(BASE_URL, {})).rejects.toThrow(/bot wall/i);
  });

  it('generic discovery error: warns, records failed timing, and continues to Phase 2 checks', async () => {
    mockRunPhase1Discovery.mockRejectedValue(new Error('CDP connection refused'));

    // Should NOT throw — graceful degradation means Phase 2 still runs
    await expect(handleFullCheckCommand(BASE_URL, {})).resolves.not.toThrow();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Phase 1 discovery failed'),
    );
  });
});
