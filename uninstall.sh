#!/bin/zsh
#
# 删除 install.sh 安装的 rab 命令。服务器和应用不受影响；要停止服务器，先运行 rab server stop。
#
# 用法：
#   ./uninstall.sh                 # 从 /usr/local/bin 删除
#   PREFIX=~/.local ./uninstall.sh # 从 ~/.local/bin 删除

set -euo pipefail

ROOT="${0:A:h}"
BIN_DIR="${PREFIX:-/usr/local}/bin"
TARGET="$BIN_DIR/rab"

SUDO=()
[[ -w "$BIN_DIR" ]] || SUDO=(sudo)

if [[ -L "$TARGET" && "$(readlink "$TARGET")" == "$ROOT/rab" ]]; then
    "${SUDO[@]}" rm -f "$TARGET"
    print "Removed $TARGET"
else
    print "rab is not installed in $BIN_DIR."
fi
