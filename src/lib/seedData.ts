import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  addMonthsISO,
  computeVatBreakdown,
  getTodayISO,
  hydrateContract,
  recalculateContractFromLedger,
  round2,
} from './debtEngine';
import type { ActiveContractType, ContractRecord, PaymentMethod, PaymentRecord, Region } from '../types/billing';

interface SeedContractBlueprint {
  contractCode: string;
  clinicName: string;
  parentClinicName: string;
  contactPerson: string;
  contactPhone: string;
  taxId: string;
  companyAddress: string;
  equipmentModel: string;
  serialNumber: string;
  deliveryOffsetMonths: number;
  warrantyMonths: number;
  region: Region;
  contractType: ActiveContractType;
  totalBeforeVat: number;
  downPayment: number;
  securityDeposit: number;
  totalInstallments: number;
  startOffsetMonths: number;
  startDayOffset?: number;
  paidInstallmentsCount: number;
  partialExtraAmount?: number;
  penaltyRatePercent: number;
  notes: string;
}

const SAMPLE_BLUEPRINTS: SeedContractBlueprint[] = [
  {
    contractCode: 'CNT-2026-001',
    clinicName: 'Aura Aesthetic ทองหล่อ (สาขาหลัก)',
    parentClinicName: 'เครือ Aura Wellness Group',
    contactPerson: 'พญ.ณัฐธิดา วรเวช',
    contactPhone: '081-890-1122',
    taxId: '0105561044821',
    companyAddress: '188 ซ.ทองหล่อ 11 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110',
    equipmentModel: 'Pico Laser',
    serialNumber: 'PIC-2026-88412',
    deliveryOffsetMonths: -4,
    warrantyMonths: 24,
    region: 'BKK',
    contractType: 'เช่าซื้อ',
    totalBeforeVat: 1800000,
    downPayment: 300000,
    securityDeposit: 0,
    totalInstallments: 24,
    startOffsetMonths: -4,
    paidInstallmentsCount: 5, // prepaid ahead 1 month!
    penaltyRatePercent: 1.5,
    notes: 'คลินิก flagship ประวัติดี ชำระล่วงหน้าสม่ำเสมอ',
  },
  {
    contractCode: 'CNT-2026-002',
    clinicName: 'Aura Aesthetic อารีย์ (สาขา 2)',
    parentClinicName: 'เครือ Aura Wellness Group',
    contactPerson: 'คุณพิมพ์ชนก ศรีสุวรรณ',
    contactPhone: '089-445-7733',
    taxId: '0105561044821',
    companyAddress: '42 ถ.พหลโยธิน ซ.อารีย์ 3 แขวงพญาไท กรุงเทพฯ 10400',
    equipmentModel: 'HIFU Ultramax 7D',
    serialNumber: 'HF7-2026-31904',
    deliveryOffsetMonths: -2,
    warrantyMonths: 18,
    region: 'BKK',
    contractType: 'เช่า',
    totalBeforeVat: 600000,
    downPayment: 0,
    securityDeposit: 80000,
    totalInstallments: 12,
    startOffsetMonths: -2,
    startDayOffset: 4, // Upcoming due within 7 days!
    paidInstallmentsCount: 2,
    penaltyRatePercent: 1.5,
    notes: 'สัญญาเช่าเครื่อง HIFU มีเงินประกันสัญญาแยกไว้ 80,000 บาท',
  },
  {
    contractCode: 'CNT-2026-019',
    clinicName: 'พญาไท เลเซอร์ เซ็นเตอร์',
    parentClinicName: 'พญาไท เมดิคอล กรุ๊ป',
    contactPerson: 'คุณธนกร อัครเดช',
    contactPhone: '086-312-9901',
    taxId: '0105559128340',
    companyAddress: '315 ถ.พญาไท เขตราชเทวี กรุงเทพฯ 10400',
    equipmentModel: 'Diode Laser',
    serialNumber: 'DIO-2025-55210',
    deliveryOffsetMonths: -5,
    warrantyMonths: 24,
    region: 'BKK',
    contractType: 'เช่าซื้อ',
    totalBeforeVat: 1120000,
    downPayment: 180000,
    securityDeposit: 0,
    totalInstallments: 18,
    startOffsetMonths: -5,
    paidInstallmentsCount: 3,
    partialExtraAmount: 18000, // partial payment on installment 4
    penaltyRatePercent: 1.5,
    notes: 'ชำระงวดที่ 4 เข้ามาบางส่วน รอโอนส่วนที่เหลือสัปดาห์นี้',
  },
  {
    contractCode: 'CNT-2025-118',
    clinicName: 'เชียงใหม่ เวลเนส คลินิก',
    parentClinicName: 'Lanna Aesthetic Network',
    contactPerson: 'นพ.ศุภชัย จันทร์แก้ว',
    contactPhone: '081-950-4411',
    taxId: '0505560012945',
    companyAddress: '99 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200',
    equipmentModel: 'Pico Laser',
    serialNumber: 'PIC-2025-19044',
    deliveryOffsetMonths: -6,
    warrantyMonths: 24,
    region: 'North',
    contractType: 'เช่าซื้อ',
    totalBeforeVat: 1500000,
    downPayment: 200000,
    securityDeposit: 0,
    totalInstallments: 24,
    startOffsetMonths: -6,
    paidInstallmentsCount: 2, // Overdue > 90 days -> triggers >60 day PM hold badge!
    penaltyRatePercent: 1.5,
    notes: 'ค้างชำระเกิน 60 วัน เข้าเกณฑ์ชะลอ PM ชั่วคราวและเจรจาปรับโครงสร้างหนี้',
  },
  {
    contractCode: 'CNT-2026-045',
    clinicName: 'ภูเก็ต เมดิคอล สปา',
    parentClinicName: 'Andaman Wellness Co., Ltd.',
    contactPerson: 'คุณกัญญารัตน์ ภูเก็ต',
    contactPhone: '084-771-2233',
    taxId: '0835562008911',
    companyAddress: '210 ถ.ราษฎร์อุทิศ ต.ป่าตอง อ.กะทู้ จ.ภูเก็ต 83150',
    equipmentModel: 'HIFU Ultramax 7D',
    serialNumber: 'HF7-2026-66721',
    deliveryOffsetMonths: -3,
    warrantyMonths: 24,
    region: 'South',
    contractType: 'ซื้อขาย',
    totalBeforeVat: 950000,
    downPayment: 250000,
    securityDeposit: 0,
    totalInstallments: 10,
    startOffsetMonths: -3,
    startDayOffset: 5, // Upcoming due within 7 days!
    paidInstallmentsCount: 3,
    penaltyRatePercent: 1.25,
    notes: 'ครบกำหนดงวดถัดไปในอีก 5 วัน เตรียมส่งแจ้งเตือนผ่าน LINE',
  },
  {
    contractCode: 'CNT-2026-072',
    clinicName: 'ขอนแก่น เดอร์มา แคร์',
    parentClinicName: 'ขอนแก่น เดอร์มา แคร์',
    contactPerson: 'พญ.อรุณี วัฒนากูล',
    contactPhone: '089-711-5520',
    taxId: '0405563004120',
    companyAddress: '55/4 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000',
    equipmentModel: 'Diode Laser',
    serialNumber: 'DIO-2026-77301',
    deliveryOffsetMonths: -4,
    warrantyMonths: 12,
    region: 'Northeast',
    contractType: 'เช่า',
    totalBeforeVat: 480000,
    downPayment: 0,
    securityDeposit: 50000,
    totalInstallments: 12,
    startOffsetMonths: -4,
    paidInstallmentsCount: 1, // Overdue > 60 days!
    penaltyRatePercent: 1.5,
    notes: 'ค้างชำระเกิน 60 วัน ต้องประสานทีมช่างชะลอ PM และติดตามเร่งด่วน',
  },
  {
    contractCode: 'CNT-2026-091',
    clinicName: 'พัทยา สกิน แอนด์ เลเซอร์',
    parentClinicName: 'Eastern Beauty Clinic Group',
    contactPerson: 'คุณวรพล ชลบุรี',
    contactPhone: '085-221-8899',
    taxId: '0205564019283',
    companyAddress: '777 ถ.พัทยาเหนือ ต.นาเกลือ อ.บางละมุง จ.ชลบุรี 20150',
    equipmentModel: 'RF Microneedling',
    serialNumber: 'RFM-2026-10293',
    deliveryOffsetMonths: -1,
    warrantyMonths: 24,
    region: 'East',
    contractType: 'ซื้อขาย',
    totalBeforeVat: 780000,
    downPayment: 150000,
    securityDeposit: 0,
    totalInstallments: 12,
    startOffsetMonths: -1,
    startDayOffset: 2, // Upcoming due in 2 days!
    paidInstallmentsCount: 1,
    penaltyRatePercent: 1.5,
    notes: 'งวดที่ 2 ครบกำหนดภายใน 2 วันข้างหน้า',
  },
];

