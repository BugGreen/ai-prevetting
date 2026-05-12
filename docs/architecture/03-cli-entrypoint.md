# Module 3 — The CLI Entry Point

**File:** `src/cli.ts`

---

## How Commander.js Works

Commander.js is the TypeScript equivalent of Python's Click library.
Each `.command('name')` block is a `@click.command()`, each `.option()` is a
`@click.option()`, and `.action(async (args, options) => { ... })` is the
decorated function body. The final `program.parse()` at line 335 is the
equivalent of `if __name__ == "__main__": cli()`.

`cli.ts` is deliberately thin — it only declares the command surface (names,
options, descriptions) and immediately delegates to handler functions imported
from `src/commands/`. No business logic lives here. This file does not require
significant modification for the refactor.

---

## full-check Decision Tree

```mermaid
flowchart TD
    A([npx ts-node src/cli.ts full-check]) --> B{URL argument\nprovided?}

    B -->|Yes| C[url = argv]
    B -->|No| D{--report flag\nprovided?}

    D -->|Yes| E["readReportContent(file)
    artifacts.ts:144"]
    D -->|No| Z["throw Error:
    'URL required'
    process.exit(1)"]

    E --> F["parseStep1Report(content)
    artifacts.ts:169"]
    F --> G[step1Report object]
    G --> H{URL found\nin report?}
    H -->|Yes| I[url = step1Report.url]
    H -->|No| Z

    C --> J[step1Report = null]
    I --> K[step1Report = parsed]
    J & K --> L["ensureChromeRunning()"]

    L --> M{Chrome already\non port 9222?}
    M -->|Yes| N[continue]
    M -->|No| O[spawn Chrome subprocess\n--remote-debugging-port=9222\n~/.chrome-debug-profile]
    O --> P{CDP responds\nwithin 5s?}
    P -->|Yes| N
    P -->|No| Q["throw Error:
    'Failed to start Chrome'
    process.exit(1)"]

    N --> R["runFullCheck({ url, step1Report, ... })
    full-check.ts:254"]
    R --> S[print summary to console]
    R --> T{--save flag?}
    T -->|Yes| U["createRunDir()
    write execution-metrics.json"]
    T -->|No| V[no files written]
```

---

## The One Meaningful Difference: full-check vs. Individual Commands

Individual commands (`check-ssr`, `check-images`, etc.) take a URL, run one
check, print the result, and exit. They are stateless one-shots.

`full-check` does three extra things no individual command does:
1. **Bootstraps Chrome automatically** — individual commands fail if Chrome isn't running; `full-check` starts Chrome automatically
2. **Reads and threads Step 1 context** — parses the report file and passes the resulting `Step1ParsedReport` object down into `runFullCheck()`, where it gates the navigation check
3. **Writes `execution-metrics.json`** — records timing and error data for the post-session `execution-report` command to consume later
