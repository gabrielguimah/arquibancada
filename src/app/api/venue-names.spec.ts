import { venueWithCity } from './venue-names';

const city = (name: string | null, c: string | null) => venueWithCity({ name, city: c }).city;

describe('Cidade do estádio', () => {
  it('põe acento e corrige nomes errados ou traduzidos da API', () => {
    expect(city('Neo Quimica Arena', 'Sao Paulo')).toBe('São Paulo');
    expect(city('Mangueirão', 'Belem')).toBe('Belém');
    expect(city('Arena Condá', 'Chapeco')).toBe('Chapecó');
    expect(city('Arena Fonte Nova', 'El Salvador')).toBe('Salvador');
    expect(city('Estádio Mineirão', 'Bello Harisanta')).toBe('Belo Horizonte');
    expect(city('Estadio Cicero de Souza Marques', 'Braganza')).toBe('Bragança Paulista');
    expect(city('José Maria de Campos Maia', 'Mirasol')).toBe('Mirassol');
  });

  it('estádio com a cidade errada: a cidade vem do estádio', () => {
    expect(city('Vila Belmiro', 'Sao Paulo')).toBe('Santos');
  });

  it('cidade desconhecida ou já certa fica como veio', () => {
    expect(city('Estádio Novo', 'Maceió')).toBe('Maceió');
    expect(city('Estádio Beira-Rio', 'Porto Alegre')).toBe('Porto Alegre');
    expect(city(null, null)).toBeNull();
  });
});
