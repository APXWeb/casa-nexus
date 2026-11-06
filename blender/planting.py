"""Paisagismo do lote em camadas (CASA NEXUS) — gera as posições de blender/vegetation.json.

Substitui a fileira de cercas vivas idênticas (uma searsia a cada 2,1 m junto aos muros) por um plantio
de jardim tropical contemporâneo, em três camadas e com espaçamento irregular (Poisson em faixas):
  fundo  : searsia (maciço alto) com folga variável e algumas árvores de porte médio quebrando a linha;
  meio   : arbustos (shrub_02..04) adiante do maciço, em grupos;
  frente : forrações floridas (gazânia, ice plant, vinca) em manchas, nas bordas dos canteiros.
Roda dentro do Blender (site_build) ou sozinho:  python blender/planting.py  → reescreve vegetation.json
"""
import json
import math
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
SHRUBS = ['shrub_02', 'shrub_03', 'shrub_04']
GROUND = ['flower_gazania', 'crystalline_iceplant', 'periwinkle_plant']


def _strip(rnd, a0, a1, min_gap, max_gap):
    """Posições irregulares ao longo de um trecho (amostragem com folga aleatória)."""
    out = []
    t = a0 + rnd.uniform(0, min_gap)
    while t < a1:
        out.append(t)
        t += rnd.uniform(min_gap, max_gap)
    return out


def belt(items, rnd):
    """Cinturão vegetal junto aos três muros (oeste x=-16, leste x=16, fundo y=26)."""
    def add(kind, x, y, s, r=None):
        items.append(dict(kind=kind, x=round(x, 2), y=round(y, 2), r=round(rnd.uniform(0, 360) if r is None else r, 1), s=round(s, 2)))

    runs = [  # (eixo, coordenada do muro, início, fim, sentido para dentro do lote)
        ('y', -15.2, -24.0, 24.5, +1),   # muro oeste
        ('y', 15.2, -24.0, 24.5, -1),    # muro leste
        ('x', 25.1, -14.0, 14.0, -1),    # muro do fundo
    ]
    for axis, k, a0, a1, s in runs:
        # fundo: maciço de searsia com folgas irregulares e variação de porte
        for t in _strip(rnd, a0, a1, 2.4, 3.6):
            off = rnd.uniform(-0.15, 0.45) * s
            sc = rnd.uniform(0.85, 1.45)
            add('searsia_lucida', k + off, t, sc) if axis == 'y' else add('searsia_lucida', t, k + off, sc)
        # meio: grupos de 2–3 arbustos adiante, deixando respiros
        for t in _strip(rnd, a0 + 1.0, a1 - 0.5, 2.8, 5.0):
            for j in range(rnd.choice((1, 2, 2, 3))):
                tt = t + rnd.uniform(-0.6, 0.6)
                off = (rnd.uniform(1.0, 1.7) + 0.25 * j) * s
                sc = rnd.uniform(0.65, 1.05)
                kind = rnd.choice(SHRUBS)
                add(kind, k + off, tt, sc) if axis == 'y' else add(kind, tt, k + off, sc)
        # frente: manchas de forração (cada mancha = 3–6 touceiras da mesma espécie)
        for t in _strip(rnd, a0 + 0.5, a1 - 0.5, 1.6, 3.2):
            kind = rnd.choice(GROUND)
            for j in range(rnd.randint(3, 6)):
                tt = t + rnd.uniform(-0.7, 0.7)
                off = rnd.uniform(1.9, 2.6) * s
                sc = rnd.uniform(0.9, 1.4)
                add(kind, k + off, tt, sc) if axis == 'y' else add(kind, tt, k + off, sc)


def front_beds(items, rnd):
    """Canteiros da fachada da rua e laterais da casa: arbustos baixos + forrações (antes só arbustos soltos)."""
    def add(kind, x, y, s):
        items.append(dict(kind=kind, x=round(x, 2), y=round(y, 2), r=round(rnd.uniform(0, 360), 1), s=round(s, 2)))
    beds = [(1.0, -17.9, 11.6, -16.4, 14), (12.4, -15.5, 13.5, -3.5, 8), (-15.4, -15.5, -12.6, -2.5, 10)]
    for (x0, y0, x1, y1, n) in beds:
        for i in range(n):
            add(rnd.choice(SHRUBS), rnd.uniform(x0, x1), rnd.uniform(y0, y1), rnd.uniform(0.6, 0.95))
        for i in range(n):
            add(rnd.choice(GROUND), rnd.uniform(x0, x1), rnd.uniform(y0, y1), rnd.uniform(0.9, 1.3))


def generate(features):
    """features: itens fixos (árvores de destaque, rochas, samambaias...) vindos do site_build."""
    rnd = random.Random(2611)
    items = list(features)
    belt(items, rnd)
    front_beds(items, rnd)
    return items


FEATURES = [  # árvores de destaque, rochas e plantas pontuais (as mesmas do projeto anterior)
    dict(kind='jacaranda_tree', x=11.2, y=-21.8, r=40, s=0.85),
    dict(kind='jacaranda_tree', x=-9.5, y=21.0, r=200, s=0.9),
    dict(kind='island_tree_02', x=12.6, y=20.5, r=116.6, s=1.0),
    dict(kind='island_tree_02', x=13.4, y=-22.8, r=54.3, s=0.85),
    dict(kind='island_tree_02', x=-13.6, y=6.5, r=234.3, s=0.8),
    dict(kind='island_tree_02', x=3.0, y=22.5, r=26.1, s=0.75),
    dict(kind='jacaranda_tree', x=-14.0, y=-21.0, r=120, s=0.7),
]


def write(items, path=os.path.join(HERE, 'vegetation.json')):
    with open(path, 'w') as fh:
        json.dump(items, fh)
    return path


if __name__ == '__main__':
    # sozinho: preserva os itens pontuais do json atual (rochas, samambaias, pachira, lareira) e refaz o plantio
    cur = json.load(open(os.path.join(HERE, 'vegetation.json')))
    keep = [v for v in cur if v['kind'] in ('boulder_01', 'fern_02', 'pachira_aquatica_01')]
    # arbustos em volta da lareira externa (círculo) ficam
    keep += [v for v in cur if v['kind'].startswith('shrub') and v['y'] > 10 and abs(v['x'] + 8.0) < 4.5]
    items = generate(FEATURES + keep)
    print('vegetação:', len(items), 'itens ->', write(items))
    from collections import Counter
    print(Counter(v['kind'] for v in items))
