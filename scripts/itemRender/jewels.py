"""Imagens das joias custom vendáveis no mercado (docs/imgs_shop/Jewels).

O main.dll carrega Data/Item/Jewel{índice+1}.bmd para 14,84..100 (BMD 0x0C,
cifrado). Mesma geometria e textura (CustomJewelLHenrique) nas duas; muda só
o recorte do atlas (verde = Excellent, azul = Reset).

    python jewels.py
"""
import os
from render import render

D = r"C:\projects\mu-api\docs\imgs_shop\Jewels"
STEPS = [["x", -90], ["y", 30], ["x", 15], ["z", -25]]
JOBS = [("Jewel of Excellent", "Jewel85"), ("Jewel of Reset", "Jewel93")]

os.makedirs(D, exist_ok=True)
for name, model in JOBS:
    render(model, STEPS, os.path.join(D, name + ".jpg"), box=(60, 90), yoff=2)
    print(name)
