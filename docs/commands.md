Windows commands we use day to day. Run them as administrator (Start, type `cmd` or `powershell`, right-click ›
Run as administrator). Ones marked **PowerShell** only work in PowerShell; the rest work in either.
Click the copy button on a box to copy it. A box with a blank in it (like an email address) copies whatever you type
in the blank, and the same blank further down the page fills in too.

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

Gets a fresh IP address from the router.

```cmd
ipconfig /release && ipconfig /renew
```

Pings Google's DNS non-stop, to see dropouts on a line (Ctrl+C to stop).

```cmd
ping 8.8.8.8 -t
```

Shows each hop to a server, to see where a connection breaks.

```cmd
tracert {host}
```

**PowerShell.** Checks a port on a server can be reached (443 = websites, 3389 = Remote Desktop, 5060 = SIP).

```powershell
Test-NetConnection {host} -Port {port}
```

Resets the Windows network stack when nothing else fixes the connection. Restart afterwards.

```cmd
netsh winsock reset
```

Shows the password of a Wi-Fi network this PC has joined (look for `Key Content`).

```cmd
netsh wlan show profile name="{wifi}" key=clear
```

## Email and DNS

Shows where a domain's email goes (Microsoft 365 is `….mail.protection.outlook.com`).

```cmd
nslookup -type=mx {domain}
```

Shows the domain's TXT records, including SPF (`v=spf1 …`).

```cmd
nslookup -type=txt {domain}
```

Shows the domain's DMARC record.

```cmd
nslookup -type=txt _dmarc.{domain}
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

## Updates and apps

Updates every installed app that winget knows about (accept the prompts the first time).

```cmd
winget upgrade --all
```

Makes Microsoft 365 apps (Outlook, Word, Excel…) check for and install updates now.

```cmd
"C:\Program Files\Common Files\microsoft shared\ClickToRun\OfficeC2RClient.exe" /update user
```

## Windows 11 readiness

Shows the Windows version and build.

```cmd
winver
```

**PowerShell.** Checks the TPM chip (Windows 11 needs `TpmPresent` and `TpmReady` True).

```powershell
Get-Tpm
```

**PowerShell.** Checks Secure Boot is on (True). An error means the PC is in legacy BIOS mode.

```powershell
Confirm-SecureBootUEFI
```

**PowerShell.** Shows the serial number, for warranty checks and asset records.

```powershell
Get-CimInstance Win32_BIOS | Select-Object SerialNumber
```

## BitLocker

Shows whether each drive is encrypted and protected.

```cmd
manage-bde -status
```

Shows the recovery key for the C: drive (the 48-digit `Password`).

```cmd
manage-bde -protectors -get C:
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

Writes a battery health report for a laptop to `battery-report.html` (opened from the folder the command was run in).

```cmd
powercfg /batteryreport
```

## Users and admin rights

Makes an Entra ID (Azure AD) user a local administrator on this PC. Type the user's email in the blank; it changes every time.

```cmd
net localgroup administrators /add "AzureAD\{email}"
```

Takes the admin rights away again once the job is done (users left as admins fail Cyber Essentials).

```cmd
net localgroup administrators /delete "AzureAD\{email}"
```

Lists who is in the local Administrators group.

```cmd
net localgroup administrators
```

Shows which Entra ID account is signed in.

```cmd
whoami /upn
```

Shows who is signed in to this PC, and since when.

```cmd
quser
```

Shows whether this PC is joined to Entra ID (look for `AzureAdJoined : YES`).

```cmd
dsregcmd /status
```

Refreshes the Microsoft sign-in token, for when Outlook or Teams keep asking to sign in.

```cmd
dsregcmd /refreshprt
```

Opens Credential Manager, to clear old saved Microsoft 365 or file share logins.

```cmd
rundll32.exe keymgr.dll,KRShowKeyMgr
```

## Quick fixes

Clears a stuck print queue: stops the print spooler, deletes the waiting jobs and starts it again.

```cmd
net stop spooler && del /q /f %systemroot%\System32\spool\PRINTERS\*.* && net start spooler
```

Opens Outlook without add-ins, to see whether an add-in is causing a crash.

```cmd
start outlook.exe /safe
```

Checks the Atera agent is running (`STATE : 4 RUNNING`). If the name is not found, look for Atera in `services.msc`.

```cmd
sc query AteraAgent
```

Restarts the Atera agent when the device shows offline in Atera.

```cmd
net stop AteraAgent && net start AteraAgent
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

Restarts straight into the BIOS/UEFI settings.

```cmd
shutdown /r /fw /t 0
```

Restarts into the advanced startup menu (Safe Mode, System Restore, Startup Repair).

```cmd
shutdown /r /o /t 0
```
