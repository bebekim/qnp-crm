# Setup CRM Server

Configure NanoClaw + qnp-crm for 24/7 unattended operation. Covers systemd service hardening, watchdog for zombie detection, and optional Windows/WSL auto-start.

Run this after `/add-qnp-crm` is installed and verified.

## Phase 1: Systemd service hardening

NanoClaw's `/setup` creates a basic systemd user service. This phase hardens it for production.

Check current service status:
```bash
systemctl --user status nanoclaw
```

## Phase 2: Watchdog timer

Baileys (WhatsApp WebSocket library) can silently hang — the process stays alive but stops processing messages. Systemd won't restart it because it never crashes.

**Solution:** The scheduler logs a `heartbeat` every 60s. A systemd timer checks log freshness. If stale for 5 minutes, it restarts the service.

Create the watchdog service:
```bash
cat > ~/.config/systemd/user/nanoclaw-watchdog.service << 'UNIT'
[Unit]
Description=NanoClaw watchdog — restart if log goes stale

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'LOG="$HOME/repositories/nanoclaw/logs/nanoclaw.log"; if [ ! -f "$LOG" ]; then exit 0; fi; AGE=$(( $(date +%%s) - $(stat -c %%Y "$LOG") )); if [ "$AGE" -gt 300 ]; then echo "Log stale (${AGE}s), restarting nanoclaw"; systemctl --user restart nanoclaw; fi'
UNIT
```

Create the watchdog timer:
```bash
cat > ~/.config/systemd/user/nanoclaw-watchdog.timer << 'UNIT'
[Unit]
Description=Check NanoClaw log freshness every 2 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
```

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-watchdog.timer
```

Verify:
```bash
systemctl --user status nanoclaw-watchdog.timer
systemctl --user list-timers
```

## Phase 3: Docker retry on startup

After a system boot, Docker may not be ready immediately. NanoClaw's `ensureContainerRuntimeRunning()` retries `docker info` up to 24 times (5s apart, 120s max). Verify this is working:

```bash
# Check container runtime logs after a restart
systemctl --user restart nanoclaw
journalctl --user -u nanoclaw --since "1 minute ago" | grep -i "container\|docker\|runtime"
```

## Phase 4: WSL auto-start (Windows only)

Skip this phase if not running on WSL.

Detect WSL:
```bash
if grep -qi microsoft /proc/version; then echo "WSL detected"; else echo "Not WSL — skip Phase 4"; fi
```

If WSL, ask the user for their Windows username and WSL distro name, then create:

### Windows Startup script
Create `start-nanoclaw.vbs` in the Windows Startup folder. This starts WSL + NanoClaw on Windows login:
```
Set ws = CreateObject("WScript.Shell")
ws.Run "wsl.exe -d <DISTRO> -u <LINUX_USER> -- bash -c ""systemctl --user start nanoclaw""", 0, False
```

Place at: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\start-nanoclaw.vbs`

### Boot-level scheduled task (starts without login)
Create `scripts/install-boot-task.ps1`:
```powershell
$action = New-ScheduledTaskAction `
    -Execute 'wsl.exe' `
    -Argument '-d <DISTRO> -u <LINUX_USER> -- bash -c "sleep 10 && systemctl --user start nanoclaw"'

$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId '<WINDOWS_USER>' `
    -RunLevel Highest `
    -LogonType S4U

Register-ScheduledTask `
    -TaskName 'StartWSL-NanoClaw' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Start WSL and NanoClaw after system boot' `
    -Force
```

Replace `<DISTRO>`, `<LINUX_USER>`, `<WINDOWS_USER>` with the user's values.

Tell the user: Right-click `install-boot-task.ps1` → Run with PowerShell (as Admin).

### Prevent sleep/hibernate
Tell the user to run in an admin PowerShell:
```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

### Prevent WSL idle shutdown
Tell the user to add to `C:\Users\<WINDOWS_USER>\.wslconfig`:
```ini
[wsl2]
vmIdleTimeout=-1
```

## Phase 5: Verify 24/7 operation

```bash
# Service running?
systemctl --user is-active nanoclaw

# Watchdog armed?
systemctl --user is-active nanoclaw-watchdog.timer

# Log being written to?
stat logs/nanoclaw.log | grep Modify

# Send a test message via WhatsApp and confirm response
```
