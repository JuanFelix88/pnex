# Diagnóstico do Liquid Cursor — pnex

**Data da coleta:** 14/07/2026  
**Repositório:** `C:/www/oss/pnex`  
**Branch:** `main`  
**Commit analisado:** `ea86e185f339d01d29c224e5e130eba4e9a8643e`  
**Relatório estruturado complementar:** [`liquid-cursor-diagnostic-2026-07-14.json`](./liquid-cursor-diagnostic-2026-07-14.json)

> Este documento foi sanitizado. Não contém usuário, hostname, números de série, UUID, MAC, IP, IDs PnP completos ou caminhos do perfil do usuário.

## 1. Resumo executivo

O defeito no qual o Liquid Cursor cresce até preencher toda a tela é explicado com confiança muito alta por uma **instabilidade numérica no integrador de mola implementado em `src/liquid-cursor.ts`**.

A física do cursor é executada em JavaScript na thread principal e atualizada com `requestAnimationFrame`. O código usa uma integração explícita/semi-implícita cuja estabilidade depende diretamente do tempo entre frames. Os parâmetros atuais tornam o sistema instável até mesmo próximo de 60 FPS para alguns cantos do cursor.

Quando a máquina perde frames, as posições e velocidades dos quatro vértices crescem exponencialmente. Como esses vértices formam um polígono desenhado em um canvas que cobre toda a tela do terminal, o polígono passa a atravessar o canvas inteiro e aparenta “preencher a tela”.

### Conclusão principal

- **CPU como causa raiz:** não.
- **GPU como causa raiz:** não.
- **Driver como causa raiz:** improvável.
- **Desempenho da máquina como gatilho:** sim.
- **Defeito no código como causa raiz:** sim.

Uma máquina com APU, GPU integrada ou CPU mais lenta pode reproduzir o problema com maior frequência por produzir frames mais longos ou irregulares. Entretanto, trocar CPU, GPU ou driver não corrige a matemática instável.

A primeira correção deve ser tornar a animação independente da cadência de frames e adicionar proteções de finitude, deslocamento e velocidade.

---

## 2. Estado do repositório

O repositório foi atualizado por fast-forward e está alinhado com `origin/main`:

| Item | Valor |
|---|---|
| HEAD antes do pull | `1a432ff4df63f20b87d208780e70eb8827930bda` |
| HEAD depois do pull | `ea86e185f339d01d29c224e5e130eba4e9a8643e` |
| Diferença para `origin/main` | 0 commits à frente, 0 atrás |
| Estratégia do pull | `--ff-only` |
| Resultado | sucesso |

Um `pnex.exe` local não rastreado e diferente do binário remoto foi preservado antes do pull no diretório temporário do sistema com o nome:

```text
pnex-local-before-pull-20260714-222407.exe
```

O diretório não rastreado `release/` foi mantido intacto.

### Mudança arquitetural importante

Antes do pull, o checkout ainda correspondia à versão Electron. Os quatro commits recebidos migraram o projeto para Tauri e implementaram o Liquid Cursor:

| Commit | Data | Alteração |
|---|---|---|
| `e61ba0b` | 13/07/2026 | migração para Tauri |
| `d71958a` | 14/07/2026 | implementação do Liquid Cursor |
| `f7078ac` | 14/07/2026 | refinamento do cursor; stiffness aumentou de 2400 para 2500 |
| `ea86e18` | 14/07/2026 | animações de título e indicador de execução |

O aumento de stiffness de 2400 para 2500 reduziu ligeiramente a margem de estabilidade da animação.

### Arquitetura atual

- Tauri 2;
- TypeScript + Vite;
- Microsoft Edge WebView2 no Windows;
- xterm.js 6;
- renderer WebGL do xterm;
- Canvas 2D separado para o Liquid Cursor;
- backend Rust com `portable-pty`.

### Versões relevantes

| Componente | Versão |
|---|---:|
| Aplicativo | 0.1.0 |
| `@tauri-apps/api` | 2.11.1 |
| `@tauri-apps/cli` | 2.11.4 |
| `@xterm/xterm` | 6.0.0 |
| `@xterm/addon-webgl` | 0.19.0 com patch local |
| `@xterm/addon-fit` | 0.11.0 |
| TypeScript | 5.9.3 |
| Vite | 6.4.3 |
| Edge WebView2 Runtime | 150.0.4078.65 |

Nenhum build Rust ou teste Cargo foi executado, conforme solicitado. A tentativa de `pnpm install --frozen-lockfile` foi abortada pelo próprio pnpm antes de modificar `node_modules`, por ausência de TTY.

---

## 3. Configuração atual do pnex

