#!/usr/bin/env sh
# 上游漂移检查。
#
#   ./lcoder/scripts/upstream-diff.sh
#
# 回答两个问题：
#   1. 我们改过哪些**上游文件**？清单里没登记的就是新接触点（需要评审）。
#   2. 这些文件在上游有没有新提交？有就说明升级时可能撞车。
#
# 我们自己的新增目录（lcoder/、packages/lcoder-*）不参与检查——新增永不冲突。

set -eu

UPSTREAM_REF="${UPSTREAM_REF:-upstream/master}"
MANIFEST="lcoder/contact-surface.txt"

cd "$(git rev-parse --show-toplevel)"

if ! git rev-parse --verify --quiet "$UPSTREAM_REF" >/dev/null; then
  echo "找不到 $UPSTREAM_REF。先跑：git fetch upstream" >&2
  exit 2
fi

# 我们相对上游改动的全部文件，排除我们自己的新增目录。
# 用 `git diff <ref>`（工作区 vs 上游），不是 `<ref>...HEAD`——后者只比提交，
# 看不见还没提交的改动，而那恰恰是最该被抓住的。
changed=$(git diff --name-only "$UPSTREAM_REF" \
  | grep -v '^lcoder/' \
  | grep -v '^packages/lcoder-' || true)

# 已登记的接触面（去掉注释与空行）
listed=""
if [ -f "$MANIFEST" ]; then
  listed=$(grep -v '^[[:space:]]*#' "$MANIFEST" | grep -v '^[[:space:]]*$' || true)
fi

new_points=""
for f in $changed; do
  if ! printf '%s\n' "$listed" | grep -Fxq "$f"; then
    new_points="$new_points$f\n"
  fi
done

echo "== 1. 接触面 =="
if [ -z "$changed" ]; then
  echo "  干净：没有修改任何上游文件"
else
  for f in $changed; do
    if [ -n "$new_points" ] && printf '%b' "$new_points" | grep -Fxq "$f"; then
      echo "  未登记  $f"
    else
      echo "  已登记  $f"
    fi
  done
fi

echo "== 2. 上游是否动过这些文件 =="
if [ -z "$changed" ]; then
  echo "  无接触面，跳过"
else
  hit=0
  for f in $changed; do
    count=$(git rev-list --count "HEAD..$UPSTREAM_REF" -- "$f" 2>/dev/null || echo 0)
    if [ "$count" -gt 0 ]; then
      echo "  $f  ← 上游有 $count 个新提交"
      hit=$((hit + 1))
    fi
  done
  [ "$hit" -eq 0 ] && echo "  上游没有改动我们碰过的文件"
fi

echo "== 3. 结论 =="
if [ -n "$new_points" ]; then
  echo "  有未登记的新接触点。请评审后写入 $MANIFEST，并在 UPSTREAM-BASELINE.md 第 3 节补一行。"
  exit 1
fi
echo "  接触面与清单一致"
