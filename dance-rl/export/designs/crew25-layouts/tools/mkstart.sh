# mkstart.sh V MODE SX SZ EL capBack capFront [seed] > start.json
V=$1; M=$2; T=$(SX=$3 SZ=$4 node gen.mjs $V $M ${8:-11} | grep TABLE | cut -c7-)
if [ "$M" = phone ]; then EL="[16,[$5]]"; else EL="[$5,[26,34]]"; fi
echo "{\"slots\":$T,\"elevation\":$EL,\"capBack\":$6,\"capFront\":$7}"
