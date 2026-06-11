"""Terminal block metadata for cursor-integration-guide HTML."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import Callable

# Diagram colors shared by per-block flow SVGs and the global command map.
_DIAGRAM_LINE = "#b1bac4"
_DIAGRAM_LINE_FADED = "#b1bac499"

TOUCH_CATEGORIES: dict[str, tuple[str, str]] = {
    "command": ("Command / script", "#c4b3ff"),
    "repo-tracked": ("Tracked repo files (git)", "#9bd4ff"),
    "repo-local": ("Local only (gitignored)", "#9bffcb"),
    "github": ("GitHub (remote)", "#ffd4a3"),
    "runtime": ("Running app / browser", "#ffb3b3"),
    "external": ("External tools / network", "#9bd4ff"),
    "info": ("Concept / read-only", "#b8c0cc"),
}

_META_RULES: list[tuple[Callable[[str, str], bool], "TerminalMeta"]] = []


@dataclass(frozen=True)
class FlowNode:
    node_id: str
    label: str
    category: str


@dataclass(frozen=True)
class TerminalMeta:
    chrome_title: str
    summary: str
    details: str
    invokes: list[str] = field(default_factory=list)
    touches: list[tuple[str, str]] = field(default_factory=list)
    flow: list[FlowNode] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)


def _register(pattern: str, lang: str, meta: TerminalMeta) -> None:
    def predicate(code: str, block_lang: str) -> bool:
        if lang != "*" and block_lang != lang:
            return False
        return bool(re.search(pattern, code, re.MULTILINE | re.IGNORECASE))

    _META_RULES.append((predicate, meta))


def normalize_block_code(code: str) -> str:
    return "\n".join(line.rstrip() for line in code.replace("\r\n", "\n").strip().splitlines())


def match_terminal_meta(code: str, lang: str) -> TerminalMeta:
    normalized = normalize_block_code(code)
    for predicate, meta in _META_RULES:
        if predicate(normalized, lang):
            return meta
    default_label = "PowerShell" if lang in {"powershell", "ps1", "pwsh", "shell", "bash", "sh"} else "Terminal"
    return TerminalMeta(default_label, "Command block from the integration guide.", "See surrounding sections.")


def _html_list_items(items: list[str]) -> str:
    return "".join(f"<li>{html.escape(item)}</li>" for item in items)


def render_touch_chips(touches: list[tuple[str, str]]) -> str:
    chips: list[str] = []
    for category, label in touches:
        name, color = TOUCH_CATEGORIES.get(category, ("Other", "#b8c0cc"))
        chips.append(
            f'<span class="term-touch-chip" style="--chip-color:{color}" title="{html.escape(name)}">'
            f"{html.escape(label)}</span>"
        )
    return "".join(chips)


def render_flow_svg(flow: list[FlowNode], diagram_id: str) -> str:
    if not flow:
        return ""

    box_w, box_h, gap, pad = 118, 36, 28, 12
    width = pad * 2 + len(flow) * box_w + max(0, len(flow) - 1) * gap
    height = box_h + pad * 2 + 18
    parts = [
        f'<svg class="term-flow-svg" viewBox="0 0 {width} {height}" role="img">',
        f'<defs><marker id="{diagram_id}-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">'
        f'<path d="M0,0 L8,3 L0,6 Z" fill="{_DIAGRAM_LINE}"/></marker></defs>',
    ]

    x, y = pad, pad + 8
    for index, node in enumerate(flow):
        _, color = TOUCH_CATEGORIES.get(node.category, ("", "#b1bac4"))
        label = html.escape(node.label if len(node.label) <= 22 else node.label[:20] + "…")
        parts.append(
            f'<rect x="{x}" y="{y}" width="{box_w}" height="{box_h}" rx="6" '
            f'fill="{color}22" stroke="{color}" stroke-width="1.2"/>'
        )
        parts.append(
            f'<text x="{x + box_w / 2}" y="{y + box_h / 2 + 4}" text-anchor="middle" '
            f'class="term-diagram-label">{label}</text>'
        )
        if index < len(flow) - 1:
            arrow_x, mid_y = x + box_w + 4, y + box_h / 2
            parts.append(
                f'<line x1="{arrow_x}" y1="{mid_y}" x2="{arrow_x + gap - 8}" y2="{mid_y}" '
                f'stroke="{_DIAGRAM_LINE}" stroke-width="1.4" '
                f'marker-end="url(#{diagram_id}-arrow)"/>'
            )
        x += box_w + gap

    parts.append("</svg>")
    return "\n".join(parts)


def render_term_info_html(meta: TerminalMeta, term_id: str) -> tuple[str, str]:
    deps_section = ""
    if meta.dependencies:
        deps_section = (
            f'<div class="term-info-section"><h5>Dependencies</h5>'
            f'<ul class="term-info-list term-deps-list">{_html_list_items(meta.dependencies)}</ul></div>'
        )

    legend = "".join(
        f'<span class="term-legend-item"><span class="term-legend-swatch" style="background:{color}"></span>'
        f"{html.escape(name)}</span>"
        for name, color in TOUCH_CATEGORIES.values()
    )

    chrome = f"""
