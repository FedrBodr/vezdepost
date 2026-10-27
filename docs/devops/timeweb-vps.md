Project: vezdepost (Postiz fork on Timeweb VPS)
Document: devops-runbook-provider-quirks

# Timeweb Cloud VPS — provider quirks & fixes

Hard-won gotchas specific to **Timeweb Cloud** (timeweb.cloud) KVM VPS. These
are provider-level and apply to any app; keep them when porting. Most network
fixes are **runtime and reset on reboot** — make them persistent or re-apply.

---

## 1. Web serial console mangles pasted commands

The panel's web serial console duplicates line tails and injects arrow-key
escape sequences into pasted text. **Prefer SSH.** If you must paste into the
serial console: append a trailing comment `#z` and hit `Ctrl+C` to clear the
line first, then re-type. Download-to-file beats pasting multi-line scripts.

Use the serial/web console only for **emergency access** when SSH is unusable.

---

## 2. Broken NIC offload on some nodes → outbound hangs

Symptom: outbound `curl`/`git` to some hosts hangs or stalls mid-transfer;
HTTP/2 to large sites never completes. Root cause: broken segmentation offload
on the node's virtual NIC.

```bash
ethtool -K eth0 gso off gro off tso off lro off
# verify a previously-hanging fetch now completes:
curl -sSI https://github.com | head -1     # expect HTTP/2 200
```

---

## 3. Broken IPv6 on some nodes → dual-stack hosts hang

Symptom: v4-only hosts work, but dual-stack hosts (github.com, etc.) hang —
the node's IPv6 path is broken and traffic tries v6 first.

```bash
sysctl -w net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
# diagnosis: a v4-only domain works while a dual-stack one hangs
```

If offload-off + IPv6-off still isn't enough, try `ip link set eth0 mtu 1280`
(revert to 1500 once stable).

---

## 3b. Outbound IPv4 to Telegram blocked → posts stick in QUEUE

Symptom: Telegram posts stay `QUEUE` forever with no `ERROR`, while every other
provider publishes from the same run. Confirmed 2026-09-18 (and the same
incident on 11 and 15 September).

Diagnosis — compare the two families from the host, then from the container:

```bash
curl -sS -4 -m 10 -o /dev/null -w '%{http_code} %{time_total}s\n' https://api.telegram.org/
curl -sS    -m 10 -o /dev/null -w '%{http_code} %{time_total}s\n' https://api.telegram.org/
docker exec postiz node -e 'const h=require("https");const r=h.request({hostname:"api.telegram.org",path:"/",family:4,timeout:8000},s=>{console.log(s.statusCode);s.resume()});r.on("timeout",()=>{console.log("TIMEOUT");r.destroy()});r.end()'
```

Observed: host IPv4 **times out**, host IPv6 returns `302` in ~0.15 s, and the
container has **no IPv6 at all** (`ENETUNREACH`). So the provider blocks
outbound IPv4 to Telegram, the working IPv6 path never reaches the Docker
network, and Node silently hangs on the blocked route. `QUEUE` without `ERROR`
is the signature: nothing failed, the request never completed.

Fix: a WireGuard tunnel to a foreign VPS carrying **only** Telegram prefixes —
`docs/server-scripts/25-telegram-egress-tunnel.sh`. Routing at the kernel level
is deliberate: both Telegram transports
(`telegram.rich.api.ts` and `node-telegram-bot-api`) build a raw
`https.request` and ignore `HTTPS_PROXY`, so a proxy would need a code change
while a route needs none. Everything except Telegram keeps the direct path, so
the box stays reachable and the other providers are untouched.

Verify after any change: host IPv4 → `302`, and the container check above
prints a status code instead of `TIMEOUT`.

---

## 4. DPI / anti-DDoS + backbone IP filtering → server unreachable

**The nastiest one.** Symptom: the server is up and serving locally
(`curl 127.0.0.1:PORT` → 200), but is **unreachable from the outside**: TCP
connects (you get SYN-ACK) yet the HTTP payload is silently dropped in **both
directions, on all ports**, from all sources. `nmap` shows ports "open" — that
is just the SYN-ACK and is **misleading**.

Diagnose with tcpdump on the server:

```bash
tcpdump -ni eth0 'tcp port 22 or tcp port 80 or tcp port 4007'
# SYN / SYN-ACK / ACK pass, but the client's HTTP GET never arrives, and the
# server's SSH banner (small packet) is retransmitted dozens of times, never
# ACKed → payload dropped. Confirms a network-path filter, not the app.
```

