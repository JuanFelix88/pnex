# Terminal Motion

## Partículas

- `terminalMotion.particleCount`: 0–80 bolhas/segundo no total; 0 desliga. Padrão: 12.
- Máximo de 160 partículas vivas, com reutilização dos objetos e desenho limitado a aproximadamente 30 fps. Um canvas transparente, sem blur por partícula e com DPR limitado a 1,5.
- Quando há bolhas visíveis, o WebGL2 calcula trajetória, raio, opacidade e contorno em shaders e desenha o lote com uma chamada instanciada. O buffer tem tamanho fixo, só é reenviado quando o lote muda ou o relógio relativo é recalibrado, e é liberado ao desligar as bolhas ou fechar a janela. Se o WebGL2 não iniciar ou perder o contexto, o Canvas 2D assume.
- Raio inicial aleatório entre 5,5% e 16% da fonte do emissor; deslocamento e espessura também escalam com a fonte. A bolha cresce suavemente durante sua vida.
- Reutiliza a leitura das linhas visíveis alteradas pelo xterm, as cores ANSI/truecolor e o filtro cromático do blur. Não modifica a saída, não lê scrollback e não examina o buffer durante a animação.
- Trechos não vazios são delimitados por células, respeitando espaços, caracteres largos e combinantes. Letras, números, hastes, bordas, barras e outros símbolos coloridos emitem; branco/cinza e texto invisível/dim continuam excluídos.
- O HUD tem emissores cacheados, atualizados por mutações/layout/fonte/tema, sem medições DOM no loop de partículas.
- Cada bolha guarda sua posição, cor e tamanho de fonte ao nascer. Remover, recolorir ou mover o conteúdo, rolar a tela ou trocar de buffer só altera os emissores; bolhas existentes terminam sua vida de 1,2–2 segundos na posição original da tela.
- Sem emissores, o loop continua apenas até a última bolha expirar e então para. Com a opção de foco ligada, ao perder foco ele também para. Documento oculto, Motion desligado, redimensionamento ou destruição do canvas cancelam o loop e limpam as bolhas.
- O controle explícito de Motion do aplicativo continua sendo a preferência de animação. O shimmer aleatório foi removido; seleção e carregamento não mudaram.

## Brilho do texto

- A grade mantém uma máscara de texto em Canvas 2D a meia resolução. Linhas com conteúdo e estilo idênticos não são redesenhadas nem reenviadas ao WebGL.
- O WebGL2 aplica um gaussiano separável a um quarto da resolução, com upload da faixa alterada e sem loop de animação próprio. O pulso de digitação continua ajustando a opacidade, sem recalcular a máscara.
- Se o contexto não iniciar ou for perdido, a máscara continua disponível e volta a ser exibida com blur CSS. O HUD do prompt continua usando CSS.
## Verificação

```sh
node --test tests/terminal-motion.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --no-bundle
```

Os testes JS usam os módulos reais com canvas/RAF determinísticos. Cobrem filtros, células Unicode, cores, linhas alteradas, tamanho proporcional à fonte, orçamento global e ciclo de vida. Os testes Rust cobrem configuração legada, limites, persistência e proteção contra salvamento obsoleto de outra janela.

## Referências

- [MDN: otimização de Canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas): separar camadas estáticas/animadas, evitar shadowBlur e usar requestAnimationFrame.
- [xterm: IBufferCell](https://xtermjs.org/docs/api/terminal/interfaces/ibuffercell/): cores por paleta/RGB, atributos e largura de células.
