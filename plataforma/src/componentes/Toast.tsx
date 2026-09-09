export function Toast({ mensagem }: { mensagem: string | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'fixed bottom-6 left-1/2 z-40 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-tinta px-4 py-2 text-[12.5px] font-medium text-papel shadow-lg transition-all ' +
        (mensagem ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0')
      }
    >
      {mensagem ?? ''}
    </div>
  );
}
