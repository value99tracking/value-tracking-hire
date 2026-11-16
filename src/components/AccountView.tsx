import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  LogOut,
  RotateCcw,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  logSystemBackupAction,
  resetWorkspaceData,
  updateUserRoleAndApproval,
  upsertUserProfile,
  type ActorContext,
} from '../lib/billingService';
import { firebaseProjectInfo } from '../lib/firebase';
import {
  APPROVAL_STATUS_LABELS_TH,
  FIELD_LIMITS,
  ROLE_LABELS_TH,
  USER_ROLES,
  type ApprovalStatus,
  type AuditLogRecord,
  type CollectionLogRecord,
  type ContractRecord,
  type PaymentRecord,
  type UserProfile,
  type UserRole,
} from '../types/billing';

interface AccountViewProps {
  contracts: ContractRecord[];
  payments: PaymentRecord[];
  collectionLogs: CollectionLogRecord[];
  auditLogs: AuditLogRecord[];
  actor: ActorContext;
  seeding: boolean;
  onSeedPortfolio: () => Promise<void>;
}

export function AccountView({
  contracts,
  payments,
  collectionLogs,
  auditLogs,
  actor,
  seeding,
  onSeedPortfolio,
}: AccountViewProps) {
  const { user, profile, privateInfo, usersDirectory, logout, refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [department, setDepartment] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [updatingUid, setUpdatingUid] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, ApprovalStatus>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.displayName || user?.displayName || '');
    setCompanyName(profile?.companyName || 'Value Tracking Hire');
    setDepartment(profile?.department || 'ผู้บริหารระบบ');
    setPhone(privateInfo?.phone || '');
  }, [profile, privateInfo, user]);

  useEffect(() => {
    const rMap: Record<string, UserRole> = {};
    const sMap: Record<string, ApprovalStatus> = {};
    usersDirectory.forEach((u) => {
      rMap[u.uid] = u.role;
      sMap[u.uid] = u.approvalStatus;
    });
    setRoleDrafts(rMap);
    setStatusDrafts(sMap);
  }, [usersDirectory]);

  const isSuperAdmin = profile?.role === 'super_admin';

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setSavedMsg('');
    setErrorMsg('');
    try {
      await upsertUserProfile(
        user.uid,
        { displayName, companyName, department },
        { email: user.email || privateInfo?.email || '', phone },
        isSuperAdmin
      );
      await refreshProfile();
      setSavedMsg('อัปเดตข้อมูลสมาชิกเรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถบันทึกข้อมูลได้');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUserRole = async (target: UserProfile) => {
    setUpdatingUid(target.uid);
    setErrorMsg('');
    setSavedMsg('');
    try {
      const nextRole = roleDrafts[target.uid] || target.role;
      const nextStatus = statusDrafts[target.uid] || target.approvalStatus;
      await updateUserRoleAndApproval(actor, target, nextRole, nextStatus);
      setSavedMsg(`อัปเดตสิทธิ์ของ ${target.displayName} เรียบร้อยแล้ว`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถอัปเดตสิทธิ์ผู้ใช้งานได้');
    } finally {
      setUpdatingUid(null);
    }
  };

  const handleBackupJson = async () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      projectId: firebaseProjectInfo.projectId,
      contracts,
      payments,
      collectionLogs,
      auditLogs,
      users: usersDirectory,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `value-ebilling-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await logSystemBackupAction(
      actor,
      `สำรอง ${contracts.length} สัญญา, ${payments.length} บิลรับชำระ, ${collectionLogs.length} บันทึกติดตามหนี้`
    );
    setSavedMsg('ส่งออกไฟล์สำรองข้อมูล JSON เรียบร้อยแล้ว');
  };

  const handleResetWorkspace = async () => {
    setResetting(true);
    setErrorMsg('');
    try {
      await resetWorkspaceData(actor, contracts, payments);
      setConfirmReset(false);
      setSavedMsg('รีเซ็ตข้อมูลพอร์ตลูกหนี้ทั้งหมดเรียบร้อยแล้ว');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถรีเซ็ตข้อมูลได้');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <p className="text-xs font-medium text-slate-500">บัญชี สิทธิ์การใช้งาน และการดูแลระบบ</p>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          บัญชีสมาชิก การควบคุมสิทธิ์ และสำรองข้อมูล
        </h1>
      </div>

      {/* Personal Profile Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[#082F4E] text-white flex items-center justify-center font-bold text-base shrink-0">
              <User className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {profile?.displayName || user?.displayName || 'สมาชิกในระบบ'}
              </h2>
              <p className="text-xs text-slate-500">{user?.email || privateInfo?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {profile && (
              <span className="px-3 py-1 bg-sky-50 border border-sky-200 text-[#082F4E] text-xs font-bold rounded-lg">
                บทบาท: {ROLE_LABELS_TH[profile.role]}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-lg">
              <ShieldCheck className="w-3.5 h-3.5" />
              {profile ? APPROVAL_STATUS_LABELS_TH[profile.approvalStatus] : 'ยืนยันแล้ว'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          {savedMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{savedMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ชื่อ-นามสกุลผู้ใช้งาน
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.displayNameMax}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                เบอร์โทรศัพท์ติดต่อ
              </label>
              <input
                type="tel"
                maxLength={FIELD_LIMITS.phoneMax}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08X-XXX-XXXX"
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                บริษัท / องค์กร
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.companyNameMax}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ตำแหน่ง / แผนก (แสดงในช่องผู้ดูแลลูกหนี้)
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.departmentMax}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-[#082F4E] text-white text-xs font-semibold rounded-xl hover:bg-[#0B3C63] disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}
            </button>
          </div>
        </form>
      </div>

      {/* Super Admin User Management & Approval */}
      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#082F4E]" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  จัดการสิทธิ์และอนุมัติผู้ใช้งานในระบบ ({usersDirectory.length})
                </h3>
                <p className="text-xs text-slate-500">
                  กำหนดบทบาท ฝ่ายขาย / ฝ่ายบัญชี / ผู้บริหาร และอนุมัติผู้สมัครใหม่
                </p>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-3 px-4">ชื่อ-นามสกุล / ตำแหน่ง</th>
                  <th className="py-3 px-4">ขอสิทธิ์แรกเข้า</th>
                  <th className="py-3 px-4">กำหนดบทบาท</th>
                  <th className="py-3 px-4">สถานะอนุมัติ</th>
                  <th className="py-3 px-4 text-right">บันทึก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersDirectory.map((u) => {
                  const isSelf = u.uid === user?.uid;
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">
                          {u.displayName} {isSelf && <span className="text-[#082F4E]">(คุณ)</span>}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {u.department} · {u.companyName}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {u.requestedRole ? ROLE_LABELS_TH[u.requestedRole] : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <select
                          disabled={isSelf}
                          value={roleDrafts[u.uid] || u.role}
                          onChange={(e) =>
                            setRoleDrafts((prev) => ({ ...prev, [u.uid]: e.target.value as UserRole }))
                          }
                          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-50"
                        >
                          {USER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS_TH[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          disabled={isSelf}
                          value={statusDrafts[u.uid] || u.approvalStatus}
                          onChange={(e) =>
                            setStatusDrafts((prev) => ({
                              ...prev,
                              [u.uid]: e.target.value as ApprovalStatus,
                            }))
                          }
                          className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg disabled:opacity-50"
                        >
                          <option value="approved">อนุมัติแล้ว</option>
                          <option value="pending">รออนุมัติสิทธิ์</option>
                          <option value="suspended">ระงับการใช้งาน</option>
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          disabled={isSelf || updatingUid === u.uid}
                          onClick={() => void handleSaveUserRole(u)}
                          className="px-3 py-1.5 bg-[#082F4E] text-white font-semibold rounded-lg hover:bg-[#0B3C63] disabled:opacity-40 cursor-pointer"
                        >
                          {updatingUid === u.uid ? 'กำลังบันทึก...' : 'อัปเดต'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Firebase Connection, Backup, Reset & Logout */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 text-[#082F4E] flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                สถานะฐานข้อมูลและข้อมูลสำรอง (Firebase)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                โปรเจกต์: <span className="font-mono font-semibold text-slate-700">{firebaseProjectInfo.projectId}</span> · สัญญา: <span className="font-mono-num font-semibold text-slate-700">{contracts.length}</span> · บิลรับชำระ: <span className="font-mono-num font-semibold text-slate-700">{payments.length}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {contracts.length === 0 && (
              <button
                type="button"
                disabled={seeding}
                onClick={onSeedPortfolio}
                className="px-3.5 py-2 text-xs font-semibold text-[#082F4E] bg-sky-50 border border-sky-200 rounded-xl hover:bg-sky-100 cursor-pointer whitespace-nowrap"
              >
                {seeding ? 'กำลังโหลด...' : 'โหลดข้อมูลตัวอย่าง (7 คลินิก)'}
              </button>
            )}
            {isSuperAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => void handleBackupJson()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  สำรองข้อมูล (.JSON)
                </button>
                <button
                  type="button"
                  disabled={contracts.length === 0 && payments.length === 0}
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  รีเซ็ตข้อมูลระบบ
                </button>
              </>
            )}
          </div>
        </div>

        {confirmReset && isSuperAdmin && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-3 text-xs">
            <div className="flex items-start gap-2 text-rose-900 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>
                คำเตือน: การรีเซ็ตจะลบสัญญาทั้งหมด ({contracts.length}), รายการรับชำระ ({payments.length}) และบันทึกติดตามทวงถามออกจาก Firestore ถาวร (แนะนำให้กดสำรองข้อมูล .JSON ก่อน)
              </span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={resetting}
                onClick={() => void handleResetWorkspace()}
                className="px-4 py-1.5 bg-rose-600 text-white font-semibold rounded-lg hover:bg-rose-700 cursor-pointer"
              >
                {resetting ? 'กำลังรีเซ็ต...' : 'ยืนยันรีเซ็ตข้อมูลพอร์ต'}
              </button>
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">ออกจากระบบบัญชีปัจจุบัน</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  );
}
