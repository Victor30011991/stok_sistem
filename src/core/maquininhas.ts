import type { Settings } from '../types';
import { newKey } from './normalize';

/**
 * Taxas SUGERIDAS de maquininhas (ponto de partida editável).
 * Fonte: tabelas públicas da faixa de entrada, Visa/Mastercard, consultadas em set–out/2026.
 * Elas mudam com plano, faturamento e prazo de recebimento: sempre confira no seu contrato.
 * Só entram aqui os valores que foram publicados; parcelas sem taxa publicada não são inventadas.
 */
export interface Maquininha {
  id: string;
  nome: string;
  debito: number;
  creditoVista: number;
  /** parcelas com taxa publicada: [número de parcelas, taxa %] */
  parcelado: [number, number][];
  recebimento: string;
  condicao: string;
}

export const MAQUININHAS_REFERENCIA = 'tabelas públicas, faixa de entrada, Visa/Mastercard, consultadas em set–out/2026';

export const MAQUININHAS: Maquininha[] = [
  {
    id: 'infinitepay',
    nome: 'InfinitePay',
    debito: 1.37,
    creditoVista: 3.15,
    parcelado: [[2, 5.39], [3, 6.12], [4, 6.85], [5, 7.57], [6, 8.28], [7, 8.99], [8, 9.69], [9, 10.38], [10, 11.06], [11, 11.74], [12, 12.4]],
    recebimento: '1 dia útil',
    condicao: 'até R$ 20 mil/mês; as taxas caem com o faturamento',
  },
  { id: 'sumup', nome: 'SumUp', debito: 0.99, creditoVista: 3.49, parcelado: [[12, 13.99]], recebimento: 'na hora', condicao: 'faixa de entrada' },
  { id: 'getnet', nome: 'Getnet (Get Lite)', debito: 1.39, creditoVista: 3.49, parcelado: [[12, 12.88]], recebimento: '2 dias úteis', condicao: 'faixa de entrada' },
  { id: 'pagbank', nome: 'PagBank', debito: 1.44, creditoVista: 3.49, parcelado: [[12, 13.78]], recebimento: 'na hora', condicao: 'faixa de entrada' },
  { id: 'ton', nome: 'Ton', debito: 1.69, creditoVista: 3.86, parcelado: [[12, 20.39]], recebimento: '1 dia útil', condicao: 'faixa de entrada' },
  { id: 'cielo', nome: 'Cielo', debito: 1.96, creditoVista: 4.42, parcelado: [[12, 19.78]], recebimento: '1 dia', condicao: 'faixa de entrada' },
  { id: 'mercadopago', nome: 'Mercado Pago (Point)', debito: 1.98, creditoVista: 4.86, parcelado: [[12, 21.39]], recebimento: 'na hora', condicao: 'faixa de entrada' },
];

export function maquininhaById(id: string): Maquininha | undefined {
  return MAQUININHAS.find((m) => m.id === id);
}

/** Aplica as taxas sugeridas. Não mexe em mais nada das premissas e continua tudo editável. */
export function aplicarMaquininha(s: Settings, m: Maquininha): Settings {
  const parcelado = m.parcelado.map(([parcelas, taxa]) => ({ id: newKey(), parcelas, taxa }));
  const base = s.pagamentoBase.startsWith('parcelado:') ? 'credito_vista' : s.pagamentoBase; // ids das parcelas antigas deixam de existir
  return { ...s, taxas: { debito: m.debito, creditoVista: m.creditoVista, parcelado }, pagamentoBase: base };
}
