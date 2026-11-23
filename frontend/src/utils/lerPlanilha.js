// Le planilha no NAVEGADOR (o backend nao tem lib de XLSX):
//   - CSV/TXT: parser proprio (separador , ; ou tab; UTF-8 ou Windows-1252 do Excel)
//   - XLSX/XLS/ODS: lib 'xlsx' carregada so quando precisa (import dinamico)
// Devolve { cabecalhos: string[], linhas: Array<{ _linha, valores: any[] }> }.

export const LIMITE_LINHAS = 5000;
const TAMANHO_MAX = 15 * 1024 * 1024;
const BOM = String.fromCharCode(0xfeff); // marca de UTF-8 que o Excel poe no comeco
const BOM_INICIO = new RegExp(`^${BOM}`);

function decodificar(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(BOM_INICIO, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function detectarSeparador(texto) {
  const primeira = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const conta = (c) => primeira.split(c).length - 1;
  const opcoes = [[';', conta(';')], [',', conta(',')], ['\t', conta('\t')]];
  opcoes.sort((a, b) => b[1] - a[1]);
  return opcoes[0][1] > 0 ? opcoes[0][0] : ',';
}

/** CSV com aspas (RFC 4180): campo com separador/quebra de linha entre aspas. */
export function parseCsv(texto, separador = detectarSeparador(texto)) {
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"' && campo === '') aspas = true;
    else if (c === separador) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

function montar(matriz) {
  const vazia = (l) => !l || l.every((v) => v === null || v === undefined || String(v).trim() === '');
  const idxCab = matriz.findIndex((l) => !vazia(l));
  if (idxCab < 0) throw new Error('A planilha está vazia.');
  const brutos = matriz[idxCab].map((c) => String(c ?? '').trim());
  // Coluna sem titulo ganha nome; titulo repetido ganha sufixo.
  const vistos = {};
  const cabecalhos = brutos.map((c, i) => {
    const base = c || `Coluna ${i + 1}`;
    vistos[base] = (vistos[base] || 0) + 1;
    return vistos[base] > 1 ? `${base} (${vistos[base]})` : base;
  });
  const linhas = [];
  for (let i = idxCab + 1; i < matriz.length; i++) {
    if (vazia(matriz[i])) continue;
    linhas.push({ _linha: i + 1, valores: cabecalhos.map((_, j) => matriz[i][j] ?? '') });
  }
  if (!linhas.length) throw new Error('A planilha só tem o cabeçalho, sem nenhuma linha de dados.');
  if (linhas.length > LIMITE_LINHAS) {
    throw new Error(`A planilha tem ${linhas.length.toLocaleString('pt-BR')} linhas. O máximo é ${LIMITE_LINHAS.toLocaleString('pt-BR')} por vez: divida em partes.`);
  }
  return { cabecalhos, linhas };
}

export async function lerPlanilha(arquivo) {
  if (!arquivo) throw new Error('Escolha um arquivo.');
  if (arquivo.size > TAMANHO_MAX) throw new Error('Arquivo grande demais (máximo 15 MB).');
  const nome = arquivo.name.toLowerCase();
  const buffer = await arquivo.arrayBuffer();
  if (/\.(csv|txt)$/.test(nome)) return montar(parseCsv(decodificar(buffer)));
  if (/\.(xlsx|xls|ods)$/.test(nome)) {
    const XLSX = await import('xlsx');
    let livro;
    try {
      livro = XLSX.read(buffer, { type: 'array', cellDates: false });
    } catch {
      throw new Error('Não conseguimos abrir essa planilha. Salve de novo como .xlsx ou .csv.');
    }
    const aba = livro.Sheets[livro.SheetNames[0]];
    if (!aba) throw new Error('A planilha está vazia.');
    // raw: numeros e datas chegam crus (data = numero de serie do Excel, que o servidor entende).
    return montar(XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: '', blankrows: true }));
  }
  throw new Error('Formato não aceito. Use Excel (.xlsx), .csv ou exporte do Google Planilhas.');
}

/** CSV-modelo pra baixar (separador ; abre direto no Excel brasileiro). */
export function baixarModelo(nomeArquivo, cabecalhos, exemplo) {
  const esc = (v) => (/[;"\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const conteudo = `${BOM}${cabecalhos.map(esc).join(';')}\r\n${exemplo.map(esc).join(';')}\r\n`;
  const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
