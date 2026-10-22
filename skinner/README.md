# Caixa Skinner

Simulador de caixa de Skinner para ensino de análise do comportamento. Roda no navegador, sem servidor e sem
cadastro. Nenhum dado sai da máquina do aluno; o registro pode ser exportado em CSV.

## Para o professor

1. Abra a página publicada e escolha uma aula, ou use a **aula livre** com um rato e uma ou duas alavancas.
2. Use a **mesma semente** para toda a turma: o mesmo rato, a mesma sequência de respostas.
3. O aluno escreve a hipótese no caderno antes de mudar o esquema. Ao concluir, o registro é comparado com a
   hipótese.
4. Exporte o CSV para análise em planilha.

O classificador separa FR, FI, DRO, DRL e EXT. **Razão variável (VR) e intervalo variável (VI) não se separam
só pelo registro** quando o rato responde em taxa estável: o próprio sistema informa isso ao aluno. Separar os
dois exige mudar a taxa do rato, o que é um bom exercício.

## Para desenvolver

```bash
npm install
npm test        # motor, esquemas, classificador, conteúdo
npm run dev     # servidor local
npm run build   # typecheck + build estático em dist/
```

Estrutura:

- `src/core/`: motor puro, sem interface. Tempo virtual, RNG com semente, esquemas, ratos, log de eventos,
  classificador e feedback descritivo.
- `src/content/`: ratos, aulas e narração em JSON. Adicionar uma aula não exige código.
- `src/ui/`: interface (caixa, registro cumulativo, caderno).
- `tests/`: testes do motor e do conteúdo.

## Limites do modelo

- O rato é um modelo, não um animal. A variabilidade é controlada e documentada em `src/core/rats.ts`.
- Os modelos molar e Keller são aproximações didáticas, não reproduções fiéis de dados experimentais.
- A narração tem humor de escritório. Punição ainda não está implementada. Quando entrar, será abstrata (um sinal visual, sem conteúdo gráfico).
