#!/usr/bin/env zsh
# =============================================================================
# build-skills.sh — 把 report-style-src/ 打包为可上传的 skill zip
#
# 用法:zsh seeds/skills/build-skills.sh
# 产物:seeds/skills/report-style.zip(供 provision.sh 上传,也可在管理站手工上传)
#
# 包结构(SkillPackageInspector 契约):
#   skill.json    清单(name/displayName/description/version;严格字段制)
#   SKILL.md      正文(YAML frontmatter 的 name/description 与清单一致)
#   references/*  说明性资源(md/txt/json/yaml/csv 文本)
# 校验要求:无路径穿越 / 无 symlink / 无脚本声明字段 / 总内容 ≤128KB。
# =============================================================================
set -euo pipefail
SEEDS_DIR="${0:A:h:h}"
SRC="$SEEDS_DIR/skills/report-style-src"
OUT="$SEEDS_DIR/skills/report-style.zip"

[[ -f "$SRC/skill.json" && -f "$SRC/SKILL.md" ]] || { echo "缺 skill.json / SKILL.md: $SRC" >&2; exit 1; }
# 产物从零重建(幂等)
rm -f "$OUT"
( cd "$SRC" && zip -qr "$OUT" skill.json SKILL.md references )
echo "已打包: $OUT"
unzip -l "$OUT"
