export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Удалить",
  cancelText = "Отмена",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xs rounded-2xl p-5 space-y-3"
        style={{ backgroundColor: "var(--tg-theme-bg-color)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{title}</h3>
        {message && (
          <p className="text-sm" style={{ color: "var(--tg-theme-hint-color)" }}>
            {message}
          </p>
        )}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "var(--tg-theme-secondary-bg-color)" }}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white bg-red-500"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
