import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, ExternalLink, Lock } from 'lucide-react';
import clsx from 'clsx';
import api from '../../services/api';
import Modal from '../Modal';
import { Button, Input, useToast } from '../ui';
import { FORMA_PAGAMENTO, brl, mascararCpfCnpj } from './rotulosAssinatura';

const DESCRICAO_RECURSOS = {
  notaFiscal: 'Nota fiscal (NFC-e e NFS-e)',
  campanhas: 'Campanhas e recompra',
  pacotes: 'Pacotes de sessões',
  linkAgendamento: 'Link de agendamento online',
  catalogoOnline: 'Catálogo online',
  atendimentoIa: 'Atendimento com IA',
  relatoriosAvancados: 'Relatórios avançados',
};

const FORMAS = ['PIX', 'CREDIT_CARD', 'BOLETO', 'UNDEFINED'];
const DESCONTO_ANUAL = 0.2;

const arred = (v) => Math.round(v * 100) / 100;
const anualMensal = (p) => (Number.isFinite(Number(p.precoAnualMensal)) && p.precoAnualMensal !== null
  ? Number(p.precoAnualMensal)
  : arred(Number(p.precoMensal) * (1 - DESCONTO_ANUAL)));

const textoLimite = (v, plural) => (v === null || v === undefined ? `${plural} ilimitados` : `${Number(v).toLocaleString('pt-BR')} ${plural}`);

