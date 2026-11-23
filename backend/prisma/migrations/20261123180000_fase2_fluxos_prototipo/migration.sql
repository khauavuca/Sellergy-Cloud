-- AlterTable
ALTER TABLE "agendamentos" ADD COLUMN     "pacoteClienteId" TEXT,
ADD COLUMN     "sinalCobrancaId" TEXT,
ADD COLUMN     "sinalExpiraEm" TIMESTAMP(3),
ADD COLUMN     "sinalStatus" TEXT,
ADD COLUMN     "sinalValor" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "encaixeAutomatico" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sinalPadraoPct" INTEGER;

-- AlterTable
ALTER TABLE "configuracoes_catalogo" ADD COLUMN     "aceitaEntrega" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aceitaRetirada" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "freteEntrega" DOUBLE PRECISION,
ADD COLUMN     "online" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pedidoMinimo" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "especialistas" ADD COLUMN     "comissaoFixa" DOUBLE PRECISION,
ADD COLUMN     "comissaoProdutoPct" DOUBLE PRECISION,
ADD COLUMN     "comissaoServicoPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "sinalPercentual" INTEGER;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "papelAdmin" TEXT,
ADD COLUMN     "telefone" TEXT;

-- CreateTable
CREATE TABLE "lista_espera" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "leadId" TEXT,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "produtoId" TEXT,
    "servico" TEXT,
    "especialistaId" TEXT,
    "preferencia" TEXT,
    "diasSemana" JSONB,
    "horaInicio" TEXT,
    "horaFim" TEXT,
    "ate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "agendamentoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas_encaixe" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "agendamentoOrigemId" TEXT,
    "data" TIMESTAMP(3) NOT NULL,
    "duracao" INTEGER NOT NULL DEFAULT 60,
    "especialistaId" TEXT,
    "produtoId" TEXT,
    "servico" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "aceitaPorEnvioId" TEXT,
    "agendamentoNovoId" TEXT,
    "automatica" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ofertas_encaixe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ofertas_encaixe_envios" (
    "id" TEXT NOT NULL,
    "ofertaId" TEXT NOT NULL,
    "listaEsperaId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respostaEm" TIMESTAMP(3),
    "resposta" TEXT,

    CONSTRAINT "ofertas_encaixe_envios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacotes_modelo" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "produtoId" TEXT,
    "servico" TEXT,
    "sessoes" INTEGER NOT NULL,
    "preco" DOUBLE PRECISION NOT NULL,
    "validadeDias" INTEGER NOT NULL DEFAULT 180,
    "intervaloMinDias" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacotes_modelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacotes_cliente" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "modeloId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sessoesTotal" INTEGER NOT NULL,
    "sessoesUsadas" INTEGER NOT NULL DEFAULT 0,
    "valor" DOUBLE PRECISION NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "parcelasPagas" INTEGER NOT NULL DEFAULT 0,
    "vendaId" TEXT,
    "validoAte" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacotes_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacotes_uso" (
    "id" TEXT NOT NULL,
    "pacoteClienteId" TEXT NOT NULL,
    "agendamentoId" TEXT,
    "usadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estornadoEm" TIMESTAMP(3),

    CONSTRAINT "pacotes_uso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comissoes" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "especialistaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ATENDIMENTO',
    "vendaId" TEXT,
    "agendamentoId" TEXT,
    "descricao" TEXT,
    "base" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valor" DOUBLE PRECISION NOT NULL,
    "competencia" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'A_PAGAR',
    "pagaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "leadId" TEXT,
    "nomeCliente" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "itens" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "frete" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "entrega" TEXT NOT NULL DEFAULT 'RETIRADA',
    "endereco" TEXT,
    "observacao" TEXT,
    "origem" TEXT NOT NULL DEFAULT 'CATALOGO',
    "status" TEXT NOT NULL DEFAULT 'NOVO',
    "cobrancaId" TEXT,
    "linkPagamento" TEXT,
    "vendaId" TEXT,
    "tokenPublico" TEXT NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "canceladoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_recebimento" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "provedor" TEXT NOT NULL DEFAULT 'ASAAS',
    "contaExternaId" TEXT,
    "walletId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "dados" JSONB NOT NULL,
    "motivoRecusa" TEXT,
    "prazoRepasse" TEXT NOT NULL DEFAULT 'PADRAO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites_equipe" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "email" TEXT NOT NULL,
    "perfil" TEXT NOT NULL DEFAULT 'VENDEDOR',
    "especialistaId" TEXT,
    "token" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "aceitoEm" TIMESTAMP(3),
    "usuarioId" TEXT,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_equipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "importacoes" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "arquivoNome" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "criados" INTEGER NOT NULL DEFAULT 0,
    "juntados" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "idsCriados" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'CONCLUIDA',
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chamados" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "usuarioId" TEXT,
    "assunto" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "canal" TEXT NOT NULL DEFAULT 'APP',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chamados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chamados_mensagens" (
    "id" TEXT NOT NULL,
    "chamadoId" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "autorNome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chamados_mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comunicados" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "publico" TEXT NOT NULL DEFAULT 'TODOS',
    "noSistema" BOOLEAN NOT NULL DEFAULT true,
    "noWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "alcance" INTEGER NOT NULL DEFAULT 0,
    "criadoPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comunicados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria_admin" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT,
    "usuarioNome" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "alvoTipo" TEXT,
    "alvoId" TEXT,
    "detalhes" JSONB,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos_config" (
    "codigo" TEXT NOT NULL,
    "precoMensal" DOUBLE PRECISION NOT NULL,
    "limites" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "atualizadoPor" TEXT,

    CONSTRAINT "planos_config_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "config_plataforma" (
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_plataforma_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "lista_espera_clienteId_status_idx" ON "lista_espera"("clienteId", "status");

