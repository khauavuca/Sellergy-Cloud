-- Conta de recebimento: trava do saque (um saque por vez, com intervalo minimo).
ALTER TABLE "contas_recebimento" ADD COLUMN "saqueTravadoAte" TIMESTAMP(3);
