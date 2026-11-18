import type { FixedCost, InstallmentFee, ListState, Product, Settings, StoreInfo, VariableCost } from '../types';
import { defaultSettings, defaultStore } from './defaults';
import { newId, newKey } from './normalize';
import { paymentOptions } from './pricing';

/**
 * Backup em texto (.txt): cabeçalho legível + os dados em JSON.
 * É só um arquivo no computador da pessoa: não usa servidor, banco nem navegador para guardar.
 */
export const BACKUP_MARK = 'temperei-backup';
export const BACKUP_VERSAO = 1;
const SEPARADOR = '-----DADOS (não edite daqui para baixo)-----';

export interface BackupLido {
  lista: ListState;
  loja: StoreInfo;
  config: Settings;
  geradoEm: string | null;
  /** produtos do arquivo que foram ignorados por estarem incompletos */
  ignorados: number;
}

export type ResultadoBackup = ({ ok: true } & BackupLido) | { ok: false; motivo: string };

export function criarBackup(lista: ListState, loja: StoreInfo, config: Settings, quando: Date = new Date()): string {
  const n = lista.produtos.length;
  const cab = [
    'BACKUP DO SISTEMA DE PRECIFICAÇÃO',
    `Lista: ${lista.nome}`,
    `Gerado em: ${quando.toLocaleString('pt-BR')}`,
    `Produtos: ${n} · Categorias: ${lista.categorias.length}`,
    '',
    'Este arquivo guarda produtos, categorias, dados da loja, custos, taxas e margens.',
    'Para voltar a este ponto: no sistema, abra "Salvar em Excel" e use "Restaurar backup".',
    SEPARADOR,
  ];
  const dados = { app: BACKUP_MARK, versao: BACKUP_VERSAO, geradoEm: quando.toISOString(), lista, loja, config };
  return cab.join('\n') + '\n' + JSON.stringify(dados, null, 1) + '\n';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const numOr = (v: unknown, d: number): number => num(v) ?? d;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

function lerProduto(v: unknown): Product | null {
  if (!isObj(v)) return null;
  const nome = str(v.nome).trim();
  if (!nome) return null;
  const p: Product = {
    id: str(v.id) || newId(),
    nome,
    categoria: str(v.categoria),
    unidade: str(v.unidade) || 'un',
    custo: num(v.custo),
    custosAdicionais: numOr(v.custosAdicionais, 0),
    venda: num(v.venda),
    propQtd: num(v.propQtd),
    propUnidade: typeof v.propUnidade === 'string' ? v.propUnidade : null,
    observacoes: str(v.observacoes),
  };
  if (v.estoque !== undefined) p.estoque = num(v.estoque);
  if (v.conteudoQtd !== undefined) p.conteudoQtd = num(v.conteudoQtd);
  if (v.conteudoUnidade !== undefined) p.conteudoUnidade = typeof v.conteudoUnidade === 'string' ? v.conteudoUnidade : null;
  return p;
}

function lerVariavel(c: Record<string, unknown>): VariableCost {
  const v: VariableCost = { id: str(c.id) || newKey(), descricao: str(c.descricao), tipo: c.tipo as VariableCost['tipo'], valor: c.valor as number };
  if (c.tipo === 'valor' && isObj(c.lote) && num(c.lote.total) != null && num(c.lote.qtd) != null && (c.lote.qtd as number) > 0) {
    v.lote = { total: c.lote.total as number, qtd: c.lote.qtd as number };
  }
  return v;
}

function lerConfig(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const fixos: FixedCost[] = (Array.isArray(raw.custosFixos) ? raw.custosFixos : []).flatMap((c) =>
    isObj(c) && num(c.valor) != null ? [{ id: str(c.id) || newKey(), descricao: str(c.descricao), valor: c.valor as number }] : [],
  );
  const variaveis: VariableCost[] = (Array.isArray(raw.custosVariaveis) ? raw.custosVariaveis : []).flatMap((c) =>
    isObj(c) && num(c.valor) != null && (c.tipo === 'percentual' || c.tipo === 'valor' || c.tipo === 'percentualCusto')
      ? [lerVariavel(c)]
      : [],
  );
  const t = isObj(raw.taxas) ? raw.taxas : {};
  const parcelado: InstallmentFee[] = Array.isArray(t.parcelado)
    ? t.parcelado.flatMap((p) => (isObj(p) && num(p.parcelas) != null && num(p.taxa) != null ? [{ id: str(p.id) || newKey(), parcelas: p.parcelas as number, taxa: p.taxa as number }] : []))
    : d.taxas.parcelado;
  const m = isObj(raw.margem) ? raw.margem : {};
  const r = isObj(raw.rateio) ? raw.rateio : {};
  const cfg: Settings = {
    custosFixos: fixos,
    custosVariaveis: variaveis,
    perdaPct: numOr(raw.perdaPct, 0),
    taxas: { debito: numOr(t.debito, 0), creditoVista: numOr(t.creditoVista, 0), parcelado },
    pagamentoBase: str(raw.pagamentoBase) || 'credito_vista',
    margem: { modo: m.modo === 'markup' ? 'markup' : 'margem', valor: numOr(m.valor, d.margem.valor) },
    rateio: {
      metodo: r.metodo === 'quantidade' ? 'quantidade' : 'faturamento',
      faturamentoPrevisto: numOr(r.faturamentoPrevisto, 0),
      quantidadePrevista: numOr(r.quantidadePrevista, 0),
    },
  };
  // forma de pagamento que não existe mais (ex.: parcela removida) volta para o crédito à vista
  if (!paymentOptions(cfg).some((p) => p.id === cfg.pagamentoBase)) cfg.pagamentoBase = 'credito_vista';
  return cfg;
}

function lerLoja(raw: unknown): StoreInfo {
  const d = defaultStore();
  if (!isObj(raw)) return d;
  const c = isObj(raw.cores) ? raw.cores : {};
  const cor = (v: unknown, def: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def);
  return {
    nomeFantasia: str(raw.nomeFantasia, d.nomeFantasia),
    razaoSocial: str(raw.razaoSocial),
    cnpj: str(raw.cnpj),
    endereco: str(raw.endereco),
    telefone: str(raw.telefone),
    informacoes: str(raw.informacoes),
    logo: typeof raw.logo === 'string' && raw.logo.startsWith('data:image/') ? raw.logo : null,
    cores: { primaria: cor(c.primaria, d.cores.primaria), destaque: cor(c.destaque, d.cores.destaque), fundo: cor(c.fundo, d.cores.fundo) },
  };
}

/** Lê e valida o texto de um backup. Nunca lança: devolve o motivo em português quando não serve. */
export function lerBackup(texto: string): ResultadoBackup {
  const corte = texto.indexOf(SEPARADOR);
  const json = (corte >= 0 ? texto.slice(corte + SEPARADOR.length) : texto).trim();
  let dados: unknown;
  try {
    dados = JSON.parse(json);
  } catch {
    return { ok: false, motivo: 'Este arquivo não parece ser um backup deste sistema, ou foi editado e ficou incompleto.' };
  }
  if (!isObj(dados) || dados.app !== BACKUP_MARK) return { ok: false, motivo: 'Este arquivo não é um backup deste sistema.' };
  if (typeof dados.versao !== 'number' || dados.versao > BACKUP_VERSAO) return { ok: false, motivo: 'Este backup foi feito por uma versão mais nova do sistema e não pode ser aberto aqui.' };
  const l = dados.lista;
  if (!isObj(l) || !Array.isArray(l.produtos)) return { ok: false, motivo: 'O backup está sem a lista de produtos.' };

  const produtos: Product[] = [];
  let ignorados = 0;
  const ids = new Set<string>();
  for (const bruto of l.produtos) {
    const p = lerProduto(bruto);
    if (!p) {
      ignorados++;
      continue;
    }
    if (ids.has(p.id)) p.id = newId(); // id repetido: mantém os dois produtos
    ids.add(p.id);
    produtos.push(p);
  }
  const cats = (Array.isArray(l.categorias) ? l.categorias : []).filter((c): c is string => typeof c === 'string' && c.trim() !== '');
  for (const p of produtos) if (p.categoria && !cats.includes(p.categoria)) cats.push(p.categoria);

  return {
    ok: true,
    lista: { nome: str(l.nome) || 'Minha lista de preços', produtos, categorias: [...new Set(cats)] },
    loja: lerLoja(dados.loja),
    config: lerConfig(dados.config),
    geradoEm: typeof dados.geradoEm === 'string' ? dados.geradoEm : null,
    ignorados,
  };
}