O arquivo `pnex-config.json` foi encontrado na home do usuário, com o caminho absoluto omitido.

| Configuração | Valor |
|---|---|
| `cursorAnimation` | `disabled` |
| Fonte | JetBrainsMono NF |
| Tamanho | 13 px |
| Tema | Fleet Dark |
| Shell | Git Bash |
| Diretório inicial customizado | sim |

O problema relatado ocorre quando `cursorAnimation` é alterado para `liquid`.

Há um detalhe relevante: configurações antigas que não possuem `cursorAnimation` ativam automaticamente o modo `liquid`, porque ele é o padrão tanto no Rust quanto no TypeScript.

---

## 4. Configuração da máquina

### Sistema operacional

| Item | Valor |
|---|---|
| Sistema | Microsoft Windows 11 Pro |
| Versão | 10.0.22621 |
| Build | 22621 |
| Arquitetura | 64-bit |
| DirectX | 12 |
| Sessão | console local, sem RDP |
| Plano de energia | High performance |
| Último boot | 14/07/2026 20:09:36 -03:00 |

`Get-ComputerInfo` retornou “Windows 10 Pro/2009”, mas `Win32_OperatingSystem` e o build identificam Windows 11 Pro. Essa divergência é comum em APIs legadas; neste relatório, `Win32_OperatingSystem` foi usado como fonte principal.

### Placa-mãe e BIOS

| Item | Valor |
|---|---|
| Fabricante/modelo do sistema | INTEL B75 |
| Placa-mãe | INTEL B75 |
| BIOS | American Megatrends 4.6.5 |
| Data da BIOS | 10/10/2023 |
| Firmware | UEFI |
| Hypervisor detectado | sim |
| Virtualização no firmware segundo WMI | não |

### CPU

| Item | Valor |
|---|---|
| Modelo | Intel Core i5-2500K @ 3.30 GHz |
| Núcleos/threads | 4/4 |
| Clock máximo reportado | 3301 MHz |
| Cache L2 | 1 MB |
| Cache L3 | 6 MB |
| Carga instantânea | 8% |
| Média curta do processador total | 39,51% |

O i5-2500K possui gráficos integrados Intel HD Graphics 3000, mas o Windows não enumera essa GPU como adaptador ativo. Nesta instalação, a saída gráfica utiliza a GPU NVIDIA dedicada.

A idade e os quatro threads da CPU podem aumentar a frequência de long frames quando a thread principal do WebView está ocupada. Isso facilita a reprodução, mas não é a causa raiz.

### Memória

| Item | Valor |
|---|---|
| RAM física | aproximadamente 15,96 GiB |
| Disponível no snapshot | aproximadamente 10,1 GiB |
| Memória comprometida | 42,15% |
| Módulos | 2 × Kingston HX318C10F/8 de 8 GB |
| Clock configurado | 1333 MHz |
| Pagefile | 1024 MiB; 27 MiB em uso |

Não havia pressão de memória suficiente para explicar o sintoma.

### Armazenamento

| Item | Valor |
|---|---|
| Modelo | SanDisk SSD PLUS 240GB |
| Status | OK |
| Sistema de arquivos | NTFS |
| Espaço livre | aproximadamente 38,2 GiB |
| Volume marcado como sujo | não |

O armazenamento não apresenta relação provável com o defeito gráfico.

### Monitor

| Item | Valor |
|---|---|
| Resolução | 2560 × 1080 |
| Frequência | 60 Hz |
| Profundidade | 32 bits |
| DPI aplicado | 96 |
| `devicePixelRatio` estimado | 1 |
| HDR | não suportado |
| Espaço de cor | `DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709` |

O monitor operar a 60 Hz é relevante: um frame ideal dura aproximadamente **16,67 ms**, já acima do limite estável calculado para parte da animação.

---

## 5. GPU, driver e WebView2

### GPU principal

| Item | Valor |
|---|---|
| Modelo | NVIDIA GeForce GTX 1050 |
| Tipo | dedicada/discreta |
| VRAM | 2 GB |
| Status | OK |
| Driver NVIDIA | 582.66 |
| Driver Windows | 32.0.15.8266 |
| Data do driver | 08/06/2026 |
| Assinado | sim |
| WDDM | 3.1 |
| HAGS | habilitado |
| DirectDraw | habilitado |
| Direct3D | habilitado |
| AGP Texture Acceleration | habilitado |

Snapshot da GPU:

| Métrica | Valor |
|---|---:|
| Uso da GPU | 7% |
| Uso do controlador de memória | 4% |
| VRAM usada | 852 MiB |
| VRAM livre | 1111 MiB |
| Temperatura | 23 °C |
| Estado de performance | P0 |

