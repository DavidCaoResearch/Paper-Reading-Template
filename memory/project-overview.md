---
name: project-overview
description: Paper Reading project — automated academic paper ingestion, classification, and note-taking pipeline
metadata:
  type: project
---

# Project Overview

This is an automated academic paper reading pipeline. Papers are placed in `原始文献/`, and the system:
1. Reads and analyzes each paper
2. Creates classification folders with symlinks (no file duplication)
3. Generates structured reading notes with English quotations
4. Maintains a master index and changelog
5. Auto-commits and pushes after each paper

**Repo**: `git@github.com:DavidCaoResearch/Paper-Reading.git`
**User**: DavidCao — researcher, cross-device workflow needed

**Why**: Streamline the literature review process by automating classification and note-taking, with symlink-based organization to avoid duplicate PDFs.

**How to apply**: Follow CLAUDE.md workflow strictly. Every paper ingestion is a complete pipeline from PDF to pushed commit.
