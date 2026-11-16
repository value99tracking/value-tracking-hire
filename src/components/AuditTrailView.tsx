import React, { useMemo, useState } from 'react';
import { ArrowRight, History, Search } from 'lucide-react';
import { ROLE_LABELS_TH, type AuditLogRecord } from '../types/billing';

interface AuditTrailViewProps {
  auditLogs: AuditLogRecord[];
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    const d = (ts as { toDate: () => Date }).toDate();
    return d.toLocaleString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return String(ts);
}

const TARGET_LABELS: Record<string, string> = {
  ALL: 'ทั้งหมด',
  contract: 'สัญญา',
  payment: 'การรับชำระเงิน',
  user: 'ผู้ใช้งานและสิทธิ์',
  system: 'ระบบและสำรองข้อมูล',
};

export function AuditTrailView({ auditLogs }: AuditTrailViewProps) {
  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState('ALL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (targetFilter !== 'ALL' && log.targetType !== targetFilter) return false;
      if (q) {
        const hay = `${log.actorName} ${log.action} ${log.targetLabel} ${log.reason || ''} ${log.beforeSummary || ''} ${log.afterSummary || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, search, targetFilter]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-slate-500">ความโปร่งใสและตรวจสอบย้อนหลัง</p>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          ประวัติการแก้ไขข้อมูล (Audit Trail)
        </h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อผู้ทำรายการ, รหัสสัญญา, เหตุผล, ค่าเดิม/ค่าใหม่..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
            />
          </div>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-xl text-slate-700"
          >
            {Object.entries(TARGET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                หมวดหมู่: {v}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            <History className="w-7 h-7 text-slate-300 mx-auto mb-2" />
            ยังไม่มีบันทึกประวัติการแก้ไขข้อมูลที่ตรงกับเงื่อนไข
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((log) => (
              <div key={log.id} className="p-4 sm:px-5 space-y-2 hover:bg-slate-50/70">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-[#082F4E] text-white text-[11px] font-bold">
                      {log.action}
                    </span>
                    <span className="text-xs font-bold text-slate-900">{log.targetLabel}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                      {TARGET_LABELS[log.targetType] || log.targetType}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono-num">
                    {formatTimestamp(log.createdAt)}
                  </div>
                </div>

                <div className="text-xs text-slate-600">
                  ผู้ดำเนินการ:{' '}
                  <span className="font-semibold text-slate-900">{log.actorName}</span>{' '}
                  <span className="px-1.5 py-0.5 rounded bg-sky-50 text-[#082F4E] font-semibold text-[11px]">
                    {ROLE_LABELS_TH[log.actorRole] || log.actorRole}
                  </span>
                  {log.reason && (
                    <span className="ml-2 text-amber-800">· เหตุผล: {log.reason}</span>
                  )}
                </div>

                {(log.beforeSummary || log.afterSummary) && (
                  <div className="grid grid-cols-1 md:grid-cols-11 gap-2 items-center bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-[11px]">
                    <div className="md:col-span-5 text-slate-600">
                      <span className="font-semibold text-slate-500">ค่าเดิม: </span>
                      {log.beforeSummary || '—'}
                    </div>
                    <div className="hidden md:flex md:col-span-1 justify-center text-slate-400">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                    <div className="md:col-span-5 text-emerald-900">
                      <span className="font-semibold text-emerald-700">ค่าใหม่: </span>
                      {log.afterSummary || '—'}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