O WebView2 criou um processo GPU e não foi iniciado com `--disable-gpu`, `--disable-gpu-compositing` ou SwiftShader. Portanto, a aceleração gráfica está ativa.

### Driver de display virtual

Também existe um adaptador:

```text
IddSampleDriver Device HDR
```

Características:

- `ConfigManagerErrorCode = 22`;
- dispositivo desabilitado;
- driver não assinado;
- metadados de fabricante ainda contêm placeholder.

O código 22 significa que o dispositivo está desabilitado, não que esteja falhando ativamente. A probabilidade de ele ser a causa do cursor gigante é baixa. Ainda assim, se não houver uso intencional, é recomendável removê-lo ou atualizá-lo para reduzir variáveis em testes gráficos.

### Eventos gráficos dos últimos 30 dias

Foi encontrado um único cluster em 17/06/2026:

| Provedor | Evento | Nível | Quantidade |
|---|---:|---|---:|
| `nvlddmkm` | 153 | erro | 6 |
| `Display` | 4101 | warning | 1 |

O evento 4101 normalmente indica que o driver de vídeo parou de responder e se recuperou.

Esse incidente ocorreu aproximadamente **27 dias antes** do commit que introduziu o Liquid Cursor. Portanto, mostra que houve um reset antigo do driver, mas não estabelece relação causal com a nova animação.

Também existe um crash de `pnex.exe` 1.1.1 com exceção `c0000409` em 12/07/2026. Ele pertence à antiga versão Electron e antecede a implementação Tauri do Liquid Cursor, portanto não é evidência deste defeito.

---

## 6. Como o Liquid Cursor funciona

### Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `src/liquid-cursor.ts` | física, blink, coordenadas e desenho Canvas 2D |
| `src/main.ts` | criação do xterm, LiquidCursor e addon WebGL |
| `src/styles.css` | canvas sobre toda a tela do terminal e blend mode |
| `src-tauri/src/config.rs` | persistência e valor padrão de `cursorAnimation` |
| `patches/@xterm__addon-webgl@0.19.0.patch` | altera blink nativo do xterm |

### Pipeline de renderização

1. O xterm é criado com `allowTransparency: true`.
2. Quando o modo `liquid` está ativo, o cursor nativo do xterm recebe cor totalmente transparente.
3. `LiquidCursor` cria um canvas dentro de `.xterm-screen`.
4. O canvas cobre toda a área do terminal.
5. Quatro pontos representam os cantos do cursor.
6. Cada ponto segue seu alvo por uma mola amortecida.
7. A atualização ocorre a cada `requestAnimationFrame`.
8. O polígono é desenhado com Canvas 2D.
9. O CSS aplica `mix-blend-mode: difference`.
10. Separadamente, o conteúdo do terminal usa o addon WebGL do xterm.

O addon WebGL possui fallback para renderer DOM após perda de contexto. O Canvas 2D do Liquid Cursor é independente desse addon, embora ambos sejam compostos pelo WebView2/GPU.

### Trechos críticos

| Local | Função |
|---|---|
| `src/liquid-cursor.ts:18` | stiffness base de 2500 |
| `src/liquid-cursor.ts:20` | variação direcional de 30% |
| `src/liquid-cursor.ts:288-295` | limite do trail |
| `src/liquid-cursor.ts:314` | `deltaTime` limitado a no máximo 1/30 s |
| `src/liquid-cursor.ts:327-328` | cálculo de stiffness e damping |
| `src/liquid-cursor.ts:330-333` | integração da velocidade e posição |
| `src/liquid-cursor.ts:354-368` | limpeza e desenho do canvas |
| `src/styles.css:225-230` | canvas de tela inteira e blend mode |
| `src/main.ts:256-264` | inicialização do addon WebGL |

---

## 7. Causa raiz: instabilidade numérica

Os parâmetros atuais são:

```text
SPRING_STIFFNESS      = 2500
SPRING_DAMPING_RATIO  = 1
DIRECTIONAL_STRETCH   = 0.3
MAXIMUM_TRAIL_CELLS   = 6
máximo de deltaTime   = 1/30 s = 33,33 ms
```

O stiffness efetivo varia aproximadamente entre 1750 e 3250 conforme a direção e o canto.

A atualização usada é equivalente a uma integração semi-implícita:

```text
velocity += acceleration * deltaTime
position += velocity * deltaTime
```

Esse método não é incondicionalmente estável. Com o stiffness e damping atuais, os limites calculados são:

