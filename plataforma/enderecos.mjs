// Os dois endereços que a galeria monta em cima da URL assinada do Storage.
//
// POR QUE ISTO EXISTE SEPARADO DOS OUTROS ROTEIROS
//
// `galeria.mjs` percorre a entrega inteira no navegador, mas roda em modo
// exemplo — e em modo exemplo a foto é um arquivo da MESMA origem
// (`/exemplo/foto-1.jpg`). Os dois defeitos que estas funções consertam só
// existem em origem CRUZADA:
//
//   · `<a download>` é ignorado quando o arquivo está em outro domínio, então
//     "baixar" ABRIA a foto numa aba em vez de baixar;
//   · a miniatura vinha no tamanho original porque ninguém pedia outro.
//
// Em modo exemplo os dois passam sem conserto nenhum: o atributo funciona
// (mesma origem) e a foto de exemplo já é pequena. Foi exatamente o que
// aconteceu — o roteiro da galeria estava verde enquanto a cliente recebia um
// link que não baixava.
//
// Então a verificação que PEGA isso não é de navegador: é dar a estas funções
// uma URL com a forma real do Storage e conferir o endereço que sai. Node 22
// importa o `.ts` direto com `--experimental-strip-types`; `imagem.ts` não tem
// import nenhum, é só função pura.
//
// Rode com: node --experimental-strip-types enderecos.mjs

import { LARGURA, noTamanho, paraBaixar } from './src/dados/imagem.ts';

const problemas = [];
const confira = (ok, queixa) => { if (!ok) problemas.push(queixa); };

// A forma de verdade: caminho, token de assinatura na query.
const ASSINADA =
  'https://tcgffzkvhyrvttshyhty.supabase.co/storage/v1/object/sign/galerias' +
  '/gal-1/DSC08819.jpg?token=eyJhbGciOiJIUzI1NiJ9.exemplo.assinatura';

// --- baixar -----------------------------------------------------------------

{
  const r = paraBaixar(ASSINADA, 'DSC08819.jpg');

  // O defeito de produção: sem `download=` o Storage responde
  // `content-type: image/jpeg` e o navegador ABRE a foto. Com ele responde
  // `content-disposition: attachment` e o navegador baixa.
  confira(r.includes('download=DSC08819.jpg'), 'paraBaixar nao pediu o download');

  // O token tem de sobreviver: endereço sem assinatura é 400, e um 400 no
  // clique de "baixar" parece exatamente com o defeito que acabou de sair.
  confira(r.includes('token=eyJhbGciOiJIUzI1NiJ9'), 'paraBaixar perdeu a assinatura');

  // Uma query só. Colar `?` duas vezes invalida tudo depois do segundo.
  confira(r.split('?').length === 2, `paraBaixar fez duas querys: ${r}`);

  // O download é do ORIGINAL. Se algum dia alguém compor `noTamanho` antes
  // daqui, a cliente baixa um webp de 1600px com nome `.jpg` — arquivo menor
  // que o que ela contratou, e com a extensão errada.
  confira(r.includes('/object/sign/'), 'o download saiu pelo endereco que redimensiona');
}

// Nome com espaço, acento e pontuação: o que sai da câmera depois de renomear
// à mão. `&` e `#` são os que QUEBRAM — `&` começa outro parâmetro e `#` corta
// o resto do endereço, então o Storage recebe um pedido sem assinatura.
{
  const nome = 'Confraria 23/10 — foto #7 & capa.jpg';
  const r = paraBaixar(ASSINADA, nome);

  // Na string CRUA, não na URL parseada: `new URL(...)` codifica sozinho o que
  // faltou codificar, e esconde justamente o defeito que isto procura. A
  // primeira versão desta verificação usou `new URL().search` e passou com o
  // `encodeURIComponent` removido.
  const query = r.slice(r.indexOf('download='));
  confira(!/[ —&#/]/.test(query.replace('download=', '')), `nome nao codificado: ${query}`);

  confira(
    new URLSearchParams(new URL(r).search).get('download') === nome,
    'o nome do arquivo nao volta inteiro',
  );
}

// Modo exemplo e blob: mesma origem, onde o atributo do link funciona. Colar
// query num blob estraga o endereço.
for (const caseiro of ['/exemplo/foto-1.jpg', 'blob:http://localhost:4178/a-b-c']) {
  confira(paraBaixar(caseiro, 'foto.jpg') === caseiro, `mexeu num endereco local: ${caseiro}`);
}

// --- tamanho ----------------------------------------------------------------

{
  const r = noTamanho(ASSINADA, LARGURA.grade);
  confira(r.includes('/render/image/sign/'), 'noTamanho nao foi para o redimensionador');
  confira(r.includes(`width=${LARGURA.grade}`), 'noTamanho nao pediu a largura');
  confira(r.includes('token=eyJhbGciOiJIUzI1NiJ9'), 'noTamanho perdeu a assinatura');
  confira(!r.includes('/object/sign/'), 'noTamanho deixou o caminho antigo');
  confira(noTamanho(null, 500) === null, 'noTamanho engoliu o nulo');
  confira(
    noTamanho('/exemplo/foto-1.jpg', 500) === '/exemplo/foto-1.jpg',
    'noTamanho mexeu num endereco local',
  );
}

// A grade pede a MENOR das três. Era a inversão que baixava 77 MB para
// desenhar 185 quadradinhos de 300px.
confira(
  LARGURA.grade < LARGURA.lente && LARGURA.lente <= LARGURA.capa,
  `as larguras estao fora de ordem: ${JSON.stringify(LARGURA)}`,
);

if (problemas.length) {
  console.log('PROBLEMAS:\n' + problemas.join('\n'));
  process.exit(1);
}
console.log('enderecos: tudo o que foi checado passou');
