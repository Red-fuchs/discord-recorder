#!/bin/zsh
# Per-speaker ASR with word timestamps (Qwen3-ASR + forced aligner, local MLX via gpu-run), then merge.js.
# Usage: ./transcribe.sh [--glossar name] recordings/<session> [more…]   env: ASR_MODEL, ASR_CONTEXT
# glossar: --glossar > session.json "glossar" of the first session; its terms are appended to the ASR context, fixes applied in merge.js
set -e
cd "${0:A:h}"
ASR=${MLX_QWEN3_ASR:-/opt/miniconda3/bin/mlx-qwen3-asr}
MODEL=${ASR_MODEL:-Qwen/Qwen3-ASR-1.7B}
CTX=${ASR_CONTEXT:-"Claude Gemma Heretic Recorder Discord Spielleiter Actual Play"}
[[ $1 == --glossar ]] && { G=$2; shift 2 }
[[ $# -gt 0 ]] || { echo "usage: $0 [--glossar name] <session-dir>…"; exit 1 }
: ${G:=$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1]+'/session.json')).glossar ?? ''" "$1" 2>/dev/null)}
[[ -n $G ]] && CTX="$CTX $(node glossar.js context "$G")"
files=()
for d in "$@"; do mkdir -p "$d/asr"; files+=("$d"/*.flac); done
HF_HUB_OFFLINE=1 gpu-run -n "discord-asr" --ram 8 zsh -c 'for d in "$@"; do
  "'$ASR'" "$d"/*.flac --model "'$MODEL'" --language German --context "'$CTX'" --timestamps -f json -o "$d/asr" --no-progress --quiet
done' _ "$@"
for d in "$@"; do node merge.js "$d" $G; done
