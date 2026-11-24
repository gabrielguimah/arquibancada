# Arquibancada

[Português](#português) · [English](#english)

---

## Português

**Arquibancada** é um site para acompanhar o **Campeonato Brasileiro Série A** em tempo real: jogos da rodada, placares ao vivo, classificação que se atualiza durante as partidas, estatísticas de jogadores e times e uma página completa para cada partida.

Os dados vêm da [API-Football](https://www.api-football.com/), por meio de um Worker da Cloudflare que guarda a chave da API, faz cache das respostas e monta os rankings que a API não oferece prontos.

### Funcionalidades

**Rodada e classificação**
- Partidas de hoje e jogos da rodada, com seletor de rodada e marcação de jogos atrasados.
- Placar ao vivo com relógio da partida segundo a segundo, intervalo e minuto de acréscimo (`45'+2`).
- Classificação **ao vivo**: soma os jogos em andamento e os já encerrados que a API ainda não contou, reordena pelos critérios do Brasileirão e mostra quantas posições cada time ganhou ou perdeu com os jogos em andamento.
- Zonas (Libertadores, Pré-Libertadores, Sul-Americana, rebaixamento), "Últimas 5" (com o resultado parcial do jogo em andamento) e times jogando agora em destaque.
- Tabelas de times: nota média e estatísticas da temporada e das últimas 5 partidas, com vários critérios de ordenação.

**Página da partida**
- Cabeçalho com placar, situação do jogo, autores dos gols, cartões vermelhos, pênaltis perdidos, data, rodada e estádio.
- **Lance a lance**: gols (com o placar do momento e a assistência), cartões com o motivo, substituições e decisões do VAR, separados por intervalo e fim de jogo.
- **Escalações** no campo (horizontal no computador, vertical no celular), com nota, gols, assistências, cartões, substituições e o melhor da partida; reservas e técnicos.
- Atualização automática antes (para a escalação), durante (a cada 15 s) e logo depois do jogo (notas finais).

**Estatísticas**
- Artilheiros, assistências e melhores notas, com filtro de jogadores regulares.
- Time da rodada em 4-3-3 com as melhores notas e o melhor da rodada.
- Tabela de jogadores com abas (Geral, Ataque, Defesa, Passe, Goleiro, Disciplina), ordenação por qualquer coluna e valores totais, por jogo ou por 90 minutos.

**Geral**
- Avisos de gol (e de gol anulado pelo VAR) na tela e notificações do navegador.
- Modo claro e escuro, layout responsivo e esqueletos de carregamento.

### Tecnologias

- **Site:** [Angular](https://angular.dev/) 21 (componentes standalone e signals) e Angular Material.
- **API:** [Cloudflare Workers](https://workers.cloudflare.com/) com Durable Objects (cache em SQLite, controle de cota e montagem dos rankings em segundo plano).
- **Dados:** [API-Football](https://www.api-football.com/) v3.
- **Testes:** [Vitest](https://vitest.dev/).
- **Publicação:** GitHub Pages (site, via GitHub Actions) e Cloudflare (Worker).

### Como rodar

Site (aponta para o Worker já publicado):

```bash
npm install
npm start        # http://localhost:4200
npm test         # testes
```

Worker (precisa de uma chave da API-Football):

```bash
cd worker
npm install
npx wrangler secret put API_FOOTBALL_KEY
npm run dev      # local
npm run deploy   # publica na Cloudflare
```

O endereço do Worker usado pelo site fica em `src/app/api/api-football.ts` (`API_URL`), e as origens permitidas em `worker/wrangler.jsonc` (`ALLOWED_ORIGINS`).

---

## English

**Arquibancada** ("the stands", in Portuguese) is a website to follow Brazil's top football league, the **Campeonato Brasileiro Série A**, in real time: round fixtures, live scores, a league table that updates during matches, player and team stats, and a full page for each match. The interface is in Portuguese.

Data comes from [API-Football](https://www.api-football.com/) through a Cloudflare Worker that keeps the API key private, caches responses and builds the rankings the API doesn't provide out of the box.

### Features

**Round and standings**
- Today's matches and the round's fixtures, with a round picker and delayed-match tags.
- Live scores with a second-by-second match clock, half-time and stoppage-time minute (`45'+2`).
- **Live league table**: adds matches in progress and finished matches the API hasn't counted yet, re-sorts by the league's tiebreakers and shows how many places each team has gained or lost because of matches in progress.
- Zones (Libertadores, Libertadores qualifying, Sudamericana, relegation), last-5 form (including the live partial result) and teams currently playing highlighted.
- Team tables: average rating and stats for the season and the last 5 matches, sortable by several criteria.

**Match page**
- Header with score, match status, goalscorers, red cards, missed penalties, date, round and stadium.
- **Play-by-play**: goals (with the running score and the assist), cards with the reason, substitutions and VAR decisions, split by half-time and full-time.
- **Line-ups** on the pitch (horizontal on desktop, vertical on mobile), with rating, goals, assists, cards, substitutions and player of the match; substitutes and coaches.
- Automatic updates before (for line-ups), during (every 15 s) and right after the match (final ratings).

**Stats**
- Top scorers, top assists and best ratings, with a filter for regular players.
- Team of the round in a 4-3-3 with the best ratings and the player of the round.
- Player table with tabs (General, Attack, Defence, Passing, Goalkeeper, Discipline), sortable by any column, with totals, per-match or per-90-minute values.

**General**
- On-screen and browser notifications for goals (and goals disallowed by VAR).
- Light and dark mode, responsive layout and loading skeletons.

### Tech stack

- **Website:** [Angular](https://angular.dev/) 21 (standalone components and signals) and Angular Material.
- **API:** [Cloudflare Workers](https://workers.cloudflare.com/) with Durable Objects (SQLite cache, quota control and background ranking builds).
- **Data:** [API-Football](https://www.api-football.com/) v3.
- **Tests:** [Vitest](https://vitest.dev/).
- **Hosting:** GitHub Pages (website, via GitHub Actions) and Cloudflare (Worker).

### Running locally

Website (uses the Worker that is already deployed):

```bash
npm install
npm start        # http://localhost:4200
npm test         # tests
```

Worker (requires an API-Football key):

```bash
cd worker
npm install
npx wrangler secret put API_FOOTBALL_KEY
npm run dev      # local
npm run deploy   # deploy to Cloudflare
```

The Worker URL used by the website is set in `src/app/api/api-football.ts` (`API_URL`), and the allowed origins in `worker/wrangler.jsonc` (`ALLOWED_ORIGINS`).
