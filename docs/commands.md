Windows commands we use day to day. Run them in **Command Prompt** or **PowerShell** as administrator
(Start, type `cmd`, right-click › Run as administrator). Click the copy button on a box to copy it.
A box with a blank in it (like an email address) copies whatever you type in the blank.

To add or change a command, edit `docs/commands.md` in the repository (Edit on GitHub, top right).

## Network

Shows the IP address, subnet and gateway for each adapter.

```cmd
ipconfig
```

Shows the full adapter details: MAC address, DHCP, DNS servers, lease times.

```cmd
ipconfig /all
```

Clears the DNS cache, for when a site or server name resolves to the wrong place.

```cmd
ipconfig /flushdns
```

## Repair Windows

Scans and repairs corrupted or missing Windows system files.

```cmd
sfc /scannow
```

Repairs the Windows system image and component store. Run this first if `sfc` cannot fix everything, then run `sfc` again.

```cmd
dism /online /cleanup-image /restorehealth
```

Checks a disk for errors (read only).

```cmd
chkdsk
```

Checks and fixes errors on the C: drive. On the system drive it asks to run at the next restart.

```cmd
chkdsk C: /f
```

## System and processes

Shows the system configuration: Windows version, install date, last boot, RAM, domain.

```cmd
systeminfo
```

Lists running processes.

```cmd
tasklist
```

Forcefully ends a process by name. Type its name in the blank (as `tasklist` shows it).

```cmd
taskkill /IM {process.exe} /F
```

## Restart and shut down

Restarts the computer now.

```cmd
shutdown /r /t 0
```

Shuts the computer down now.

```cmd
shutdown /s /t 0
```

## Users and admin rights

Makes an Entra ID (Azure AD) user a local administrator on this PC. Type the user's email in the blank; it changes every time.

```cmd
net localgroup administrators /add "AzureAD\{email}"
```

Lists who is in the local Administrators group.

```cmd
net localgroup administrators
```

Shows whether this PC is joined to Entra ID (look for `AzureAdJoined : YES`).

```cmd
dsregcmd /status
```
