"""Revisión automática del encuadre de un clip vertical terminado (la «capa extra» que pidió el editor).
uso: python qa_encuadre.py <clip.mp4> <modo>     modo: abajo (cara en el panel inferior) | cara (cara en cualquier sitio) | libre
Muestrea 10 fotogramas (saltando el gancho inicial), busca caras con YuNet y franjas negras, guarda una hoja <clip>.qa.jpg
y devuelve JSON: {"ok": bool, "motivo": str, "caras": 0-1, "cortadas": 0-1, "negro": 0-1}
"""
import sys, json, subprocess, os
import cv2
import numpy as np

video, modo = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'libre')
MODELO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_detection_yunet_2023mar.onnx')
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], capture_output=True, text=True).stdout.strip() or 0)
if dur <= 0: print(json.dumps({'ok': False, 'motivo': 'no se puede leer el clip'})); sys.exit()
ini = min(max(2.6, dur * 0.1), dur * 0.5)
ts = [ini + (dur * 0.96 - ini) * i / 9 for i in range(10)]
cap = cv2.VideoCapture(video)
det = cv2.FaceDetectorYN.create(MODELO, '', (540, 960), 0.6, 0.3, 5000) if os.path.exists(MODELO) else None
con_cara = cortadas = dobles = 0; negros = []; hoja = []
for t in ts:
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    if not ok: continue
    f = cv2.resize(f, (540, 960)); H, W = f.shape[:2]
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    filas = (g.mean(axis=1) < 12) & (g.std(axis=1) < 7)
    negros.append(float(filas.mean()))
    caras = []
    if det is not None:
        _, r = det.detect(f)
        caras = [] if r is None else [list(map(int, x[:4])) for x in r]
    if modo in ('abajo', 'abajo-sincam'):
        # Cara también dentro del panel del juego. Con «abajo-sincam» la webcam ya se recortó del juego: las caras de arriba
        # son de personajes (GTA VI tiene caras muy realistas) y no cuentan como webcam repetida.
        if modo == 'abajo' and any(c[1] + c[3] / 2 < H * 0.45 for c in caras): dobles += 1
        caras = [c for c in caras if c[1] + c[3] / 2 > H * 0.45]
    if caras:
        con_cara += 1
        x, y, w, h = max(caras, key=lambda c: c[2] * c[3])
        if x < 2 or y < 2 or x + w > W - 2 or y + h > H - 2: cortadas += 1
        cv2.rectangle(f, (x, y), (x + w, y + h), (0, 255, 0), 3)
    hoja.append(cv2.resize(f, (216, 384)))
n = max(1, len(hoja))
res = {'dobles': round(dobles / n, 2), 'caras': round(con_cara / n, 2), 'cortadas': round(cortadas / max(1, con_cara), 2), 'negro': round(float(np.mean(negros or [0])), 2)}
motivos = []
if modo in ('abajo', 'abajo-sincam', 'cara') and res['caras'] < 0.5: motivos.append('casi no se ve la cara' + (' en su panel' if modo != 'cara' else ''))
if res['cortadas'] > 0.3: motivos.append('la cara sale cortada por el borde')
if res['dobles'] >= 0.4: motivos.append('la webcam también se ve dentro del juego')
if res['negro'] > 0.22: motivos.append('franjas negras grandes')
res['ok'] = not motivos; res['motivo'] = '; '.join(motivos)
if hoja: cv2.imwrite(video + '.qa.jpg', np.hstack(hoja[:10:2]), [cv2.IMWRITE_JPEG_QUALITY, 80])
print(json.dumps(res))
