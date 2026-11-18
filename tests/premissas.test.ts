import { describe, expect, it } from 'vitest';
import { calcPrice, totals } from '../src/core/pricing';
import { defaultSettings } from '../src/core/defaults';
import { avisosPremissas } from '../src/core/avisos';
import { ENTRADA_INICIAL, montarConfiguracao } from '../src/core/assistente';
import { criarBackup, lerBackup } from '../src/core/backup';
import { defaultStore } from '../src/core/defaults';
import type { Settings } from '../src/types';

const base = (patch: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...patch });
const prod = { custo: 1000, custosAdicionais: 0 }; // R$ 10,00

describe('custos variáveis: novos tipos', () => {
  it('% do custo de compra entra no custo, não no preço: R$ 10 + 5% = R$ 10,50 ÷ 0,70 = R$ 15,00', () => {
    const s = base({ custosVariaveis: [{ id: 'f', descricao: 'Frete', tipo: 'percentualCusto', valor: 5 }] });
    expect(totals(s).variaveisCustoPct).toBe(5);
    const r = calcPrice(prod, s, 0);
    expect(r.ok && r.precoCents).toBe(1500);
    expect(r.ok && r.linhas.some((l) => l.key === 'varcusto' && l.cents === 50)).toBe(true);
  });
  it('% do preço continua igual: R$ 10 ÷ (1 − 0,30 − 0,04) = R$ 15,15', () => {
    const s = base({ custosVariaveis: [{ id: 'i', descricao: 'Imposto', tipo: 'percentual', valor: 4 }] });
    const r = calcPrice(prod, s, 0);
    expect(r.ok && r.precoCents).toBe(1515);
  });
  it('R$ por lote: valor ÷ quantidade vira R$ por unidade (R$ 450 ÷ 500 = R$ 0,90)', () => {
    const s = base({ custosVariaveis: [{ id: 'e', descricao: 'Embalagens', tipo: 'valor', valor: 90, lote: { total: 45000, qtd: 500 } }] });
    const r = calcPrice(prod, s, 0);
    expect(r.ok && r.precoCents).toBe(1557); // (10,00 + 0,90) ÷ 0,70
  });
});

describe('avisos de bom senso', () => {
  const produtos = [{ custo: 1790 }, { custo: 2200 }, { custo: 900 }];
  it('pega o erro típico: total do mês lançado como R$ por unidade', () => {
    const s = base({ custosVariaveis: [{ id: 'e', descricao: 'Embalagens', tipo: 'valor', valor: 93938 }] });
    const a = avisosPremissas(s, produtos);
    expect(a.some((x) => x.id === 'valor-alto:e')).toBe(true);
  });
  it('não reclama de embalagem normal nem de lote', () => {
    const ok = base({ custosVariaveis: [{ id: 'e', descricao: 'Embalagens', tipo: 'valor', valor: 90 }] });
    expect(avisosPremissas(ok, produtos).some((x) => x.id.startsWith('valor-alto'))).toBe(false);
    const lote = base({ custosVariaveis: [{ id: 'e', descricao: 'Embalagens', tipo: 'valor', valor: 93938, lote: { total: 93938, qtd: 1 } }] });
    expect(avisosPremissas(lote, produtos).some((x) => x.id.startsWith('valor-alto'))).toBe(false);
  });
  it('linha sem nome, percentual enorme, fixos altos, margem alta e múltiplo do custo', () => {
    const s = base({
      custosFixos: [{ id: 'a', descricao: 'Aluguel', valor: 282629 }],
      custosVariaveis: [{ id: 'x', descricao: '', tipo: 'percentual', valor: 53 }],
      margem: { modo: 'margem', valor: 39 },
      rateio: { metodo: 'faturamento', faturamentoPrevisto: 500000, quantidadePrevista: 0 },
    });
    const ids = avisosPremissas(s, produtos).map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['sem-nome:x', 'pct-alto:x', 'fixos-altos', 'margem-alta']));
  });
  it('premissas saudáveis não geram aviso de alerta', () => {
    const s = base({
      custosFixos: [{ id: 'a', descricao: 'Aluguel', valor: 150000 }],
      custosVariaveis: [{ id: 'i', descricao: 'Imposto', tipo: 'percentual', valor: 4 }],
      margem: { modo: 'margem', valor: 12 },
      rateio: { metodo: 'faturamento', faturamentoPrevisto: 1000000, quantidadePrevista: 0 },
    });
    expect(avisosPremissas(s, produtos).filter((x) => x.tom === 'warn')).toEqual([]);
  });
});

