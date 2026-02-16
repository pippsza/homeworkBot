export default function FormField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  required = false,
}) {
  const inputStyle = {
    backgroundColor: "var(--tg-theme-secondary-bg-color)",
    color: "var(--tg-theme-text-color)",
  };

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
          style={inputStyle}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={inputStyle}
        />
      )}
    </div>
  );
}
