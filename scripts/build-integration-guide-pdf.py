#!/usr/bin/env python3
"""Build dark-themed PDF of docs/notes/cursor-integration-guide.md."""

from __future__ import annotations

import html
import re
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import markdown
from markdown.extensions.tables import TableExtension

import integration_guide_terminals as term_meta

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parent
SOURCE = ROOT / "docs" / "notes" / "cursor-integration-guide.md"
HTML_OUT = ROOT / "docs" / "notes" / "cursor-integration-guide.html"
PDF_OUT = ROOT / "docs" / "notes" / "cursor-integration-guide.pdf"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
STYLES_PATH = SCRIPTS_DIR / "integration_guide_styles.css"
CLIENT_JS_PATH = SCRIPTS_DIR / "integration_guide_client.js"

PS_FLAG_RE = re.compile(r"^--?[\w?-]+")
URL_IN_TEXT_RE = re.compile(r"(https?://[^\s]+)")
FENCE_PATTERN = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
HEADER_ANCHOR_RE = re.compile(r"^(## .+?) \{#([^}]+)\}\s*$", re.MULTILINE)
EXTERNAL_LINK_RE = re.compile(r'<a href="https?://[^"]*"[^>]*>')

PS_BUILTINS = frozenset({
    "cd", "git", "npm", "npx", "winget", "gh",
    "Get-NetTCPConnection", "python", "pip",
})
PS_OPERATORS = frozenset("|;&")
SHELL_LANGUAGES = frozenset({"powershell", "ps1", "pwsh", "shell", "bash", "sh"})
SCRIPT_EXTENSIONS = (".ps1", ".exe", ".bat", ".cmd")

_terminal_seq = 0


def _load_asset(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"Missing integration guide asset: {path}")
    return path.read_text(encoding="utf-8")


def _next_terminal_id() -> str:
    global _terminal_seq
    _terminal_seq += 1
    return f"term-{_terminal_seq}"


def split_powershell_comment(line: str) -> tuple[str, str | None]:
    """Split a line into command text and an optional trailing # comment."""
    hash_idx = line.find("#")
    if hash_idx >= 0 and (hash_idx == 0 or line[hash_idx - 1].isspace()):
        return line[:hash_idx], line[hash_idx:]
    return line, None


def extract_copyable_lines(code: str) -> list[str]:
    lines: list[str] = []
    for raw in code.splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        command, comment = split_powershell_comment(line)
        command = command.rstrip()
        if command:
            lines.append(command)
        elif comment is None:
            lines.append(line)
    return lines


def build_copy_all_payload(lines: list[str]) -> str:
    if not lines:
        return ""
    if len(lines) == 1:
        return lines[0]
    return "\r\n".join(lines) + "\r\n"


def tokenize_powershell_line(line: str) -> list[str]:
    tokens: list[str] = []
    index = 0
    length = len(line)

    while index < length:
        if line[index].isspace():
            start = index
            while index < length and line[index].isspace():
                index += 1
            tokens.append(line[start:index])
            continue

        if line[index] in "\"'":
            quote = line[index]
            start = index
            index += 1
            while index < length:
                if line[index] == quote and line[index - 1] != "\\":
                    index += 1
                    break
                index += 1
            tokens.append(line[start:index])
            continue

        if line.startswith(("http://", "https://"), index):
            start = index
            while index < length and not line[index].isspace():
                index += 1
            tokens.append(line[start:index])
            continue

        if line[index] in PS_OPERATORS:
            tokens.append(line[index])
            index += 1
            continue

        start = index
        while index < length and not line[index].isspace():
            index += 1
        tokens.append(line[start:index])

    return tokens


def _next_meaningful_token(tokens: list[str], index: int) -> str | None:
    for offset in range(index + 1, len(tokens)):
        if not tokens[offset].isspace():
            return tokens[offset]
    return None


def _first_meaningful_token(tokens: list[str]) -> str | None:
    for token in tokens:
        if not token.isspace():
            return token
    return None


