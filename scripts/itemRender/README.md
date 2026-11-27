# itemRender — imagens de itens a partir dos modelos do client

Gera imagens 92x119 no mesmo estilo de `docs/imgs_shop` (ângulo diagonal,
fundo cinza em degradê), renderizando os modelos 3D do client
(`MuPRO/client/Bin/Data/Item/*.bmd`, texturas `.OZJ`/`.OZT`).

- `bmd.py`: lê o BMD versão 0x0A (layout de `ZzzBMD.cpp` do Main 5.2) e
  aplica a pose do 1º frame da 1ª animação.
- `render.py`: rasterizador por software (z-buffer, supersampling 4x, luz
  difusa + especular, faces dos dois lados).
- `sheet.py`: monta uma folha de teste a partir de um JSON de jobs.
- `jewels.py`: Jewel of Excellent e Jewel of Reset (`Jewel85`/`Jewel93`, BMD 0x0C:
  `bmd.py` decifra o MapFile).
- `final.py`: gera as 28 imagens que faltavam (escudos, anéis, pendants,
  Blade, Divine Staff of Archangel).

Requer Python 3 com `numpy` e `Pillow`. Rodar de dentro desta pasta:

    python final.py

Ângulos usados (sequência de rotações aplicada ao modelo):
- armas: `x 180, y 90, x -20, z 30`
- escudos: `x -90, y -90, y 25, x 10` (frente)
- anéis/pendants: `x -60, z 20`

Modelo de cada item: `ZzzOpenData.cpp` do Main 5.2 (ex.: escudo `6:i` =
`Shield{i+1:02d}`, `shield16`/`shield17` para 6:15/6:16).
