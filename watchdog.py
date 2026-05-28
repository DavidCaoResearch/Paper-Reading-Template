#!/usr/bin/env python
"""Process pending papers in 原始文献/ and exit.

Usage:
    conda activate your-env && python watchdog.py          # one-shot: scan, process, exit
    conda activate your-env && python watchdog.py --watch  # continuous watch mode

One-shot mode (default) is the recommended workflow:
  1. Drop one or more PDFs into 原始文献/
  2. Run `python watchdog.py`
  3. All pending papers are processed and the script exits
  4. Check watchdog.log for results

Papers are identified by SHA256 content hash — two papers named "main.pdf"
are correctly treated as distinct. The extracted PDF title is shown in the
progress display.
"""

import sys
import time
import json
import shutil
import hashlib
import subprocess
import logging
import threading
import itertools
from pathlib import Path

import PyPDF2

PROJECT_ROOT = Path(__file__).resolve().parent
WATCH_DIR = PROJECT_ROOT / "原始文献"
STATE_FILE = PROJECT_ROOT / ".processed_papers.json"
LOG_FILE = PROJECT_ROOT / "watchdog.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
logger = logging.getLogger("watchdog")

CLAUDE_PATH = shutil.which("claude")
if not CLAUDE_PATH:
    logger.error("claude CLI not found in PATH. Install: npm i -g @anthropic-ai/claude-code")
    sys.exit(1)

# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------

_READ_BUF = 2 ** 20  # 1 MiB

read_buf = 2 ** 20


