/**
 * discover-phase1/index.ts
 *
 * Public interface for Phase 1 Discovery.
 * This barrel file is the single import point for all consumers
 * (check-ssr.ts, check-images.ts, check-navigation.ts, full-check.ts).
 *
 * Adding a new Phase 1 module:
 *   1. Create src/commands/discover-phase1/<module>.ts
 *      with static registry + execution logic co-located
 *   2. Re-export its public types and functions here
 *
 * Execution model:
 *   runPhase1Discovery() (in orchestrator.ts, coming in Step 7) opens ONE
 *   Chrome tab, passes the client to every helper, and closes the tab at the end.
 *   Helpers never open or close connections themselves.
 *
 * Conventions followed: docs/architecture/08-existing-conventions.md
 */

export { BotWallResult, detectBotWall } from './bot-wall';
export { DismissResult, dismissBlockingModals } from './modals';
export { SiteLink, crawlSiteLinks } from './crawl';
export { PageType, discoverPageTypes, selectPageTypes, MIN_CONFIDENCE_THRESHOLD } from './page-types';
export { TechStackResult, detectTechStack } from './tech-stack';
export { BotWallError, runPhase1Discovery } from './orchestrator';
