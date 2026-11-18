import type { Product, Settings } from '../types';
import { formatBRL, formatPercent } from './money';
import { calcPrice, fixedPercentOfPrice, marginFraction, paymentById, totals } from './pricing';

export interface Aviso {
  id: string;
  tom: 'warn' | 'info';
  texto: string;
  /** aba onde o ajuste é feito */
  aba: 'custos' | 'cartao' | 'margem';
}

const mediana = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Avisos de bom senso sobre as premissas. Não bloqueiam nada: só apontam o que costuma ser erro de digitação
 * (total do mês lançado como valor por unidade, linha sem nome, faturamento baixo demais…).
 */
export function avisosPremissas(s: Settings, produtos: Pick<Product, 'custo'>[]): Aviso[] {
  const out: Aviso[] = [];
  const custos = produtos.map((p) => p.custo).filter((c): c is number => c != null && c > 0);
  const tipico = mediana(custos);

  for (const c of s.custosVariaveis) {
    const nome = c.descricao.trim();
    if (!nome && c.valor > 0) {
      out.push({ id: `sem-nome:${c.id}`, tom: 'warn', aba: 'custos', texto: `Há um custo variável sem nome (${c.tipo === 'valor' ? formatBRL(c.valor) : formatPercent(c.valor)}). Dê um nome a ele ou exclua a linha.` });
    }
    if (c.tipo === 'valor' && c.valor > 0 && !c.lote && ((tipico != null && c.valor > tipico) || c.valor > 10000)) {
      out.push({
        id: `valor-alto:${c.id}`,
        tom: 'warn',
        aba: 'custos',
        texto: `“${nome || 'Custo variável'}”: ${formatBRL(c.valor)} por unidade vendida é muito${tipico != null ? ` (o custo típico dos seus produtos é ${formatBRL(Math.round(tipico))})` : ''}. Se esse valor é o total do mês ou de uma compra, use “R$ por lote” ou lance em Custos fixos.`,
      });
    }
    if ((c.tipo === 'percentual' || c.tipo === 'percentualCusto') && c.valor >= 30) {
      out.push({ id: `pct-alto:${c.id}`, tom: 'warn', aba: 'custos', texto: `“${nome || 'Custo variável'}” está em ${formatPercent(c.valor)}. Confira se não é o custo da mercadoria, que já entra pelo custo de compra do produto.` });
    }
  }

  const fixo = fixedPercentOfPrice(s);
  if (fixo != null && fixo > 30) {
    out.push({ id: 'fixos-altos', tom: 'warn', aba: 'margem', texto: `Os custos fixos pesam ${formatPercent(Math.round(fixo * 10) / 10)} do preço (${formatBRL(totals(s).fixosCents)} ÷ faturamento previsto). Confira se o faturamento previsto é o da loja inteira e se há custo que não é fixo (frete e imposto de compra vão na compra por lote).` });
  }

  const m = marginFraction(s.margem);
  if (m != null && m.toNumber() > 0.25) {
    out.push({ id: 'margem-alta', tom: 'warn', aba: 'margem', texto: `Margem de ${formatPercent(Math.round(m.toNumber() * 1000) / 10)} sobre o preço é alta. Como lucro líquido (depois dos custos fixos), 10% a 15% é o mais comum.` });
  }
  if (totals(s).fixosCents === 0 && m != null && m.toNumber() < 0.15) {
    out.push({ id: 'sem-fixos', tom: 'info', aba: 'custos', texto: 'Você não lançou custos fixos. Com margem baixa, o preço não cobre aluguel, energia e outras despesas da loja.' });
  }

  const credito = s.taxas.creditoVista;
  const zerados = s.taxas.parcelado.filter((p) => p.taxa === 0);
  if (credito > 0 && zerados.length > 0) {
    out.push({ id: 'parcelas-zero', tom: 'info', aba: 'cartao', texto: `Crédito em ${zerados.map((p) => `${p.parcelas}x`).join(', ')} está com taxa 0%. Preencha se você vende parcelado.` });
  }

  // o resultado final: quantas vezes o custo vira preço
  const r = calcPrice({ custo: 10000, custosAdicionais: 0 }, s, paymentById(s, s.pagamentoBase).taxa);
  if (r.ok) {
    const mult = r.precoCents / 10000;
    if (mult > 3) {
      out.push({ id: 'multiplo', tom: 'warn', aba: 'custos', texto: `Com essas premissas o preço fica ${mult.toFixed(1).replace('.', ',')} vezes o custo. Revise margem, custos fixos e custos variáveis.` });
    }
  }
  return out;
}
