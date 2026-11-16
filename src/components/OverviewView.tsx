import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  Database,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  TrendingUp,
  Wallet,
  Wifi,
  Wrench,
} from 'lucide-react';
import {
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS_TH,
  CREDIT_GRADES,
  REGIONS,
  REGION_LABELS_TH,
  type ContractRecord,
  type CreditGrade,
  type NavTab,
  type PaymentRecord,
  type UserRole,
} from '../types/billing';
import { formatTHB } from '../lib/billingService';
import {
  formatLineCollectionMessage,
  recalculateContractFromLedger,
  round2,
  type ContractLedgerSummary,
} from '../lib/debtEngine';
import { exportAccountingWorkbook } from '../lib/excelExport';

interface OverviewViewProps {
  contracts: ContractRecord[];
  payments: PaymentRecord[];
  userRole: UserRole;
  loading: boolean;
  seeding: boolean;
  onSeedPortfolio: () => Promise<void>;
  onOpenNewContract: () => void;
  onSelectContract: (contract: ContractRecord) => void;
  onRecordPayment: (contract: ContractRecord) => void;
  onNavigateTab: (tab: NavTab) => void;
}

const GRADE_STYLE: Record<CreditGrade, { text: string; bg: string }> = {
  'A+': { text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  A: { text: 'text-slate-900', bg: 'bg-slate-100 border-slate-200' },
  AB: { text: 'text-sky-700', bg: 'bg-sky-50 border-sky-200' },
  B: { text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  C: { text: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
  D: { text: 'text-amber-800', bg: 'bg-amber-100/60 border-amber-300' },
  E: { text: 'text-rose-600', bg: 'bg-rose-50 border-rose-200' },
  F: { text: 'text-rose-700', bg: 'bg-rose-100/70 border-rose-300' },
};

const TYPE_STYLE: Record<string, string> = {
  'ซื้อขาย': 'bg-[#082F4E] text-white',
  'เช่าซื้อ': 'bg-cyan-100 text-cyan-900',
  'เช่า': 'bg-slate-800 text-white',
  SaaS: 'bg-[#082F4E] text-white',
  Hybrid: 'bg-cyan-100 text-cyan-900',
  Enterprise: 'bg-slate-800 text-white',
};

export function OverviewView({
  contracts,
  payments,
  userRole,
  loading,
  seeding,
  onSeedPortfolio,
  onOpenNewContract,
  onSelectContract,
  onRecordPayment,
  onNavigateTab,
}: OverviewViewProps) {
  const [selectedGrade, setSelectedGrade] = useState<CreditGrade | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [regionFilter, setRegionFilter] = useState<string>('ALL');
  const [repFilter, setRepFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [copiedContractId, setCopiedContractId] = useState<string | null>(null);
  const pageSize = 6;

  const enrichedContracts = useMemo(() => {
    const map = new Map<string, ContractLedgerSummary>();
    contracts.forEach((c) => {
      const linked = payments.filter((p) => p.contractId === c.id);
      map.set(c.id, recalculateContractFromLedger(c, linked));
    });
    return map;
  }, [contracts, payments]);

  const metrics = useMemo(() => {
    let totalAR = 0;
    let totalPaid = 0;
    let totalPrepaid = 0;
    let dueThisMonth = 0;
    let overdue = 0;
    let atRiskCount = 0;
    let securityDepositTotal = 0;

    const gradeCounts: Record<CreditGrade, number> = {
      'A+': 0,
      A: 0,
      AB: 0,
      B: 0,
      C: 0,
      D: 0,
      E: 0,
      F: 0,
    };

    const reps = new Set<string>();
    const upcoming7Days: Array<{ contract: ContractRecord; summary: ContractLedgerSummary }> = [];

    contracts.forEach((c) => {
      const summary = enrichedContracts.get(c.id)!;
      totalAR = round2(totalAR + c.totalAmount);
      totalPaid = round2(totalPaid + summary.totalEffectivePaid);
      totalPrepaid = round2(totalPrepaid + summary.prepaidFutureAmount);
      dueThisMonth = round2(dueThisMonth + summary.dueThisMonthPrincipal);
      overdue = round2(overdue + summary.overduePrincipal);
      securityDepositTotal = round2(securityDepositTotal + (c.securityDeposit || 0));

      const grade = summary.suggestedGrade;
      if (summary.overduePrincipal > 0 || summary.nextStatus === 'at_risk' || ['D', 'E', 'F'].includes(grade)) {
        atRiskCount += 1;
      }
      if (gradeCounts[grade] !== undefined) {
        gradeCounts[grade] += 1;
      }
      if (c.salesRep) {
        reps.add(c.salesRep);
      }
      if (summary.upcoming7DaysAmount > 0 && summary.upcoming7DaysDueDate) {
        upcoming7Days.push({ contract: c, summary });
      }
    });

    upcoming7Days.sort((a, b) =>
      (a.summary.upcoming7DaysDueDate || '').localeCompare(b.summary.upcoming7DaysDueDate || '')
    );

    const denominator = dueThisMonth + totalPaid;
    const collectedRate =
      denominator > 0 ? Math.min(100, Math.round((totalPaid / denominator) * 100)) : 0;

    return {
      totalAR,
      totalPaid,
      totalPrepaid,
      dueThisMonth,
      overdue,
      atRiskCount,
      securityDepositTotal,
      collectedRate,
      gradeCounts,
      salesReps: Array.from(reps).sort(),
      upcoming7Days,
    };
  }, [contracts, enrichedContracts]);

  const filteredContracts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return contracts.filter((c) => {
      const summary = enrichedContracts.get(c.id);
      const effectiveGrade = summary?.suggestedGrade || c.creditGrade;
      if (selectedGrade !== 'ALL' && effectiveGrade !== selectedGrade) return false;
      if (typeFilter !== 'ALL' && c.contractType !== typeFilter) return false;
      if (regionFilter !== 'ALL' && c.region !== regionFilter) return false;
      if (repFilter !== 'ALL' && c.salesRep !== repFilter) return false;
      if (q) {
        const hay = `${c.clinicName} ${c.parentClinicName || ''} ${c.contractCode} ${c.salesRep} ${c.equipmentModel || ''} ${c.serialNumber || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [contracts, enrichedContracts, selectedGrade, typeFilter, regionFilter, repFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredContracts.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedContracts = filteredContracts.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const canRecordPayment = userRole === 'accounting' || userRole === 'super_admin';
  const canExportExcel = userRole === 'accounting' || userRole === 'super_admin';

  const handleCopyLine = async (c: ContractRecord, summary: ContractLedgerSummary) => {
    const text = formatLineCollectionMessage(c, summary);
    await navigator.clipboard.writeText(text);
    setCopiedContractId(c.id);
    setTimeout(() => setCopiedContractId(null), 2000);
  };

  const handleExportCsv = () => {
    const headers = [
      'รหัสสัญญา',
      'คลินิกแม่',
      'คลินิกสาขา',
      'ประเภทสัญญา',
      'เครื่องมือแพทย์',
      'ผู้ดูแลลูกหนี้',
      'เกรด',
      'มูลค่าสัญญารวม',
      'ชำระแล้ว',
      'ชำระล่วงหน้า',
      'ยังไม่ครบกำหนด',
      'ครบกำหนดเดือนนี้',
      'ค้างชำระ',
      'ชะลอ PM',
      'ครบกำหนดถัดไป',
    ];
    const rows = filteredContracts.map((c) => {
      const s = enrichedContracts.get(c.id)!;
      return [
        c.contractCode,
        `"${(c.parentClinicName || '').replace(/"/g, '""')}"`,
        `"${c.clinicName.replace(/"/g, '""')}"`,
        c.contractType,
        `"${(c.equipmentModel || '').replace(/"/g, '""')}"`,
        `"${c.salesRep.replace(/"/g, '""')}"`,
        s.suggestedGrade,
        c.totalAmount,
        s.totalEffectivePaid,
        s.prepaidFutureAmount,
        s.notDuePrincipal,
        s.dueThisMonthPrincipal,
        s.overduePrincipal,
        s.shouldSuspendPM ? 'ชะลอ PM (>60 วัน)' : 'ปกติ',
        s.nextDueDate,
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `value-ebilling-ar-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Financial Overview Title Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">ภาพรวมทางการเงิน</p>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            แดชบอร์ดลูกหนี้ (AR)
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-emerald-700">
            <Wifi className="w-3.5 h-3.5" />
            <span>ซิงค์ข้อมูลเรียลไทม์</span>
          </div>
          <button
            type="button"
            onClick={onOpenNewContract}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#082F4E] text-white text-xs font-semibold rounded-xl hover:bg-[#0B3C63] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            เพิ่มสัญญาใหม่
          </button>
        </div>
      </div>

      {/* Empty State Onboarding Banner */}
      {!loading && contracts.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-[#082F4E] flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                เริ่มต้นใช้งานพอร์ตลูกหนี้ (เชื่อมต่อ Firebase แล้ว)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
                ยังไม่มีข้อมูลสัญญาคลินิกในระบบ คุณสามารถเพิ่มสัญญาใหม่ด้วยตนเอง หรือโหลดชุดข้อมูลคลินิกตัวอย่าง (ซื้อขาย / เช่าซื้อ / เช่า พร้อมเครือคลินิกแม่) เพื่อทดสอบระบบได้ทันที
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={seeding}
              onClick={onSeedPortfolio}
              className="px-4 py-2 text-xs font-semibold text-[#082F4E] bg-sky-50 border border-sky-200 rounded-xl hover:bg-sky-100 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {seeding ? 'กำลังโหลด...' : 'โหลดข้อมูลตัวอย่าง (7 คลินิก)'}
            </button>
            <button
              type="button"
              onClick={onOpenNewContract}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#082F4E] rounded-xl hover:bg-[#0B3C63] cursor-pointer whitespace-nowrap"
            >
              + สร้างสัญญาแรก
            </button>
          </div>
        </div>
      )}

      {/* Top Financial Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div
          className="lg:col-span-6 rounded-2xl p-6 text-white flex flex-col justify-between shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #052642 0%, #093B66 100%)',
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-sky-200/85 tracking-wide">
                ยอดลูกหนี้รวมทั้งหมด (รวม VAT)
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-bold font-mono-num tracking-tight">
                  {loading ? '—' : formatTHB(metrics.totalAR)}
                </span>
                <span className="text-sm font-semibold text-sky-200/80">บาท</span>
              </div>
              {metrics.securityDepositTotal > 0 && (
                <p className="text-[11px] text-amber-200 mt-1 font-mono-num">
                  เงินประกันสัญญาเช่าแยกบัญชี: {formatTHB(metrics.securityDepositTotal)} บาท
                </p>
              )}
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5 text-sky-200" />
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/15 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-sky-200/80">ชำระแล้ว (เงินสด+WHT)</p>
              <p className="mt-1 text-base sm:text-lg font-bold font-mono-num">
                {loading ? '—' : `${formatTHB(metrics.totalPaid)} บาท`}
              </p>
            </div>
            <div>
              <p className="text-xs text-sky-200/80">ชำระล่วงหน้า / ปัดข้ามงวด</p>
              <p className="mt-1 text-base sm:text-lg font-bold text-emerald-400 font-mono-num">
                {loading ? '—' : `${formatTHB(metrics.totalPrepaid)} บาท`}
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">ยอดต้องเก็บเดือนนี้</span>
              <Calendar className="w-4 h-4 text-sky-600 shrink-0" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">ครบกำหนดชำระในรอบเดือน</p>
            <div className="mt-3 text-2xl font-bold text-[#0F4C81] font-mono-num">
              {loading ? '—' : formatTHB(metrics.dueThisMonth)}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">เก็บเงินได้แล้ว {metrics.collectedRate}%</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigateTab('risk')}
          className="lg:col-span-3 bg-white border border-slate-200 hover:border-rose-300 rounded-2xl p-5 flex flex-col justify-between text-left transition-colors cursor-pointer"
        >
          <div className="w-full">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">ยอดค้างชำระสะสม</span>
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">เลยกำหนดชำระทั้งหมด</p>
            <div className="mt-3 text-2xl font-bold text-rose-600 font-mono-num">
              {loading ? '—' : formatTHB(metrics.overdue)}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-xs font-semibold text-rose-600 w-full">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">คลินิกกลุ่มเสี่ยง {metrics.atRiskCount} แห่ง</span>
          </div>
        </button>
      </div>

      {/* Upcoming Due in 7 Days Alert Strip */}
      {metrics.upcoming7Days.length > 0 && (
        <section className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-950">
              <BellRing className="w-4 h-4 text-amber-600" />
              <span>
                รายการครบกำหนดใน 7 วันข้างหน้า ({metrics.upcoming7Days.length} สัญญา)
              </span>
            </div>
            <span className="text-xs text-amber-800">
              กดปุ่มคัดลอกเพื่อส่งแจ้งเตือนลูกค้าทาง LINE ได้ทันที
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {metrics.upcoming7Days.map(({ contract, summary }) => (
              <div
                key={contract.id}
                className="bg-white border border-amber-200/80 rounded-xl p-3 flex items-center justify-between gap-3"
              >
                <button
                  type="button"
                  onClick={() => onSelectContract(contract)}
                  className="text-left min-w-0 cursor-pointer"
                >
                  <div className="text-xs font-bold text-slate-900 truncate">
                    {contract.clinicName}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {contract.contractCode} · งวด {summary.upcoming7DaysInstallmentNo} (ครบ{' '}
                    {summary.upcoming7DaysDueDate})
                  </div>
                  <div className="text-xs font-bold text-[#082F4E] font-mono-num mt-0.5">
                    {formatTHB(summary.upcoming7DaysAmount, 2)} บาท
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyLine(contract, summary)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 shrink-0 cursor-pointer"
                >
                  {copiedContractId === contract.id ? (
                    <>
                      <Check className="w-3 h-3" />
                      คัดลอกแล้ว
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      LINE
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Credit Grade Distribution */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-800">สัดส่วนเกรดเครดิตคลินิก</h2>
          <div className="flex items-center gap-2">
            {selectedGrade !== 'ALL' ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedGrade('ALL');
                  setPage(1);
                }}
                className="text-xs font-semibold text-[#082F4E] hover:underline cursor-pointer"
              >
                แสดงทุกเกรด (ล้างตัวกรอง: {selectedGrade})
              </button>
            ) : (
              <span className="text-xs text-slate-500">แตะเพื่อกรองข้อมูล</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 lg:grid-cols-8 gap-2.5">
          {CREDIT_GRADES.map((grade) => {
            const active = selectedGrade === grade;
            const style = GRADE_STYLE[grade];
            return (
              <button
                key={grade}
                type="button"
                onClick={() => {
                  setSelectedGrade(active ? 'ALL' : grade);
                  setPage(1);
                }}
                className={`rounded-xl p-3 border text-center transition-all cursor-pointer ${
                  active
                    ? 'bg-[#082F4E] border-[#082F4E] text-white shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300 text-slate-900'
                }`}
              >
                <div className={`text-xs font-bold ${active ? 'text-sky-200' : style.text}`}>
                  {grade}
                </div>
                <div className="mt-1 text-base font-bold font-mono-num">
                  {metrics.gradeCounts[grade]}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* AR Aging & Contracts Table Card */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">ตารางอายุหนี้และสัญญาคลินิก</h2>
            <div className="flex items-center gap-2">
              {canExportExcel && (
                <button
                  type="button"
                  onClick={() => exportAccountingWorkbook(contracts, payments)}
                  disabled={contracts.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-45 cursor-pointer whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  ส่งออก Excel (.xlsx)
                </button>
              )}
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredContracts.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-45 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                ส่งออก CSV
              </button>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="ค้นหาชื่อคลินิก, เครือคลินิกแม่, รหัสสัญญา, รุ่นเครื่อง..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2 lg:w-auto">
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="กรองตามประเภทสัญญา"
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:border-[#082F4E]"
              >
                <option value="ALL">ประเภทสัญญา</option>
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <select
                value={regionFilter}
                onChange={(e) => {
                  setRegionFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="กรองตามภูมิภาค"
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:border-[#082F4E]"
              >
                <option value="ALL">ภูมิภาค</option>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {REGION_LABELS_TH[r]}
                  </option>
                ))}
              </select>

              <select
                value={repFilter}
                onChange={(e) => {
                  setRepFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="กรองตามผู้ดูแลลูกหนี้"
                className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700 focus:outline-none focus:border-[#082F4E]"
              >
                <option value="ALL">ผู้ดูแลลูกหนี้</option>
                {metrics.salesReps.map((rep) => (
                  <option key={rep} value={rep}>
                    {rep}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">คลินิก / รหัสสัญญา</th>
                <th className="py-3 px-4">ประเภทและผู้ดูแลลูกหนี้</th>
                <th className="py-3 px-4 text-center">เกรด</th>
                <th className="py-3 px-4 text-right">ยังไม่ครบกำหนด</th>
                <th className="py-3 px-4 text-right hidden sm:table-cell">ครบกำหนดเดือนนี้</th>
                <th className="py-3 px-4 text-right hidden md:table-cell">ค้างชำระ</th>
                <th className="py-3 px-4 text-right hidden lg:table-cell">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                Array.from({ length: 4 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={7} className="py-4 px-4">
                      <div className="h-6 bg-slate-100 rounded-lg" />
                    </td>
                  </tr>
                ))
              ) : paginatedContracts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-xs text-slate-500">
                    ไม่พบรายการสัญญาที่ตรงกับเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                paginatedContracts.map((item) => {
                  const summary = enrichedContracts.get(item.id)!;
                  const gradeStyle = GRADE_STYLE[summary.suggestedGrade];
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectContract(item)}
                      className="hover:bg-slate-50/90 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-4 align-top">
                        <div className="font-semibold text-slate-900 leading-snug flex flex-wrap items-center gap-1.5">
                          <span>{item.clinicName}</span>
                          {summary.shouldSuspendPM && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">
                              <Wrench className="w-3 h-3" />
                              ชะลอ PM
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {item.contractCode} ({REGION_LABELS_TH[item.region]})
                          {item.equipmentModel ? ` · ${item.equipmentModel}` : ''}
                        </div>
                        {item.parentClinicName && (
                          <div className="text-[11px] text-[#082F4E] mt-0.5">
                            เครือ: {item.parentClinicName}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            TYPE_STYLE[item.contractType] || 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {CONTRACT_TYPE_LABELS_TH[item.contractType] || item.contractType}
                        </span>
                        <div className="text-xs text-slate-600 mt-1">{item.salesRep}</div>
                      </td>
                      <td className="py-3.5 px-4 align-top text-center">
                        <span
                          className={`inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded border text-xs font-bold ${gradeStyle.bg} ${gradeStyle.text}`}
                        >
                          {summary.suggestedGrade}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 align-top text-right font-semibold text-slate-900 font-mono-num">
                        {formatTHB(summary.notDuePrincipal)}
                      </td>
                      <td className="py-3.5 px-4 align-top text-right font-medium text-[#0F4C81] font-mono-num hidden sm:table-cell">
                        {formatTHB(summary.dueThisMonthPrincipal)}
                      </td>
                      <td
                        className={`py-3.5 px-4 align-top text-right font-semibold font-mono-num hidden md:table-cell ${
                          summary.overduePrincipal > 0 ? 'text-rose-600' : 'text-slate-400'
                        }`}
                      >
                        {formatTHB(summary.overduePrincipal)}
                      </td>
                      <td
                        className="py-3.5 px-4 align-top text-right hidden lg:table-cell"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canRecordPayment ? (
                          <button
                            type="button"
                            disabled={summary.nextStatus === 'settled'}
                            onClick={() => onRecordPayment(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            รับชำระ
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectContract(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer whitespace-nowrap"
                          >
                            ดูตารางงวด
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between text-xs text-slate-600">
          <div className="tabular-nums">
            แสดง {paginatedContracts.length} จากทั้งหมด {filteredContracts.length} สัญญา
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="หน้าก่อนหน้า"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="min-w-[28px] h-7 px-2 rounded-lg bg-[#082F4E] text-white font-semibold flex items-center justify-center tabular-nums">
              {safePage}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="w-7 h-7 rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
              aria-label="หน้าถัดไป"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
