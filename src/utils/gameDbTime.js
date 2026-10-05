const env = require('../config/env');

/**
 * Colunas datetime gravadas pelo jogo com GETDATE() guardam o horário local
 * do servidor (Brasília), sem fuso. O driver mssql lê datetime como se fosse
 * UTC, então o valor chega 3 h "adiantado" em UTC e o navegador mostra 3 h a
 * menos. Aqui reinterpretamos os campos do Date como horário local do banco
 * e devolvemos ISO com o offset certo (ex.: 2026-10-05T17:37:00-03:00).
 */
function fromGameDbLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString().slice(0, 19); // campos "crus" do banco
  return `${iso}${env.gameDbUtcOffset}`;
}

module.exports = { fromGameDbLocal };
