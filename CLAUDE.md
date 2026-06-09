# CLAUDE.md — Paper Reading Automation

## Project Identity

- **Repository**: `git@github.com:DavidCaoResearch/Paper-Reading.git`
- **Core Mission**: Automated reading, classification, and note-taking for academic papers.
- **Language**: All notes and documentation shall be written in Chinese; code/shell/commands in English.

## One-Time Setup (New Device)

Run these once on any new machine to get everything working:

### 1. Clone & Environment

```bash
git clone git@github.com:DavidCaoResearch/Paper-Reading.git
cd Paper-Reading
conda create -n opt python=3.12 -y
conda activate opt
pip install PyPDF2
```

### 2. Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

### 3. Python Dependencies

| Package | Version | Purpose |
|---|---|---|
| `PyPDF2` | ≥3.0 | PDF title extraction & text reading |

Install: `conda activate opt && pip install PyPDF2`

### 4. Windows-Specific Notes

- **Hard links vs symlinks**: Windows requires admin privileges for symbolic links. Use **hard links** (`os.link()` in Python) instead — same deduplication, no elevation needed.
- **Conda activation**: On Windows cmd/PowerShell, run `conda activate opt` as a separate command before `python watchdog.py` (the `&&` chaining only works in Git Bash).
- **Developer Mode**: If you want true symlinks, enable Developer Mode in Windows Settings → Privacy & Security → For Developers.

### 5. Watchdog Permissions

The watchdog invokes `claude -p` with `--permission-mode bypassPermissions`. This is required for automated tool execution (file writes, git commands). The watchdog only runs in directories you trust (your own repo).

## Directory Structure

```
Paper Reading/
├── CLAUDE.md                      # This file (English, canonical)
├── README.md                      # Chinese mirror of CLAUDE.md for cross-check
├── .gitignore
├── watchdog.py                    # Automated paper ingestion trigger
├── 原始文献/                       # Original papers — the single source of truth
│   ├── README.md                  # Master index of all papers by classification
│   └── <Paper Title>/             # One subfolder per paper
│       ├── <Paper Title>.pdf      # The original PDF
│       └── notes.md               # Reading notes (structured, see §Reading Notes)
├── 文献分类/                       # Classification folders — symlinks / hard links to papers
│   ├── <Classification A>/
│   │   └── <Paper Title>.pdf      # Hard link → ../../原始文献/<Title>/<Title>.pdf
│   └── <Classification B>/
│       └── <Paper Title>.pdf
├── 更新日志/
│   └── changelog.md
└── memory/
    └── *.md                       # Persistent cross-device memory files
```

## Workflow

### 1. Ingest a New Paper

When a PDF is added to `原始文献/` (not yet in its own subfolder):

1. Create a subfolder under `原始文献/` named after the paper's title.
2. Move the PDF into that subfolder, renaming it to `<Paper Title>.pdf`.
3. Read the paper's content **thoroughly** — do not skim. Extract all mathematical formulations, algorithm steps, and experimental data.
4. Create `notes.md` in the same subfolder following the §Reading Notes specification.
5. Determine classification(s) — see §Classification.
6. Update the master index at `原始文献/README.md`.
7. Commit and push — see §Commit & Push.

### 2. Classification

For each paper, determine **1–N classification folders** based on:
- The research problem domain (e.g., "Rolling Stock Scheduling")
- The methodology used (e.g., "Branch and Bound", "Reinforcement Learning")
- The sub-problem or context (e.g., "Train Platforming/Shunting")

**Rules:**
- **Reuse existing folders** when a matching classification already exists.
- **Create new folders** when the paper introduces a genuinely new topic/method not yet represented.
- A paper may belong to multiple classifications — create a link in each relevant folder.
- Links point back to the PDF in `原始文献/<Paper Title>/`, avoiding duplicate copies.

**Link creation on Windows — two options:**

| Method | Command | Admin required |
|---|---|---|
| Hard link (default) | `cmd /c mklink /H "link" "target"` or `os.link(target, link)` in Python | No |
| Soft symlink | `cmd /c mklink "link" "target"` | Yes — admin or Developer Mode |

**Default: hard link** (works everywhere, no elevation):
```python
import os
os.link("<source PDF absolute path>", "文献分类/<Classification>/<Paper Title>.pdf")
```

**If you have admin or Developer Mode enabled**, use symlinks instead for path transparency:
```cmd
cmd /c mklink "文献分类\<Classification>\<Paper Title>.pdf" "<full path to source PDF>"
```

Both achieve zero-copy deduplication. Symlinks break if the target is deleted; hard links keep the file alive until the last link is removed.

### 3. Reading Notes Specification (`notes.md`)

Every `notes.md` must be **detailed and specific**, not a high-level summary. Each section must be backed by **direct English quotations from the original paper**.

#### 3.1 核心内容 (Core Content)

##### 研究问题 (Research Problem)
- What exact problem? In what context (tactical/operational, disruption/normal)? Why is it hard?
- Who is the industrial partner / data source?

##### 建模思路 (Modeling Approach)
**Must include with high specificity:**
- **Decision variables**: list key variable families with their mathematical notation and meaning (e.g., `x_t_c ∈ {0,1}` — whether composition c is assigned to trip t)
- **Constraints**: enumerate the main constraint groups with their roles (e.g., composition uniqueness, flow conservation, inventory balance, LIFO ordering)
- **Objective function**: list each term with its weight and penalty meaning — do not just say "weighted sum"
- **Model scale**: number of variables, constraints, unit types, trips, stations — quote exact figures
- **Model type**: MILP, IP, CP, graph-based, column generation, etc. — be explicit

