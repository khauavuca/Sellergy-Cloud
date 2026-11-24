import { useEffect, useState } from 'react';
import api from '../../services/api';

// Dados do lojista mostrados no Meu perfil: o cadastro de profissional na
// agenda ligado a este login e os números do mês dele. Só busca pra quem é
// de um negócio (admin do sistema não tem agenda). Sem permissão/módulo de
// agenda, a API responde erro e os blocos simplesmente não aparecem.

function intervaloDoMes() {
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
  const fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59, 999);
  return { inicio: inicio.toISOString(), fim: fim.toISOString() };
}

function resumirMes(agendamentos) {
  const agora = Date.now();
  const lista = Array.isArray(agendamentos) ? agendamentos : [];
  const concluidos = lista.filter((a) => a.status === 'COMPLETED');
  return {
    concluidos: concluidos.length,
    valorConcluido: concluidos.reduce((s, a) => s + (Number(a.preco) || 0), 0),
    cancelados: lista.filter((a) => a.status === 'CANCELED').length,
    aAtender: lista.filter((a) => (a.status === 'PENDING' || a.status === 'CONFIRMED') && new Date(a.data).getTime() >= agora).length,
  };
}

/**
 * Retorna { ativo, carregando, especialista, mes }.
 *  - especialista: undefined = não deu pra consultar (sem acesso à agenda);
 *    null = consultou e este login não é profissional na agenda.
 *  - mes: números do mês corrente desse profissional (ou null).
 */
export function usePerfilNegocio(user) {
  const ativo = !!user?.clienteId && user?.perfil !== 'ADMIN';
  const usuarioId = user?.id;
  const [estado, setEstado] = useState({ chave: null, especialista: undefined, mes: null });
  const chave = ativo ? usuarioId : null;

  useEffect(() => {
    if (!chave) return undefined;
    let vivo = true;
    (async () => {
      let especialista;
      let mes = null;
      try {
        const r = await api.get('/especialistas');
        especialista = (r.data || []).find((e) => e.usuario?.id === chave || e.usuarioId === chave) || null;
      } catch {
        especialista = undefined;
      }
      if (especialista) {
        try {
          const r = await api.get('/agenda', { params: { ...intervaloDoMes(), especialistaId: especialista.id } });
          mes = resumirMes(r.data);
        } catch {
          mes = null;
        }
      }
      if (vivo) setEstado({ chave, especialista, mes });
    })();
    return () => { vivo = false; };
  }, [chave]);

  const carregando = ativo && estado.chave !== chave;
  return {
    ativo,
    carregando,
    especialista: carregando || !ativo ? undefined : estado.especialista,
    mes: carregando || !ativo ? null : estado.mes,
  };
}
