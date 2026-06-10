# Cursor: Coding Agents — Enhanced Notes

*Based on “Cursor: coding agents tutorial” by leerob*

-----

## 1. Key Vocabulary (The “Words” You Flagged)

### Linters

A tool that automatically scans your code for style problems, bugs, and suspicious patterns **without running the code**.

- **Analogy:** A spell-checker and grammar-checker for code. It won’t tell you if your essay’s argument is good, but it catches typos, run-on sentences, and inconsistent formatting.
- **Examples:** ESLint (JavaScript/TypeScript), Pylint or Ruff (Python), ShellCheck (bash — useful for your ping scripts).
- **Why agents care:** Cursor’s agent can run the linter, read the warnings, and fix them automatically — a fast feedback loop that needs no human.

### Tech Debt

Shortcuts taken in code that make future work slower. Like financial debt, it “accrues interest” — the longer you leave it, the more expensive it is to fix.

- **Analogy:** Skipping pool filter maintenance. The pool works fine today, but every month you skip it, the eventual cleanup gets bigger and more expensive.
- **Examples:** Copy-pasted code in five places instead of one shared function; outdated libraries nobody upgraded; “temporary” hacks from 2 years ago.
- **Why agents care:** Agents are good at the boring, repetitive cleanup work (refactoring, dependency upgrades) that humans avoid.

### GitHub PR (Pull Request)

A formal proposal to merge your changes into the main codebase. It packages up your commits, shows a diff of what changed, and gives teammates a place to review and comment before the change is accepted.

- **Analogy:** Submitting a contract draft to a client for redlines before both parties sign. Nothing is final until it’s reviewed and approved.
- **Workflow:** branch → commit changes → push → open PR → review → merge.

### Testing Infrastructure

The whole setup that lets tests exist and run: the test framework, config files, mock data, helper utilities, and the commands that execute everything.

- **Why it matters for agents:** When you tell an agent “use our existing testing infrastructure,” you’re saying *don’t invent a new way to test — follow the patterns, frameworks, and helpers already in this repo.*

### Unit Tests

Small, fast tests that verify **one piece** of code in isolation (a single function or component).

- **Example:** A test that calls `formatSpeed(1500)` and asserts it returns `"1.5 Gbps"` — directly relevant to your speed-test fill bar’s unit-switching logic.
- **Analogy:** Testing each individual pool pump part on the bench before installing it.

### Fuzz Tests

Tests that throw **random, unexpected, or malformed input** at your code to find crashes and edge cases humans wouldn’t think of.

- **Example:** Feeding your tick-mark calculator negative numbers, `NaN`, `Infinity`, or 10^308 to see if it breaks.
- **Cybersecurity tie-in:** Fuzzing is a core security-research technique — fuzzers like AFL find memory-corruption vulnerabilities by mutating inputs millions of times.
- **Analogy:** A crash-test facility that slams the car into walls at every angle, not just head-on.

### Playwright Integration Tests

**Playwright** is a tool that drives a real browser programmatically. **Integration tests** verify that multiple pieces work *together* (vs. unit tests, which test pieces alone).

- **Example:** A Playwright test opens your web app, clicks “Run Speed Test,” waits for the fill bar to animate, and verifies the displayed number matches the result.
- **Analogy:** Unit test = testing the pump alone. Integration test = filling the pool, turning the whole system on, and confirming water actually circulates.

### Test Frameworks

The libraries that give you the structure to write and run tests: assertions, test runners, reporting.

- **Examples:** Jest / Vitest (JavaScript), pytest (Python), Playwright (browser tests).

### CI Pipeline (Continuous Integration)

An automated assembly line that runs on every push or PR: it builds your code, runs linters, runs tests, and reports pass/fail — usually via GitHub Actions or similar.

- **Analogy:** A quality-control checkpoint at a factory. Every product (commit) passes through the same inspections before shipping. No commit merges if the pipeline fails.
- **Use case:** Your PR triggers the pipeline → tests fail → the PR is blocked until fixed. This is how teams “prevent regressions” automatically.

### MCP Servers (Model Context Protocol)

A standard way to plug **external tools and data sources** into an AI agent. Each MCP server exposes capabilities (search a database, read Slack, query an API) that the agent can call.

- **Analogy:** USB-C for AI. One standard port, many devices — instead of every tool needing a custom adapter.
- **Examples:** A Postgres MCP server lets the agent query your database; a Sentry MCP server lets it read your production error logs.

