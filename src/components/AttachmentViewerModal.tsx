import React, { useEffect, useState } from 'react';
import { Download, Loader2, Paperclip, X } from 'lucide-react';
import { fetchPaymentAttachment } from '../lib/billingService';
import type { PaymentAttachmentRecord, PaymentRecord } from '../types/billing';

interface AttachmentViewerModalProps {
  payment: PaymentRecord | null;
  onClose: () => void;
}

export function AttachmentViewerModal({ payment, onClose }: AttachmentViewerModalProps) {
  const [loading, setLoading] = useState(false);
  const [attachment, setAttachment] = useState<PaymentAttachmentRecord | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!payment) {
      setAttachment(null);
      return;
    }
    setLoading(true);
    setError('');
    void fetchPaymentAttachment(payment.id)
      .then((res) => {
        if (!res) setError('ไม่พบไฟล์หลักฐานแนบสำหรับรายการนี้');
        setAttachment(res);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดไฟล์แนบได้');
      })
      .finally(() => setLoading(false));
  }, [payment]);

  if (!payment) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <Paperclip className="w-4 h-4 text-[#082F4E] shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                หลักฐานการโอน / 50 ทวิ · {payment.referenceNo}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {payment.clinicName} · วันที่ {payment.paidDate}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {attachment && (
              <a
                href={attachment.dataUrl}
                download={attachment.fileName}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#082F4E] bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100"
              >
                <Download className="w-3.5 h-3.5" />
                ดาวน์โหลด
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 bg-slate-50 max-h-[75vh] overflow-auto flex items-center justify-center">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin text-[#082F4E]" />
              <span>กำลังโหลดไฟล์หลักฐานจากฐานข้อมูล...</span>
            </div>
          ) : error ? (
            <div className="py-12 text-xs text-rose-600">{error}</div>
          ) : attachment ? (
            attachment.mimeType === 'application/pdf' ? (
              <iframe
                title={attachment.fileName}
                src={attachment.dataUrl}
                className="w-full h-[60vh] rounded-xl border border-slate-200 bg-white"
              />
            ) : (
              <img
                src={attachment.dataUrl}
                alt={attachment.fileName}
                className="max-h-[65vh] w-auto rounded-xl border border-slate-200 shadow-sm bg-white"
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
