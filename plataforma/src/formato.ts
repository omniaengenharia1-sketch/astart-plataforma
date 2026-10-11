// =============================================================================
// Formatacao. Estava copiada em duas telas; copia de formatacao de dinheiro e
// de data e como copia de regra: uma hora as duas discordam.
// =============================================================================

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Data sem hora e lida como meia-noite UTC e escorrega um dia no Brasil. */
function comoData(iso: string): Date {
  return iso.includes('T') ? new Date(iso) : new Date(`${iso}T12:00:00`);
}

export function porExtenso(iso: string): string {
  const d = comoData(iso);
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** 11/10. O ano só aparece quando não é o corrente. */
export function diaMes(iso: string | null): string {
  if (!iso) return '—';
  const d = comoData(iso);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return d.getFullYear() === new Date().getFullYear()
    ? `${dia}/${mes}`
    : `${dia}/${mes}/${d.getFullYear()}`;
}

export function haQuanto(iso: string | null): string {
  if (!iso) return '—';
  const quando = comoData(iso);
  const minutos = Math.round((Date.now() - quando.getTime()) / 60_000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'há 1 dia';
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}

export const reais = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** 2.800,00 sem o R$ — para coluna de tabela, onde o símbolo só faz ruído. */
export const valor = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

export function plural(n: number, um: string, muitos: string): string {
  return `${n} ${n === 1 ? um : muitos}`;
}