-----

## 2. Core Agent Workflows (The “Phrases”)

### 2.1 Tighten the Feedback Loop

The central theme of the video: **the faster the agent can see the result of its change, the better it works.**

- **“Start the local dev server to test changes”** — The agent runs your app locally so changes can be verified immediately instead of guessed at.
- **“Copy and paste errors back to the model”** — Error messages are gold. Don’t summarize them (“it’s broken”) — paste the full stack trace. The agent parses file names, line numbers, and error types.
- **“Ask multiple models to fix the same bug”** — Run the same bug past different models (or multiple agent attempts) in parallel and compare solutions. Like getting three contractor quotes — the differences reveal which diagnosis is right.
- **For UI work, the tightest loop is visual** — Design Mode (§4) lets you see and steer changes in a live browser instead of round-tripping through text descriptions.

### 2.2 Let the Agent Gather Evidence

Don’t just tell the agent the symptom — give it tools to investigate.

- **Example prompt from the video:** *“Profile and find slow queries on my database (DATABASE_URL in .env.local) with psql.”*
  - The agent connects with `psql`, runs `EXPLAIN ANALYZE` on queries, and finds the actual bottleneck — rather than guessing from code alone.
- **“Pull data from external tools”** — via MCP servers or CLI tools: error trackers, logs, analytics.
- **Analogy:** A doctor ordering bloodwork instead of diagnosing from a verbal description alone.

### 2.3 Verify Before You Trust

- **“Spend time understanding the proposed solution”** — Don’t blindly accept the diff. The two challenge questions to ask the agent:
  - *“Are there other cases we haven’t considered?”* — forces it to enumerate edge cases.
  - *“Is this really the root cause?”* — distinguishes a band-aid (suppressing the error) from a cure (fixing why it happens).
- **Use case:** The agent “fixes” a crash by wrapping code in try/catch. Asking the root-cause question reveals the real issue is a null value upstream.

### 2.4 Prevent Regressions

A **regression** = something that used to work and now doesn’t, because a new change broke it.

- The defense: once a bug is fixed, **write a test that would have caught it.** If the bug ever returns, the test fails immediately.
- **“Let agents write your tests and verify they are correct”** — Example prompt from the video: *“Let’s write some new tests for the new functionality we’ve added for the new individual model pages. You can use our existing testing infrastructure.”*
- Note the two key elements of that prompt: scope (*the new functionality*) and constraint (*existing infrastructure*).

### 2.5 Testing at Scale with Cloud Agents

Cloud agents run remotely (not on your laptop), so you can launch many in parallel and let them run long tasks.

- **Example prompt:** *“Fuzz and test through apps/docs and ensure everything is working correctly — docs search, copying pages, sharing feedback, navigating between pages, switching themes, etc.”*
- **Use case:** Overnight, a cloud agent clicks through your entire docs site like a tireless QA intern, filing issues for anything broken.

### 2.6 Performance & Hygiene Tasks Agents Are Great At

- **“Ask agent to profile your test”** — find which tests are slowest and why.
- **“Audit your dependencies and strip away things that are unused”** — fewer packages = faster installs, smaller builds, smaller attack surface (a real cybersecurity benefit: every dependency is potential supply-chain risk).

-----

## 3. Customizing Agents for Your Codebase

The big distinction here is **Rules vs. Skills** — both are markdown, but they load differently.

### 3.1 Rules — *Static Context*

Always loaded into the agent’s context. The agent sees them on every task.

|Property    |Detail                                                               |
|------------|---------------------------------------------------------------------|
|Format      |Markdown files, checked into git                                     |
|Loading     |**Static** — always present                                          |
|Best for    |Build/test commands, code conventions, pointers to canonical examples|
|Style       |Short, specific, point to real examples in your codebase             |
|Anti-pattern|Too many rules → bloated context, diluted attention                  |

- **Analogy:** The laminated card posted at every workstation: “Safety glasses required. Clock in at the blue terminal.” Everyone sees it, all the time, so it must stay short.
- **Example rule file:**
  
  ```markdown
  - Run tests with: pnpm test
  - Build with: pnpm build
  - Follow the component pattern in src/components/Button.tsx
  - Never commit directly to main
  ```
- **“Check rules into git”** — so the whole team (and every agent session) shares the same rules, versioned alongside the code.

