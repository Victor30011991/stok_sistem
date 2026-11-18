import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/store';
import { useDocumentTitle, useFeedback } from '../ui/feedback';
import { Button, Empty, Field, MoneyInput, Notice, NumberInput, PageHeader, Tabs } from '../ui/ui';
import { Icon } from '../ui/icons';
import { formatBRL, formatPercent } from '../core/money';
import { calcPrice, fixedPercentOfPrice, marginToMarkup, markupToMargin, paymentById, paymentOptions, totals } from '../core/pricing';
import { proportionalPrice, formatQtyUnit, contentOf } from '../core/units';
import { Sugestoes, type Sugestao } from '../components/Sugestoes';
import { newKey, norm } from '../core/normalize';
import { MAQUININHAS, MAQUININHAS_REFERENCIA, aplicarMaquininha, maquininhaById } from '../core/maquininhas';
import { sortProducts } from '../core/sort';
import { avisosPremissas } from '../core/avisos';
import AssistenteConfig from './AssistenteConfig';
import type { Settings, VariableCost } from '../types';

type Aba = 'produto' | 'custos' | 'cartao' | 'margem' | 'assistente';

const COLORS: Record<string, string> = { custo: 'var(--primary-dark)', perda: '#8A6A55', adic: '#A58468', varvalor: '#C0A183', varcusto: '#B59373', fixounit: '#6C7A47', fixopct: '#8E9C66', varpct: '#B9C492', taxa: '#D8A93E', lucro: 'var(--primary)' };

export default function Precificacao() {
  useDocumentTitle('Precificação');
  const [aba, setAba] = useState<Aba>('produto');
  return (
    <div className="page">
      <PageHeader titulo="Precificação" subtitulo="Veja de onde vem cada centavo do preço. Esta área é interna: custos, margens e taxas nunca vão para o PDF." />
      <Tabs
        value={aba}
        onChange={setAba}
        itens={[
          { id: 'produto', label: 'Preço do produto' },
          { id: 'custos', label: 'Custos e despesas' },
          { id: 'cartao', label: 'Taxas de cartão' },
          { id: 'margem', label: 'Margem e rateio' },
          { id: 'assistente', label: 'Configuração guiada' },
        ]}
      />
      {aba !== 'assistente' && <Avisos onIr={setAba} />}
      {aba === 'produto' && <AbaProduto />}
      {aba === 'custos' && <AbaCustos />}
      {aba === 'cartao' && <AbaCartao />}
      {aba === 'margem' && <AbaMargem />}
      {aba === 'assistente' && <AssistenteConfig onAplicado={() => setAba('produto')} />}
    </div>
  );
}

