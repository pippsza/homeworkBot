export default function EmptyState({ emoji = "📭", title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-5xl mb-4">{emoji}</div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      {description && (
        <p className="text-sm mb-4" style={{ color: "var(--tg-theme-hint-color)" }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
