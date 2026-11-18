import { describe, expect, it } from 'vitest';
import { criarBackup, lerBackup } from '../src/core/backup';
import { defaultSettings, defaultStore } from '../src/core/defaults';
import type { ListState } from '../src/types';

const lista = (): ListState => ({
  nome: 'Lista de teste',
  categorias: ['Temperos'],
  produtos: [
    { id: 'p1', nome: 'Açafrão', categoria: 'Temperos', unidade: 'kg', custo: 1790, custosAdicionais: 0, venda: 5250, propQtd: 100, propUnidade: 'g', observacoes: 'ç ã é', estoque: 12.5 },
    { id: 'p2', nome: 'Pimenta', categoria: 'Temperos', unidade: 'kg', custo: null, custosAdicionais: 50, venda: null, propQtd: null, propUnidade: null, observacoes: '' },
  ],
});

describe('backup em texto', () => {
  it('ida e volta: restaura exatamente o que foi salvo', () => {
    const cfg = defaultSettings();
    cfg.margem = { modo: 'margem', valor: 12 };
    cfg.custosFixos = [{ id: 'f1', descricao: 'Aluguel', valor: 90000 }];
    cfg.custosVariaveis = [{ id: 'v1', descricao: 'Imposto', tipo: 'percentual', valor: 4 }];
    cfg.rateio = { metodo: 'faturamento', faturamentoPrevisto: 500000, quantidadePrevista: 0 };
    const loja = { ...defaultStore(), nomeFantasia: 'Minha Loja', telefone: '(11) 99999-0000' };
    const txt = criarBackup(lista(), loja, cfg, new Date('2026-11-18T10:00:00Z'));
    expect(txt).toContain('BACKUP DO SISTEMA DE PRECIFICAÇÃO');
    expect(txt).toContain('Produtos: 2');
    const r = lerBackup(txt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lista).toEqual(lista());
    expect(r.loja).toEqual(loja);
    expect(r.config).toEqual(cfg);
    expect(r.ignorados).toBe(0);
  });
  it('aceita o JSON puro, sem o cabeçalho', () => {
    const txt = criarBackup(lista(), defaultStore(), defaultSettings());
    const soJson = txt.slice(txt.indexOf('{'));
    expect(lerBackup(soJson).ok).toBe(true);
  });
  it('recusa arquivo que não é backup, sem lançar erro', () => {
    expect(lerBackup('olá, isto é só um texto').ok).toBe(false);
    expect(lerBackup('{"app":"outra-coisa"}').ok).toBe(false);
    expect(lerBackup('').ok).toBe(false);
    const futuro = criarBackup(lista(), defaultStore(), defaultSettings()).replace('"versao": 1', '"versao": 99');
    expect(lerBackup(futuro)).toMatchObject({ ok: false });
  });
  it('arquivo parcial ou editado: completa com padrões e ignora produto sem nome', () => {
    const txt = JSON.stringify({ app: 'temperei-backup', versao: 1, lista: { nome: 'X', produtos: [{ id: 'a', nome: 'Ok', venda: 100 }, { id: 'b' }, 7], categorias: [] }, config: { margem: { modo: 'markup', valor: 50 }, pagamentoBase: 'parcelado:nao-existe' } });
    const r = lerBackup(txt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lista.produtos).toHaveLength(1);
    expect(r.ignorados).toBe(2);
    expect(r.lista.produtos[0]).toMatchObject({ nome: 'Ok', venda: 100, custo: null, unidade: 'un', custosAdicionais: 0 });
    expect(r.config.margem).toEqual({ modo: 'markup', valor: 50 });
    expect(r.config.pagamentoBase).toBe('credito_vista');
    expect(r.loja.nomeFantasia).toBe('Temperei');
  });
  it('ids repetidos viram ids únicos e categorias dos produtos entram na lista', () => {
    const base = { app: 'temperei-backup', versao: 1, lista: { nome: 'X', categorias: [], produtos: [{ id: 'a', nome: 'A', categoria: 'Nova' }, { id: 'a', nome: 'B', categoria: 'Nova' }] } };
    const r = lerBackup(JSON.stringify(base));
    expect(r.ok && new Set(r.lista.produtos.map((p) => p.id)).size).toBe(2);
    expect(r.ok && r.lista.categorias).toEqual(['Nova']);
  });
});
