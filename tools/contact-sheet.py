"""Tile images into one labelled contact sheet for a quick look.

    python tools/contact-sheet.py <out.jpg> <cols> <width> <img> [<img> ...]   (a label: path=label)
"""
import sys
from PIL import Image, ImageDraw

out, cols, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
items = [a.split('=', 1) if '=' in a else (a, a.replace('\\', '/').split('/')[-1]) for a in sys.argv[4:]]
ims = [Image.open(p).convert('RGB') for p, _ in items]
h = round(width * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * width, rows * (h + 22)), (24, 20, 30))
d = ImageDraw.Draw(sheet)
for i, (im, (_, label)) in enumerate(zip(ims, items)):
    x, y = (i % cols) * width, (i // cols) * (h + 22)
    sheet.paste(im.resize((width, h)), (x, y + 22))
    d.text((x + 6, y + 5), label, fill=(240, 230, 210))
sheet.save(out, quality=88)
print(out)
