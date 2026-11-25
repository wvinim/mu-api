import sys, json
from PIL import Image
from render import render
jobs = json.load(open(sys.argv[1]))
ims = []
for i, (model, steps, kw) in enumerate(jobs):
    p = f'out/t{i}.jpg'; render(model, steps, p, **kw); ims.append(Image.open(p).resize((138, 178)))
cols = 8; rows = (len(ims) + cols - 1) // cols
c = Image.new('RGB', (138 * cols, 178 * rows))
for i, im in enumerate(ims): c.paste(im, ((i % cols) * 138, (i // cols) * 178))
c.save(sys.argv[2])
