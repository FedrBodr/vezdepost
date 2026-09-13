#!/usr/bin/env python3
"""Dedicated KSY TCP ingress relay; no TLS termination or secret handling."""
import json
import os
from pathlib import Path
import subprocess
import sys

RELAY="185.158.249.84"
ORIGIN="201.51.7.50"
SOURCES=("149.154.160.0/20","91.108.4.0/22",ORIGIN)
UNIT="ksy-telegram-relay"
SOCKET="""# Managed by reviewed KSY script 28.
[Unit]
Description=KSY Telegram TLS passthrough socket

[Socket]
ListenStream=185.158.249.84:443
FreeBind=yes
Accept=no
NoDelay=yes
KeepAlive=yes

[Install]
WantedBy=sockets.target
"""
SERVICE="""# Managed by reviewed KSY script 28.
[Unit]
Description=KSY Telegram TLS passthrough to Timeweb
Requires=ksy-telegram-relay.socket
After=network-online.target ksy-telegram-relay.socket
Wants=network-online.target

[Service]
ExecStart=/lib/systemd/systemd-socket-proxyd --connections-max=256 201.51.7.50:443
DynamicUser=yes
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
RestrictAddressFamilies=AF_INET AF_UNIX
MemoryMax=64M
TasksMax=16
LimitNOFILE=4096
Restart=on-failure
RestartSec=2s
"""
def command(args):
    result=subprocess.run(args,capture_output=True,text=True,timeout=30)
    if result.returncode:
        raise RuntimeError("COMMAND_FAILED:"+args[0])
    return result.stdout

def rule_args(source):
    return ["allow","from",source,"to","any","port","443","proto","tcp"]

def rule_line(source):
    return "ufw "+" ".join(rule_args(source))

def probe():
    code=command(["curl","--noproxy","*","-4","--silent","--show-error",
                  "--connect-timeout","4","--max-time","10","--output","/dev/null",
                  "--write-out","%{http_code}","--resolve",
                  "ksy-deals.fedrbodr.com:443:"+RELAY,
                  "https://ksy-deals.fedrbodr.com/health/ready"])
    if code!="200":
        raise RuntimeError("TLS_READINESS_FAILED")

def install(root=Path("/"),cmd=command,check=probe):
    directory=root/"etc/systemd/system"
    files={directory/(UNIT+".socket"):SOCKET,directory/(UNIT+".service"):SERVICE}
    existing=[path for path in files if path.exists() or path.is_symlink()]
    if existing:
        if len(existing)!=2 or any(path.is_symlink() or path.read_text()!=body for path,body in files.items()):
            raise RuntimeError("UNIT_COLLISION")
        cmd(["systemctl","is-enabled","--quiet",UNIT+".socket"])
        cmd(["systemctl","is-active","--quiet",UNIT+".socket"])
        if not cmd(["ufw","status"]).startswith("Status: active"):
            raise RuntimeError("UFW_INACTIVE")
        added=cmd(["ufw","show","added"]).splitlines()
        if not all(rule_line(source) in added for source in SOURCES):
            raise RuntimeError("RELAY_RULE_MISSING")
        check()
        return "already_verified"
    if cmd(["ss","-H","-ltn","sport = :443"]).strip():
        raise RuntimeError("PORT_OCCUPIED")
    if not cmd(["ufw","status"]).startswith("Status: active"):
        raise RuntimeError("UFW_INACTIVE")
    prior=cmd(["ufw","show","added"]).splitlines()
    added=[]
    created=[]
    service_started=False
    try:
        for path,body in files.items():
            # Exclusive create prevents overwriting a file created after preflight.
            with path.open("x") as stream:
                created.append(path)
                stream.write(body)
            path.chmod(0o644)
        cmd(["systemd-analyze","verify",str(directory/(UNIT+".socket")),str(directory/(UNIT+".service"))])
        for source in SOURCES:
            if rule_line(source) not in prior:
                added.append(source)
                cmd(["ufw"]+rule_args(source))
        cmd(["systemctl","daemon-reload"])
        service_started=True
        cmd(["systemctl","enable","--now",UNIT+".socket"])
        cmd(["systemctl","is-active","--quiet",UNIT+".socket"])
        check()
        return "installed_verified"
    except BaseException:
        errors=[]
        def rollback(args):
            try: cmd(args)
            except Exception: errors.append(args[0])
        if service_started:
            rollback(["systemctl","disable","--now",UNIT+".socket"])
            rollback(["systemctl","stop",UNIT+".service"])
        for path in created:
            try: path.unlink()
            except OSError: errors.append("unlink")
        rollback(["systemctl","daemon-reload"])
        for source in reversed(added):
            rollback(["ufw","--force","delete"]+rule_args(source))
        if errors:
            raise RuntimeError("ROLLBACK_INCOMPLETE") from None
        raise

def main():
    if len(sys.argv)!=2 or sys.argv[1] not in ("preflight","install"):
        raise RuntimeError("USAGE_preflight_or_install")
    if os.geteuid()!=0:raise RuntimeError("ROOT_REQUIRED")
    release=Path("/etc/os-release").read_text()
    if 'ID=ubuntu' not in release or 'VERSION_ID="24.04"' not in release:
        raise RuntimeError("OS_UNEXPECTED")
    interfaces=json.loads(command(["ip","-j","-4","address","show"]))
    if not any(a.get("local")==RELAY for interface in interfaces for a in interface.get("addr_info",[])):
        raise RuntimeError("HOST_UNEXPECTED")
    if not os.access("/lib/systemd/systemd-socket-proxyd",os.X_OK):
        raise RuntimeError("PROXYD_MISSING")
    if not command(["ufw","status"]).startswith("Status: active"):
        raise RuntimeError("UFW_INACTIVE")
    if sys.argv[1]=="preflight":
        print(json.dumps({"status":"preflight","listener":command(["ss","-H","-ltn","sport = :443"]).strip()!="","relay":RELAY,"origin":ORIGIN}))
        return
    print(json.dumps({"status":install(),"relay":RELAY,"origin":ORIGIN}))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print(json.dumps({"status":"failed","code":str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__}),file=sys.stderr)
        sys.exit(1)
