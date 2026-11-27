#!/bin/zsh
#
# rab：构建、启动、停止、重启 rab 的网站服务器和 iPhone 应用。由仓库根目录的 ./rab 调用
# （rab user …、rab public … 仍交给 server/cli.js）。用 ./install.sh 安装为系统命令 rab。
#
#   rab                          显示帮助（同 rab help）
#   rab <部分> [操作]            部分：server、ios、all；不给操作时用上下箭头选择
#   rab <操作> [部分]            操作：build、start、stop、restart；不给部分时用上下箭头选择
#   rab status                   显示服务器状态
#
# 例：rab restart、rab restart ios device、rab ios restart、rab server restart。
# restart 总是先 git pull（只快进）再构建。

set -euo pipefail

for dir in /opt/homebrew/bin /usr/local/bin; do
    [[ -d "$dir" && ":$PATH:" != *":$dir:"* ]] && path+=("$dir")
done

# This file is scripts/rab.zsh; :A resolves links, so paths point into the checkout.
ROOT="${0:A:h:h}"
IOS_BUNDLE_ID="com.gcc3.rab"

env_value() {
    local line
    line="$(grep -m1 "^$1=" "$ROOT/.env" 2>/dev/null || true)"
    print -r -- "${${line#*=}:-$2}"
}
PM2_NAME="$(env_value PM2_NAME rab)"
PORT="$(env_value PORT 3016)"

usage() {
    print -u2 "Usage: rab server [build|start|stop|restart|status]"
    print -u2 "       rab ios [build [device]|start [device]|stop|restart [device]|deploy [name]]"
    print -u2 "       rab build [all|server|ios] [device]"
    print -u2 "       rab restart [all|server|ios] [device]"
    print -u2 "       rab start [all|server|ios]"
    print -u2 "       rab stop [all|server|ios]"
    print -u2 "       rab status"
    print -u2 "       rab user …, rab public …   (rab help for these)"
    print -u2 "       rab help"
    exit 2
}

show_help() {
    cat <<'HELP'
rab builds and runs the parts of rab: the web server (server/ and the frontend in src/, run by
pm2) and the iPhone app (ios/).

Name a part, then what to do with it; leave out what to do to pick it with the arrow keys:

  rab server [build|start|stop|restart|status]
                               build: install dependencies and build the frontend
                               restart: pull, build, then restart under pm2
  rab ios [build|start|stop|restart|deploy]
                               build: for the simulator (build device: for an iPhone)
                               start, restart: pick a connected iPhone or a simulator, then build,
                               install and open the app there (… device: the paired iPhone, no list)
                               stop: quit the app on the iPhone or simulator you pick
                               deploy [name]: build, install and open on the paired iPhone, or the
                               one named

Or name what to do, then the part; leave out the part to pick it with the arrow keys:

  rab build [all|server|ios] [device]
                               device: build iOS for an iPhone rather than the simulator
  rab restart [all|server|ios] [device]
                               always pulls (fast-forward only) and builds first; all: the
                               server, then the app on the paired iPhone
  rab start [all|server|ios]   all: the server, then the app on the paired iPhone
  rab stop [all|server|ios]    all: the server, and the app on every connected iPhone and
                               booted simulator

  rab status                   show the server
  rab help                     show this

Accounts and the public folder (server/cli.js):

HELP
    node --disable-warning=ExperimentalWarning "$ROOT/server/cli.js" 2>&1 | sed -n '2,$p' || true
}

# MARK: Menu

