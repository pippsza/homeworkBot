import { useNavigate } from "react-router-dom";
import { Users, BookOpen, FileText, MessageSquareCode, Cpu, ChevronRight } from "lucide-react";
import RoleGuard from "../components/RoleGuard";

function AdminContent() {
  const navigate = useNavigate();

  const items = [
    { path: "/admin/users", icon: Users, label: "Пользователи", desc: "Админы, ревьюверы, суперюзеры" },
    { path: "/admin/subjects", icon: BookOpen, label: "Предметы", desc: "Предметы, задания, ответы" },
    { path: "/admin/infos", icon: FileText, label: "Информация", desc: "Добавление и редактирование инфо" },
    { path: "/admin/prompts", icon: MessageSquareCode, label: "Промпты", desc: "Управление AI-промптами" },
    { path: "/admin/models", icon: Cpu, label: "AI модели", desc: "Настройка моделей для задач" },
  ];

  return (
    <div className="p-4 page-enter">
      <h1 className="text-xl font-bold mb-4">Админ-панель</h1>

      <div className="space-y-2">
        {items.map(({ path, icon: Icon, label, desc }) => (
          <div key={path} className="card flex items-center gap-3" onClick={() => navigate(path)}>
            <Icon size={20} style={{ color: "var(--tg-theme-button-color)" }} />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{label}</div>
              <div className="text-xs text-[var(--tg-theme-hint-color)]">{desc}</div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--tg-theme-hint-color)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPanel() {
  return (
    <RoleGuard
      role="superadmin"
      fallback={
        <div className="p-4 text-center text-[var(--tg-theme-hint-color)]">
          Нет доступа
        </div>
      }
    >
      <AdminContent />
    </RoleGuard>
  );
}
