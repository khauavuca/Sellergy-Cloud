// Reduz a imagem escolhida (foto do perfil, logo) antes de enviar: a API so
// aceita data-URL de PNG/JPG/WEBP de ate ~300 KB. Devolve a data-URL pronta.
// Logo com transparencia continua PNG; foto vira JPEG.

const LIMITE_CARACTERES = 400 * 1024;

function carregar(arquivo) {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não foi possível ler a imagem.')); };
    img.src = url;
  });
}

export async function reduzirImagem(arquivo, { lado = 512, png = false } = {}) {
  if (!arquivo?.type?.startsWith('image/') || arquivo.type === 'image/svg+xml') {
    throw new Error('Use uma imagem PNG, JPG ou WEBP.');
  }
  const img = await carregar(arquivo);
  const escala = Math.min(1, lado / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * escala));
  canvas.height = Math.max(1, Math.round(img.height * escala));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  let dataUrl = png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
  if (dataUrl.length > LIMITE_CARACTERES) dataUrl = canvas.toDataURL('image/jpeg', 0.7);
  if (dataUrl.length > LIMITE_CARACTERES) throw new Error('Imagem muito grande mesmo depois de reduzida. Tente outra.');
  return dataUrl;
}