# choose <title> <option>...: lets the user pick an option with the arrow keys (or j and k, or
# its number) and Return, and sets choice. q or Escape cancels, and choose fails.
choose() {
    local title="$1"
    shift
    local -a options=("$@")
    local count=${#options} index=1 picked=0 drawn=0 key rest i
    if [[ ! -t 0 || ! -t 2 ]]; then
        print -u2 "rab: $title give one on the command line: ${(j:, :)options}"
        return 1
    fi
    print -u2 -- $'\e[1m'"$title"$'\e[0m'
    while true; do
        (( drawn )) && print -nu2 -- $'\e['"${count}A"
        for (( i = 1; i <= count; i++ )); do
            if (( i == index )); then
                print -u2 -- $'\e[2K\e[7m> '"${options[i]}"$'\e[0m'
            else
                print -u2 -- $'\e[2K  '"${options[i]}"
            fi
        done
        drawn=1
        (( picked )) && break
        read -rsk1 key || return 1
        case "$key" in
            $'\e')
                rest=""
                read -rsk2 -t 0.05 rest || true
                case "$rest" in
                    "[A"|"OA") (( index = index > 1 ? index - 1 : count )) ;;
                    "[B"|"OB") (( index = index < count ? index + 1 : 1 )) ;;
                    "") return 1 ;;
                esac
                ;;
            k) (( index = index > 1 ? index - 1 : count )) ;;
            j) (( index = index < count ? index + 1 : 1 )) ;;
            $'\n'|$'\r') picked=1 ;;
            q) return 1 ;;
            <1-9>) (( key <= count )) && { index=$key; picked=1 } ;;
        esac
    done
    choice="${options[index]}"
}

# MARK: Server

package_manager() {
    if command -v pnpm &>/dev/null; then print pnpm; else print npm; fi
}

build_server() {
    local pm="$(package_manager)"
    if [[ ! -f "$ROOT/.env" && -f "$ROOT/.env.example" ]]; then
        print "Creating .env from .env.example..."
        cp "$ROOT/.env.example" "$ROOT/.env"
    fi
    print "Installing dependencies with $pm..."
    (cd "$ROOT" && "$pm" install)
    print "Building the frontend..."
    (cd "$ROOT" && "$pm" run build)
}

start_server() {
    command -v pm2 &>/dev/null || { print -u2 "pm2 is not installed: npm install -g pm2"; return 1; }
    [[ -d "$ROOT/dist" ]] || build_server
    "$ROOT/start.sh"
}

stop_server() {
    command -v pm2 &>/dev/null || { print "pm2 is not installed, so rab is not running under it."; return 0; }
    "$ROOT/stop.sh"
}

show_status() {
    local state="not in pm2"
    if command -v pm2 &>/dev/null; then
        state="$(pm2 jlist 2>/dev/null | /usr/bin/env python3 -c '
import json, sys
try:
    apps = json.load(sys.stdin)
except Exception:
    apps = []
for app in apps:
    if app.get("name") == sys.argv[1]:
        env = app.get("pm2_env", {})
        print(env.get("status", "unknown"), "(pid %s)" % app.get("pid") if app.get("pid") else "")
        break
else:
    print("not in pm2")
' "$PM2_NAME")"
    fi
    print "rab server:   ${state% }"
    if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
        print "              answering at http://localhost:$PORT"
    else
        print "              not answering at http://localhost:$PORT"
    fi
}

# MARK: iOS

# Prints "<kind>\t<id>\t<label>" for each paired iPhone or iPad (kind device) and each iOS
# simulator worth offering (kind simulator): every booted one, and the iPhones and iPads of the
# newest runtime.
ios_targets() {
    local json="$(mktemp -t rab-devices)"
    xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || true
    xcrun simctl list devices available --json 2>/dev/null | /usr/bin/python3 -c '
import json, re, sys

try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    devices = []
for d in devices:
    hardware = d.get("hardwareProperties", {})
    connection = d.get("connectionProperties", {})
    if hardware.get("deviceType") not in ("iPhone", "iPad") or connection.get("pairingState") != "paired":
        continue
    # transportType says how the iPhone can be reached right now, and is missing while it cannot.
    transport = connection.get("transportType")
    if transport == "wired":
        state = "connected via USB"
    elif transport == "localNetwork":
        state = "connected via Wi-Fi"
    elif transport or connection.get("tunnelState") == "connected":
        state = "connected"
    else:
        state = "not connected"
    name = d.get("deviceProperties", {}).get("name", d["identifier"]).replace("’", "\x27")
    print("device", d["identifier"], f"{name} ({state})", sep="\t")

def version(runtime):
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    return (int(m.group(1)), int(m.group(2))) if m else None

runtimes = {version(r): v for r, v in json.load(sys.stdin)["devices"].items() if version(r)}
newest = max(runtimes) if runtimes else None
for v in sorted(runtimes, reverse=True):
    for d in runtimes[v]:
        booted = d["state"] == "Booted"
        if booted or (v == newest and d["name"].startswith(("iPhone", "iPad"))):
            note = ", booted" if booted else ""
            name = d["name"]
            print("simulator", d["udid"], f"{name} simulator (iOS {v[0]}.{v[1]}{note})", sep="\t")
' "$json"
    rm -f "$json"
}

