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
| Lightmaps no Cycles/OptiX + denoise OIDN + exportação GLB | `blender/bake.py` |
| Impostores hemi-octaédricos das árvores (64 vistas, cor + normal) | `blender/impostor.py` |
| Arbustos e rochas reais | `blender/veg_export.py` |
| Árvores do lote em malha real (perfil Alta): folhas reduzidas por ilhas, galhos decimados | `blender/tree_lod.py` |
| Texturas WebP em 3 resoluções, lightmaps, céus, meshopt | `tools/build-assets.mjs` |
| Validação visual e FPS no Chrome com GPU | `tools/gate.mjs`, `tools/site.mjs`, `tools/interact.mjs` |

```bash
B=/c/Users/ppsm2/tools/blender-5.2.3-windows-x64/blender.exe
$B -b --factory-startup --python blender/main.py -- --bake all      # LM_PX=4096: ~41 min na RTX 4070 Ti (2048: ~15 min)
$B -b --factory-startup --python blender/impostor.py -- jacaranda_tree - 8 256 jacaranda 0.5
$B -b --factory-startup --python blender/tree_lod.py -- assets-src/models/jacaranda_tree/jacaranda_tree_1k.gltf assets-src/export/tree_jacaranda.glb 220000 26000
$B -b --factory-startup --python blender/tree_lod.py -- assets-src/models/island_tree_02/island_tree_02_1k.gltf assets-src/export/tree_island.glb 120000 14000
node tools/build-assets.mjs && cp blender/plan.json public/assets/plan.json
```

### Iluminação

Cada atlas guarda dois bakes de irradiância: **RGB** = luz artificial (luminárias, LEDs, balizadores, piscina) e **A** = visibilidade do céu com rebatimentos. O shader (`src/engine/materials.js`) multiplica a luz do ambiente HDR pela oclusão e soma a luz artificial conforme o horário. Assim dia, pôr do sol e noite mudam sem recarregar, e a troca de acabamentos preserva luz e reflexos. O sol é dinâmico, com sombras em tempo real. De dia, as luminárias acendem a meia intensidade quando a câmera entra na casa, como numa visita real; isso ilumina ambientes com pouca luz natural, como o closet e o banho atrás do brise.

## Estrutura do site

Abertura → residência → construção (14 etapas) → visão completa → desmontagem → tour (13 ambientes) → exploração livre (grafo de navegação pelos vãos de porta + caminhada com colisão) → detalhes (8 marcadores) → personalização (fachada, madeira, piso, temperatura da luz, horário) → planta e ficha (calculadas do modelo) → apresentação final.

Sem WebGL, a página mostra capturas reais da cena (`public/img/`). Com `prefers-reduced-motion`, a rolagem suave e os amortecimentos são desligados.

## Desempenho medido

## Perfis de qualidade

O site é pensado para computador. Em placas fortes (RTX 3060 para cima, Radeon RX 7000/9000) abre no **Ultra**; se o FPS cair de forma persistente, desce sozinho para Alta → Equilibrado → Desempenho. O menu Qualidade troca o perfil manualmente.

| Perfil | Resolução interna | MSAA | Sombra | Lightmaps | Árvores do lote | Mata |
| --- | --- | --- | --- | --- | --- | --- |
| Ultra | 1,5× a tela (teto de ~8,3 MP) | 8× | 8192 | 4096 | jacarandás, árvores e cercas vivas em malha 3D | 1,5× |
| Alta | até 2× (telas de alta densidade) | 4× | 4096 | 2048 | jacarandás e árvores em malha 3D | 1× |
| Equilibrado | até 1,5× | 4× | 2048 | 2048 | impostores | 0,7× |
| Desempenho | 0,8× | SMAA | 1024 | 1024 | impostores | 0,35× |

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

Ver `public/CREDITOS.md`. Todos os recursos de terceiros são do Poly Haven (CC0).
