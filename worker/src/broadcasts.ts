// "Onde assistir": canais de cada jogo do Brasileirão, da página "Onde assistir" do site da CBF. A página
// busca os dados deste endereço (JSON, sem login). Não é uma API pública documentada: se ela mudar ou sair
// do ar, a busca falha e o site só não mostra a seção.

import { Broadcast, channelName } from '../../src/app/api/broadcast';
import { TEAM_ID_BY_CBF } from '../../src/app/api/team-names';
import { dayInBrasilia } from '../../src/app/shared/fixture-status';

export const BROADCASTS_PATH = 'onde-assistir';

const CBF_URL = 'https://www.cbf.com.br/api/cbf/onde-assistir/jogos';
// Campeonato Brasileiro (42), Série A (1), na CBF.
const SERIE_A = { campeonato: '42', categoria: '1' };
// A lista vem em páginas de 15 jogos (todos os campeonatos da CBF no dia).
const MAX_PAGES = 6;

interface CbfClub {
  id: string;
  nome: string;
}

interface CbfGame {
  mandante: CbfClub;
  visitante: CbfClub;
  transmissoes?: Array<{ nome: string }>;
  competicao: { campeonato_id: string; categoria_id: string };
}

interface CbfPage {
  jogos?: CbfGame[];
  meta?: { last_page?: number };
}

/** `date` no formato AAAA-MM-DD? */
export function validDate(date: string | null): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
}

async function cbfPage(date: string, page: number): Promise<CbfPage> {
  const url = `${CBF_URL}?${new URLSearchParams({ dataInicio: date, dataTermino: date, page: String(page) })}`;
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Arquibancada)' } });
  if (!res.ok) throw new Error(`CBF respondeu ${res.status}`);
  return res.json();
}

/**
 * Jogos da Série A num dia (Brasília) com os canais (nomes como o site mostra), direto da CBF. A 1ª página
 * diz quantas são; as outras vêm juntas. Lança erro se a CBF falhar.
 */
export async function fetchBroadcasts(date: string): Promise<Broadcast[]> {
  const first = await cbfPage(date, 1);
  const last = Math.min(MAX_PAGES, first.meta?.last_page ?? 1);
  const rest = await Promise.all(Array.from({ length: last - 1 }, (_, i) => cbfPage(date, i + 2)));
  return [first, ...rest]
    .flatMap((p) => p.jogos ?? [])
    .filter((g) => g.competicao?.campeonato_id === SERIE_A.campeonato && g.competicao?.categoria_id === SERIE_A.categoria)
    .map((g) => ({
      home: TEAM_ID_BY_CBF.get(g.mandante.id) ?? null,
      away: TEAM_ID_BY_CBF.get(g.visitante.id) ?? null,
      homeName: g.mandante.nome,
      awayName: g.visitante.nome,
      channels: [...new Set((g.transmissoes ?? []).map((t) => channelName(t.nome)).filter(Boolean))],
    }))
    .filter((b) => b.channels.length > 0);
}

/**
 * Por quanto tempo (s) guardar os canais de um dia: a CBF anuncia com antecedência, mas ajusta perto do
 * jogo. Hoje e amanhã: 1 h; dias passados: 1 semana; mais à frente: 6 h.
 */
export function broadcastsTtl(date: string, now = Date.now()): number {
  const days = Math.round((Date.parse(date) - Date.parse(dayInBrasilia(now))) / 86_400_000);
  if (days < 0) return 7 * 24 * 3600;
  if (days <= 1) return 3600;
  return 6 * 3600;
}
