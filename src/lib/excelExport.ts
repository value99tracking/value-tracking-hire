import * as XLSX from 'xlsx';
import {
  CONTRACT_TYPE_LABELS_TH,
  PAYMENT_METHOD_LABELS_TH,
  PAYMENT_TYPE_LABELS_TH,
  REGION_LABELS_TH,
  STATUS_LABELS_TH,
  type ContractRecord,
  type PaymentRecord,
} from '../types/billing';
import { recalculateContractFromLedger, round2 } from './debtEngine';

export function exportAccountingWorkbook(
  contracts: ContractRecord[],
  payments: PaymentRecord[]
): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive Portfolio Summary
  let totalContractValue = 0;
  let totalPaidAll = 0;
  let totalOverdueAll = 0;
  let totalDueMonthAll = 0;
  let totalNotDueAll = 0;
  let totalPenaltyAll = 0;
  let totalSecurityDepositAll = 0;

  const contractRows = contracts.map((c) => {
    const linkedPayments = payments.filter((p) => p.contractId === c.id);
    const ledger = recalculateContractFromLedger(c, linkedPayments);
    totalContractValue = round2(totalContractValue + c.totalAmount);
    totalPaidAll = round2(totalPaidAll + ledger.totalEffectivePaid);
    totalOverdueAll = round2(totalOverdueAll + ledger.overduePrincipal);
    totalDueMonthAll = round2(totalDueMonthAll + ledger.dueThisMonthPrincipal);
    totalNotDueAll = round2(totalNotDueAll + ledger.notDuePrincipal);
    totalPenaltyAll = round2(totalPenaltyAll + ledger.netPenalty);
    totalSecurityDepositAll = round2(totalSecurityDepositAll + (c.securityDeposit || 0));

    return {
      รหัสสัญญา: c.contractCode,
      คลินิกแม่: c.parentClinicName || '-',
      ชื่อคลินิกสาขา: c.clinicName,
      ประเภทสัญญา: CONTRACT_TYPE_LABELS_TH[c.contractType] || c.contractType,
      ภูมิภาค: REGION_LABELS_TH[c.region] || c.region,
      รุ่นเครื่องมือแพทย์: c.equipmentModel || '-',
      หมายเลขเครื่อง: c.serialNumber || '-',
      ผู้ดูแลลูกหนี้: c.salesRep,
      เกรดเครดิต: ledger.suggestedGrade,
      สถานะ: STATUS_LABELS_TH[ledger.nextStatus] || c.status,
      มูลค่าก่อนVAT: c.amountBeforeVat,
      VAT7: c.vatAmount,
      มูลค่าสัญญารวม: c.totalAmount,
      เงินดาวน์: c.downPayment,
      เงินประกันสัญญาเช่า: c.securityDeposit,
      จำนวนงวด: c.restructuredTotalInstallments || c.totalInstallments,
      ค่างวดต่อเดือน: c.restructuredMonthlyAmount || c.monthlyInstallment,
      ชำระแล้วสะสม: ledger.totalEffectivePaid,
      ค้างชำระ: ledger.overduePrincipal,
      ครบกำหนดเดือนนี้: ledger.dueThisMonthPrincipal,
      ยังไม่ครบกำหนด: ledger.notDuePrincipal,
      เบี้ยปรับสุทธิ: ledger.netPenalty,
      วันค้างสูงสุด: ledger.maxOverdueDays,
      ชะลอPM60วัน: ledger.shouldSuspendPM ? 'ชะลอ PM ชั่วคราว' : 'ปกติ',
      วันชำระล่าสุด: ledger.lastPaymentDate || '-',
      ครบกำหนดถัดไป: ledger.nextDueDate,
    };
  });

  const summaryRows = [
    { รายการ: 'จำนวนสัญญาทั้งหมด', จำนวน: contracts.length, หน่วย: 'สัญญา' },
    { รายการ: 'มูลค่าสัญญารวม (รวม VAT)', จำนวน: totalContractValue, หน่วย: 'บาท' },
    { รายการ: 'ยอดรับชำระสะสม (เงินสด + WHT)', จำนวน: totalPaidAll, หน่วย: 'บาท' },
    { รายการ: 'ยอดค้างชำระสะสม', จำนวน: totalOverdueAll, หน่วย: 'บาท' },
    { รายการ: 'ครบกำหนดเดือนนี้', จำนวน: totalDueMonthAll, หน่วย: 'บาท' },
    { รายการ: 'ยังไม่ครบกำหนด', จำนวน: totalNotDueAll, หน่วย: 'บาท' },
    { รายการ: 'เบี้ยปรับล่าช้าสุทธิ', จำนวน: totalPenaltyAll, หน่วย: 'บาท' },
    { รายการ: 'เงินประกันสัญญาเช่ารวม (แยกจากค่างวด)', จำนวน: totalSecurityDepositAll, หน่วย: 'บาท' },
    { รายการ: 'จำนวนรายการรับชำระ (รวมบิลที่ใช้งาน)', จำนวน: payments.filter((p) => !p.isVoided).length, หน่วย: 'รายการ' },
  ];

  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  const wsContracts = XLSX.utils.json_to_sheet(contractRows);

  const paymentRows = payments.map((p) => ({
    วันที่รับชำระ: p.paidDate,
    รหัสสัญญา: p.contractCode,
    ชื่อคลินิก: p.clinicName,
    เลขอ้างอิงสลิป: p.referenceNo,
    ประเภท: PAYMENT_TYPE_LABELS_TH[p.paymentType] || p.paymentType,
    ช่องทาง: PAYMENT_METHOD_LABELS_TH[p.paymentMethod] || p.paymentMethod,
    เงินโอนรับจริง: p.actualCashAmount ?? p.amount,
    อัตราWHT: p.whtRate ?? 0,
    ภาษีหักณที่จ่าย: p.whtAmount ?? 0,
    ยอดตัดหนี้รวม: p.amount,
    แนบสลิป: p.hasAttachment ? 'มีไฟล์แนบ' : '-',
    สถานะบิล: p.isVoided ? 'ยกเลิกแล้ว (Void)' : 'ปกติ',
    เหตุผลการแก้ไขยกเลิก: p.voidReason || p.editReason || '-',
    หมายเหตุ: p.note || '-',
  }));
  const wsPayments = XLSX.utils.json_to_sheet(paymentRows);

  const overdueInstallmentRows: Array<Record<string, string | number>> = [];
  contracts.forEach((c) => {
    const linked = payments.filter((p) => p.contractId === c.id);
    const ledger = recalculateContractFromLedger(c, linked);
    ledger.installments
      .filter((i) => i.remainingAmount > 0 && (i.status === 'overdue' || i.status === 'partial'))
      .forEach((i) => {
        overdueInstallmentRows.push({
          รหัสสัญญา: c.contractCode,
          ชื่อคลินิก: c.clinicName,
          ผู้ดูแลลูกหนี้: c.salesRep,
          งวดที่: `${i.installmentNo}/${i.totalCount}`,
          วันครบกำหนด: i.dueDate,
          ยอดเต็มงวด: i.scheduledAmount,
          ชำระแล้ว: i.paidAmount,
          ยอดค้างสุทธิ: i.remainingAmount,
          จำนวนวันค้าง: i.overdueDays,
          เบี้ยปรับคำนวณ: i.penaltyAmount,
        });
      });
  });
  const wsOverdue = XLSX.utils.json_to_sheet(
    overdueInstallmentRows.length > 0
      ? overdueInstallmentRows
      : [{ หมายเหตุ: 'ไม่มีงวดที่ค้างชำระในขณะนี้' }]
  );

  XLSX.utils.book_append_sheet(wb, wsSummary, 'สรุปภาพรวม');
  XLSX.utils.book_append_sheet(wb, wsContracts, 'สัญญาและลูกหนี้');
  XLSX.utils.book_append_sheet(wb, wsPayments, 'ประวัติรับชำระเงิน');
  XLSX.utils.book_append_sheet(wb, wsOverdue, 'งวดค้างชำระ');

  const fileName = `Value-Ebilling-Report-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
