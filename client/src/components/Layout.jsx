import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, Component } from "react";
import { useApi } from "../hooks/useApi";
import { BookOpen, Info, Settings } from "lucide-react";
import AiChat from "./AiChat";

class AiChatBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("[AiChat crash]", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: "fixed", bottom: 70, left: 8, right: 8,
          padding: 8, fontSize: 10, background: "#fee", color: "#c00",
          borderRadius: 8, zIndex: 999, wordBreak: "break-all",
        }}>
          AiChat error: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Layout({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { apiFetch } = useApi();
  const [user, setUser] = useState(null);

  useEffect(() => {
    apiFetch("/users/me").then(setUser).catch(console.error);
  }, []);

  const tabs = [
    { path: "/", match: (p) => p === "/" || p.startsWith("/subjects") || p.startsWith("/tasks"), label: "Предметы", icon: BookOpen },
    { path: "/infos", match: (p) => p.startsWith("/infos"), label: "Инфо", icon: Info },
  ];

  if (user?.isSuperadmin) {
    tabs.push({ path: "/admin", match: (p) => p.startsWith("/admin"), label: "Админ", icon: Settings });
  }

  const showAiChat = user?.isStudent;

  return (
    <div className="min-h-screen pb-20">
      {children}

      {showAiChat && (
        <AiChatBoundary>
          <AiChat />
        </AiChatBoundary>
      )}

      <nav
        className="fixed bottom-0 left-0 right-0 flex"
        style={{
          backgroundColor: "var(--tg-theme-bg-color)",
          boxShadow: "0 -1px 8px rgba(0,0,0,0.08)",
        }}
      >
        {tabs.map((tab) => {
          const active = tab.match(location.pathname);
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs transition-colors"
              style={{
                color: active
                  ? "var(--tg-theme-button-color)"
                  : "var(--tg-theme-hint-color)",
                fontWeight: active ? 600 : 400,
              }}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              {tab.label}
              {active && (
                <div
                  className="w-1 h-1 rounded-full"
                  style={{ backgroundColor: "var(--tg-theme-button-color)" }}
                />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