describe('configuração guiada', () => {
  it('Simples + fixos + maquininha + embalagem por lote', () => {
    const e = {
      ...ENTRADA_INICIAL,
      regime: 'simples' as const,
      imposto: 4,
      fixos: { ...ENTRADA_INICIAL.fixos, aluguel: 90000, energia: 15000, agua: 10000, internet: 8000, pessoal: 20000 },
      faturamento: 1000000,
      maquininha: 'infinitepay',
      margem: 10,
      perda: 3,
      embalagem: { modo: 'lote' as const, valor: null, total: 45000, qtd: 500 },
    };
    const s = montarConfiguracao(e, defaultSettings());
    expect(s.custosFixos.map((c) => c.descricao)).toEqual(['Aluguel', 'Energia elétrica', 'Água', 'Internet e telefone', 'Funcionários / pró-labore']);
    expect(totals(s).fixosCents).toBe(143000);
    expect(s.custosVariaveis).toHaveLength(2);
    expect(s.custosVariaveis[0]).toMatchObject({ tipo: 'percentual', valor: 4 });
    expect(s.custosVariaveis[1]).toMatchObject({ tipo: 'valor', valor: 90, lote: { total: 45000, qtd: 500 } });
    expect(s.taxas.creditoVista).toBe(3.15);
    expect(s.margem).toEqual({ modo: 'margem', valor: 10 });
    expect(s.rateio).toMatchObject({ metodo: 'faturamento', faturamentoPrevisto: 1000000 });
    // R$ 10,00 de custo: (10/0,97 + 0,90) ÷ (1 − 0,143 − 0,04 − 0,0315 − 0,10)
    const r = calcPrice(prod, s, s.taxas.creditoVista);
    expect(r.ok && r.precoCents).toBe(1635); // 11,2093 ÷ 0,6855 = 16,35
  });
  it('MEI: o DAS vira custo fixo e não há imposto percentual', () => {
    const s = montarConfiguracao({ ...ENTRADA_INICIAL, regime: 'mei', das: 8000, faturamento: 500000 }, defaultSettings());
    expect(s.custosFixos).toEqual([expect.objectContaining({ descricao: 'DAS do MEI', valor: 8000 })]);
    expect(s.custosVariaveis).toEqual([]);
  });
  it('sem maquininha escolhida, as taxas atuais são mantidas; campos vazios ficam de fora', () => {
    const atual = defaultSettings();
    atual.taxas.creditoVista = 2.5;
    const s = montarConfiguracao({ ...ENTRADA_INICIAL, faturamento: 100000 }, atual);
    expect(s.taxas.creditoVista).toBe(2.5);
    expect(s.custosFixos).toEqual([]);
  });
});

describe('backup com os novos tipos', () => {
  it('guarda e devolve % do custo e lote', () => {
    const cfg = base({
      custosVariaveis: [
        { id: 'a', descricao: 'Frete', tipo: 'percentualCusto', valor: 5 },
        { id: 'b', descricao: 'Embalagens', tipo: 'valor', valor: 90, lote: { total: 45000, qtd: 500 } },
      ],
    });
    const r = lerBackup(criarBackup({ nome: 'x', produtos: [], categorias: [] }, defaultStore(), cfg));
    expect(r.ok && r.config.custosVariaveis).toEqual(cfg.custosVariaveis);
  });
});
