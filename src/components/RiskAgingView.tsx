import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import {
  CONTRACT_TYPE_LABELS_TH,
  REGION_LABELS_TH,
  type CollectionLogRecord,
  type ContractRecord,
  type PaymentRecord,
  type UserRole,
} from '../types/billing';
import { formatTHB } from '../lib/billingService';
import {
  formatLineCollectionMessage,
  recalculateContractFromLedger,
  round2,
} from '../lib/debtEngine';

interface RiskAgingViewProps {
  contracts: ContractRecord[];
  payments: PaymentRecord[];
  collectionLogs: CollectionLogRecord[];
  userRole: UserRole;
  onSelectContract: (contract: ContractRecord) => void;
  onRecordPayment: (contract: ContractRecord) => void;
}

export function RiskAgingView({
  contracts,
  payments,
  collectionLogs,
  userRole,
  onSelectContract,
  onRecordPayment,
}: RiskAgingViewProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const canRecordPayment = userRole === 'accounting' || userRole === 'super_admin';

  const { atRiskContracts, totalOverdue, totalPenalty, pmHoldCount } = useMemo(() => {
    let overdue = 0;
    let penalty = 0;
    let pmHold = 0;

    const enriched = contracts.map((c) => {
      const summary = recalculateContractFromLedger(
        c,
        payments.filter((p) => p.contractId === c.id)
      );
      overdue = round2(overdue + summary.overduePrincipal);
      penalty = round2(penalty + summary.netPenalty);
      if (summary.shouldSuspendPM) pmHold++;
      const latestLog = collectionLogs.find((l) => l.contractId === c.id) || null;
      return { contract: c, summary, latestLog };
    });

    const risky = enriched
      .filter(
        ({ contract, summary }) =>
          summary.overduePrincipal > 0 ||
          summary.nextStatus === 'at_risk' ||
          ['D', 'E', 'F'].includes(summary.suggestedGrade) ||
          contract.status === 'at_risk'
      )
      .sort((a, b) => b.summary.maxOverdueDays - a.summary.maxOverdueDays);

    return {
      atRiskContracts: risky,
      totalOverdue: overdue,
      totalPenalty: penalty,
      pmHoldCount: pmHold,
    };
  }, [contracts, payments, collectionLogs]);

  const handleCopyLine = async (
    contract: ContractRecord,
    summary: ReturnType<typeof recalculateContractFromLedger>
  ) => {
    await navigator.clipboard.writeText(formatLineCollectionMessage(contract, summary));
    setCopiedId(contract.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-slate-500">การควบคุมความเสี่ยง อายุหนี้ และชะลอบริการ</p>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          ติดตามความเสี่ยง หนี้ค้างชำระ และระงับ PM
        </h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-rose-200 rounded-2xl p-5">
          <div className="text-xs font-semibold text-rose-600">ยอดค้างชำระสะสม</div>
          <div className="mt-2 text-2xl font-bold text-rose-600 font-mono-num">
            {formatTHB(totalOverdue, 2)} บาท
          </div>
          <div className="text-xs text-slate-500 mt-1">
            คลินิกกลุ่มเสี่ยง {atRiskContracts.length} แห่ง
          </div>
        </div>
        <div className="bg-white border border-amber-200 rounded-2xl p-5">
          <div className="text-xs font-semibold text-amber-700">เบี้ยปรับล่าช้าสุทธิ</div>
          <div className="mt-2 text-2xl font-bold text-amber-700 font-mono-num">
            {formatTHB(totalPenalty, 2)} บาท
          </div>
          <div className="text-xs text-slate-500 mt-1">หลังหักยอดยกเว้น (Waive)</div>
        </div>
        <div className="bg-white border border-rose-200 rounded-2xl p-5">
          <div className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5" />
            เข้าเกณฑ์ชะลอ PM (&gt; 60 วัน)
          </div>
          <div className="mt-2 text-2xl font-bold text-rose-700 font-mono-num">
            {pmHoldCount} สัญญา
          </div>
          <div className="text-xs text-slate-500 mt-1">ชะลอการเข้าซ่อมบำรุงชั่วคราว</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            รายชื่อคลินิกที่ต้องติดตามเร่งด่วน ({atRiskContracts.length})
          </h2>
        </div>

        {atRiskContracts.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">
            <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
            ไม่มีคลินิกค้างชำระหรืออยู่ในกลุ่มความเสี่ยงในขณะนี้
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {atRiskContracts.map(({ contract: c, summary, latestLog }) => (
              <div
                key={c.id}
                className="p-4 sm:px-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{c.clinicName}</span>
                    <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                      เกรด {summary.suggestedGrade}
                    </span>
                    {summary.maxOverdueDays > 0 && (
                      <span className="text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                        ค้าง {summary.maxOverdueDays} วัน
                      </span>
                    )}
                    {summary.shouldSuspendPM && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-white bg-rose-600 px-2 py-0.5 rounded">
                        <Wrench className="w-3 h-3" />
                        ชะลอการเข้าซ่อมบำรุง (PM) ชั่วคราว
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.contractCode} ({REGION_LABELS_TH[c.region]}) ·{' '}
                    {CONTRACT_TYPE_LABELS_TH[c.contractType] || c.contractType} · {c.salesRep}
                    {c.equipmentModel ? ` · ${c.equipmentModel}` : ''}
                  </div>
                  {latestLog && (
                    <div className="inline-flex items-center gap-1.5 text-[11px] text-[#082F4E] bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1 mt-1">
                      <MessageSquare className="w-3 h-3 shrink-0" />
                      <span>
                        ติดตามล่าสุด {latestLog.contactDate}: {latestLog.note}
                        {latestLog.promiseToPayDate
                          ? ` (นัดชำระ ${latestLog.promiseToPayDate})`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                  <div className="text-left lg:text-right">
                    <div className="text-[11px] text-rose-600 font-medium">
                      ยอดค้างชำระ{summary.netPenalty > 0 ? ' (+เบี้ยปรับ)' : ''}
                    </div>
                    <div className="text-base font-bold text-rose-600 font-mono-num">
                      {formatTHB(summary.overduePrincipal, 2)} บ.
                    </div>
                    {summary.netPenalty > 0 && (
                      <div className="text-[11px] text-amber-700 font-mono-num">
                        เบี้ยปรับ {formatTHB(summary.netPenalty, 2)} บ.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyLine(c, summary)}
                      className="px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      {copiedId === c.id ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          คัดลอกแล้ว
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          แจ้งเตือน LINE
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectContract(c)}
                      className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      ดูข้อมูล
                    </button>
                    {canRecordPayment && (
                      <button
                        type="button"
                        disabled={summary.nextStatus === 'settled'}
                        onClick={() => onRecordPayment(c)}
                        className="px-3 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-45 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                        รับชำระ
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
