#!/usr/bin/env bash
# MHWorldData の固定 commit から、必要な CSV だけを data/source/ に写します。
# robots.txt などほかのものは読みません。git の取得だけを使います。
set -euo pipefail
COMMIT=be7362213d7d1e30b794e3b58d3f87712035658d
REPO=https://github.com/gatheringhallstudios/MHWorldData
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d)}"
FILES=(
  armors/armor_base.csv armors/armor_base_translations.csv armors/armor_skills_ext.csv
  armors/armorset_base.csv armors/armorset_base_translations.csv
  armors/armorset_bonus_base.csv armors/armorset_bonus_base_translations.csv
  decorations/decoration_base.csv decorations/decoration_base_translations.csv
  charms/charm_base.csv charms/charm_base_translations.csv
  skills/skill_base.csv skills/skill_base_translations.csv skills/skill_levels.csv
  weapons/weapon_base.csv weapons/weapon_base_translations.csv
)
cd "$WORK"
[ -d .git ] || git init -q
git remote add origin "$REPO" 2>/dev/null || true
GIT_LFS_SKIP_SMUDGE=1 git fetch -q --depth 1 origin "$COMMIT"
git checkout -q FETCH_HEAD
test "$(git rev-parse HEAD)" = "$COMMIT"
for f in "${FILES[@]}"; do
  mkdir -p "$HERE/data/source/$(dirname "$f")"
  cp "source_data/$f" "$HERE/data/source/$f"
done
echo "$COMMIT" > "$HERE/data/source/COMMIT"
echo "copied ${#FILES[@]} files from $COMMIT"
