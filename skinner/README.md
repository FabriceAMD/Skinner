# Caixa Skinner

Jogo de laboratório de análise do comportamento: você treina um rato virtual com o clique, como num
laboratório de verdade, só que com tempo acelerado. Roda no navegador (celular ou computador), sem servidor.

Inspirado no **Sniffy, the Virtual Rat**, no **Fred, o Rato Operante** (Pedro Aché Sales; só ideias, nenhum
código ou arte copiados, pela licença CC BY-NC-ND), (treino de comedouro, modelagem, registro cumulativo, janela da
"mente" do rato) e no **Training Game** de Karen Pryor (clique = reforço; o timing é o que importa).

## Missões

Um toque em **Jogar** e o jogo segue sozinho de fase em fase. O clique solta a pelota do teto, onde o rato
está, com um clarão verde na hora: ele termina o gesto em curso e come ali. O botão 🔔 acende na hora boa de
clicar, tem só um intervalo mecânico curto e pulsa (e vibra) se a pessoa demora. A velocidade (1×, 2×, 4×,
8×) fica sempre visível embaixo do botão.

1. 🔔 **Clique = comida**: o clique vira reforçador condicionado.
2. 🎯 **Modelagem**: etapas ➡️ 👃 🐾 ⬇️. O critério sobe a cada 2 acertos e desce se ficar 45 s sem acerto.
3. ⚙️ **Reforço contínuo**, 4. 🔁 **Razão fixa 5**, 5. 🚫 **Extinção**, 6. 💡 **Luz que manda**: fases
   automáticas com tempo acelerado e registro cumulativo no lugar do botão.

E um **laboratório livre** com esquemas (CRF, FR, VR, VI, FI, extinção) e luz.

## Teste com jogador simulado (`tests/persona`)

Um jogador de 20 e poucos anos no celular, que não lê instruções e para em 5 minutos: toca quando o botão
acende, com tempo de reação humano, às vezes perde a deixa e às vezes toca por tédio. Três perfis (atento,
distraído, ansioso), 10 ratos cada. O teste exige que a maioria complete o ciclo inteiro e que a mediana
fique abaixo de 5 minutos.

## Como o rato funciona (`src/game/sim.ts`)

- Nove comportamentos (explorar, farejar, levantar, se limpar, ir ao comedouro, ir até a barra, cheirar,
  apoiar e pressionar). O rato escolhe o próximo em proporção à força de cada um.
- **Contiguidade:** o reforço fortalece o que aconteceu logo antes, por um traço que decai em cerca de 1 s.
- **Força relativa:** a soma das forças é limitada; reforçar um comportamento tira espaço dos outros.
- **Indução:** reforçar um elo da cadeia até a barra deixa o próximo elo um pouco mais provável.
- **Clique condicionado:** o pareamento clique → comida faz o clique reforçar na hora (Rescorla-Wagner).
- **Indução pela extinção:** segurar o reforço faz aparecer o passo seguinte da cadeia até a barra.
- **Corrida de razão:** quem espera reforço continua pressionando, por isso a razão fixa rende mais que o CRF.
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
