/** Frases de fundo: termos de análise do comportamento passando devagar atrás do jogo. */
export const FRASES = [
  'reforço positivo',
  'contingência de três termos',
  'SD → R → SR',
  'modelagem por aproximações sucessivas',
  'João Henrique Schuster behaviorista molar',
  'lei da igualação',
  'razão fixa',
  'intervalo variável',
  'extinção',
  'surto de extinção',
  'controle de estímulos',
  'comportamento verbal',
  'operante',
  'respondente',
  'behaviorismo radical',
  'seleção por consequências',
  'Keller & Schoenfeld',
  'Carolina Bori',
  'equivalência de estímulos',
  'reforçador condicionado',
  'privação e saciação',
  'registro cumulativo',
  'análise funcional',
  'AC',
  'PCDC',
  'Programação de Condições para o Desenvolvimento de Comportamentos',
  'Carolina Bori e a PCDC',
  'Nádia Kienen',
  'Anna Ramos',
  'Olga Kubo',
  'Botomé',
  'Helder',
  'comportamento-objetivo',
  'programação de ensino',
  'aprendizagem sem erro',
  'o rato tem sempre razão',
];

/** Monta o fundo uma vez, fora da área que o jogo redesenha. */
export function mountTicker(): void {
  if (document.querySelector('.ticker')) return;
  const ticker = document.createElement('div');
  ticker.className = 'ticker';
  ticker.setAttribute('aria-hidden', 'true');
  const rows = 7;
  for (let r = 0; r < rows; r++) {
    // cada linha começa num ponto diferente da lista, para as linhas não se repetirem lado a lado
    const order = FRASES.map((_, i) => FRASES[(i * 5 + r * 3) % FRASES.length]);
    const text = order.join('  ·  ');
    const row = document.createElement('div');
    row.className = 'ticker-row';
    row.style.top = `${4 + r * 14}%`;
    row.style.animationDuration = `${90 + r * 17}s`;
    row.style.animationDirection = r % 2 ? 'reverse' : 'normal';
    const span = document.createElement('span');
    span.textContent = `${text}  ·  ${text}  ·  `;
    row.append(span);
    ticker.append(row);
  }
  document.body.prepend(ticker);
}
