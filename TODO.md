# TODO - Open Topics & Next Steps

## Immediate Tasks

### Configuration
- [ ] Add WPT API key to `.env` file

### Testing
- [ ] Run end-to-end test of full workflow:
  1. `start-chrome`
  2. `full-check --report step1-report.md -s` (or with URL directly)
  3. `execution-report` with parameters
- [ ] Test URL extraction with different report formats

---

## Open Topics

### Execution Report Improvements

| Topic | Description | Priority |
|-------|-------------|----------|
| Automatic token tracking | Currently tokens must be manually estimated. Could integrate with Claude Code API if available. | Medium |
| Session duration tracking | Track total CC session time (not just CLI duration) | Low |
| Report aggregation | Combine multiple execution reports into a summary | Low |

### CLI Enhancements

| Topic | Description | Priority |
|-------|-------------|----------|
| WPT retry logic | WPT API often times out or gets blocked by Cloudflare. Add retry with exponential backoff. | High |
| Progress indicator | Show real-time progress during parallel checks | Low |
| JSON output format | Add `--json` flag for machine-readable output | Medium |
| Configurable parallelism | Allow limiting concurrent checks | Low |

### Report Format

| Topic | Description | Priority |
|-------|-------------|----------|
| Notion API integration | Direct export to Notion database | Medium |
| Confluence API integration | Direct export to Confluence | Medium |
| HTML report | Standalone HTML with embedded CSS for sharing | Low |
| PDF generation | Generate PDF from Markdown reports | Low |

---

## Known Issues

### WPT Integration
- Cloudflare sometimes blocks API requests from certain IPs
- Workaround: Use `wpt-results <testId>` with manually started tests
- Long-term: Implement retry logic or proxy support

### Token Estimation
- No automatic way to get actual token usage from Claude Code
- Current solution: Manual estimation via `--input-tokens` and `--output-tokens`
- Pricing may change - currently hardcoded in `execution-report.ts`

---

## Future Ideas

### Analytics Dashboard
- Aggregate execution reports over time
- Track trends in:
  - CLI performance
  - Token usage
  - Common issues
  - Prompt improvement effectiveness

### Skill Integration
- Create a Claude Code skill that automates the full workflow
- Skill could:
  1. Run `full-check`
  2. Analyze results
  3. Generate final pre-vetting report
  4. Auto-generate execution report with observations

### Comparison Mode
- Compare multiple runs of the same website
- Track changes over time
- Alert on regressions

---

## Completed

- [x] Create `.env` file for WPT API key
- [x] Add execution metrics tracking to `full-check`
- [x] Create separate `execution-report` command
- [x] Add timing display to console output
- [x] Update CLAUDE.md with full documentation
- [x] Export interfaces for external use
- [x] Add `--report` option to extract URL from Step 1 report
- [x] Create separate `prompts/step2-prompt.md` for Step 2 workflow
- [x] URL extraction supports multiple formats (Markdown, plain text, tables)

---

*Last updated: 2026-01-19*