| Caso | Stiffness | Maior frame estável | Raio em 60 Hz | Raio em 50 Hz | Raio em 30 Hz |
|---|---:|---:|---:|---:|---:|
| canto traseiro | 1750 | 19,803 ms | 0,691 | 1,028 | 3,279 |
| neutro | 2500 | 16,568 ms | 1,017 | 1,618 | 4,617 |
| canto dianteiro | 3250 | 14,531 ms | 1,432 | 2,170 | 5,887 |

Um raio espectral acima de 1 significa que o erro cresce a cada frame.

### Observação crítica

Em 60 Hz, cada frame dura aproximadamente 16,667 ms:

- esse tempo já excede o limite neutro de 16,568 ms;
- excede claramente o limite de 14,531 ms do canto dianteiro;
- o código permite um passo de até 33,333 ms;
- portanto, a animação pode divergir mesmo sem um travamento de GPU.

### Simulação representativa em 30 FPS

Com erro inicial de 100 pixels e oito frames:

| Caso | Erro após 8 frames |
|---|---:|
| stiffness neutro | aproximadamente 9,2 milhões de pixels |
| canto dianteiro | aproximadamente 70 milhões de pixels |

Isso explica diretamente o sintoma: o polígono cresce muito além do canvas e o atravessa por completo.

### Proteções ausentes

O código atual não possui:

- `Number.isFinite` para tempo, posição ou velocidade;
- clamp de velocidade;
- limite individual por vértice;
- recuperação quando um vértice sai muito além do canvas;
- substeps para frames longos;
- telemetria de frame time ou coordenadas;
- recuperação específica após long task/background-resume.

`limitTrail()` limita a distância média do centro, mas não controla as velocidades. Além disso, não é aplicado como proteção em cada subpasso da física. Uma vez iniciada a divergência, as velocidades podem continuar crescendo.

---

## 8. Relação com CPU, APU, GPU e driver

### CPU/APU

A física é calculada na thread principal. Uma máquina com:

- CPU mais lenta;
- APU compartilhando memória;
- GPU integrada mais lenta;
- RAM em single channel;
- maior carga do WebView;
- processos em segundo plano;

pode produzir frames de 20, 30 ou mais milissegundos. Isso acelera a divergência.

Portanto, a diferença entre a máquina com GPU dedicada e a máquina com APU é plausível como **gatilho de reprodução**, mas não como explicação fundamental.

### GPU

A GPU participa da rasterização/composição do Canvas 2D, do blend mode e do renderer WebGL do xterm. Porém, os números usados para formar o polígono são calculados pelo JavaScript.

Uma GPU mais rápida pode esconder parcialmente o defeito mantendo frames menores. Uma GPU/APU mais lenta pode expô-lo. Nenhuma delas torna o integrador matematicamente correto.

### Driver

O driver pode afetar frame pacing, context loss ou composição, mas:

- a GPU NVIDIA está operacional;
- o processo GPU do WebView2 existe;
- Direct3D está habilitado;
- não há flag `--disable-gpu`;
- o único reset encontrado antecede a feature;
- a análise matemática já reproduz o crescimento explosivo sem falha de driver.

Assim, o driver deve ser investigado somente se o problema persistir após estabilizar a animação.

---

## 9. Hipóteses ranqueadas

### 1. Integrador de mola instável — confiança 98%

**Papel:** causa raiz.

Evidências:

- limites calculados menores ou iguais ao frame de 60 Hz;
- passo permitido de 33,33 ms sem substeps;
- ausência de guards;
- simulação reproduz crescimento explosivo;
- sintoma visual é compatível com polígono gigante em canvas de tela inteira.

### 2. Diferenças de frame pacing na máquina APU — confiança 85%

**Papel:** gatilho/amplificador.

Uma APU ou CPU mais lenta aumenta a ocorrência de frames longos e irregulares, fazendo o defeito aparecer mais rapidamente.

### 3. Driver NVIDIA/WebView2 como causa principal — confiança 12%

**Papel:** possível fator secundário.

Existe histórico antigo de reset do driver, mas a aceleração atual está operacional e o código já é instável sem falha gráfica.

### 4. IddSampleDriver — confiança 3%

O dispositivo está desabilitado com código 22. Baixa probabilidade de relação direta.

### 5. RAM, VRAM ou disco — confiança 2%

O snapshot mostrou recursos disponíveis e dispositivos em estado normal.

---

## 10. Plano de correção recomendado

### Prioridade 0 — corrigir a causa raiz