### 3.2 Skills — *Dynamic Context*

Specialized knowledge the agent pulls in **only when relevant** to the current task.

|Property   |Detail                                                                         |
|-----------|-------------------------------------------------------------------------------|
|Format     |Markdown file                                                                  |
|Loading    |**Dynamic** — loaded on demand                                                 |
|Can include|Custom assets, scripts the agent can run                                       |
|Best for   |Deep procedures: “how we do database migrations,” “how we generate PDF reports”|

- **Analogy:** Rules = the laminated card everyone always sees. Skills = the binder of detailed manuals on the shelf — you only pull down the “pump repair” manual when you’re repairing a pump.
- **Use case from your own work:** Your HTML→PDF Playwright pattern (print_background=True, file:/// URI, networkidle) is a perfect skill candidate — specialized, only needed sometimes, includes runnable steps.

### 3.3 Workflows (Slash Commands)

Scripted multi-step procedures you trigger with a command.

- **Example:** `/pr` → agent makes a commit, pushes to a branch, and opens a pull request — three steps collapsed into one command.
- **Analogy:** A speed-dial button that chains several actions.

### 3.4 CLI Tools as Agent Capabilities

Any command-line tool on your machine becomes something the agent can use (like it used `psql` earlier). Cursor adds a **plugin system** and **marketplace** so capabilities can be packaged and shared, rather than everyone wiring up tools by hand.

-----

## 4. Built-in Modes & Features (The “Things”)

### Plan Mode

For **before** you build. Instead of generating code immediately, the agent thinks first — and you approve the thinking before any code exists.

**Context:** Cursor’s chat has four modes — **Agent** (default; edits code directly), **Plan** (think first, then build), **Debug** (find root causes), and **Ask** (answers questions, read-only, no modifications). Plan Mode is triggered with **Shift+Tab** from the chat input, and Cursor will also *suggest* it automatically when your prompt sounds like a complex task.

**The loop:**

1. **Researches your codebase** — finds relevant files, reviews docs, builds context before proposing anything
1. **Asks clarifying questions** — often the questions you forgot to ask yourself (“email/password or OAuth?”). Answering these well is the single biggest lever on output quality.
1. **Produces an editable Markdown plan** — complete with file paths, code references, and a to-do list. You can edit it inline, add/remove to-dos, and even send *selected to-dos* to separate agents. Plans can include auto-generated Mermaid diagrams (text-based flowcharts) streamed right into the plan.
1. **Build from the plan** — when you’re satisfied, the agent executes it step by step.

**Plans are files, not chat messages.** They’re saved to disk (home directory by default; “Save to workspace” moves them into your repo). That makes them:

- **Shareable** — teammates review the plan like a design doc
- **Versionable** — check plans into git as a living record of decisions
- **Reusable** — a refined plan becomes documentation for how the feature was built

**The killer workflow — fix the plan, not the code:** If the agent builds something that doesn’t match what you wanted, *don’t* try to patch it with follow-up prompts. Revert the changes, refine the plan to be more specific, and run it again. This is usually faster than steering a half-wrong implementation and produces cleaner results.

- **Analogy:** Blueprints before construction. Erasing a wall on a blueprint costs nothing; moving a built wall costs thousands. Plan Mode keeps you in the blueprint phase until the design is right — and the “fix the plan” workflow is the equivalent of redrawing the blueprint instead of jackhammering the foundation.
- **When to skip it:** Quick changes or tasks you’ve done many times — jumping straight to Agent mode is fine. Plan Mode earns its overhead on multi-file features, not one-line fixes.
- **Use case from your own work:** “Add a Pbps tier to the speed-test bar” probably doesn’t need a plan. “Refactor the tick-mark system to support arbitrary unit scales and add tests” does — multiple files, design decisions, and edge cases worth surfacing *before* code exists.
- **Why it matters:** Cursor reports that most new features at Cursor itself now begin with the agent writing a plan, and that this measurably improves the generated code. The clarifying-questions step also surfaces blind spots early — cheap insurance against rework.

### Debug Mode

For **when something’s broken and reading the code isn’t enough**. Shipped in Cursor 2.2 (Dec 2025), it’s an agent loop built around **runtime evidence and human verification** — instead of guessing a fix from static code, the agent watches what your code *actually does* when the bug happens.

**The core insight:** many bugs aren’t visible in the source. A race condition, a memory leak, an intermittent failure — these require seeing what the code does at runtime, not what it looks like it should do. Debug Mode bridges that gap.

**The loop, in detail:**

1. **Explore & hypothesize** — You describe the bug in as much detail as possible. The agent reads relevant files and generates *multiple* hypotheses — some you’d have thought of, others you likely wouldn’t.
1. **Instrument your code** — The agent inserts logging statements specifically designed to test those hypotheses (which variables to watch, which code paths to trace).
1. **You reproduce the bug** — The agent gives you specific steps and asks *you* to trigger the bug. This keeps a human in the loop and captures real runtime behavior while the agent listens.
1. **Analyze the logs** — The agent now sees variable states, execution paths, and timing information at the moment of failure. Evidence confirms or kills each hypothesis.
1. **Targeted fix** — Often just a few lines, aimed at the actual root cause.
1. **Verify & clean up** — You re-run the reproduction steps. Once you confirm the fix, the agent removes all its instrumentation. If you say it’s *not* fixed, it refines hypotheses and loops again.

**How it works under the hood:** the instrumentation is just plain-text logs — the agent adds HTTP log requests (or file writes, depending on the language), and Cursor spins up a local server to listen to them as you reproduce. No fancy debugger machinery — and that’s the point: LLMs are extremely good at parsing text, so textual runtime logs are exactly the evidence format they reason over best. It even works across client↔server boundaries — logging both frontend and backend to untangle the *order of events* causing a bug.

**When to use it (per Cursor’s docs):**

- Bugs you can reproduce but can’t figure out
- Race conditions and timing/async issues
- Performance problems and memory leaks
- Regressions — tracing what changed when something used to work

**When NOT to use it:** straightforward errors with clear stack traces — regular Agent mode (paste the full error) is faster. Debug Mode is for when you’ve tried the obvious fixes and they didn’t work.

**Honest tradeoffs (from hands-on reviews):** it requires *manual* reproduction every cycle, and in compiled environments each round means re-instrumenting, rebuilding, and restarting — a “log-and-restart” loop with real friction. It shines on reproducible logic bugs; it can’t help with bugs you can’t trigger on demand (which loops back to Debugging Fundamentals #1: reproduce first).

- **Analogy:** It’s the difference between a mechanic guessing from your description (“it makes a clunking sound”) and hooking the car up to a diagnostic computer while *you* drive it around the block. The sensors capture what’s actually happening at the moment of failure.
- **Networking tie-in from your own work:** This is exactly the philosophy of your ping monitoring scripts — you don’t guess why the connection drops; you log per-packet RTT with timestamps and read the evidence. Debug Mode applies that same instrument-then-observe discipline to application code.
- **Theme connection:** Notice the loop is Debugging Fundamentals (§5) automated — hypotheses, instrumentation, reproduction, evidence, fix, regression prevention. The fundamentals didn’t change; the agent just executes them faster.

### Design Mode

For **visual/UI work**. A visual editing layer inside Cursor’s built-in browser: you interact with your *running app* directly, and an agent converts what you did into real, reviewable code.

**The problem it solves:** the hardest part of AI-assisted UI work is *telling the agent which element you mean*. Typing “make the third card’s padding match the second one” often gets the wrong component edited. Design Mode replaces that text description with direct visual reference — pointing beats describing.

**How it works (the loop):**

1. Run your app locally (e.g., `npm run dev`) and open it in Cursor’s built-in browser
1. Select what you want changed — by clicking, drawing, or speaking
1. Tweak visually (sidebar style controls) or describe the change
1. **Apply** — the agent rewrites the underlying source code to match, and hot reload shows the result

That Apply step is the key innovation. Tweaking CSS in browser DevTools has existed for a decade, but those changes evaporated on refresh. Here they become real code in your repo.

**Ways to give the agent visual context:**

- **Point and prompt** — click an element, then describe the change in words (“make this heading bigger”). The agent gets the element’s identity, code, and surrounding layout — not just your words.
- **Visual inspector + sidebar** — DevTools-style panel for directly adjusting styles (margins, padding, borders) and component props with sliders and controls.
- **Multi-select** — click two or more elements together; the agent sees all of them plus their visual relationships. Use case: “make this card match that one’s styling” or “adjust this group of buttons at once.”
- **Draw on screen** — box or highlight a region to direct the agent’s attention to an area rather than a single element.
- **Voice input** — narrate changes through the overlay. The mic stays live *while an agent is mid-run*, so you can queue the next change by voice without waiting.
- **Analogy:** Telling a contractor “move the cabinet 6 inches left” over the phone vs. standing in the kitchen and pointing at it. Same request — radically less ambiguity. Design Mode lets you stand in the kitchen.
- **Use case from your own work:** Your speed-test fill bar is a perfect fit — click the bar, say “make the tick labels smaller and move the unit display above the bar,” watch it update live, and the agent edits your actual component code.
- **Practical cautions (from early adopters):**
  - Work on a **new git branch** — visual editing can get wonky fast, and undo doesn’t always behave as expected. Git is your real undo.
  - It sits on top of your local environment: repo cloned, dependencies installed, env vars set, dev server running. If the app won’t boot, Design Mode can’t help.
- **Brief history (why sources conflict):** shipped as the “Visual Editor” in Cursor 2.2 (Dec 2025), renamed and formalized as **Design Mode** in Cursor 3 (April 2026), with multi-select and voice input added in Cursor 3.7 (June 5, 2026).
- **Theme connection:** Design Mode is the *feedback loop* principle (§2.1) applied to UI — see the change instantly in a live browser instead of editing code, switching windows, and refreshing. Two loops in one: a visual loop (adjust, see update) and a code loop (agent edits repo, hot reload shows reality).

### Bugbot

An automated reviewer that scans your GitHub PRs and flags likely bugs before a human reviews. A tireless first-pass reviewer that catches the obvious stuff so humans can focus on design and logic.

-----

## 5. Debugging Fundamentals (Agent or No Agent)

These are timeless — they predate AI and make agents dramatically more effective:

1. **Reproduce the issue** — If you can’t trigger it on demand, you can’t verify a fix. (Same as network troubleshooting: an intermittent packet-loss report is useless until you can reproduce it — which is exactly why your ping scripts log timestamps.)
1. **Reduce to a minimal case** — Strip away everything until the smallest possible code still shows the bug.
1. **Isolate variables** — Change one thing at a time, like a controlled experiment.
1. **Form specific hypotheses** — “The crash happens because X is null when Y” — testable, not vague.
1. **Instrument your code** — Add logging/metrics to gather evidence.
1. **Prevent regressions with tests** — Lock the fix in place forever.

-----

## 6. Code Review with Agents

- **“Find issues” button** — agent scans the diff for problems.
- **“Fix with agent” button** — one click sends a flagged issue straight to the agent to resolve.
- **Peer review prep** — Example prompt: *“Take my working changes and break these down into smaller, more semantic commits, then push this change and create a new PR for me.”*
  - **Why “semantic commits” matter:** one giant commit named “fixes” is unreviewable. Small commits, each doing one logical thing (“add tick-mark calculation,” “add unit-switching,” “add tests”), let reviewers follow your reasoning step by step.

-----

## 7. High-Level Changes (Big Codebase-Wide Tasks)

Tasks agents handle well because they’re broad, mechanical, and measurable:

- **Speeding up your test suite** — find and fix slow tests
- **Trimming your dependency tree** — remove unused packages
- **Optimizing your CI pipeline** — cache dependencies, parallelize jobs
- **Making type checking faster** — fix patterns that slow the type checker
- **Reducing build times** — measure, find bottlenecks, fix

Common thread: all have an objective metric (seconds, package count), so the agent can verify its own improvement — back to fast feedback loops.

-----

## 8. The Five-Step Cursor Workflow (Putting It Together)

1. **Understand the codebase** — Ask the agent to explain architecture, find relevant files, map how features work.
1. **Plan the feature** — Use Plan mode; answer clarifying questions; refine the plan before code exists. *(For UI features, follow the plan with Design Mode: build the rough version, then point, draw, or speak to refine it visually.)*
1. **Debug a failing edge case** — Use Debug mode; hypotheses → instrumentation → reproduce → targeted fix.
1. **Review and test** — Agent writes tests using existing infrastructure; Bugbot + “Find issues” on the PR; you ask the root-cause and edge-case questions.
1. **Write a rule** — Capture what you learned (commands, conventions, gotchas) as a rule so the *next* agent session starts smarter.

> **The meta-pattern:** Step 5 feeds back into Step 1. Each cycle, your rules/skills grow and the agent gets more effective on *your* codebase — compound interest on your setup work.