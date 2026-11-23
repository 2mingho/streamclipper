"""Detector determinista del recuadro de webcam en directos (sin LLM).
Idea: el recuadro de la cámara es un rectángulo FIJO sobre el juego, así que sus bordes son líneas rectas que aparecen
en TODOS los fotogramas, mientras que los bordes del juego cambian. Se acumulan los bordes de muchos fotogramas, se
buscan rectángulos formados por líneas persistentes y se elige el que contiene la cara (YuNet/Haar) con más frecuencia.
Si la cámara ocupa toda la pantalla (escena de "solo cámara"), lo indica con modo='pantalla'.

uso:  python webcam_detect.py <video> [t1,t2,...]     (sin tiempos: 16 fotogramas repartidos)
      python webcam_detect.py --imagenes a.jpg b.jpg ...
salida JSON: {"modo": "inset"|"pantalla"|"ninguna", "cam": [x,y,w,h], "cara": [x,y,w,h] | null, "confianza": 0-1}
"""
import sys, json, subprocess, os, tempfile
import cv2
import numpy as np

ANCHO = 640


def fotogramas_video(video, tiempos):
    if not tiempos:
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], capture_output=True, text=True).stdout.strip() or 0)
        tiempos = [dur * (i + 0.5) / 16 for i in range(16)]
    out = []
    with tempfile.TemporaryDirectory() as d:
        for i, t in enumerate(tiempos):
            f = os.path.join(d, f'{i}.jpg')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(max(0, t)), '-i', video, '-frames:v', '1', '-q:v', '3', f])
            if os.path.exists(f):
                im = cv2.imread(f)
                if im is not None: out.append(im)
    return out


def detector_caras():
    modelo = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_detection_yunet_2023mar.onnx')
    if os.path.exists(modelo) and hasattr(cv2, 'FaceDetectorYN'):
        det = cv2.FaceDetectorYN.create(modelo, '', (320, 320), 0.6, 0.3, 50)
        def caras(img):
            h, w = img.shape[:2]; det.setInputSize((w, h)); _, f = det.detect(img)
            return [tuple(map(int, x[:4])) for x in (f if f is not None else [])]
        return caras
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    def caras(img):
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return [tuple(map(int, r)) for r in casc.detectMultiScale(g, 1.1, 5, minSize=(18, 18))]
    return caras


def lineas_persistentes(grises, umbral=0.7):
    acc = np.zeros(grises[0].shape, np.float32)
    for g in grises:
        acc += (cv2.Canny(cv2.GaussianBlur(g, (3, 3), 0), 50, 140) > 0)
    return (acc / len(grises) >= umbral).astype(np.uint8) * 255


def perfiles(pers):
    # cuánto borde persistente horizontal/vertical hay en cada fila/columna (con tolerancia de 1 px)
    hk = cv2.morphologyEx(pers, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1)))
    vk = cv2.morphologyEx(pers, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 25)))
    return cv2.dilate(hk, np.ones((3, 1), np.uint8)), cv2.dilate(vk, np.ones((1, 3), np.uint8))


def cobertura(mask, x0, x1, y, horizontal=True):
    if horizontal:
        seg = mask[y, max(0, x0):x1]
    else:
        seg = mask[max(0, x0):x1, y]
    return float((seg > 0).mean()) if seg.size else 0.0


def candidatos(hk, vk, W, H):
    filas = [y for y in range(H) if (hk[y] > 0).sum() > 40]
    cols = [x for x in range(W) if (vk[:, x] > 0).sum() > 40]
    # agrupa líneas vecinas
    def agrupa(v):
        g, out = [], []
        for a in v:
            if g and a - g[-1] > 3: out.append(int(np.mean(g))); g = []
            g.append(a)
        if g: out.append(int(np.mean(g)))
        return out
    filas, cols = agrupa(filas), agrupa(cols)
    # el borde de la pantalla también cuenta como lado
    filas = sorted(set([0, H - 1] + filas)); cols = sorted(set([0, W - 1] + cols))
    res = []
    for i, y0 in enumerate(filas):
        for y1 in filas[i + 1:]:
            if not (0.08 * H <= y1 - y0 <= 0.75 * H): continue
            for j, x0 in enumerate(cols):
                for x1 in cols[j + 1:]:
                    w, h = x1 - x0, y1 - y0
                    if not (0.08 * W <= w <= 0.75 * W): continue
                    asp = w / h
                    if not (0.9 <= asp <= 2.4): continue
                    lados = [cobertura(hk, x0, x1, y0) if y0 > 0 else 1.0, cobertura(hk, x0, x1, y1) if y1 < H - 1 else 1.0,
                             cobertura(vk, y0, y1, x0, False) if x0 > 0 else 1.0, cobertura(vk, y0, y1, x1, False) if x1 < W - 1 else 1.0]
                    bordes_reales = sum(1 for k, v in zip((y0 > 0, y1 < H - 1, x0 > 0, x1 < W - 1), lados) if k)
                    if bordes_reales < 2: continue
                    s = float(np.mean([v for k, v in zip((y0 > 0, y1 < H - 1, x0 > 0, x1 < W - 1), lados) if k]))
                    if s >= 0.6: res.append((s, (x0, y0, w, h)))
    return res


