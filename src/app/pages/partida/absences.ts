import { Injury } from '../../api/api-football';
import { shortName } from './lineups';
import { PLAYER_PLACEHOLDER } from '../../shared/player-photo';

/** Desfalque como aparece na lista: nome curto, motivo em português e o ícone. */
export interface Absence {
  key: string;
  name: string;
  photo: string;
  /** Motivo traduzido ("Lesão no joelho", "Suspenso (3º amarelo)"); `null` se a API não disse. */
  reason: string | null;
  /** Ícone: lesão (cruz), cartão amarelo/vermelho (suspensão) ou outro motivo. */
  kind: 'injury' | 'yellow' | 'red' | 'other';
  /** Dúvida para o jogo (e não fora com certeza); só até sair a escalação. */
  doubtful: boolean;
}

// Motivos da API (em minúsculas) traduzidos.
const REASONS: Record<string, string> = {
  injury: 'Lesão',
  'muscle injury': 'Lesão muscular',
  'knee injury': 'Lesão no joelho',
  'ankle injury': 'Lesão no tornozelo',
  'foot injury': 'Lesão no pé',
  'thigh injury': 'Lesão na coxa',
  'hamstring injury': 'Lesão na posterior da coxa',
  'calf injury': 'Lesão na panturrilha',
  'groin injury': 'Lesão na virilha',
  'hip injury': 'Lesão no quadril',
  'back injury': 'Lesão nas costas',
  'lower back injury': 'Lesão na lombar',
  'leg injury': 'Lesão na perna',
  'heel injury': 'Lesão no calcanhar',
  'toe injury': 'Lesão no dedo do pé',
  'elbow injury': 'Lesão no cotovelo',
  'jaw injury': 'Lesão na mandíbula',
  'eye injury': 'Lesão no olho',
  'ribs injury': 'Lesão nas costelas',
  'shoulder injury': 'Lesão no ombro',
  'arm injury': 'Lesão no braço',
  'hand injury': 'Lesão na mão',
  'wrist injury': 'Lesão no punho',
  'head injury': 'Lesão na cabeça',
  'face injury': 'Lesão no rosto',
  'rib injury': 'Lesão nas costelas',
  'achilles tendon injury': 'Lesão no tendão de Aquiles',
  'cruciate ligament injury': 'Lesão no ligamento cruzado',
  'ligament injury': 'Lesão ligamentar',
  'meniscus injury': 'Lesão no menisco',
  'broken leg': 'Fratura na perna',
  'broken ankle': 'Fratura no tornozelo',
  'broken foot': 'Fratura no pé',
  'broken arm': 'Fratura no braço',
  'broken nose': 'Fratura no nariz',
  'broken hand': 'Fratura na mão',
  'broken rib': 'Fratura na costela',
  contusion: 'Contusão',
  overload: 'Sobrecarga muscular',
  concussion: 'Concussão',
  knock: 'Pancada',
  illness: 'Doença',
  'health problems': 'Problema de saúde',
  virus: 'Virose',
  surgery: 'Cirurgia',
  'lack of fitness': 'Sem condição física',
  'lacking match fitness': 'Sem ritmo de jogo',
  fatigue: 'Desgaste físico',
  rest: 'Poupado',
  'coach decision': 'Opção do técnico',
  "coach's decision": 'Opção do técnico',
  'personal reasons': 'Motivos pessoais',
  'international duty': 'Seleção',
  'loan agreement': 'Cláusula de empréstimo',
  'transfer negotiations': 'Em negociação',
  inactive: 'Indisponível',
  suspended: 'Suspenso',
  'red card': 'Suspenso (cartão vermelho)',
  'yellow cards': 'Suspenso (3º amarelo)',
  'yellow card': 'Suspenso (3º amarelo)',
};

const SUSPENSION = new Set(['suspended', 'red card']);
const YELLOWS = new Set(['yellow cards', 'yellow card']);

// Ordem da lista: suspensos por vermelho, por amarelos, lesionados e os demais motivos.
const KIND_ORDER: Record<Absence['kind'], number> = { red: 0, yellow: 1, injury: 2, other: 3 };

/**
 * Desfalques de um time, na ordem de `KIND_ORDER` (no mesmo motivo, fora antes de dúvida), e o mesmo
 * jogador uma vez só (a API às vezes o repete). Jogador sem cadastro (sem id) é identificado pelo nome.
 *
 * Com a escalação divulgada (`lineup`: chaves de titulares e reservas, ver `playerKey`), não há mais
 * dúvida: quem foi relacionado sai da lista e os demais ficam como fora do jogo.
 */
export function absences(injuries: Injury[], teamId: number, lineup?: Set<string>): Absence[] {
  const seen = new Set<string>();
  const list: Absence[] = [];
  for (const { player, team } of injuries) {
    if (team.id !== teamId) continue;
    const key = player.id ? `id:${player.id}` : `name:${player.name.trim().toLowerCase()}`;
    if (seen.has(key) || lineup?.has(key)) continue;
    seen.add(key);
    const reason = player.reason?.trim().toLowerCase() ?? '';
    list.push({
      key,
      name: shortName(player.name),
      photo: player.photo || PLAYER_PLACEHOLDER,
      reason: player.reason ? (REASONS[reason] ?? player.reason) : null,
      kind: YELLOWS.has(reason) ? 'yellow' : SUSPENSION.has(reason) ? 'red' : /injur|broken|knock|concussion|surgery|ligament|meniscus|contusion|overload/.test(reason) ? 'injury' : 'other',
      doubtful: !lineup && player.type === 'Questionable',
    });
  }
  return list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || Number(a.doubtful) - Number(b.doubtful));
}
