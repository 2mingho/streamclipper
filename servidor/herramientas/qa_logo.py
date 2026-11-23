"""Revisión del logo de una campaña en un clip (21-nov-2026).

uso: python qa_logo.py <clip.mp4> <logo.png> <x> <y> <w> <h>

Comprueba en el primer fotograma, el último y uno cada 2 s que la zona (x, y, w, h) contiene el logo oficial escalado a w×h:
compara solo sus píxeles opacos (alfa > 90 %). Si algo lo tapa, lo deforma o falta en algún momento, la similitud cae.
Salida (última línea): JSON {ok, minimo, fotogramas, ancho, motivo}.
"""
import json
import sys

import cv2
import numpy as np

UMBRAL = 0.90      # similitud mínima por fotograma (1 = idéntico); la compresión h264 deja ~0,97–0,99
ANCHO_MIN = 600    # «no encoger»: por debajo de esto el logo se considera demasiado pequeño


def salir(**kw):
    print(json.dumps(kw, ensure_ascii=False))
    sys.exit(0)


def main():
    clip, logo_f = sys.argv[1], sys.argv[2]
    x, y, w, h = (int(v) for v in sys.argv[3:7])
    logo = cv2.imread(logo_f, cv2.IMREAD_UNCHANGED)
    if logo is None or logo.ndim != 3:
        salir(ok=False, motivo='no se puede leer el logo')
    if logo.shape[2] == 3:
        logo = np.dstack([logo, np.full(logo.shape[:2], 255, np.uint8)])
    prop_logo, prop_zona = logo.shape[1] / logo.shape[0], w / h
    if abs(prop_logo - prop_zona) / prop_logo > 0.02:
        salir(ok=False, motivo=f'logo deformado (proporción {prop_zona:.3f} frente a {prop_logo:.3f})', ancho=w)
    if w < ANCHO_MIN:
        salir(ok=False, motivo=f'logo demasiado pequeño ({w} px < {ANCHO_MIN})', ancho=w)
    ref = cv2.resize(logo, (w, h), interpolation=cv2.INTER_LANCZOS4)
    mascara = ref[:, :, 3] > 230
    if mascara.sum() < 0.05 * w * h:
        salir(ok=False, motivo='el logo casi no tiene píxeles opacos')
    color = ref[:, :, :3].astype(np.float32)

    cap = cv2.VideoCapture(clip)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    if total <= 0:
        salir(ok=False, motivo='no se puede leer el clip')
    idx = sorted(set([0, *range(0, total, max(1, int(fps * 2))), max(0, total - 1)]))
    sims, peores = [], []
    for i in idx:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, f = cap.read()
        if not ok and i == total - 1:  # el último índice a veces no se puede leer: el anterior legible
            for j in range(i - 1, max(0, i - 6), -1):
                cap.set(cv2.CAP_PROP_POS_FRAMES, j)
                ok, f = cap.read()
                if ok:
                    break
        if not ok:
            sims.append(0.0); peores.append(i); continue
        if y + h > f.shape[0] or x + w > f.shape[1]:
            salir(ok=False, motivo='la zona del logo se sale del vídeo', ancho=w)
        zona = f[y:y + h, x:x + w].astype(np.float32)
        dif = np.abs(zona - color)[mascara].mean() / 255.0
        s = 1.0 - dif
        sims.append(s)
        if s < UMBRAL:
            peores.append(i)
    cap.release()
    minimo = float(min(sims))
    if peores:
        segs = ', '.join(f'{p / fps:.1f}s' for p in peores[:5])
        salir(ok=False, minimo=round(minimo, 3), fotogramas=len(idx), ancho=w, motivo=f'logo tapado o ausente en {len(peores)} fotograma(s) ({segs})')
    salir(ok=True, minimo=round(minimo, 3), fotogramas=len(idx), ancho=w, motivo='')


if __name__ == '__main__':
    main()
