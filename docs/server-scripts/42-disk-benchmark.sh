#!/usr/bin/env bash
# 42-disk-benchmark.sh — measure the VPS disk with fio (WOK-655).
#
# Installs fio if missing (owner-approved 2026-10-27), then runs three ~30 s
# jobs on a 2 GB file in /var/tmp: 4k random read, 4k random write, 1M
# sequential write. direct=1 bypasses the page cache, so numbers reflect the
# disk/tariff limits, not RAM. The test file is removed on exit.
#
# Run on an idle box only — refuses while autodeploy holds its lock:
#   ssh vezdepost 'bash -s' < docs/server-scripts/42-disk-benchmark.sh
set -euo pipefail

LOCK=${AUTODEPLOY_LOCK:-/var/lock/vezdepost-autodeploy.lock}
FILE=${FIO_FILE:-/var/tmp/fio-wok655.bin}
RUNTIME=${FIO_RUNTIME:-30}

exec 9>"$LOCK"
flock -n 9 || { echo "autodeploy is running (lock held); retry later" >&2; exit 1; }
trap 'rm -f "$FILE"' EXIT

if ! command -v fio >/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fio >/dev/null
fi
fio --version

echo "io pressure before: $(head -1 /proc/pressure/io 2>/dev/null || echo 'n/a (no PSI)')"

run() {
  fio --name="$1" --filename="$FILE" --size=2G --rw="$2" --bs="$3" \
    --iodepth="$4" --ioengine=libaio --direct=1 --runtime="$RUNTIME" \
    --time_based --group_reporting --output-format=terse --terse-version=3 |
    awk -F';' -v n="$1" '{
      # terse v3: read iops=$8 bw(KiB/s)=$7 lat mean(us)=$40; write iops=$49 bw=$48 lat=$81
      if ($8 > 0) printf "%-12s %8d IOPS %8.1f MB/s  lat %.2f ms\n", n, $8, $7/1024, $40/1000
      else        printf "%-12s %8d IOPS %8.1f MB/s  lat %.2f ms\n", n, $49, $48/1024, $81/1000 }'
}

run randread-4k  randread  4k 32
run randwrite-4k randwrite 4k 32
run seqwrite-1m  write     1M 8