1. Substituir o integrador por uma solução de mola estável e independente do frame rate.
2. Preferir uma solução analítica para mola criticamente amortecida.
3. Como alternativa mínima, dividir `deltaTime` em substeps fixos pequenos, por exemplo `<= 1/120 s`, preferencialmente `<= 1/240 s`.
4. Adicionar `Number.isFinite` para tempo, posições e velocidades.
5. Executar `snapToTarget()` quando houver valor inválido ou fora de limites razoáveis.
6. Limitar deslocamento e velocidade de cada canto.
7. Recuperar após resize, troca de buffer, retorno do background e long tasks.

### Prioridade 1 — testes automatizados

Testar frame times de:

```text
8,33 ms
14 ms
16,67 ms
20 ms
33,33 ms
100 ms
1000 ms
```

Os testes devem garantir que:

- nenhuma posição ou velocidade vire `NaN`/`Infinity`;
- nenhum vértice ultrapasse o trail permitido;
- o cursor sempre converja ao alvo;
- resize, scroll, salto de linha e troca de buffer sejam seguros;
- sequências irregulares de frame time também permaneçam estáveis.

### Prioridade 2 — instrumentação temporária

Registrar em modo diagnóstico:

- `deltaTime` atual e máximo;
- FPS;
- `devicePixelRatio`;
- maior posição e velocidade;
- distância máxima ao alvo;
- quantidade de recoveries;
- renderer xterm ativo;
- perda de contexto WebGL.

Um overlay simples com `dt`, `maxVelocity` e `maxDistance` deve mostrar o frame exato em que a divergência começa.

### Prioridade 3 — matriz A/B

Executar na mesma versão e resolução:

| Cenário | Liquid | xterm WebGL | GPU WebView2 |
|---|---|---|---|
| Controle | desligado | ligado | ligada |
| A | ligado | ligado | ligada |
| B | ligado | desligado/DOM | ligada |
| C, apenas diagnóstico | ligado | qualquer | `--disable-gpu` |

Se A e B falharem igualmente, o addon WebGL do xterm não é a origem. Se C também falhar, isso reforça ainda mais a causa na física JavaScript.

Alterar HAGS ou instalar outro driver deve ocorrer somente depois da correção matemática, para não confundir causa com gatilho.

---

## 11. Dados necessários da máquina com APU

Para comparação objetiva, coletar:

- modelo exato da CPU/APU;
- GPU integrada detectada pelo Windows;
- quantidade de RAM e configuração single/dual channel;
- frequência da RAM;
- versão e data do driver da APU;
- Windows e build;
- versão do WebView2;
- DirectX e WDDM;
- resolução, refresh rate, DPI e `devicePixelRatio`;
- HAGS ligado/desligado;
- processo GPU do WebView2 presente ou ausente;
- uso de SwiftShader ou `--disable-gpu`;
- eventos Display 4101 no horário exato da falha;
- frame times máximos;
- commit executado;
- configuração `cursorAnimation`;
- resultados da matriz A/B.

A comparação só será válida se ambas as máquinas usarem o mesmo commit, versão do app, resolução lógica, configuração e sequência de teste.

---

## 12. Acompanhamento do driver

Se o problema continuar após corrigir o integrador:

1. verificar eventos `Display 4101` e `nvlddmkm` no minuto exato da reprodução;
2. fazer instalação limpa de um driver NVIDIA estável;
3. investigar ou remover `IddSampleDriver` se ele não tiver uso intencional;
4. testar HAGS ligado e desligado;
5. capturar perda de contexto do WebGL e status do processo GPU do WebView2.

Não usar aumento de `TdrDelay` como correção. Isso apenas mascara travamentos da GPU e não estabiliza a física.

---

## 13. Limitações do diagnóstico

- Ainda não existe snapshot equivalente da máquina com APU.
- O defeito não foi reproduzido de forma controlada nesta sessão porque a configuração atual está `disabled` e o ambiente do usuário não foi alterado.
- Nenhuma compilação Rust foi executada.
- A página interna `chrome://gpu` do WebView2 não foi aberta.
- Métricas de uso são snapshots, não uma captura do momento exato da falha.
- A análise numérica é estática e representativa; deve ser transformada em teste automatizado durante a correção.

---

## 14. Avaliação final

O defeito mais provável está em:

```text
src/liquid-cursor.ts:314
src/liquid-cursor.ts:327-333
```

Ele é agravado por:

```text
src/styles.css:225-230
```

A causa é o uso de um integrador de mola instável para os frame times reais, sem substeps, clamps ou recuperação. A GPU dedicada desta máquina mantém boa parte do pipeline rápido, enquanto uma APU pode produzir frame times maiores e tornar a falha mais evidente.

**Recomendação final:** corrigir primeiro a integração temporal e adicionar limites de segurança. Somente depois disso comparar drivers, HAGS, WebGL e hardware.
