jest.mock('../../commands/discover-phase1/bot-wall');
jest.mock('../../commands/discover-phase1/modals');
jest.mock('../../commands/discover-phase1/page-types');
jest.mock('../../commands/discover-phase1/tech-stack');
jest.mock('../../cdp/connection');

import { runPhase1Discovery, BotWallError } from '../../commands/discover-phase1/orchestrator';
import { detectBotWall } from '../../commands/discover-phase1/bot-wall';
import { dismissBlockingModals } from '../../commands/discover-phase1/modals';
import { discoverPageTypes } from '../../commands/discover-phase1/page-types';
import { detectTechStack } from '../../commands/discover-phase1/tech-stack';
import { createNewTarget } from '../../cdp/connection';

const mockDetectBotWall        = detectBotWall        as jest.MockedFunction<typeof detectBotWall>;
const mockDismissBlockingModals = dismissBlockingModals as jest.MockedFunction<typeof dismissBlockingModals>;
const mockDiscoverPageTypes    = discoverPageTypes    as jest.MockedFunction<typeof discoverPageTypes>;
const mockDetectTechStack      = detectTechStack      as jest.MockedFunction<typeof detectTechStack>;
const mockCreateNewTarget      = createNewTarget      as jest.MockedFunction<typeof createNewTarget>;

const BASE_URL = 'https://example.com';

interface FakeConnectionOverrides {
  domContentEventFired?: () => Promise<unknown>;
  loadEventFired?: () => Promise<unknown>;
  body?: string;
}

function makeFakeConnection(overrides?: Partial<FakeConnectionOverrides>) {
  const responseBody = overrides?.body ?? '<html><head></head></html>';
  const client = {
    Network: {
      enable: jest.fn().mockResolvedValue({}),
      // Immediately invoke the listener with a fake Document event so that
      // mainRequestId is set before navigate() is called. This mirrors the
      // real CDP flow where the listener is registered before navigation.
      responseReceived: jest.fn().mockImplementation((handler: (p: unknown) => void) => {
        handler({ type: 'Document', requestId: 'fake-request-id', response: { headers: {} } });
      }),
      getResponseBody: jest.fn().mockResolvedValue({ body: responseBody, base64Encoded: false }),
    },
    Page: {
      enable:                jest.fn().mockResolvedValue({}),
      navigate:              jest.fn().mockResolvedValue({}),
      domContentEventFired:  jest.fn().mockImplementation(overrides?.domContentEventFired ?? (() => Promise.resolve({}))),
      loadEventFired:        jest.fn().mockImplementation(overrides?.loadEventFired ?? (() => Promise.resolve({}))),
    },
    Runtime: {
      enable:   jest.fn().mockResolvedValue({}),
      evaluate: jest.fn().mockResolvedValue({ result: { type: 'string', value: '[]' } }),
    },
  };
  return { client, close: jest.fn().mockResolvedValue(undefined) };
}