export async function seedSamplePortfolio(uid: string, assigneeLabel: string): Promise<void> {
  const today = getTodayISO();
  const batch = writeBatch(db);
  const contractsCol = collection(db, 'contracts');
  const paymentsCol = collection(db, 'payments');

  SAMPLE_BLUEPRINTS.forEach((bp, idx) => {
    const contractRef = doc(contractsCol);
    const vat = computeVatBreakdown(bp.totalBeforeVat, 'before_vat', true);
    const baseStart = addMonthsISO(today, bp.startOffsetMonths);
    let adjustedStart = baseStart;
    if (bp.startDayOffset !== undefined) {
      const target = new Date(`${today}T00:00:00Z`);
      target.setUTCDate(target.getUTCDate() + bp.startDayOffset);
      const targetDue = target.toISOString().slice(0, 10);
      adjustedStart = addMonthsISO(targetDue, -bp.paidInstallmentsCount);
    }

    const deliveryDate = addMonthsISO(adjustedStart, 0);
    const warrantyEndDate = addMonthsISO(deliveryDate, bp.warrantyMonths);
    const financed = round2(Math.max(0, vat.totalAmount - bp.downPayment));
    const monthlyInstallment = round2(financed / bp.totalInstallments);

    const draftContract = hydrateContract({
      id: contractRef.id,
      ownerId: uid,
      assignedRepUid: uid,
      contractCode: bp.contractCode,
      clinicName: bp.clinicName,
      parentClinicName: bp.parentClinicName,
      contactPerson: bp.contactPerson,
      contactPhone: bp.contactPhone,
      taxId: bp.taxId,
      companyAddress: bp.companyAddress,
      equipmentModel: bp.equipmentModel,
      serialNumber: bp.serialNumber,
      deliveryDate,
      warrantyEndDate,
      region: bp.region,
      contractType: bp.contractType,
      salesRep: assigneeLabel,
      creditGrade: 'A',
      includeVat: true,
      amountBeforeVat: vat.amountBeforeVat,
      vatAmount: vat.vatAmount,
      totalAmount: vat.totalAmount,
      downPayment: bp.downPayment,
      securityDeposit: bp.securityDeposit,
      totalInstallments: bp.totalInstallments,
      monthlyInstallment,
      startDate: adjustedStart,
      penaltyRatePercent: bp.penaltyRatePercent,
      waivedPenaltyAmount: 0,
      scheduleVersion: 1,
      status: 'active',
      dueDate: adjustedStart,
      notes: bp.notes,
    });

    const samplePayments: PaymentRecord[] = [];
    for (let k = 0; k < bp.paidInstallmentsCount; k++) {
      const payDate = addMonthsISO(adjustedStart, k);
      const payRef = doc(paymentsCol);
      const whtRate = bp.contractType === 'เช่า' ? 5 : 0;
      const grossInstallment = monthlyInstallment;
      const whtAmount = whtRate > 0 ? round2((grossInstallment / 1.07) * (whtRate / 100)) : 0;
      const cashAmount = round2(grossInstallment - whtAmount);
      const method: PaymentMethod = (idx + k) % 2 === 0 ? 'Bank Transfer' : 'PromptPay';

      const payObj: PaymentRecord = {
        id: payRef.id,
        ownerId: uid,
        contractId: contractRef.id,
        contractAssignedRepUid: uid,
        clinicName: bp.clinicName,
        contractCode: bp.contractCode,
        actualCashAmount: cashAmount,
        whtRate,
        whtAmount,
        amount: grossInstallment,
        paymentType: 'installment',
        paymentMethod: method,
        referenceNo: `SLIP-${bp.contractCode.replace('CNT-', '')}-0${k + 1}`,
        paidDate: payDate,
        hasAttachment: false,
        isVoided: false,
        note: `ชำระค่างวดที่ ${k + 1}`,
      };
      samplePayments.push(payObj);

      batch.set(payRef, {
        ...payObj,
        createdAt: serverTimestamp(),
      });
    }

    if (bp.partialExtraAmount && bp.partialExtraAmount > 0) {
      const payRef = doc(paymentsCol);
      const payDate = addMonthsISO(adjustedStart, bp.paidInstallmentsCount);
      const payObj: PaymentRecord = {
        id: payRef.id,
        ownerId: uid,
        contractId: contractRef.id,
        contractAssignedRepUid: uid,
        clinicName: bp.clinicName,
        contractCode: bp.contractCode,
        actualCashAmount: bp.partialExtraAmount,
        whtRate: 0,
        whtAmount: 0,
        amount: bp.partialExtraAmount,
        paymentType: 'installment',
        paymentMethod: 'Bank Transfer',
        referenceNo: `SLIP-${bp.contractCode.replace('CNT-', '')}-PART`,
        paidDate: payDate,
        hasAttachment: false,
        isVoided: false,
        note: 'ชำระบางส่วน (รอโอนส่วนต่างเพิ่มเติม)',
      };
      samplePayments.push(payObj);
      batch.set(payRef, {
        ...payObj,
        createdAt: serverTimestamp(),
      });
    }

    const ledger = recalculateContractFromLedger(draftContract, samplePayments, today);

    batch.set(contractRef, {
      ownerId: uid,
      assignedRepUid: uid,
      contractCode: draftContract.contractCode,
      clinicName: draftContract.clinicName,
      parentClinicName: draftContract.parentClinicName,
      contactPerson: draftContract.contactPerson,
      contactPhone: draftContract.contactPhone,
      taxId: draftContract.taxId,
      companyAddress: draftContract.companyAddress,
      equipmentModel: draftContract.equipmentModel,
      serialNumber: draftContract.serialNumber,
      deliveryDate: draftContract.deliveryDate,
      warrantyEndDate: draftContract.warrantyEndDate,
      region: draftContract.region,
      contractType: draftContract.contractType,
      salesRep: draftContract.salesRep,
      creditGrade: ledger.suggestedGrade,
      includeVat: true,
      amountBeforeVat: draftContract.amountBeforeVat,
      vatAmount: draftContract.vatAmount,
      totalAmount: draftContract.totalAmount,
      downPayment: draftContract.downPayment,
      securityDeposit: draftContract.securityDeposit,
      totalInstallments: draftContract.totalInstallments,
      monthlyInstallment: draftContract.monthlyInstallment,
      startDate: draftContract.startDate,
      penaltyRatePercent: draftContract.penaltyRatePercent,
      waivedPenaltyAmount: 0,
      scheduleVersion: 1,
      paidAmount: ledger.totalEffectivePaid,
      prepaidAmount: ledger.prepaidFutureAmount,
      notDueAmount: ledger.notDuePrincipal,
      dueThisMonthAmount: ledger.dueThisMonthPrincipal,
      overdueAmount: ledger.overduePrincipal,
      lastPaymentDate: ledger.lastPaymentDate || '',
      status: ledger.nextStatus,
      dueDate: ledger.nextDueDate,
      notes: draftContract.notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  const auditRef = doc(collection(db, 'auditLogs'));
  batch.set(auditRef, {
    actorUid: uid,
    actorName: assigneeLabel,
    actorRole: 'super_admin',
    action: 'โหลดชุดข้อมูลคลินิกตัวอย่าง',
    targetType: 'system',
    targetId: 'seed',
    targetLabel: 'พอร์ตสัญญาตัวอย่าง 7 คลินิก',
    afterSummary: 'สร้างสัญญาตัวอย่าง (ซื้อขาย / เช่าซื้อ / เช่า) พร้อมตารางงวดและประวัติชำระเงิน',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'contracts');
  }
}
