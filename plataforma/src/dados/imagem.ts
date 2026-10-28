/**
 * Pedir a imagem do tamanho em que ela vai aparecer.
 *
 * Existe por causa de um defeito medido na galeria "Confraria 23/09", com 185
 * fotos de um cliente de verdade:
 *
 *   miniatura guardada   404 KB · PNG 427×640
 *   original             514 KB
 *
 * A "miniatura" tinha 85% do peso do original, e a grade baixava 77 MB para
 * desenhar 185 quadradinhos de 300px. Duas causas somadas: o gerador produzia
 * PNG sem saber (ver `derivadas.ts`), e a tela pedia o arquivo inteiro para
 * caber num quadrado pequeno.
 *
 * O Storage do Supabase redimensiona na entrega. A mesma assinatura vale: o
 * `width` e o `quality` vão na query, que fica FORA da assinatura, então dá
 * para pedir tamanhos diferentes do mesmo endereço assinado. Medido na mesma
 * foto:
 *
 *   /render/image/sign/... ?width=400&quality=70   →  22 KB webp
 *
 * Dezoito vezes mais leve, e vale para o que já está no balde — nenhuma foto
 * precisa ser enviada de novo.
 *
 * O formato quem escolhe é o navegador: o endpoint devolve webp para quem
 * manda `Accept: image/webp` (todos mandam, há anos) e o formato de origem para
 * quem não manda. Não é preciso pedir.
 */

/** Largura em que cada lugar mostra a imagem. Pedir maior é banda jogada fora. */
export const LARGURA = {
  /** O quadrado da grade, com folga para tela retina. */
  grade: 500,
  /**
   * A capa da galeria, que ocupa a largura toda.
   *
   * 2000 e não 1800 porque as fotos que chegam têm 2048 de lado: pedir 2000 é
   * pedir praticamente tudo o que existe, e numa tela retina de 1440 ainda
   * falta. Pedir menos seria jogar fora nitidez que já está no arquivo.
   */
  capa: 2000,
  /** A foto aberta na lupa. */
  lente: 1600,
} as const;

/**
 * Troca a entrega direta pela entrega redimensionada.
 *
 * Devolve a URL original intacta quando não reconhece o endereço — endereço de
 * exemplo, URL de blob no modo demonstração, ou um dia em que o Storage mude de
 * caminho. Melhor servir a imagem pesada do que não servir imagem nenhuma.
 */
export function noTamanho(url: string | null, largura: number, qualidade = 72): string | null {
  if (!url) return url;
  if (!url.includes('/object/sign/')) return url;
  const base = url.replace('/object/sign/', '/render/image/sign/');
  const junta = base.includes('?') ? '&' : '?';
  return `${base}${junta}width=${largura}&quality=${qualidade}`;
}

/**
 * Pedir o arquivo para BAIXAR, não para abrir.
 *
 * Quem manda baixar é o servidor, no cabeçalho `content-disposition`. O
 * atributo `download` do link é só uma sugestão, e o navegador IGNORA a
 * sugestão quando o arquivo está em outro domínio — e o Storage é outro
 * domínio. Era o defeito: clicar em "baixar" abria a foto numa aba.
 *
 * `&download=<nome>` faz o Storage responder com `attachment`. Medido na
 * mesma foto da Confraria:
 *
 *   sem o parâmetro   content-type: image/jpeg                       → abre
 *   com o parâmetro   content-disposition: attachment; filename=...  → baixa
 *
 * O parâmetro fica FORA da assinatura, como o `width` — a mesma URL assinada
 * serve para olhar e para baixar, sem assinar duas vezes.
 *
 * Endereço que não é do Storage volta intacto: no modo exemplo a URL é um
 * blob, e aí o atributo `download` funciona (mesma origem) e colar query num
 * blob só estragaria o endereço.
 */
export function paraBaixar(url: string, nome: string): string {
  if (!url.includes('/object/sign/')) return url;
  const junta = url.includes('?') ? '&' : '?';
  return `${url}${junta}download=${encodeURIComponent(nome)}`;
}