# pick_ios_target <title> [running]: asks which iPhone or simulator, and sets target_kind,
# target_id and target_label. With running, only iPhones and booted simulators are offered.
pick_ios_target() {
    local title="$1" only_running="${2:-}"
    local -a kinds ids labels
    local kind id label
    while IFS=$'\t' read -r kind id label; do
        [[ -n "$only_running" && "$kind" == simulator && "$label" != *booted* ]] && continue
        kinds+=("$kind"); ids+=("$id"); labels+=("$label")
    done < <(ios_targets)
    if (( ${#labels} == 0 )); then
        print -u2 "No iPhone or simulator found. Connect an iPhone, or install a simulator in Xcode."
        return 1
    fi
    choose "$title" "${labels[@]}" || return 1
    local i="${labels[(ie)$choice]}"
    target_kind="${kinds[$i]}"
    target_id="${ids[$i]}"
    target_label="${labels[$i]}"
}

# Builds, installs and starts the app on the iPhone or simulator picked, ending the running one
# first; with device, on the paired iPhone without asking.
start_ios() {
    if [[ "${1:-}" == device ]]; then
        "$ROOT/ios/deploy.sh"
        return
    fi
    pick_ios_target "Run rab on:" || return 1
    if [[ "$target_kind" == device ]]; then
        "$ROOT/ios/deploy.sh" "$target_id"
    else
        "$ROOT/ios/emulate.sh" "$target_id"
    fi
}

stop_ios() {
    pick_ios_target "Quit rab on:" running || return 1
    stop_ios_on "$target_kind" "$target_id" "$target_label"
}

# Quits the app on every connected iPhone and booted simulator, without asking.
stop_ios_everywhere() {
    local kind id label found=0
    while IFS=$'\t' read -r kind id label; do
        [[ "$kind" == simulator && "$label" != *booted* ]] && continue
        [[ "$kind" == device && "$label" == *"(not connected)"* ]] && continue
        found=1
        stop_ios_on "$kind" "$id" "$label" || true
    done < <(ios_targets)
    (( found )) || print "No connected iPhone or booted simulator."
}

# stop_ios_on <kind> <id> <label>: quits the app on that iPhone or simulator.
stop_ios_on() {
    local kind="$1" id="$2" label="$3"
    if [[ "$kind" == simulator ]]; then
        if xcrun simctl terminate "$id" "$IOS_BUNDLE_ID" 2>/dev/null; then
            print "Stopped rab on $label."
        else
            print "rab is not running on $label."
        fi
        return 0
    fi
    local json="$(mktemp -t rab-processes)" pid
    if ! xcrun devicectl device info processes --device "$id" --json-output "$json" >/dev/null 2>&1; then
        rm -f "$json"
        print -u2 "Cannot reach $label: connect and unlock it."
        return 1
    fi
    pid="$(/usr/bin/python3 -c '
import json, sys
for p in json.load(open(sys.argv[1])).get("result", {}).get("runningProcesses", []):
    if "/rab.app/" in p.get("executable", ""):
        print(p["processIdentifier"]); break
' "$json")"
    rm -f "$json"
    if [[ -z "$pid" ]]; then
        print "rab is not running on $label."
        return 0
    fi
    xcrun devicectl device process terminate --device "$id" --pid "$pid" >/dev/null
    print "Stopped rab on $label."
}

# MARK: All

build_all() {
    print "==> server"
    build_server
    print "==> iOS"
    "$ROOT/ios/build.sh" "${1:-simulator}"
}

# The server is started, then the app is built, installed and opened on the paired iPhone. A
# disconnected iPhone is reported and skipped.
start_all() {
    print "==> server"
    start_server
    print "==> iPhone"
    "$ROOT/ios/deploy.sh" || print -u2 "rab was not started on the iPhone: connect and unlock it, then run rab start ios device."
}

stop_all() {
    print "==> server"
    stop_server
    print "==> iOS"
    stop_ios_everywhere
}

restart_all() {
    pull
    print "==> server"
    build_server
    stop_server
    start_server
    print "==> iPhone"
    "$ROOT/ios/deploy.sh" || print -u2 "The iPhone was not updated: connect and unlock it, then run rab restart ios device."
}

# MARK: Pull

# Brings the checkout up to date before a restart builds it: fast-forward only, so it never
# merges. When that cannot be done (offline, no upstream, local changes in the way) the restart
# goes on with the code as it is.
pull() {
    git -C "$ROOT" rev-parse --is-inside-work-tree &>/dev/null || return 0
    print "Pulling..."
    git -C "$ROOT" pull --ff-only || print -u2 "Could not pull; restarting with the code as it is."
}

# MARK: Commands

# perform <part> <action> [argument]: does it, or fails with the usage.
perform() {
    local part="$1" action="$2"
    shift 2
    case "$part" in
        ios|all) (( $# <= 1 )) || usage ;;
        *) (( $# == 0 )) || usage ;;
    esac
    case "$part:$action" in
        server:build) build_server ;;
        server:start) start_server ;;
        server:stop) stop_server ;;
        server:restart) pull; build_server; stop_server; start_server ;;
        server:status) show_status ;;
        ios:build)
            case "${1:-simulator}" in
                sim|simulator) "$ROOT/ios/build.sh" sim ;;
                device|iphone) "$ROOT/ios/build.sh" device ;;
                *) usage ;;
            esac
            ;;
        # emulate.sh and deploy.sh always build first, and end the running app.
        ios:start|ios:restart)
            [[ -z "${1:-}" || "$1" == device ]] || usage
            if [[ "$action" == restart ]]; then pull; fi
            start_ios "$@"
            ;;
        ios:stop) (( $# == 0 )) || usage; stop_ios ;;
        ios:deploy) "$ROOT/ios/deploy.sh" "$@" ;;
        all:build)
            case "${1:-simulator}" in
                sim|simulator) build_all sim ;;
                device|iphone) build_all device ;;
                *) usage ;;
            esac
            ;;
        all:restart) [[ -z "${1:-}" || "$1" == device ]] || usage; restart_all ;;
        all:start) (( $# == 0 )) || usage; start_all ;;
        all:stop) (( $# == 0 )) || usage; stop_all ;;
        *)
            print -u2 "rab: $part has no $action."
            usage
            ;;
    esac
}

actions_of() {
    case "$1" in
        server) reply=(restart build start stop status) ;;
        ios) reply=(restart build start stop) ;;
        all) reply=(restart build start stop) ;;
    esac
}

typeset -a reply
choice=""

case "${1:-}" in
    ""|help|-h|--help)
        show_help
        ;;
    status)
        (( $# == 1 )) || usage
        show_status
        ;;
    server|ios|all)
        part="$1"
        shift
        if (( $# == 0 )); then
            actions_of "$part"
            choose "$part:" "${reply[@]}" || exit 1
            set -- "$choice"
        fi
        action="$1"
        shift
        perform "$part" "$action" "$@"
        ;;
    build|start|stop|restart)
        action="$1"
        shift
        if (( $# == 0 )); then
            choose "$action:" server ios all || exit 1
            set -- "$choice"
        fi
        part="$1"
        shift
        perform "$part" "$action" "$@"
        ;;
    *)
        usage
        ;;
esac