function Alternador({ rotulo, opcoes, valor, onChange }) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex flex-wrap gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
      {opcoes.map((op) => (
        <button
          key={op.valor}
          type="button"
          aria-pressed={valor === op.valor}
          onClick={() => onChange(op.valor)}
          className={clsx(
            'min-h-11 px-4 rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
            valor === op.valor
              ? 'bg-[var(--bg-card)] text-[var(--text-main)] shadow-[var(--shadow-xs)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-main)]',
          )}
        >
          {op.rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * Escolha (ou troca) de plano do tenant. Exportado para o banner e Meu plano.
 *   assinatura: o objeto `assinatura` de GET /conta/resumo.
 */
export default function ModalPlanos({ isOpen, onClose, assinatura, onAssinado }) {
  const toast = useToast();
  const [planos, setPlanos] = useState([]);
  const [erroPlanos, setErroPlanos] = useState(false);
  const [anual, setAnual] = useState(assinatura?.ciclo === 'ANUAL');
  const [forma, setForma] = useState(
    FORMAS.includes(assinatura?.formaPagamento) ? assinatura.formaPagamento : 'PIX',
  );
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [erroCpf, setErroCpf] = useState('');
  const [pedirDocumento, setPedirDocumento] = useState(false);
  const [enviando, setEnviando] = useState(null);
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    if (!isOpen || planos.length > 0) return;
    api.get('/publico/planos')
      .then((r) => { setPlanos(r.data?.planos || []); setErroPlanos(false); })
      .catch(() => setErroPlanos(true));
  }, [isOpen, planos.length]);

  const emTeste = assinatura?.status === 'TRIAL';
  const planoAtual = assinatura?.planoContratado?.codigo;
  const precisaDocumento = pedirDocumento || (assinatura?.cobrancaAutomatica === true && assinatura?.temDocumento !== true);
  const digitosDoc = cpfCnpj.replace(/\D/g, '');

  const fechar = () => {
    setResultado(null);
    setErroCpf('');
    onClose();
  };

  const assinar = async (codigo) => {
    setErroCpf('');
    if (precisaDocumento && digitosDoc.length !== 11 && digitosDoc.length !== 14) {
      setErroCpf('Informe o CPF (11 dígitos) ou o CNPJ (14 dígitos) de quem vai pagar.');
      document.getElementById('cpf-cnpj-assinatura')?.focus();
      return;
    }
    setEnviando(codigo);
    try {
      const corpo = { plano: codigo, ciclo: anual ? 'ANUAL' : 'MENSAL', formaPagamento: forma };
      if (precisaDocumento && digitosDoc) corpo.cpfCnpj = digitosDoc;
      const r = await api.post('/conta/assinar', corpo);
      setResultado({ ...r.data, assinouNoTeste: emTeste });
      onAssinado?.();
    } catch (e) {
      const dados = e.response?.data;
      if (e.response?.status === 422 && dados?.campos?.includes('cpfCnpj')) {
        setPedirDocumento(true);
        setErroCpf(dados.erro || 'Confira o CPF ou CNPJ.');
      } else if (e.response?.status === 502) {
        toast.error(dados?.erro || 'O sistema de pagamento não respondeu. Tente de novo em alguns minutos.');
      } else {
        toast.error(dados?.erro || 'Não foi possível assinar agora.');
      }
    } finally {
      setEnviando(null);
    }
  };

  if (resultado) {
    return (
      <Modal isOpen={isOpen} onClose={fechar} title="Plano escolhido" size="md">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={22} className="text-[var(--success)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-[var(--text-secondary)] space-y-1">
              <p className="font-semibold text-[var(--text-main)]">
                Plano {resultado.plano} ({resultado.ciclo === 'ANUAL' ? 'anual' : 'mensal'}) registrado.
              </p>
              {resultado.assinouNoTeste && <p>Os dias grátis que faltam continuam valendo: a primeira cobrança só vence quando o teste acabar.</p>}
            </div>
          </div>

          {resultado.linkPagamento ? (
            <div className="rounded-xl bg-[var(--bg-subtle)] p-4 space-y-3">
              <p className="text-sm text-[var(--text-secondary)] flex gap-2">
                <Lock size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
                O pagamento é feito na página segura do Asaas, nosso parceiro de cobrança. Se escolher cartão,
                você digita os dados lá; o Sellergy não vê nem guarda o número do cartão.
              </p>
              <a
                href={resultado.linkPagamento}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 min-h-11 px-5 rounded-lg bg-[var(--primary)] text-[var(--text-on-primary)] text-sm font-semibold hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2"
              >
                Pagar agora
                <ExternalLink size={16} aria-hidden="true" />
                <span className="sr-only">(abre em nova aba)</span>
              </a>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              A fatura aparece em <Link to="/app/plano" onClick={fechar} className="font-semibold text-[var(--text-main)] underline">Meu plano</Link>,
              com o vencimento e a forma de pagar.
            </p>
          )}

          <div className="flex justify-end">
            <Button variant="secondary" className="min-h-11" onClick={fechar}>Fechar</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={fechar} title="Escolha seu plano" description="Preço fixo por negócio. Sem fidelidade." size="xl">
      <div className="space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end gap-4 lg:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">Cobrança</p>
            <Alternador
              rotulo="Forma de cobrança"
              valor={anual}
              onChange={setAnual}
              opcoes={[{ valor: false, rotulo: 'Mensal' }, { valor: true, rotulo: 'Anual · 20% off' }]}
            />
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--text-secondary)] mb-1.5">Como prefere pagar</p>
            <Alternador
              rotulo="Forma de pagamento"
              valor={forma}
              onChange={setForma}
              opcoes={FORMAS.map((f) => ({ valor: f, rotulo: f === 'UNDEFINED' ? 'Escolher na hora' : FORMA_PAGAMENTO[f] }))}
            />
          </div>
        </div>

        {precisaDocumento && (
          <div className="max-w-sm">
            <Input
              id="cpf-cnpj-assinatura"
              label="CPF ou CNPJ de quem paga"
              aria-label="CPF ou CNPJ de quem paga"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(mascararCpfCnpj(e.target.value))}
              error={erroCpf || undefined}
              hint="Obrigatório para emitir a cobrança."
              aria-invalid={erroCpf ? true : undefined}
            />
          </div>
        )}

        {erroPlanos && planos.length === 0 && (
          <p role="alert" className="text-sm text-[var(--danger-text)]">Não foi possível carregar os planos. Feche e tente de novo.</p>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          {planos.map((p) => {
            const recomendado = p.codigo === 'PRO';
            const valorMes = anual ? anualMensal(p) : Number(p.precoMensal);
            return (
              <div key={p.codigo} className={clsx('rounded-xl border p-4 flex flex-col', recomendado ? 'border-[var(--primary)] border-2' : 'border-[var(--border-main)]')}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold text-[var(--text-main)]">{p.nome}</h3>
                  {recomendado && <span className="text-[11px] font-semibold text-[var(--accent-text)]">recomendado</span>}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{p.descricao}</p>
                <p className="mt-3">
                  <span className="text-2xl font-semibold text-[var(--text-main)] tabular-nums">{brl(valorMes)}</span>
                  <span className="text-sm text-[var(--text-muted)]">/mês</span>
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {anual ? `cobrado ${brl(arred(anualMensal(p) * 12))} por ano` : 'cobrado todo mês'}
                </p>
                <ul className="mt-3 space-y-1.5 text-sm text-[var(--text-secondary)] flex-1">
                  <li className="flex gap-2"><Check size={14} className="mt-1 text-[var(--success)] flex-shrink-0" aria-hidden="true" />Vendas, agenda, caixa, estoque e Pix</li>
                  <li className="flex gap-2"><Check size={14} className="mt-1 text-[var(--success)] flex-shrink-0" aria-hidden="true" />{textoLimite(p.limites?.profissionais, 'profissionais')} · {textoLimite(p.limites?.usuarios, 'usuários')}</li>
                  <li className="flex gap-2"><Check size={14} className="mt-1 text-[var(--success)] flex-shrink-0" aria-hidden="true" />{textoLimite(p.limites?.lembretesMes, 'lembretes')} de WhatsApp/mês</li>
                  {Object.entries(DESCRICAO_RECURSOS).filter(([k]) => p.recursos?.[k]).map(([k, txt]) => (
                    <li key={k} className="flex gap-2"><Check size={14} className="mt-1 text-[var(--success)] flex-shrink-0" aria-hidden="true" />{txt}</li>
                  ))}
                </ul>
                <Button
                  className="mt-4 min-h-11"
                  variant={recomendado ? 'primary' : 'secondary'}
                  fullWidth
                  loading={enviando === p.codigo}
                  disabled={enviando !== null && enviando !== p.codigo}
                  onClick={() => assinar(p.codigo)}
                >
                  {!emTeste && planoAtual === p.codigo ? 'Continuar neste' : `Assinar ${p.nome}`}
                </Button>
              </div>
            );
          })}
        </div>

        <p className="text-sm text-[var(--text-muted)]">
          Se assinar no teste, a primeira cobrança só vence no fim do teste.
          {assinatura?.cobrancaAutomatica && ' O pagamento por cartão, Pix ou boleto é feito na página segura do Asaas.'}
        </p>
      </div>
    </Modal>
  );
}