<button type="button" class="term-info-btn" aria-label="About this command block" data-term-dialog="{term_id}-dialog" title="What does this touch?">i</button>
<dialog id="{term_id}-dialog" class="term-info-dialog">
  <div class="term-info-header">
    <h4 class="term-info-title">{html.escape(meta.chrome_title)}</h4>
    <button type="button" class="term-info-close" aria-label="Close">&times;</button>
  </div>
  <p class="term-info-summary">{html.escape(meta.summary)}</p>
  <p class="term-info-details">{html.escape(meta.details)}</p>
  {deps_section}
  <div class="term-info-section"><h5>Invokes / uses</h5><ul class="term-info-list">{_html_list_items(meta.invokes)}</ul></div>
  <div class="term-info-section"><h5>Touches</h5><div class="term-touch-chips">{render_touch_chips(meta.touches)}</div></div>
  <div class="term-info-section"><h5>Flow</h5>{render_flow_svg(meta.flow, term_id + "-flow")}<div class="term-legend">{legend}</div></div>
</dialog>"""

    deps_inline = ""
    if meta.dependencies:
        deps_inline = (
            f'<p class="term-info-deps-inline"><span class="term-info-deps-label">Requires:</span> '
            f'{html.escape("; ".join(meta.dependencies))}</p>'
        )

    inline = (
        f'<div class="term-info-inline" aria-hidden="true"><strong>{html.escape(meta.summary)}</strong>'
        f"{deps_inline}"
        f'<div class="term-touch-chips">{render_touch_chips(meta.touches)}</div></div>'
    )
    return chrome, inline


def build_global_command_map_html() -> str:
    return _GLOBAL_MAP


def make_terminal_meta(
    title: str,
    summary: str,
    details: str,
    invokes: list[str],
    touches: list[tuple[str, str]],
    flow_labels: list[tuple[str, str]],
    dependencies: list[str] | None = None,
) -> TerminalMeta:
    flow = [FlowNode(f"n{index}", label, category) for index, (label, category) in enumerate(flow_labels)]
    return TerminalMeta(title, summary, details, invokes, touches, flow, dependencies or [])


# Backward-compatible alias for rule registration blocks below.
_m = make_terminal_meta


_GLOBAL_MAP = f"""
<details class="guide-cmd-map" id="command-resource-map">
  <summary class="guide-cmd-map-summary">
    <span class="guide-nav-chevron" aria-hidden="true"></span>
    <span>Command resource map</span>
    <span class="guide-cmd-map-hint">Local files vs GitHub — overview</span>
  </summary>
  <div class="guide-cmd-map-body">
    <p class="guide-cmd-map-intro">Each terminal block has an <strong>i</strong> button in its title bar with full detail and a flow diagram. This map summarizes major scripts.</p>
    <div class="guide-cmd-map-grid">
      <article class="guide-cmd-card"><h4>build.ps1</h4><p>Compiles ConnectWatch.exe from Go + embedded web UI.</p>
        <p class="guide-cmd-deps"><strong>Requires:</strong> Go 1.22+, PowerShell 5.1+</p>
        <div class="term-touch-chips"><span class="term-touch-chip" style="--chip-color:#9bd4ff">internal/**</span><span class="term-touch-chip" style="--chip-color:#9bffcb">ConnectWatch.exe</span></div></article>
      <article class="guide-cmd-card"><h4>update-and-run.ps1</h4><p>Stop → build/test → start tray app.</p>
        <p class="guide-cmd-deps"><strong>Requires:</strong> Go 1.22+, PowerShell 5.1+</p>
        <div class="term-touch-chips"><span class="term-touch-chip" style="--chip-color:#9bffcb">exe, data/, config.yaml</span><span class="term-touch-chip" style="--chip-color:#ffb3b3">:8080 / browser</span></div></article>
      <article class="guide-cmd-card"><h4>release.ps1</h4><p>Version bump, push, GitHub Release.</p>
        <p class="guide-cmd-deps"><strong>Requires:</strong> Go 1.22+, Git, GitHub CLI (gh auth login)</p>
        <div class="term-touch-chips"><span class="term-touch-chip" style="--chip-color:#9bd4ff">update-manifest.json</span><span class="term-touch-chip" style="--chip-color:#ffd4a3">GitHub Release</span><span class="term-touch-chip" style="--chip-color:#b8c0cc">Not README</span></div></article>
      <article class="guide-cmd-card"><h4>setup-github-project.ps1</h4><p>Project #3, labels, fields.</p>
        <p class="guide-cmd-deps"><strong>Requires:</strong> GitHub CLI + project scope (gh auth refresh …)</p>
        <div class="term-touch-chips"><span class="term-touch-chip" style="--chip-color:#ffd4a3">GitHub Project #3</span><span class="term-touch-chip" style="--chip-color:#b8c0cc">Not README / not app/</span></div></article>
      <article class="guide-cmd-card"><h4>sync-integration-guide.ps1</h4><p>Guide fingerprint + PDF/HTML.</p>
        <p class="guide-cmd-deps"><strong>Requires:</strong> PowerShell; PDF: Python 3 + pip markdown + Microsoft Edge</p>
        <div class="term-touch-chips"><span class="term-touch-chip" style="--chip-color:#9bd4ff">.cursor/, CI, scripts/</span><span class="term-touch-chip" style="--chip-color:#9bffcb">docs/notes/</span></div></article>
      <article class="guide-cmd-card"><h4>Playwright npm test</h4><p>Browser tests vs running app.</p>
        <p class="guide-cmd-deps"><strong>Requires:</strong> Node.js 22+, npm, Chromium (npx playwright install)</p>
        <div class="term-touch-chips"><span class="term-touch-chip" style="--chip-color:#9bd4ff">tests/e2e/</span><span class="term-touch-chip" style="--chip-color:#ffb3b3">Dashboard UI</span></div></article>
    </div>
    <svg class="guide-cmd-map-svg" viewBox="0 0 920 215" role="img" aria-label="Ship path overview">
      <defs><marker id="map-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#b1bac4"/></marker></defs>
      <rect x="30" y="50" width="90" height="30" rx="6" fill="#c4b3ff22" stroke="#c4b3ff"/><text x="75" y="69" text-anchor="middle" class="term-diagram-label">Edit + test</text>
      <line x1="120" y1="65" x2="148" y2="65" stroke="#b1bac4" stroke-width="1.4" marker-end="url(#map-arrow)"/>
      <rect x="150" y="50" width="100" height="30" rx="6" fill="#9bd4ff22" stroke="#9bd4ff"/><text x="200" y="69" text-anchor="middle" class="term-diagram-label">git push / PR</text>
      <line x1="250" y1="65" x2="278" y2="65" stroke="#b1bac4" stroke-width="1.4" marker-end="url(#map-arrow)"/>
      <rect x="280" y="50" width="90" height="30" rx="6" fill="#ffd4a322" stroke="#ffd4a3"/><text x="325" y="69" text-anchor="middle" class="term-diagram-label">GitHub CI</text>
      <line x1="370" y1="65" x2="398" y2="65" stroke="#b1bac4" stroke-width="1.4" marker-end="url(#map-arrow)"/>
      <rect x="400" y="50" width="100" height="30" rx="6" fill="#c4b3ff22" stroke="#c4b3ff"/><text x="450" y="69" text-anchor="middle" class="term-diagram-label">release.ps1</text>
      <line x1="500" y1="65" x2="528" y2="65" stroke="#b1bac4" stroke-width="1.4" marker-end="url(#map-arrow)"/>
      <rect x="530" y="50" width="90" height="30" rx="6" fill="#ffd4a322" stroke="#ffd4a3"/><text x="575" y="69" text-anchor="middle" class="term-diagram-label">Release</text>
      <rect x="150" y="110" width="120" height="28" rx="6" fill="#9bffcb22" stroke="#9bffcb"/><text x="210" y="128" text-anchor="middle" class="term-diagram-label-sm">ConnectWatch.exe</text>
      <rect x="300" y="110" width="110" height="28" rx="6" fill="#9bffcb22" stroke="#9bffcb"/><text x="355" y="128" text-anchor="middle" class="term-diagram-label-sm">data/ logs</text>
      <rect x="440" y="110" width="120" height="28" rx="6" fill="#ffd4a322" stroke="#ffd4a3"/><text x="500" y="128" text-anchor="middle" class="term-diagram-label-sm">GitHub Project #3</text>
      <rect x="590" y="110" width="100" height="28" rx="6" fill="#9bffcb22" stroke="#9bffcb"/><text x="640" y="128" text-anchor="middle" class="term-diagram-label-sm">docs/notes</text>
      <text x="460" y="188" text-anchor="middle" class="term-diagram-caption">Dashed lines = optional / parallel touch points (not every command hits all)</text>
      <line x1="200" y1="80" x2="210" y2="110" stroke="{_DIAGRAM_LINE_FADED}" stroke-width="1.4" stroke-dasharray="5 4"/>
      <line x1="450" y1="80" x2="500" y2="110" stroke="{_DIAGRAM_LINE_FADED}" stroke-width="1.4" stroke-dasharray="5 4"/>
    </svg>
  </div>
</details>
"""


_register("sync-integration-guide", "powershell", _m(
    "Guide sync & dev loop",
    "Check guide staleness, regen PDF/HTML, or run app with guide reminder.",
    "Fingerprints .cursor/, scripts/, CI, e2e, build scripts. -RegeneratePdf uses Python + Edge. Does not push to GitHub.",
    ["sync-integration-guide.ps1", "build-integration-guide-pdf.py", "update-and-run.ps1"],
    [("repo-tracked", ".cursor/, scripts/, CI, tests/e2e/"), ("repo-local", "docs/notes/"), ("runtime", "ConnectWatch.exe (optional)")],
    [("You", "command"), ("sync script", "command"), ("workflow files", "repo-tracked"), ("PDF/HTML", "repo-local")],
    [
        "PowerShell 5.1+ (built into Windows)",
        "Python 3 + pip install markdown (PDF/HTML regen only)",
        "Microsoft Edge (headless PDF print)",
        "Go 1.22+ (only if update-and-run.ps1 rebuilds the exe)",
    ],
))
_register(r"You \+ Cursor", "text", _m(
    "Integration pipeline (concept)",
    "Conceptual Cursor → release path.",
    "Not executable. Shows how local integration connects to GitHub CI and Releases.",
    ["Cursor", "git", "GitHub Actions"],
    [("info", "Concept only"), ("repo-tracked", ".cursor/, scripts/"), ("github", "CI + Releases")],
    [("Cursor", "command"), ("local scripts", "repo-tracked"), ("git push", "github"), ("CI", "github")],
    [
        "Cursor IDE",
        "Git",
        "GitHub account + remote repo",
        "Go 1.22+, PowerShell (local build/test steps)",
        "Node.js 22+ optional locally (CI runs Playwright on GitHub)",
    ],
))
_register("setup-github-project", "powershell", _m(
    "GitHub Projects CLI",
    "Bootstrap Project #3, issues, board items.",
    "Uses gh project scope. Creates labels/fields remotely. Does not edit README or app source.",
    ["gh", "setup-github-project.ps1", "gh issue create"],
    [("github", "Project #3, Issues, labels"), ("info", "README not modified"), ("info", "App folder not modified")],
    [("You", "command"), ("gh CLI", "command"), ("Project #3", "github"), ("Issues", "github")],
    [
        "GitHub CLI (gh) — winget install GitHub.cli",
        "gh auth login + gh auth refresh -h github.com -s project,read:project",
        "PowerShell 5.1+",
    ],
))
_register("gh pr create", "powershell", _m(
    "Git branch & pull request",
    "Branch, test, commit, push, open PR.",
    "Push triggers GitHub Actions. README only if you edit it.",
    ["git", "scripts/test.ps1", "gh pr create"],
    [("repo-tracked", "Branch commits"), ("github", "PR + CI"), ("info", "README if edited")],
    [("branch", "repo-tracked"), ("test.ps1", "command"), ("git push", "github"), ("PR", "github")],
    [
        "Git",
        "Go 1.22+ (scripts/test.ps1 runs go test)",
        "PowerShell 5.1+",
        "GitHub CLI (gh) for gh pr create",
    ],
))
_register(r"scripts\\release", "powershell", _m(
    "Ship release",
    "Version bump, build, push, GitHub Release with exe.",
    "Commits build.ps1 + update-manifest.json. Uploads exe. Does not edit README.",
    ["release.ps1", "build.ps1", "gh release create"],
    [("repo-tracked", "build.ps1, update-manifest.json"), ("repo-local", "ConnectWatch.exe asset"), ("github", "Release + push")],
    [("release.ps1", "command"), ("exe build", "repo-local"), ("manifest", "repo-tracked"), ("GitHub Release", "github")],
    [
        "Go 1.22+",
        "Git",
        "PowerShell 5.1+",
        "GitHub CLI (gh auth login before first release)",
    ],
))
_register("npx playwright", "powershell", _m(
    "Playwright e2e (local)",
    "App in terminal 1; npm test in tests/e2e in terminal 2.",
    "Hits live dashboard on :8080. Installs node_modules locally.",
    ["update-and-run.ps1", "npm", "Playwright"],
    [("repo-tracked", "tests/e2e/"), ("repo-local", "node_modules/"), ("runtime", "App + browser")],
    [("ConnectWatch", "runtime"), ("Playwright", "command"), ("specs", "repo-tracked"), ("UI", "runtime")],
    [
        "Node.js 22+ (includes npm) — https://nodejs.org/ or winget install OpenJS.NodeJS.LTS",
        "npx playwright install chromium (first run)",
        "ConnectWatch running on http://127.0.0.1:8080 (update-and-run.ps1 -Background)",
        "PowerShell 5.1+ (terminal 1)",
    ],
))
_register(r"\\build\.ps1[\s\S]*update-and-run\.ps1.*Background", "powershell", _m(
    "Rebuild after web UI edits",
    "Re-embed internal/server/web into ConnectWatch.exe after HTML/CSS/JS changes.",
    "Runs build.ps1 or update-and-run.ps1 -Background. Requires Ctrl+F5 in browser. Does not touch GitHub or README.",
    ["build.ps1", "update-and-run.ps1"],
    [("repo-tracked", "internal/server/web/*"), ("repo-local", "ConnectWatch.exe"), ("runtime", "Browser (hard refresh)"), ("info", "Not GitHub / not README")],
    [("web source", "repo-tracked"), ("build.ps1", "command"), ("exe", "repo-local"), ("Browser", "runtime")],
    [
        "Go 1.22+",
        "PowerShell 5.1+",
        "Modern browser (Chrome, Edge, Firefox) for dashboard",
    ],
))
_register("internal/server/web", "powershell", _m(
    "Rebuild after web UI edits",
    "Re-embed internal/server/web into exe.",
    "Requires rebuild + Ctrl+F5 in browser.",
    ["build.ps1", "update-and-run.ps1"],
    [("repo-tracked", "internal/server/web/*"), ("repo-local", "ConnectWatch.exe"), ("runtime", "Browser")],
    [("web source", "repo-tracked"), ("build.ps1", "command"), ("exe", "repo-local")],
    ["Go 1.22+", "PowerShell 5.1+", "Browser for hard refresh (Ctrl+F5)"],
))
_register(r"GitHub CLI\\gh", "powershell", _m(
    "GitHub CLI (full path)",
    "Read-only gh when not on PATH.",
    "Queries GitHub API only. No local file changes.",
    ["gh.exe auth status", "gh.exe release list"],
    [("github", "API read-only"), ("info", "Local repo unchanged")],
    [("gh.exe", "command"), ("GitHub API", "github")],
    [
        "GitHub CLI installed (winget install GitHub.cli)",
        "gh auth login (or use full path to gh.exe in a fresh terminal)",
    ],
))
_register("Issue → Project", "text", _m(
    "GitHub Projects workflow (concept)",
    "Issue → board → PR → CI → release.",
    "Conceptual workflow. README not part of this path.",
    ["gh issue", "gh project", "release.ps1"],
    [("github", "Project #3, PRs, CI"), ("info", "README not automatic")],
    [("Issue", "github"), ("Project", "github"), ("PR+CI", "github"), ("release.ps1", "command")],
    [
        "GitHub account + Project #3",
        "GitHub CLI (gh) with project scope",
        "Git + Go 1.22+ for PR/CI/release steps",
    ],
))
_register("127.0.0.1:8080", "text", _m(
    "Dashboard URL",
    "Local dashboard in browser.",
    "Requires running ConnectWatch. Reads config.yaml port and data/network.db via API.",
    ["Browser", "ConnectWatch HTTP"],
    [("repo-local", "config.yaml, data/"), ("runtime", "App + browser")],
    [("Browser", "runtime"), ("ConnectWatch", "runtime"), ("SQLite API", "repo-local")],
    [
        "ConnectWatch.exe running (update-and-run.ps1 or tray app)",
        "Any modern browser",
        "config.yaml web_port (default 8080)",
    ],
))
_register(r"Dropbox\\developement\\ConnectWatch", "powershell", _m(
    "Daily development cheat sheet",
    "Build, full loop, tests only, restart without rebuild.",
    "Local dev only — does not touch GitHub Project or README.",
    ["build.ps1", "update-and-run.ps1", "scripts/test.ps1"],
    [("repo-tracked", "Go source, scripts/"), ("repo-local", "exe, data/, config"), ("runtime", ":8080"), ("info", "Not GitHub/README")],
    [("You", "command"), ("scripts", "command"), ("ConnectWatch.exe", "repo-local"), ("Dashboard", "runtime")],
    [
        "Go 1.22+ — https://go.dev/dl/",
        "PowerShell 5.1+",
        "Git (optional for local-only work)",
        "Node.js 22+ only if you also run tests/e2e locally",
    ],
))

