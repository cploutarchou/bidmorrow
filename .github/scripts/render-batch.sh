#!/usr/bin/env bash
# Triggers every URL in $1 once, then re-polls the whole set at intervals,
# reporting how many answer 200 with XML bytes. $2 is a label for the log.
set -u
LIST="$1"; LABEL="$2"
UA='BidMorrow/1.0 (+https://bidmorrow.com; support@bidmorrow.com)'
ACC='application/xml, text/xml;q=0.9, */*;q=0.5'
n=$(wc -l < "$LIST" | tr -d ' ')
echo "== batch ${LABEL}: ${n} notices =="
probe() {  # prints "<200count> <202count> <other>"
  ok=0; pending=0; other=0
  while read -r u; do
    [ -z "$u" ] && continue
    code=$(curl -s -o /tmp/body.out -w '%{http_code}' --max-time 30 \
      -H "Accept: ${ACC}" -H "User-Agent: ${UA}" "$u" || echo 000)
    bytes=$(wc -c < /tmp/body.out | tr -d ' ')
    if [ "$code" = "200" ] && [ "$bytes" -gt 500 ]; then ok=$((ok+1))
    elif [ "$code" = "202" ] || { [ "$code" = "200" ] && [ "$bytes" -le 500 ]; }; then pending=$((pending+1))
    else other=$((other+1)); fi
    rm -f /tmp/body.out
    sleep 1
  done < "$LIST"
  echo "${ok} ${pending} ${other}"
}
r=$(probe); echo "${LABEL} pass1 (trigger): rendered=$(echo $r|cut -d' ' -f1) pending=$(echo $r|cut -d' ' -f2) other=$(echo $r|cut -d' ' -f3)"
for wait in 60 120 180; do
  echo "${LABEL}: sleeping ${wait}s"; sleep "$wait"
  r=$(probe); echo "${LABEL} after +${wait}s: rendered=$(echo $r|cut -d' ' -f1) pending=$(echo $r|cut -d' ' -f2) other=$(echo $r|cut -d' ' -f3)"
done
