# Liquid Cursor — parâmetros anteriores

Valores preservados para rollback da regulagem de resposta tátil do cursor.

Arquivo: `src/liquid-cursor.ts`

```ts
const BLINK_DELAY_MS = 170;
const BLINK_INTERVAL_MS = 140;
const CORNER_COUNT = 4;
const SPRING_STIFFNESS = 3_600;
const DIRECTIONAL_STRETCH = 0.2;
const MAXIMUM_TRAIL_CELLS = 4;
const MAXIMUM_FRAME_GAP_SECONDS = 0.25;
const MAXIMUM_DEVICE_PIXEL_RATIO = 2;
const TYPING_PULSE_SCALE = 0.06;
const TYPING_PULSE_DECAY = 260;
const CURSOR_OPACITY = 0.88;
```

Para desfazer somente a nova regulagem, restaure estes valores:

```ts
const SPRING_STIFFNESS = 3_600;
const DIRECTIONAL_STRETCH = 0.2;
const MAXIMUM_TRAIL_CELLS = 4;
const TYPING_PULSE_SCALE = 0.06;
const TYPING_PULSE_DECAY = 260;
```

Os parâmetros de blink não foram alterados.
