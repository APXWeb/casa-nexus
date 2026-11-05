"""Planta da CASA NEXUS — fonte única de verdade para o modelo, a planta interativa e a construção.

Coordenadas do Blender em metros: X = leste, Y = norte, Z = altura.
A rua fica ao sul (Y negativo); jardim, piscina e sol (hemisfério sul: sol ao norte) ficam ao norte.
Paredes por eixo (linha de centro). Cotas de piso: térreo 0,00; superior 3,50.
"""

LOT = dict(x0=-16, x1=16, y0=-26, y1=26)  # terreno 32 x 52 m

L0 = dict(floor=0.0, ceil=3.2)   # térreo: pé-direito 3,20
L1 = dict(floor=3.5, ceil=6.3)   # superior: laje 3,20–3,50, pé-direito 2,80
ROOF = dict(z0=6.3, z1=6.7)

EXT_T = 0.25
INT_T = 0.15
STONE_T = 0.32

# ------------------------------------------------------------------ ambientes
# (id, nome, pavimento, x0, y0, x1, y1, piso, parede, forro)
ROOMS = [
    # térreo
    ('garagem', 'Garagem', 0, -12, -16, -5, -10, 'concrete_floor', 'plaster', 'plaster'),
    ('lavabo', 'Lavabo', 0, -5, -16, -3, -13.5, 'stone_floor', 'marble_wall', 'plaster'),
    ('hall', 'Hall de entrada', 0, -5, -16, 1.2, -10, 'stone_floor', 'plaster', 'plaster'),
    ('jantar', 'Sala de jantar', 0, -5, -10, 1.2, -4, 'stone_floor', 'plaster', 'plaster'),
    ('cozinha', 'Cozinha', 0, -12, -10, -5, -4, 'stone_floor', 'plaster', 'plaster'),
    ('estar', 'Sala de estar', 0, 1.2, -11, 12, -4, 'stone_floor', 'plaster', 'wood_ceiling'),
    ('tv', 'Sala íntima', 0, 1.2, -16, 12, -11, 'wood_floor', 'plaster', 'plaster'),
    # superior
    ('galeria', 'Galeria e escada', 1, -2, -17.2, 1.2, -6, 'wood_floor', 'plaster', 'plaster'),
    ('suite_master', 'Suíte master', 1, -12.5, -11.5, -2, -6, 'wood_floor', 'plaster', 'plaster'),
    ('closet', 'Closet', 1, -7.5, -17.2, -2, -11.5, 'wood_floor', 'plaster', 'plaster'),
    ('banho_master', 'Banho master', 1, -12.5, -17.2, -7.5, -11.5, 'bath_floor', 'marble_wall', 'plaster'),
    ('suite_2', 'Suíte', 1, 1.2, -11, 8.5, -6, 'wood_floor', 'plaster', 'plaster'),
    ('closet_2', 'Armários da suíte', 1, 1.2, -13.6, 4.5, -11, 'wood_floor', 'plaster', 'plaster'),
    ('banho_2', 'Banho da suíte', 1, 4.5, -13.6, 8.5, -11, 'bath_floor', 'marble_wall', 'plaster'),
    ('escritorio', 'Escritório', 1, 1.2, -17.2, 8.5, -13.6, 'wood_floor', 'plaster', 'plaster'),
]

# áreas externas nomeadas (para a planta e o tour)
OUTDOOR = [
    ('gourmet', 'Área gourmet', 0, -12, -4, -3, 1),
    ('varanda', 'Varanda', 1, -12.5, -6, 12, -2),
    ('deck', 'Terraço e piscina', 0, -3, -4, 12.5, 9.5),
    ('jardim', 'Jardim e convivência', 0, -15, 9.5, 15, 25),
    ('acesso', 'Acesso e jardim frontal', 0, -15, -26, 15, -16),
]