def _classify_token(
    token: str,
    *,
    index: int,
    tokens: list[str],
    first_token: str | None,
    expect_arg: bool,
) -> tuple[str, bool]:
    """Return (css_class, expect_arg_after)."""
    if token.isspace():
        return "ps-ws", expect_arg

    if token in PS_OPERATORS:
        return "ps-op", False
    if token.startswith(("\"", "'")):
        return "ps-string", False
    if token.startswith(("http://", "https://")):
        return "ps-url", False
    if token.startswith((".\\", "./")):
        return "ps-cmd", False
    if "\\" in token and not PS_FLAG_RE.match(token):
        return "ps-path", False

    if PS_FLAG_RE.match(token):
        next_token = _next_meaningful_token(tokens, index)
        takes_arg = (
            next_token is not None
            and next_token not in PS_OPERATORS
            and not PS_FLAG_RE.match(next_token)
        )
        return ("ps-flag" if takes_arg else "ps-switch", takes_arg)

    if expect_arg:
        return "ps-arg", False
    if token in PS_BUILTINS:
        return "ps-builtin", False
    if token is first_token:
        if token.lower().endswith(SCRIPT_EXTENSIONS):
            return "ps-cmd", False
        return "ps-builtin", False
    return "ps-arg", False


def classify_powershell_tokens(tokens: list[str]) -> list[tuple[str, str]]:
    classified: list[tuple[str, str]] = []
    expect_arg = False
    first_token = _first_meaningful_token(tokens)

    for index, token in enumerate(tokens):
        css_class, expect_arg = _classify_token(
            token,
            index=index,
            tokens=tokens,
            first_token=first_token,
            expect_arg=expect_arg,
        )
        classified.append((css_class, token))

    return classified


def render_classified_tokens(classified: list[tuple[str, str]]) -> str:
    parts: list[str] = []
    for css_class, text in classified:
        if css_class == "ps-ws":
            parts.append(html.escape(text))
        else:
            parts.append(f'<span class="{css_class}">{html.escape(text)}</span>')
    return "".join(parts)


def highlight_powershell_code(line: str) -> str:
    if not line.strip():
        return ""
    tokens = tokenize_powershell_line(line)
    return render_classified_tokens(classify_powershell_tokens(tokens))


def wrap_copyable_line(inner_html: str, copy_text: str) -> str:
    if not copy_text.strip():
        if not inner_html.strip():
            return inner_html
        return f'<span class="term-comment-line">{inner_html}</span>'

    escaped_copy = html.escape(copy_text, quote=True)
    return (
        f'<span class="term-line" data-copy="{escaped_copy}" tabindex="0" role="button" '
        f'aria-label="Copy command">{inner_html}</span>'
    )


def _render_highlighted_lines(
    code: str,
    render_line: Callable[[str], tuple[str, str]],
) -> str:
    """Render a code block line-by-line using render_line(line) -> (html, copy_text)."""
    output: list[str] = []
    for raw in code.splitlines():
        line = raw.rstrip()
        if not line.strip():
            output.append("")
            continue
        inner_html, copy_text = render_line(line)
        output.append(wrap_copyable_line(inner_html, copy_text))
    return "\n".join(output)


def _render_powershell_line(line: str) -> tuple[str, str]:
    command, comment = split_powershell_comment(line)
    inner_html = highlight_powershell_code(command)
    if comment:
        inner_html += f'<span class="ps-comment">{html.escape(comment)}</span>'
    return inner_html, command.rstrip()


def _render_plain_text_line(line: str) -> tuple[str, str]:
    escaped = html.escape(line)
    inner_html = URL_IN_TEXT_RE.sub(r'<span class="ps-url">\1</span>', escaped)
    return inner_html, line


def highlight_powershell(code: str) -> str:
    return _render_highlighted_lines(code, _render_powershell_line)


def highlight_text_block(code: str) -> str:
    return _render_highlighted_lines(code, _render_plain_text_line)


GUIDE_NAV: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "Start here",
        [
            ("Overview", "#overview", "What the integration includes"),
            ("Dependencies", "#dependencies", "Install once per machine"),
            ("Manual setup", "#manual-setup", "One-time GitHub & Cursor steps"),
        ],
    ),
    (
        "Cursor in this repo",
        [
            ("Documentation", "#part-1-documentation", "docs/notes reference files"),
            ("Rules", "#part-2-cursor-rules", "Always-on .cursor/rules"),
            ("Skills", "#part-3-cursor-skills", "On-demand .cursor/skills"),
        ],
    ),
    (
        "Build, test, and ship",
        [
            ("Scripts", "#part-4-scripts", "build, test, release, sync"),
            ("CI", "#part-5-ci", "GitHub Actions go-test & e2e"),
            ("Playwright", "#part-6-playwright", "Dashboard browser tests"),
            ("Git & release", "#part-7-git-release", "Exe, manifest, shipping"),
        ],
    ),
    (
        "GitHub workflow",
        [
            ("Projects board", "#part-8-github-projects", "Backlog, labels, automations"),
        ],
    ),
    (
        "Quick reference",
        [
            ("Commands", "#cheat-sheet-commands", "Daily PowerShell cheat sheet"),
            ("Cursor UI", "#cheat-sheet-cursor", "Modes, prompts, browser"),
            ("GitHub UI", "#cheat-sheet-github", "Settings & manual tasks"),
            ("Troubleshooting", "#troubleshooting", "Common problems & fixes"),
            ("Quick map", "#quick-map", "Plan phase to repo file"),
        ],
    ),
]


