"""Кадр 1600×1000 для комнаты проекта: обрезка по центру или поля цветом края."""
import sys
from PIL import Image

W, H = 1600, 1000


def crop(img, bias=0.5):
    """Обрезать до 16:10, bias — доля обрезки сверху (0 — всё снизу, 1 — всё сверху)."""
    w, h = img.size
    if w / h > W / H:
        nw = round(h * W / H)
        x = round((w - nw) * bias)
        img = img.crop((x, 0, x + nw, h))
    else:
        nh = round(w * H / W)
        y = round((h - nh) * bias)
        img = img.crop((0, y, w, y + nh))
    return img.resize((W, H), Image.LANCZOS)


def pad(img, color=None):
    """Вписать целиком в 16:10, поля — цветом левого верхнего пикселя."""
    w, h = img.size
    color = color or img.getpixel((2, 2))
    s = min(W / w, H / h)
    img = img.resize((round(w * s), round(h * s)), Image.LANCZOS)
    out = Image.new("RGB", (W, H), color)
    out.paste(img, ((W - img.width) // 2, (H - img.height) // 2))
    return out


def save(img, path, q=84):
    img.convert("RGB").save(path, "WEBP", quality=q, method=6)


if __name__ == "__main__":
    mode, src, dst = sys.argv[1:4]
    arg = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
    im = Image.open(src).convert("RGB")
    save(crop(im, arg) if mode == "crop" else pad(im), dst)
    print(dst)


def letterbox(img, fade=40, color=(0, 0, 0)):
    """16:9 в 16:10: поля сверху и снизу, край кадра плавно уходит в цвет поля."""
    w, h = img.size
    ih = round(W * h / w)
    img = img.resize((W, ih), Image.LANCZOS)
    out = Image.new("RGB", (W, H), color)
    y = (H - ih) // 2
    out.paste(img, (0, y))
    return Image.composite(Image.new("RGB", (W, H), color), out, fade_mask(y, ih, fade))


def fade_mask(y, ih, fade):
    """Маска полей: 255 — цвет поля, 0 — кадр; переход на fade пикселей внутрь кадра."""
    m = Image.new("L", (W, H), 255)
    px = m.load()
    for r in range(y, y + ih):
        d = min(r - y, y + ih - 1 - r)
        a = 0 if d >= fade else round(255 * (1 - d / fade) ** 2)
        for x in range(W):
            px[x, r] = a
    return m
