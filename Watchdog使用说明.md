# Watchdog 使用说明

## 它能做什么

把 PDF 论文拖入 `原始文献/`，运行脚本，剩下的全自动完成：阅读、写笔记、分类、建软链接、更新目录、commit、push。

## 两种模式

### 一次性扫描（默认，推荐日常使用）

```bash
conda activate opt && python watchdog.py
```

- 扫描 `原始文献/` 中所有待处理的 PDF
- 逐篇处理完毕后自动退出
- **无后台进程，不持续占用资源**
- 适合：每次工作前手动触发

### 持续监控（批量添加论文时）

```bash
conda activate opt && python watchdog.py --watch
```

- 首次扫描处理后不退出，继续每 5 秒轮询
- 新拖入的 PDF 会被自动检测并处理
- `Ctrl+C` 停止
- 适合：连续快速添加多篇论文时

## 典型工作流

```bash
# 1. 激活环境
conda activate opt

# 2. 把 PDF 论文拖入 原始文献/ 文件夹

# 3. 触发处理
python watchdog.py

# 4. 查看结果
cat watchdog.log
```

## 注意事项

- 只处理 `原始文献/` **顶层**的 PDF（不在子文件夹中的）
- 已处理的论文会被记录在 `.processed_papers.json`，不会重复处理
- 如需重新处理某篇，删除 `.processed_papers.json` 中对应的条目即可
- 每次处理耗时取决于论文长度，通常 3-10 分钟/篇
- 确保 Claude Code 已安装且在 PATH 中