def detectar(imgs):
    if not imgs: return {'modo': 'ninguna', 'cam': None, 'cara': None, 'confianza': 0}
    H0, W0 = imgs[0].shape[:2]; k = ANCHO / W0
    peq = [cv2.resize(im, (ANCHO, int(H0 * k))) for im in imgs]
    W, H = ANCHO, peq[0].shape[0]
    caras_fn = detector_caras()
    caras = [caras_fn(im) for im in peq]
    pers = lineas_persistentes([cv2.cvtColor(im, cv2.COLOR_BGR2GRAY) for im in peq])
    hk, vk = perfiles(pers)
    cands = candidatos(hk, vk, W, H)
    escala = lambda b: [int(round(v / k)) for v in b]
    # Método 1: estabilidad del color. La habitación tras la webcam apenas cambia; el juego sí. Un píxel es estable si en
    # al menos el 70 % de los fotogramas está cerca de su mediana (aguanta algunas escenas de "solo cámara").
    gs = np.stack([cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32) for im in peq])
    estable = ((np.abs(gs - np.median(gs, 0)) < 14).mean(0) >= 0.7).astype(np.uint8) * 255
    estable = cv2.morphologyEx(estable, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    estable = cv2.morphologyEx(estable, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(estable)
    mejor_e = None
    if len(peq) >= 5:
        for i in range(1, n):
            x, y, w, h, area = st[i]
            if w < 0.07 * W or h < 0.07 * H or w * h > 0.6 * W * H or area < 0.45 * w * h: continue
            fr = sum(any(x <= c[0] + c[2] / 2 <= x + w and y <= c[1] + c[3] / 2 <= y + h for c in cc) for cc in caras) / len(caras)
            if fr > 0 and (mejor_e is None or fr > mejor_e[1]): mejor_e = ((x, y, w, h), fr)
    if mejor_e and mejor_e[1] >= 0.3:
        (x, y, w, h), fr = mejor_e
        dentro = [c for cc in caras for c in cc if x <= c[0] + c[2] / 2 <= x + w and y <= c[1] + c[3] / 2 <= y + h]
        cara = [int(np.median([c[i] for c in dentro])) for i in range(4)]
        return {'modo': 'inset', 'cam': escala((x, y, w, h)), 'cara': escala(cara), 'confianza': round(min(1.0, 0.5 + fr * 0.5), 2), 'metodo': 'estabilidad'}
    # Método 2: la habitación tras la webcam es estática -> mancha de bordes persistentes que contiene la cara.
    todas = [c for cc in caras for c in cc]
    blob = cv2.dilate(pers, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(blob)
    mejor_b = None
    for i in range(1, n):
        x, y, w, h, area = st[i]
        if w < 0.07 * W or h < 0.07 * H or w * h > 0.6 * W * H: continue
        dentro = [c for c in todas if x <= c[0] + c[2] / 2 <= x + w and y <= c[1] + c[3] / 2 <= y + h]
        fr = sum(any(x <= c[0] + c[2] / 2 <= x + w and y <= c[1] + c[3] / 2 <= y + h for c in cc) for cc in caras) / len(caras)
        if dentro and (mejor_b is None or fr > mejor_b[1]): mejor_b = ((x, y, w, h), fr, dentro)
    if mejor_b and mejor_b[1] >= 0.3:
        (x, y, w, h), fr, dentro = mejor_b
        # ajusta a líneas rectas cercanas (borde real del recuadro) o amplía un poco el contorno de la mancha
        def ajusta(v, lim, prof, horiz):
            best = None
            for d in range(-4, 14):
                p = v - d if not horiz else v - d
                if 0 <= p < lim and prof[p] > 0.5: best = p; break
            return best
        x0, y0, x1, y1 = max(0, x - 4), max(0, y - 4), min(W - 1, x + w + 4), min(H - 1, y + h + 4)
        cara = [int(np.median([c[i] for c in dentro])) for i in range(4)]
        return {'modo': 'inset', 'cam': escala((x0, y0, x1 - x0, y1 - y0)), 'cara': escala(cara), 'confianza': round(min(1.0, 0.4 + fr * 0.6), 2), 'metodo': 'mancha'}
    mejor, mejor_p = None, -1
    for s, (x, y, w, h) in cands:
        dentro = sum(any(x <= fx + fw / 2 <= x + w and y <= fy + fh / 2 <= y + h and fw < w * 0.7 for fx, fy, fw, fh in cs) for cs in caras) / len(caras)
        # prefiere recuadros con cara, bien cerrados y no enormes
        p = s * 0.5 + dentro * 0.8 - (w * h) / (W * H) * 0.3
        if dentro > 0 and p > mejor_p: mejor, mejor_p = (x, y, w, h, dentro, s), p
    if mejor:
        x, y, w, h, dentro, s = mejor
        cs = [c for cc in caras for c in cc if x <= c[0] + c[2] / 2 <= x + w and y <= c[1] + c[3] / 2 <= y + h]
        cara = [int(np.median([c[i] for c in cs])) for i in range(4)] if cs else None
        return {'modo': 'inset', 'cam': escala((x, y, w, h)), 'cara': escala(cara) if cara else None, 'confianza': round(min(1.0, dentro * 0.6 + s * 0.4), 2)}
    # sin recuadro: ¿la cámara ocupa la pantalla? (cara grande en la mayoría de fotogramas)
    grandes = [any(fw > W * 0.08 for fx, fy, fw, fh in cs) for cs in caras]
    if sum(grandes) / len(caras) >= 0.5:
        return {'modo': 'pantalla', 'cam': [0, 0, W0, H0], 'cara': None, 'confianza': 0.5}
    return {'modo': 'ninguna', 'cam': None, 'cara': None, 'confianza': 0}


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == '--imagenes':
        imgs = [cv2.imread(f) for f in a[1:]]; imgs = [i for i in imgs if i is not None]
    else:
        ts = [float(x) for x in a[1].split(',')] if len(a) > 1 and a[1] else []
        imgs = fotogramas_video(a[0], ts)
    print(json.dumps(detectar(imgs)))
