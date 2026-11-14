# mkcand.sh VARIANT MODE "SX SZ EL" ... -> candidates json on stdout
V=$1; M=$2; shift 2; echo "["; first=1
for spec in "$@"; do set -- $spec; T=$(SX=$1 SZ=$2 node gen.mjs $V $M ${4:-11} | grep TABLE | cut -c7-); [ $first = 1 ] || echo ","; first=0
  if [ "$M" = phone ]; then EL="[$3]"; else EL="$3"; fi
  echo "{\"id\":\"$V sx$1 sz$2 el$3 s${4:-11}\",\"slots\":$T,\"elevation\":[$( [ $M = phone ] && echo "16,$EL" || echo "$EL,[26,34]")]}"; done; echo "]"
