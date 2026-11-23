' Arranca, sin ventanas, el agente del acelerador y su icono de la bandeja (pon un acceso directo en la carpeta Inicio de Windows).
' Usa la carpeta donde está este archivo (junto a agente.mjs, bandeja.ps1 y config.json).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "node """ & dir & "\agente.mjs""", 0, False
sh.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\bandeja.ps1""", 0, False
