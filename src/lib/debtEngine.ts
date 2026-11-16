import type {
  ContractRecord,
  CreditGrade,
  InstallmentStatus,
  PaymentRecord,
} from '../types/billing';

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addMonthsISO(startDateISO: string, monthsToAdd: number): string {
  const parts = startDateISO.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return startDateISO;
  }
  const [year, month, day] = parts;
  const targetMonthIndex = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const mm = String(normalizedMonth + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

export function diffDaysISO(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

export function computeVatBreakdown(
  baseInput: number,
  inputMode: 'before_vat' | 'include_vat',
  includeVat: boolean
): { amountBeforeVat: number; vatAmount: number; totalAmount: number } {
  const safeVal = round2(Math.max(0, baseInput));
  if (!includeVat) {
    return { amountBeforeVat: safeVal, vatAmount: 0, totalAmount: safeVal };
  }
  if (inputMode === 'before_vat') {
    const vat = round2(safeVal * 0.07);
    return {
      amountBeforeVat: safeVal,
      vatAmount: vat,
      totalAmount: round2(safeVal + vat),
    };
  }
  const beforeVat = round2(safeVal / 1.07);
  const vat = round2(safeVal - beforeVat);
  return {
    amountBeforeVat: beforeVat,
    vatAmount: vat,
    totalAmount: safeVal,
  };
}

export function hydrateContract(raw: Partial<ContractRecord> & { id: string }): ContractRecord {
  const totalAmount = round2(raw.totalAmount ?? 0);
  const includeVat = raw.includeVat ?? true;
  const derivedVat = computeVatBreakdown(totalAmount, 'include_vat', includeVat);
  const downPayment = round2(raw.downPayment ?? 0);
  const totalInstallments = Math.max(1, Math.min(120, Math.round(raw.totalInstallments ?? 12)));
  const financed = round2(Math.max(0, totalAmount - downPayment));
  const monthlyInstallment =
    raw.monthlyInstallment && raw.monthlyInstallment > 0
      ? round2(raw.monthlyInstallment)
      : round2(financed / totalInstallments);

  return {
    id: raw.id,
    ownerId: raw.ownerId || '',
    assignedRepUid: raw.assignedRepUid || raw.ownerId || '',
    contractCode: raw.contractCode || 'CNT-000',
    clinicName: raw.clinicName || '-',
    parentClinicName: raw.parentClinicName || '',
    contactPerson: raw.contactPerson || '',
    contactPhone: raw.contactPhone || '',
    taxId: raw.taxId || '',
    companyAddress: raw.companyAddress || '',
    equipmentModel: raw.equipmentModel || '',
    serialNumber: raw.serialNumber || '',
    deliveryDate: raw.deliveryDate || '',
    warrantyEndDate: raw.warrantyEndDate || '',
    region: raw.region || 'BKK',
    contractType: raw.contractType || 'เช่าซื้อ',
    salesRep: raw.salesRep || '-',
    creditGrade: raw.creditGrade || 'A',
    includeVat,
    amountBeforeVat: round2(raw.amountBeforeVat ?? derivedVat.amountBeforeVat),
    vatAmount: round2(raw.vatAmount ?? derivedVat.vatAmount),
    totalAmount,
    downPayment,
    securityDeposit: round2(raw.securityDeposit ?? 0),
    totalInstallments,
    monthlyInstallment,
    startDate: raw.startDate || raw.dueDate || getTodayISO(),
    penaltyRatePercent: round2(raw.penaltyRatePercent ?? 1.5),
    waivedPenaltyAmount: round2(raw.waivedPenaltyAmount ?? 0),
    restructuredFromInstallment: raw.restructuredFromInstallment,
    restructuredMonthlyAmount: raw.restructuredMonthlyAmount,
    restructuredTotalInstallments: raw.restructuredTotalInstallments,
    restructuredDate: raw.restructuredDate,
    scheduleVersion: raw.scheduleVersion ?? 1,
    paidAmount: round2(raw.paidAmount ?? 0),
    prepaidAmount: round2(raw.prepaidAmount ?? 0),
    notDueAmount: round2(raw.notDueAmount ?? 0),
    dueThisMonthAmount: round2(raw.dueThisMonthAmount ?? 0),
    overdueAmount: round2(raw.overdueAmount ?? 0),
    lastPaymentDate: raw.lastPaymentDate,
    status: raw.status || 'active',
    dueDate: raw.dueDate || raw.startDate || getTodayISO(),
    notes: raw.notes || '',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export interface ComputedInstallmentRow {
  installmentNo: number;
  totalCount: number;
  dueDate: string;
  scheduledAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InstallmentStatus;
  overdueDays: number;
  penaltyAmount: number;
  paymentDates: string[];
  paymentRefs: string[];
}

export interface ContractLedgerSummary {
  financedTotal: number;
  totalCashPaid: number;
  totalWhtPaid: number;
  totalEffectivePaid: number;
  paidTowardFinanced: number;
  excessOverContract: number;
  prepaidFutureAmount: number;
  overduePrincipal: number;
  dueThisMonthPrincipal: number;
  notDuePrincipal: number;
  grossPenalty: number;
  waivedPenalty: number;
  netPenalty: number;
  maxOverdueDays: number;
  shouldSuspendPM: boolean;
  nextDueDate: string;
  nextInstallmentNo: number | null;
  nextInstallmentRemaining: number;
  nextInstallmentScheduled: number;
  upcoming7DaysAmount: number;
  upcoming7DaysDueDate: string | null;
  upcoming7DaysInstallmentNo: number | null;
  lastPaymentDate: string | null;
  paymentDateHistory: Array<{ paidDate: string; amount: number; cash: number; wht: number; ref: string }>;
  suggestedGrade: CreditGrade;
  nextStatus: ContractRecord['status'];
  installments: ComputedInstallmentRow[];
  integrityCheck: {
    financedTotal: number;
    reconciledSum: number;
    discrepancy: number;
    isBalanced: boolean;
  };
}

export function generateScheduleAmounts(contract: ContractRecord): Array<{
  installmentNo: number;
  dueDate: string;
  scheduledAmount: number;
}> {
  const financedTotal = round2(Math.max(0, contract.totalAmount - (contract.downPayment || 0)));
  const start = contract.startDate || contract.dueDate || getTodayISO();

  const isRestructured =
    Boolean(contract.restructuredFromInstallment) &&
    Boolean(contract.restructuredTotalInstallments) &&
    (contract.restructuredTotalInstallments || 0) >= (contract.restructuredFromInstallment || 1);

  if (!isRestructured) {
    const count = Math.max(1, Math.min(120, Math.round(contract.totalInstallments || 1)));
    const baseMonthly = round2(financedTotal / count);
    const rows: Array<{ installmentNo: number; dueDate: string; scheduledAmount: number }> = [];
    let allocated = 0;

    for (let i = 1; i <= count; i++) {
      const amount = i === count ? round2(Math.max(0, financedTotal - allocated)) : baseMonthly;
      allocated = round2(allocated + amount);
      rows.push({
        installmentNo: i,
        dueDate: addMonthsISO(start, i - 1),
        scheduledAmount: amount,
      });
    }
    return rows;
  }

  // Restructured schedule: preserve installments before restructuredFromInstallment
  const fromInst = Math.max(1, Math.round(contract.restructuredFromInstallment || 1));
  const newTotal = Math.max(fromInst, Math.min(120, Math.round(contract.restructuredTotalInstallments || contract.totalInstallments)));
  const origMonthly = round2(contract.monthlyInstallment || financedTotal / Math.max(1, contract.totalInstallments));

  const rows: Array<{ installmentNo: number; dueDate: string; scheduledAmount: number }> = [];
  let allocated = 0;

  for (let i = 1; i < fromInst; i++) {
    const amount = round2(Math.min(origMonthly, Math.max(0, financedTotal - allocated)));
    allocated = round2(allocated + amount);
    rows.push({
      installmentNo: i,
      dueDate: addMonthsISO(start, i - 1),
      scheduledAmount: amount,
    });
  }

  const remainingPrincipal = round2(Math.max(0, financedTotal - allocated));
  const remainingCount = Math.max(1, newTotal - fromInst + 1);
  const newMonthly =
    contract.restructuredMonthlyAmount && contract.restructuredMonthlyAmount > 0
      ? round2(contract.restructuredMonthlyAmount)
      : round2(remainingPrincipal / remainingCount);

  let tailAllocated = 0;
  for (let i = fromInst; i <= newTotal; i++) {
    const amount =
      i === newTotal
        ? round2(Math.max(0, remainingPrincipal - tailAllocated))
        : round2(Math.min(newMonthly, Math.max(0, remainingPrincipal - tailAllocated)));
    tailAllocated = round2(tailAllocated + amount);
    rows.push({
      installmentNo: i,
      dueDate: addMonthsISO(start, i - 1),
      scheduledAmount: amount,
    });
  }

  return rows;
}

export function sortActivePaymentsChronologically(payments: PaymentRecord[]): PaymentRecord[] {
  return payments
    .filter((p) => !p.isVoided)
    .slice()
    .sort((a, b) => {
      const dateCmp = (a.paidDate || '').localeCompare(b.paidDate || '');
      if (dateCmp !== 0) return dateCmp;
      return (a.id || '').localeCompare(b.id || '');
    });
}

export function recalculateContractFromLedger(
  rawContract: ContractRecord,
  contractPayments: PaymentRecord[],
  asOfDateISO: string = getTodayISO()
): ContractLedgerSummary {
  const contract = hydrateContract(rawContract);
  const schedule = generateScheduleAmounts(contract);
  const totalCount = schedule.length;
  const financedTotal = round2(Math.max(0, contract.totalAmount - contract.downPayment));

  const activePayments = sortActivePaymentsChronologically(contractPayments);

  let totalCashPaid = 0;
  let totalWhtPaid = 0;
  let totalEffectivePaid = 0;

  const paymentSlices = activePayments.map((p) => {
    const cash = round2(p.actualCashAmount ?? p.amount ?? 0);
    const wht = round2(p.whtAmount ?? 0);
    const effective = round2(p.amount > 0 ? p.amount : cash + wht);
    totalCashPaid = round2(totalCashPaid + cash);
    totalWhtPaid = round2(totalWhtPaid + wht);
    totalEffectivePaid = round2(totalEffectivePaid + effective);
    return {
      ref: p.referenceNo,
      paidDate: p.paidDate,
      cash,
      wht,
      amount: effective,
      remainingSlice: effective,
    };
  });

  const currentMonthPrefix = asOfDateISO.slice(0, 7);
  let sliceCursor = 0;

  const installments: ComputedInstallmentRow[] = schedule.map((slot) => {
    let needed = slot.scheduledAmount;
    let paidForSlot = 0;
    const matchedDates: string[] = [];
    const matchedRefs: string[] = [];

    while (needed > 0 && sliceCursor < paymentSlices.length) {
      const slice = paymentSlices[sliceCursor];
      if (slice.remainingSlice <= 0) {
        sliceCursor++;
        continue;
      }
      const take = round2(Math.min(needed, slice.remainingSlice));
      paidForSlot = round2(paidForSlot + take);
      needed = round2(needed - take);
      slice.remainingSlice = round2(slice.remainingSlice - take);
      if (!matchedDates.includes(slice.paidDate)) matchedDates.push(slice.paidDate);
      if (!matchedRefs.includes(slice.ref)) matchedRefs.push(slice.ref);
      if (slice.remainingSlice <= 0) {
        sliceCursor++;
      }
    }

    const remainingAmount = round2(Math.max(0, slot.scheduledAmount - paidForSlot));
    const isPastDue = slot.dueDate < asOfDateISO;
    const isCurrentMonth = !isPastDue && slot.dueDate.slice(0, 7) === currentMonthPrefix;
    const overdueDays = isPastDue && remainingAmount > 0 ? Math.max(1, diffDaysISO(slot.dueDate, asOfDateISO)) : 0;

    let status: InstallmentStatus;
    if (remainingAmount <= 0) {
      status = 'paid';
    } else if (paidForSlot > 0) {
      status = 'partial';
    } else if (isPastDue) {
      status = 'overdue';
    } else if (isCurrentMonth) {
      status = 'due_this_month';
    } else {
      status = 'upcoming';
    }

    const penaltyRate = contract.penaltyRatePercent || 0;
    const penaltyAmount =
      overdueDays > 0 && penaltyRate > 0
        ? round2(remainingAmount * (penaltyRate / 100) * (overdueDays / 30))
        : 0;

    return {
      installmentNo: slot.installmentNo,
      totalCount,
      dueDate: slot.dueDate,
      scheduledAmount: slot.scheduledAmount,
      paidAmount: paidForSlot,
      remainingAmount,
      status,
      overdueDays,
      penaltyAmount,
      paymentDates: matchedDates,
      paymentRefs: matchedRefs,
    };
  });

  const excessOverContract = round2(
    paymentSlices.reduce((sum, s) => round2(sum + s.remainingSlice), 0)
  );

  const paidTowardFinanced = round2(
    installments.reduce((sum, row) => round2(sum + row.paidAmount), 0)
  );

  let overduePrincipal = 0;
  let dueThisMonthPrincipal = 0;
  let notDuePrincipal = 0;
  let prepaidTowardFuture = 0;
  let grossPenalty = 0;
  let maxOverdueDays = 0;
  let nextUnpaid: ComputedInstallmentRow | null = null;
  let upcoming7Row: ComputedInstallmentRow | null = null;

  installments.forEach((row) => {
    const isPastDue = row.dueDate < asOfDateISO;
    const isCurrentMonth = !isPastDue && row.dueDate.slice(0, 7) === currentMonthPrefix;
    const isFutureMonth = !isPastDue && row.dueDate.slice(0, 7) > currentMonthPrefix;

    if (row.remainingAmount > 0) {
      if (!nextUnpaid) nextUnpaid = row;
      if (isPastDue) {
        overduePrincipal = round2(overduePrincipal + row.remainingAmount);
      } else if (isCurrentMonth) {
        dueThisMonthPrincipal = round2(dueThisMonthPrincipal + row.remainingAmount);
      } else {
        notDuePrincipal = round2(notDuePrincipal + row.remainingAmount);
      }

      if (!isPastDue && diffDaysISO(asOfDateISO, row.dueDate) <= 7 && !upcoming7Row) {
        upcoming7Row = row;
      }
    }

    if (isFutureMonth && row.paidAmount > 0) {
      prepaidTowardFuture = round2(prepaidTowardFuture + row.paidAmount);
    }

    grossPenalty = round2(grossPenalty + row.penaltyAmount);
    if (row.overdueDays > maxOverdueDays) {
      maxOverdueDays = row.overdueDays;
    }
  });

  const prepaidFutureAmount = round2(prepaidTowardFuture + excessOverContract);
  const waivedPenalty = round2(contract.waivedPenaltyAmount || 0);
  const netPenalty = round2(Math.max(0, grossPenalty - waivedPenalty));

  const reconciledSum = round2(
    paidTowardFinanced + overduePrincipal + dueThisMonthPrincipal + notDuePrincipal
  );
  const discrepancy = round2(Math.abs(financedTotal - reconciledSum));

  let suggestedGrade: CreditGrade = 'A';
  if (maxOverdueDays > 90) suggestedGrade = 'F';
  else if (maxOverdueDays > 60) suggestedGrade = 'E';
  else if (maxOverdueDays > 30) suggestedGrade = 'D';
  else if (maxOverdueDays > 15) suggestedGrade = 'C';
  else if (maxOverdueDays > 0) suggestedGrade = 'B';
  else if (prepaidFutureAmount > 0 || (financedTotal > 0 && paidTowardFinanced >= financedTotal)) suggestedGrade = 'A+';
  else if (paidTowardFinanced > 0) suggestedGrade = 'A';
  else suggestedGrade = 'AB';

  const totalRemaining = round2(overduePrincipal + dueThisMonthPrincipal + notDuePrincipal);
  let nextStatus: ContractRecord['status'] = contract.status === 'suspended' ? 'suspended' : 'active';
  if (totalRemaining <= 0 && financedTotal >= 0) {
    nextStatus = 'settled';
  } else if (overduePrincipal > 0 || maxOverdueDays > 0) {
    nextStatus = 'at_risk';
  }

  const lastPaymentDate =
    activePayments.length > 0 ? activePayments[activePayments.length - 1].paidDate : null;

  const paymentDateHistory = activePayments
    .slice()
    .reverse()
    .map((p) => ({
      paidDate: p.paidDate,
      amount: round2(p.amount),
      cash: round2(p.actualCashAmount ?? p.amount),
      wht: round2(p.whtAmount ?? 0),
      ref: p.referenceNo,
    }));

  return {
    financedTotal,
    totalCashPaid,
    totalWhtPaid,
    totalEffectivePaid,
    paidTowardFinanced,
    excessOverContract,
    prepaidFutureAmount,
    overduePrincipal,
    dueThisMonthPrincipal,
    notDuePrincipal,
    grossPenalty,
    waivedPenalty,
    netPenalty,
    maxOverdueDays,
    shouldSuspendPM: maxOverdueDays > 60,
    nextDueDate: nextUnpaid ? (nextUnpaid as ComputedInstallmentRow).dueDate : contract.dueDate,
    nextInstallmentNo: nextUnpaid ? (nextUnpaid as ComputedInstallmentRow).installmentNo : null,
    nextInstallmentRemaining: nextUnpaid ? (nextUnpaid as ComputedInstallmentRow).remainingAmount : 0,
    nextInstallmentScheduled: nextUnpaid ? (nextUnpaid as ComputedInstallmentRow).scheduledAmount : 0,
    upcoming7DaysAmount: upcoming7Row ? (upcoming7Row as ComputedInstallmentRow).remainingAmount : 0,
    upcoming7DaysDueDate: upcoming7Row ? (upcoming7Row as ComputedInstallmentRow).dueDate : null,
    upcoming7DaysInstallmentNo: upcoming7Row ? (upcoming7Row as ComputedInstallmentRow).installmentNo : null,
    lastPaymentDate,
    paymentDateHistory,
    suggestedGrade,
    nextStatus,
    installments,
    integrityCheck: {
      financedTotal,
      reconciledSum,
      discrepancy,
      isBalanced: discrepancy <= 0.05,
    },
  };
}

export interface EarlySettlementQuote {
  remainingPrincipal: number;
  netPenalty: number;
  discountPercent: number;
  discountAmount: number;
  netPayoffAmount: number;
}

export function calculateEarlySettlement(
  summary: ContractLedgerSummary,
  discountPercent: number
): EarlySettlementQuote {
  const remainingPrincipal = round2(
    summary.overduePrincipal + summary.dueThisMonthPrincipal + summary.notDuePrincipal
  );
  const safeDiscount = Math.max(0, Math.min(50, discountPercent));
  const discountAmount = round2(summary.notDuePrincipal * (safeDiscount / 100));
  const netPayoffAmount = round2(Math.max(0, remainingPrincipal + summary.netPenalty - discountAmount));
  return {
    remainingPrincipal,
    netPenalty: summary.netPenalty,
    discountPercent: safeDiscount,
    discountAmount,
    netPayoffAmount,
  };
}

export interface PaymentAllocationPreview {
  totalApplied: number;
  allocations: Array<{
    installmentNo: number;
    dueDate: string;
    appliedAmount: number;
    remainingAfter: number;
    resultingStatus: 'ชำระครบแล้ว' | 'ชำระบางส่วน';
  }>;
  surplusCreditAfterAll: number;
  remainingBalanceAfter: number;
  willSettleContract: boolean;
}

export function previewPaymentAllocation(
  contract: ContractRecord,
  existingPayments: PaymentRecord[],
  cashAmount: number,
  whtAmount: number,
  editingPaymentId?: string,
  asOfDateISO: string = getTodayISO()
): PaymentAllocationPreview {
  const filteredPayments = editingPaymentId
    ? existingPayments.filter((p) => p.id !== editingPaymentId)
    : existingPayments;

  const before = recalculateContractFromLedger(contract, filteredPayments, asOfDateISO);
  const totalApplied = round2(Math.max(0, cashAmount) + Math.max(0, whtAmount));
  let pool = totalApplied;
  const allocations: PaymentAllocationPreview['allocations'] = [];

  for (const row of before.installments) {
    if (pool <= 0) break;
    if (row.remainingAmount <= 0) continue;

    const take = round2(Math.min(row.remainingAmount, pool));
    const remAfter = round2(row.remainingAmount - take);
    pool = round2(pool - take);
    allocations.push({
      installmentNo: row.installmentNo,
      dueDate: row.dueDate,
      appliedAmount: take,
      remainingAfter: remAfter,
      resultingStatus: remAfter <= 0 ? 'ชำระครบแล้ว' : 'ชำระบางส่วน',
    });
  }

  const totalRemainingBefore = round2(
    before.overduePrincipal + before.dueThisMonthPrincipal + before.notDuePrincipal
  );
  const remainingBalanceAfter = round2(Math.max(0, totalRemainingBefore - totalApplied));

  return {
    totalApplied,
    allocations,
    surplusCreditAfterAll: round2(pool),
    remainingBalanceAfter,
    willSettleContract: remainingBalanceAfter <= 0 && totalApplied > 0,
  };
}

export function formatLineCollectionMessage(
  contract: ContractRecord,
  summary: ContractLedgerSummary
): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

  const equipmentLine = contract.equipmentModel
    ? `เครื่องมือแพทย์: ${contract.equipmentModel}${contract.serialNumber ? ` (S/N: ${contract.serialNumber})` : ''}`
    : '';

  const overdueRows = summary.installments.filter((i) => i.status === 'overdue' || (i.remainingAmount > 0 && i.dueDate < getTodayISO()));
  const dueSoonRow = summary.upcoming7DaysInstallmentNo
    ? summary.installments.find((i) => i.installmentNo === summary.upcoming7DaysInstallmentNo)
    : null;

  const lines: string[] = [
    `เรียน ${contract.contactPerson || 'ผู้บริหาร/ฝ่ายบัญชี'} (${contract.clinicName})`,
    `ขออนุญาตแจ้งเตือนยอดชำระตามสัญญาเลขที่ ${contract.contractCode}`,
  ];
  if (equipmentLine) lines.push(equipmentLine);

  if (overdueRows.length > 0) {
    const instList = overdueRows.map((r) => `งวดที่ ${r.installmentNo}/${r.totalCount} (ครบ ${r.dueDate})`).join(', ');
    lines.push(`• ยอดค้างชำระ: ${instList} จำนวน ${fmt(summary.overduePrincipal)} บาท`);
  }
  if (summary.netPenalty > 0) {
    lines.push(`• เบี้ยปรับล่าช้าสะสม: ${fmt(summary.netPenalty)} บาท`);
  }
  if (dueSoonRow) {
    lines.push(
      `• ยอดใกล้ครบกำหนด: งวดที่ ${dueSoonRow.installmentNo}/${dueSoonRow.totalCount} (วันที่ ${dueSoonRow.dueDate}) จำนวน ${fmt(dueSoonRow.remainingAmount)} บาท`
    );
  }
  if (overdueRows.length === 0 && !dueSoonRow && summary.nextInstallmentNo) {
    lines.push(
      `• งวดถัดไป: งวดที่ ${summary.nextInstallmentNo}/${contract.totalInstallments} (วันที่ ${summary.nextDueDate}) จำนวน ${fmt(summary.nextInstallmentRemaining)} บาท`
    );
  }

  const totalSuggested =
    overdueRows.length > 0
      ? round2(summary.overduePrincipal + summary.netPenalty + (dueSoonRow ? dueSoonRow.remainingAmount : 0))
      : dueSoonRow
        ? dueSoonRow.remainingAmount
        : summary.nextInstallmentRemaining;

  lines.push(`ยอดรวมที่ต้องชำระ: ${fmt(totalSuggested)} บาท`);
  lines.push(`หากชำระเรียบร้อยแล้ว รบกวนส่งสลิปโอนเงินพร้อมหนังสือรับรองหัก ณ ที่จ่าย (ถ้ามี) กลับมาทางแชทนี้ได้เลยครับ ขอบคุณครับ`);
  return lines.join('\n');
}