Prove it from outside their AS: `nc -w 7 <IP> 22` — **no banner = filtered**
(run from a host outside Timeweb, and from check-host.net nodes).

**Fix that actually worked:** open a support ticket with the tcpdump evidence
and ask them to **swap the public IP**. A specific IP had been filtered by
backbone providers; the new IP fixed everything instantly. Detach/delete the
old IP afterward. (Untried alternative: a Timeweb load-balancer with its own
clean public IP forwarding to the server internally.)

Also selectively affects **outbound**: some destinations (github) work while
others (tunnel providers' edges) are dead — so `cloudflared`/`localhost.run`
quick tunnels can fail from these boxes.

---

## 5. Docker Hub rate limit (429) on pulls/builds

Symptom: image pulls or `docker build` fail with `toomanyrequests: 429`.

```bash
# /etc/docker/daemon.json
{ "registry-mirrors": ["https://dockerhub.timeweb.cloud"] }
```
```bash
systemctl restart docker
```

Belt-and-suspenders: **pin the base image by digest** in the Dockerfile so a
cache-valid layer doesn't re-pull (see `deployment.md`).

---

## 6. npmjs.org times out from Russia

`pnpm install` / `npm ci` stalls. Point the registry at a mirror:

```ini
# .npmrc
registry=https://registry.npmmirror.com/
fetch-retries=5
fetch-retry-mintimeout=20000
fetch-retry-maxtimeout=120000
```

---

## 7. Everything network-level RESETS ON REBOOT

The `ethtool`, `sysctl ipv6`, and `ip link mtu` fixes above are **runtime only**
and are lost on reboot — reboots have repeatedly re-broken a working setup.
Make them persistent (systemd unit / `systemd-networkd` / `rc.local`) once the
setup is proven, or bake a re-apply step into boot. Always run a **reboot
acceptance test** after changing anything network-related.

---

## 8. Disk & memory baseline — slow deploys are not the tariff (WOK-655)

Measured 2026-10-27 on the idle prod VPS (4 vCPU, 7.8 GiB RAM, 80 GB disk,
shows as `QEMU HARDDISK ROTA=1` — meaningless inside a VM) with
`docs/server-scripts/42-disk-benchmark.sh` (fio, `direct=1`, 2 GB file, 30 s):

| Job | Result |
|---|---|
| 4k random read, iodepth 32 | 8 583 IOPS, 33.5 MB/s, 3.7 ms |
| 4k random write, iodepth 32 | 6 069 IOPS, 23.7 MB/s, 5.3 ms |
| 1M sequential write, iodepth 8 | 459 MB/s |

Timeweb has published NVMe ranges of ~10–30k read / 7–15k write IOPS (company
blog on Habr; no per-tariff SLA found), so random IOPS sit near the bottom of
that range, sequential throughput is fine. **Verdict: the disk is adequate;
no tariff upgrade.** The ~31-minute app deploy was the image, not the disk:
BuildKit spent 1002 s `exporting layers` + 165 s `unpacking` a 3.9 GB
node_modules layer of hundreds of thousands of small files (~4 MB/s effective
— file count and single-threaded gzip, far below the disk's 459 MB/s). Fix
the image (see `deployment.md` → Build-speed), not the VPS.

Diagnostics that misled during a build: PSI io `full avg300 ≈ 20–30 %`,
iowait 20–27 %, `iostat` ~12 MB/s read at 63 % util. They are real pressure,
but caused by the export of small files — measure fio on an idle box (no
autodeploy lock held) before blaming the tariff.

Swap (1.8–3 GB of the 4 GB `/swapfile`) is **cold pages**, not thrashing:
`vmstat` si/so ≈ 0 and ~4.5 GiB `available`. Largest swapped processes are
other projects' idle services (an ASR uvicorn ~930 MB, Temporal's
Elasticsearch ~390 MB). Check `vmstat 1` si/so before buying RAM; per-process
swap: `grep VmSwap /proc/*/status`.

Docker on this box uses the **containerd image store** (Docker 29,
`driver-type: io.containerd.snapshotter.v1`). Two consequences: a build
exports and then unpacks every new layer (double write), and moving a tag
deletes the previous image — keep rollback images under an explicit tag.
`docker builder prune --filter until=` freed almost nothing here; prune build
cache by record id (`docs/server-scripts/41-docker-cleanup.sh`).

---

## Quick reference — Timeweb panel

- Server console URL pattern: `timeweb.cloud/my/servers/<id>/console`.
- Emergency access when the SSH key is lost: **web console (panel)**.
- IP swap / second IP / balancer: via support ticket or panel.
