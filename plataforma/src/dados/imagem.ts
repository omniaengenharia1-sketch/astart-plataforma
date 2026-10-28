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
  /** A capa da galeria, que ocupa a largura toda. */
  capa: 1800,
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