def build_collapsible_nav_html() -> str:
    groups: list[str] = []
    for title, links in GUIDE_NAV:
        items = "\n".join(
            f'          <li><a href="{html.escape(href)}">'
            f'<span class="guide-nav-link-label">{html.escape(label)}</span>'
            f'<span class="guide-nav-link-desc">{html.escape(desc)}</span>'
            f"</a></li>"
            for label, href, desc in links
        )
        groups.append(
            f"""      <section class="guide-nav-group">
        <h3 class="guide-nav-group-title">{html.escape(title)}</h3>
        <ul class="guide-nav-links">
{items}
        </ul>
      </section>"""
        )

    link_count = sum(len(links) for _, links in GUIDE_NAV)
    return f"""<details id="contents" class="guide-nav" open>
  <summary class="guide-nav-summary">
    <span class="guide-nav-summary-main">
      <span class="guide-nav-chevron" aria-hidden="true"></span>
      <span class="guide-nav-title">Table of contents</span>
    </span>
    <span class="guide-nav-hint">{link_count} sections · click to expand or collapse</span>
  </summary>
  <nav class="guide-nav-body" aria-label="Table of contents">
    <div class="guide-nav-grid">
{chr(10).join(groups)}
    </div>
  </nav>
</details>
"""


def strip_header_anchors(text: str) -> tuple[str, list[str]]:
    header_ids: list[str] = []

    def repl(match: re.Match[str]) -> str:
        header_ids.append(match.group(2))
        return match.group(1)

    return HEADER_ANCHOR_RE.sub(repl, text), header_ids


def inject_h2_ids(html_body: str, header_ids: list[str]) -> str:
    index = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal index
        if index >= len(header_ids):
            return match.group(0)
        tag = f'<h2 id="{header_ids[index]}">{match.group(1)}</h2>'
        index += 1
        return tag

    return re.sub(r"<h2>(.*?)</h2>", repl, html_body, flags=re.DOTALL)


def strip_legacy_contents_html(html_body: str) -> str:
    return re.sub(
        r'<h2 id="contents">Contents</h2>.*?(?=<h2 id="overview">)',
        "",
        html_body,
        count=1,
        flags=re.DOTALL,
    )


def _inject_after_first_marker(html_body: str, injection: str, *markers: str) -> str:
    for marker in markers:
        if marker in html_body:
            return html_body.replace(marker, marker + injection, 1)
    return injection + html_body


def inject_collapsible_nav(html_body: str) -> str:
    html_body = strip_legacy_contents_html(html_body)
    injection = build_collapsible_nav_html() + term_meta.build_global_command_map_html()
    return _inject_after_first_marker(
        html_body,
        injection,
        "<h1>ConnectWatch Cursor integration guide</h1>",
        '<h2 id="overview">',
    )


def externalize_links(html_body: str) -> str:
    def repl(match: re.Match[str]) -> str:
        tag = match.group(0)
        if "target=" in tag:
            return tag
        return tag.replace("<a ", '<a target="_blank" rel="noopener noreferrer" ', 1)

    return EXTERNAL_LINK_RE.sub(repl, html_body)


def _render_copy_controls(term_id: str, copy_lines: list[str]) -> tuple[str, str]:
    if not copy_lines:
        return "", ""

    copy_all = build_copy_all_payload(copy_lines)
    button = (
        f'<button type="button" class="term-copy-all-btn" data-copy-target="{term_id}" '
        f'aria-label="Copy all commands">Copy all</button>'
    )
    store = (
        f'<textarea class="term-copy-store" id="{term_id}-copy-all" hidden readonly>'
        f"{html.escape(copy_all)}</textarea>"
    )
    return button, store


