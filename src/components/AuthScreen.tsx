import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { firebaseProjectInfo } from '../lib/firebase';
import { FIELD_LIMITS, type RequestedRole } from '../types/billing';

type AuthMode = 'login' | 'register' | 'reset';

function mapFirebaseAuthError(err: unknown): { message: string; isProviderDisabled: boolean } {
  const code = (err as { code?: string })?.code || '';
  if (code === 'auth/operation-not-allowed') {
    return {
      isProviderDisabled: true,
      message:
        'ระบบยังไม่ได้เปิดใช้งาน Email/Password Sign-in ใน Firebase Console ของโปรเจกต์ value-tracking-hire',
    };
  }
  if (code === 'auth/email-already-in-use') {
    return { isProviderDisabled: false, message: 'อีเมลนี้ถูกสมัครสมาชิกไว้แล้ว กรุณาเข้าสู่ระบบ' };
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return { isProviderDisabled: false, message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง' };
  }
  if (code === 'auth/weak-password') {
    return { isProviderDisabled: false, message: 'รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร' };
  }
  if (code === 'auth/invalid-email') {
    return { isProviderDisabled: false, message: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }
  if (code === 'auth/popup-closed-by-user') {
    return { isProviderDisabled: false, message: 'ยกเลิกการเข้าสู่ระบบด้วย Google' };
  }
  return {
    isProviderDisabled: false,
    message: err instanceof Error ? err.message : 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง',
  };
}

export function AuthScreen() {
  const {
    user,
    isEmailVerified,
    registerWithEmail,
    loginWithEmail,
    loginWithGoogle,
    logout,
    resendVerificationEmail,
    refreshEmailVerification,
    sendResetPassword,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('Value E-billing Thailand');
  const [department, setDepartment] = useState('ฝ่ายขายและดูแลคลินิก');
  const [requestedRole, setRequestedRole] = useState<RequestedRole>('sales');
  const [phone, setPhone] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [showProviderSetupGuide, setShowProviderSetupGuide] = useState(false);

  if (user && !isEmailVerified) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex items-center justify-center p-4 sm:p-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-xl bg-[#082F4E] text-white flex items-center justify-center font-bold text-sm shrink-0">
              VE
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">ยืนยันอีเมลเพื่อเปิดใช้งานระบบ</h1>
              <p className="text-xs text-slate-500">ต้องยืนยันอีเมลก่อนเข้าใช้งาน</p>
            </div>
          </div>

          <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-5 flex items-start gap-3">
            <MailCheck className="w-5 h-5 text-sky-700 shrink-0 mt-0.5" />
            <div className="text-sm text-sky-950">
              <p className="font-semibold mb-1">ส่งลิงก์ยืนยันไปยัง {user.email} แล้ว</p>
              <p className="text-xs text-sky-800 leading-relaxed">
                เพื่อความปลอดภัยของฐานข้อมูล Firestore กรุณาเปิดอีเมลและคลิกลิงก์ยืนยัน จากนั้นกดปุ่ม
                “ตรวจสอบสถานะการยืนยัน” ด้านล่าง
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{infoMsg}</span>
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setErrorMsg('');
                setInfoMsg('');
                try {
                  const verified = await refreshEmailVerification();
                  if (!verified) {
                    setInfoMsg('ยังไม่พบการยืนยันอีเมล กรุณาคลิกลิงก์ในกล่องจดหมาย (รวมถึงโฟลเดอร์ Spam) แล้วลองอีกครั้ง');
                  }
                } catch (err) {
                  setErrorMsg(mapFirebaseAuthError(err).message);
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#082F4E] text-white text-sm font-semibold rounded-xl hover:bg-[#0B3C63] transition-colors disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              ตรวจสอบสถานะการยืนยันอีเมล
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setErrorMsg('');
                setInfoMsg('');
                try {
                  await resendVerificationEmail();
                  setInfoMsg('ส่งอีเมลยืนยันอีกครั้งเรียบร้อยแล้ว');
                } catch (err) {
                  setErrorMsg(mapFirebaseAuthError(err).message);
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full py-2.5 px-4 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
            >
              ส่งลิงก์ยืนยันอีกครั้ง
            </button>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  try {
                    await logout();
                  } finally {
                    setLoading(false);
                  }
                }}
                className="text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
              >
                ออกจากระบบ / เปลี่ยนบัญชี
              </button>
              <button
                type="button"
                onClick={async () => {
                  setLoading(true);
                  setErrorMsg('');
                  try {
                    await logout();
                    await loginWithGoogle();
                  } catch (err) {
                    setErrorMsg(mapFirebaseAuthError(err).message);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="text-[#082F4E] hover:underline font-semibold cursor-pointer"
              >
                เข้าสู่ระบบทันทีด้วย Google
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setShowProviderSetupGuide(false);

    if (mode === 'register') {
      if (!displayName.trim()) {
        setErrorMsg('กรุณากรอกชื่อ-นามสกุลผู้ใช้งาน');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'register') {
        await registerWithEmail({
          email,
          password,
          displayName,
          companyName,
          department,
          requestedRole,
          phone,
        });
      } else if (mode === 'login') {
        await loginWithEmail(email, password);
      } else {
        await sendResetPassword(email);
        setInfoMsg('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปยังอีเมลของคุณแล้ว');
      }
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
      setShowProviderSetupGuide(mapped.isProviderDisabled);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setShowProviderSetupGuide(false);
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setErrorMsg(mapFirebaseAuthError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex items-center justify-center p-4 sm:p-8">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
        <div
          className="lg:col-span-5 p-7 sm:p-10 text-white flex flex-col justify-between"
          style={{
            background: 'linear-gradient(155deg, #05223B 0%, #083358 55%, #0B4675 100%)',
          }}
        >
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center font-bold text-sm tracking-tight">
                VE
              </div>
              <div>
                <div className="text-base font-bold tracking-tight">Value E-billing</div>
                <div className="text-xs text-sky-200/80">ศูนย์บริหารลูกหนี้ สัญญาเครื่องมือแพทย์ และระบบผ่อนชำระ</div>
              </div>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold leading-snug tracking-tight mb-4 [text-wrap:balance]">
              ระบบบริหารสัญญาเช่าซื้อเครื่องมือแพทย์และติดตามลูกหนี้
            </h1>
            <p className="text-sm text-sky-100/80 leading-relaxed mb-8">
              คำนวณตารางงวดชำระรายเดือนอัตโนมัติ รองรับ VAT 7%, ภาษีหัก ณ ที่จ่าย (WHT),
              การตัดยอดบางส่วนและปัดยอดข้ามงวด พร้อมระบบควบคุมสิทธิ์และ Audit Trail ครบวงจร
            </p>
          </div>

          <div className="space-y-4">
            <div className="bg-white/10 border border-white/15 rounded-2xl p-4">
              <div className="text-xs text-sky-200/80 mb-1">ความสามารถหลักของระบบ</div>
              <ul className="text-xs text-sky-100 space-y-1.5 mt-2">
                <li>• สัญญา ซื้อขาย / เช่าซื้อ / เช่า ผูกเครือคลินิกแม่ได้</li>
                <li>• ตารางงวด คำนวณเบี้ยปรับล่าช้า ปรับโครงสร้างหนี้ และปิดบัญชีก่อนกำหนด</li>
                <li>• แนบสลิปโอน / 50 ทวิ แจ้งเตือนครบกำหนด 7 วัน และคัดลอกข้อความ LINE</li>
              </ul>
            </div>

            <div className="flex items-center gap-2 text-xs text-sky-200/80">
              <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
              <span>โปรเจกต์ Firebase: {firebaseProjectInfo.projectId}</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-center">
          <div className="max-w-md w-full mx-auto">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                เข้าสู่ระบบ
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
                className={`flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'register'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                สมัครสมาชิก
              </button>
            </div>

            <div className="mb-5">
              <h2 className="text-xl font-bold text-slate-900">
                {mode === 'login' && 'ยินดีต้อนรับกลับมา'}
                {mode === 'register' && 'สมัครสมาชิกทีมงาน'}
                {mode === 'reset' && 'รีเซ็ตรหัสผ่าน'}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {mode === 'login' && 'เข้าสู่ระบบเพื่อจัดการพอร์ตลูกหนี้และสัญญาคลินิกของคุณ'}
                {mode === 'register' && 'ลงทะเบียนผู้ใช้งาน (ผู้บริหารจะเป็นผู้อนุมัติสิทธิ์ก่อนเข้าใช้งาน)'}
                {mode === 'reset' && 'กรอกอีเมลที่ลงทะเบียนไว้เพื่อรับลิงก์ตั้งรหัสผ่านใหม่'}
              </p>
            </div>

            {errorMsg && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span className="font-medium leading-relaxed">{errorMsg}</span>
                </div>
                {showProviderSetupGuide && (
                  <div className="pt-2 border-t border-rose-200/80 text-[11px] text-rose-900 space-y-1.5">
                    <p className="font-semibold">วิธีเปิดใช้งานการสมัครสมาชิกด้วย Email/Password:</p>
                    <ol className="list-decimal list-inside space-y-0.5 text-rose-800">
                      <li>เปิด Firebase Console ของโปรเจกต์ {firebaseProjectInfo.projectId}</li>
                      <li>ไปที่ Authentication → Sign-in method → Add new provider</li>
                      <li>เลือก Email/Password แล้วกด Enable และ Save</li>
                    </ol>
                    <a
                      href={`https://console.firebase.google.com/project/${firebaseProjectInfo.projectId}/authentication/providers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#082F4E] hover:underline pt-0.5"
                    >
                      เปิดหน้าตั้งค่า Sign-in providers <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            {infoMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{infoMsg}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      ชื่อ-นามสกุล *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={FIELD_LIMITS.displayNameMax}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="เช่น คุณสมชาย ประเสริฐ"
                      className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        องค์กร / บริษัท *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={FIELD_LIMITS.companyNameMax}
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        ตำแหน่ง / แผนก *
                      </label>
                      <input
                        type="text"
                        required
                        maxLength={FIELD_LIMITS.departmentMax}
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        placeholder="เช่น AR Specialist"
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        สิทธิ์ที่ขอใช้งาน *
                      </label>
                      <select
                        value={requestedRole}
                        onChange={(e) => setRequestedRole(e.target.value as RequestedRole)}
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E]"
                      >
                        <option value="sales">ฝ่ายขาย (Sales)</option>
                        <option value="accounting">ฝ่ายบัญชี (Accounting)</option>
                      </select>
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
                        className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  อีเมล *
                </label>
                <input
                  type="email"
                  required
                  maxLength={FIELD_LIMITS.emailMax}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                />
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      รหัสผ่าน *
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('reset');
                          setErrorMsg('');
                          setInfoMsg('');
                        }}
                        className="text-xs font-medium text-[#082F4E] hover:underline cursor-pointer"
                      >
                        ลืมรหัสผ่าน?
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                  />
                </div>
              )}

              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ยืนยันรหัสผ่าน *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-[#082F4E] transition-colors"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-[#082F4E] text-white text-sm font-semibold rounded-xl hover:bg-[#0B3C63] transition-colors disabled:opacity-60 cursor-pointer"
              >
                {mode === 'register' ? (
                  <>
                    <UserPlus className="w-4 h-4" />
                    สมัครสมาชิกและส่งคำขอสิทธิ์
                  </>
                ) : mode === 'login' ? (
                  <>
                    <KeyRound className="w-4 h-4" />
                    เข้าสู่ระบบ
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    ส่งลิงก์รีเซ็ตรหัสผ่าน
                  </>
                )}
              </button>

              {mode === 'reset' && (
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  กลับไปหน้าเข้าสู่ระบบ
                </button>
              )}
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-slate-400 font-medium">หรือเข้าสู่ระบบด่วน</span>
              </div>
            </div>

            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 bg-white border border-slate-200 text-slate-800 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60 cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                />
              </svg>
              เข้าสู่ระบบด้วยบัญชี Google
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
