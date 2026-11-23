# Icono en la bandeja de Windows: interruptor del acelerador.
#   Verde = disponible (el servidor puede mandar trabajo a la GPU).
#   Gris  = pausado (el servidor no manda nada y la GPU queda libre, p. ej. para jugar).
# Doble clic cambia el estado. El estado es el archivo PAUSA de la carpeta del agente.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$dir = $PSScriptRoot
$pausa = Join-Path $dir 'PAUSA'

# Un solo icono aunque se arranque dos veces.
$creado = $false
$mutex = New-Object System.Threading.Mutex($true, 'AceleradorServidorBandeja', [ref]$creado)
if (-not $creado) { exit }

function Nuevo-Icono([System.Drawing.Color]$color) {
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush $color), 3, 3, 26, 26)
  $p = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 3
  $g.DrawLine($p, 10, 13, 22, 13); $g.DrawLine($p, 10, 19, 22, 19)   # dos barras: "servidor"
  $g.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$icoOn  = Nuevo-Icono ([System.Drawing.Color]::FromArgb(12, 138, 12))
$icoOff = Nuevo-Icono ([System.Drawing.Color]::FromArgb(130, 130, 130))

$ni = New-Object System.Windows.Forms.NotifyIcon
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itEstado = $menu.Items.Add('')
$itEstado.Enabled = $false
[void]$menu.Items.Add('-')
$itCambiar = $menu.Items.Add('')
$itRegistro = $menu.Items.Add('Ver registro del agente')
[void]$menu.Items.Add('-')
$itSalir = $menu.Items.Add('Quitar este icono')
$ni.ContextMenuStrip = $menu

function Pintar {
  if (Test-Path $pausa) {
    $ni.Icon = $icoOff
    $ni.Text = 'Laptop PAUSADA: el servidor no le manda trabajo'
    $itEstado.Text = 'Estado: pausada (GPU libre)'
    $itCambiar.Text = 'Reanudar: el servidor puede usar la GPU'
  } else {
    $ni.Icon = $icoOn
    $ni.Text = 'Laptop disponible para el servidor'
    $itEstado.Text = 'Estado: disponible para el servidor'
    $itCambiar.Text = 'Pausar (voy a jugar)'
  }
}
function Cambiar {
  if (Test-Path $pausa) {
    Remove-Item $pausa -Force
    $ni.ShowBalloonTip(3000, 'Acelerador reanudado', 'El servidor puede volver a usar la GPU de la laptop.', 'Info')
  } else {
    Set-Content -Path $pausa -Value (Get-Date -Format s)
    $ni.ShowBalloonTip(3000, 'Acelerador en pausa', 'La GPU queda libre. El servidor hace todo el trabajo hasta que reanudes.', 'Info')
  }
  Pintar
}

$itCambiar.add_Click({ Cambiar })
$ni.add_DoubleClick({ Cambiar })
$itRegistro.add_Click({ Start-Process notepad.exe (Join-Path $dir 'agente.log') })
$itSalir.add_Click({ $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() })

# Si el estado cambia por otro lado (archivo creado o borrado a mano), el icono se actualiza.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({ Pintar })
$timer.Start()

Pintar
$ni.Visible = $true
[System.Windows.Forms.Application]::Run()
$ni.Dispose()
$mutex.ReleaseMutex()
