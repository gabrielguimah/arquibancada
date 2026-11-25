// "Onde assistir": canais de cada jogo do Brasileirão, da página "Onde assistir" do site da CBF. A página
// busca os dados deste endereço (JSON, sem login). Não é uma API pública documentada: se ela mudar ou sair
// do ar, a busca falha e o site só não mostra a seção.

export const BROADCASTS_PATH = 'onde-assistir';

const CBF_URL = 'https://www.cbf.com.br/api/cbf/onde-assistir/jogos';
// Campeonato Brasileiro (42), Série A (1), na CBF.
const SERIE_A = { campeonato: '42', categoria: '1' };
// A lista vem em páginas de 15 jogos (todos os campeonatos da CBF no dia).
const MAX_PAGES = 6;

// Clubes da Série A: id na CBF → id na API-Football. Clube fora da tabela (ex.: promovido na próxima
// temporada) vai sem id, só com o nome; o site tenta pelo nome.
const CBF_TEAMS: Record<string, number> = {
  '61377': 118, // Bahia
  '20011': 119, // Internacional
  '60175': 120, // Botafogo
  '20002': 121, // Palmeiras
  '20014': 124, // Fluminense
  '20005': 126, // São Paulo
  '20016': 127, // Flamengo
  '20008': 128, // Santos
  '20013': 130, // Grêmio
  '20001': 131, // Corinthians
  '20086': 132, // Chapecoense
  '60646': 133, // Vasco da Gama
  '20052': 134, // Athletico-PR
  '59849': 135, // Cruzeiro
  '20018': 136, // Vitória
  '61590': 147, // Coritiba
  '20007': 794, // Bragantino
  '62194': 1062, // Atlético-MG
  '20022': 1198, // Remo
  '20385': 7848, // Mirassol
};

interface CbfClub {
  id: string;
  nome: string;
}

interface CbfGame {
  data: string;
  hora: string;
  mandante: CbfClub;
  visitante: CbfClub;
  transmissoes?: Array<{ nome: string }>;
  competicao: { campeonato_id: string; categoria_id: string };
}

export interface Broadcast {
  /** Id do time na API-Football; `null` se o clube não está na tabela (aí vale o nome). */
  home: number | null;
  away: number | null;
  homeName: string;
  awayName: string;
  /** Horário (Brasília), "HH:MM". */
  time: string;
  channels: string[];
}

/** `date` no formato AAAA-MM-DD? */
export function validDate(date: string | null): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
}

/** Jogos da Série A num dia (Brasília) com os canais, direto da CBF. Lança erro se a CBF falhar. */
export async function fetchBroadcasts(date: string): Promise<Broadcast[]> {
  const games: CbfGame[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${CBF_URL}?${new URLSearchParams({ dataInicio: date, dataTermino: date, page: String(page) })}`;
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Arquibancada)' } });
    if (!res.ok) throw new Error(`CBF respondeu ${res.status}`);
    const body = (await res.json()) as { jogos?: CbfGame[]; meta?: { last_page?: number } };
    games.push(...(body.jogos ?? []));
    if (page >= (body.meta?.last_page ?? 1)) break;
  }
  return games
    .filter((g) => g.competicao?.campeonato_id === SERIE_A.campeonato && g.competicao?.categoria_id === SERIE_A.categoria)
    .map((g) => ({
      home: CBF_TEAMS[g.mandante.id] ?? null,
      away: CBF_TEAMS[g.visitante.id] ?? null,
      homeName: g.mandante.nome,
      awayName: g.visitante.nome,
      time: g.hora,
      channels: (g.transmissoes ?? []).map((t) => t.nome.trim()).filter(Boolean),
    }))
    .filter((b) => b.channels.length > 0);
}

/**
 * Por quanto tempo (s) guardar os canais de um dia: a CBF anuncia com antecedência, mas ajusta perto do
 * jogo. Hoje e amanhã: 1 h; dias passados: 1 semana; mais à frente: 6 h.
 */
export function broadcastsTtl(date: string, now = Date.now()): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(now));
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (days < 0) return 7 * 24 * 3600;
  if (days <= 1) return 3600;
  return 6 * 3600;
}
