import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { IconeCheck } from './Icones';
import {
  DESCONTO_ANUAL, DIAS_DE_TESTE_PADRAO, PLANO_RECOMENDADO, PLANOS_RESERVA, ROTA_CADASTRO, ROTULO_RECURSO, TEXTO_PLANO,
} from './conteudo';
import { aba, botaoPrimario, botaoSecundario, container, titulo, tituloSecao } from './estilo';

const brl = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inteiro = (v) => Number(v).toLocaleString('pt-BR');
const arred = (v) => Math.round(v * 100) / 100;

/** Valida e completa a resposta da API; devolve null se vier fora do formato. */
function normalizar(dados) {
  const lista = Array.isArray(dados?.planos) ? dados.planos : null;
  if (!lista || lista.length === 0) return null;
  const planos = lista
    .filter((p) => p && typeof p.nome === 'string' && Number.isFinite(Number(p.precoMensal)))
    .map((p) => ({
      ...p,
      precoMensal: Number(p.precoMensal),
      precoAnualMensal: Number.isFinite(Number(p.precoAnualMensal)) && p.precoAnualMensal !== null
        ? Number(p.precoAnualMensal)
        : arred(Number(p.precoMensal) * (1 - DESCONTO_ANUAL)),
      limites: p.limites || {},
      recursos: p.recursos || {},
    }));
  if (planos.length === 0) return null;
  const dias = Number(dados.diasDeTeste);
  return { planos, diasDeTeste: Number.isFinite(dias) && dias > 0 ? dias : DIAS_DE_TESTE_PADRAO };
}

const RESERVA = normalizar({ planos: PLANOS_RESERVA, diasDeTeste: DIAS_DE_TESTE_PADRAO });

const textoLimite = (valor, singular, plural) => {
  if (valor === null) return `${plural} ilimitados`;
  if (valor === undefined) return null;
  return `${inteiro(valor)} ${valor === 1 ? singular : plural}`;
};

/** Itens do card: texto do prototipo para planos conhecidos; senao, monta pelos recursos. */
function itensDoPlano(plano, anterior) {
  if (TEXTO_PLANO[plano.codigo]) return TEXTO_PLANO[plano.codigo].itens;
  const chaves = Object.keys(ROTULO_RECURSO).filter((k) => plano.recursos[k]);
  if (!anterior) return chaves.map((k) => ROTULO_RECURSO[k]);
  const herdaTudo = Object.keys(anterior.recursos).every((k) => !anterior.recursos[k] || plano.recursos[k]);
  if (!herdaTudo) return chaves.map((k) => ROTULO_RECURSO[k]);
  const novos = chaves.filter((k) => !anterior.recursos[k]).map((k) => ROTULO_RECURSO[k]);
  return [`Tudo do ${anterior.nome}`, ...novos];
}

const descricaoDoPlano = (p) => TEXTO_PLANO[p.codigo]?.desc || (p.descricao ? `Para ${p.descricao}.` : null);

const chip = 'text-[13px] font-semibold bg-[#F1F2EF] rounded-lg px-2.5 py-1.5';