# ------------------------------------------------------------------ paredes
# Abertura: (a0, a1, z0, z1, tipo) com a0/a1 na coordenada absoluta ao longo da parede.
# tipos: glass (vidro fixo/correr, piso a teto), slide (idem, com uma folha aberta: 6º campo = índice),
#        window (janela), door (porta interna),
#        entry (porta pivotante), garage (portão), pass (vão livre)
WALLS = [
    # ---------------- térreo, externas
    dict(id='t_sul', f=0, a=(-12, -16), b=(12, -16), t=EXT_T, ext=True, open=[
        (-11.4, -5.6, 0, 2.7, 'garage'),
        (-4.55, -3.45, 1.75, 2.55, 'window'),
        (-2.35, -0.95, 0, 2.95, 'entry'),
        (-0.75, -0.2, 0, 3.2, 'glass'),
        (3.0, 11.2, 0.45, 2.75, 'window'),
    ]),
    dict(id='t_oeste', f=0, a=(-12, -16), b=(-12, -4), t=EXT_T, ext=True, open=[
        (-9.0, -5.2, 1.05, 2.45, 'window'),
    ]),
    dict(id='t_norte', f=0, a=(-12, -4), b=(12, -4), t=EXT_T, ext=True, open=[
        (-11.72, -5.18, 0, 3.2, 'slide', -1),
        (-4.82, 0.98, 0, 3.2, 'glass'),
        (1.42, 11.72, 0, 3.2, 'slide', 1),
    ]),
    dict(id='t_leste', f=0, a=(12, -16), b=(12, -4), t=EXT_T, ext=True, open=[
        (-15.2, -11.6, 0.45, 2.75, 'window'),
        (-10.72, -4.28, 0, 3.2, 'glass'),
    ]),
    # ---------------- térreo, internas
    dict(id='t_gar_hall', f=0, a=(-5, -16), b=(-5, -10), t=INT_T, open=[(-12.6, -11.7, 0, 2.3, 'door')]),
    dict(id='t_gar_coz', f=0, a=(-12, -10), b=(-5, -10), t=INT_T, open=[(-7.2, -6.3, 0, 2.3, 'door')]),
    dict(id='t_lav_n', f=0, a=(-5, -13.5), b=(-3, -13.5), t=INT_T),
    dict(id='t_lav_l', f=0, a=(-3, -16), b=(-3, -13.5), t=INT_T, open=[(-14.7, -13.85, 0, 2.3, 'door')]),
    dict(id='t_pedra', f=0, a=(1.2, -16), b=(1.2, -11), t=STONE_T, finish='stone'),
    dict(id='t_ripado', f=0, a=(1.2, -11), b=(12, -11), t=INT_T, finish='wood', open=[
        (1.45, 3.25, 0, 2.6, 'pass'),
        (10.1, 11.8, 0, 2.6, 'pass'),
    ]),
    # ---------------- superior, externas
    dict(id='s_sul', f=1, a=(-12.5, -17.2), b=(8.5, -17.2), t=EXT_T, ext=True, open=[
        (-11.9, -8.1, 1.25, 2.45, 'window'),
        (-6.9, -2.9, 0.9, 2.45, 'window'),
        (-1.75, 0.95, 0, 2.8, 'glass'),
        (1.8, 7.9, 0.5, 2.6, 'window'),
    ]),
    dict(id='s_oeste', f=1, a=(-12.5, -17.2), b=(-12.5, -6), t=EXT_T, ext=True, open=[
        (-10.9, -7.0, 0.5, 2.6, 'window'),
    ]),
    dict(id='s_norte', f=1, a=(-12.5, -6), b=(8.5, -6), t=EXT_T, ext=True, open=[
        (-12.15, -2.35, 0, 2.8, 'slide', -1),
        (-1.75, 0.95, 0, 2.8, 'slide', 0),
        (1.55, 8.15, 0, 2.8, 'glass'),
    ]),
    dict(id='s_leste', f=1, a=(8.5, -17.2), b=(8.5, -6), t=EXT_T, ext=True, open=[
        (-16.6, -14.2, 0.5, 2.6, 'window'),
        (-10.6, -7.0, 0.5, 2.6, 'window'),
    ]),
    # ---------------- superior, internas
    dict(id='s_master_gal', f=1, a=(-2, -17.2), b=(-2, -6), t=INT_T, open=[(-10.2, -9.3, 0, 2.3, 'door')]),
    dict(id='s_master_div', f=1, a=(-12.5, -11.5), b=(-2, -11.5), t=INT_T, open=[(-4.3, -3.2, 0, 2.3, 'pass')]),
    dict(id='s_banho_closet', f=1, a=(-7.5, -17.2), b=(-7.5, -11.5), t=INT_T, open=[(-14.6, -13.75, 0, 2.3, 'door')]),
    dict(id='s_gal_leste', f=1, a=(1.2, -17.2), b=(1.2, -6), t=STONE_T, finish='stone_gal', open=[
        (-16.95, -16.05, 0, 2.3, 'door'),
        (-10.2, -9.3, 0, 2.3, 'door'),
    ]),
    dict(id='s_esc_div', f=1, a=(1.2, -13.6), b=(8.5, -13.6), t=INT_T),
    dict(id='s_suite_div', f=1, a=(1.2, -11), b=(8.5, -11), t=INT_T, open=[(2.0, 3.0, 0, 2.3, 'pass')]),
    dict(id='s_closet_banho', f=1, a=(4.5, -13.6), b=(4.5, -11), t=INT_T, open=[(-12.85, -12.0, 0, 2.3, 'door')]),
]

