# Caixa Skinner

Jogo de laboratório de análise do comportamento: você treina um rato virtual com o clique, como num
laboratório de verdade, só que com tempo acelerado. Roda no navegador (celular ou computador), sem servidor.

Inspirado no **Sniffy, the Virtual Rat** (treino de comedouro, modelagem, registro cumulativo, janela da
"mente" do rato) e no **Training Game** de Karen Pryor (clique = reforço; o timing é o que importa).

## Missões

1. **Carregar o clique**: o clique vira reforçador condicionado (treino de comedouro).
2. **Modelagem até a barra**: aproximações sucessivas até a pressão.
3. **Reforço contínuo**: o alimentador reforça cada pressão.
4. **Razão fixa 5**: a taxa sobe.
5. **Extinção**: surto de extinção e depois queda.
6. **Luz que manda**: discriminação S+/S− com intervalo variável na luz acesa.

E um **laboratório livre** com esquemas (CRF, FR, VR, VI, FI, extinção) e luz.

## Como o rato funciona (`src/game/sim.ts`)

- Nove comportamentos (explorar, farejar, levantar, se limpar, ir ao comedouro, ir até a barra, cheirar,
  apoiar e pressionar). O rato escolhe o próximo em proporção à força de cada um.
- **Contiguidade:** o reforço fortalece o que aconteceu logo antes, por um traço que decai em cerca de 1 s.
- **Força relativa:** a soma das forças é limitada; reforçar um comportamento tira espaço dos outros.
- **Indução:** reforçar um elo da cadeia até a barra deixa o próximo elo um pouco mais provável.
- **Clique condicionado:** o clique só reforça na hora depois do treino de comedouro (Rescorla-Wagner).
- **Saciedade:** cada pelota sacia; reforço vale menos com o rato saciado.
- **Extinção:** pressão sem reforço perde força quando o rato esperava reforço; a frustração gera o surto.
- **Discriminação:** forças e expectativa separadas para luz acesa e apagada.

O rato é um modelo didático, não um animal.

## Desenvolvimento

```bash
npm install
npm test        # simulação do jogo e motor de esquemas
npm run dev
npm run build   # gera dist/
```
