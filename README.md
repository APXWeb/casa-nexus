# CASA NEXUS · experiência arquitetônica 3D em tempo real

Projeto conceitual da **APX Web**: uma residência contemporânea de dois pavimentos, modelada para este projeto, que o visitante vê se construir, desmontar em camadas, percorre em tour guiado e explora livremente no navegador.

## Rodar

```bash
npm install
npm run dev        # http://localhost:5290  (site)  ·  /gate.html (prova de qualidade e medição)
npm run build      # dist/ (base relativa)
```

Parâmetros úteis: `?q=ultra|high|balanced|performance` força o perfil; `?fps` mostra o medidor; no gate, `?lmdebug=1..4` exibe o lightmap.

## Pipeline

| Etapa | Onde |
| --- | --- |
| Planta (fonte única: modelo, planta interativa, construção) | `blender/plan.py` → `blender/plan.json` |
| Arquitetura, mobiliário e terreno construído (Blender 5.2, Python) | `blender/arch.py`, `furnish.py`, `site_build.py` |
| Detalhe arquitetônico: chanfros com normais endurecidas, rodapés e frisos de sombra só sobre paredes, baguetes, trilhos, rufos e pingadeiras | `blender/detail.py` |
| Estofados e têxteis: almofadas SDF com estufamento e vivo, cadeiras, camas; mantas, edredons, toalhas e cortinas por simulação de pano | `blender/upholstery.py` |
| Paisagismo em camadas (maciço, arbustos em grupos, forrações floridas) | `blender/planting.py` → `blender/vegetation.json` |
| Lightmaps no Cycles/OptiX + denoise OIDN + exportação GLB | `blender/bake.py` |
| Impostores hemi-octaédricos das árvores (64 vistas, cor + normal) | `blender/impostor.py` |
| Arbustos e rochas reais | `blender/veg_export.py` |
| Árvores do lote em malha real (perfil Alta): folhas reduzidas por ilhas, galhos decimados | `blender/tree_lod.py` |
| Texturas WebP em 3 resoluções (só as usadas), lightmaps, céus, meshopt | `tools/build-assets.mjs` |
| Texturas ambientCG e variantes neutras de tecido | `tools/acg.mjs`, `tools/derive-tex.mjs` |
| Validação visual e FPS no Chrome com GPU | `tools/gate.mjs`, `tools/site.mjs`, `tools/interact.mjs` |

```bash
B=/c/Users/ppsm2/tools/blender-5.2.3-windows-x64/blender.exe
LM_PX=4096 $B -b --factory-startup --python blender/main.py -- --bake all   # 4 passadas (céu, noite, dia, pôr do sol): ~1h40 na RTX 4070 Ti
$B -b --factory-startup --python blender/impostor.py -- jacaranda_tree - 8 256 jacaranda 0.5
$B -b --factory-startup --python blender/tree_lod.py -- assets-src/models/jacaranda_tree/jacaranda_tree_1k.gltf assets-src/export/tree_jacaranda.glb 220000 26000
$B -b --factory-startup --python blender/tree_lod.py -- assets-src/models/island_tree_02/island_tree_02_1k.gltf assets-src/export/tree_island.glb 120000 14000
node tools/build-assets.mjs && cp blender/plan.json public/assets/plan.json
```

### Iluminação

Cada atlas guarda quatro bakes do Cycles:

- `lmN.webp`: **RGB** = luz artificial (luminárias, LEDs, balizadores, piscina) e **A** = visibilidade do céu.
- `lmN_day.webp` e `lmN_sunset.webp`: **GI diurna** — só a luz indireta (rebatimentos do sol e do céu), com o sol e o HDRI na mesma direção usada no site, em RGBM 8 bits (`rgb² · a · day_max`).

No shader (`src/engine/materials.js`) entram, nesta ordem: o sol em tempo real com sombra, o céu direto (IBL × visibilidade), a GI diurna do clima atual e a luz artificial conforme o horário. Como o passe difuso do Cycles sem cor vale E/π, o shader multiplica por π e o ganho fica em 1 (sem calibração manual). Os reflexos usam 11 sondas por cômodo com projeção em caixa (`src/engine/probes.js`), e o céu é desenhado em luz linear (AgX invertido) com perspectiva aérea amostrada do próprio céu. O sol fica no norte (hemisfério sul): de dia ilumina a fachada do jardim, e a fachada da rua fica na sombra.

A GI diurna é de baixa frequência: o Ultra a usa em 2k e os demais perfis em 1k. O atlas do pôr do sol é carregado depois que a cena abre.

## Estrutura do site

Abertura → residência → construção (14 etapas) → visão completa → desmontagem → tour (13 ambientes) → exploração livre (grafo de navegação pelos vãos de porta + caminhada com colisão) → detalhes (8 marcadores) → personalização (fachada, madeira, piso, temperatura da luz, horário) → planta e ficha (calculadas do modelo) → apresentação final.

Sem WebGL, a página mostra capturas reais da cena (`public/img/`). Com `prefers-reduced-motion`, a rolagem suave e os amortecimentos são desligados.

## Perfis de qualidade

O site é pensado para computador. Em placas fortes (RTX 3060 para cima, Radeon RX 7000/9000) abre no **Ultra**; se o FPS cair de forma persistente, desce sozinho para Alta → Equilibrado → Desempenho. O menu Qualidade troca o perfil manualmente.

