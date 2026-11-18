import type { FixedCost, Settings, VariableCost } from '../types';
import { newKey } from './normalize';
import { maquininhaById, aplicarMaquininha } from './maquininhas';

export type Regime = 'mei' | 'simples' | 'outro';

export interface EntradaAssistente {
  regime: Regime;
  /** % sobre as vendas (Simples Nacional ou outro regime) */
  imposto: number;
  /** DAS do MEI, centavos por mês */
  das: number | null;
  /** despesas fixas do mês, em centavos (null = não tem) */
  fixos: { aluguel: number | null; energia: number | null; agua: number | null; internet: number | null; pessoal: number | null; contador: number | null; outras: number | null };
  /** faturamento mensal previsto da loja toda, em centavos */
  faturamento: number | null;
  /** id de uma maquininha sugerida; '' = manter as taxas atuais */
  maquininha: string;
  /** margem líquida desejada, % sobre o preço */
  margem: number;
  perda: number;
  embalagem: { modo: 'nenhuma' | 'unidade' | 'lote'; valor: number | null; total: number | null; qtd: number | null };
}

export const ENTRADA_INICIAL: EntradaAssistente = {
  regime: 'simples',
  imposto: 4,
  das: null,
  fixos: { aluguel: null, energia: null, agua: null, internet: null, pessoal: null, contador: null, outras: null },
  faturamento: null,
  maquininha: '',
  margem: 10,
  perda: 3,
  embalagem: { modo: 'nenhuma', valor: null, total: null, qtd: null },
};

const ROTULOS_FIXOS: [keyof EntradaAssistente['fixos'], string][] = [
  ['aluguel', 'Aluguel'],
  ['energia', 'Energia elétrica'],
  ['agua', 'Água'],
  ['internet', 'Internet e telefone'],
  ['pessoal', 'Funcionários / pró-labore'],
  ['contador', 'Contabilidade'],
  ['outras', 'Outras despesas'],
];
export { ROTULOS_FIXOS };

/** Monta as premissas a partir das respostas. Mantém o que o assistente não pergunta (parcelas, forma de pagamento…). */
export function montarConfiguracao(e: EntradaAssistente, base: Settings): Settings {
  const fixos: FixedCost[] = [];
  if (e.regime === 'mei' && e.das && e.das > 0) fixos.push({ id: newKey(), descricao: 'DAS do MEI', valor: e.das });
  for (const [k, rotulo] of ROTULOS_FIXOS) {
    const v = e.fixos[k];
    if (v && v > 0) fixos.push({ id: newKey(), descricao: rotulo, valor: v });
  }

  const variaveis: VariableCost[] = [];
  if (e.regime !== 'mei' && e.imposto > 0) variaveis.push({ id: newKey(), descricao: e.regime === 'simples' ? 'Imposto (Simples Nacional)' : 'Imposto', tipo: 'percentual', valor: e.imposto });
  const emb = e.embalagem;
  if (emb.modo === 'unidade' && emb.valor && emb.valor > 0) variaveis.push({ id: newKey(), descricao: 'Embalagens', tipo: 'valor', valor: emb.valor });
  if (emb.modo === 'lote' && emb.total && emb.total > 0 && emb.qtd && emb.qtd > 0) {
    variaveis.push({ id: newKey(), descricao: 'Embalagens', tipo: 'valor', valor: Math.round(emb.total / emb.qtd), lote: { total: emb.total, qtd: emb.qtd } });
  }

  let cfg: Settings = {
    ...base,
    custosFixos: fixos,
    custosVariaveis: variaveis,
    perdaPct: e.perda,
    margem: { modo: 'margem', valor: e.margem },
    rateio: { ...base.rateio, metodo: 'faturamento', faturamentoPrevisto: e.faturamento ?? 0 },
  };
  const maq = e.maquininha ? maquininhaById(e.maquininha) : undefined;
  if (maq) cfg = aplicarMaquininha(cfg, maq);
  return cfg;
}
