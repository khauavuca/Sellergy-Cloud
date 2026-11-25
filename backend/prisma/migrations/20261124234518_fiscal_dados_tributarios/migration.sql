-- Dados tributarios do emitente usados para montar o corpo real da nota
-- (codigo IBGE do municipio, item da lista de servico / codigo de tributacao
-- da NFS-e, aliquota de ISS, CST/CSOSN, IBS/CBS da reforma tributaria...).
-- JSON opcional: cada chave e validada em utils/validacaoFiscal#normalizarTributacao.
-- Escrita a mao (nao gerada por `prisma migrate dev`).

-- AlterTable
ALTER TABLE "configuracoes_fiscal" ADD COLUMN "tributacao" JSONB;
