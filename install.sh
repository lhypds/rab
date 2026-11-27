#!/bin/zsh
#
# 安装 rab 命令：链接到仓库根目录的 rab 脚本，之后在终端输入 rab 即可使用。
#   rab                          显示帮助
#   rab <部分> [操作]            部分：server、ios、all；操作：build、start、stop、restart
#   rab restart [部分]           省略部分时用上下箭头选择
# 命令是链接，修改 ./rab 后不用重装。
#
# 用法：
#   ./install.sh                 # 安装到 /usr/local/bin（需要时会要求 sudo 密码）
#   PREFIX=~/.local ./install.sh # 安装到 ~/.local/bin
#
# 卸载：./uninstall.sh。

set -euo pipefail

ROOT="${0:A:h}"
BIN_DIR="${PREFIX:-/usr/local}/bin"
TARGET="$BIN_DIR/rab"

# sudo only when the bin directory, or the nearest ancestor that exists, is not writable.
PROBE="$BIN_DIR"
while [[ ! -e "$PROBE" ]]; do PROBE="${PROBE:h}"; done
SUDO=()
[[ -w "$PROBE" ]] || SUDO=(sudo)

"${SUDO[@]}" mkdir -p "$BIN_DIR"
"${SUDO[@]}" ln -sfn "$ROOT/rab" "$TARGET"
print "Installed $TARGET"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    print "Note: $BIN_DIR is not in your PATH. Add it to your shell profile to run rab by name."
fi
