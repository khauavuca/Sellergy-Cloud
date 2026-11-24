// Dados dos convites da equipe (GET /convites) + reenviar e cancelar.
// Usado pela tela Equipe (faixa de numeros, aba Convites e avisos).

import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useToast } from '../ui';

export const MOTIVO_WHATSAPP = {
  SEM_WHATSAPP: 'O WhatsApp do negócio ainda não está conectado. Copie o link e mande pelo seu WhatsApp.',
  SEM_TELEFONE: 'Sem celular pra mandar. Copie o link.',
  FALHA: 'Não conseguimos mandar pelo WhatsApp agora. Copie o link e mande pelo seu WhatsApp.',
};

export async function copiarTexto(texto, toast) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Link copiado.');
  } catch {
    toast.error('Não foi possível copiar. Selecione o link e copie.');
  }
}

/** Dados dos convites + acoes. `ativo` = so carrega quem pode gerenciar. */
export function useConvitesEquipe(ativo = true) {
  const toast = useToast();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get('/convites');
      setDados(r.data);
      setErro(null);
    } catch (e) {
      setErro(e.response?.data?.erro || 'Não foi possível carregar os convites.');
    }
  }, []);

  useEffect(() => {
    if (!ativo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega ao montar
    carregar();
  }, [carregar, ativo]);

  const reenviar = async (c) => {
    setOcupado(c.id);
    try {
      const r = await api.post(`/convites/${c.id}/reenviar`);
      if (r.data.whatsapp?.enviado) toast.success(`Convite reenviado pro WhatsApp de ${c.nome.split(' ')[0]}.`);
      else {
        await copiarTexto(r.data.link, toast);
        toast.error(MOTIVO_WHATSAPP[r.data.whatsapp?.motivo] || MOTIVO_WHATSAPP.FALHA);
      }
      carregar();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível reenviar.');
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async (c) => {
    setOcupado(c.id);
    try {
      await api.delete(`/convites/${c.id}`);
      toast.success('Convite cancelado. O link parou de funcionar.');
      carregar();
    } catch (err) {
      toast.error(err.response?.data?.erro || 'Não foi possível cancelar.');
    } finally {
      setOcupado(null);
    }
  };

  return {
    convites: dados?.convites || [],
    vagas: dados?.vagas || null,
    carregado: dados !== null,
    erro,
    ocupado,
    carregar,
    reenviar,
    cancelar,
  };
}