/** Avisos de bom senso sobre as premissas (não bloqueiam nada). */
function Avisos({ onIr }: { onIr: (a: Aba) => void }) {
  const { state } = useApp();
  const avisos = useMemo(() => avisosPremissas(state.config, state.lista.produtos), [state.config, state.lista.produtos]);
  if (avisos.length === 0) return null;
  const NOMES = { custos: 'Custos e despesas', cartao: 'Taxas de cartão', margem: 'Margem e rateio' } as const;
  return (
    <div className="avisos" aria-label="Avisos sobre as premissas">
      {avisos.slice(0, 4).map((a) => (
        <Notice key={a.id} tone={a.tom}>
          {a.texto}{' '}
          <button type="button" className="mini" onClick={() => onIr(a.aba)}>
            Abrir {NOMES[a.aba]}
          </button>
        </Notice>
      ))}
      {avisos.length > 4 && <p className="muted small">E mais {avisos.length - 4} aviso(s). Resolva os primeiros e eles aparecem aqui.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Preço do produto */

function AbaProduto() {
  const { state, act } = useApp();
  const { toast } = useFeedback();
  const cfg = state.config;
  const lista = useMemo(() => sortProducts(state.lista.produtos, 'az'), [state.lista.produtos]);
  const [id, setId] = useState<string>('');
  const [pay, setPay] = useState<string>(cfg.pagamentoBase);
  const [sugestoes, setSugestoes] = useState<{ itens: Sugestao[]; sem: number } | null>(null);
  const prod = lista.find((p) => p.id === id) ?? lista.find((p) => p.custo != null) ?? lista[0];
  const opcoes = paymentOptions(cfg);
  const atual = paymentById(cfg, pay);

  const res = useMemo(() => (prod ? calcPrice(prod, cfg, atual.taxa) : null), [prod, cfg, atual.taxa]);
  const porForma = useMemo(() => (prod ? opcoes.map((o) => ({ o, r: calcPrice(prod, cfg, o.taxa) })) : []), [prod, cfg, opcoes]);

  if (lista.length === 0)
    return (
      <Empty titulo="Cadastre produtos para precificar" icon="calc" acoes={<Link to="/produtos" className="btn btn-primary">Ir para Produtos</Link>}>
        O cálculo parte do custo de aquisição de cada produto.
      </Empty>
    );
  if (!prod) return null;

  const prop = res?.ok ? proportionalPrice(res.precoCents, prod.unidade, prod.propQtd, prod.propUnidade, contentOf(prod)) : null;

  async function aplicar() {
    if (!res?.ok) return;
    act.precos([{ id: prod!.id, venda: res.precoCents }]);
    toast(`Preço de “${prod!.nome}” atualizado para ${formatBRL(res.precoCents)}.`);
  }

  // Não grava nada: abre a revisão de sugestões, e só o que a pessoa marcar é aplicado.
  function aplicarTodos() {
    const itens: Sugestao[] = [];
    let sem = 0;
    for (const p of state.lista.produtos) {
      if (p.custo == null) {
        sem++;
        continue;
      }
      const r = calcPrice(p, cfg, atual.taxa);
      if (r.ok) itens.push({ id: p.id, nome: p.nome, unidade: p.unidade, atual: p.venda, sugerido: r.precoCents });
    }
    if (itens.length === 0) return toast('Nenhum produto pôde ser calculado. Confira custos, margem e taxas.', 'erro');
    setSugestoes({ itens, sem });
  }

  return (
    <div className="calc">
      <section className="card calc-side">
        <h2>Premissas</h2>
        <Field label="Produto">
          {(fid) => (
            <select id={fid} value={prod.id} onChange={(e) => setId(e.target.value)}>
              {lista.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} ({p.unidade}){p.custo == null ? ' — sem custo' : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        <dl className="kv">
          <div>
            <dt>Custo de aquisição</dt>
            <dd>{formatBRL(prod.custo)} / {prod.unidade}</dd>
          </div>
          <div>
            <dt>Custos adicionais do produto</dt>
            <dd>{formatBRL(prod.custosAdicionais)}</dd>
          </div>
          <div>
            <dt>Preço de venda atual</dt>
            <dd>{formatBRL(prod.venda)}</dd>
          </div>
        </dl>
        <Field label="Forma de pagamento do cálculo">
          {(fid) => (
            <select id={fid} value={pay} onChange={(e) => setPay(e.target.value)}>
              {opcoes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} · taxa {formatPercent(o.taxa)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Lucro desejado">
          {(fid) => (
            <div className="row-gap">
              <div className="seg" role="group" aria-label="Tipo de lucro">
                <button type="button" aria-pressed={cfg.margem.modo === 'margem'} onClick={() => act.config((s) => ({ ...s, margem: { modo: 'margem', valor: s.margem.modo === 'markup' ? round2(markupToMargin(s.margem.valor)) : s.margem.valor } }))}>
                  Margem
                </button>
                <button type="button" aria-pressed={cfg.margem.modo === 'markup'} onClick={() => act.config((s) => ({ ...s, margem: { modo: 'markup', valor: s.margem.modo === 'margem' ? round2(marginToMarkup(s.margem.valor) ?? 0) : s.margem.valor } }))}>
                  Markup
                </button>
              </div>
              <NumberInput id={fid} value={cfg.margem.valor} suffix="%" max={cfg.margem.modo === 'margem' ? 99.99 : undefined} onChange={(v) => act.config((s) => ({ ...s, margem: { ...s.margem, valor: v } }))} className="w-sm" />
            </div>
          )}
        </Field>
        <dl className="kv">
          <div>
            <dt>Custos fixos rateados</dt>
            <dd>{fixedPercentOfPrice(cfg) == null ? 'informe o faturamento' : formatPercent(fixedPercentOfPrice(cfg) ?? 0)}</dd>
          </div>
          <div>
            <dt>Custos variáveis</dt>
            <dd>{resumoVariaveis(totals(cfg))}</dd>
          </div>
          <div>
            <dt>Perdas</dt>
            <dd>{formatPercent(cfg.perdaPct)}</dd>
          </div>
        </dl>
        <small className="muted">Ajuste os custos nas abas ao lado. O cálculo se atualiza na hora.</small>
      </section>

      <div className="calc-main">
        {res && !res.ok && <Notice tone="warn">{res.motivo}</Notice>}
        {res?.ok && (
          <>
            <section className="price-hero">
              <div>
                <span className="eyebrow light">Preço recomendado · {atual.label}</span>
                <strong className="price-big">{formatBRL(res.precoCents)}</strong>
                <span className="price-sub">
                  por {prod.unidade}
                  {prop != null && prod.propQtd && prod.propUnidade && <> · {formatBRL(prop)} por {formatQtyUnit(prod.propQtd, prod.propUnidade)}</>}
                </span>
              </div>
              <div className="price-stats">
                <div>
                  <small>Margem</small>
                  <strong>{formatPercent(round2(res.margemPct), 1)}</strong>
                </div>
                <div>
                  <small>Markup</small>
                  <strong>{formatPercent(round2(res.markupPct), 1)}</strong>
                </div>
                <div>
                  <small>Lucro por {prod.unidade}</small>
                  <strong>{formatBRL(res.lucroCents)}</strong>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>Detalhamento do cálculo</h2>
              <div className="stack-bar" role="img" aria-label="Composição do preço">
                {res.linhas.filter((l) => l.cents > 0).map((l) => (
                  <span key={l.key} style={{ flex: l.cents, background: COLORS[l.key] ?? '#999' }} title={`${l.label}: ${formatBRL(l.cents)}`} />
                ))}
              </div>
              <table className="table compact">
                <tbody>
                  {res.linhas.map((l) => (
                    <tr key={l.key} className={l.key === 'lucro' ? 'total-row' : ''}>
                      <td>
                        <i className="dot" style={{ background: COLORS[l.key] ?? '#999' }} aria-hidden="true" />
                        {l.label}
                      </td>
                      <td className="num muted">{formatPercent(round2(l.pct), 1)}</td>
                      <td className="num strong">{formatBRL(l.cents)}</td>
                    </tr>
                  ))}
                  <tr className="sum-row">
                    <td>Preço de venda</td>
                    <td className="num muted">100 %</td>
                    <td className="num strong">{formatBRL(res.precoCents)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="formula">{res.formula}</p>
              <p className="muted small">
                Margem = lucro ÷ preço de venda. Markup = lucro ÷ todos os custos (inclusive taxas). Taxas, margem e rateio incidem sobre o preço, por isso o cálculo divide o custo por (1 − percentuais). O lucro absorve as diferenças de centavos do arredondamento.
              </p>
            </section>

            <section className="card">
              <h2>Preço recomendado por forma de pagamento</h2>
              <div className="table-scroll">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>Forma</th>
                      <th className="num">Taxa</th>
                      <th className="num">Preço por {prod.unidade}</th>
                      <th className="num">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porForma.map(({ o, r }) => (
                      <tr key={o.id} className={o.id === atual.id ? 'selected' : ''}>
                        <td>{o.label}{o.id === cfg.pagamentoBase && <span className="muted"> · preço de tabela</span>}</td>
                        <td className="num muted">{formatPercent(o.taxa)}</td>
                        <td className="num strong">{r.ok ? formatBRL(r.precoCents) : '—'}</td>
                        <td className="num muted">{r.ok ? diff(r.precoCents, res.precoCents) : 'inviável'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="row-gap wrap">
              <Button icon="check" onClick={aplicar}>
                Usar {formatBRL(res.precoCents)} como preço de venda de “{prod.nome}”
              </Button>
              <Button variant="secondary" icon="sparkle" onClick={aplicarTodos}>
                Ver sugestões para todos os produtos…
              </Button>
            </div>
          </>
        )}
      </div>
      {sugestoes && (
        <Sugestoes
          itens={sugestoes.itens}
          semCusto={sugestoes.sem}
          rotulo={atual.label.toLowerCase()}
          onClose={() => setSugestoes(null)}
          onApply={(itens) => {
            act.precos(itens);
            toast(`${itens.length} preço${itens.length === 1 ? '' : 's'} atualizado${itens.length === 1 ? '' : 's'}.`);
          }}
        />
      )}
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const diff = (a: number, base: number) => (a === base ? '—' : `${a > base ? '+' : '−'} ${formatBRL(Math.abs(a - base))}`);

/* ---------------------------------------------------------------- Custos e despesas */

const SUG_FIXOS = ['Aluguel', 'Energia elétrica', 'Água', 'Internet', 'Funcionários', 'Contabilidade', 'Sistemas', 'Outras despesas'];
function novoVariavel(nome: string): VariableCost {
  const id = newKey();
  if (nome === 'Comissões') return { id, descricao: nome, tipo: 'percentual', valor: 0 };
  if (nome === 'Fretes') return { id, descricao: nome, tipo: 'percentualCusto', valor: 0 };
  if (nome === 'Embalagens') return { id, descricao: nome, tipo: 'valor', valor: 0, lote: { total: 0, qtd: 1 } };
  return { id, descricao: nome, tipo: 'valor', valor: 0 };
}

function resumoVariaveis(t: ReturnType<typeof totals>): string {
  const partes = [formatPercent(t.variaveisPct)];
  if (t.variaveisCents) partes.push(formatBRL(t.variaveisCents));
  if (t.variaveisCustoPct) partes.push(`${formatPercent(t.variaveisCustoPct)} do custo`);
  return partes.join(' + ');
}

const SUG_VAR = ['Embalagens', 'Sacolas', 'Etiquetas', 'Comissões', 'Fretes', 'Desperdícios', 'Outros custos variáveis'];

function AbaCustos() {
  const { state, act } = useApp();
  const cfg = state.config;
  const t = totals(cfg);
  const upd = (fn: (s: Settings) => Settings) => act.config(fn);

  return (
    <div className="two-col">
      <section className="card">
        <div className="card-head">
          <h2>Custos fixos (por mês)</h2>
          <strong>{formatBRL(t.fixosCents)}</strong>
        </div>
        <p className="muted small">Despesas que existem vendendo ou não. Entram no preço de forma rateada (veja “Margem e rateio”), nunca pelo valor cheio.</p>
        <div className="chips-add">
          {SUG_FIXOS.filter((s) => !cfg.custosFixos.some((c) => norm(c.descricao) === norm(s))).map((s) => (
            <button key={s} type="button" className="mini" onClick={() => upd((c) => ({ ...c, custosFixos: [...c.custosFixos, { id: newKey(), descricao: s, valor: 0 }] }))}>
              + {s}
            </button>
          ))}
        </div>
        {cfg.custosFixos.length === 0 && <p className="muted">Nenhum custo fixo cadastrado.</p>}
        <ul className="cost-list">
          {cfg.custosFixos.map((c) => (
            <li key={c.id}>
              <input aria-label="Descrição do custo fixo" value={c.descricao} onChange={(e) => upd((s) => ({ ...s, custosFixos: s.custosFixos.map((x) => (x.id === c.id ? { ...x, descricao: e.target.value } : x)) }))} />
              <MoneyInput ariaLabel={`Valor mensal de ${c.descricao}`} value={c.valor} allowEmpty={false} onChange={(v) => upd((s) => ({ ...s, custosFixos: s.custosFixos.map((x) => (x.id === c.id ? { ...x, valor: v ?? 0 } : x)) }))} />
              <button type="button" className="icon-btn danger" aria-label={`Excluir ${c.descricao}`} onClick={() => upd((s) => ({ ...s, custosFixos: s.custosFixos.filter((x) => x.id !== c.id) }))}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" icon="plus" onClick={() => upd((s) => ({ ...s, custosFixos: [...s.custosFixos, { id: newKey(), descricao: '', valor: 0 }] }))}>
          Adicionar custo fixo
        </Button>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Custos variáveis</h2>
          <strong>
            {resumoVariaveis(t)}
          </strong>
        </div>
        <p className="muted small">Custos que crescem com as vendas. Escolha o tipo de cada um: % do preço (comissão, imposto), % do custo de compra (frete e juros em %), R$ por unidade (embalagem) ou R$ por lote (valor pago ÷ quantidade). Frete e juros de uma compra específica ficam melhor na compra por lote do produto.</p>
        <div className="chips-add">
          {SUG_VAR.filter((s) => !cfg.custosVariaveis.some((c) => norm(c.descricao) === norm(s))).map((s) => (
            <button key={s} type="button" className="mini" onClick={() => upd((c) => ({ ...c, custosVariaveis: [...c.custosVariaveis, novoVariavel(s)] }))}>
              + {s}
            </button>
          ))}
        </div>
        {cfg.custosVariaveis.length === 0 && <p className="muted">Nenhum custo variável cadastrado.</p>}
        <ul className="cost-list var">
          {cfg.custosVariaveis.map((c) => {
            const tipoUi = c.tipo === 'valor' && c.lote ? 'lote' : c.tipo;
            const mudar = (fn: (x: VariableCost) => VariableCost) => upd((s) => ({ ...s, custosVariaveis: s.custosVariaveis.map((x) => (x.id === c.id ? fn(x) : x)) }));
            const setLote = (patch: Partial<{ total: number; qtd: number }>) =>
              mudar((x) => {
                const lote = { total: x.lote?.total ?? 0, qtd: x.lote?.qtd ?? 1, ...patch };
                return { ...x, tipo: 'valor', lote, valor: lote.qtd > 0 ? Math.round(lote.total / lote.qtd) : 0 };
              });
            return (
              <li key={c.id}>
                <input aria-label="Descrição do custo variável" value={c.descricao} onChange={(e) => mudar((x) => ({ ...x, descricao: e.target.value }))} />
                <select
                  aria-label={`Tipo de ${c.descricao}`}
                  value={tipoUi}
                  onChange={(e) => {
                    const t = e.target.value;
                    mudar((x) => (t === 'lote' ? { id: x.id, descricao: x.descricao, tipo: 'valor', valor: 0, lote: { total: 0, qtd: 1 } } : { id: x.id, descricao: x.descricao, tipo: t as VariableCost['tipo'], valor: 0 }));
                  }}
                >
                  <option value="percentual">% do preço de venda</option>
                  <option value="percentualCusto">% do custo de compra</option>
                  <option value="valor">R$ por unidade vendida</option>
                  <option value="lote">R$ por lote (valor ÷ quantidade)</option>
                </select>
                {c.tipo === 'valor' && c.lote ? (
                  <strong className="cost-result" aria-label={`Resultado de ${c.descricao}`}>
                    {formatBRL(c.valor)} <small className="muted">por unidade</small>
                  </strong>
                ) : c.tipo === 'valor' ? (
                  <MoneyInput ariaLabel={`Valor de ${c.descricao}`} value={c.valor} allowEmpty={false} onChange={(v) => mudar((x) => ({ ...x, valor: v ?? 0 }))} />
                ) : (
                  <NumberInput ariaLabel={`Percentual de ${c.descricao}`} value={c.valor} suffix="%" max={99} onChange={(v) => mudar((x) => ({ ...x, valor: v }))} />
                )}
                <button type="button" className="icon-btn danger" aria-label={`Excluir ${c.descricao}`} onClick={() => upd((s) => ({ ...s, custosVariaveis: s.custosVariaveis.filter((x) => x.id !== c.id) }))}>
                  <Icon name="trash" />
                </button>
                {tipoUi === 'lote' && (
                  <div className="cost-sub">
                    <label>
                      Valor pago no lote
                      <MoneyInput ariaLabel={`Valor pago no lote de ${c.descricao}`} value={c.lote?.total ?? 0} allowEmpty={false} onChange={(v) => setLote({ total: v ?? 0 })} />
                    </label>
                    <label>
                      Quantidade comprada
                      <NumberInput ariaLabel={`Quantidade do lote de ${c.descricao}`} value={c.lote?.qtd ?? 1} integer onChange={(v) => setLote({ qtd: v })} />
                    </label>
                  </div>
                )}
                {tipoUi === 'valor' && <p className="cost-hint">Custo de UMA unidade vendida (ex.: um pote). Se for o total do mês ou de uma compra, use “R$ por lote”.</p>}
                {tipoUi === 'percentualCusto' && <p className="cost-hint">Percentual sobre o que você paga pelo produto. Ex.: 5% de frete sobre o custo de compra.</p>}
              </li>
            );
          })}
        </ul>
        <Button variant="secondary" icon="plus" onClick={() => upd((s) => ({ ...s, custosVariaveis: [...s.custosVariaveis, { id: newKey(), descricao: '', tipo: 'percentual', valor: 0 }] }))}>
          Adicionar custo variável
        </Button>
        <hr />
        <Field label="Perdas e desperdícios" hint="Percentual do que você compra e não consegue vender (quebra, validade). Aumenta o custo efetivo: custo ÷ (1 − perda).">
          {(id) => <NumberInput id={id} value={cfg.perdaPct} suffix="%" max={99} onChange={(v) => upd((s) => ({ ...s, perdaPct: v }))} className="w-sm" />}
        </Field>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Taxas de cartão */

function AbaCartao() {
  const { state, act } = useApp();
  const cfg = state.config;
  const upd = (fn: (s: Settings) => Settings) => act.config(fn);
  const { toast } = useFeedback();
  const [maqId, setMaqId] = useState('');
  const [aplicada, setAplicada] = useState<string | null>(null);
  const maq = maquininhaById(maqId);
  const usada = aplicada ? maquininhaById(aplicada) : undefined;
  return (
    <section className="card narrow-card">
      <h2>Taxas de cartão</h2>
      <p className="muted small">Informe a taxa que a maquininha cobra de você em cada modalidade. Ela é somada ao cálculo para o preço cobrir esse custo.</p>
      <div className="prop-box card">
        <Field label="Minha maquininha" hint="Escolha para preencher as taxas sugeridas. Você pode ajustar qualquer valor depois.">
          {(id) => (
            <select id={id} value={maqId} onChange={(e) => setMaqId(e.target.value)}>
              <option value="">Escolher…</option>
              {MAQUININHAS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div>
          <Button
            variant="secondary"
            icon="check"
            disabled={!maq}
            onClick={() => {
              if (!maq) return;
              upd((s) => aplicarMaquininha(s, maq));
              setAplicada(maq.id);
              toast(`Taxas sugeridas de ${maq.nome} aplicadas.`);
            }}
          >
            Usar taxas sugeridas
          </Button>
        </div>
        {usada ? (
          <Notice tone="warn">
            <strong>Valores sugeridos de {usada.nome}</strong> ({usada.condicao}; recebimento {usada.recebimento}).{' '}
            {usada.parcelado.length === 1
              ? `Só a taxa do crédito em ${usada.parcelado[0][0]}x é publicada: adicione abaixo as outras parcelas que você usa, conforme o seu contrato. `
              : ''}
            Fonte: {MAQUININHAS_REFERENCIA}. Mudam com o plano e o faturamento: confira no seu contrato. Stone e Rede definem taxa por proposta, então preencha à mão.
          </Notice>
        ) : (
          <p className="muted small">Stone, Rede e outras que cobram por proposta: preencha as taxas do seu contrato nos campos abaixo.</p>
        )}
      </div>
      <div className="form-grid">
        <Field label="Débito">{(id) => <NumberInput id={id} value={cfg.taxas.debito} suffix="%" max={99} onChange={(v) => upd((s) => ({ ...s, taxas: { ...s.taxas, debito: v } }))} />}</Field>
        <Field label="Crédito à vista">{(id) => <NumberInput id={id} value={cfg.taxas.creditoVista} suffix="%" max={99} onChange={(v) => upd((s) => ({ ...s, taxas: { ...s.taxas, creditoVista: v } }))} />}</Field>
      </div>
      <h3>Crédito parcelado</h3>
      <ul className="cost-list inst">
        {cfg.taxas.parcelado.map((p) => (
          <li key={p.id}>
            <span className="inline-label">
              Parcelas
              <NumberInput ariaLabel="Número de parcelas" value={p.parcelas} min={2} max={24} integer onChange={(v) => upd((s) => ({ ...s, taxas: { ...s.taxas, parcelado: s.taxas.parcelado.map((x) => (x.id === p.id ? { ...x, parcelas: v } : x)) } }))} className="w-sm" />
            </span>
            <span className="inline-label">
              Taxa
              <NumberInput ariaLabel={`Taxa do crédito em ${p.parcelas}x`} value={p.taxa} suffix="%" max={99} onChange={(v) => upd((s) => ({ ...s, taxas: { ...s.taxas, parcelado: s.taxas.parcelado.map((x) => (x.id === p.id ? { ...x, taxa: v } : x)) } }))} className="w-sm" />
            </span>
            <button type="button" className="icon-btn danger" aria-label={`Remover parcelamento em ${p.parcelas}x`} onClick={() => upd((s) => ({ ...s, taxas: { ...s.taxas, parcelado: s.taxas.parcelado.filter((x) => x.id !== p.id) } }))}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" icon="plus" onClick={() => upd((s) => ({ ...s, taxas: { ...s.taxas, parcelado: [...s.taxas.parcelado, { id: newKey(), parcelas: Math.max(2, ...s.taxas.parcelado.map((x) => x.parcelas)) + 1, taxa: 0 }] } }))}>
        Adicionar parcelamento
      </Button>
      <hr />
      <Field label="Forma de pagamento usada no preço de tabela" hint="O preço de venda que você aplica nos produtos e que sai no PDF é calculado com a taxa desta modalidade.">
        {(id) => (
          <select id={id} value={cfg.pagamentoBase} onChange={(e) => upd((s) => ({ ...s, pagamentoBase: e.target.value }))}>
            {paymentOptions(cfg).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} · {formatPercent(o.taxa)}
              </option>
            ))}
          </select>
        )}
      </Field>
    </section>
  );
}

/* ---------------------------------------------------------------- Margem e rateio */

function AbaMargem() {
  const { state, act } = useApp();
  const cfg = state.config;
  const upd = (fn: (s: Settings) => Settings) => act.config(fn);
  const t = totals(cfg);
  const fixoPct = fixedPercentOfPrice(cfg);
  const equiv = cfg.margem.modo === 'margem' ? marginToMarkup(cfg.margem.valor) : markupToMargin(cfg.margem.valor);

  return (
    <div className="two-col">
      <section className="card">
        <h2>Margem de lucro</h2>
        <div className="seg big" role="radiogroup" aria-label="Como informar o lucro">
          <button type="button" role="radio" aria-checked={cfg.margem.modo === 'margem'} aria-pressed={cfg.margem.modo === 'margem'} onClick={() => upd((s) => ({ ...s, margem: { modo: 'margem', valor: s.margem.modo === 'markup' ? round2(markupToMargin(s.margem.valor)) : s.margem.valor } }))}>
            Margem sobre o preço
          </button>
          <button type="button" role="radio" aria-checked={cfg.margem.modo === 'markup'} aria-pressed={cfg.margem.modo === 'markup'} onClick={() => upd((s) => ({ ...s, margem: { modo: 'markup', valor: s.margem.modo === 'margem' ? round2(marginToMarkup(s.margem.valor) ?? 0) : s.margem.valor } }))}>
            Markup
          </button>
        </div>
        <Field label={cfg.margem.modo === 'margem' ? 'Margem desejada' : 'Markup desejado'}>
          {(id) => <NumberInput id={id} value={cfg.margem.valor} suffix="%" max={cfg.margem.modo === 'margem' ? 99.99 : undefined} onChange={(v) => upd((s) => ({ ...s, margem: { ...s.margem, valor: v } }))} className="w-md" />}
        </Field>
        <p className="equiv">
          {cfg.margem.modo === 'margem' ? 'Equivale a um markup de ' : 'Equivale a uma margem de '}
          <strong>{equiv == null ? '—' : formatPercent(round2(equiv))}</strong>
        </p>
        <Notice tone="info">
          <strong>Margem ≠ markup.</strong> Margem é o lucro dividido pelo preço de venda (30% de margem em R$ 10,00 de custo dá preço de R$ 14,29). Markup é o lucro dividido pelo custo (30% de markup dá R$ 13,00).
        </Notice>
      </section>

      <section className="card">
        <h2>Rateio dos custos fixos</h2>
        <p className="muted small">Os custos fixos nunca entram pelo valor cheio em cada produto. Eles são distribuídos por um destes critérios.</p>
        <div className="radio-list" role="radiogroup" aria-label="Critério de rateio">
          <label className="radio">
            <input type="radio" name="rateio" checked={cfg.rateio.metodo === 'faturamento'} onChange={() => upd((s) => ({ ...s, rateio: { ...s.rateio, metodo: 'faturamento' } }))} />
            <span>
              <strong>Por faturamento previsto</strong>
              <small>Custos fixos ÷ faturamento mensal = percentual aplicado sobre o preço.</small>
            </span>
          </label>
          <label className="radio">
            <input type="radio" name="rateio" checked={cfg.rateio.metodo === 'quantidade'} onChange={() => upd((s) => ({ ...s, rateio: { ...s.rateio, metodo: 'quantidade' } }))} />
            <span>
              <strong>Por quantidade vendida</strong>
              <small>Custos fixos ÷ unidades vendidas no mês = valor somado ao custo de cada unidade.</small>
            </span>
          </label>
        </div>
        {cfg.rateio.metodo === 'faturamento' ? (
          <Field label="Faturamento mensal previsto">{(id) => <MoneyInput id={id} value={cfg.rateio.faturamentoPrevisto || null} onChange={(v) => upd((s) => ({ ...s, rateio: { ...s.rateio, faturamentoPrevisto: v ?? 0 } }))} />}</Field>
        ) : (
          <Field label="Quantidade mensal prevista (unidades de venda)">{(id) => <NumberInput id={id} value={cfg.rateio.quantidadePrevista} onChange={(v) => upd((s) => ({ ...s, rateio: { ...s.rateio, quantidadePrevista: v } }))} className="w-md" />}</Field>
        )}
        <p className="equiv">
          Custos fixos totais: <strong>{formatBRL(t.fixosCents)}</strong> por mês ·{' '}
          {t.fixosCents === 0 ? (
            'nada a ratear'
          ) : cfg.rateio.metodo === 'faturamento' ? (
            fixoPct == null ? 'informe o faturamento previsto' : <>rateio de <strong>{formatPercent(round2(fixoPct))}</strong> sobre o preço</>
          ) : cfg.rateio.quantidadePrevista > 0 ? (
            <>rateio de <strong>{formatBRL(Math.round(t.fixosCents / cfg.rateio.quantidadePrevista))}</strong> por unidade</>
          ) : (
            'informe a quantidade prevista'
          )}
        </p>
      </section>
    </div>
  );
}