describe('runPhase1Discovery', () => {
  let fakeConnection: ReturnType<typeof makeFakeConnection>;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeConnection = makeFakeConnection();
    mockCreateNewTarget.mockResolvedValue(fakeConnection as any);

    mockDetectBotWall.mockResolvedValue({ isWall: false, type: null, confidence: 'high', evidence: [] });
    mockDismissBlockingModals.mockResolvedValue({ dismissed: false, count: 0, methods: [] });
    mockDiscoverPageTypes.mockResolvedValue([
      { name: 'Homepage', urlPattern: BASE_URL },
      { name: 'PLP',      urlPattern: `${BASE_URL}/category/boots` },
    ]);
    mockDetectTechStack.mockReturnValue({ Framework: ['Next.js'] });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns a Step1ParsedReport with url, domain, pageTypes, and techStack', async () => {
    const report = await runPhase1Discovery(BASE_URL);

    expect(report.url).toBe(BASE_URL);
    expect(report.domain).toBe('example.com');
    expect(report.pageTypes).toHaveLength(2);
    expect(report.pageTypes[0].name).toBe('Homepage');
    expect(report.techStack['Framework']).toBe('Next.js');
  });

  // ── Bot wall ──────────────────────────────────────────────────────────────

  it('throws BotWallError and still closes the tab when a bot wall is detected', async () => {
    mockDetectBotWall.mockResolvedValue({
      isWall: true, type: 'cloudflare', confidence: 'high', evidence: ['cf-chl-bypass'],
    });

    await expect(runPhase1Discovery(BASE_URL)).rejects.toThrow(BotWallError);
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
  });

  // ── Smart Wait ───────────────────────────────────────────────────────────

  it('throws a fatal timeout when domContentEventFired never fires (30s safety net)', async () => {
    jest.useFakeTimers();

    const hangingConnection = makeFakeConnection({
      domContentEventFired: () => new Promise(() => {}), // never resolves
      loadEventFired: () => new Promise(() => {}),
    });
    mockCreateNewTarget.mockResolvedValue(hangingConnection as any);

    const promise = runPhase1Discovery(BASE_URL);
    const assertion = expect(promise).rejects.toThrow(/timed out/i);

    await jest.runAllTimersAsync();
    await assertion;

    expect(hangingConnection.close).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('warns and proceeds when loadEventFired hangs but domContentEventFired succeeds (soft timeout)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.useFakeTimers();

    const softTimeoutConnection = makeFakeConnection({
      loadEventFired: () => new Promise(() => {}), // never resolves — simulates tracker bloat
    });
    mockCreateNewTarget.mockResolvedValue(softTimeoutConnection as any);

    const promise = runPhase1Discovery(BASE_URL);

    // Advance past the 15s soft timeout but not the 30s fatal timeout
    await jest.advanceTimersByTimeAsync(16_000);

    const report = await promise;

    expect(report).toBeDefined();
    expect(report.url).toBe(BASE_URL);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Proceeding with current DOM state'));
    expect(softTimeoutConnection.close).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  // ── Empty rawHtml ─────────────────────────────────────────────────────────

  it('throws a fatal error and closes the tab when rawHtml is empty', async () => {
    const emptyBodyConnection = makeFakeConnection({ body: '' });
    // Also make the DOM fallback return empty so rawHtml stays empty
    emptyBodyConnection.client.Runtime.evaluate.mockResolvedValue({
      result: { type: 'string', value: '' },
    });
    mockCreateNewTarget.mockResolvedValue(emptyBodyConnection as any);

    await expect(runPhase1Discovery(BASE_URL)).rejects.toThrow(/Failed to retrieve page HTML/i);
    expect(emptyBodyConnection.close).toHaveBeenCalledTimes(1);
  });

  // ── Non-fatal isolation ───────────────────────────────────────────────────

  it('warns and continues when dismissBlockingModals throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDismissBlockingModals.mockRejectedValue(new Error('selector timeout'));

    const report = await runPhase1Discovery(BASE_URL);

    expect(report).toBeDefined();
    expect(report.pageTypes).toHaveLength(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('dismissBlockingModals'));
  });

  it('warns and returns empty pageTypes when discoverPageTypes throws', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDiscoverPageTypes.mockRejectedValue(new Error('evaluate failed'));

    const report = await runPhase1Discovery(BASE_URL);

    expect(report.pageTypes).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('discoverPageTypes'));
    // detectTechStack should still have run
    expect(mockDetectTechStack).toHaveBeenCalledTimes(1);
  });

  // ── Tab always closed ─────────────────────────────────────────────────────

  it('always closes the tab when an unexpected fatal error occurs', async () => {
    mockDetectTechStack.mockImplementation(() => { throw new Error('unexpected crash'); });

    await expect(runPhase1Discovery(BASE_URL)).rejects.toThrow('unexpected crash');
    expect(fakeConnection.close).toHaveBeenCalledTimes(1);
  });
});