| Perfil | Resolução interna | MSAA | Sombra | Lightmaps (GI diurna) | Árvores do lote | Grama em lâminas | Mata |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ultra | 1,5× a tela (teto de ~8,3 MP) | 8× | 8192 | 4096 (2048) | jacarandás, árvores e cercas vivas em malha 3D | raio 24 m | 1,5× |
| Alta | até 2× (telas de alta densidade) | 4× | 4096 | 2048 (1024) | jacarandás e árvores em malha 3D | raio 20 m | 1× |
| Equilibrado | até 1,5× | 4× | 2048 | 2048 (1024) | impostores | — | 0,7× |
| Desempenho | 0,8× | SMAA | 1024 | 1024 (1024) | impostores | — | 0,35× |

A troca de perfil muda de fato resolução, MSAA, mapa de sombra, lightmaps, texturas, árvores e grama. A qualidade adaptativa mede o custo da GPU (consulta de tempo `EXT_disjoint_timer_query_webgl2`, mediana de janelas de 5 s) e ignora as janelas de transição (troca de clima, entrada na casa, abertura). Ela desce quando o custo passa de 22 ms e volta a subir quando fica abaixo de 8 ms por 6 s. Com `?q=` na URL, o perfil escolhido é respeitado e só cai em instabilidade crítica (> 50 ms), com aviso na tela.

## Desempenho medido (revisão de qualidade, 06/11/2026)

RTX 4070 Ti, Chrome (ANGLE/D3D11), janela 1600×900, rolagem automática (`node tools/site.mjs <url> <saída> --q <perfil> --perf`). O navegador desta máquina fica preso em ~60 Hz, por isso o FPS é sempre 60,0 e a comparação usa o **tempo de GPU por quadro** (média, em ms). Antes = código publicado no mesmo navegador.

| Perfil | Construção antes → depois | Desmontagem antes → depois | Tour antes → depois |
| --- | --- | --- | --- |
| Ultra (2400×1350, MSAA 8×) | 8,45 → 9,23 | 11,99 → 13,23 | 7,91 → 8,59 |
| Alta (1600×900, MSAA 4×) | 5,32 → 5,97 | 14,06 (picos de 180–270 ms) → 9,60 (pior 12,2) | 6,70 → 6,35 |
| Equilibrado | 5,52 → 5,03 | 9,34 → 9,57 | 3,34 → 6,83 |
| Desempenho (agora 1280×720 de fato) | 5,30 → 2,35 | 7,15 → 7,17 | 3,90 → 3,53 |

O pior quadro de GPU medido depois ficou em 22,3 ms (Ultra, construção); nos demais perfis, abaixo de 15 ms. A cena tem 2,49 milhões de triângulos (até 15,8 milhões por quadro no Ultra, contando sombras). Capturas lado a lado em `audit/pairs/`.

## Desempenho medido (primeira medição)

RTX 4070 Ti, Ryzen 9 7950X3D, Chrome (ANGLE/D3D11), perfil Alta qualidade. O monitor de 172–175 Hz é o teto:

| Cena | FPS | média | p95 | pior | draw calls |
| --- | --- | --- | --- | --- | --- |
| Órbita externa 1600×900 | 173 | 5,8 ms | 6,1 ms | 6,6 ms | 445 |
| Órbita externa 2560×1440 | 173 | 5,8 ms | 6,4 ms | 6,6 ms | 445 |
| Tour interno | 172 | 5,8 ms | 6,5 ms | 6,7 ms | 171 |
| Troca de clima | 172 | 5,8 ms | 6,5 ms | 6,8 ms | 572 |
| Rolagem da construção | 174 | 5,8 ms | 6,1 ms | 7,2 ms | 837 |
| Rolagem da desmontagem | 173 | 5,8 ms | 6,5 ms | 6,9 ms | 838 |
| Rolagem do tour | 174 | 5,8 ms | 6,1 ms | 6,6 ms | 430 |

No perfil Alta qualidade, as 7 árvores grandes do lote são malhas 3D reais (4 × 148 mil + 3 × 284 mil ≈ 1,44 milhão de triângulos), e a mata ao redor continua em impostores. Nos perfis Equilibrado e Desempenho, todas as árvores são impostores.

Remedição em 05/11/2026 (perfil Alta), com o navegador limitado a 60 Hz pela configuração de monitores da máquina: as rolagens de construção, desmontagem e tour ficaram em 60,0 fps, p95 16,8 ms e pior quadro 16,8 ms, sem quadros perdidos, já com as árvores em malha real (≈ 5,5 milhões de triângulos por quadro, contando a passada de sombra).

Perfil Ultra, mesmo navegador limitado a 60 Hz, lightmaps 4096 e cercas vivas em malha (62 × 48 mil triângulos): construção, desmontagem e tour em 60,0 fps, p95 ≤ 16,8 ms e pior quadro 16,8 ms, tanto em 1600×900 (renderizado em 2400×1350) quanto em 2560×1440 (renderizado em ~3840×2160). Até 11,4 milhões de triângulos por quadro, contando a passada de sombra. Com o teto de 60 Hz, a folga acima disso não foi medida.

Carregamento até a cena pronta: ~1 s com cache e ~5 s na primeira visita local. O site é pensado para computador: no celular só o layout foi testado, em emulação (Pixel 7, perfil Desempenho), e o FPS em GPU móvel não foi medido.

## Recursos e licenças

Ver `public/CREDITOS.md`. Todos os recursos de terceiros são CC0 (Poly Haven e ambientCG); nenhum modelo pago foi usado.
