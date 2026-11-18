import { describe, expect, it } from 'vitest';
import { MAQUININHAS, aplicarMaquininha, maquininhaById } from '../src/core/maquininhas';
import { defaultSettings } from '../src/core/defaults';
import { calcPrice, paymentById } from '../src/core/pricing';

describe('maquininhas sugeridas', () => {
  it('aplica débito, crédito à vista e parcelas sem alterar o resto das premissas', () => {
    const base = defaultSettings();
    base.margem = { modo: 'margem', valor: 25 };
    base.perdaPct = 2;
    const s = aplicarMaquininha(base, maquininhaById('infinitepay')!);
    expect(s.taxas.debito).toBe(1.37);
    expect(s.taxas.creditoVista).toBe(3.15);
    expect(s.taxas.parcelado).toHaveLength(11);
    expect(s.taxas.parcelado.find((p) => p.parcelas === 12)?.taxa).toBe(12.4);
    expect(s.margem).toEqual({ modo: 'margem', valor: 25 });
    expect(s.perdaPct).toBe(2);
  });
  it('não inventa parcelas que não foram publicadas', () => {
    const s = aplicarMaquininha(defaultSettings(), maquininhaById('sumup')!);
    expect(s.taxas.parcelado.map((p) => p.parcelas)).toEqual([12]);
  });
  it('se o pagamento-base era uma parcela antiga, volta para crédito à vista', () => {
    const base = defaultSettings();
    base.pagamentoBase = `parcelado:${base.taxas.parcelado[0].id}`;
    expect(aplicarMaquininha(base, maquininhaById('ton')!).pagamentoBase).toBe('credito_vista');
  });
  it('a taxa entra no preço por gross-up: R$ 10 de custo, margem 30% e crédito à vista de 3,15%', () => {
    const s = aplicarMaquininha(defaultSettings(), maquininhaById('infinitepay')!);
    const r = calcPrice({ custo: 1000, custosAdicionais: 0 }, s, paymentById(s, 'credito_vista').taxa);
    expect(r.ok && r.precoCents).toBe(1496); // 10 ÷ (1 − 0,30 − 0,0315) = 14,96
  });
  it('todas têm taxas plausíveis e ids únicos', () => {
    expect(new Set(MAQUININHAS.map((m) => m.id)).size).toBe(MAQUININHAS.length);
    MAQUININHAS.forEach((m) => {
      expect(m.debito).toBeGreaterThan(0);
      expect(m.creditoVista).toBeGreaterThan(m.debito);
      m.parcelado.forEach(([n, t]) => expect(n >= 2 && t > m.creditoVista).toBe(true));
    });
  });
});