export default function Precos() {
  const [anual, setAnual] = useState(false);
  const [dados, setDados] = useState(RESERVA);

  useEffect(() => {
    let vivo = true;
    api.get('/publico/planos', { timeout: 8000 })
      .then((r) => {
        const ok = normalizar(r.data);
        if (vivo && ok) setDados(ok);
      })
      .catch(() => { /* fica com os precos de reserva */ });
    return () => { vivo = false; };
  }, []);

  const { planos, diasDeTeste } = dados;

  return (
    <section id="precos" aria-labelledby="titulo-precos" className="bg-[#EEF0EC]">
      <div className={`${container} py-16 sm:py-20`}>
        <div className="flex flex-wrap justify-between items-end gap-6">
          <div>
            <h2 id="titulo-precos" className={`${tituloSecao} m-0`}>Preço fixo por negócio</h2>
            <p className="mt-2.5 mb-0 text-[#4A5059] text-[17px]">Sem fidelidade. Troque de plano quando quiser.</p>
          </div>
          <div role="group" aria-label="Forma de cobrança" className="flex gap-1 p-1 bg-white rounded-full border border-[#E3E5E8]">
            {[
              { valor: false, rotulo: 'Mensal' },
              { valor: true, rotulo: `Anual · ${Math.round(DESCONTO_ANUAL * 100)}% off` },
            ].map((op) => (
              <button
                key={op.rotulo}
                type="button"
                aria-pressed={anual === op.valor}
                onClick={() => setAnual(op.valor)}
                className={aba(anual === op.valor)}
              >
                {op.rotulo}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,310px),1fr))] gap-5 mt-10 items-start">
          {planos.map((p, i) => {
            const destaque = p.codigo === PLANO_RECOMENDADO;
            const valor = anual ? p.precoAnualMensal : p.precoMensal;
            const limites = [
              textoLimite(p.limites.usuarios, 'usuário', 'usuários'),
              textoLimite(p.limites.profissionais, 'profissional', 'profissionais'),
            ].filter(Boolean).join(' · ');
            const lembretes = p.limites.lembretesMes === null
              ? 'Lembretes ilimitados'
              : p.limites.lembretesMes !== undefined ? `${inteiro(p.limites.lembretesMes)} lembretes/mês` : null;
            const descricao = descricaoDoPlano(p);
            const idTitulo = `plano-${p.codigo || i}`;

            return (
              <article
                key={p.codigo || p.nome}
                aria-labelledby={idTitulo}
                className={`relative bg-white rounded-[18px] p-7 flex flex-col gap-[18px] ${
                  destaque ? 'border-2 border-[#136F4D] shadow-[0_18px_40px_rgba(19,111,77,0.12)]' : 'border border-[#E3E5E8]'
                }`}
              >
                {destaque && (
                  <span className="absolute -top-[13px] left-7 bg-[#136F4D] text-white text-[12px] font-bold px-3 py-[5px] rounded-full">
                    Recomendado
                  </span>
                )}
                <div>
                  <h3 id={idTitulo} className={`${titulo} m-0 text-[24px] font-bold`}>{p.nome}</h3>
                  {descricao && <p className="mt-1.5 mb-0 text-[#4A5059] text-[15px]">{descricao}</p>}
                </div>
                <div>
                  <p className="m-0 flex items-baseline gap-1.5">
                    <span className="text-[16px] font-semibold">R$</span>
                    <span className={`${titulo} text-[48px] leading-[normal] font-bold tracking-[-0.03em] tabular-nums`}>{brl(valor)}</span>
                    <span className="sr-only">por mês</span>
                  </p>
                  <p className="mt-0.5 mb-0 text-[#5B616B] text-[13px]">
                    {anual
                      ? `por mês, R$ ${brl(arred(p.precoAnualMensal * 12))} cobrados por ano`
                      : 'por mês, cobrado todo mês'}
                  </p>
                </div>
                <Link to={ROTA_CADASTRO} className={destaque ? botaoPrimario : botaoSecundario}>
                  Testar o {p.nome} grátis
                </Link>
                {(limites || lembretes) && (
                  <div className="flex gap-2 flex-wrap">
                    {limites && <span className={chip}>{limites}</span>}
                    {lembretes && <span className={chip}>{lembretes}</span>}
                  </div>
                )}
                <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
                  {itensDoPlano(p, planos[i - 1]).map((r) => (
                    <li key={r} className="flex gap-2.5 items-start text-[15px] leading-[1.4]">
                      <IconeCheck className="text-[#136F4D] mt-px" />
                      {r}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>

        <p className="mt-7 mb-0 text-[#4A5059] text-[15px] leading-[1.55] max-w-[760px]">
          Todo cadastro começa com {diasDeTeste} dias do Profissional liberado. Se o teste acabar sem plano, nada é
          apagado: a conta fica só para consulta até você escolher.
        </p>
      </div>
    </section>
  );
}
