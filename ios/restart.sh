#!/bin/zsh
#
# 重新构建 iOS 版，并重新安装、打开 iPhone 上的 rab，让它用上新构建。
# 先构建模拟器版确认能编译；iPhone 未连接时只提示，不影响构建结果。
#
# 用法：
#   ./restart.sh                    # 第一台已配对的 iPhone
#   ./restart.sh "Heyang’s iPhone"  # 指定设备（名称或标识符）
#
# 环境变量 CONFIGURATION（Debug / Release）同样有效。

set -euo pipefail

ROOT="${0:A:h}"

print "==> Simulator build"
"$ROOT/build.sh" sim

print "==> iPhone"
"$ROOT/deploy.sh" "$@" || print -u2 "The iPhone was not updated: connect and unlock it, then run ./restart.sh again."