-- CreateIndex
CREATE INDEX "ofertas_encaixe_clienteId_status_idx" ON "ofertas_encaixe"("clienteId", "status");

-- CreateIndex
CREATE INDEX "ofertas_encaixe_status_expiraEm_idx" ON "ofertas_encaixe"("status", "expiraEm");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_encaixe_envios_token_key" ON "ofertas_encaixe_envios"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ofertas_encaixe_envios_ofertaId_listaEsperaId_key" ON "ofertas_encaixe_envios"("ofertaId", "listaEsperaId");

-- CreateIndex
CREATE INDEX "pacotes_modelo_clienteId_ativo_idx" ON "pacotes_modelo"("clienteId", "ativo");

-- CreateIndex
CREATE INDEX "pacotes_cliente_clienteId_status_idx" ON "pacotes_cliente"("clienteId", "status");

-- CreateIndex
CREATE INDEX "pacotes_cliente_leadId_idx" ON "pacotes_cliente"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "pacotes_uso_agendamentoId_key" ON "pacotes_uso"("agendamentoId");

-- CreateIndex
CREATE INDEX "comissoes_clienteId_competencia_idx" ON "comissoes"("clienteId", "competencia");

-- CreateIndex
CREATE INDEX "comissoes_especialistaId_competencia_idx" ON "comissoes"("especialistaId", "competencia");

-- CreateIndex
CREATE UNIQUE INDEX "comissoes_agendamentoId_tipo_key" ON "comissoes"("agendamentoId", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_vendaId_key" ON "pedidos"("vendaId");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_tokenPublico_key" ON "pedidos"("tokenPublico");

-- CreateIndex
CREATE INDEX "pedidos_clienteId_status_idx" ON "pedidos"("clienteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_clienteId_numero_key" ON "pedidos"("clienteId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "contas_recebimento_clienteId_key" ON "contas_recebimento"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "contas_recebimento_contaExternaId_key" ON "contas_recebimento"("contaExternaId");

-- CreateIndex
CREATE UNIQUE INDEX "convites_equipe_token_key" ON "convites_equipe"("token");

-- CreateIndex
CREATE INDEX "convites_equipe_clienteId_idx" ON "convites_equipe"("clienteId");

-- CreateIndex
CREATE INDEX "importacoes_clienteId_criadoEm_idx" ON "importacoes"("clienteId", "criadoEm");

-- CreateIndex
CREATE INDEX "chamados_status_atualizadoEm_idx" ON "chamados"("status", "atualizadoEm");

-- CreateIndex
CREATE INDEX "chamados_clienteId_idx" ON "chamados"("clienteId");

-- CreateIndex
CREATE INDEX "chamados_mensagens_chamadoId_criadoEm_idx" ON "chamados_mensagens"("chamadoId", "criadoEm");

-- CreateIndex
CREATE INDEX "auditoria_admin_criadoEm_idx" ON "auditoria_admin"("criadoEm");

-- CreateIndex
CREATE INDEX "auditoria_admin_alvoTipo_alvoId_idx" ON "auditoria_admin"("alvoTipo", "alvoId");

-- AddForeignKey
ALTER TABLE "ofertas_encaixe_envios" ADD CONSTRAINT "ofertas_encaixe_envios_ofertaId_fkey" FOREIGN KEY ("ofertaId") REFERENCES "ofertas_encaixe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ofertas_encaixe_envios" ADD CONSTRAINT "ofertas_encaixe_envios_listaEsperaId_fkey" FOREIGN KEY ("listaEsperaId") REFERENCES "lista_espera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacotes_cliente" ADD CONSTRAINT "pacotes_cliente_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "pacotes_modelo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacotes_uso" ADD CONSTRAINT "pacotes_uso_pacoteClienteId_fkey" FOREIGN KEY ("pacoteClienteId") REFERENCES "pacotes_cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamados_mensagens" ADD CONSTRAINT "chamados_mensagens_chamadoId_fkey" FOREIGN KEY ("chamadoId") REFERENCES "chamados"("id") ON DELETE CASCADE ON UPDATE CASCADE;

