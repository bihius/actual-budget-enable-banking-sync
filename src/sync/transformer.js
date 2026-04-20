import { createHash } from 'crypto';

function fallbackId(tx) {
  const raw = `${tx.booking_date}|${tx.transaction_amount?.amount}|${tx.remittance_information?.join('|') || ''}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function transformTransaction(ebTx) {
  const rawAmount = Math.round(parseFloat(ebTx.transaction_amount.amount) * 100);
  const amount = ebTx.credit_debit_indicator === 'DBIT' ? -rawAmount : rawAmount;

  let payeeName = ebTx.credit_debit_indicator === 'DBIT'
    ? ebTx.creditor?.name
    : ebTx.debtor?.name;

  const notes = ebTx.remittance_information?.join(' ') || '';

  // Fallback: if no payee name, try to use the first line of remittance information
  if (!payeeName && ebTx.remittance_information?.length > 0) {
    payeeName = ebTx.remittance_information[0].slice(0, 50);
  }

  const importedId = ebTx.transaction_id || ebTx.entry_reference || fallbackId(ebTx);

  return {
    date: ebTx.booking_date,
    amount,
    payee_name: payeeName || null,
    imported_payee: [payeeName, notes].filter(Boolean).join(' - ').slice(0, 255) || null,
    notes: notes || null,
    imported_id: importedId,
    cleared: true,
  };
}
