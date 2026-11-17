# Partículas do Terminal Motion

- `terminalMotion.particleCount`: 0–80 bolhas/segundo no total; 0 desliga. Padrão: 12.
- Máximo de 160 partículas vivas, com reutilização dos objetos e desenho limitado a aproximadamente 30 fps. Um canvas transparente, sem blur por partícula e com DPR limitado a 1,5.
- Raio inicial aleatório entre 5,5% e 16% da fonte do emissor; deslocamento e espessura também escalam com a fonte. A bolha cresce suavemente durante sua vida.
- Reutiliza a leitura das linhas visíveis alteradas pelo xterm, as cores ANSI/truecolor e o filtro cromático do blur. Não modifica a saída, não lê scrollback e não examina o buffer durante a animação.
- Palavras são delimitadas por células, respeitando espaços, caracteres largos e combinantes. Branco/cinza, texto invisível/dim e trechos sem letras/números não emitem.
- O HUD tem emissores cacheados, atualizados por mutações/layout/fonte/tema, sem medições DOM no loop de partículas.
- Sem foco, com documento oculto, sem emissores ou com Motion desligado: cancela o loop e limpa as bolhas. Scroll, troca de buffer, remoção/recoloração e resize invalidam partículas antigas.
- O controle explícito de Motion do aplicativo continua sendo a preferência de animação. O shimmer aleatório foi removido; seleção e carregamento não mudaram.

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