> **Guideline**: After reading this section, a researcher should understand the model's mathematical structure without opening the paper. If the paper has a published MIP formulation, quote the constraint equations.

##### 核心方法论 (Core Methodology)
**Must include with high specificity:**
- Algorithm name, type (exact/heuristic/hybrid), and overall flow
- Key subroutines and their input/output
- Separation/cut generation logic (if decomposition-based)
- Column generation details (pricing problem, dominance rules) if applicable
- Commercial solver used (CPLEX, Gurobi, etc.) and version if stated
- Parameter settings: time limits, MIP gap tolerance, branching rules

> **Guideline**: After reading this section, a researcher should be able to sketch the algorithm's pseudocode.

##### 案例规模 (Case Study Scale)
**Must include specific numbers:**
- Instance count, source (real/artificial), timetable period
- Fleet size, unit types, depot count, station count
- Trip count, #matchings, #tracks per depot
- Key parameter values (headway times, max delays, etc.)
- **Experimental outcomes**: running times per instance, optimality gaps, solution improvements over baselines — quote specific values from tables

#### 3.2 核心创新点 (Key Innovations)
- List each innovation with supporting quotations.
- Distinguish between *genuinely novel* contributions (first-ever, paradigm-shifting) and *incremental* improvements (extensions, parameter tuning).
- For theoretical contributions (e.g., correcting a prior paper's error), include the counter-example logic.

#### 3.3 文献关联 (Literature Connections)
- Compare/contrast with other papers already in `原始文献/`. Be specific: shared base model, different objective, complementary subproblem, etc.
- Note shared benchmarks, competing methods, or complementary approaches.
- Map out the citation lineage (which papers build on which).
- If none exist in the collection, state "暂无相关文献" but list all cited works that overlap with the current collection's scope.

#### 3.4 写作手法 (Writing Techniques Worth Learning)
- Narrative structure, argumentation flow, visualization style.
- Table/figure design choices worth emulating.
- Cite specific passages, figures, or tables as examples.

#### Math Formatting

When citing or describing mathematical formulas (decision variables, constraints, objective functions, etc.), use LaTeX math notation in Markdown:
- Inline: `$x_t_c \in \{0,1\}$` → $x_t_c \in \{0,1\}$
- Display block: `$$\sum_{c \in C} x_t_c = 1 \quad \forall t \in T$$`

#### Evidence Rule

All claims in sections 3.1–3.4 **must** be backed by direct English quotations from the paper. Use blockquote format and include page/section locators. Every subsection should have at least one quotation.

### 4. Master Index

`原始文献/README.md` is a running index structured as:

```markdown
# 原始文献总目录

## <Classification Name>
- [<Paper Title>](./<Paper Title>/notes.md) — 一句话简述
```

Update this file every time a paper is ingested or reclassified. Keep classifications in alphabetical order.

### 5. Commit & Push

**After every paper is summarized**, commit and push immediately:

```bash
git add -A
git commit -m "<prefix>: <message>"
git push origin main
```

**Commit message prefixes** (standard Conventional Commits):
- `add:` — New paper ingested with notes
- `fix:` — Correction to notes, classification, or links
- `update:` — Enhancement to existing notes or index
- `refactor:` — Renaming, restructuring folders
- `docs:` — Documentation-only changes (CLAUDE.md, README.md)

**Changelog**: Append an entry to `更新日志/changelog.md` with each push:
```markdown
## YYYY-MM-DD
- <description of change>
```

### 6. Memory Management

For cross-device use, store persistent project knowledge as markdown files under `memory/`. Use the standard memory format (`name`, `description`, `metadata` frontmatter). Memory files track:
- User preferences and conventions
- Classification decisions and rationale
- Project-wide patterns and lessons learned

Push memory files together with the rest of the repo.

## Automated Ingestion via Watchdog

**Recommended workflow (one-shot, default):**

1. Drop one or more PDFs into `原始文献/`
2. Run: `conda activate opt && python watchdog.py`
3. All pending papers are processed and the script exits
4. Check `watchdog.log` for results

This mode does no background polling — it fires once and quits.

**Continuous watch mode** (for rapid-fire paper additions):

```bash
conda activate opt && python watchdog.py --watch
```

Polls every 5 seconds until `Ctrl+C`. Use this when you're adding many papers in quick succession.

### How the watchdog works

1. Scans `原始文献/` for top-level PDFs
2. Extracts the paper title via PyPDF2 (metadata → first-page text → filename fallback)
3. Computes SHA256 hash for deduplication (same paper won't process twice)
4. Invokes `claude -p --permission-mode bypassPermissions` in the project directory
5. Displays live progress with spinner + ticking elapsed time

## Python Environment

When Python is needed (e.g., PDF parsing, text extraction, or any scripting), always activate the `opt` conda environment first:

```bash
conda activate opt && python <script>
```

**All Python dependencies** (install once):

```bash
conda activate opt && pip install PyPDF2
```

## Automation Notes

- This CLAUDE.md serves as the complete specification for automating paper ingestion. Every step is deterministic: given a PDF in `原始文献/`, the workflow from §1–§5 runs to completion without further user input.
- Classification is the only step requiring judgment (§2). When in doubt, prefer more classifications over fewer — hard links are cheap.
- The master index (§4) and README.md are regenerated/updated on every change; they are never out of sync.

## Cross-Reference

- `README.md` is the Chinese-language mirror of this file. **Every time you modify CLAUDE.md, you must also update README.md accordingly.** Both must be kept in sync at all times.