def fence_to_terminal(match: re.Match[str]) -> str:
    lang = (match.group(1) or "text").strip().lower()
    code = match.group(2).replace("\r\n", "\n").strip("\n")
    meta = term_meta.match_terminal_meta(code, lang)

    if lang in SHELL_LANGUAGES:
        body = highlight_powershell(code)
    elif lang == "text":
        body = highlight_text_block(code)
    else:
        body = html.escape(code)

    term_id = _next_terminal_id()
    info_chrome, info_inline = term_meta.render_term_info_html(meta, term_id)
    copy_all_btn, copy_store = _render_copy_controls(term_id, extract_copyable_lines(code))

    return (
        f'<div class="terminal" id="{term_id}" role="group" '
        f'aria-label="{html.escape(meta.chrome_title)}">'
        f"{copy_store}"
        f'<div class="terminal-chrome">'
        f'<span class="terminal-dot red"></span>'
        f'<span class="terminal-dot yellow"></span>'
        f'<span class="terminal-dot green"></span>'
        f'<span class="terminal-title">{html.escape(meta.chrome_title)}</span>'
        f'<span class="terminal-chrome-actions">{copy_all_btn}{info_chrome}</span>'
        f"</div>"
        f'<pre class="terminal-body" tabindex="0"><code>{body}</code></pre>'
        f"{info_inline}"
        f"</div>"
    )


def preprocess_markdown(text: str) -> str:
    return FENCE_PATTERN.sub(fence_to_terminal, text)


def build_html(body: str) -> str:
    styles = _load_asset(STYLES_PATH)
    client_js = _load_asset(CLIENT_JS_PATH)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ConnectWatch Cursor Integration Guide</title>
  <style>
{styles}
  </style>
</head>
<body>
  <main class="page">
    <p class="cover-note">ConnectWatch · Cursor integration operator manual · Dark theme PDF</p>
    {body}
  </main>
  <button type="button" class="return-to-top" id="return-to-top" aria-label="Return to top">
    <span class="return-to-top-icon" aria-hidden="true">↑</span>
    <span>Return to top</span>
  </button>
  <script>
{client_js}
  </script>
</body>
</html>
"""


def markdown_to_html(md: str) -> str:
    global _terminal_seq
    _terminal_seq = 0

    stripped, header_ids = strip_header_anchors(md)
    processed = preprocess_markdown(stripped)
    body = markdown.markdown(processed, extensions=[TableExtension()])
    body = body.replace('<p><div class="terminal"', '<div class="terminal"')
    body = body.replace("</pre></div></p>", "</pre></div>")
    body = inject_h2_ids(body, header_ids)
    body = inject_collapsible_nav(body)
    return build_html(externalize_links(body))


def print_pdf(html_path: Path, pdf_path: Path) -> None:
    if not EDGE.is_file():
        raise FileNotFoundError(f"Microsoft Edge not found at {EDGE}")

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_pdf = pdf_path.with_name(pdf_path.stem + ".tmp.pdf")
    if tmp_pdf.exists():
        tmp_pdf.unlink()

    cmd = [
        str(EDGE),
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--print-to-pdf={tmp_pdf}",
        "--print-to-pdf-no-header",
        html_path.resolve().as_uri(),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0 or not tmp_pdf.is_file():
        raise RuntimeError(
            "Edge PDF export failed.\n"
            f"stdout: {result.stdout}\n"
            f"stderr: {result.stderr}"
        )

    try:
        tmp_pdf.replace(pdf_path)
    except PermissionError:
        fallback = pdf_path.with_name(pdf_path.stem + ".new.pdf")
        tmp_pdf.replace(fallback)
        print(
            f"Could not overwrite locked file: {pdf_path}\n"
            f"Wrote {fallback} instead (close the open PDF and rename or re-run).",
            file=sys.stderr,
        )
        return

    print(f"Wrote {pdf_path}")


def main() -> int:
    if not SOURCE.is_file():
        print(f"Source not found: {SOURCE}", file=sys.stderr)
        return 1

    try:
        md = SOURCE.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"Failed to read source: {exc}", file=sys.stderr)
        return 1

    html_doc = markdown_to_html(md)
    try:
        HTML_OUT.write_text(html_doc, encoding="utf-8")
    except OSError as exc:
        print(f"Failed to write HTML: {exc}", file=sys.stderr)
        return 1
    print(f"Wrote {HTML_OUT}")

    try:
        print_pdf(HTML_OUT, PDF_OUT)
    except (FileNotFoundError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"PDF export skipped: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