# ------------------------------------------------------------------ lajes
# Laje do térreo (piso do superior + marquises), com vazio da escada.
SLAB1 = dict(z0=3.2, z1=3.5, rects=[
    (-12, -16, 12, -2),       # cobre o térreo + marquise norte de 2 m (varanda)
    (-12, -2, -3, 1),         # marquise da área gourmet
    (-12.5, -17.2, 8.5, -6),  # balanço do pavimento superior
], holes=[(-0.2, -15.6, 1.2, -10.6)])
ROOF_RECTS = [(-12.8, -17.5, 8.8, -5.3)]
STAIR = dict(x0=-0.18, x1=1.04, y_bottom=-10.6, y_top=-15.6, risers=20, z0=0.0, z1=3.5)
VOID = (-0.2, -15.6, 1.2, -10.6)

# pilares (estrutura) — embutidos nas paredes; os de aço ficam aparentes
COLUMNS = [
    (-12, -16), (-5, -16), (1.2, -16), (12, -16),
    (-12, -10), (-5, -10), (1.2, -11), (12, -11),
    (-12, -4), (-5, -4), (1.2, -4), (12, -4),
]
STEEL_COLUMNS = [(-11.7, 0.7), (-3.3, 0.7)]

POOL = dict(x0=-0.5, x1=12.0, y0=2.6, y1=7.0, depth=1.45)


def room_at(x, y, floor):
    for r in ROOMS:
        if r[2] == floor and r[3] <= x <= r[5] and r[4] <= y <= r[6]:
            return r
    return None


def as_json():
    import json
    return json.dumps(dict(
        lot=LOT, levels=[L0, L1],
        rooms=[dict(id=r[0], name=r[1], floor=r[2], rect=[r[3], r[4], r[5], r[6]]) for r in ROOMS],
        outdoor=[dict(id=r[0], name=r[1], floor=r[2], rect=[r[3], r[4], r[5], r[6]]) for r in OUTDOOR],
        walls=[dict(id=w['id'], floor=w['f'], a=list(w['a']), b=list(w['b']), t=w['t'],
                    open=[list(o) for o in w.get('open', [])]) for w in WALLS],
        slab1=SLAB1, roof=ROOF_RECTS, stair=STAIR, columns=COLUMNS, steel=STEEL_COLUMNS, pool=POOL,
    ), ensure_ascii=False, indent=1)