def file_hash(path: Path) -> str:
    """SHA256 of file contents — used as stable paper identity."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(_READ_BUF)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def extract_title(path: Path) -> str:
    """Try to get the paper title from PDF metadata, then first-page text.

    Returns a cleaned title string, or falls back to the filename stem.
    """
    try:
        reader = PyPDF2.PdfReader(str(path))

        # 1) PDF metadata title
        meta = reader.metadata
        if meta and meta.title:
            t = meta.title.strip()
            if len(t) > 10 and not t.startswith("untitled"):
                return _clean_title(t)

        # 2) First page text — take the first few meaningful lines as candidate
        if reader.pages:
            text = reader.pages[0].extract_text()
            if text:
                title = _guess_title_from_text(text)
                if title:
                    return title

    except Exception as e:
        logger.warning("Title extraction failed for %s: %s", path.name, e)

    # 3) Fallback — use filename stem
    return path.stem


def _guess_title_from_text(text: str) -> str | None:
    """Heuristic: first lines of the first page are often the title.

    Skips lines that are too short, look like author names (email addresses),
    or are pure metadata (DOI, ISSN, copyright notices).
    """
    lines = text.strip().splitlines()
    candidates = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Skip obvious non-title lines
        low = stripped.lower()
        if any(
            keyword in low
            for keyword in (
                "@", "doi", "issn", "isbn", "copyright", "©", "http",
                "all rights reserved", "published", "conference", "proceedings",
                "abstract", "keywords", "introduction",
            )
        ):
            continue
        if len(stripped) < 15:
            continue  # too short — likely page number / header
        candidates.append(stripped)

    if not candidates:
        return None

    # Join first 2-3 lines as the title
    return _clean_title(" ".join(candidates[:3]))


def _clean_title(raw: str) -> str:
    """Normalize a title string: collapse whitespace, remove line-breaks,
    strip trailing punctuation, limit length."""
    t = " ".join(raw.split())
    # Remove common trailing garbage
    t = t.rstrip(".,;:-‐–— ")
    # Truncate if excessively long (>200 chars probably isn't just a title)
    if len(t) > 200:
        t = t[:197] + "..."
    # Windows filename: replace illegal characters
    for ch in r'<>:"/\|?*':
        t = t.replace(ch, "-")
    return t


# ---------------------------------------------------------------------------
# Live progress: spinner + ticking elapsed time during subprocess
# ---------------------------------------------------------------------------


def _ticker(prefix: str, name: str, evt_running: threading.Event, start: float):
    spinner = itertools.cycle("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
    while evt_running.is_set():
        elapsed = int(time.time() - start)
        m, s = divmod(elapsed, 60)
        timer = f"{m}m {s}s" if m else f"{s}s"
        # Truncate displayed title to ~50 chars to keep it on one line
        display = name if len(name) <= 52 else name[:49] + "..."
        print(f"\r  {next(spinner)} {prefix}{display}  {timer}", end="", flush=True)
        time.sleep(0.1)


class Progress:
    """Thread-safe live progress with spinner + ticking elapsed time."""

    def __init__(self, prefix: str, name: str):
        self.prefix = prefix
        self.name = name
        self._start = 0.0
        self._thread: threading.Thread | None = None
        self._running = threading.Event()

    def __enter__(self):
        self._start = time.time()
        self._running.set()
        self._thread = threading.Thread(
            target=_ticker,
            args=(self.prefix, self.name, self._running, self._start),
            daemon=True,
        )
        self._thread.start()
        return self

    def __exit__(self, *args):
        self._running.clear()
        if self._thread:
            self._thread.join(timeout=0.5)

    def finish(self, success: bool):
        elapsed = time.time() - self._start
        m, s = divmod(int(elapsed), 60)
        timer = f"{m}m {s}s" if m else f"{s}s"
        mark = "✓" if success else "✗"
        display = self.name if len(self.name) <= 52 else self.name[:49] + "..."
        print(f"\r  {mark} {self.prefix}{display}  {timer}", flush=True)


# ---------------------------------------------------------------------------
# State management — keyed by SHA256 content hash
# ---------------------------------------------------------------------------


def load_state() -> dict:
    """Return state dict. Format: {"processed": {"<sha256>": {"file": "...", "title": "..."}}}"""
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("Corrupted state file, starting fresh")
    return {"processed": {}}


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# Paper scanning & processing
# ---------------------------------------------------------------------------


def is_stable(path: Path, wait: float = 2.0, checks: int = 3) -> bool:
    prev_size = -1
    for _ in range(checks):
        if not path.exists():
            return False
        current_size = path.stat().st_size
        if current_size == prev_size and current_size > 0:
            return True
        prev_size = current_size
        time.sleep(wait / checks)
    return False


def scan_pdfs() -> list[Path]:
    """Return all top-level PDFs in the watch directory."""
    pdfs = []
    try:
        for item in sorted(WATCH_DIR.iterdir()):
            if item.is_file() and item.suffix.lower() == ".pdf":
                pdfs.append(item)
    except FileNotFoundError:
        pass
    return pdfs


def process_paper(pdf_path: Path, *, idx: int = 1, total: int = 1) -> tuple[bool, str]:
    """Extract title, invoke claude, return (success, title)."""
    # Extract title early — after claude moves the PDF this won't be possible
    title = extract_title(pdf_path)
    logger.info("(%s) Identified as: %s", pdf_path.name, title)

    prompt = (
        f"Process the new paper at {pdf_path.relative_to(PROJECT_ROOT)} "
        "following the complete CLAUDE.md workflow (§1–§5): "
        "create subfolder, read paper, write structured notes.md with English quotations, "
        "determine classifications and create symlinks, update master index, "
        "commit with 'add:' prefix, push, and append changelog. "
        "Do everything in one shot without asking for confirmation."
    )

    label = f"[{idx}/{total}] " if total > 1 else ""

    with Progress(label, title) as prog:
        try:
            result = subprocess.run(
                [CLAUDE_PATH, "-p", prompt, "--permission-mode", "bypassPermissions"],
                cwd=str(PROJECT_ROOT),
                capture_output=True,
                text=True,
                timeout=900,
            )
            ok = result.returncode == 0
            if not ok:
                logger.error("Failed: %s — %s", title, result.stderr[:800])
            prog.finish(ok)
            return ok, title
        except subprocess.TimeoutExpired:
            logger.error("Timeout: %s", title)
            prog.finish(False)
            return False, title


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------


def run_one_shot():
    state = load_state()
    all_pdfs = scan_pdfs()

    # Filter out already-processed (by content hash)
    pending: list[Path] = []
    for p in all_pdfs:
        if not is_stable(p):
            continue
        h = file_hash(p)
        if h in state["processed"]:
            logger.info("Skipping already processed: %s (hash %s)", p.name, h[:8])
            continue
        pending.append(p)

    if not pending:
        print("No pending papers. Nothing to do.")
        return

    total = len(pending)
    print(f"\nFound {total} pending paper(s):")
    for p in pending:
        title = extract_title(p)
        print(f"  - {p.name}  →  \"{title}\"")

    ok = fail = 0
    for i, pdf_path in enumerate(pending, start=1):
        h = file_hash(pdf_path)
        success, title = process_paper(pdf_path, idx=i, total=total)
        if success:
            state["processed"][h] = {"file": pdf_path.name, "title": title}
            save_state(state)
            ok += 1
        else:
            fail += 1

    print(f"\nDone. {ok} succeeded, {fail} failed.\n")


def run_watch():
    state = load_state()

    # Startup scan
    all_pdfs = scan_pdfs()
    pending = []
    for p in all_pdfs:
        if not is_stable(p):
            continue
        h = file_hash(p)
        if h in state["processed"]:
            continue
        pending.append(p)

    if pending:
        total = len(pending)
        print(f"\nStartup scan: {total} pending paper(s)")
        for i, pdf_path in enumerate(pending, start=1):
            h = file_hash(pdf_path)
            success, title = process_paper(pdf_path, idx=i, total=total)
            if success:
                state["processed"][h] = {"file": pdf_path.name, "title": title}
                save_state(state)

    print("Watching for new files (Ctrl+C to stop)...")
    logger.info("Watch mode active. Polling every 5s.")

    # Track known hashes to avoid re-processing
    known_hashes = set(state["processed"].keys())

    try:
        while True:
            for pdf_path in scan_pdfs():
                if not pdf_path.exists():
                    continue
                h = file_hash(pdf_path)
                if h in known_hashes:
                    continue
                if not is_stable(pdf_path):
                    continue
                known_hashes.add(h)
                success, title = process_paper(pdf_path)
                if success:
                    state["processed"][h] = {"file": pdf_path.name, "title": title}
                    save_state(state)

            time.sleep(5)

    except KeyboardInterrupt:
        print("\nShutting down.")


def main():
    watch = "--watch" in sys.argv or "-w" in sys.argv
    mode = "continuous watch" if watch else "one-shot"

    logger.info("=== Paper Watchdog (%s) ===", mode)
    logger.info("Target: %s", WATCH_DIR)

    if watch:
        run_watch()
    else:
        run_one_shot()

    logger.info("Exit.")


if __name__ == "__main__":
    main()
