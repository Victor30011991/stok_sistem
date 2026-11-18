import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { useFeedback } from '../ui/feedback';
import { Button, Field, MoneyInput, Notice, NumberInput } from '../ui/ui';
import { formatBRL, formatPercent } from '../core/money';
import { calcPrice, fixedPercentOfPrice, paymentById } from '../core/pricing';
import { avisosPremissas } from '../core/avisos';
import { ENTRADA_INICIAL, ROTULOS_FIXOS, montarConfiguracao, type EntradaAssistente, type Regime } from '../core/assistente';
import { MAQUININHAS, maquininhaById } from '../core/maquininhas';

/** Configuração guiada: responde 6 perguntas e preenche custos, taxas, margem e rateio. Tudo continua editável depois. */
export default function AssistenteConfig({ onAplicado }: { onAplicado: () => void }) {
  const { state, act } = useApp();
  const { toast, confirm } = useFeedback();
  const [e, setE] = useState<EntradaAssistente>(ENTRADA_INICIAL);
  const set = (patch: Partial<EntradaAssistente>) => setE((cur) => ({ ...cur, ...patch }));
  const setFixo = (k: keyof EntradaAssistente['fixos'], v: number | null) => setE((cur) => ({ ...cur, fixos: { ...cur.fixos, [k]: v } }));
  const setEmb = (patch: Partial<EntradaAssistente['embalagem']>) => setE((cur) => ({ ...cur, embalagem: { ...cur.embalagem, ...patch } }));

  const cfg = useMemo(() => montarConfiguracao(e, state.config), [e, state.config]);
  const maq = maquininhaById(e.maquininha);
  const rateio = fixedPercentOfPrice(cfg);
  const exemplo = useMemo(() => calcPrice({ custo: 1000, custosAdicionais: 0 }, cfg, paymentById(cfg, cfg.pagamentoBase).taxa), [cfg]);
  const avisos = useMemo(() => avisosPremissas(cfg, state.lista.produtos), [cfg, state.lista.produtos]);
  const temFixos = cfg.custosFixos.length > 0;
  const faltaFaturamento = temFixos && !(e.faturamento && e.faturamento > 0);
  const jaTemCustos = state.config.custosFixos.length > 0 || state.config.custosVariaveis.length > 0;
  const lotePorUn = e.embalagem.total && e.embalagem.qtd && e.embalagem.qtd > 0 ? Math.round(e.embalagem.total / e.embalagem.qtd) : null;

  async function aplicar() {
    const ok = await confirm({
      titulo: 'Aplicar esta configuração?',
      perigo: jaTemCustos,
      confirmar: 'Aplicar configuração',
      mensagem: (
        <>
          <p>
            Isto <strong>substitui</strong> os custos fixos, custos variáveis, perdas, margem, faturamento previsto{maq ? ' e as taxas de cartão' : ''} atuais pelas respostas ao lado. Os seus produtos não mudam.
          </p>
          <p className="muted">Depois você pode ajustar qualquer valor nas outras abas.</p>
        </>
      ),
    });
    if (!ok) return;
    act.config(() => cfg);
    toast('Configuração aplicada. Confira o preço de um produto.');
    onAplicado();
  }

  return (
    <div className="calc">
      <section className="card assist-form">
        <h2>Configuração guiada</h2>
        <p className="muted small">Responda o que souber. Campos em branco ficam de fora, e você ajusta tudo depois.</p>

        <fieldset className="opt-group">
          <legend>1. Imposto</legend>
          <Field label="Como você paga imposto?">
            {(id) => (
              <select id={id} value={e.regime} onChange={(ev) => set({ regime: ev.target.value as Regime, imposto: ev.target.value === 'simples' ? 4 : 0 })}>
                <option value="mei">MEI: um valor fixo por mês (DAS)</option>
                <option value="simples">Simples Nacional: % sobre as vendas</option>
                <option value="outro">Outro ou não sei</option>
              </select>
            )}
          </Field>
          {e.regime === 'mei' ? (
            <Field label="Valor do DAS por mês" hint="Entra como custo fixo. Cerca de R$ 80: confira o valor no seu DAS.">
              {(id) => <MoneyInput id={id} value={e.das} onChange={(v) => set({ das: v })} placeholder="Ex.: 80,00" />}
            </Field>
          ) : (
            <Field label="Imposto sobre as vendas" hint={e.regime === 'simples' ? 'A 1ª faixa do Simples para comércio é 4%. Confirme a sua alíquota com o contador.' : 'Pergunte ao contador. Deixe 0 se ainda não sabe.'}>
              {(id) => <NumberInput id={id} value={e.imposto} suffix="%" max={50} onChange={(v) => set({ imposto: v })} className="w-sm" />}
            </Field>
          )}
        </fieldset>

        <fieldset className="opt-group">
          <legend>2. Despesas fixas por mês</legend>
          <p className="muted small">O que você paga todo mês, vendendo ou não. Frete e imposto de compra não entram aqui: vão na compra por lote do produto.</p>
          <div className="form-grid">
            {ROTULOS_FIXOS.map(([k, rotulo]) => (
              <Field key={k} label={rotulo}>
                {(id) => <MoneyInput id={id} value={e.fixos[k]} onChange={(v) => setFixo(k, v)} />}
              </Field>
            ))}
          </div>
        </fieldset>

        <fieldset className="opt-group">
          <legend>3. Quanto você espera vender por mês</legend>
          <Field label="Faturamento mensal previsto" hint="Soma das vendas de todos os produtos. Se não sabe, use a média dos últimos meses. É ele que divide as despesas fixas.">
            {(id) => <MoneyInput id={id} value={e.faturamento} onChange={(v) => set({ faturamento: v })} placeholder="Ex.: 10.000,00" />}
          </Field>
        </fieldset>

        <fieldset className="opt-group">
          <legend>4. Maquininha</legend>
          <Field label="Minha maquininha" hint="Preenche débito, crédito à vista e parcelas com taxas sugeridas. Confira no seu contrato.">
            {(id) => (
              <select id={id} value={e.maquininha} onChange={(ev) => set({ maquininha: ev.target.value })}>
                <option value="">Manter as taxas atuais</option>
                {MAQUININHAS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {maq && (
            <p className="muted small">
              Débito {formatPercent(maq.debito)} · crédito à vista {formatPercent(maq.creditoVista)}
              {maq.parcelado.length === 1 ? ` · ${maq.parcelado[0][0]}x ${formatPercent(maq.parcelado[0][1])}` : ` · parcelado de ${maq.parcelado[0][0]}x a ${maq.parcelado[maq.parcelado.length - 1][0]}x`} (recebimento {maq.recebimento}).
            </p>
          )}
        </fieldset>

        <fieldset className="opt-group">
          <legend>5. Embalagem</legend>
          <Field label="Como você quer lançar a embalagem?">
            {(id) => (
              <select id={id} value={e.embalagem.modo} onChange={(ev) => setEmb({ modo: ev.target.value as EntradaAssistente['embalagem']['modo'] })}>
                <option value="nenhuma">Não uso ou já está no custo do produto</option>
                <option value="unidade">Sei quanto custa a embalagem de uma unidade</option>
                <option value="lote">Sei quanto paguei por um lote de embalagens</option>
              </select>
            )}
          </Field>
          {e.embalagem.modo === 'unidade' && (
            <Field label="Custo da embalagem de UMA unidade vendida" hint="Ex.: 0,90. Não coloque o total do mês aqui.">
              {(id) => <MoneyInput id={id} value={e.embalagem.valor} onChange={(v) => setEmb({ valor: v })} />}
            </Field>
          )}
          {e.embalagem.modo === 'lote' && (
            <div className="form-grid">
              <Field label="Valor pago no lote">{(id) => <MoneyInput id={id} value={e.embalagem.total} onChange={(v) => setEmb({ total: v })} />}</Field>
              <Field label="Quantidade de embalagens" hint={lotePorUn != null ? `Dá ${formatBRL(lotePorUn)} por unidade.` : undefined}>
                {(id) => <NumberInput id={id} value={e.embalagem.qtd ?? 0} integer onChange={(v) => setEmb({ qtd: v })} className="w-sm" />}
              </Field>
            </div>
          )}
        </fieldset>

        <fieldset className="opt-group">
          <legend>6. Lucro e perdas</legend>
          <div className="form-grid">
            <Field label="Margem de lucro líquida" hint="Lucro sobre o preço, depois das despesas fixas. 10% a 15% é comum.">
              {(id) => <NumberInput id={id} value={e.margem} suffix="%" max={90} onChange={(v) => set({ margem: v })} className="w-sm" />}
            </Field>
            <Field label="Perdas e desperdícios" hint="Quebra e validade sobre o que você compra.">
              {(id) => <NumberInput id={id} value={e.perda} suffix="%" max={50} onChange={(v) => set({ perda: v })} className="w-sm" />}
            </Field>
          </div>
        </fieldset>
      </section>

      <div className="calc-main">
        <section className="card assist-preview">
          <h2>Como vai ficar</h2>
          {faltaFaturamento && <Notice tone="warn">Informe o faturamento mensal previsto: sem ele não dá para dividir as despesas fixas.</Notice>}
          {!faltaFaturamento && exemplo.ok && (
            <>
              <p className="assist-big">
                Um produto que custa <strong>R$ 10,00</strong> será vendido por <strong>{formatBRL(exemplo.precoCents)}</strong>
              </p>
              <p className="muted">
                {(exemplo.precoCents / 1000).toFixed(2).replace('.', ',')} vezes o custo · lucro de {formatBRL(exemplo.lucroCents)} por unidade ({formatPercent(Math.round(exemplo.margemPct * 10) / 10)} do preço)
              </p>
              <ul className="plain">
                {rateio != null && rateio > 0 && <li>Despesas fixas: {formatPercent(Math.round(rateio * 10) / 10)} do preço</li>}
                <li>
                  Total de despesas fixas: {formatBRL(cfg.custosFixos.reduce((a, c) => a + c.valor, 0))} por mês
                </li>
              </ul>
            </>
          )}
          {!faltaFaturamento && !exemplo.ok && <Notice tone="warn">{exemplo.motivo}</Notice>}
          {avisos.filter((a) => a.id !== 'sem-fixos' || !temFixos).map((a) => (
            <Notice key={a.id} tone={a.tom}>
              {a.texto}
            </Notice>
          ))}
          <Button icon="check" onClick={aplicar} disabled={faltaFaturamento}>
            Aplicar configuração
          </Button>
        </section>
      </div>
    </div>
  );
}
