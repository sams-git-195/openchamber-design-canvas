#!/bin/bash
cd /c/Users/samhe/AppData/Local/Temp/dc-recheck2
export DC_REPO=C:/Users/samhe/Documents/github/openchamber-design-canvas
for i in 1 2 3 4 5 6 7 8 9 10; do
  echo "== f5 run $i"; node f5.mjs $((57200+i)) 2>&1 | grep -E "F5 RESULT|FATAL"
done
for i in 1 2 3 4 5 6 7 8 9 10; do
  echo "== v11 run $i"; node v11.mjs $((57300+i)) 0 r$i 2>&1 | grep -vE "^\[svc"
done
echo ALLDONE
